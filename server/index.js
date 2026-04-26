import http from "node:http";
import OpenAI, { APIError } from "openai";
import * as localConfig from "./local-config.js";
import {
  OPENAI_MODEL,
  PREPROMPT_ADVANCED,
  PREPROMPT_BEGINNER,
  PREPROMPT_ELEMENTARY,
  PREPROMPT_FLUENT,
  PREPROMPT_INTERMEDIATE,
  PREPROMPT_SUFFIX,
  isFullTranslationLevel,
  normalizeSettings,
} from "../src/shared/settings.js";
import {
  buildMarkerizedTextFromSplitText,
  buildPlainTextFromParsedMarkers,
  buildRawTextFromSplitText,
  normalizeWhitespace,
  parseTranslatedMarkerizedText,
  reconstructHtmlFromParsedMarkers,
} from "../src/shared/translationMarkup.js";
import {
  getPriorityWordsForPrompt,
  getTranslationLevelForExp,
  getUserLanguageExp,
  recordLanguageExp,
  recordTranslatedWordExp,
  recordWordFeedback,
} from "./learningStore.js";
import {
  ensureWordEmbeddingIndexes,
  getCollectionNames,
  getMongoDatabase,
  hasMongoConfig,
} from "./mongo.js";
import {
  clearDashboardSessionCookie,
  getDashboardSessionFromRequest,
  setDashboardSessionCookie,
  verifyGoogleDashboardCredential,
} from "./dashboardAuth.js";
import { resolveDashboardOrigin } from "./dashboardConfig.js";
import {
  getDashboardLanguages,
  getDashboardOverview,
  getDashboardSettings,
  getDashboardVocabularyEntries,
  sanitizeDashboardSettings,
  upsertDashboardSettings,
} from "./dashboardStore.js";


const SERVER_HOST = "127.0.0.1";
const SERVER_PORT = localConfig.SERVER_PORT;
const MAX_TRANSLATION_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 60_000;
const ALIGNMENT_WORD_PATTERN = /[\p{L}\p{N}\p{M}'’-]+/gu;
const TARGET_LANGUAGE_CODE_MAP = {
  spanish: "es",
  french: "fr",
  mandarin: "ma",
  russian: "ru",
};

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY?.trim() ||
  localConfig.LOCAL_OPENAI_API_KEY?.trim() ||
  localConfig.OPENAI_API_KEY?.trim() ||
  "";
const openAIClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY?.trim() ||
  localConfig.LOCAL_ELEVENLABS_API_KEY?.trim() ||
  localConfig.ELEVENLABS_API_KEY?.trim() ||
  "";
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID?.trim() || localConfig.LOCAL_ELEVENLABS_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb";
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID?.trim() || localConfig.LOCAL_ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function setDashboardCorsHeaders(response, requestOrigin) {
  const allowedOrigin = resolveDashboardOrigin(requestOrigin);
  if (!allowedOrigin) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Vary", "Origin");
  return true;
}

function sendDashboardJson(response, requestOrigin, statusCode, payload) {
  if (!setDashboardCorsHeaders(response, requestOrigin)) {
    response.writeHead(403, {
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ error: "Dashboard origin is not allowed." }));
    return;
  }

  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function sendDashboardNoContent(response, requestOrigin, statusCode = 204) {
  if (!setDashboardCorsHeaders(response, requestOrigin)) {
    response.writeHead(403);
    response.end();
    return;
  }

  response.writeHead(statusCode);
  response.end();
}

function getRequestUrl(request) {
  return new URL(request.url, `http://${SERVER_HOST}:${SERVER_PORT}`);
}

function getDashboardSessionOrReject(request, response, requestOrigin) {
  const session = getDashboardSessionFromRequest(request);
  if (!session) {
    sendDashboardJson(response, requestOrigin, 401, {
      error: "Dashboard authentication is required.",
    });
    return null;
  }

  return session;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logServerEvent(event, details = {}) {
  console.log(`[translation-server] ${event}`, details);
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function normalizeWord(word) {
  return String(word ?? "").trim().toLowerCase();
}

function normalizeTargetLanguage(targetLanguage) {
  return String(targetLanguage ?? "").trim();
}

async function findStoredWordEmbedding({
  userEmail,
  word,
  targetLanguage,
}) {
  if (!hasMongoConfig()) {
    return null;
  }

  const userEmailLower = normalizeEmail(userEmail);
  const wordNormalized = normalizeWord(word);
  const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage);

  if (!userEmailLower || !wordNormalized || !normalizedTargetLanguage) {
    return null;
  }

  await ensureWordEmbeddingIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return null;
  }

  const { wordEmbeddings } = getCollectionNames();
  return db.collection(wordEmbeddings).findOne(
    {
      userEmailLower,
      targetLanguage: normalizedTargetLanguage,
      wordNormalized,
    },
    {
      projection: {
        _id: 0,
        word: 1,
        targetLanguage: 1,
        userEmail: 1,
        embedding: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    }
  );
}

async function storeWordEmbedding({
  userEmail,
  word,
  targetLanguage,
  embedding,
}) {
  if (!hasMongoConfig()) {
    return { ok: false, disabled: true };
  }

  const userEmailLower = normalizeEmail(userEmail);
  const normalizedWord = String(word ?? "").trim();
  const wordNormalized = normalizeWord(word);
  const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage);

  if (
    !userEmailLower ||
    !wordNormalized ||
    !normalizedTargetLanguage ||
    !Array.isArray(embedding) ||
    embedding.length === 0
  ) {
    return { ok: false, disabled: false };
  }

  await ensureWordEmbeddingIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return { ok: false, disabled: true };
  }

  const { wordEmbeddings } = getCollectionNames();
  const now = new Date();

  const writeResult = await db.collection(wordEmbeddings).updateOne(
    {
      userEmailLower,
      targetLanguage: normalizedTargetLanguage,
      wordNormalized,
    },
    {
      $setOnInsert: {
        createdAt: now,
        userEmailLower,
        targetLanguage: normalizedTargetLanguage,
        wordNormalized,
      },
      $set: {
        updatedAt: now,
        userEmail: String(userEmail ?? "").trim(),
        word: normalizedWord,
        embedding,
      },
    },
    {
      upsert: true,
    }
  );

  const storedOk = writeResult.acknowledged && (writeResult.matchedCount > 0 || writeResult.upsertedCount > 0);

  return {
    ok: storedOk,
    disabled: false,
    matchedCount: writeResult.matchedCount ?? 0,
    modifiedCount: writeResult.modifiedCount ?? 0,
    upsertedCount: writeResult.upsertedCount ?? 0,
  };
}

