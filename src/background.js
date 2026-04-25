import browser from "webextension-polyfill";
const BACKEND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/translate";
const BACKEND_DEBUG_ENDPOINT = "http://127.0.0.1:8787/debug-log";

async function translatePhrases({ phrases, targetLanguage }) {
  const response = await fetch(BACKEND_TRANSLATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phrases,
      targetLanguage,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed (${response.status}): ${errorText}`);
  }

  const responseData = await response.json();
  if (!Array.isArray(responseData?.translations)) {
    throw new Error(responseData?.error || "Backend returned an invalid response.");
  }

  return responseData.translations.map((item) => String(item));
}

async function sendDebugLog(payload) {
  try {
    await fetch(BACKEND_DEBUG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to forward debug log to backend:", error);
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DEBUG_LOG") {
    void sendDebugLog(message.payload);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "TRANSLATE_PHRASES") {
    translatePhrases(message.payload)
      .then((translations) => sendResponse({ translations }))
      .catch((error) => {
        console.error("Gemma translation request failed:", error);
        sendResponse({ error: error.message });
      });

    return true;
  }

  return undefined;
});

browser.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed:", details);
});
