import http from "node:http";
import {
  ASI_ONE_API_KEY,
  ASI_ONE_MODEL,
  LOCAL_GEMMA_API_KEY,
  SERVER_PORT,
} from "./local-config.js";
import {
  GEMMA_MODEL,
  KNOWLEDGE_LEVEL_TO_RATIO,
} from "../src/shared/settings.js";

const GEMMA_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent`;
const ASI_ONE_ENDPOINT = "https://api.asi1.ai/v1/chat/completions";
const SERVER_HOST = "127.0.0.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const MAX_SELECTOR_ATTEMPTS = 2;
const FALLBACK_RETRY_DELAY_MS = 60_000;
const INTER_REQUEST_DELAY_MS = 1_500;
const translationCache = new Map();
let translationQueue = Promise.resolve();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function enqueueTranslation(task) {
  const queuedTask = translationQueue.catch(() => {}).then(task);
  translationQueue = queuedTask.catch(() => {}).then(() => delay(INTER_REQUEST_DELAY_MS));
  return queuedTask;
}

function parseRetryDelayMs(retryDelay) {
  if (typeof retryDelay !== "string") {
    return null;
  }

  const seconds = Number.parseFloat(retryDelay.replace(/s$/, ""));
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.ceil(seconds * 1000);
}

function getRetryDelayMs(statusCode, responseJson, responseHeaders) {
  const retryAfterHeader = responseHeaders.get("retry-after");
  if (retryAfterHeader) {
    const retryAfterSeconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds)) {
      return Math.ceil(retryAfterSeconds * 1000);
    }
  }

  const retryInfo = responseJson?.error?.details?.find(
    (detail) => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );
  const retryDelayMs = parseRetryDelayMs(retryInfo?.retryDelay);
  if (retryDelayMs) {
    return retryDelayMs;
  }

  if (statusCode === 429) {
    return FALLBACK_RETRY_DELAY_MS;
  }

  return null;
}

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function extractGemmaText(responseJson) {
  return normalizeWhitespace(
    responseJson?.candidates?.[0]?.content?.parts
      ?.map((part) => String(part?.text ?? ""))
      .join("")
  );
}

class RetryableTranslationError extends Error {
  constructor(message, retryDelayMs) {
    super(message);
    this.name = "RetryableTranslationError";
    this.retryDelayMs = retryDelayMs;
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

async function requestGemma(prompt) {
  const response = await fetch(
    `${GEMMA_ENDPOINT}?key=${encodeURIComponent(LOCAL_GEMMA_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryDelayMs = getRetryDelayMs(response.status, responseJson, response.headers);
    const message =
      responseJson?.error?.message ||
      `Gemma request failed with status ${response.status}.`;

    if (retryDelayMs) {
      throw new RetryableTranslationError(message, retryDelayMs);
    }

    throw new Error(message);
  }

  const translatedText = extractGemmaText(responseJson);
  if (!translatedText) {
    throw new Error("Gemma returned an empty translation.");
  }

  return translatedText;
}

async function requestGemmaWithRetries(prompt) {
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_TRANSLATION_ATTEMPTS) {
    attempt += 1;

    try {
      return await requestGemma(prompt);
    } catch (error) {
      lastError = error;

      if (!(error instanceof RetryableTranslationError) || attempt >= MAX_TRANSLATION_ATTEMPTS) {
        break;
      }

      await delay(error.retryDelayMs);
    }
  }

  throw lastError ?? new Error("Translation failed.");
}

function buildPhraseTranslationPrompt({ phraseText, contextSentence, targetLanguage }) {
  return [
    `Translate the phrase into ${targetLanguage}.`,
    "Use the context sentence only to disambiguate meaning.",
    "Return only the translated phrase.",
    "Do not include quotation marks, notes, alternatives, or explanations.",
    `Phrase: ${JSON.stringify(phraseText)}`,
    `Context: ${JSON.stringify(contextSentence)}`,
  ].join("\n");
}

async function translatePhrase({ phraseText, contextSentence, targetLanguage }) {
  const prompt = buildPhraseTranslationPrompt({
    phraseText,
    contextSentence,
    targetLanguage,
  });

  return enqueueTranslation(() => requestGemmaWithRetries(prompt));
}

function getSelectionRatio(readerKnowledgeLevel) {
  return KNOWLEDGE_LEVEL_TO_RATIO[readerKnowledgeLevel] ?? KNOWLEDGE_LEVEL_TO_RATIO[1];
}

function getSelectionCount(totalCandidates, readerKnowledgeLevel) {
  if (totalCandidates <= 0) return 0;
  return Math.max(1, Math.round(totalCandidates * getSelectionRatio(readerKnowledgeLevel)));
}

function rankCandidateHeuristically(candidate) {
  const text = normalizeWhitespace(candidate?.text);
  const words = text ? text.split(/\s+/) : [];
  const avgWordLength =
    words.length > 0
      ? words.reduce((sum, word) => sum + word.length, 0) / words.length
      : 0;
  const hasCapitalizedWord = words.some((word) => /^[A-Z]/.test(word));
  const hasHyphen = text.includes("-") || text.includes("—");

  return avgWordLength + words.length * 0.75 + (hasCapitalizedWord ? 1.5 : 0) + (hasHyphen ? 0.5 : 0);
}

function selectHeuristically(candidates, selectionCount) {
  return [...candidates]
    .sort((left, right) => rankCandidateHeuristically(right) - rankCandidateHeuristically(left))
    .slice(0, selectionCount)
    .map((candidate) => candidate.id);
}

