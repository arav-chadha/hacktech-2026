import http from "node:http";
import { LOCAL_GEMMA_API_KEY, SERVER_PORT } from "./local-config.js";
import {
  GEMMA_MODEL,
  PREPROMPT_BEGINNER,
  PREPROMPT_ELEMENTARY,
  PREPROMPT_SUFFIX,
  normalizeSettings,
} from "../src/shared/settings.js";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import {
  buildMarkerizedTextFromSplitText,
  buildPlainTextFromParsedMarkers,
  buildRawTextFromSplitText,
  parseTranslatedMarkerizedText,
  reconstructHtmlFromParsedMarkers,
} from "../src/shared/translationMarkup.js";

const genAIClient = new GoogleGenerativeAI(LOCAL_GEMMA_API_KEY);

const SERVER_HOST = "127.0.0.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 60_000;
const ALIGNMENT_WORD_PATTERN = /[\p{L}\p{N}\p{M}'’-]+/gu;

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

function logServerEvent(event, details = {}) {
  console.log(`[translation-server] ${event}`, details);
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
  return translationLevel === "elementary" ? PREPROMPT_ELEMENTARY : PREPROMPT_BEGINNER;
}

function buildTranslationPrompt(targetLanguage, settings) {
  const translationLevel = settings?.translationLevel ?? "beginner";
  const minWords = settings?.phraseMinWords ?? 1;
  const maxWords = settings?.phraseMaxWords ?? 4;
  const maxCoveragePercent = settings?.phraseCoveragePercent ?? 16;

  return [
    `Partially translate the input into ${targetLanguage}.`,
    `Translation level: ${translationLevel}.`,
    getLevelPrompt(translationLevel),
    `Each translated span must be between ${minWords} and ${maxWords} words inclusive.`,
    `Never translate more than ${maxWords} consecutive words in any one span.`,
    `Translate at most about ${maxCoveragePercent}% of the words in the paragraph.`,
    "Prefer multiple isolated translated spans instead of one large translated chunk.",
    describeLengthBias(settings?.phraseLengthTemperature ?? 0.5),
    PREPROMPT_SUFFIX,
  ].join("\n");
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
    "Favor the smallest accurate aligned phrase span.",
  ].join("\n");
}

function extractGemmaText(responseJson) {
  return responseJson?.candidates?.[0]?.content?.parts
    ?.map((part) => String(part?.text ?? ""))
    .join("") ?? "";
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

  return alignments;
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
  if (typeof retryDelay !== "string") {
    return null;
  }

  const seconds = Number.parseFloat(retryDelay.replace(/s$/, ""));
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.ceil(seconds * 1000);
}

function getRetryDelayMs(error) {
  const retryInfo = error?.errorDetails?.find(
    (detail) => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );
  const retryDelayMs = parseRetryDelayMs(retryInfo?.retryDelay);
  if (retryDelayMs) {
    return retryDelayMs;
  }

  if (error?.status === 429) {
    return FALLBACK_RETRY_DELAY_MS;
  }

  return null;
}

function toRetryableTranslationError(error) {
  if (!(error instanceof GoogleGenerativeAIFetchError)) {
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

  if (canonicalizeAlignedText(sourceText) === canonicalizeAlignedText(targetText)) {
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

async function requestGemmaJson(prompt, payload) {
  logServerEvent("gemini-json-request-start", {
    model: GEMMA_MODEL,
    promptLength: prompt.length,
    payloadLength: payload.length,
  });

  const model = genAIClient.getGenerativeModel(
    {
      model: GEMMA_MODEL,
      systemInstruction: prompt,
    }
  );
  const generationConfig = {
    temperature: 0,
    responseMimeType: "application/json",
  };

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: payload }] }],
    generationConfig,
  });

  const responseText = response.response.text();
  logServerEvent("gemini-json-request-success", {
    model: GEMMA_MODEL,
    responseLength: responseText.length,
  });
  return responseText;
}

async function requestGemmaJsonWithRetries(prompt, payload) {
  let attempt = 0;

  while (attempt < MAX_TRANSLATION_ATTEMPTS) {
    attempt += 1;

    try {
      return await requestGemmaJson(prompt, payload);
    } catch (error) {
      const retryableError = toRetryableTranslationError(error);
      const canRetry = retryableError && attempt < MAX_TRANSLATION_ATTEMPTS;

      logServerEvent("gemini-json-request-error", {
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
    strategy: "deterministic-changed-runs",
  });

  const normalizedAlignments = buildDeterministicAlignments(sourceTokens, targetTokens);

  logServerEvent("alignment-success", {
    targetLanguage,
    sourceTokenCount: sourceTokens.length,
    targetTokenCount: targetTokens.length,
    alignmentCount: normalizedAlignments.length,
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

async function requestGemmaStream(prompt, text) {
  logServerEvent("gemini-stream-request-start", {
    model: GEMMA_MODEL,
    promptLength: prompt.length,
    textLength: text.length,
  });

  const model = genAIClient.getGenerativeModel(
    {
      model: GEMMA_MODEL,
      systemInstruction: prompt,
    }
  );
  const generationConfig = {
    temperature: 0,
    responseMimeType: "text/plain",
  };

  const streamResult = await model.generateContentStream({
    contents: [{ role: "user", parts: [{ "text": text }] }],
    generationConfig,
  });

  logServerEvent("gemini-stream-request-opened", {
    model: GEMMA_MODEL,
  });

  return streamResult;
}

async function streamTranslatedParagraph({ splitText, targetLanguage, settings, onChunk }) {
  const { markerizedText, segments } = buildMarkerizedTextFromSplitText(splitText);
  if (!markerizedText) {
    throw new Error("Paragraph did not contain any translatable text.");
  }

  const prompt = buildTranslationPrompt(targetLanguage, settings);
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

      const streamResult = await requestGemmaStream(prompt, markerizedText);

      for await (const responseChunk of streamResult.stream) {
        const chunkText = extractGemmaText(responseChunk);
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
          });
          throw new MarkerValidationError(parsedChunk.error);
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

      await streamResult.response;
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

  if (request.url !== "/translate" || request.method !== "POST") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const splitText = body?.splitText;
    const rawText = body?.rawText;
    const targetLanguage = String(body?.targetLanguage ?? "").trim();
    const normalizedSettings = normalizeSettings({
      selectedLanguage: targetLanguage,
      translationLevel: body?.translationLevel,
      phraseMinWords: body?.phraseMinWords,
      phraseMaxWords: body?.phraseMaxWords,
      phraseCoveragePercent: body?.phraseCoveragePercent,
      phraseLengthTemperature: body?.phraseLengthTemperature,
    });

    logServerEvent("http-translate-request", {
      method: request.method,
      url: request.url,
      targetLanguage,
      splitTextCount: Array.isArray(splitText) ? splitText.length : null,
      rawTextLength: typeof rawText === "string" ? rawText.length : null,
      translationLevel: normalizedSettings.translationLevel,
      phraseMinWords: normalizedSettings.phraseMinWords,
      phraseMaxWords: normalizedSettings.phraseMaxWords,
      phraseCoveragePercent: normalizedSettings.phraseCoveragePercent,
      phraseLengthTemperature: normalizedSettings.phraseLengthTemperature,
    });

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

    beginTranslationStream(response);

    const translation = await streamTranslatedParagraph({
      splitText,
      targetLanguage,
      settings: normalizedSettings,
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
