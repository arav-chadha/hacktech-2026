export const LANGUAGE_STORAGE_KEY = "selectedLanguage";
export const PHRASE_MIN_STORAGE_KEY = "phraseMinWords";
export const PHRASE_MAX_STORAGE_KEY = "phraseMaxWords";
export const PHRASE_TEMPERATURE_STORAGE_KEY = "phraseLengthTemperature";
export const GEMMA_MODEL = "gemma-3-27b-it";

export const DEFAULT_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 4,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0.5,
};

export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeSettings(storedValues = {}) {
  const minWords = clampNumber(
    Number(storedValues[PHRASE_MIN_STORAGE_KEY] ?? DEFAULT_SETTINGS[PHRASE_MIN_STORAGE_KEY]),
    1,
    10
  );
  const maxWords = clampNumber(
    Number(storedValues[PHRASE_MAX_STORAGE_KEY] ?? DEFAULT_SETTINGS[PHRASE_MAX_STORAGE_KEY]),
    1,
    10
  );
  const temperature = clampNumber(
    Number(
      storedValues[PHRASE_TEMPERATURE_STORAGE_KEY] ??
        DEFAULT_SETTINGS[PHRASE_TEMPERATURE_STORAGE_KEY]
    ),
    0,
    1
  );

  return {
    [LANGUAGE_STORAGE_KEY]:
      storedValues[LANGUAGE_STORAGE_KEY] ?? DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
    [PHRASE_MIN_STORAGE_KEY]: Math.min(minWords, maxWords),
    [PHRASE_MAX_STORAGE_KEY]: Math.max(minWords, maxWords),
    [PHRASE_TEMPERATURE_STORAGE_KEY]: temperature,
  };
}
