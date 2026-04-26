import fs from "node:fs";
import { ensureMongoIndexes, ensureWordEmbeddingIndexes, getCollectionNames, getMongoDatabase, hasMongoConfig } from "./mongo.js";
import { getFirecrawlApiKey } from "./dashboardConfig.js";

const DASHBOARD_LANGUAGES = [
  { code: "es", label: "Spanish", locale: "es-ES", storageValue: "spanish" },
  { code: "fr", label: "French", locale: "fr-FR", storageValue: "french" },
  { code: "ru", label: "Russian", locale: "ru-RU", storageValue: "russian" },
  { code: "zh", label: "Mandarin", locale: "zh-CN", storageValue: "mandarin" },
];

const DASHBOARD_LANGUAGE_BY_CODE = new Map(
  DASHBOARD_LANGUAGES.map((language) => [language.code, language])
);
const DASHBOARD_LANGUAGE_BY_STORAGE_VALUE = new Map(
  DASHBOARD_LANGUAGES.map((language) => [language.storageValue, language])
);

const DASHBOARD_LEVELS = ["Beginner", "Elementary", "Intermediate", "Advanced"];
const DASHBOARD_DEFAULT_SETTINGS = {
  studyLanguageCode: "es",
  learningLevel: "Intermediate",
};
const DASHBOARD_SEMANTIC_PROJECTION_SEED = 42;
const DASHBOARD_SEMANTIC_ANCHOR_SIMILARITY_FLOOR = 0.3;
const DASHBOARD_SEMANTIC_ROOT_URL = new URL("../dashboard/src/lib/", import.meta.url);
const DASHBOARD_SEMANTIC_SNAPSHOT_CANDIDATES = {
  anchor: [
    "anchor-meanings.snapshots.json",
    "anchor-meanings.snapshot.json",
    "anchor-meaning.snapshots.json",
    "anchor-meaning.snapshot.json",
  ],
  learned: [
    "learned-meaning.snapshots.json",
    "learned-meanings.snapshots.json",
    "learned-words.snapshots.json",
    "learned-words.snapshot.json",
  ],
};
const DASHBOARD_DISCOVER_ARTICLE_LIMIT = 3;
const DASHBOARD_DISCOVER_SEARCH_LIMIT = 6;
const DASHBOARD_DISCOVER_FALLBACK_QUERY = "short article";
const DASHBOARD_DISCOVER_BLOCKED_HOST_PATTERNS = [
  "dictionary",
  "thesaurus",
  "wiktionary",
  "wikipedia",
  "britannica",
  "merriam-webster",
  "cambridge",
  "vocabulary.com",
];
const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const DISCOVER_ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
const DASHBOARD_DISCOVER_WORD_STOPWORDS = new Set([
  "about",
  "after",
  "among",
  "because",
  "being",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "many",
  "more",
  "other",
  "people",
  "short",
  "some",
  "such",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "would",
]);

const STATUS_ORDER = {
  New: 1,
  Practicing: 2,
  Confident: 3,
};

const LEVEL_ORDER = {
  Beginner: 1,
  Elementary: 2,
  Intermediate: 3,
  Advanced: 4,
};

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeSearchQuery(value) {
  return normalizeString(value).toLowerCase();
}

function logDashboardDiscoverEvent(event, details = {}) {
  console.log(`[dashboard-discover] ${event}`, details);
}

function normalizeDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized = value.filter(
    (entry) => typeof entry === "number" && Number.isFinite(entry)
  );

  return normalized.length === value.length ? normalized : null;
}

function normalizeProjectionCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProjectionMetadata(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const algorithm = normalizeString(value.algorithm);
  const dimensions = normalizeInteger(value.dimensions);
  if (!algorithm || !dimensions) {
    return null;
  }

  return {
    algorithm,
    dimensions,
    randomSeed: normalizeInteger(value.randomSeed),
  };
}

function walkDirectoryForBasename(directoryUrl, basename) {
  let entries = [];
  try {
    entries = fs.readdirSync(directoryUrl, { withFileTypes: true });
  } catch {
    return null;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isFile() && entry.name === basename) {
      return new URL(entry.name, directoryUrl);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const nextDirectoryUrl = new URL(`${entry.name}/`, directoryUrl);
    const match = walkDirectoryForBasename(nextDirectoryUrl, basename);
    if (match) {
      return match;
    }
  }

  return null;
}

const semanticSnapshotFileCache = {
  anchor: undefined,
  learned: undefined,
};

function discoverSemanticSnapshotFile(kind) {
  const cachedFile = semanticSnapshotFileCache[kind];
  if (cachedFile) {
    try {
      fs.accessSync(cachedFile, fs.constants.F_OK);
      return cachedFile;
    } catch {
      semanticSnapshotFileCache[kind] = undefined;
    }
  }

  const candidateBasenames = DASHBOARD_SEMANTIC_SNAPSHOT_CANDIDATES[kind] ?? [];
  for (const basename of candidateBasenames) {
    const discoveredFile = walkDirectoryForBasename(DASHBOARD_SEMANTIC_ROOT_URL, basename);
    if (discoveredFile) {
      semanticSnapshotFileCache[kind] = discoveredFile;
      return discoveredFile;
    }
  }

  return null;
}

function normalizeAnchorSnapshotNode(node) {
  if (
    !node ||
    node.kind !== "anchor" ||
    typeof node.id !== "string" ||
    typeof node.label !== "string" ||
    typeof node.definition !== "string" ||
    !Number.isFinite(node.x) ||
    !Number.isFinite(node.y)
  ) {
    return null;
  }

  const embedding = normalizeEmbedding(node.embedding);
  return {
    id: node.id,
    kind: "anchor",
    label: node.label,
    definition: node.definition,
    x: normalizeProjectionCoordinate(node.x),
    y: normalizeProjectionCoordinate(node.y),
    z: normalizeProjectionCoordinate(node.z),
    embedding: embedding ?? undefined,
    tags: Array.isArray(node.tags)
      ? node.tags.filter((tag) => typeof tag === "string")
      : undefined,
    notes: typeof node.notes === "string" ? node.notes : undefined,
  };
}

