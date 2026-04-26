import type {
  LearningLevel,
  ProgressPoint,
  ProgressRange,
  StudyLanguage,
  StudySettings,
  VocabularyEntry,
  VocabularyStatus,
} from "@/lib/types/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS: StudySettings = {
  studyLanguageCode: "es",
  learningLevel: "Intermediate",
};

export const AVAILABLE_LANGUAGES: StudyLanguage[] = [
  { code: "es", label: "Spanish", locale: "es-ES" },
  { code: "fr", label: "French", locale: "fr-FR" },
  { code: "ru", label: "Russian", locale: "ru-RU" },
  { code: "zh", label: "Mandarin", locale: "zh-CN" },
];

type WordSeed = {
  sourceWord: string;
  learnedWord: string;
  level: LearningLevel;
  daysAgo: number;
  status: VocabularyStatus;
};

const WORD_SEEDS: Record<string, WordSeed[]> = {
  es: [
    { sourceWord: "journey", learnedWord: "viaje", level: "Beginner", daysAgo: 44, status: "Confident" },
    { sourceWord: "library", learnedWord: "biblioteca", level: "Beginner", daysAgo: 39, status: "Confident" },
    { sourceWord: "development", learnedWord: "desarrollo", level: "Intermediate", daysAgo: 32, status: "Practicing" },
    { sourceWord: "challenge", learnedWord: "desafio", level: "Intermediate", daysAgo: 21, status: "Practicing" },
    { sourceWord: "agreement", learnedWord: "acuerdo", level: "Intermediate", daysAgo: 19, status: "Confident" },
    { sourceWord: "neighborhood", learnedWord: "vecindario", level: "Intermediate", daysAgo: 15, status: "New" },
    { sourceWord: "schedule", learnedWord: "horario", level: "Advanced", daysAgo: 11, status: "Practicing" },
    { sourceWord: "threshold", learnedWord: "umbral", level: "Advanced", daysAgo: 4, status: "New" },
  ],
  fr: [
    { sourceWord: "window", learnedWord: "fenetre", level: "Beginner", daysAgo: 48, status: "Confident" },
    { sourceWord: "friendship", learnedWord: "amitie", level: "Beginner", daysAgo: 37, status: "Practicing" },
    { sourceWord: "writing", learnedWord: "redaction", level: "Intermediate", daysAgo: 30, status: "New" },
    { sourceWord: "progress", learnedWord: "progres", level: "Intermediate", daysAgo: 24, status: "Practicing" },
    { sourceWord: "careful", learnedWord: "soigneux", level: "Advanced", daysAgo: 10, status: "New" },
    { sourceWord: "thoughtful", learnedWord: "reflechi", level: "Advanced", daysAgo: 6, status: "Practicing" },
  ],
  ru: [
    { sourceWord: "question", learnedWord: "vopros", level: "Beginner", daysAgo: 41, status: "Confident" },
    { sourceWord: "confidence", learnedWord: "uverennost", level: "Intermediate", daysAgo: 34, status: "Practicing" },
    { sourceWord: "directory", learnedWord: "katalog", level: "Intermediate", daysAgo: 27, status: "New" },
    { sourceWord: "growth", learnedWord: "rost", level: "Advanced", daysAgo: 14, status: "Practicing" },
    { sourceWord: "insight", learnedWord: "ponimanie", level: "Advanced", daysAgo: 7, status: "New" },
  ],
  zh: [
    { sourceWord: "book", learnedWord: "shu", level: "Beginner", daysAgo: 45, status: "Confident" },
    { sourceWord: "study", learnedWord: "xuexi", level: "Beginner", daysAgo: 36, status: "Practicing" },
    { sourceWord: "review", learnedWord: "fuxi", level: "Intermediate", daysAgo: 29, status: "Practicing" },
    { sourceWord: "curiosity", learnedWord: "haoqixin", level: "Intermediate", daysAgo: 20, status: "New" },
    { sourceWord: "language", learnedWord: "yuyan", level: "Advanced", daysAgo: 9, status: "New" },
  ],
};

const LANGUAGE_PROGRESS_MULTIPLIER: Record<string, number> = {
  es: 1.05,
  fr: 0.9,
  ru: 0.82,
  zh: 0.72,
};

const LEVEL_OFFSET: Record<LearningLevel, number> = {
  Beginner: -1,
  Elementary: 0,
  Intermediate: 1,
  Advanced: 2,
};

function isoDateFromDaysAgo(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  return date.toISOString().slice(0, 10);
}

export function getVocabularySeedEntries(): VocabularyEntry[] {
  return AVAILABLE_LANGUAGES.flatMap((language) =>
    (WORD_SEEDS[language.code] ?? []).map((seed, index) => ({
      id: `${language.code}-${index + 1}`,
      sourceWord: seed.sourceWord,
      learnedWord: seed.learnedWord,
      languageCode: language.code,
      languageLabel: language.label,
      level: seed.level,
      dateDiscovered: isoDateFromDaysAgo(seed.daysAgo),
      status: seed.status,
    }))
  );
}

function sliceProgressRange(series: ProgressPoint[], range: ProgressRange) {
  if (range === "all") return series;

  const size = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return series.slice(-size);
}

export function buildProgressSeries(settings: StudySettings, range: ProgressRange): ProgressPoint[] {
  const totalDays = 120;
  const multiplier = LANGUAGE_PROGRESS_MULTIPLIER[settings.studyLanguageCode] ?? 1;
  const levelOffset = LEVEL_OFFSET[settings.learningLevel];
  const series: ProgressPoint[] = [];
  let cumulativeWords = 0;

  for (let index = 0; index < totalDays; index += 1) {
    const waveA = Math.sin(index / 4.2) * 1.8;
    const waveB = Math.cos(index / 9.5) * 1.1;
    const trend = index > 80 ? 1.2 : index > 30 ? 0.6 : 0;
    const discoveredWords = Math.max(
      1,
      Math.round((4 + waveA + waveB + trend + levelOffset) * multiplier)
    );

    cumulativeWords += discoveredWords;
    series.push({
      date: isoDateFromDaysAgo(totalDays - index - 1),
      discoveredWords,
      cumulativeWords,
    });
  }

  return sliceProgressRange(series, range);
}

export function buildRecentActivity(settings: StudySettings) {
  const language = AVAILABLE_LANGUAGES.find(
    (entry) => entry.code === settings.studyLanguageCode
  )?.label;

  return [
    {
      id: "activity-1",
      title: `Added a new ${language} reading session`,
      detail: "Discovered 12 useful words from a short-form article.",
      dateLabel: "Today",
    },
    {
      id: "activity-2",
      title: "Review pace improved",
      detail: "Three-day streak held steady with a consistent review pace.",
      dateLabel: "Yesterday",
    },
    {
      id: "activity-3",
      title: "Vocabulary confidence growing",
      detail: "Six words moved from Practicing to Confident this week.",
      dateLabel: "3 days ago",
    },
  ];
}
