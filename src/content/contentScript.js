import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, LANGUAGE_STORAGE_KEY } from "../shared/settings";

const processedNodes = new WeakSet();
const PROCESSED_ATTR = "data-language-extension-processed";
const WORD_PATTERN = /\b[\p{L}\p{N}'’-]+\b/gu;
const TRANSLATION_BATCH_SIZE = 8;
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
    console.log("Scoring candidate:", element);
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

function isValidTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    if (!node.nodeValue.trim()) return false;

    const parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest(EXCLUDED_CONTAINER_SELECTOR)) return false;

    const tag = parent.tagName.toLowerCase();
    if (["script", "style", "noscript", "textarea"].includes(tag)) return false;

    if (getWordMatches(node.nodeValue).length < 3) return false;

    return true;
}

function getWordMatches(text) {
    return Array.from(text.matchAll(WORD_PATTERN));
}

function createReplacementNode(replacementText) {
    const wrapper = document.createElement("span");
    wrapper.setAttribute(PROCESSED_ATTR, "true");

    const highlightedPhrase = document.createElement("span");
    highlightedPhrase.textContent = replacementText;
    highlightedPhrase.style.setProperty("color", "red", "important");
    highlightedPhrase.setAttribute(PROCESSED_ATTR, "true");
    wrapper.appendChild(highlightedPhrase);

    return wrapper;
}

function getPhraseSelection(node) {
    if (!isValidTextNode(node)) return;
    if (processedNodes.has(node)) return;

    processedNodes.add(node);

    const text = node.nodeValue;
    const wordMatches = getWordMatches(text);
    if (wordMatches.length === 0) return;

    return {
        node,
        text,
    };
}

async function translateSelections(selections, settings) {
    if (selections.length === 0) return;

    for (let offset = 0; offset < selections.length; offset += TRANSLATION_BATCH_SIZE) {
        const batch = selections.slice(offset, offset + TRANSLATION_BATCH_SIZE);

        let translatedPhrases;
        try {
            translatedPhrases = await chrome.runtime.sendMessage({
                type: "TRANSLATE_PHRASES",
                payload: {
                    phrases: batch.map((selection) => selection.text),
                    targetLanguage: settings.selectedLanguage,
                },
            });
        } catch (error) {
            console.error("Failed to translate phrases:", error);
            continue;
        }

        if (translatedPhrases?.error) {
            console.error("Gemma translation error:", translatedPhrases.error);
            continue;
        }

        const translations = translatedPhrases?.translations;
        if (!Array.isArray(translations) || translations.length !== batch.length) {
            console.error("Received an invalid translation batch from the background script.");
            continue;
        }

        for (let index = 0; index < batch.length; index += 1) {
            const selection = batch[index];
            if (!selection.node.isConnected) continue;

            const replacement = createReplacementNode(translations[index]);
            selection.node.replaceWith(replacement);
        }
    }
}

async function processNodeList(nodes, settings) {
    const selections = [];

    for (const node of nodes) {
        const selection = getPhraseSelection(node);
        
        if (selection) {
            selections.push(selection);
        }

    }

    if (selections.length === 0) return;
    console.log("Selected phrase:", selections);
    await translateSelections(selections, settings);
}

async function walkAndProcess(root, settings) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const candidates = [];
    let currentNode;

    while ((currentNode = walker.nextNode())) {
        candidates.push(currentNode);
    }

    await processNodeList(candidates, settings);
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
        const storedValues = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY);
        return {
            selectedLanguage:
                storedValues[LANGUAGE_STORAGE_KEY] ?? DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
        };
    } catch (error) {
        console.error("Failed to load highlighting settings:", error);
        return {
            selectedLanguage: DEFAULT_SETTINGS.selectedLanguage,
        };
    }
}

async function init() {
    const settings = await loadSettings();
    const processingRoot = getProcessingRoot();
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
                const addedTextNodes = [];

                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        addedTextNodes.push(node);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        void walkAndProcess(node, settings);
                    }
                });

                void processNodeList(addedTextNodes, settings);
            }

            if (mutation.type === "characterData") {
                void processNodeList([mutation.target], settings);
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
