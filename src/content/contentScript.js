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

function getWordMatches(text) {
    return Array.from(text.matchAll(WORD_PATTERN));
}

function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}

function splitPlainText(text) {
    const normalizedText = normalizeWhitespace(text);
    return normalizedText ? normalizedText.split(" ") : [];
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
            splitText: splitPlainText(rawText),
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
    const rawParts = [];

    for (const child of paragraph.childNodes) {
        const serializedChild = serializeContentNode(child);
        if (!serializedChild) continue;

        splitText.push(...serializedChild.splitText);
        rawParts.push(serializedChild.rawText);
    }

    return {
        rawText: normalizeWhitespace(rawParts.join(" ")),
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

    for (let offset = 0; offset < selections.length; offset += TRANSLATION_BATCH_SIZE) {
        const batch = selections.slice(offset, offset + TRANSLATION_BATCH_SIZE);

        let translatedPhrases;
        try {
            translatedPhrases = await chrome.runtime.sendMessage({
                type: "TRANSLATE_PHRASES",
                payload: {
                    phrases: batch.map((selection) => selection.rawText),
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

            selection.node.setAttribute(PROCESSED_ATTR, "true");
            const replacement = createReplacementNode(translations[index]);
            selection.node.replaceChildren(replacement);
        }
    }
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