function normalizeLearnedSnapshotNode(node) {
  if (
    !node ||
    node.kind !== "learned-word" ||
    typeof node.id !== "string" ||
    typeof node.sourceWord !== "string" ||
    typeof node.learnedWord !== "string" ||
    typeof node.languageCode !== "string" ||
    typeof node.anchorId !== "string" ||
    !Number.isFinite(node.x) ||
    !Number.isFinite(node.y)
  ) {
    return null;
  }

  const embedding = normalizeEmbedding(node.embedding);
  return {
    id: node.id,
    kind: "learned-word",
    label: typeof node.label === "string" && node.label ? node.label : node.learnedWord,
    sourceWord: node.sourceWord,
    learnedWord: node.learnedWord,
    languageCode: node.languageCode,
    anchorId: node.anchorId,
    x: normalizeProjectionCoordinate(node.x),
    y: normalizeProjectionCoordinate(node.y),
    z: normalizeProjectionCoordinate(node.z),
    embedding: embedding ?? undefined,
    definition: typeof node.definition === "string" && node.definition ? node.definition : undefined,
    status: typeof node.status === "string" ? node.status : undefined,
    level: typeof node.level === "string" ? node.level : undefined,
    origin: "snapshot",
  };
}

function createEmptySemanticSnapshotData() {
  return {
    schemaVersion: null,
    embeddingModel: null,
    embeddingDimensions: null,
    generatedAt: null,
    projection: null,
    nodes: [],
  };
}

function normalizeSemanticSnapshotData(kind, snapshot) {
  const normalizedSnapshot = createEmptySemanticSnapshotData();
  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];

  normalizedSnapshot.schemaVersion = normalizeInteger(snapshot?.schemaVersion);
  normalizedSnapshot.embeddingModel =
    typeof snapshot?.embeddingModel === "string" && snapshot.embeddingModel
      ? snapshot.embeddingModel
      : null;
  normalizedSnapshot.embeddingDimensions = normalizeInteger(snapshot?.embeddingDimensions);
  normalizedSnapshot.generatedAt = normalizeDate(snapshot?.generatedAt)?.toISOString() ?? null;
  normalizedSnapshot.projection = normalizeProjectionMetadata(snapshot?.projection);
  normalizedSnapshot.nodes = rawNodes
    .map((node) => (kind === "anchor" ? normalizeAnchorSnapshotNode(node) : normalizeLearnedSnapshotNode(node)))
    .filter(Boolean);

  return normalizedSnapshot;
}

const semanticSnapshotDataCache = {
  anchor: undefined,
  learned: undefined,
};

function loadSemanticSnapshotNodes(kind) {
  const discoveredFile = discoverSemanticSnapshotFile(kind);
  if (!discoveredFile) {
    return createEmptySemanticSnapshotData();
  }

  const discoveredFileHref = discoveredFile.href;

  try {
    const discoveredFileTimestamp = fs.statSync(discoveredFile).mtimeMs;
    const cachedSnapshot = semanticSnapshotDataCache[kind];
    if (
      cachedSnapshot?.fileHref === discoveredFileHref &&
      cachedSnapshot?.modifiedTimeMs === discoveredFileTimestamp
    ) {
      return cachedSnapshot.snapshot;
    }

    const rawSnapshot = fs.readFileSync(discoveredFile, "utf8");
    const parsedSnapshot = JSON.parse(rawSnapshot);
    const normalizedSnapshot = normalizeSemanticSnapshotData(kind, parsedSnapshot);
    semanticSnapshotDataCache[kind] = {
      fileHref: discoveredFileHref,
      modifiedTimeMs: discoveredFileTimestamp,
      snapshot: normalizedSnapshot,
    };
    return normalizedSnapshot;
  } catch {
    return createEmptySemanticSnapshotData();
  }
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return -1;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return -1;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function projectEmbeddingToUnitSpace(embedding) {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index] ?? 0;
    x += value * Math.sin((index + 1) * 0.173 + DASHBOARD_SEMANTIC_PROJECTION_SEED);
    y += value * Math.cos((index + 1) * 0.131 + DASHBOARD_SEMANTIC_PROJECTION_SEED * 0.5);
    z += value * Math.sin((index + 1) * 0.097 + DASHBOARD_SEMANTIC_PROJECTION_SEED * 1.5);
  }

  const magnitude = Math.sqrt(x * x + y * y + z * z) || 1;
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
  };
}

function findNearestAnchorWithScore(embedding, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return {
      anchor: null,
      score: -1,
    };
  }

  const eligibleAnchors = anchors.filter(
    (anchor) => Array.isArray(anchor.embedding) && anchor.embedding.length === embedding.length
  );

  if (eligibleAnchors.length === 0) {
    return {
      anchor: null,
      score: -1,
    };
  }

  let nearestAnchor = eligibleAnchors[0] ?? null;
  let bestScore = nearestAnchor ? cosineSimilarity(embedding, nearestAnchor.embedding) : -1;

  for (let index = 1; index < eligibleAnchors.length; index += 1) {
    const candidate = eligibleAnchors[index];
    const score = cosineSimilarity(embedding, candidate.embedding);
    if (score > bestScore) {
      nearestAnchor = candidate;
      bestScore = score;
    }
  }

  return {
    anchor: nearestAnchor,
    score: bestScore,
  };
}

