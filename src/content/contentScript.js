import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings";

const PROCESSED_ATTR = "data-language-extension-processed";
const WORD_PATTERN = /\b[\p{L}\p{N}'’-]+\b/gu;
const TRANSLATION_BATCH_SIZE = 8;
let currentSettings = null;
let processingRootElement = null;
let isProcessing = false;
let processingRequested = false;
const MAIN_CONTENT_SELECTOR = [
    "main",
    "[role='main']",
    "article",
    "#content",
    "#mw-content-text",
    ".article",
    ".article-body",
    ".article-content",
    ".post",
    ".post-content",
    ".entry-content",
    ".content",
].join(", ");
const EXCLUDED_CONTAINER_SELECTOR = [
    `[${PROCESSED_ATTR}]`,
    "nav",
    "aside",
    "header",
    "footer",
    "table",
    "figure",
    "figcaption",
    "form",
    "button",
    "label",
    "select",
    ".infobox",
    ".sidebar",
    ".navbox",
    ".toc",
    ".metadata",
    ".mw-jump-link",
    ".hatnote",
    ".thumb",
    ".reference",
].join(", ");

let userEmail = null;

chrome.storage.local.get("userEmail", (data) => {
  console.log("Fetching email");
  const email = data.userEmail;

  if (email) {
    console.log("User email:", email);
  } else {
    console.log("No user signed in");
  }
  userEmail = email;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.userEmail) {
    const newEmail = changes.userEmail.newValue;
    console.log("Updated email:", newEmail);
    userEmail = newEmail;
  }
});

function scoreProcessingRootCandidate(element) {
    if (!element || !(element instanceof HTMLElement)) return -Infinity;
    if (element.matches(EXCLUDED_CONTAINER_SELECTOR)) return -Infinity;

    const text = element.innerText?.trim() || "";
    if (text.length < 200) return -Infinity;

    const paragraphs = element.querySelectorAll("p").length;
    const links = element.querySelectorAll("a").length;
    const controls = element.querySelectorAll(
        "button, input, textarea, select, nav, aside, form"
    ).length;

    return text.length + (paragraphs * 200) - (links * 40) - (controls * 150);
}

function describeElement(element) {
    if (!element || !(element instanceof Element)) return "<none>";

    const idPart = element.id ? `#${element.id}` : "";
    const classPart = element.classList.length > 0
        ? `.${Array.from(element.classList).slice(0, 3).join(".")}`
        : "";

    return `${element.tagName.toLowerCase()}${idPart}${classPart}`;
}

function isValidTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    if (!node.nodeValue.trim()) return false;

    const parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;

    const tag = parent.tagName.toLowerCase();
    if (["script", "style", "noscript", "textarea"].includes(tag)) return false;

    if (getWordMatches(node.nodeValue).length === 0) return false;

    return true;
}

function getWordMatches(text) {
    return Array.from(text.matchAll(WORD_PATTERN));
}

