import { MongoClient, ServerApiVersion } from "mongodb";
import { MONGODB_DB_NAME, MONGODB_URI } from "./local-config.js";

const USER_WORD_STATS_COLLECTION = "user_word_stats";
const USER_LANGUAGE_STATS_COLLECTION = "user_language_stats";

let mongoClientPromise = null;
let wordIndexesPromise = null;
let languageIndexesPromise = null;

export function hasMongoConfig() {
  return Boolean(String(MONGODB_URI ?? "").trim());
}

export async function getMongoClient() {
  const mongoUri = String(MONGODB_URI ?? "").trim();
  if (!mongoUri) {
    return null;
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri, {
      serverApi: ServerApiVersion.v1,
    });
    mongoClientPromise = client.connect();
  }

  return mongoClientPromise;
}

export async function getMongoDatabase() {
  const client = await getMongoClient();
  if (!client) {
    return null;
  }

  return client.db(MONGODB_DB_NAME);
}

async function ensureCollectionExists(db, collectionName) {
  const matchingCollections = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();

  if (matchingCollections.length > 0) {
    return;
  }

  try {
    await db.createCollection(collectionName);
  } catch (error) {
    if (error?.codeName !== "NamespaceExists" && error?.code !== 48) {
      throw error;
    }
  }
}

export async function ensureMongoIndexes() {
  if (wordIndexesPromise) {
    return wordIndexesPromise;
  }

  wordIndexesPromise = (async () => {
    const db = await getMongoDatabase();
    if (!db) {
      return;
    }

    await ensureCollectionExists(db, USER_WORD_STATS_COLLECTION);

    const collection = db.collection(USER_WORD_STATS_COLLECTION);
    const desiredIndexes = [
      {
        key: {
          userEmailLower: 1,
          targetLanguage: 1,
          sourceWordNormalized: 1,
        },
        unique: true,
        name: "user_language_word_unique",
      },
      {
        key: {
          userEmailLower: 1,
          targetLanguage: 1,
          clickCount: -1,
          lastClickedAt: -1,
        },
        name: "user_language_priority_lookup",
      },
    ];

    const existingIndexes = await collection.indexes();
    const existingByName = new Map(existingIndexes.map((index) => [index.name, index]));

    for (const desiredIndex of desiredIndexes) {
      const existingIndex = existingByName.get(desiredIndex.name);
      if (!existingIndex) {
        continue;
      }

      const sameKey =
        JSON.stringify(existingIndex.key) === JSON.stringify(desiredIndex.key);
      const sameUniqueness = Boolean(existingIndex.unique) === Boolean(desiredIndex.unique);

      if (!sameKey || !sameUniqueness) {
        await collection.dropIndex(desiredIndex.name);
      }
    }

    await collection.createIndexes(desiredIndexes);
  })().catch((error) => {
    wordIndexesPromise = null;
    throw error;
  });

  return wordIndexesPromise;
}

export async function ensureLanguageStatsIndexes() {
  if (languageIndexesPromise) {
    return languageIndexesPromise;
  }

  languageIndexesPromise = (async () => {
    const db = await getMongoDatabase();
    if (!db) {
      return;
    }

    await ensureCollectionExists(db, USER_LANGUAGE_STATS_COLLECTION);

    const collection = db.collection(USER_LANGUAGE_STATS_COLLECTION);
    const desiredIndexes = [
      {
        key: {
          userEmailLower: 1,
          targetLanguage: 1,
        },
        unique: true,
        name: "user_language_stats_unique",
      },
      {
        key: {
          userEmailLower: 1,
          exp: -1,
          updatedAt: -1,
        },
        name: "user_language_stats_exp_lookup",
      },
    ];

    const existingIndexes = await collection.indexes();
    const existingByName = new Map(existingIndexes.map((index) => [index.name, index]));

    for (const desiredIndex of desiredIndexes) {
      const existingIndex = existingByName.get(desiredIndex.name);
      if (!existingIndex) {
        continue;
      }

      const sameKey =
        JSON.stringify(existingIndex.key) === JSON.stringify(desiredIndex.key);
      const sameUniqueness = Boolean(existingIndex.unique) === Boolean(desiredIndex.unique);

      if (!sameKey || !sameUniqueness) {
        await collection.dropIndex(desiredIndex.name);
      }
    }

    await collection.createIndexes(desiredIndexes);
  })().catch((error) => {
    languageIndexesPromise = null;
    throw error;
  });

  return languageIndexesPromise;
}

export function getCollectionNames() {
  return {
    userLanguageStats: USER_LANGUAGE_STATS_COLLECTION,
    userWordStats: USER_WORD_STATS_COLLECTION,
  };
}
