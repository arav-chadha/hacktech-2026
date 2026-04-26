import { MongoClient, ServerApiVersion } from "mongodb";
import { MONGODB_DB_NAME, MONGODB_URI } from "./local-config.js";

const USER_WORD_STATS_COLLECTION = "user_word_stats";
const USER_LANGUAGE_STATS_COLLECTION = "user_language_stats";
const WORD_EMBEDDINGS_COLLECTION = "word_embeddings";
const DASHBOARD_USER_SETTINGS_COLLECTION = "dashboard_user_settings";

let mongoClientPromise = null;
let wordIndexesPromise = null;
let languageIndexesPromise = null;
let embeddingIndexesPromise = null;

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
    await ensureCollectionExists(db, DASHBOARD_USER_SETTINGS_COLLECTION);

    const userWordStatsCollection = db.collection(USER_WORD_STATS_COLLECTION);
    const userWordStatsIndexes = [
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

    const dashboardUserSettingsCollection = db.collection(DASHBOARD_USER_SETTINGS_COLLECTION);
    const dashboardUserSettingsIndexes = [
      {
        key: {
          userEmailLower: 1,
        },
        unique: true,
        name: "dashboard_user_unique",
      },
    ];

    async function ensureIndexes(collection, desiredIndexes) {
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
    }

    await ensureIndexes(userWordStatsCollection, userWordStatsIndexes);
    await ensureIndexes(dashboardUserSettingsCollection, dashboardUserSettingsIndexes);
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

export async function ensureWordEmbeddingIndexes() {
  if (embeddingIndexesPromise) {
    return embeddingIndexesPromise;
  }

  embeddingIndexesPromise = (async () => {
    const db = await getMongoDatabase();
    if (!db) {
      return;
    }

    await ensureCollectionExists(db, WORD_EMBEDDINGS_COLLECTION);

    const collection = db.collection(WORD_EMBEDDINGS_COLLECTION);
    const desiredIndexes = [
      {
        key: {
          userEmailLower: 1,
          targetLanguage: 1,
          wordNormalized: 1,
        },
        unique: true,
        name: "user_language_word_embedding_unique",
      },
      {
        key: {
          userEmailLower: 1,
          targetLanguage: 1,
          updatedAt: -1,
        },
        name: "user_language_word_embedding_lookup",
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
    embeddingIndexesPromise = null;
    throw error;
  });

  return embeddingIndexesPromise;
}

export function getCollectionNames() {
  return {
    wordEmbeddings: WORD_EMBEDDINGS_COLLECTION,
    userLanguageStats: USER_LANGUAGE_STATS_COLLECTION,
    userWordStats: USER_WORD_STATS_COLLECTION,
    dashboardUserSettings: DASHBOARD_USER_SETTINGS_COLLECTION,
  };
}