function inverseDistanceSimilarity(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return 1 / (1 + Math.sqrt(dx * dx + dy * dy + dz * dz));
}

function measureSemanticSimilarity(left, right) {
  if (
    Array.isArray(left.embedding) &&
    Array.isArray(right.embedding) &&
    left.embedding.length === right.embedding.length &&
    left.embedding.length > 0
  ) {
    return cosineSimilarity(left.embedding, right.embedding);
  }

  return inverseDistanceSimilarity(left, right);
}

function buildSemanticLearnedNodeKey(node) {
  return [
    normalizeString(node.languageCode).toLowerCase(),
    normalizeString(node.sourceWord).toLowerCase(),
    normalizeString(node.learnedWord).toLowerCase(),
  ].join("::");
}

function mergeSemanticLearnedNodes(snapshotLearnedNodes, databaseLearnedNodes) {
  const mergedNodes = [];
  const seenKeys = new Set();

  function pushNode(node) {
    const nodeKey = buildSemanticLearnedNodeKey(node);
    if (!nodeKey || seenKeys.has(nodeKey)) {
      return;
    }

    seenKeys.add(nodeKey);
    mergedNodes.push(node);
  }

  snapshotLearnedNodes.forEach(pushNode);
  databaseLearnedNodes.forEach(pushNode);

  return mergedNodes;
}

