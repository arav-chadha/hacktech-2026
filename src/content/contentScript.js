import { DEFAULT_SETTINGS, LANGUAGE_STORAGE_KEY } from "../shared/settings";
import {
    buildRawTextFromSplitText,
    normalizeWhitespace,
} from "../shared/translationMarkup";

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

function getWordMatches(text) {
    return Array.from(text.matchAll(WORD_PATTERN));
}

function buildStartTag(element) {
    const tagName = element.tagName.toLowerCase();
    const attributes = Array.from(element.attributes)
        .map((attribute) => ` ${attribute.name}="${attribute.value}"`)
        .join("");

    return `<${tagName}${attributes}>`;
}

function buildEndTag(element) {
    return `</${element.tagName.toLowerCase()}>`;
}

function serializeContentNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        const rawText = normalizeWhitespace(node.nodeValue || "");
        if (!rawText) return null;

        return {
            rawText,
            splitText: [rawText],
        };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node;
    if (element.matches(EXCLUDED_CONTAINER_SELECTOR)) return null;

    const tagName = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "textarea"].includes(tagName)) return null;

    const childSplitText = [];
    const childRawParts = [];

    for (const child of element.childNodes) {
        const serializedChild = serializeContentNode(child);
        if (!serializedChild) continue;

        childSplitText.push(...serializedChild.splitText);
        childRawParts.push(serializedChild.rawText);
    }

    const rawText = normalizeWhitespace(childRawParts.join(" "));
    if (!rawText) return null;

    return {
        rawText,
        splitText: [
            {
                text: rawText,
                start_tag: buildStartTag(element),
                end_tag: buildEndTag(element),
                splitText: childSplitText,
            },
        ],
    };
}

function serializeParagraph(paragraph) {
    const splitText = [];

    for (const child of paragraph.childNodes) {
        const serializedChild = serializeContentNode(child);
        if (!serializedChild) continue;

        splitText.push(...serializedChild.splitText);
    }

    return {
        rawText: buildRawTextFromSplitText(splitText),
        splitText,
    };
}

function isValidParagraphNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    const paragraph = node;
    if (!(paragraph instanceof HTMLParagraphElement)) return false;
    if (paragraph.matches(EXCLUDED_CONTAINER_SELECTOR)) return false;

    const text = normalizeWhitespace(paragraph.innerText || paragraph.textContent || "");
    if (!text) return false;
    if (getWordMatches(text).length < 3) return false;

    return true;
}

function injectTranslatedHtml(paragraph, translatedHtml) {
    paragraph.setAttribute(PROCESSED_ATTR, "true");
    paragraph.innerHTML = translatedHtml;
}

function getParagraphSelection(node) {
    if (!isValidParagraphNode(node)) return;
    if (processedNodes.has(node)) return;

    const paragraph = node;
    processedNodes.add(paragraph);

    const { rawText, splitText } = serializeParagraph(paragraph);
    if (!rawText || getWordMatches(rawText).length === 0) return;

    return {
        node: paragraph,
        rawText,
        splitText,
    };
}

async function translateSelections(selections, settings) {
    if (selections.length === 0) return;

    for (const selection of selections) {
        translateSelection(selection, settings);
    }
}

async function translateSelection(selection, settings) {
    let translationResult;
    try {
        translationResult = await chrome.runtime.sendMessage({
            type: "TRANSLATE_PHRASES",
            payload: {
                rawText: selection.rawText,
                splitText: selection.splitText,
                targetLanguage: settings.selectedLanguage,
            },
        });
    } catch (error) {
        console.error("Failed to translate phrases:", error);
        return;
    }

    if (translationResult?.error) {
        console.error("Gemma translation error:", translationResult.error);
        return;
    }

    const translatedHtml = String(translationResult?.translation?.html ?? "").trim();
    if (!translatedHtml) {
        console.error("Received an invalid translation payload from the background script.");
        return;
    }

    if (!selection.node.isConnected) {
        return;
    }

    injectTranslatedHtml(selection.node, translatedHtml);
}

async function processParagraphList(nodes, settings) {
    const selections = [];

    for (const node of nodes) {
        const selection = getParagraphSelection(node);
        
        if (selection) {
            selections.push(selection);
        }

    }

    if (selections.length === 0) return;
    console.log("Selected phrase:", selections);
    await translateSelections(selections, settings);
}

function getParagraphCandidates(root) {
    if (!root) return [];

    if (root.nodeType === Node.TEXT_NODE) {
        const paragraph = root.parentElement?.closest("p");
        return paragraph ? [paragraph] : [];
    }

    if (root.nodeType !== Node.ELEMENT_NODE) return [];

    const element = root;
    const paragraphs = [];

    if (element.matches("p")) {
        paragraphs.push(element);
    }

    paragraphs.push(...element.querySelectorAll("p"));
    return Array.from(new Set(paragraphs));
}

async function walkAndProcess(root, settings) {
    const candidates = getParagraphCandidates(root);
    await processParagraphList(candidates, settings);
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
                mutation.addedNodes.forEach((node) => {
                    void walkAndProcess(node, settings);
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