function describeLengthBias(temperature) {
  if (temperature <= 0.33) {
    return "Favor shorter translated spans whenever possible.";
  }

  if (temperature >= 0.67) {
    return "You may use slightly longer translated spans when still obeying all other rules.";
  }

  return "Prefer short translated spans over longer ones.";
}

function getLevelPrompt(translationLevel) {
  if (translationLevel === "fluent") {
    return PREPROMPT_FLUENT;
  }

  if (translationLevel === "advanced") {
    return PREPROMPT_ADVANCED;
  }

  if (translationLevel === "intermediate") {
    return PREPROMPT_INTERMEDIATE;
  }

  if (translationLevel === "elementary") {
    return PREPROMPT_ELEMENTARY;
  }

  return PREPROMPT_BEGINNER;
}

function getPromptSuffix(translationLevel) {
  const suffixLines = PREPROMPT_SUFFIX.split("\n");

  if (isFullTranslationLevel(translationLevel)) {
    return suffixLines
      .filter((line) => line !== "Leave every non-translated word exactly unchanged")
      .filter((line) => line !== "Do not rewrite, paraphrase, summarize, or fully translate sentences")
      .concat("Do not add explanations, notes, or alternatives.")
      .join("\n");
  }

  if (translationLevel !== "advanced") {
    return suffixLines.join("\n");
  }

  return suffixLines
    .filter((line) => line !== "Leave every non-translated word exactly unchanged")
    .filter((line) => line !== "Do not rewrite, paraphrase, summarize, or fully translate sentences")
    .concat("Do not paraphrase or summarize; preserve the original meaning while translating.")
    .join("\n");
}

function buildTranslationPrompt(targetLanguage, settings, priorityWords = []) {
  const translationLevel = settings?.translationLevel ?? "beginner";
  const minWords = settings?.phraseMinWords ?? 1;
  const maxWords = settings?.phraseMaxWords ?? 4;
  const maxCoveragePercent = settings?.phraseCoveragePercent ?? 16;
  const promptLines =
    isFullTranslationLevel(translationLevel)
      ? [
          `Translate the input fully into ${targetLanguage}.`,
          `Translation level: ${translationLevel}.`,
          getLevelPrompt(translationLevel),
          "Translate the full paragraph, including text inside markers.",
          "Keep names, brands, and other intentional source-language text only when translating them would be unnatural or incorrect.",
          getPromptSuffix(translationLevel),
        ]
      : translationLevel === "advanced"
      ? [
          `Translate the input into ${targetLanguage}.`,
          `Translation level: ${translationLevel}.`,
          getLevelPrompt(translationLevel),
          `Translate approximately ${maxCoveragePercent}% of the words in the paragraph.`,
          "Longer continuous translated spans are allowed when they sound natural.",
          describeLengthBias(settings?.phraseLengthTemperature ?? 0.5),
        ]
      : [
          `Partially translate the input into ${targetLanguage}.`,
          `Translation level: ${translationLevel}.`,
          getLevelPrompt(translationLevel),
          `Each translated span must be between ${minWords} and ${maxWords} words inclusive.`,
          `Never translate more than ${maxWords} consecutive words in any one span.`,
          `Translate at most about ${maxCoveragePercent}% of the words in the paragraph.`,
          translationLevel === "intermediate"
            ? "Allow longer continuous translated spans when they sound natural."
            : "Prefer multiple isolated translated spans instead of one large translated chunk.",
          describeLengthBias(settings?.phraseLengthTemperature ?? 0.5),
        ];

  // if (priorityWords.length > 0) {
  //   // priorityWords = priorityWords.slice(0, 1);
  //   promptLines.push(
  //     "Prioratize translating these words before other eligible words WITHOUT VIOLATING MARKER RULES OR TAGS."
  //   );
  //   console.log(`${priorityWords.map((word) => word.sourceWord).join(", ")}`);
  //   promptLines.push(
  //     `Priority words present in this paragraph: ${priorityWords
  //       .map((word) => word.sourceWord)
  //       .join(", ")}`
  //   );
  // }
  promptLines.push(getPromptSuffix(translationLevel));
  return promptLines.join("\n");
}

function buildAlignmentPrompt(targetLanguage) {
  return [
    `You align source-language tokens with translated ${targetLanguage} tokens.`,
    "Return strict JSON only.",
    "Return an object with an `alignments` array.",
    "Each item must have integer fields: sourceStart, sourceEnd, targetStart, targetEnd.",
    "Indices are inclusive and refer to the provided token arrays.",
    "Use contiguous source spans and contiguous target spans.",
    "Allow many-to-one, one-to-many, and many-to-many phrase mappings.",
    "Only include spans for words or phrases that were actually translated.",
    "Do not include unchanged spans.",
    "Do not let target spans overlap each other.",
    "Prefer one-to-one word alignments whenever possible.",
    "Use multi-word phrase alignments only when a precise one-to-one alignment is impossible.",
    "Do not map a single source word to a long multi-word target phrase unless it is absolutely necessary.",
    "Favor the smallest accurate aligned phrase span.",
  ].join("\n");
}

