import {
  ensureLanguageStatsIndexes,
  ensureMongoIndexes,
  getCollectionNames,
  getMongoDatabase,
  hasMongoConfig,
} from "./mongo.js";

const TERM_PATTERN = /\b[\p{L}\p{N}'’-]+\b/gu;

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function normalizeTerm(term) {
  return normalizeWhitespace(term).toLowerCase();
}

function getUniqueTerms(text) {
  return Array.from(
    new Set(
      Array.from(normalizeWhitespace(text).matchAll(TERM_PATTERN))
        .map((match) => normalizeTerm(match[0]))
        .filter(Boolean)
    )
  );
}

export async function getPriorityWordsForPrompt({
  userEmail,
  targetLanguage,
  sourceText,
  limit = 8,
}) {
  if (!hasMongoConfig()) {
    return [];
  }

  const userEmailLower = normalizeEmail(userEmail);
  const normalizedLanguage = normalizeWhitespace(targetLanguage);
  const candidateTerms = getUniqueTerms(sourceText);

  if (!userEmailLower || !normalizedLanguage || candidateTerms.length === 0) {
    return [];
  }

  await ensureMongoIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return [];
  }

  const { userWordStats } = getCollectionNames();
  const docs = await db.collection(userWordStats)
    .find({
      userEmailLower,
      targetLanguage: normalizedLanguage,
      sourceWordNormalized: { $in: candidateTerms },
    })
    .sort({
      clickCount: -1,
      lastClickedAt: -1,
    })
    .limit(limit)
    .project({
      _id: 0,
      sourceWord: 1,
      clickCount: 1,
    })
    .toArray();

  return docs.map((doc) => ({
    sourceWord: doc.sourceWord,
    clickCount: Number(doc.clickCount ?? 0),
    lastClickedAt: doc.lastClickedAt ?? null,
  }));
}

export async function recordWordFeedback({
  userEmail,
  targetLanguage,
  sourceTerm,
}) {
  if (!hasMongoConfig()) {
    return { ok: false, disabled: true };
  }

  const userEmailLower = normalizeEmail(userEmail);
  const normalizedLanguage = normalizeWhitespace(targetLanguage);
  const normalizedSourceWord = normalizeTerm(sourceTerm);

  if (!userEmailLower || !normalizedLanguage || !normalizedSourceWord) {
    return { ok: false, disabled: false };
  }

  await ensureMongoIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return { ok: false, disabled: true };
  }

  const { userWordStats } = getCollectionNames();
  const now = new Date();

  await db.collection(userWordStats).updateOne(
    {
      userEmailLower,
      targetLanguage: normalizedLanguage,
      sourceWordNormalized: normalizedSourceWord,
    },
    {
      $setOnInsert: {
        createdAt: now,
        userEmailLower,
        targetLanguage: normalizedLanguage,
        sourceWord: sourceTerm,
        sourceWordNormalized: normalizedSourceWord,
      },
      $set: {
        updatedAt: now,
        lastClickedAt: now,
      },
      $inc: {
        clickCount: 1,
      },
    },
    {
      upsert: true,
    }
  );

  return { ok: true, disabled: false };
}

export async function recordTranslatedWordExp({
  userEmail,
  targetLanguage,
  translatedWordCount,
}) {
  return recordLanguageExp({
    userEmail,
    targetLanguage,
    expAmount: translatedWordCount,
  });
}

export async function recordLanguageExp({
  userEmail,
  targetLanguage,
  expAmount,
}) {
  if (!hasMongoConfig()) {
    return { ok: false, disabled: true, expAdded: 0 };
  }

  const userEmailLower = normalizeEmail(userEmail);
  const normalizedLanguage = normalizeWhitespace(targetLanguage);
  const expDelta = Number.parseInt(expAmount, 10) || 0;

  if (!userEmailLower || !normalizedLanguage || expDelta === 0) {
    return { ok: false, disabled: false, expAdded: 0 };
  }

  await ensureLanguageStatsIndexes();
  const db = await getMongoDatabase();
  if (!db) {
    return { ok: false, disabled: true, expAdded: 0 };
  }

  const { userLanguageStats } = getCollectionNames();
  const now = new Date();

  await db.collection(userLanguageStats).updateOne(
    {
      userEmailLower,
      targetLanguage: normalizedLanguage,
    },
    [
      {
        $set: {
          createdAt: { $ifNull: ["$createdAt", now] },
          userEmailLower: { $ifNull: ["$userEmailLower", userEmailLower] },
          targetLanguage: { $ifNull: ["$targetLanguage", normalizedLanguage] },
          updatedAt: now,
          lastTranslatedAt: now,
          exp: {
            $max: [
              0,
              {
                $add: [
                  { $ifNull: ["$exp", 0] },
                  expDelta,
                ],
              },
            ],
          },
        },
      },
    ],
    {
      upsert: true,
    }
  );

  return { ok: true, disabled: false, expAdded: expDelta };
}
