import http from "node:http";
import { LOCAL_GEMMA_API_KEY, SERVER_PORT } from "./local-config.js";
import { GEMMA_MODEL } from "../src/shared/settings.js";
import {
  buildMarkerizedTextFromSplitText,
  buildPlainTextFromParsedMarkers,
  buildRawTextFromSplitText,
  normalizeWhitespace,
  parseTranslatedMarkerizedText,
  reconstructHtmlFromParsedMarkers,
} from "../src/shared/translationMarkup.js";

const GEMMA_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent`;
const SERVER_HOST = "127.0.0.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 60_000;
const INTER_REQUEST_DELAY_MS = 1_500;
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

function buildTranslationPrompt(markerizedText, targetLanguage) {

  return [
    `Rewrite input in ${targetLanguage}`,
    "Translate naturally, especially text in markers",
    "Do not surround text w/ * \' or \"",
    "Preserve markers exactly, both open and closed forms",
    "Dont: add remove rename duplicate reorder marker bounds",
    "Keep marker structure identical to input",
    "Return only translated paragraph w/ markers",
    "Do not return markdown code fences notes text or alternatives",
    `Input: ${JSON.stringify(markerizedText)}`
    ].join("\n")

  return [
    `Translate the paragraph into ${targetLanguage}.`,
    "Preserve every marker exactly as written, including both opening and closing forms.",
    "Do not add, remove, rename, duplicate, or reorder marker boundaries.",
    "Keep the same marker nesting structure as the input.",
    "Translate naturally, including text inside markers.",
    "Return only the translated paragraph with markers preserved.",
    "Do not output markdown, explanations, code fences, notes, or alternatives.",
    `Input: ${JSON.stringify(markerizedText)}`,
  ].join("\n");
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

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

async function requestGemma(prompt) {
  const response = await fetch(`${GEMMA_ENDPOINT}?key=${encodeURIComponent(LOCAL_GEMMA_API_KEY)}`, {
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
  });

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

async function translateParagraph({ splitText, targetLanguage }) {
  const { markerizedText, segments } = buildMarkerizedTextFromSplitText(splitText);
  if (!markerizedText) {
    throw new Error("Paragraph did not contain any translatable text.");
  }

  const prompt = buildTranslationPrompt(markerizedText, targetLanguage);
  const translatedMarkerizedText = await enqueueTranslation(() =>
    requestGemmaWithRetries(prompt)
  );

  const parsedTranslation = parseTranslatedMarkerizedText(
    translatedMarkerizedText,
    segments
  );
  if (!parsedTranslation.ok) {
    throw new MarkerValidationError(parsedTranslation.error);
  }

  return {
    html: reconstructHtmlFromParsedMarkers(parsedTranslation.tree, segments),
    text: buildPlainTextFromParsedMarkers(parsedTranslation.tree),
    markerizedText: parsedTranslation.normalizedText,
  };
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
    const targetLanguage = String(body?.targetLanguage ?? "").trim();

    if (!Array.isArray(splitText)) {
      sendJson(response, 400, { error: "splitText is required." });
      return;
    }

    if (!targetLanguage) {
      sendJson(response, 400, { error: "targetLanguage is required." });
      return;
    }

    const sourceText = buildRawTextFromSplitText(splitText);
    if (!sourceText) {
      sendJson(response, 400, { error: "splitText did not contain any text." });
      return;
    }

    const translation = await translateParagraph({
      splitText,
      targetLanguage,
    });

    sendJson(response, 200, {
      translation,
      sourceText,
    });
  } catch (error) {
    console.error("Translation request failed:", error);

    if (error instanceof MarkerValidationError) {
      sendJson(response, 422, {
        error: `Model returned invalid marker output: ${error.message}`,
      });
      return;
    }

    const retryAfterMs =
      error instanceof RetryableTranslationError ? error.retryDelayMs : null;
    sendJson(response, 500, {
      error: error.message,
      retryAfterMs,
    });
  }
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Language Extension backend listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
