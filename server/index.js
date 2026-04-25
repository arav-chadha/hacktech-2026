import http from "node:http";
import { LOCAL_GEMMA_API_KEY, SERVER_PORT } from "./local-config.js";
import { GEMMA_MODEL } from "../src/shared/settings.js";

const GEMMA_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent`;
const SERVER_HOST = "127.0.0.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const FALLBACK_RETRY_DELAY_MS = 60_000;
const INTER_REQUEST_DELAY_MS = 2_500;
const TRANSLATION_DELIMITER = "\n<|LANG_EXT_TR|>\n";
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

function buildTranslationPrompt(phrases, targetLanguage) {
  return [
    `Translate each input phrase into ${targetLanguage}`,
    "Preserve meaning and punctuation",
    `Return only translated strings in same order as input, separated by delimiter: ${TRANSLATION_DELIMITER.trim()}`,
    "Do not number outputs",
    "Do not wrap response in markdown or code fences",
    `Input phrases: ${JSON.stringify(phrases)}`,
  ].join("\n");
}

function buildSingleTranslationPrompt(phrase, targetLanguage) {
  return [
    `Translate this phrase into ${targetLanguage}`,
    "Preserve meaning and punctuation",
    "Return only translation",
    "Do not wrap response in markdown or code fences",
    `Input phrase: ${JSON.stringify(phrase)}`,
  ].join("\n");
}

function parseRetryDelayMs(retryDelay) {
  if (typeof retryDelay !== "string") return null;

  const seconds = Number.parseFloat(retryDelay.replace(/s$/, ""));
  if (!Number.isFinite(seconds)) return null;

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
    const rawText = String(body?.rawText ?? "").trim();
    const targetLanguage = String(body?.targetLanguage ?? "").trim();

    if (rawText.length === 0) {
      sendJson(response, 400, { error: "rawText is required." });
      return;
    }

    if (!targetLanguage) {
      sendJson(response, 400, { error: "targetLanguage is required." });
      return;
    }

    //Insert translation processing here as a seperate function outside this one.
    //Return a streaming text response that sends translated text as it is received from the Gemma API.
  } catch (error) {
    console.error("Translation request failed:", error);
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
