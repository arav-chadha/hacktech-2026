import browser from "webextension-polyfill";
const BACKEND_SELECT_AND_TRANSLATE_ENDPOINT = "http://127.0.0.1:8787/select-and-translate";

async function selectAndTranslatePhrases({
  pageUrl,
  candidates,
  targetLanguage,
  readerKnowledgeLevel,
}) {
  const response = await fetch(BACKEND_SELECT_AND_TRANSLATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pageUrl,
      candidates,
      targetLanguage,
      readerKnowledgeLevel,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Backend request failed (${response.status}): ${errorText}`);
  }

  const responseData = await response.json();
  if (!Array.isArray(responseData?.translatedPhrases)) {
    throw new Error(responseData?.error || "Backend returned an invalid response.");
  }

  return responseData.translatedPhrases;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SELECT_AND_TRANSLATE_PHRASES") {
    return undefined;
  }

  selectAndTranslatePhrases(message.payload)
    .then((translatedPhrases) => sendResponse({ translatedPhrases }))
    .catch((error) => {
      console.error("Selection and translation request failed:", error);
      sendResponse({ error: error.message });
    });

  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.action.openPopup();
});