function choosePhraseLength(minWords, maxWords, temperature) {
    const lengths = [];
    const weights = [];

    for (let length = minWords; length <= maxWords; length += 1) {
        const normalizedPosition =
            maxWords === minWords ? 1 : (length - minWords) / (maxWords - minWords);
        const weight =
            (1 - temperature) * (1 - normalizedPosition) + temperature * normalizedPosition + 0.1;

        lengths.push(length);
        weights.push(weight);
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.random() * totalWeight;

    for (let index = 0; index < lengths.length; index += 1) {
        target -= weights[index];
        if (target <= 0) {
            return lengths[index];
        }
    }

    return lengths[lengths.length - 1];
}

function createReplacementNode(text, phraseStart, phraseEnd, replacementText) {
    const fragment = document.createDocumentFragment();

    const prefix = text.slice(0, phraseStart);
    const suffix = text.slice(phraseEnd);

    if (prefix) {
        fragment.appendChild(document.createTextNode(prefix));
    }

    const highlightedPhrase = document.createElement("span");
    highlightedPhrase.textContent = replacementText;
    highlightedPhrase.style.setProperty("color", "red", "important");
    highlightedPhrase.setAttribute(PROCESSED_ATTR, "true");
    fragment.appendChild(highlightedPhrase);

    if (suffix) {
        fragment.appendChild(document.createTextNode(suffix));
    }

    return fragment;
}

function buildPhraseSelection(node, settings) {
    const text = node.nodeValue;
    const wordMatches = getWordMatches(text);
    if (wordMatches.length === 0) return;

    const minWords = Math.max(1, Math.min(settings.phraseMinWords, wordMatches.length));
    const maxWords = Math.max(minWords, Math.min(settings.phraseMaxWords, wordMatches.length));
    const phraseLength = choosePhraseLength(minWords, maxWords, settings.phraseLengthTemperature);
    const maxStartIndex = wordMatches.length - phraseLength;
    const startIndex = 0;
    const phraseStart = wordMatches[startIndex].index;
    const lastWord = wordMatches[startIndex + phraseLength - 1];
    const phraseEnd = lastWord.index + lastWord[0].length;

    return {
        node,
        text,
        phraseStart,
        phraseEnd,
        phrase: text.slice(phraseStart, phraseEnd),
    };
}

function collectEligibleSelections(root, settings) {
    const selections = [];
    if (!root) return selections;

    const selectionRoot = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    if (!(selectionRoot instanceof Node)) return selections;

    const walker = document.createTreeWalker(selectionRoot, NodeFilter.SHOW_TEXT);
    let currentNode;
    let textNodeCount = 0;

    while ((currentNode = walker.nextNode())) {
        textNodeCount += 1;
        if (!isValidTextNode(currentNode)) continue;

        const selection = buildPhraseSelection(currentNode, settings);
        if (!selection) continue;
        selections.push(selection);
    }

    return selections;
}

function createSelectionBatches(selections) {
    const batches = [];
    for (let offset = 0; offset < selections.length; offset += TRANSLATION_BATCH_SIZE) {
        batches.push(selections.slice(offset, offset + TRANSLATION_BATCH_SIZE));
    }
    return batches;
}

async function requestTranslations(batch, settings) {
    let translatedPhrases;
    try {
        translatedPhrases = await chrome.runtime.sendMessage({
            type: "TRANSLATE_PHRASES",
            payload: {
                phrases: batch.map((selection) => selection.phrase),
                targetLanguage: settings.selectedLanguage,
            },
        });
    } catch (error) {
        console.error("Failed to translate phrases:", error);
        return null;
    }

    if (translatedPhrases?.error) {
        console.error("Gemma translation error:", translatedPhrases.error);
        return null;
    }

    const translations = translatedPhrases?.translations;
    if (!Array.isArray(translations) || translations.length !== batch.length) {
        console.error("Received an invalid translation batch from the background script.");
        return null;
    }

    return translations;
}

function releasePendingParagraphs(batch) {
    void batch;
}

function applyTranslatedBatch(batch, translations) {
    for (let index = 0; index < batch.length; index += 1) {
        const selection = batch[index];
        if (!selection.node.isConnected) continue;

        const replacement = createReplacementNode(
            selection.text,
            selection.phraseStart,
            selection.phraseEnd,
            translations[index]
        );
        selection.node.replaceWith(replacement);
    }
}

async function processBatch(batch, settings) {
    const translations = await requestTranslations(batch, settings);
    if (!translations) {
        releasePendingParagraphs(batch);
        return;
    }

    applyTranslatedBatch(batch, translations);
}

async function runBatchesWithConcurrency(batches, settings) {
    const concurrency = Math.max(1, Math.min(2, settings.batchRequestConcurrency));
    let nextBatchIndex = 0;

    async function worker() {
        while (nextBatchIndex < batches.length) {
            const batchIndex = nextBatchIndex;
            nextBatchIndex += 1;
            await processBatch(batches[batchIndex], settings);
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, batches.length) },
        () => worker()
    );
    await Promise.all(workers);
}

