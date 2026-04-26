export const LANGUAGE_STORAGE_KEY = "selectedLanguage";
export const TRANSLATION_LEVEL_STORAGE_KEY = "translationLevel";
export const PHRASE_MIN_STORAGE_KEY = "phraseMinWords";
export const PHRASE_MAX_STORAGE_KEY = "phraseMaxWords";
export const PHRASE_COVERAGE_STORAGE_KEY = "phraseCoveragePercent";
export const PHRASE_TEMPERATURE_STORAGE_KEY = "phraseLengthTemperature";
export const OPENAI_MODEL = "gpt-4o-mini";
export const TRANSLATION_LEVELS = [
  "beginner",
  "elementary",
  "intermediate",
  "advanced",
  "fluent",
];

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

export const PREPROMPT_ELEMENTARY = [
  "Translate a slightly broader but still selective subset of the paragraph into the target language.",
  "Many words must remain in the original language.",
  "Translate easy elementary-level words, including concrete nouns, simple articles, pronouns, prepositions, and conjunctions.",
  "Still avoid translating most verbs, adjectives, and adverbs unless they are extremely basic and needed for a short natural phrase.",
  "If a choice is ambiguous, leave the original word unchanged."
].join("\n");

export const PREPROMPT_INTERMEDIATE = [
  "Translate a broad but still partial subset of the paragraph into the target language.",
  "Some words may remain in the original language, but translated coverage should be much higher than beginner or elementary.",
  "Translate nouns, articles, pronouns, prepositions, conjunctions, adjectives, and adverbs.",
  "For verbs, translate only simple present tense forms. Do not translate past, future, progressive, perfect, conditional, imperative, or other verb tenses.",
  "If a verb tense is ambiguous or not simple present, leave the original verb unchanged.",
  "If a choice is ambiguous, leave the original word unchanged."
].join("\n");

export const PREPROMPT_ADVANCED = [
  "Translate almost the entire paragraph into the target language.",
  "All words are fair game for translation.",
  "Translate naturally while preserving the original meaning, spacing pattern, punctuation, and marker structure.",
  "Leave only a small residual amount of the original language when needed to stay within the requested partial-translation behavior.",
  "If a choice is ambiguous, choose the most natural translation."
].join("\n");

export const PREPROMPT_FLUENT = [
  "Fully translate the entire paragraph into the target language.",
  "Translate naturally and idiomatically while preserving the original meaning.",
  "Translate every translatable word unless leaving it unchanged is clearly required, such as for names, brands, or intentionally unchanged source text.",
  "Preserve spacing pattern, punctuation, and marker structure exactly.",
  "If a choice is ambiguous, choose the most natural fluent translation."
].join("\n");

export const BEGINNER_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [TRANSLATION_LEVEL_STORAGE_KEY]: "beginner",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 4,
  [PHRASE_COVERAGE_STORAGE_KEY]: 16,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0,
};

export const ELEMENTARY_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [TRANSLATION_LEVEL_STORAGE_KEY]: "elementary",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 5,
  [PHRASE_COVERAGE_STORAGE_KEY]: 32,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0.2,
};

export const INTERMEDIATE_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [TRANSLATION_LEVEL_STORAGE_KEY]: "intermediate",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 6,
  [PHRASE_COVERAGE_STORAGE_KEY]: 64,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0.35,
};

export const ADVANCED_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [TRANSLATION_LEVEL_STORAGE_KEY]: "advanced",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 8,
  [PHRASE_COVERAGE_STORAGE_KEY]: 90,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0.5,
};

export const FLUENT_SETTINGS = {
  [LANGUAGE_STORAGE_KEY]: "spanish",
  [TRANSLATION_LEVEL_STORAGE_KEY]: "fluent",
  [PHRASE_MIN_STORAGE_KEY]: 1,
  [PHRASE_MAX_STORAGE_KEY]: 10,
  [PHRASE_COVERAGE_STORAGE_KEY]: 100,
  [PHRASE_TEMPERATURE_STORAGE_KEY]: 0.7,
};

export const DEFAULT_SETTINGS = BEGINNER_SETTINGS;

export const SETTINGS_PRESETS = {
  beginner: BEGINNER_SETTINGS,
  elementary: ELEMENTARY_SETTINGS,
  intermediate: INTERMEDIATE_SETTINGS,
  advanced: ADVANCED_SETTINGS,
  fluent: FLUENT_SETTINGS,
};

export function isFullTranslationLevel(translationLevel) {
  return translationLevel === "fluent";
}

export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeSettings(storedValues = {}) {
  const requestedTranslationLevel = String(
    storedValues[TRANSLATION_LEVEL_STORAGE_KEY] ?? ""
  ).toLowerCase();
  const translationLevel = TRANSLATION_LEVELS.includes(requestedTranslationLevel)
    ? requestedTranslationLevel
    : "beginner";
  const levelDefaults = SETTINGS_PRESETS[translationLevel];
  const maxWords = clampNumber(
    Number(storedValues[PHRASE_MAX_STORAGE_KEY] ?? levelDefaults[PHRASE_MAX_STORAGE_KEY]),
    1,
    10
  );
  const coveragePercent = clampNumber(
    Number(
      storedValues[PHRASE_COVERAGE_STORAGE_KEY] ?? levelDefaults[PHRASE_COVERAGE_STORAGE_KEY]
    ),
    1,
    100
  );
  const temperature = clampNumber(
    Number(
      storedValues[PHRASE_TEMPERATURE_STORAGE_KEY] ??
      levelDefaults[PHRASE_TEMPERATURE_STORAGE_KEY]
    ),
    0,
    1
  );

  return {
    [LANGUAGE_STORAGE_KEY]: storedValues[LANGUAGE_STORAGE_KEY] ?? levelDefaults[LANGUAGE_STORAGE_KEY],
    [TRANSLATION_LEVEL_STORAGE_KEY]: translationLevel,
    [PHRASE_MIN_STORAGE_KEY]: 1,
    [PHRASE_MAX_STORAGE_KEY]: Math.max(1, maxWords),
    [PHRASE_COVERAGE_STORAGE_KEY]: coveragePercent,
    [PHRASE_TEMPERATURE_STORAGE_KEY]: temperature,
  };
}