function buildSelectorPrompt({ candidates, readerKnowledgeLevel, selectionCount }) {
  const ratio = getSelectionRatio(readerKnowledgeLevel);

  return [
    "Select the phrases that should be translated for a language learner.",
    `Reader knowledge level: ${readerKnowledgeLevel}.`,
    `Select exactly ${selectionCount} phrase ids.`,
    `This corresponds to about ${Math.round(ratio * 100)}% of the candidate phrases.`,
    "Prefer phrases that are likely informative, moderately difficult, and useful for learning in context.",
    "Avoid selecting extremely trivial function-word phrases unless there are no better options.",
    "Return only ids from the provided list.",
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join("\n");
}

async function requestAsiOneSelection({ candidates, readerKnowledgeLevel, selectionCount }) {
  const response = await fetch(ASI_ONE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ASI_ONE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ASI_ONE_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are selecting which webpage phrases to translate for a language-learning browser extension. Follow the schema exactly.",
        },
        {
          role: "user",
          content: buildSelectorPrompt({
            candidates,
            readerKnowledgeLevel,
            selectionCount,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "phrase_selection",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              selected_ids: {
                type: "array",
                minItems: selectionCount,
                maxItems: selectionCount,
                items: {
                  type: "string",
                },
              },
            },
            required: ["selected_ids"],
          },
        },
      },
    }),
  });

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      responseJson?.error?.message ||
      responseJson?.message ||
      `ASI:One selection failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("ASI:One returned an empty selection payload.");
  }

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed?.selected_ids)) {
    throw new Error("ASI:One returned an invalid selection payload.");
  }

  return parsed.selected_ids;
}

async function selectCandidateIds({ candidates, readerKnowledgeLevel }) {
  const selectionCount = getSelectionCount(candidates.length, readerKnowledgeLevel);
  if (selectionCount === 0) {
    return {
      selectedIds: [],
      selectionMode: "none",
    };
  }

  if (!ASI_ONE_API_KEY) {
    return {
      selectedIds: selectHeuristically(candidates, selectionCount),
      selectionMode: "heuristic",
    };
  }

  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_SELECTOR_ATTEMPTS) {
    attempt += 1;

    try {
      const selectedIds = await requestAsiOneSelection({
        candidates,
        readerKnowledgeLevel,
        selectionCount,
      });
      const knownIds = new Set(candidates.map((candidate) => candidate.id));
      const dedupedIds = [];

      for (const id of selectedIds) {
        if (!knownIds.has(id) || dedupedIds.includes(id)) continue;
        dedupedIds.push(id);
      }

      if (dedupedIds.length >= selectionCount) {
        return {
          selectedIds: dedupedIds.slice(0, selectionCount),
          selectionMode: "asi1",
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn("Falling back to heuristic phrase selection:", lastError);
  }

  return {
    selectedIds: selectHeuristically(candidates, selectionCount),
    selectionMode: "heuristic",
  };
}

function buildTranslationCacheKey({
  pageUrl,
  targetLanguage,
  readerKnowledgeLevel,
  phraseText,
}) {
  return JSON.stringify([
    pageUrl,
    targetLanguage,
    readerKnowledgeLevel,
    normalizeWhitespace(phraseText).toLowerCase(),
  ]);
}

async function getTranslatedPhrase({
  pageUrl,
  targetLanguage,
  readerKnowledgeLevel,
  phraseText,
  contextSentence,
}) {
  const cacheKey = buildTranslationCacheKey({
    pageUrl,
    targetLanguage,
    readerKnowledgeLevel,
    phraseText,
  });

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const translatedText = await translatePhrase({
    phraseText,
    contextSentence,
    targetLanguage,
  });
  translationCache.set(cacheKey, translatedText);
  return translatedText;
}

function validateCandidates(candidates) {
  return Array.isArray(candidates)
    ? candidates.filter(
        (candidate) =>
          candidate &&
          typeof candidate.id === "string" &&
          typeof candidate.text === "string" &&
          normalizeWhitespace(candidate.text) &&
          typeof candidate.contextSentence === "string"
      )
    : [];
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
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

  if (request.url === "/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.url !== "/select-and-translate" || request.method !== "POST") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const pageUrl = String(body?.pageUrl ?? "").trim();
    const targetLanguage = String(body?.targetLanguage ?? "").trim();
    const readerKnowledgeLevel = Number(body?.readerKnowledgeLevel ?? 1);
    const candidates = validateCandidates(body?.candidates);

    if (!pageUrl) {
      sendJson(response, 400, { error: "pageUrl is required." });
      return;
    }

    if (!targetLanguage) {
      sendJson(response, 400, { error: "targetLanguage is required." });
      return;
    }

    if (![1, 2, 3].includes(readerKnowledgeLevel)) {
      sendJson(response, 400, { error: "readerKnowledgeLevel must be 1, 2, or 3." });
      return;
    }

    if (candidates.length === 0) {
      sendJson(response, 200, {
        selectedIds: [],
        translatedPhrases: [],
        selectionMode: "none",
      });
      return;
    }

    const { selectedIds, selectionMode } = await selectCandidateIds({
      candidates,
      readerKnowledgeLevel,
    });
    const selectedIdSet = new Set(selectedIds);
    const selectedCandidates = candidates.filter((candidate) => selectedIdSet.has(candidate.id));

    const translatedPhrases = await Promise.all(
      selectedCandidates.map(async (candidate) => ({
        id: candidate.id,
        translatedText: await getTranslatedPhrase({
          pageUrl,
          targetLanguage,
          readerKnowledgeLevel,
          phraseText: candidate.text,
          contextSentence: candidate.contextSentence,
        }),
      }))
    );

    sendJson(response, 200, {
      selectedIds,
      translatedPhrases,
      selectionMode,
    });
  } catch (error) {
    console.error("Selection and translation request failed:", error);
    sendJson(response, 500, {
      error: error.message,
    });
  }
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Language Extension backend listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
