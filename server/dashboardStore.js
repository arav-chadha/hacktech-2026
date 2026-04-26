import fs from "node:fs";
import { ensureMongoIndexes, ensureWordEmbeddingIndexes, getCollectionNames, getMongoDatabase, hasMongoConfig } from "./mongo.js";

const DASHBOARD_LANGUAGES = [
  { code: "es", label: "Spanish", locale: "es-ES", storageValue: "spanish" },
  { code: "fr", label: "French", locale: "fr-FR", storageValue: "french" },
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
const DASHBOARD_SEMANTIC_ANCHOR_SNAPSHOT_URL = new URL(
  "../dashboard/src/lib/data/semantic/anchor-meanings.snapshot.json",
  import.meta.url
);

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

let semanticAnchorSnapshotCache = null;

function getSemanticAnchorNodes() {
  if (semanticAnchorSnapshotCache) {
    return semanticAnchorSnapshotCache;
  }

  try {
    const rawSnapshot = fs.readFileSync(DASHBOARD_SEMANTIC_ANCHOR_SNAPSHOT_URL, "utf8");
    const parsedSnapshot = JSON.parse(rawSnapshot);
    const rawNodes = Array.isArray(parsedSnapshot?.nodes) ? parsedSnapshot.nodes : [];

    semanticAnchorSnapshotCache = rawNodes
      .filter((node) => node && typeof node === "object" && node.kind === "anchor")
      .map((node) => {
        const embedding = normalizeEmbedding(node.embedding);
        if (
          typeof node.id !== "string" ||
          typeof node.label !== "string" ||
          typeof node.definition !== "string" ||
          !embedding
        ) {
          return null;
        }

        return {
          id: node.id,
          kind: "anchor",
          label: node.label,
          definition: node.definition,
          x: normalizeProjectionCoordinate(node.x),
          y: normalizeProjectionCoordinate(node.y),
          z: normalizeProjectionCoordinate(node.z),
          embedding,
          tags: Array.isArray(node.tags)
            ? node.tags.filter((tag) => typeof tag === "string")
            : undefined,
          notes: typeof node.notes === "string" ? node.notes : undefined,
        };
      })
      .filter(Boolean);
  } catch {
    semanticAnchorSnapshotCache = [];
  }

  return semanticAnchorSnapshotCache;
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

function findNearestAnchor(embedding, anchors) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return null;
  }

  let nearestAnchor = anchors[0] ?? null;
  let bestScore = nearestAnchor ? cosineSimilarity(embedding, nearestAnchor.embedding) : -1;

  for (let index = 1; index < anchors.length; index += 1) {
    const candidate = anchors[index];
    const score = cosineSimilarity(embedding, candidate.embedding);
    if (score > bestScore) {
      nearestAnchor = candidate;
      bestScore = score;
    }
  }

  return nearestAnchor;
}

function buildSemanticNeighborLinks(nodes) {
  const links = [];
  const linkKeys = new Set();
  const neighborCount = Math.min(4, Math.max(1, nodes.length - 1));

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

  nodes.forEach((node) => {
    pushLink(node.anchorId, node.id);

    const nearestNeighbors = nodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        id: candidate.id,
        score: cosineSimilarity(node.embedding ?? [], candidate.embedding ?? []),
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
  const normalizedEmail = normalizeEmail(userEmail);
  const sanitizedSettings = sanitizeSettings(settings);
  const selectedLanguage = DASHBOARD_LANGUAGE_BY_CODE.get(sanitizedSettings.studyLanguageCode);

  if (!normalizedEmail || !selectedLanguage || !hasMongoConfig()) {
    return null;
  }

  await ensureWordEmbeddingIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return null;
  }

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

  const anchors = getSemanticAnchorNodes();
  const learnedNodes = embeddingDocuments
    .map((document, index) => {
      const learnedWord = normalizeString(document?.word);
      const sourceWord = normalizeString(document?.sourceWord) || learnedWord;
      const embedding = normalizeEmbedding(document?.embedding);

      if (!learnedWord || !embedding) {
        return null;
      }

      const nearestAnchor = findNearestAnchor(embedding, anchors);
      const projectedPoint = projectEmbeddingToUnitSpace(embedding);
      const anchorX = nearestAnchor?.x ?? 0;
      const anchorY = nearestAnchor?.y ?? 0;
      const anchorZ = nearestAnchor?.z ?? 0;

      return {
        id: `${selectedLanguage.code}-${index + 1}-${learnedWord.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`,
        kind: "learned-word",
        label: learnedWord,
        sourceWord,
        learnedWord,
        languageCode: selectedLanguage.code,
        anchorId: nearestAnchor?.id ?? `language-${selectedLanguage.code}`,
        x: anchorX + projectedPoint.x * 2.8,
        y: anchorY + projectedPoint.y * 2.8,
        z: anchorZ + projectedPoint.z * 2.8,
        embedding,
        definition: nearestAnchor?.definition ?? `Embedded ${selectedLanguage.label} vocabulary.`,
        level: sanitizedSettings.learningLevel,
        status: "Practicing",
        generatedAt:
          normalizeDate(document?.updatedAt)?.toISOString() ??
          normalizeDate(document?.createdAt)?.toISOString() ??
          null,
      };
    })
    .filter(Boolean);

  if (learnedNodes.length === 0) {
    return null;
  }

  const usedAnchorIds = new Set(learnedNodes.map((node) => node.anchorId));
  const activeAnchors = anchors.filter((anchor) => usedAnchorIds.has(anchor.id));
  const links = buildSemanticNeighborLinks(learnedNodes);
  const generatedAt = learnedNodes
    .map((node) => node.generatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString();

  return {
    schemaVersion: 1,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: learnedNodes[0]?.embedding?.length ?? null,
    generatedAt,
    projection: {
      algorithm: "anchor-relative-random-projection",
      dimensions: 3,
      randomSeed: DASHBOARD_SEMANTIC_PROJECTION_SEED,
    },
    nodes: [
      ...activeAnchors,
      ...learnedNodes.map(({ generatedAt: _generatedAt, ...node }) => node),
    ],
    links,
  };
}
