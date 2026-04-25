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

function extractTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function parseTranslationArray(text, expectedCount) {
  const normalizedText = text.replace(/^```[\w-]*\s*|\s*```$/gmu, "").trim();
  const parts = normalizedText
    .split(TRANSLATION_DELIMITER)
    .map((item) => item.trim());

  if (parts.length !== expectedCount || parts.some((item) => item.length === 0)) {
    throw new Error("Unexpected translation payload returned by Gemma.");
  }

  return parts;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function translatePhrases({ phrases, targetLanguage }) {
  const apiKey = String(LOCAL_GEMMA_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("Missing Gemma API key in server/local-config.js.");
  }

  async function requestGemma(prompt) {
    console.log("\n[Gemma prompt]");
    console.log(prompt);
    console.log("[/Gemma prompt]\n");

    for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
      const response = await fetch(`${GEMMA_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson = null;

        try {
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = null;
        }

        const retryDelayMs = getRetryDelayMs(response.status, errorJson, response.headers);
        if (response.status === 429 && attempt < MAX_TRANSLATION_ATTEMPTS) {
          await delay(retryDelayMs ?? FALLBACK_RETRY_DELAY_MS);
          continue;
        }

        if (response.status === 429) {
          throw new RetryableTranslationError(
            `Gemma request failed (${response.status}): ${errorText}`,
            retryDelayMs ?? FALLBACK_RETRY_DELAY_MS
          );
        }

        throw new Error(`Gemma request failed (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      const responseText = extractTextFromResponse(responseData);
      if (!responseText) {
        throw new Error("Gemma returned an empty response.");
      }

      console.log("\n[Gemma raw response]");
      console.log(responseText);
      console.log("[/Gemma raw response]\n");

      return responseText;
    }

    throw new Error("Gemma translation failed after retry attempts.");
  }

  const batchPrompt = buildTranslationPrompt(phrases, targetLanguage);
  const batchResponseText = await requestGemma(batchPrompt);

  try {
    return parseTranslationArray(batchResponseText, phrases.length);
  } catch (error) {
    console.warn("Batch translation parse failed. Falling back to per-phrase translation.");

    const translations = [];
    for (const phrase of phrases) {
      const singlePrompt = buildSingleTranslationPrompt(phrase, targetLanguage);
      const singleResponseText = await requestGemma(singlePrompt);
      const cleanedTranslation = singleResponseText
        .replace(/^```[\w-]*\s*|\s*```$/gmu, "")
        .trim();

      if (!cleanedTranslation) {
        throw new Error("Gemma returned an empty translation during fallback.");
      }

      translations.push(cleanedTranslation);
    }

    return translations;
  }
}

function enqueueTranslation(task) {
  const queuedTask = translationQueue
    .catch(() => undefined)
    .then(async () => {
      const result = await task();
      await delay(INTER_REQUEST_DELAY_MS);
      return result;
    });

  translationQueue = queuedTask.catch(() => undefined);
  return queuedTask;
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
    const phrases = Array.isArray(body?.phrases) ? body.phrases.map((item) => String(item)) : [];
    const targetLanguage = String(body?.targetLanguage ?? "").trim();

    if (phrases.length === 0) {
      sendJson(response, 400, { error: "phrases must be a non-empty array." });
      return;
    }

    if (!targetLanguage) {
      sendJson(response, 400, { error: "targetLanguage is required." });
      return;
    }

    const translations = await enqueueTranslation(() =>
      translatePhrases({ phrases, targetLanguage })
    );
    sendJson(response, 200, { translations });
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
