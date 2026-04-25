import http from "node:http";
import { LOCAL_GEMMA_API_KEY, SERVER_PORT } from "./local-config.js";
import { GEMMA_MODEL } from "../src/shared/settings.js";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";
import {
  buildMarkerizedTextFromSplitText,
  buildPlainTextFromParsedMarkers,
  buildRawTextFromSplitText,
  normalizeWhitespace,
  parseTranslatedMarkerizedText,
  reconstructHtmlFromParsedMarkers,
} from "../src/shared/translationMarkup.js";

const genAIClient = new GoogleGenerativeAI(LOCAL_GEMMA_API_KEY);

const SERVER_HOST = "127.0.0.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 60_000;

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

function buildTranslationPrompt(targetLanguage) {
  return [
    `Rewrite input in ${targetLanguage}`,
    "Translate naturally, especially text in markers",
    "Do not surround text w/ * \' or \"",
    "Preserve markers exactly, both open and closed forms",
    "Dont: add remove rename duplicate reorder marker bounds",
    "Keep marker structure identical to input",
    "Return only translated paragraph w/ markers",
    "Do not return markdown code fences notes text or alternatives",
  ].join("\n");
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

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function buildTranslationFromParsed(parsedTranslation, segments) {
  return {
    html: reconstructHtmlFromParsedMarkers(parsedTranslation.tree, segments),
    text: buildPlainTextFromParsedMarkers(parsedTranslation.tree),
    markerizedText: parsedTranslation.normalizedText,
  };
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

async function streamTranslatedParagraph({ splitText, targetLanguage, onChunk }) {
  const { markerizedText, segments } = buildMarkerizedTextFromSplitText(splitText);
  if (!markerizedText) {
    throw new Error("Paragraph did not contain any translatable text.");
  }

  const prompt = buildTranslationPrompt(targetLanguage);
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

    logServerEvent("http-translate-request", {
      method: request.method,
      url: request.url,
      targetLanguage,
      splitTextCount: Array.isArray(splitText) ? splitText.length : null,
      rawTextLength: typeof rawText === "string" ? rawText.length : null,
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