function extractOpenAIText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function tokenizeWords(text) {
  const normalizedText = String(text ?? "").normalize("NFC");
  const tokenPattern = new RegExp(ALIGNMENT_WORD_PATTERN.source, ALIGNMENT_WORD_PATTERN.flags);
  return Array.from(normalizedText.matchAll(tokenPattern)).map((match, index) => ({
    index,
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function countTranslatedSourceWords(alignments) {
  if (!Array.isArray(alignments) || alignments.length === 0) {
    return 0;
  }

  const translatedSourceIndexes = new Set();

  for (const alignment of alignments) {
    const sourceStart = Number(alignment?.sourceStart);
    const sourceEnd = Number(alignment?.sourceEnd);

    if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd) || sourceEnd < sourceStart) {
      continue;
    }

    for (let sourceIndex = sourceStart; sourceIndex <= sourceEnd; sourceIndex += 1) {
      translatedSourceIndexes.add(sourceIndex);
    }
  }

  return translatedSourceIndexes.size;
}

function joinTokenText(tokens, start, end) {
  return tokens.slice(start, end + 1).map((token) => token.text).join(" ");
}

function getMatchedTokenPairs(sourceTokens, targetTokens) {
  const sourceValues = sourceTokens.map((token) => canonicalizeAlignedText(token.text));
  const targetValues = targetTokens.map((token) => canonicalizeAlignedText(token.text));
  const lcsTable = Array.from({ length: sourceValues.length + 1 }, () =>
    Array(targetValues.length + 1).fill(0)
  );

  for (let sourceIndex = sourceValues.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = targetValues.length - 1; targetIndex >= 0; targetIndex -= 1) {
      if (sourceValues[sourceIndex] && sourceValues[sourceIndex] === targetValues[targetIndex]) {
        lcsTable[sourceIndex][targetIndex] = lcsTable[sourceIndex + 1][targetIndex + 1] + 1;
      } else {
        lcsTable[sourceIndex][targetIndex] = Math.max(
          lcsTable[sourceIndex + 1][targetIndex],
          lcsTable[sourceIndex][targetIndex + 1]
        );
      }
    }
  }

  const matches = [];
  let sourceIndex = 0;
  let targetIndex = 0;
  while (sourceIndex < sourceValues.length && targetIndex < targetValues.length) {
    if (sourceValues[sourceIndex] && sourceValues[sourceIndex] === targetValues[targetIndex]) {
      matches.push({ sourceIndex, targetIndex });
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    if (lcsTable[sourceIndex + 1][targetIndex] >= lcsTable[sourceIndex][targetIndex + 1]) {
      sourceIndex += 1;
    } else {
      targetIndex += 1;
    }
  }

  return matches;
}

function buildAlignmentRecord(id, sourceTokens, targetTokens, sourceStart, sourceEnd, targetStart, targetEnd) {
  if (
    sourceStart > sourceEnd ||
    targetStart > targetEnd ||
    sourceStart < 0 ||
    targetStart < 0 ||
    sourceEnd >= sourceTokens.length ||
    targetEnd >= targetTokens.length
  ) {
    return null;
  }

  const sourceText = joinTokenText(sourceTokens, sourceStart, sourceEnd);
  const targetText = joinTokenText(targetTokens, targetStart, targetEnd);
  if (!sourceText || !targetText) {
    return null;
  }

  if (canonicalizeAlignedText(sourceText) === canonicalizeAlignedText(targetText)) {
    return null;
  }

  return {
    id,
    sourceStart,
    sourceEnd,
    targetStart,
    targetEnd,
    sourceText,
    targetText,
  };
}

function buildDeterministicAlignments(sourceTokens, targetTokens) {
  const matches = getMatchedTokenPairs(sourceTokens, targetTokens);
  const alignments = [];
  let nextAlignmentId = 1;
  let previousSourceIndex = -1;
  let previousTargetIndex = -1;

  for (const match of [...matches, { sourceIndex: sourceTokens.length, targetIndex: targetTokens.length }]) {
    const sourceStart = previousSourceIndex + 1;
    const sourceEnd = match.sourceIndex - 1;
    const targetStart = previousTargetIndex + 1;
    const targetEnd = match.targetIndex - 1;
    const sourceCount = sourceEnd - sourceStart + 1;
    const targetCount = targetEnd - targetStart + 1;

    if (sourceCount > 0 && targetCount > 0) {
      if (sourceCount === targetCount) {
        for (let offset = 0; offset < sourceCount; offset += 1) {
          const alignment = buildAlignmentRecord(
            `alignment-${nextAlignmentId}`,
            sourceTokens,
            targetTokens,
            sourceStart + offset,
            sourceStart + offset,
            targetStart + offset,
            targetStart + offset
          );
          if (alignment) {
            alignments.push(alignment);
            nextAlignmentId += 1;
          }
        }
      } else {
        const alignment = buildAlignmentRecord(
          `alignment-${nextAlignmentId}`,
          sourceTokens,
          targetTokens,
          sourceStart,
          sourceEnd,
          targetStart,
          targetEnd
        );
        if (alignment) {
          alignments.push(alignment);
          nextAlignmentId += 1;
        }
      }
    }

    previousSourceIndex = match.sourceIndex;
    previousTargetIndex = match.targetIndex;
  }

  return alignments.flatMap((alignment) =>
    expandAlignmentRecord(alignment, sourceTokens, targetTokens)
  );
}

function canonicalizeAlignedText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

class RetryableTranslationError extends Error {
  constructor(message, retryDelayMs) {
    super(message);
    this.name = "RetryableTranslationError";
    this.retryDelayMs = retryDelayMs;
  }
}

class MarkerValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarkerValidationError";
  }
}

