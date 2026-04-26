import { ensureMongoIndexes, getCollectionNames, getMongoDatabase, hasMongoConfig } from "./mongo.js";

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

  const collection = await getDashboardCollection("userWordStats");
  if (!collection) {
    return [];
  }

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

  const documents = await collection
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

  const entries = documents
    .map((document) => {
      const language = getLanguageMetadataFromStorageValue(document.targetLanguage);
      if (!language) {
        return null;
      }

      const status = buildStatus(document.clickCount);
      const level = sanitizedSettings.learningLevel;

      return {
        id: String(document._id),
        sourceWord: normalizeString(document.sourceWord),
        learnedWord: "Translation not captured yet",
        languageCode: language.code,
        languageLabel: language.label,
        level,
        dateDiscovered: toIsoDate(normalizeDate(document.createdAt) ?? new Date()),
        status,
      };
    })
    .filter(Boolean)
    .filter((entry) => {
      const matchesLevel = requestedLevel === "all" || entry.level === requestedLevel;
      const matchesStatus = requestedStatus === "all" || entry.status === requestedStatus;
      return matchesLevel && matchesStatus;
    })
    .sort(
      buildVocabularySort({
        sortBy,
        sortDirection,
      })
    );

  return entries;
}
