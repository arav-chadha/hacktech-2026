export const LANGUAGE_STORAGE_KEY = "selectedLanguage";
export const PHRASE_MIN_STORAGE_KEY = "phraseMinWords";
export const PHRASE_MAX_STORAGE_KEY = "phraseMaxWords";
export const PHRASE_TEMPERATURE_STORAGE_KEY = "phraseLengthTemperature";
export const GEMMA_MODEL = "gemini-3.1-flash-lite-preview";

export const PREPROMPT_SUFFIX = [
    "Keep spacing and punctuation identical to input",
    "Preserve whitespace between translated words; do not merge or remove spaces",
    "Leave every non-translated word exactly unchanged",
    "Do not rewrite, paraphrase, summarize, or fully translate sentences",
    "Do not surround text w/ * \' or \"",
    "Preserve markers exactly, both open and closed forms",
    "Dont: add remove rename duplicate reorder marker bounds",
    "Keep marker structure identical to input",
    "Return only translated paragraph w/ markers",
    "Do not return markdown code fences notes text or alternatives",
  ].join("\n");

export const PREPROMPT_BEGINNER = [
  "Translate only a sparse subset of the paragraph into the target language.",
  "Most words must remain in the original language.",
  "Only translate easy beginner-friendly words, primarily concrete nouns and simple articles.",
  "Do not translate verbs, adjectives, adverbs, pronouns, prepositions, or conjunctions.",
  "If a choice is ambiguous, leave the original word unchanged."
].join("\n");

export const DEFAULT_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 4,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0,
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
