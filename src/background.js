const BACKEND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/translate";

async function readNdjsonStream(response, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Backend response body is not readable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        onEvent(JSON.parse(line));
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      const trailingLine = buffer.trim();
      if (trailingLine) {
        onEvent(JSON.parse(trailingLine));
      }
      break;
    }
  }
}

async function streamTranslation({
  rawText,
  splitText,
  targetLanguage,
  translationLevel,
  phraseMinWords,
  phraseMaxWords,
  phraseCoveragePercent,
  phraseLengthTemperature,
  onEvent,
}) {
  const response = await fetch(BACKEND_TRANSLATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawText,
      splitText,
      targetLanguage,
      translationLevel,
      phraseMinWords,
      phraseMaxWords,
      phraseCoveragePercent,
      phraseLengthTemperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed (${response.status}): ${errorText}`);
  }

  let sawTerminalEvent = false;
  await readNdjsonStream(response, (event) => {
    if (!event || typeof event !== "object") {
      return;
    }

    if (event.type === "error") {
      throw new Error(event.error || "Backend stream failed.");
    }

    if (event.type === "done") {
      sawTerminalEvent = true;
    }

    onEvent(event);
  });

  if (!sawTerminalEvent) {
    throw new Error("Backend stream ended before sending a completion event.");
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translation-stream") {
    return;
  }

  port.onMessage.addListener((message) => {
    if (message?.type !== "TRANSLATE_PHRASES_STREAM") {
      return;
    }

    streamTranslation({
      ...message.payload,
      onEvent(event) {
        if (
          (event.type === "chunk" || event.type === "done") &&
          typeof event?.translation?.html === "string"
        ) {
          port.postMessage(event);
          return;
        }

        if (event.type === "error") {
          port.postMessage(event);
        }
      },
    }).catch((error) => {
      console.error("Gemma translation stream failed:", error);
      port.postMessage({ type: "error", error: error.message });
    });
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.action.openPopup();
});
