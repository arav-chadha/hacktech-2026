import {
    DEFAULT_SETTINGS,
    LANGUAGE_STORAGE_KEY,
    PHRASE_COVERAGE_STORAGE_KEY,
    PHRASE_MAX_STORAGE_KEY,
    PHRASE_MIN_STORAGE_KEY,
    PHRASE_TEMPERATURE_STORAGE_KEY,
    normalizeSettings,
} from "../shared/settings";
import {
    buildRawTextFromSplitText,
    normalizeWhitespace,
} from "../shared/translationMarkup";

const ALIGNMENT_TOKEN_ATTR = "data-language-extension-alignment-token";
const LOOKUP_CARD_ID = "language-extension-lookup-card";
const STYLE_ID = "language-extension-alignment-style";
const LOOKUP_HOVER_DELAY_MS = 500;

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
const lookupCache = new Map();
let activeLookupRequestId = 0;
let activeLookupHoverTimeout = null;

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
    return Array.from(String(text ?? "").normalize("NFC").matchAll(/[\p{L}\p{N}\p{M}'’-]+/gu));
}

function createWordPattern() {
    return /[\p{L}\p{N}\p{M}'’-]+/gu;
}

function getAlignmentTokenText(alignmentText, relativeIndex) {
    const tokens = getWordMatches(alignmentText).map((match) => match[0]);
    if (tokens.length === 0) {
        return alignmentText;
    }

    if (relativeIndex < tokens.length) {
        return tokens[relativeIndex];
    }

    return tokens[tokens.length - 1];
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

function restoreOriginalParagraphHtml(paragraph, originalHtml) {
    paragraph.removeAttribute(PROCESSED_ATTR);
    paragraph.innerHTML = originalHtml;
}

function ensureAlignmentStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        [${ALIGNMENT_TOKEN_ATTR}] {
            cursor: pointer;
            text-decoration: underline;
            text-decoration-style: dotted;
            text-underline-offset: 0.12em;
            background: rgba(210, 214, 220, 0.35);
            border-radius: 0.2em;
            box-shadow: 0 0 0 1px rgba(190, 195, 201, 0.45);
        }

        [${ALIGNMENT_TOKEN_ATTR}].language-extension-alignment-active {
            background: rgba(220, 224, 230, 0.55);
            border-radius: 0.2em;
            box-shadow: 0 0 0 1px rgba(160, 166, 173, 0.6);
        }

        #${LOOKUP_CARD_ID} {
            position: fixed;
            z-index: 2147483647;
            max-width: min(260px, calc(100vw - 20px));
            min-width: 180px;
            padding: 8px 10px;
            border-radius: 8px;
            background: rgba(28, 32, 39, 0.96);
            color: #f6f7fb;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font: 12px/1.35 system-ui, sans-serif;
            pointer-events: none;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 140ms ease, transform 140ms ease;
        }

        #${LOOKUP_CARD_ID}.language-extension-lookup-card-visible {
            opacity: 1;
            transform: translateY(0);
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-head {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-bottom: 6px;
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-word {
            color: rgba(246, 247, 251, 0.72);
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-original {
            font-size: 13px;
            font-weight: 600;
            color: #ffffff;
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-label {
            display: block;
            margin-bottom: 2px;
            font-size: 10px;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            color: rgba(246, 247, 251, 0.72);
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-section + .language-extension-lookup-section {
            margin-top: 6px;
        }

        #${LOOKUP_CARD_ID} .language-extension-lookup-example {
            color: rgba(246, 247, 251, 0.84);
            font-style: italic;
        }
    `;
    document.documentElement.appendChild(style);
}

function clearActiveAlignmentTokens(root = document) {
    root.querySelectorAll(".language-extension-alignment-active").forEach((element) => {
        element.classList.remove("language-extension-alignment-active");
    });
}

function getOrCreateLookupCard() {
    let card = document.getElementById(LOOKUP_CARD_ID);
    if (card) {
        return card;
    }

    card = document.createElement("div");
    card.id = LOOKUP_CARD_ID;
    document.body.appendChild(card);
    return card;
}

function hideLookupCard() {
    const card = document.getElementById(LOOKUP_CARD_ID);
    if (!card) {
        return;
    }

    card.classList.remove("language-extension-lookup-card-visible");
}

function clearLookupHoverTimeout() {
    if (activeLookupHoverTimeout) {
        window.clearTimeout(activeLookupHoverTimeout);
        activeLookupHoverTimeout = null;
    }
}

function positionLookupCard(card, targetElement) {
    const rect = targetElement.getBoundingClientRect();
    const margin = 10;
    const top = Math.min(window.innerHeight - margin, rect.bottom + 8);
    const left = Math.min(
        window.innerWidth - card.offsetWidth - margin,
        Math.max(margin, rect.left)
    );

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
}

function renderLookupCard(targetElement, lookupState) {
    ensureAlignmentStyles();
    const card = getOrCreateLookupCard();
    const translatedWord = lookupState?.word || targetElement.dataset.targetText || targetElement.textContent || "";
    const originalWord = targetElement.dataset.sourceText || "";
    const definition = lookupState?.definition || "No dictionary definition found.";
    const example = lookupState?.example || "No example usage found.";

    card.innerHTML = `
        <div class="language-extension-lookup-head">
            <div class="language-extension-lookup-original">${originalWord}</div>
            <div class="language-extension-lookup-word">${translatedWord}</div>
        </div>
        <div class="language-extension-lookup-section">
            <span class="language-extension-lookup-label">Definition</span>
            <div>${definition}</div>
        </div>
        <div class="language-extension-lookup-section">
            <span class="language-extension-lookup-label">Example</span>
            <div class="language-extension-lookup-example">${example}</div>
        </div>
    `;

    positionLookupCard(card, targetElement);
    card.classList.add("language-extension-lookup-card-visible");
}

function getLookupCacheKey(targetLanguage, word) {
    return `${targetLanguage}::${normalizeWhitespace(word).toLocaleLowerCase()}`;
}

async function fetchWordLookup(word, targetLanguage) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: "LOOKUP_WORD",
                payload: {
                    word,
                    targetLanguage,
                },
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }

                resolve(response?.lookup ?? null);
            }
        );
    });
}

async function showLookupCardForToken(alignedToken) {
    const targetWord = alignedToken.dataset.targetText;
    const targetLanguage = alignedToken.dataset.targetLanguage;

    if (!targetWord || !targetLanguage) {
        renderLookupCard(alignedToken, null);
        return;
    }

    const cacheKey = getLookupCacheKey(targetLanguage, targetWord);
    if (lookupCache.has(cacheKey)) {
        renderLookupCard(alignedToken, lookupCache.get(cacheKey));
        return;
    }

    renderLookupCard(alignedToken, {
        word: targetWord,
        definition: "Loading definition...",
        example: null,
    });

    const requestId = ++activeLookupRequestId;

    try {
        const lookup = await fetchWordLookup(targetWord, targetLanguage);
        lookupCache.set(cacheKey, lookup);

        if (requestId !== activeLookupRequestId || !alignedToken.matches(":hover")) {
            return;
        }

        renderLookupCard(alignedToken, lookup);
    } catch (error) {
        if (requestId !== activeLookupRequestId || !alignedToken.matches(":hover")) {
            return;
        }

        renderLookupCard(alignedToken, {
            word: targetWord,
            definition: "Definition unavailable.",
            example: null,
        });
    }
}

function applyAlignmentMarkup(paragraph, alignments, targetLanguage) {
    if (!Array.isArray(alignments) || alignments.length === 0) {
        return;
    }

    const tokenAlignments = new Map();
    for (const alignment of alignments) {
        if (
            !alignment ||
            typeof alignment.id !== "string" ||
            typeof alignment.sourceText !== "string" ||
            typeof alignment.targetText !== "string"
        ) {
            continue;
        }

        for (let tokenIndex = alignment.targetStart; tokenIndex <= alignment.targetEnd; tokenIndex += 1) {
            tokenAlignments.set(tokenIndex, alignment);
        }
    }

    if (tokenAlignments.size === 0) {
        return;
    }

    const paragraphText = paragraph.textContent || "";
    const tokenMatches = Array.from(paragraphText.matchAll(createWordPattern()));
    if (tokenMatches.length === 0) {
        return;
    }

    const walker = document.createTreeWalker(
        paragraph,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (node.parentElement?.hasAttribute(ALIGNMENT_TOKEN_ATTR)) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );

    const textNodes = [];
    let currentNode = walker.nextNode();
    let textOffset = 0;
    while (currentNode) {
        const text = currentNode.nodeValue || "";
        textNodes.push({
            node: currentNode,
            text,
            start: textOffset,
            end: textOffset + text.length,
        });
        textOffset += text.length;
        currentNode = walker.nextNode();
    }

    const tokenSegments = tokenMatches.map((match, tokenIndex) => {
        const alignment = tokenAlignments.get(tokenIndex);
        return {
            tokenIndex,
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
            alignment,
        };
    });

    for (const textNode of textNodes.reverse()) {
        const { node, text, start: nodeStart, end: nodeEnd } = textNode;
        if (!text || getWordMatches(text).length === 0) {
            continue;
        }

        const intersectingSegments = tokenSegments
            .filter((segment) => segment.end > nodeStart && segment.start < nodeEnd)
            .map((segment) => ({
                tokenIndex: segment.tokenIndex,
                localStart: Math.max(0, segment.start - nodeStart),
                localEnd: Math.min(text.length, segment.end - nodeStart),
                alignment: segment.alignment,
            }))
            .filter((segment) => segment.localEnd > segment.localStart)
            .sort((a, b) => a.localStart - b.localStart);

        if (intersectingSegments.length === 0) {
            continue;
        }

        const fragment = document.createDocumentFragment();
        let cursor = 0;

        for (const segment of intersectingSegments) {
            if (segment.localStart > cursor) {
                fragment.append(text.slice(cursor, segment.localStart));
            }

            const segmentText = text.slice(segment.localStart, segment.localEnd);
            if (segment.alignment) {
                const targetOffset = Math.max(0, segment.tokenIndex - segment.alignment.targetStart);
                const sourceWord = getAlignmentTokenText(segment.alignment.sourceText, targetOffset);
                const targetWord = getAlignmentTokenText(segment.alignment.targetText, targetOffset);
                const span = document.createElement("span");
                span.setAttribute(ALIGNMENT_TOKEN_ATTR, segment.alignment.id);
                span.dataset.alignmentId = segment.alignment.id;
                span.dataset.sourceText = sourceWord;
                span.dataset.targetText = targetWord;
                span.dataset.targetLanguage = targetLanguage;
                span.textContent = segmentText;
                fragment.append(span);
            } else {
                fragment.append(segmentText);
            }

            cursor = segment.localEnd;
        }

        if (cursor < text.length) {
            fragment.append(text.slice(cursor));
        }

        node.parentNode?.replaceChild(fragment, node);
    }
}

function installAlignmentInteractions() {
    ensureAlignmentStyles();

    document.addEventListener("mouseover", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const alignedToken = target.closest(`[${ALIGNMENT_TOKEN_ATTR}]`);
        if (!(alignedToken instanceof HTMLElement)) {
            return;
        }

        const alignmentId = alignedToken.dataset.alignmentId;
        const sourceText = alignedToken.dataset.sourceText;
        if (!alignmentId || !sourceText) {
            return;
        }

        const paragraph = alignedToken.closest("p");
        if (paragraph instanceof HTMLElement) {
            clearActiveAlignmentTokens(paragraph);
            paragraph
                .querySelectorAll(`[${ALIGNMENT_TOKEN_ATTR}="${alignmentId}"]`)
                .forEach((element) => {
                    element.classList.add("language-extension-alignment-active");
                });
        }

        clearLookupHoverTimeout();
        activeLookupHoverTimeout = window.setTimeout(() => {
            activeLookupHoverTimeout = null;
            void showLookupCardForToken(alignedToken);
        }, LOOKUP_HOVER_DELAY_MS);
    });

    document.addEventListener("mouseout", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const alignedToken = target.closest(`[${ALIGNMENT_TOKEN_ATTR}]`);
        if (!(alignedToken instanceof HTMLElement)) {
            return;
        }

        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Element && alignedToken.contains(relatedTarget)) {
            return;
        }

        const paragraph = alignedToken.closest("p");
        if (paragraph instanceof HTMLElement) {
            clearActiveAlignmentTokens(paragraph);
        } else {
            clearActiveAlignmentTokens();
        }
        clearLookupHoverTimeout();
        hideLookupCard();
    });
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
        void translateSelection(selection, settings);
    }
}

async function translateSelection(selection, settings) {
    await new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "translation-stream" });
        let isSettled = false;
        let hasRenderedChunk = false;
        const originalHtml = selection.node.innerHTML;

        function finish() {
            if (isSettled) return;
            isSettled = true;

            try {
                port.disconnect();
            } catch (_error) {
                // Ignore disconnect races while the stream is shutting down.
            }

            resolve();
        }

        port.onMessage.addListener((message) => {
            if (message?.type === "error") {
                console.error("OpenAI translation error:", message.error);
                if (!hasRenderedChunk && selection.node.isConnected) {
                    restoreOriginalParagraphHtml(selection.node, originalHtml);
                }
                finish();
                return;
            }

            if (message?.type !== "chunk" && message?.type !== "done") {
                return;
            }

            const translatedHtml = String(message?.translation?.html ?? "").trim();
            if (!translatedHtml) {
                return;
            }

            if (!selection.node.isConnected) {
                finish();
                return;
            }

            hasRenderedChunk = true;
            injectTranslatedHtml(selection.node, translatedHtml);

            if (message.type === "done") {
                applyAlignmentMarkup(
                    selection.node,
                    message?.translation?.alignments,
                    settings.selectedLanguage
                );
            }

            if (message.type === "done") {
                finish();
            }
        });

        port.onDisconnect.addListener(() => {
            if (isSettled) {
                return;
            }

            const streamError = chrome.runtime.lastError?.message;
            if (streamError) {
                console.error("Translation stream disconnected:", streamError);
            } else {
                console.error("Translation stream disconnected before completion.");
            }
            if (!hasRenderedChunk && selection.node.isConnected) {
                restoreOriginalParagraphHtml(selection.node, originalHtml);
            }
            resolve();
        });

        port.postMessage({
            type: "TRANSLATE_PHRASES_STREAM",
            payload: {
                rawText: selection.rawText,
                splitText: selection.splitText,
                targetLanguage: settings.selectedLanguage,
                translationLevel: settings.translationLevel,
                phraseMinWords: settings.phraseMinWords,
                phraseMaxWords: settings.phraseMaxWords,
                phraseCoveragePercent: settings.phraseCoveragePercent,
                phraseLengthTemperature: settings.phraseLengthTemperature,
            },
        });
    });
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
        return normalizeSettings(await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
    } catch (error) {
        console.error("Failed to load highlighting settings:", error);
        return { ...DEFAULT_SETTINGS };
    }
}

async function init() {
    const settings = await loadSettings();
    installAlignmentInteractions();
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