function parseRetryDelayMs(retryDelay) {
  if (typeof retryDelay === "number" && Number.isFinite(retryDelay)) {
    return Math.max(0, Math.ceil(retryDelay));
  }

  if (typeof retryDelay !== "string") {
    return null;
  }

  const trimmedRetryDelay = retryDelay.trim();
  const milliseconds = Number.parseFloat(trimmedRetryDelay);
  if (Number.isFinite(milliseconds) && /^\d+(\.\d+)?$/.test(trimmedRetryDelay)) {
    return Math.max(0, Math.ceil(milliseconds));
  }

  const seconds = Number.parseFloat(trimmedRetryDelay.replace(/s$/, ""));
  if (Number.isFinite(seconds) && /^\d+(\.\d+)?s?$/.test(trimmedRetryDelay)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const retryAtMs = Date.parse(trimmedRetryDelay);
  if (Number.isNaN(retryAtMs)) {
    return null;
  }

  return Math.max(0, retryAtMs - Date.now());
}

function getRetryDelayMs(error) {
  if (!(error instanceof APIError)) {
    return null;
  }

  const retryAfterMs = parseRetryDelayMs(error.headers?.get("retry-after-ms"));
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  const retryAfter = parseRetryDelayMs(error.headers?.get("retry-after"));
  if (retryAfter !== null) {
    return retryAfter;
  }

  if (error.status === 429) {
    return FALLBACK_RETRY_DELAY_MS;
  }

  return null;
}

function toRetryableTranslationError(error) {
  if (!(error instanceof APIError)) {
    return null;
  }

  const retryDelayMs = getRetryDelayMs(error);
  if (!retryDelayMs) {
    return null;
  }

  return new RetryableTranslationError(error.message, retryDelayMs);
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Model returned invalid JSON: ${error.message}`);
  }
}

function normalizeLookupWord(word) {
  return String(word ?? "")
    .normalize("NFC")
    .trim()
    .replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, "");
}

function getTargetLanguageCode(targetLanguage) {
  return TARGET_LANGUAGE_CODE_MAP[String(targetLanguage ?? "").toLowerCase()] ?? null;
}

function getWiktApiEntries(responseJson) {
  if (Array.isArray(responseJson?.definitions)) {
    return responseJson.definitions.map((definition) => ({
      ...definition,
      word: definition?.word ?? responseJson.word ?? null,
      lang_code: definition?.lang_code ?? responseJson.lang_code ?? null,
      lang: definition?.lang ?? responseJson.lang ?? null,
    }));
  }

  if (Array.isArray(responseJson)) {
    return responseJson;
  }

  if (Array.isArray(responseJson?.entries)) {
    return responseJson.entries;
  }

  if (Array.isArray(responseJson?.data)) {
    return responseJson.data;
  }

  if (responseJson && typeof responseJson === "object") {
    return [responseJson];
  }

  return [];
}

function extractLookupExample(example) {
  if (typeof example === "string") {
    return normalizeWhitespace(example);
  }

  if (example && typeof example === "object") {
    if (typeof example.english === "string") {
      return normalizeWhitespace(example.english);
    }

    if (typeof example.text === "string") {
      return normalizeWhitespace(example.text);
    }

    if (typeof example.example === "string") {
      return normalizeWhitespace(example.example);
    }

    if (typeof example.quote === "string") {
      return normalizeWhitespace(example.quote);
    }

    if (typeof example.raw === "string") {
      return normalizeWhitespace(example.raw);
    }
  }

  return null;
}

function getSenseExample(sense) {
  if (!sense || typeof sense !== "object") {
    return null;
  }

  const exampleCollections = [
    Array.isArray(sense.examples) ? sense.examples : [],
    Array.isArray(sense.usage_examples) ? sense.usage_examples : [],
    Array.isArray(sense.quotations) ? sense.quotations : [],
  ];

  for (const collection of exampleCollections) {
    const example = collection.map(extractLookupExample).find(Boolean);
    if (example) {
      return example;
    }
  }

  return null;
}

function extractLookupResultFromEntries(entries, fallbackWord) {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    for (const sense of senses) {
      if (!sense || typeof sense !== "object") {
        continue;
      }

      const definition =
        Array.isArray(sense.glosses) && typeof sense.glosses[0] === "string"
          ? normalizeWhitespace(sense.glosses[0])
          : null;

      if (!definition) {
        continue;
      }

      const example = getSenseExample(sense);

      return {
        word: normalizeLookupWord(entry.word || fallbackWord),
        definition,
        example,
      };
    }
  }

  return {
    word: normalizeLookupWord(fallbackWord),
    definition: null,
    example: null,
  };
}

async function fetchWordLookup({ word, targetLanguage }) {
  const normalizedWord = normalizeLookupWord(word);
  if (!normalizedWord) {
    throw new Error("word is required.");
  }

  const languageCode = getTargetLanguageCode(targetLanguage);
  if (!languageCode) {
    throw new Error(`Unsupported lookup language: ${targetLanguage}`);
  }

  const editionsToTry = Array.from(new Set([languageCode, "en"]));
  for (const edition of editionsToTry) {
    const lookupUrl = new URL(
      `https://api.wiktapi.dev/v1/${edition}/word/${encodeURIComponent(normalizedWord)}/definitions`
    );
    lookupUrl.searchParams.set("lang", languageCode);

    const response = await fetch(lookupUrl);
    if (!response.ok) {
      continue;
    }

    const responseJson = await response.json();
    const entries = getWiktApiEntries(responseJson);
    const result = extractLookupResultFromEntries(entries, normalizedWord);
    if (result.definition) {
      return result;
    }
  }

  return {
    word: normalizedWord,
    definition: null,
    example: null,
  };
}

