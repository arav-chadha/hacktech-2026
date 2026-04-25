import {
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  READER_KNOWLEDGE_LEVEL_STORAGE_KEY,
  normalizeSettings,
} from "../shared/settings";

const processedParagraphs = new WeakSet();
const PROCESSED_ATTR = "data-language-extension-processed";
const TRANSLATED_ATTR = "data-language-extension-translation";
const WORD_PATTERN = /\b[\p{L}\p{N}'’-]+\b/gu;
const MIN_WORDS_PER_PHRASE = 2;
const MAX_WORDS_PER_PHRASE = 4;
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
  `[${TRANSLATED_ATTR}]`,
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

  return text.length + paragraphs * 200 - links * 40 - controls * 150;
}

function getWordMatches(text) {
  return Array.from(String(text ?? "").matchAll(WORD_PATTERN));
}

function getTextNodeSentence(text, startOffset, endOffset) {
  const sentencePattern = /[^.!?\n]+[.!?\n]*/g;
  let match;

  while ((match = sentencePattern.exec(text)) !== null) {
    const sentenceStart = match.index;
    const sentenceEnd = sentenceStart + match[0].length;
    if (startOffset >= sentenceStart && endOffset <= sentenceEnd) {
      return match[0].trim();
    }
  }

  return text.trim();
}

function buildPhraseCandidatesFromTextNode(node, paragraphIndex, nodeIndex) {
  const text = node.nodeValue || "";
  const wordMatches = getWordMatches(text);
  if (wordMatches.length < MIN_WORDS_PER_PHRASE) {
    return [];
  }

  const candidates = [];
  let wordIndex = 0;
  let candidateIndex = 0;

  while (wordIndex < wordMatches.length) {
    const remaining = wordMatches.length - wordIndex;
    if (remaining < MIN_WORDS_PER_PHRASE) {
      break;
    }

    const size = Math.min(MAX_WORDS_PER_PHRASE, remaining);
    const startMatch = wordMatches[wordIndex];
    const endMatch = wordMatches[wordIndex + size - 1];
    const startOffset = startMatch.index ?? 0;
    const endOffset = (endMatch.index ?? 0) + endMatch[0].length;
    const phraseText = text.slice(startOffset, endOffset).trim();

    if (getWordMatches(phraseText).length >= MIN_WORDS_PER_PHRASE) {
      candidates.push({
        id: `p${paragraphIndex}-n${nodeIndex}-c${candidateIndex}`,
        node,
        startOffset,
        endOffset,
        text: phraseText,
        contextSentence: getTextNodeSentence(text, startOffset, endOffset),
      });
      candidateIndex += 1;
    }

    wordIndex += size;
  }

  return candidates;
}

function getCandidateTextNodes(paragraph) {
  const walker = document.createTreeWalker(
    paragraph,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(EXCLUDED_CONTAINER_SELECTOR)) return NodeFilter.FILTER_REJECT;
        if (!normalizeWhitespace(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  return textNodes;
}

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function isValidParagraphNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

  const paragraph = node;
  if (!(paragraph instanceof HTMLParagraphElement)) return false;
  if (paragraph.matches(EXCLUDED_CONTAINER_SELECTOR)) return false;

  const text = normalizeWhitespace(paragraph.innerText || paragraph.textContent || "");
  if (!text) return false;
  if (getWordMatches(text).length < MIN_WORDS_PER_PHRASE) return false;

  return true;
}

function buildParagraphSelection(node, paragraphIndex) {
  if (!isValidParagraphNode(node)) return null;
  if (processedParagraphs.has(node)) return null;

  const paragraph = node;
  processedParagraphs.add(paragraph);

  const textNodes = getCandidateTextNodes(paragraph);
  const candidates = textNodes.flatMap((textNode, nodeIndex) =>
    buildPhraseCandidatesFromTextNode(textNode, paragraphIndex, nodeIndex)
  );

  if (candidates.length === 0) {
    paragraph.setAttribute(PROCESSED_ATTR, "true");
    return null;
  }

  return {
    paragraph,
    candidates,
  };
}

function applyTranslatedPhrases(selection, translatedPhrases, targetLanguage) {
  const translatedById = new Map(
    translatedPhrases
      .filter((entry) => entry && typeof entry.id === "string" && typeof entry.translatedText === "string")
      .map((entry) => [entry.id, entry.translatedText.trim()])
      .filter(([, translatedText]) => Boolean(translatedText))
  );

  const replacementsByNode = new Map();

  for (const candidate of selection.candidates) {
    const translatedText = translatedById.get(candidate.id);
    if (!translatedText) continue;

    const nodeReplacements = replacementsByNode.get(candidate.node) ?? [];
    nodeReplacements.push({
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      translatedText,
    });
    replacementsByNode.set(candidate.node, nodeReplacements);
  }

  for (const [textNode, replacements] of replacementsByNode.entries()) {
    if (!textNode.isConnected) continue;

    replacements.sort((left, right) => right.startOffset - left.startOffset);
    let workingNode = textNode;

    for (const replacement of replacements) {
      const currentText = workingNode.nodeValue || "";
      if (replacement.endOffset > currentText.length) {
        continue;
      }

      workingNode.splitText(replacement.endOffset);
      const phraseNode = workingNode.splitText(replacement.startOffset);
      const translationSpan = document.createElement("span");
      translationSpan.setAttribute(TRANSLATED_ATTR, "true");
      translationSpan.setAttribute("lang", targetLanguage);
      translationSpan.textContent = replacement.translatedText;
      phraseNode.parentNode?.replaceChild(translationSpan, phraseNode);
    }
  }

  selection.paragraph.setAttribute(PROCESSED_ATTR, "true");
}

async function requestTranslations(selection, settings) {
  const response = await chrome.runtime.sendMessage({
    type: "SELECT_AND_TRANSLATE_PHRASES",
    payload: {
      pageUrl: window.location.href,
      targetLanguage: settings.selectedLanguage,
      readerKnowledgeLevel: settings.readerKnowledgeLevel,
      candidates: selection.candidates.map((candidate) => ({
        id: candidate.id,
        text: candidate.text,
        contextSentence: candidate.contextSentence,
      })),
    },
  });

  if (response?.error) {
    throw new Error(response.error);
  }

  return Array.isArray(response?.translatedPhrases) ? response.translatedPhrases : [];
}

async function processParagraphList(nodes, settings) {
  const selections = nodes
    .map((node, index) => buildParagraphSelection(node, index))
    .filter(Boolean);

  for (const selection of selections) {
    try {
      const translatedPhrases = await requestTranslations(selection, settings);
      applyTranslatedPhrases(selection, translatedPhrases, settings.selectedLanguage);
    } catch (error) {
      console.error("Failed to select and translate phrases:", error);
      selection.paragraph.setAttribute(PROCESSED_ATTR, "true");
    }
  }
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
    const storedValues = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const normalizedSettings = normalizeSettings(storedValues);
    return {
      selectedLanguage: normalizedSettings[LANGUAGE_STORAGE_KEY],
      readerKnowledgeLevel: normalizedSettings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY],
    };
  } catch (error) {
    console.error("Failed to load extension settings:", error);
    return {
      selectedLanguage: DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
      readerKnowledgeLevel: DEFAULT_SETTINGS[READER_KNOWLEDGE_LEVEL_STORAGE_KEY],
    };
  }
}

function observeDOM(processingRoot, settings) {
  const observer = new MutationObserver((mutations) => {
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

async function init() {
  const settings = await loadSettings();
  const processingRoot = getProcessingRoot();
  await walkAndProcess(processingRoot, settings);
  observeDOM(processingRoot, settings);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  void init();
}
