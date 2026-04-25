import http from "node:http";
import { LOCAL_GEMMA_API_KEY, SERVER_PORT } from "./local-config.js";
import { GEMMA_MODEL } from "../src/shared/settings.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ "text": text }] }],
    generationConfig,
  });
}

async function streamTranslatedParagraph({ splitText, targetLanguage, onChunk }) {
  const { markerizedText, segments } = buildMarkerizedTextFromSplitText(splitText);
  if (!markerizedText) {
    throw new Error("Paragraph did not contain any translatable text.");
  }

  const prompt = buildTranslationPrompt(targetLanguage);
  let streamedMarkerizedText = "";
  let lastSentMarkerizedText = "";

  const finalMarkerizedText = await enqueueTranslation(async () => {
    const streamResult = await requestGemmaStream(prompt, markerizedText);

    for await (const responseChunk of streamResult.stream) {
      const chunkText = extractGemmaText(responseChunk);
      if (!chunkText) {
        continue;
      }

      streamedMarkerizedText += chunkText;
      const parsedChunk = parseTranslatedMarkerizedText(streamedMarkerizedText, segments);
      if (!parsedChunk.ok) {
        throw new MarkerValidationError(parsedChunk.error);
      }

      if (
        parsedChunk.normalizedText &&
        parsedChunk.normalizedText !== lastSentMarkerizedText
      ) {
        lastSentMarkerizedText = parsedChunk.normalizedText;
        onChunk?.(buildTranslationFromParsed(parsedChunk, segments));
      }
    }

    await streamResult.response;
    return streamedMarkerizedText;
  });

  const parsedTranslation = parseTranslatedMarkerizedText(finalMarkerizedText, segments);
  if (!parsedTranslation.ok) {
    throw new MarkerValidationError(parsedTranslation.error);
  }

  if (!parsedTranslation.complete) {
    throw new MarkerValidationError("Model returned incomplete marker output.");
  }

  return buildTranslationFromParsed(parsedTranslation, segments);
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
    response.end();
  } catch (error) {
    console.error("Translation request failed:", error);

    if (response.headersSent) {
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
