import browser from "webextension-polyfill";
const BACKEND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/translate";

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

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TRANSLATE_PHRASES") {
    return undefined;
  }

  translatePhrases(message.payload)
    .then((translations) => sendResponse({ translations }))
    .catch((error) => {
      console.error("Gemma translation request failed:", error);
      sendResponse({ error: error.message });
    });

  return true;
});

browser.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed:", details);
});
