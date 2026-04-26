const BACKEND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/translate";
const BACKEND_LOOKUP_WORD_ENDPOINT = "http://127.0.0.1:8787/lookup-word";
const BACKEND_WORD_FEEDBACK_ENDPOINT = "http://127.0.0.1:8787/word-feedback";

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
  userEmail,
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
      userEmail,
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

async function lookupWord({ word, targetLanguage }) {
  const response = await fetch(BACKEND_LOOKUP_WORD_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      word,
      targetLanguage,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend lookup failed (${response.status}): ${errorText}`);
  }

  const responseData = await response.json();
  if (!responseData?.lookup || typeof responseData.lookup !== "object") {
    throw new Error(responseData?.error || "Backend returned an invalid lookup response.");
  }

  return responseData.lookup;
}

async function sendWordFeedback({ userEmail, targetLanguage, sourceTerm }) {
  const response = await fetch(BACKEND_WORD_FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userEmail,
      targetLanguage,
      sourceTerm,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend word feedback failed (${response.status}): ${errorText}`);
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
      console.error("OpenAI translation stream failed:", error);
      port.postMessage({ type: "error", error: error.message });
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "LOOKUP_WORD") {
    lookupWord(message.payload)
      .then((lookup) => sendResponse({ lookup }))
      .catch((error) => {
        console.error("Word lookup failed:", error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  if (message?.type === "WORD_FEEDBACK") {
    sendWordFeedback(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Word feedback failed:", error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.action.openPopup();
});