function pickLatestGeneratedAt(...values) {
  const timestamps = values
    .flat()
    .map((value) => normalizeDate(value))
    .filter(Boolean)
    .map((date) => date.getTime());

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function shuffleItems(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function normalizeUrlHost(value) {
  try {
    return new URL(String(value ?? "")).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function stripMarkdownSyntax(value) {
  return String(value ?? "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/!\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countPhraseOccurrences(text, phrase) {
  const normalizedText = normalizeString(text);
  const normalizedPhrase = normalizeString(phrase);

  if (!normalizedText || !normalizedPhrase) {
    return 0;
  }

  const matches = normalizedText.match(
    new RegExp(`\\b${escapeRegExp(normalizedPhrase)}\\b`, "gi")
  );

  return matches?.length ?? 0;
}

function extractFirecrawlMarkdown(result) {
  if (typeof result?.markdown === "string") {
    return result.markdown;
  }

  if (typeof result?.content === "string") {
    return result.content;
  }

  if (typeof result?.rawMarkdown === "string") {
    return result.rawMarkdown;
  }

  return "";
}

function buildDiscoverPreviewText(result, focusWord) {
  const description = normalizeString(result?.description);
  const markdown = stripMarkdownSyntax(extractFirecrawlMarkdown(result));

  if (markdown) {
    const sentences = markdown.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim());
    const matchingSentence = sentences.find(
      (sentence) =>
        sentence.length >= 80 &&
        sentence.toLowerCase().includes(normalizeString(focusWord).toLowerCase())
    );

    if (matchingSentence) {
      return matchingSentence.slice(0, 280);
    }

    if (markdown.length > 0) {
      return markdown.slice(0, 280);
    }
  }

  if (description) {
    return description.slice(0, 220);
  }

  return "A short reading recommendation tied to this focus meaning.";
}

function pickDiscoverWordFromText(value, { allowStopwords = false } = {}) {
  const matches = normalizeString(value).match(DISCOVER_ENGLISH_WORD_PATTERN) ?? [];
  const normalizedMatches = matches.map((word) => word.toLowerCase());
  const preferredWord = normalizedMatches.find(
    (word) => word.length >= 3 && (allowStopwords || !DASHBOARD_DISCOVER_WORD_STOPWORDS.has(word))
  );

  if (preferredWord) {
    return preferredWord;
  }

  return (
    normalizedMatches.find((word) => word.length >= 3) ??
    normalizedMatches.find((word) => word.length >= 2) ??
    normalizedMatches[0] ??
    ""
  );
}

function extractDiscoverInterestWord(anchor) {
  const primaryCandidates = [
    normalizeString(anchor?.label),
    normalizeString(anchor?.id).replace(/[-_]+/g, " "),
  ];

  for (const candidate of primaryCandidates) {
    const pickedWord = pickDiscoverWordFromText(candidate);
    if (pickedWord) {
      return pickedWord;
    }
  }

  return pickDiscoverWordFromText(anchor?.definition, { allowStopwords: false });
}

function buildDiscoverFocusCandidates(snapshotAnchors, learnedCountByAnchorId) {
  return snapshotAnchors
    .map((anchor) => ({
      anchor,
      interestWord: extractDiscoverInterestWord(anchor),
      learnedCount: Number(learnedCountByAnchorId.get(anchor.id) ?? 0),
    }))
    .filter((entry) => entry.interestWord);
}

function pickDiscoverFocusCandidate(snapshotAnchors, learnedCountByAnchorId) {
  const focusCandidates = buildDiscoverFocusCandidates(snapshotAnchors, learnedCountByAnchorId);
  if (focusCandidates.length === 0) {
    return null;
  }

  const untouchedCandidates = focusCandidates.filter((entry) => entry.learnedCount === 0);
  const rankedCandidates = untouchedCandidates.length > 0 ? untouchedCandidates : focusCandidates;
  const minimumLearnedCount = Math.min(...rankedCandidates.map((entry) => entry.learnedCount));
  const lowestExposureCandidates = rankedCandidates.filter(
    (entry) => entry.learnedCount === minimumLearnedCount
  );

  return shuffleItems(lowestExposureCandidates)[0] ?? null;
}

function isBlockedDiscoverResult(result) {
  const host = normalizeUrlHost(result?.url);
  const loweredTitle = normalizeString(result?.title).toLowerCase();

  return DASHBOARD_DISCOVER_BLOCKED_HOST_PATTERNS.some(
    (pattern) => host.includes(pattern) || loweredTitle.includes(pattern)
  );
}

function scoreDiscoverResult(result, focusWord) {
  const title = normalizeString(result?.title);
  const description = normalizeString(result?.description);
  const markdown = stripMarkdownSyntax(extractFirecrawlMarkdown(result));
  const titleMatches = countPhraseOccurrences(title, focusWord);
  const descriptionMatches = countPhraseOccurrences(description, focusWord);
  const markdownMatches = countPhraseOccurrences(markdown, focusWord);

  return (
    titleMatches * 5 +
    descriptionMatches * 3 +
    markdownMatches +
    (markdown.length >= 300 && markdown.length <= 5000 ? 3 : 0)
  );
}

function buildDiscoverSearchQuery(interestWord, mode = "focused") {
  if (mode === "fallback") {
    return DASHBOARD_DISCOVER_FALLBACK_QUERY;
  }

  const normalizedInterestWord = normalizeString(interestWord);
  return normalizedInterestWord
    ? `find short articles with ${normalizedInterestWord} occurring in them`
    : DASHBOARD_DISCOVER_FALLBACK_QUERY;
}

async function runFirecrawlSearch(query, interestWord, mode) {
  const firecrawlApiKey = getFirecrawlApiKey();
  if (!firecrawlApiKey) {
    throw new Error("Missing Firecrawl API key. Set FIRECRAWL_API_KEY in server/local-config.js.");
  }
  logDashboardDiscoverEvent("firecrawl-search-query", {
    interestWord,
    mode,
    query,
  });

  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firecrawlApiKey}`,
      "x-api-key": firecrawlApiKey,
    },
    body: JSON.stringify({
      query,
      limit: DASHBOARD_DISCOVER_SEARCH_LIMIT,
      scrapeOptions: {
        formats: ["markdown"],
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  logDashboardDiscoverEvent("firecrawl-search-response", {
    interestWord,
    mode,
    status: response.status,
    payload,
  });

  if (!response.ok || payload?.success === false) {
    throw new Error(
      normalizeString(payload?.error) || `Firecrawl search failed (${response.status}).`
    );
  }

  const searchResults = Array.isArray(payload?.data?.web)
    ? payload.data.web
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return searchResults;
}

async function searchDiscoverArticlesForWord(interestWord) {
  const focusedQuery = buildDiscoverSearchQuery(interestWord, "focused");
  let searchResults = await runFirecrawlSearch(focusedQuery, interestWord, "focused");

  if (searchResults.length === 0) {
    const fallbackQuery = buildDiscoverSearchQuery(interestWord, "fallback");
    searchResults = await runFirecrawlSearch(fallbackQuery, interestWord, "fallback");
  }

  const normalizedResults = searchResults
    .filter((result) => normalizeString(result?.url) && normalizeString(result?.title))
    .map((result) => ({
      url: normalizeString(result.url),
      title: normalizeString(result.title),
      description: normalizeString(result.description),
      preview: buildDiscoverPreviewText(result, interestWord),
      sourceHost: normalizeUrlHost(result.url),
      blocked: isBlockedDiscoverResult(result),
      score: scoreDiscoverResult(result, interestWord),
    }));

  const rankedPreferredResults = normalizedResults
    .filter((result) => !result.blocked && result.score > 0)
    .sort((left, right) => right.score - left.score);
  const rankedFallbackResults = normalizedResults
    .filter((result) => !result.blocked)
    .sort((left, right) => right.score - left.score);
  const rankedAnyResults = normalizedResults.sort((left, right) => right.score - left.score);
  const chosenResults =
    rankedPreferredResults.length > 0
      ? rankedPreferredResults
      : rankedFallbackResults.length > 0
        ? rankedFallbackResults
        : rankedAnyResults;

  return chosenResults
    .slice(0, DASHBOARD_DISCOVER_ARTICLE_LIMIT)
    .map(({ blocked: _blocked, score: _score, ...result }) => result);
}

async function buildDashboardSemanticSources({ userEmail, settings }) {
  const normalizedEmail = normalizeEmail(userEmail);
  const sanitizedSettings = sanitizeSettings(settings);
  const selectedLanguage = DASHBOARD_LANGUAGE_BY_CODE.get(sanitizedSettings.studyLanguageCode);
  const anchorSnapshot = loadSemanticSnapshotNodes("anchor");
  const learnedSnapshot = loadSemanticSnapshotNodes("learned");
  const snapshotAnchors = anchorSnapshot.nodes;
  const snapshotLearnedNodes = learnedSnapshot.nodes;
  const databaseLearnedNodes = [];
  const databaseGeneratedAtValues = [];

  if (normalizedEmail && selectedLanguage && hasMongoConfig()) {
    await ensureWordEmbeddingIndexes();
    const db = await getMongoDatabase();

    if (db) {
      const { wordEmbeddings } = getCollectionNames();
      const embeddingDocuments = await db.collection(wordEmbeddings)
        .find(
          {
            userEmailLower: normalizedEmail,
            targetLanguage: selectedLanguage.storageValue,
          },
          {
            projection: {
              _id: 0,
              word: 1,
              sourceWord: 1,
              embedding: 1,
              updatedAt: 1,
              createdAt: 1,
            },
          }
        )
        .toArray();

      for (const [index, document] of embeddingDocuments.entries()) {
        const learnedWord = normalizeString(document?.word);
        const sourceWord = normalizeString(document?.sourceWord) || learnedWord;
        const embedding = normalizeEmbedding(document?.embedding);

        if (!learnedWord || !embedding) {
          continue;
        }

        const { anchor: nearestAnchor, score: nearestAnchorScore } = findNearestAnchorWithScore(
          embedding,
          snapshotAnchors
        );
        const projectedPoint = projectEmbeddingToUnitSpace(embedding);
        const anchorX = nearestAnchor?.x ?? 0;
        const anchorY = nearestAnchor?.y ?? 0;
        const anchorZ = nearestAnchor?.z ?? 0;
        const isNearEnoughToAnchor = nearestAnchorScore >= DASHBOARD_SEMANTIC_ANCHOR_SIMILARITY_FLOOR;
        const generatedAt =
          normalizeDate(document?.updatedAt)?.toISOString() ??
          normalizeDate(document?.createdAt)?.toISOString() ??
          null;

        if (generatedAt) {
          databaseGeneratedAtValues.push(generatedAt);
        }

        databaseLearnedNodes.push({
          id: `${selectedLanguage.code}-${index + 1}-${learnedWord.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`,
          kind: "learned-word",
          label: learnedWord,
          sourceWord,
          learnedWord,
          languageCode: selectedLanguage.code,
          anchorId: isNearEnoughToAnchor ? nearestAnchor?.id ?? "" : "",
          x: anchorX + projectedPoint.x * 2.8,
          y: anchorY + projectedPoint.y * 2.8,
          z: anchorZ + projectedPoint.z * 2.8,
          embedding,
          definition: nearestAnchor?.definition ?? `Embedded ${selectedLanguage.label} vocabulary.`,
          level: sanitizedSettings.learningLevel,
          status: "Practicing",
          origin: "database",
        });
      }
    }
  }

  return {
    normalizedEmail,
    sanitizedSettings,
    selectedLanguage,
    anchorSnapshot,
    learnedSnapshot,
    snapshotAnchors,
    snapshotLearnedNodes,
    databaseLearnedNodes,
    databaseGeneratedAtValues,
  };
}

function buildSemanticNeighborLinks(learnedNodes, anchors) {
  const links = [];
  const linkKeys = new Set();
  const anchorIds = new Set(anchors.map((anchor) => anchor.id));
  const neighborCount = Math.min(4, Math.max(1, learnedNodes.length - 1));

  function pushLink(source, target) {
    if (!source || !target || source === target) {
      return;
    }

    const [first, second] = [source, target].sort();
    const key = `${first}__${second}`;
    if (linkKeys.has(key)) {
      return;
    }

    linkKeys.add(key);
    links.push({ source, target });
  }

  learnedNodes.forEach((node) => {
    if (anchorIds.has(node.anchorId)) {
      pushLink(node.anchorId, node.id);
    }

    const nearestNeighbors = learnedNodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        id: candidate.id,
        score: measureSemanticSimilarity(node, candidate),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, neighborCount);

    nearestNeighbors.forEach((neighbor) => {
      pushLink(node.id, neighbor.id);
    });
  });

  return links;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcDateFromIsoDate(isoDate) {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function startOfTodayUtc() {
  return utcDateFromIsoDate(toIsoDate(new Date()));
}

function clampLearningLevel(value) {
  return DASHBOARD_LEVELS.includes(value) ? value : DASHBOARD_DEFAULT_SETTINGS.learningLevel;
}

function clampStudyLanguageCode(value) {
  return DASHBOARD_LANGUAGE_BY_CODE.has(value)
    ? value
    : DASHBOARD_DEFAULT_SETTINGS.studyLanguageCode;
}

function sanitizeSettings(settings) {
  const safeSettings =
    settings && typeof settings === "object"
      ? settings
      : DASHBOARD_DEFAULT_SETTINGS;

  return {
    studyLanguageCode: clampStudyLanguageCode(normalizeString(safeSettings.studyLanguageCode)),
    learningLevel: clampLearningLevel(normalizeString(safeSettings.learningLevel)),
  };
}

function buildEmptyOverview(activeLevel) {
  return {
    wordsLearned: 0,
    discoveredToday: 0,
    streakDays: 0,
    activeLevel,
    progressSeries: [],
    recentActivity: [],
  };
}

function getProgressWindowSize(range) {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  return null;
}

function buildStatus(clickCount) {
  const normalizedClickCount = Number(clickCount ?? 0);
  if (normalizedClickCount >= 5) {
    return "Confident";
  }

  if (normalizedClickCount >= 2) {
    return "Practicing";
  }

  return "New";
}

function getLanguageMetadataFromStorageValue(targetLanguage) {
  return DASHBOARD_LANGUAGE_BY_STORAGE_VALUE.get(normalizeString(targetLanguage).toLowerCase()) ?? null;
}

function formatRelativeDateLabel(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) {
    return "Recently";
  }

  const today = startOfTodayUtc();
  const activityDay = utcDateFromIsoDate(toIsoDate(normalizedDate));
  const differenceInDays = Math.round((today.getTime() - activityDay.getTime()) / 86_400_000);

  if (differenceInDays <= 0) {
    return "Today";
  }

  if (differenceInDays === 1) {
    return "Yesterday";
  }

  return `${differenceInDays} days ago`;
}

function getActivityTimestamp(document) {
  return (
    normalizeDate(document?.lastClickedAt) ||
    normalizeDate(document?.updatedAt) ||
    normalizeDate(document?.createdAt)
  );
}

function buildRecentActivity(documents, languageLabel) {
  return documents
    .map((document) => {
      const activityDate = getActivityTimestamp(document);
      const clickCount = Number(document?.clickCount ?? 0);
      const sourceWord = normalizeString(document?.sourceWord) || "word";
      const isFreshWord = clickCount <= 1;

      return {
        id: `${normalizeString(document?._id)}-${sourceWord.toLowerCase()}`,
        title: isFreshWord ? `Discovered ${sourceWord}` : `Reviewed ${sourceWord}`,
        detail: isFreshWord
          ? `Added to your ${languageLabel} dashboard history.`
          : `${clickCount} total interactions recorded for this ${languageLabel} word.`,
        dateLabel: formatRelativeDateLabel(activityDate),
        activityDate,
      };
    })
    .sort((left, right) => {
      const leftTime = left.activityDate?.getTime() ?? 0;
      const rightTime = right.activityDate?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 5)
    .map(({ activityDate: _activityDate, ...item }) => item);
}

function buildProgressSeries(documents, range) {
  const createdDates = documents
    .map((document) => normalizeDate(document?.createdAt))
    .filter(Boolean);

  if (createdDates.length === 0) {
    return [];
  }

  const dailyCounts = new Map();
  for (const createdAt of createdDates) {
    const isoDate = toIsoDate(createdAt);
    dailyCounts.set(isoDate, Number(dailyCounts.get(isoDate) ?? 0) + 1);
  }

  const sortedDates = Array.from(dailyCounts.keys()).sort();
  const fullSeries = [];
  const firstDate = utcDateFromIsoDate(sortedDates[0]);
  const today = startOfTodayUtc();
  let cumulativeWords = 0;

  for (
    let cursor = new Date(firstDate);
    cursor.getTime() <= today.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const isoDate = toIsoDate(cursor);
    const discoveredWords = Number(dailyCounts.get(isoDate) ?? 0);
    cumulativeWords += discoveredWords;
    fullSeries.push({
      date: isoDate,
      discoveredWords,
      cumulativeWords,
    });
  }

  const rangeWindow = getProgressWindowSize(range);
  return rangeWindow ? fullSeries.slice(-rangeWindow) : fullSeries;
}

function buildStreakDays(documents) {
  const activeDays = new Set(
    documents
      .map((document) => getActivityTimestamp(document))
      .filter(Boolean)
      .map((date) => toIsoDate(date))
  );

  if (activeDays.size === 0) {
    return 0;
  }

  let streakDays = 0;
  for (
    let cursor = startOfTodayUtc();
    activeDays.has(toIsoDate(cursor));
    cursor = new Date(cursor.getTime() - 86_400_000)
  ) {
    streakDays += 1;
  }

  return streakDays;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVocabularySort(filters) {
  return (left, right) => {
    let comparison = 0;

    if (filters.sortBy === "dateDiscovered") {
      comparison = left.dateDiscovered.localeCompare(right.dateDiscovered);
    } else if (filters.sortBy === "sourceWord") {
      comparison = left.sourceWord.localeCompare(right.sourceWord);
    } else if (filters.sortBy === "learnedWord") {
      comparison = left.learnedWord.localeCompare(right.learnedWord);
    } else if (filters.sortBy === "level") {
      comparison = LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level];
    } else if (filters.sortBy === "status") {
      comparison = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    }

    if (comparison === 0) {
      comparison = left.sourceWord.localeCompare(right.sourceWord);
    }

    return filters.sortDirection === "asc" ? comparison : comparison * -1;
  };
}

async function getDashboardCollection(collectionKey) {
  if (!hasMongoConfig()) {
    return null;
  }

  await ensureMongoIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return null;
  }

  const collectionNames = getCollectionNames();
  return db.collection(collectionNames[collectionKey]);
}

async function getDashboardCollections(...collectionKeys) {
  if (!hasMongoConfig()) {
    return null;
  }

  await ensureMongoIndexes();
  await ensureWordEmbeddingIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return null;
  }

  const collectionNames = getCollectionNames();
  return Object.fromEntries(
    collectionKeys.map((collectionKey) => [collectionKey, db.collection(collectionNames[collectionKey])])
  );
}

export function getDashboardLanguages() {
  return DASHBOARD_LANGUAGES.map(({ code, label, locale }) => ({
    code,
    label,
    locale,
  }));
}

export function sanitizeDashboardSettings(input) {
  return sanitizeSettings(input);
}

export async function getDashboardSettings({ userEmail }) {
  const normalizedEmail = normalizeEmail(userEmail);
  if (!normalizedEmail) {
    return sanitizeSettings();
  }

  const collection = await getDashboardCollection("dashboardUserSettings");
  if (!collection) {
    return sanitizeSettings();
  }

  const document = await collection.findOne(
    { userEmailLower: normalizedEmail },
    {
      projection: {
        _id: 0,
        studyLanguageCode: 1,
        learningLevel: 1,
      },
    }
  );

  return sanitizeSettings(document);
}

export async function upsertDashboardSettings({ userEmail, settings }) {
  const normalizedEmail = normalizeEmail(userEmail);
  const sanitizedSettings = sanitizeSettings(settings);

  if (!normalizedEmail) {
    return sanitizedSettings;
  }

  const collection = await getDashboardCollection("dashboardUserSettings");
  if (!collection) {
    return sanitizedSettings;
  }

  const now = new Date();

  await collection.updateOne(
    { userEmailLower: normalizedEmail },
    {
      $setOnInsert: {
        createdAt: now,
        userEmailLower: normalizedEmail,
      },
      $set: {
        updatedAt: now,
        studyLanguageCode: sanitizedSettings.studyLanguageCode,
        learningLevel: sanitizedSettings.learningLevel,
      },
    },
    { upsert: true }
  );

  return sanitizedSettings;
}

export async function getDashboardOverview({ userEmail, range, settings }) {
  const normalizedEmail = normalizeEmail(userEmail);
  const sanitizedSettings = sanitizeSettings(settings);
  const activeLevel = sanitizedSettings.learningLevel;
  const selectedLanguage = DASHBOARD_LANGUAGE_BY_CODE.get(sanitizedSettings.studyLanguageCode);

  if (!normalizedEmail || !selectedLanguage) {
    return buildEmptyOverview(activeLevel);
  }

  const collection = await getDashboardCollection("userWordStats");
  if (!collection) {
    return buildEmptyOverview(activeLevel);
  }

  const documents = await collection
    .find(
      {
        userEmailLower: normalizedEmail,
        targetLanguage: selectedLanguage.storageValue,
      },
      {
        projection: {
          _id: 1,
          sourceWord: 1,
          clickCount: 1,
          createdAt: 1,
          updatedAt: 1,
          lastClickedAt: 1,
        },
      }
    )
    .toArray();

  if (documents.length === 0) {
    return buildEmptyOverview(activeLevel);
  }

  const todayIsoDate = toIsoDate(new Date());
  const discoveredToday = documents.filter(
    (document) => toIsoDate(normalizeDate(document.createdAt) ?? new Date(0)) === todayIsoDate
  ).length;

  return {
    wordsLearned: documents.length,
    discoveredToday,
    streakDays: buildStreakDays(documents),
    activeLevel,
    progressSeries: buildProgressSeries(documents, range),
    recentActivity: buildRecentActivity(documents, selectedLanguage.label),
  };
}

export async function getDashboardVocabularyEntries({
  userEmail,
  filters,
  settings,
}) {
  const normalizedEmail = normalizeEmail(userEmail);
  const sanitizedSettings = sanitizeSettings(settings);

  if (!normalizedEmail) {
    return [];
  }

  const collections = await getDashboardCollections("userWordStats", "wordEmbeddings");
  if (!collections) {
    return [];
  }
  const { userWordStats: wordStatsCollection, wordEmbeddings: wordEmbeddingsCollection } = collections;

  const searchQuery = normalizeSearchQuery(filters?.searchQuery);
  const requestedLanguageCode = normalizeString(filters?.languageCode || "all");
  const requestedLevel = normalizeString(filters?.level || "all");
  const requestedStatus = normalizeString(filters?.status || "all");
  const sortBy = normalizeString(filters?.sortBy || "dateDiscovered");
  const sortDirection = normalizeString(filters?.sortDirection || "desc") === "asc" ? "asc" : "desc";

  const allowedLanguageCodes =
    requestedLanguageCode === "all"
      ? DASHBOARD_LANGUAGES.map((language) => language.code)
      : [clampStudyLanguageCode(requestedLanguageCode)];
  const allowedTargetLanguages = allowedLanguageCodes
    .map((languageCode) => DASHBOARD_LANGUAGE_BY_CODE.get(languageCode)?.storageValue)
    .filter(Boolean);

  const query = {
    userEmailLower: normalizedEmail,
    targetLanguage: { $in: allowedTargetLanguages },
  };

  if (searchQuery) {
    query.$or = [
      { sourceWord: { $regex: escapeRegExp(searchQuery), $options: "i" } },
      { sourceWordNormalized: { $regex: escapeRegExp(searchQuery), $options: "i" } },
    ];
  }

  const documents = await wordStatsCollection
    .find(query, {
      projection: {
        _id: 1,
        sourceWord: 1,
        sourceWordNormalized: 1,
        targetLanguage: 1,
        clickCount: 1,
        createdAt: 1,
        updatedAt: 1,
        lastClickedAt: 1,
      },
    })
    .toArray();

  const embeddingDocuments = await wordEmbeddingsCollection
    .find(
      {
        userEmailLower: normalizedEmail,
        targetLanguage: { $in: allowedTargetLanguages },
      },
      {
        projection: {
          _id: 0,
          targetLanguage: 1,
          sourceWord: 1,
          sourceWordNormalized: 1,
          word: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      }
    )
    .toArray();

  const embeddingsBySourceKey = new Map();
  for (const embeddingDocument of embeddingDocuments) {
    const embeddingTargetLanguage = normalizeString(embeddingDocument?.targetLanguage);
    const embeddingSourceWordNormalized =
      normalizeString(embeddingDocument?.sourceWordNormalized).toLowerCase() ||
      normalizeString(embeddingDocument?.sourceWord).toLowerCase();
    const learnedWord = normalizeString(embeddingDocument?.word);

    if (!embeddingTargetLanguage || !embeddingSourceWordNormalized || !learnedWord) {
      continue;
    }

    const embeddingKey = `${embeddingTargetLanguage}::${embeddingSourceWordNormalized}`;
    const existingEmbedding = embeddingsBySourceKey.get(embeddingKey);
    const existingTimestamp = normalizeDate(existingEmbedding?.updatedAt)?.getTime() ??
      normalizeDate(existingEmbedding?.createdAt)?.getTime() ??
      0;
    const nextTimestamp = normalizeDate(embeddingDocument?.updatedAt)?.getTime() ??
      normalizeDate(embeddingDocument?.createdAt)?.getTime() ??
      0;

    if (!existingEmbedding || nextTimestamp >= existingTimestamp) {
      embeddingsBySourceKey.set(embeddingKey, embeddingDocument);
    }
  }

  const entries = documents
    .map((document) => {
      const language = getLanguageMetadataFromStorageValue(document.targetLanguage);
      if (!language) {
        return null;
      }

      const status = buildStatus(document.clickCount);
      const level = sanitizedSettings.learningLevel;
      const sourceWord = normalizeString(document.sourceWord);
      const sourceWordNormalized =
        normalizeString(document.sourceWordNormalized).toLowerCase() || sourceWord.toLowerCase();
      const embeddingKey = `${normalizeString(document.targetLanguage)}::${sourceWordNormalized}`;
      const embeddingDocument = embeddingsBySourceKey.get(embeddingKey);
      const learnedWord = normalizeString(embeddingDocument?.word) || "Translation not captured yet";

      return {
        id: String(document._id),
        sourceWord,
        learnedWord,
        languageCode: language.code,
        languageLabel: language.label,
        level,
        dateDiscovered: toIsoDate(normalizeDate(document.createdAt) ?? new Date()),
        status,
      };
    })
    .filter(Boolean)
    .filter((entry) => {
      const matchesQuery =
        searchQuery.length === 0 ||
        entry.sourceWord.toLowerCase().includes(searchQuery) ||
        entry.learnedWord.toLowerCase().includes(searchQuery);
      const matchesLevel = requestedLevel === "all" || entry.level === requestedLevel;
      const matchesStatus = requestedStatus === "all" || entry.status === requestedStatus;
      return matchesQuery && matchesLevel && matchesStatus;
    })
    .sort(
      buildVocabularySort({
        sortBy,
        sortDirection,
      })
    );

  return entries;
}

export async function getDashboardSemanticMap({ userEmail, settings }) {
  const {
    anchorSnapshot,
    learnedSnapshot,
    snapshotAnchors,
    snapshotLearnedNodes,
    databaseLearnedNodes,
    databaseGeneratedAtValues,
  } = await buildDashboardSemanticSources({
    userEmail,
    settings,
  });

  const learnedNodes = mergeSemanticLearnedNodes(snapshotLearnedNodes, databaseLearnedNodes);
  const usedAnchorIds = new Set(
    learnedNodes
      .map((node) => normalizeString(node.anchorId))
      .filter(Boolean)
  );
  const activeAnchors = snapshotAnchors.filter((anchor) => usedAnchorIds.has(anchor.id));

  if (activeAnchors.length === 0 && learnedNodes.length === 0) {
    return null;
  }

  const links = buildSemanticNeighborLinks(learnedNodes, activeAnchors);
  const generatedAt =
    pickLatestGeneratedAt(
      learnedSnapshot.generatedAt,
      anchorSnapshot.generatedAt,
      databaseGeneratedAtValues
    ) ?? new Date().toISOString();
  const hasDatabaseLearnedNodes = databaseLearnedNodes.length > 0;
  const embeddingDimensions =
    learnedSnapshot.embeddingDimensions ??
    anchorSnapshot.embeddingDimensions ??
    learnedNodes.find((node) => Array.isArray(node.embedding))?.embedding?.length ??
    activeAnchors.find((node) => Array.isArray(node.embedding))?.embedding?.length ??
    null;

  return {
    schemaVersion:
      learnedSnapshot.schemaVersion ??
      anchorSnapshot.schemaVersion ??
      1,
    embeddingModel:
      learnedSnapshot.embeddingModel ??
      anchorSnapshot.embeddingModel ??
      (hasDatabaseLearnedNodes ? "text-embedding-3-small" : null),
    embeddingDimensions,
    generatedAt,
    projection:
      learnedSnapshot.projection ??
      anchorSnapshot.projection ??
      (hasDatabaseLearnedNodes
        ? {
            algorithm: "anchor-relative-random-projection",
            dimensions: 3,
            randomSeed: DASHBOARD_SEMANTIC_PROJECTION_SEED,
          }
        : null),
    nodes: [
      ...activeAnchors,
      ...learnedNodes,
    ],
    links,
  };
}

export async function getDashboardDiscoverRecommendation({ userEmail, settings }) {
  const {
    sanitizedSettings,
    selectedLanguage,
    snapshotAnchors,
    snapshotLearnedNodes,
    databaseLearnedNodes,
  } = await buildDashboardSemanticSources({
    userEmail,
    settings,
  });

  if (!selectedLanguage || snapshotAnchors.length === 0) {
    return null;
  }

  const learnedNodes = mergeSemanticLearnedNodes(snapshotLearnedNodes, databaseLearnedNodes).filter(
    (node) => node.languageCode === selectedLanguage.code
  );
  const learnedCountByAnchorId = new Map();

  for (const node of learnedNodes) {
    const anchorId = normalizeString(node.anchorId);
    if (!anchorId) {
      continue;
    }

    learnedCountByAnchorId.set(anchorId, Number(learnedCountByAnchorId.get(anchorId) ?? 0) + 1);
  }

  const untouchedAnchors = snapshotAnchors.filter(
    (anchor) => Number(learnedCountByAnchorId.get(anchor.id) ?? 0) === 0
  );
  const fallbackFocusAnchor =
    untouchedAnchors[0] ??
    [...snapshotAnchors].sort((left, right) => {
      const leftCount = Number(learnedCountByAnchorId.get(left.id) ?? 0);
      const rightCount = Number(learnedCountByAnchorId.get(right.id) ?? 0);

      if (leftCount !== rightCount) {
        return leftCount - rightCount;
      }

      return left.label.localeCompare(right.label);
    })[0] ??
    null;
  const focusCandidate = pickDiscoverFocusCandidate(snapshotAnchors, learnedCountByAnchorId);
  const focusAnchor = focusCandidate?.anchor ?? fallbackFocusAnchor;
  const interestWord =
    focusCandidate?.interestWord ??
    extractDiscoverInterestWord(fallbackFocusAnchor) ??
    "";

  if (!focusAnchor || !interestWord) {
    return null;
  }

  const articles = await searchDiscoverArticlesForWord(interestWord);

  return {
    focusAnchorId: focusAnchor.id,
    focusWord: interestWord,
    focusDefinition: focusAnchor.definition,
    focusTags: Array.isArray(focusAnchor.tags) ? focusAnchor.tags : [],
    studyLanguageCode: selectedLanguage.code,
    studyLanguageLabel: selectedLanguage.label,
    learningLevel: sanitizedSettings.learningLevel,
    generatedAt: new Date().toISOString(),
    articles,
  };
}
