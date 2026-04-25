import browser from "webextension-polyfill";
const BACKEND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/translate";

async function translateParagraph({ rawText, splitText, targetLanguage }) {
  const response = await fetch(BACKEND_TRANSLATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawText,
      splitText,
      targetLanguage,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed (${response.status}): ${errorText}`);
  }

  const responseData = await response.json();
  if (!responseData?.translation || typeof responseData.translation.html !== "string") {
    throw new Error(responseData?.error || "Backend returned an invalid response.");
  }

  return responseData.translation;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TRANSLATE_PHRASES") {
    return undefined;
  }

  translateParagraph(message.payload)
    .then((translation) => sendResponse({ translation }))
    .catch((error) => {
      console.error("Gemma translation request failed:", error);
      sendResponse({ error: error.message });
    });

  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.action.openPopup();
});