async function processRoot(root, settings) {
    const selections = collectEligibleSelections(root, settings);
    const batches = createSelectionBatches(selections);

    if (selections.length === 0) return;
    await runBatchesWithConcurrency(batches, settings);
}

function scheduleProcessing(root, settings) {
    if (root && !processingRootElement) {
        processingRootElement = root;
    }
    currentSettings = settings;
    processingRequested = true;

    if (isProcessing) {
        return;
    }

    isProcessing = true;

    void (async () => {
        try {
            while (processingRequested) {
                processingRequested = false;
                if (!processingRootElement || !currentSettings) break;
                await processRoot(processingRootElement, currentSettings);
            }
        } catch (error) {
            console.error("Processing cycle failed:", error);
        } finally {
            isProcessing = false;
            if (processingRequested) {
                scheduleProcessing(processingRootElement, currentSettings);
            }
        }
    })();
}

async function walkAndProcess(root, settings) {
    scheduleProcessing(root, settings);
}

function getProcessingRoot() {
    const explicitRoot = document.querySelector(MAIN_CONTENT_SELECTOR);
    if (explicitRoot && !explicitRoot.matches(EXCLUDED_CONTAINER_SELECTOR)) {
        return explicitRoot;
    }

    const candidates = Array.from(document.querySelectorAll("main, article, section, div"));
    let bestElement = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
        const score = scoreProcessingRootCandidate(candidate);
        if (score > bestScore) {
            bestScore = score;
            bestElement = candidate;
        }
    }

    return bestElement || document.body;
}

async function loadSettings() {
    try {
        const storedValues = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
        const normalized = normalizeSettings(storedValues);
        return {
            selectedLanguage: normalized.selectedLanguage,
            phraseMinWords: normalized.phraseMinWords,
            phraseMaxWords: normalized.phraseMaxWords,
            phraseLengthTemperature: normalized.phraseLengthTemperature,
            batchRequestConcurrency: normalized.batchRequestConcurrency,
        };
    } catch (error) {
        console.error("Failed to load highlighting settings:", error);
        return {
            selectedLanguage: DEFAULT_SETTINGS.selectedLanguage,
            phraseMinWords: DEFAULT_SETTINGS.phraseMinWords,
            phraseMaxWords: DEFAULT_SETTINGS.phraseMaxWords,
            phraseLengthTemperature: DEFAULT_SETTINGS.phraseLengthTemperature,
            batchRequestConcurrency: DEFAULT_SETTINGS.batchRequestConcurrency,
        };
    }
}

async function init() {
    const settings = await loadSettings();
    const processingRoot = getProcessingRoot();
    processingRootElement = processingRoot;
    currentSettings = settings;
    await walkAndProcess(processingRoot, settings);
    observeDOM(processingRoot, settings);
}

function observeDOM(processingRoot, settings) {
    const observer = new MutationObserver((mutations) => {
        if (userEmail === null) {
            chrome.storage.local.get("userEmail", (data) => {
            console.log("Fetching email");
            const email = data.userEmail;

            if (email) {
                console.log("User email:", email);
            } else {
                console.log("No user signed in");
            }
            userEmail = email;
            });
        }
        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                mutation.addedNodes.forEach((node) => {
                    if (
                        node.nodeType === Node.TEXT_NODE ||
                        node.nodeType === Node.ELEMENT_NODE
                    ) {
                        void walkAndProcess(node, settings);
                    }
                });
            }

            if (mutation.type === "characterData") {
                void walkAndProcess(mutation.target, settings);
            }
        }
    });

    observer.observe(processingRoot, {
        childList: true,
        subtree: true,
        characterData: true,
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
