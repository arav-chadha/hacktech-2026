export const LANGUAGE_STORAGE_KEY = "selectedLanguage";
export const READER_KNOWLEDGE_LEVEL_STORAGE_KEY = "readerKnowledgeLevel";
export const GEMMA_MODEL = "gemma-3-27b-it";
export const KNOWLEDGE_LEVEL_TO_RATIO = {
  1: 0.25,
  2: 0.5,
  3: 0.75,
};

export const DEFAULT_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: 1,
};

export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeSettings(storedValues = {}) {
  const readerKnowledgeLevel = clampNumber(
    Number(
      storedValues[READER_KNOWLEDGE_LEVEL_STORAGE_KEY] ??
        DEFAULT_SETTINGS[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]
    ),
    1,
    3
  );

  return {
    [LANGUAGE_STORAGE_KEY]:
      storedValues[LANGUAGE_STORAGE_KEY] ?? DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
    [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: Math.round(readerKnowledgeLevel),
  };
}