async function synthesizeWordAudio({ word, targetLanguage }) {
  const normalizedWord = normalizeLookupWord(word);
  if (!normalizedWord) {
    throw new Error("word is required.");
  }

  if (!ELEVENLABS_API_KEY) {
    throw new Error("Missing ElevenLabs API key. Set ELEVENLABS_API_KEY or LOCAL_ELEVENLABS_API_KEY.");
  }

  const languageCode = getTargetLanguageCode(targetLanguage);
  if (!languageCode) {
    throw new Error(`Unsupported speech language: ${targetLanguage}`);
  }

  const speechUrl = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`);
  speechUrl.searchParams.set("output_format", "mp3_44100_128");

  const response = await fetch(speechUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: normalizedWord,
      model_id: ELEVENLABS_MODEL_ID,
      language_code: languageCode,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  return {
    audioBase64: Buffer.from(audioBytes).toString("base64"),
    mimeType: response.headers.get("content-type") || "audio/mpeg",
    word: normalizedWord,
  };
}

function normalizeAlignmentEntry(
  entry,
  index,
  sourceTokens,
  targetTokens,
  usedTargetIndexes
) {
  const sourceStart = Number(entry?.sourceStart);
  const sourceEnd = Number(entry?.sourceEnd);
  const targetStart = Number(entry?.targetStart);
  const targetEnd = Number(entry?.targetEnd);

  if (
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    !Number.isInteger(targetStart) ||
    !Number.isInteger(targetEnd)
  ) {
    return null;
  }

  if (
    sourceStart < 0 ||
    sourceEnd < sourceStart ||
    sourceEnd >= sourceTokens.length ||
    targetStart < 0 ||
    targetEnd < targetStart ||
    targetEnd >= targetTokens.length
  ) {
    return null;
  }

  const sourceText = joinTokenText(sourceTokens, sourceStart, sourceEnd);
  const targetText = joinTokenText(targetTokens, targetStart, targetEnd);
  const sourceCount = sourceEnd - sourceStart + 1;
  const targetCount = targetEnd - targetStart + 1;

  if (canonicalizeAlignedText(sourceText) === canonicalizeAlignedText(targetText)) {
    return null;
  }

  // Reject obviously low-quality coarse mappings like "another" -> "otro miembro del ...".
  if (sourceCount === 1 && targetCount > 1) {
    return null;
  }

  for (let tokenIndex = targetStart; tokenIndex <= targetEnd; tokenIndex += 1) {
    if (usedTargetIndexes.has(tokenIndex)) {
      return null;
    }
  }

  for (let tokenIndex = targetStart; tokenIndex <= targetEnd; tokenIndex += 1) {
    usedTargetIndexes.add(tokenIndex);
  }

  return {
    id: `alignment-${index + 1}`,
    sourceStart,
    sourceEnd,
    targetStart,
    targetEnd,
    sourceText,
    targetText,
  };
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

async function handleDashboardRequest({
  request,
  response,
  pathname,
  requestUrl,
  requestOrigin,
}) {
  if (request.method === "OPTIONS") {
    sendDashboardNoContent(response, requestOrigin);
    return true;
  }

  if (pathname === "/dashboard/auth/google" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const verifiedUser = await verifyGoogleDashboardCredential({
        accessToken: body?.accessToken,
        idToken: body?.idToken,
      });

      setDashboardSessionCookie(response, verifiedUser.email);
      sendDashboardJson(response, requestOrigin, 200, {
        ok: true,
        session: {
          email: verifiedUser.email,
        },
      });
    } catch (error) {
      sendDashboardJson(response, requestOrigin, 401, {
        error: error?.message ?? "Google sign-in failed.",
      });
    }

    return true;
  }

  if (pathname === "/dashboard/auth/me" && request.method === "GET") {
    const session = getDashboardSessionOrReject(request, response, requestOrigin);
    if (!session) {
      return true;
    }

    sendDashboardJson(response, requestOrigin, 200, {
      session: {
        email: session.email,
      },
    });
    return true;
  }

  if (pathname === "/dashboard/auth/logout" && request.method === "POST") {
    clearDashboardSessionCookie(response);
    sendDashboardJson(response, requestOrigin, 200, {
      ok: true,
    });
    return true;
  }

  const session = getDashboardSessionOrReject(request, response, requestOrigin);
  if (!session) {
    return true;
  }

  if (pathname === "/dashboard/languages" && request.method === "GET") {
    sendDashboardJson(response, requestOrigin, 200, {
      languages: getDashboardLanguages(),
    });
    return true;
  }

  if (pathname === "/dashboard/settings" && request.method === "GET") {
    const settings = await getDashboardSettings({
      userEmail: session.email,
    });

    sendDashboardJson(response, requestOrigin, 200, {
      settings,
    });
    return true;
  }

  if (pathname === "/dashboard/settings" && request.method === "PUT") {
    const body = await readJsonBody(request);
    const settings = await upsertDashboardSettings({
      userEmail: session.email,
      settings: sanitizeDashboardSettings(body?.settings),
    });

    sendDashboardJson(response, requestOrigin, 200, {
      settings,
    });
    return true;
  }

  if (pathname === "/dashboard/overview" && request.method === "GET") {
    const range = String(requestUrl.searchParams.get("range") ?? "30d");
    const settings = await getDashboardSettings({
      userEmail: session.email,
    });
    const overview = await getDashboardOverview({
      userEmail: session.email,
      range: ["7d", "30d", "90d", "all"].includes(range) ? range : "30d",
      settings,
    });

    sendDashboardJson(response, requestOrigin, 200, {
      overview,
    });
    return true;
  }

  if (pathname === "/dashboard/vocabulary" && request.method === "GET") {
    const settings = await getDashboardSettings({
      userEmail: session.email,
    });
    const entries = await getDashboardVocabularyEntries({
      userEmail: session.email,
      settings,
      filters: {
        searchQuery: requestUrl.searchParams.get("searchQuery") ?? "",
        languageCode: requestUrl.searchParams.get("languageCode") ?? "all",
        level: requestUrl.searchParams.get("level") ?? "all",
        status: requestUrl.searchParams.get("status") ?? "all",
        sortBy: requestUrl.searchParams.get("sortBy") ?? "dateDiscovered",
        sortDirection: requestUrl.searchParams.get("sortDirection") ?? "desc",
      },
    });

    sendDashboardJson(response, requestOrigin, 200, {
      entries,
    });
    return true;
  }

  if (pathname === "/dashboard/semantic-map" && request.method === "GET") {
    sendDashboardJson(response, requestOrigin, 200, {
      snapshot: null,
      message: "Semantic graph data is not available from the backend yet.",
    });
    return true;
  }

  sendDashboardJson(response, requestOrigin, 404, {
    error: "Dashboard route not found.",
  });
  return true;
}

async function requestOpenAIJson(prompt, payload) {
  if (!openAIClient) {
    throw new Error("Missing OpenAI API key. Set OPENAI_API_KEY or LOCAL_OPENAI_API_KEY.");
  }

  logServerEvent("openai-json-request-start", {
    model: OPENAI_MODEL,
    promptLength: prompt.length,
    payloadLength: payload.length,
  });

  const response = await openAIClient.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: payload },
    ],
  });

  const responseText = extractOpenAIText(response.choices?.[0]?.message?.content);
  logServerEvent("openai-json-request-success", {
    model: OPENAI_MODEL,
    responseLength: responseText.length,
  });
  return responseText;
}

async function requestOpenAIJsonWithRetries(prompt, payload) {
  let attempt = 0;

  while (attempt < MAX_TRANSLATION_ATTEMPTS) {
    attempt += 1;

    try {
      return await requestOpenAIJson(prompt, payload);
    } catch (error) {
      const retryableError = toRetryableTranslationError(error);
      const canRetry = retryableError && attempt < MAX_TRANSLATION_ATTEMPTS;

      logServerEvent("openai-json-request-error", {
        attempt,
        canRetry: Boolean(canRetry),
        retryDelayMs: retryableError?.retryDelayMs ?? null,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
        errorStatus: error?.status ?? null,
      });

      if (!canRetry) {
        throw retryableError ?? error;
      }

      await delay(retryableError.retryDelayMs);
    }
  }

  throw new Error("Alignment request failed.");
}

function buildTranslationFromParsed(parsedTranslation, segments) {
  return {
    html: reconstructHtmlFromParsedMarkers(parsedTranslation.tree, segments),
    text: buildPlainTextFromParsedMarkers(parsedTranslation.tree),
    markerizedText: parsedTranslation.normalizedText,
    alignments: [],
  };
}

function expandAlignmentRecord(alignment, sourceTokens, targetTokens) {
  if (!alignment) {
    return [];
  }

  const sourceCount = alignment.sourceEnd - alignment.sourceStart + 1;
  const targetCount = alignment.targetEnd - alignment.targetStart + 1;
  if (sourceCount <= 1 && targetCount <= 1) {
    return [alignment];
  }

  if (sourceCount === targetCount) {
    return Array.from({ length: sourceCount }, (_, offset) =>
      buildAlignmentRecord(
        `${alignment.id}-${offset + 1}`,
        sourceTokens,
        targetTokens,
        alignment.sourceStart + offset,
        alignment.sourceStart + offset,
        alignment.targetStart + offset,
        alignment.targetStart + offset
      )
    ).filter(Boolean);
  }

  // When the token counts do not match, keep compact phrase alignments for
  // compressed/expanded expressions like "en marzo de" -> "March" or
  // "otro miembro" -> "other member".
  if (sourceCount === 1 || targetCount === 1 || Math.max(sourceCount, targetCount) <= 3) {
    return [alignment];
  }

  // For larger uneven spans, emit one alignment per target token using a
  // monotonic proportional mapping into the source span. This keeps underline
  // coverage complete while avoiding large shared phrase tooltips.
  return Array.from({ length: targetCount }, (_, targetOffset) => {
    const targetIndex = alignment.targetStart + targetOffset;
    const sourceOffset =
      targetCount === 1
        ? 0
        : Math.round((targetOffset * Math.max(0, sourceCount - 1)) / Math.max(1, targetCount - 1));
    const sourceIndex = alignment.sourceStart + Math.min(sourceOffset, sourceCount - 1);

    return buildAlignmentRecord(
      `${alignment.id}-${targetOffset + 1}`,
      sourceTokens,
      targetTokens,
      sourceIndex,
      sourceIndex,
      targetIndex,
      targetIndex
    );
  }).filter(Boolean);
}

async function buildModelAlignments({ sourceTokens, targetTokens, targetLanguage }) {
  const prompt = buildAlignmentPrompt(targetLanguage);
  const payload = JSON.stringify({
    sourceTokens: sourceTokens.map((token) => token.text),
    targetTokens: targetTokens.map((token) => token.text),
  });
  const responseText = await requestGemmaJsonWithRetries(prompt, payload);
  const responseJson = parseJsonResponse(responseText);
  const rawAlignments = Array.isArray(responseJson?.alignments) ? responseJson.alignments : [];
  const usedTargetIndexes = new Set();

  const sortedAlignments = [...rawAlignments].sort((left, right) => {
    const leftTargetCount = Number(left?.targetEnd) - Number(left?.targetStart);
    const rightTargetCount = Number(right?.targetEnd) - Number(right?.targetStart);
    if (leftTargetCount !== rightTargetCount) {
      return leftTargetCount - rightTargetCount;
    }

    const leftSourceCount = Number(left?.sourceEnd) - Number(left?.sourceStart);
    const rightSourceCount = Number(right?.sourceEnd) - Number(right?.sourceStart);
    return leftSourceCount - rightSourceCount;
  });

  return sortedAlignments
    .map((entry, index) =>
      normalizeAlignmentEntry(entry, index, sourceTokens, targetTokens, usedTargetIndexes)
    )
    .flatMap((alignment) => expandAlignmentRecord(alignment, sourceTokens, targetTokens))
    .filter(Boolean);
}

async function buildTranslationAlignments({ sourceText, translatedText, targetLanguage }) {
  const sourceTokens = tokenizeWords(sourceText);
  const targetTokens = tokenizeWords(translatedText);

  if (sourceTokens.length === 0 || targetTokens.length === 0) {
    return [];
  }

  logServerEvent("alignment-start", {
    targetLanguage,
    sourceTokenCount: sourceTokens.length,
    targetTokenCount: targetTokens.length,
    strategy: "gemini-json-with-deterministic-fallback",
  });

  try {
    const modelAlignments = await buildModelAlignments({
      sourceTokens,
      targetTokens,
      targetLanguage,
    });

    if (modelAlignments.length > 0) {
      logServerEvent("alignment-success", {
        targetLanguage,
        sourceTokenCount: sourceTokens.length,
        targetTokenCount: targetTokens.length,
        alignmentCount: modelAlignments.length,
        strategy: "gemini-json",
      });

      return modelAlignments;
    }

    logServerEvent("alignment-model-empty-fallback", {
      targetLanguage,
      sourceTokenCount: sourceTokens.length,
      targetTokenCount: targetTokens.length,
    });
  } catch (error) {
    logServerEvent("alignment-model-error-fallback", {
      targetLanguage,
      errorName: error?.name ?? null,
      errorMessage: error?.message ?? String(error),
    });
  }

  const normalizedAlignments = buildDeterministicAlignments(sourceTokens, targetTokens);

  logServerEvent("alignment-success", {
    targetLanguage,
    sourceTokenCount: sourceTokens.length,
    targetTokenCount: targetTokens.length,
    alignmentCount: normalizedAlignments.length,
    strategy: "deterministic-changed-runs",
  });

  return normalizedAlignments;
}

function writeStreamEvent(response, payload) {
  response.write(`${JSON.stringify(payload)}\n`);
}

function beginTranslationStream(response) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
}

async function requestOpenAIStream(prompt, text) {
  if (!openAIClient) {
    throw new Error("Missing OpenAI API key. Set OPENAI_API_KEY or LOCAL_OPENAI_API_KEY.");
  }

  logServerEvent("openai-stream-request-start", {
    model: OPENAI_MODEL,
    promptLength: prompt.length,
    textLength: text.length,
  });

  const streamResult = await openAIClient.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    stream: true,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ],
  });

  logServerEvent("openai-stream-request-opened", {
    model: OPENAI_MODEL,
  });

  return streamResult;
}

async function streamTranslatedParagraph({
  splitText,
  targetLanguage,
  settings,
  priorityWords,
  onChunk,
}) {
  const { markerizedText, segments } = buildMarkerizedTextFromSplitText(splitText);
  if (!markerizedText) {
    throw new Error("Paragraph did not contain any translatable text.");
  }

  const prompt = buildTranslationPrompt(targetLanguage, settings, priorityWords);
  let attempt = 0;

  logServerEvent("translation-start", {
    targetLanguage,
    segmentCount: segments.length,
    markerizedLength: markerizedText.length,
  });

  while (attempt < MAX_TRANSLATION_ATTEMPTS) {
    attempt += 1;

    let streamedMarkerizedText = "";
    let lastSentMarkerizedText = "";
    let chunkCount = 0;

    try {
      logServerEvent("translation-attempt-start", {
        attempt,
        maxAttempts: MAX_TRANSLATION_ATTEMPTS,
        targetLanguage,
      });

      const streamResult = await requestOpenAIStream(prompt, markerizedText);

      for await (const responseChunk of streamResult) {
        const chunkText = extractOpenAIText(responseChunk.choices?.[0]?.delta?.content);
        if (!chunkText) {
          continue;
        }

        chunkCount += 1;
        streamedMarkerizedText += chunkText;
        const parsedChunk = parseTranslatedMarkerizedText(streamedMarkerizedText, segments);
        if (!parsedChunk.ok) {
          logServerEvent("translation-marker-parse-error", {
            attempt,
            chunkCount,
            error: parsedChunk.error,
            streamedLength: streamedMarkerizedText.length,
            action: "wait-for-more-stream-content",
          });
          continue;
        }

        if (
          parsedChunk.normalizedText &&
          parsedChunk.normalizedText !== lastSentMarkerizedText
        ) {
          lastSentMarkerizedText = parsedChunk.normalizedText;
          logServerEvent("translation-chunk-emitted", {
            attempt,
            chunkCount,
            emittedLength: parsedChunk.normalizedText.length,
            complete: parsedChunk.complete,
          });
          onChunk?.(buildTranslationFromParsed(parsedChunk, segments));
        }
      }

      const parsedTranslation = parseTranslatedMarkerizedText(streamedMarkerizedText, segments);
      if (!parsedTranslation.ok) {
        logServerEvent("translation-final-parse-error", {
          attempt,
          chunkCount,
          error: parsedTranslation.error,
        });
        throw new MarkerValidationError(parsedTranslation.error);
      }

      if (!parsedTranslation.complete) {
        logServerEvent("translation-incomplete-output", {
          attempt,
          chunkCount,
          finalLength: parsedTranslation.normalizedText.length,
        });
        throw new MarkerValidationError("Model returned incomplete marker output.");
      }

      logServerEvent("translation-attempt-success", {
        attempt,
        chunkCount,
        finalLength: parsedTranslation.normalizedText.length,
      });
      return buildTranslationFromParsed(parsedTranslation, segments);
    } catch (error) {
      const retryableError = toRetryableTranslationError(error);
      const canRetry =
        retryableError &&
        attempt < MAX_TRANSLATION_ATTEMPTS &&
        !lastSentMarkerizedText;

      logServerEvent("translation-attempt-error", {
        attempt,
        chunkCount,
        canRetry: Boolean(canRetry),
        retryDelayMs: retryableError?.retryDelayMs ?? null,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
        errorStatus: error?.status ?? null,
        errorDetails: error?.errorDetails ?? null,
      });

      if (!canRetry) {
        throw retryableError ?? error;
      }

      logServerEvent("translation-attempt-retrying", {
        attempt,
        retryDelayMs: retryableError.retryDelayMs,
      });
      await delay(retryableError.retryDelayMs);
    }
  }

  logServerEvent("translation-failed", {
    targetLanguage,
    maxAttempts: MAX_TRANSLATION_ATTEMPTS,
  });
  throw new Error("Translation failed.");
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
  }

  const requestUrl = getRequestUrl(request);
  const pathname = requestUrl.pathname;
  const requestOrigin = request.headers.origin;

  if (pathname.startsWith("/dashboard/")) {
    try {
      const handledDashboardRequest = await handleDashboardRequest({
        request,
        response,
        pathname,
        requestUrl,
        requestOrigin,
      });

      if (handledDashboardRequest) {
        return;
      }
    } catch (error) {
      sendDashboardJson(response, requestOrigin, 500, {
        error: error?.message ?? "Dashboard request failed.",
      });
      return;
    }
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (pathname === "/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, mongoEnabled: hasMongoConfig() });
    return;
  }

  if (request.url === "/embed" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const userEmail = String(body?.userEmail ?? "").trim();
      const word = String(body?.word ?? "").trim();
      const targetLanguage = normalizeTargetLanguage(body?.targetLanguage);
      logServerEvent("embed-request-received", {
        hasUserEmail: Boolean(userEmail),
        hasWord: Boolean(word),
        hasTargetLanguage: Boolean(targetLanguage),
        word,
        targetLanguage,
      });

      if (!userEmail || !word || !targetLanguage) {
        logServerEvent("embed-request-invalid", {
          hasUserEmail: Boolean(userEmail),
          hasWord: Boolean(word),
          hasTargetLanguage: Boolean(targetLanguage),
        });
        sendJson(response, 400, { error: "userEmail, word, and targetLanguage are required." });
        return;
      }

      if (!openAIClient) {
        logServerEvent("embed-openai-misconfigured", {});
        sendJson(response, 500, {
          error: "Missing OpenAI API key. Set OPENAI_API_KEY or LOCAL_OPENAI_API_KEY.",
        });
        return;
      }

      if (!hasMongoConfig()) {
        logServerEvent("embed-mongo-misconfigured", {});
        sendJson(response, 500, {
          error: "Missing MongoDB configuration. Embeddings storage is unavailable.",
        });
        return;
      }

      const existingEmbedding = await findStoredWordEmbedding({
        userEmail,
        word,
        targetLanguage,
      });

      if (existingEmbedding?.embedding) {
        logServerEvent("embed-cache-hit", {
          word,
          targetLanguage,
          userEmail,
        });
        sendJson(response, 200, {
          ok: true,
          cached: true,
          embedding: existingEmbedding.embedding,
          word: existingEmbedding.word ?? word,
          targetLanguage: existingEmbedding.targetLanguage ?? targetLanguage,
          userEmail: existingEmbedding.userEmail ?? userEmail,
        });
        return;
      }

      const embeddingResponse = await openAIClient.embeddings.create({
        model: "text-embedding-3-small",
        input: [word],
      });
      const embedding = embeddingResponse?.data?.[0]?.embedding;
      logServerEvent("embed-openai-response", {
        word,
        targetLanguage,
        embeddingLength: Array.isArray(embedding) ? embedding.length : 0,
      });

      if (!Array.isArray(embedding) || embedding.length === 0) {
        logServerEvent("embed-openai-empty", {
          word,
          targetLanguage,
        });
        sendJson(response, 500, { error: "Embedding request returned no embedding." });
        return;
      }

      const storeResult = await storeWordEmbedding({
        userEmail,
        word,
        targetLanguage,
        embedding,
      });

      logServerEvent("embed-store-result", {
        word,
        targetLanguage,
        userEmail,
        ...storeResult,
      });

      if (!storeResult.ok) {
        sendJson(response, 500, {
          error: "Embedding was created but could not be stored.",
          storeResult,
        });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        cached: false,
        embedding,
        word,
        targetLanguage,
        userEmail,
      });
    } catch (error) {
      logServerEvent("embed-request-failed", {
        errorMessage: error?.message ?? String(error),
        errorStack: error?.stack ?? null,
      });
      sendJson(response, 500, {
        error: error?.message ?? String(error),
      });
    }
    return;
  }

  if (request.url === "/word-feedback" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const result = await recordWordFeedback({
        userEmail: body?.userEmail,
        targetLanguage: body?.targetLanguage,
        sourceTerm: body?.sourceTerm,
      });

      if (!result.ok && !result.disabled) {
        sendJson(response, 400, { error: "userEmail, targetLanguage, and sourceTerm are required." });
        return;
      }

      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, {
        error: error?.message ?? String(error),
      });
    }
    return;
  }

  if (request.url === "/language-exp" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const result = await recordLanguageExp({
        userEmail: body?.userEmail,
        targetLanguage: body?.targetLanguage,
        expAmount: body?.expAmount,
      });

      if (!result.ok && !result.disabled) {
        sendJson(response, 400, { error: "userEmail, targetLanguage, and expAmount are required." });
        return;
      }

      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, {
        error: error?.message ?? String(error),
      });
    }
    return;
  }

  if (request.url === "/language-profile" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const userEmail = String(body?.userEmail ?? "").trim();
      const targetLanguage = String(body?.targetLanguage ?? "").trim();

      if (!userEmail || !targetLanguage) {
        sendJson(response, 400, { error: "userEmail and targetLanguage are required." });
        return;
      }

      const userExp = await getUserLanguageExp({
        userEmail,
        targetLanguage,
      });
      const exp = userExp ?? 0;
      const translationLevel = getTranslationLevelForExp(exp);

      sendJson(response, 200, {
        ok: true,
        profile: {
          exp,
          translationLevel,
        },
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error?.message ?? String(error),
      });
    }
    return;
  }

  if (request.url === "/lookup-word" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const word = String(body?.word ?? "").trim();
      const targetLanguage = String(body?.targetLanguage ?? "").trim();

      if (!word) {
        sendJson(response, 400, { error: "word is required." });
        return;
      }

      if (!targetLanguage) {
        sendJson(response, 400, { error: "targetLanguage is required." });
        return;
      }

      const lookup = await fetchWordLookup({ word, targetLanguage });
      sendJson(response, 200, { lookup });
      return;
    } catch (error) {
      logServerEvent("lookup-word-error", {
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
      });
      sendJson(response, 500, { error: error?.message ?? "Word lookup failed." });
      return;
    }
  }

  if (pathname === "/speak-word" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const word = String(body?.word ?? "").trim();
      const targetLanguage = String(body?.targetLanguage ?? "").trim();

      if (!word) {
        sendJson(response, 400, { error: "word is required." });
        return;
      }

      if (!targetLanguage) {
        sendJson(response, 400, { error: "targetLanguage is required." });
        return;
      }

      const speech = await synthesizeWordAudio({ word, targetLanguage });
      sendJson(response, 200, { speech });
      return;
    } catch (error) {
      logServerEvent("speak-word-error", {
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
      });
      sendJson(response, 500, { error: error?.message ?? "Word speech failed." });
      return;
    }
  }

  if (pathname !== "/translate" || request.method !== "POST") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const splitText = body?.splitText;
    const rawText = body?.rawText;
    const targetLanguage = String(body?.targetLanguage ?? "").trim();
    const userEmail = String(body?.userEmail ?? "").trim();
    if (!Array.isArray(splitText)) {
      sendJson(response, 400, { error: "splitText is required." });
      return;
    }

    if (!targetLanguage) {
      sendJson(response, 400, { error: "targetLanguage is required." });
      return;
    }

    const sourceText = rawText || buildRawTextFromSplitText(splitText);
    if (!sourceText) {
      sendJson(response, 400, { error: "No text available for translation." });
      return;
    }

    const userExp = await getUserLanguageExp({
      userEmail,
      targetLanguage,
    });
    const effectiveTranslationLevel =
      userExp === null
        ? String(body?.translationLevel ?? "")
        : getTranslationLevelForExp(userExp);
    const normalizedSettings = normalizeSettings({
      selectedLanguage: targetLanguage,
      translationLevel: effectiveTranslationLevel,
    });

    logServerEvent("http-translate-request", {
      method: request.method,
      url: request.url,
      targetLanguage,
      userEmailPresent: Boolean(userEmail),
      userExp,
      splitTextCount: Array.isArray(splitText) ? splitText.length : null,
      rawTextLength: typeof rawText === "string" ? rawText.length : null,
      requestedTranslationLevel: body?.translationLevel ?? null,
      effectiveTranslationLevel: normalizedSettings.translationLevel,
      phraseMinWords: normalizedSettings.phraseMinWords,
      phraseMaxWords: normalizedSettings.phraseMaxWords,
      phraseCoveragePercent: normalizedSettings.phraseCoveragePercent,
      phraseLengthTemperature: normalizedSettings.phraseLengthTemperature,
    });

    const priorityWords = await getPriorityWordsForPrompt({
      userEmail,
      targetLanguage,
      sourceText,
    });

    beginTranslationStream(response);

    const translation = await streamTranslatedParagraph({
      splitText,
      targetLanguage,
      settings: normalizedSettings,
      priorityWords,
      onChunk(partialTranslation) {
        logServerEvent("http-translate-stream-chunk", {
          targetLanguage,
          htmlLength: partialTranslation.html.length,
          textLength: partialTranslation.text.length,
        });
        writeStreamEvent(response, {
          type: "chunk",
          sourceText,
          translation: partialTranslation,
        });
      },
    });

    try {
      translation.alignments = await buildTranslationAlignments({
        sourceText,
        translatedText: translation.text,
        targetLanguage,
      });
    } catch (alignmentError) {
      translation.alignments = [];
      logServerEvent("alignment-error", {
        targetLanguage,
        errorName: alignmentError?.name ?? null,
        errorMessage: alignmentError?.message ?? String(alignmentError),
      });
    }

    const translatedWordCount = countTranslatedSourceWords(translation.alignments);
    if (userEmail && translatedWordCount > 0) {
      try {
        const expResult = await recordTranslatedWordExp({
          userEmail,
          targetLanguage,
          translatedWordCount,
        });

        logServerEvent("translation-exp-recorded", {
          targetLanguage,
          userEmailPresent: true,
          translatedWordCount,
          expAdded: expResult.expAdded,
        });
      } catch (expError) {
        logServerEvent("translation-exp-record-error", {
          targetLanguage,
          translatedWordCount,
          errorName: expError?.name ?? null,
          errorMessage: expError?.message ?? String(expError),
        });
      }
    }

    writeStreamEvent(response, {
      type: "done",
      sourceText,
      translation,
    });
    logServerEvent("http-translate-stream-done", {
      targetLanguage,
      htmlLength: translation.html.length,
      textLength: translation.text.length,
    });
    response.end();
  } catch (error) {
    console.error("[translation-server] Translation request failed:", error);

    if (response.headersSent) {
      logServerEvent("http-translate-stream-error", {
        targetLanguage: null,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error),
        retryAfterMs:
          error instanceof RetryableTranslationError ? error.retryDelayMs : null,
      });
      writeStreamEvent(response, {
        type: "error",
        error:
          error instanceof MarkerValidationError
            ? `Model returned invalid marker output: ${error.message}`
            : error.message,
        retryAfterMs:
          error instanceof RetryableTranslationError ? error.retryDelayMs : null,
      });
      response.end();
      return;
    }

    logServerEvent("http-translate-request-error", {
      errorName: error?.name ?? null,
      errorMessage: error?.message ?? String(error),
      retryAfterMs:
        error instanceof RetryableTranslationError ? error.retryDelayMs : null,
    });
    sendJson(response, error instanceof MarkerValidationError ? 422 : 500, {
      error:
        error instanceof MarkerValidationError
          ? `Model returned invalid marker output: ${error.message}`
          : error.message,
      retryAfterMs:
        error instanceof RetryableTranslationError ? error.retryDelayMs : null,
    });
  }
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Language Extension backend listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
