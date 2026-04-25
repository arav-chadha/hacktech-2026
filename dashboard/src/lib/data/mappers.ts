import { buildProgressSeries, buildRecentActivity, getVocabularySeedEntries } from "@/lib/data/mock-data";
import type {
  OverviewStats,
  ProgressRange,
  StudySettings,
  VocabularyEntry,
  VocabularyFilters,
} from "@/lib/types/dashboard";

const LEVEL_ORDER = {
  Beginner: 1,
  Elementary: 2,
  Intermediate: 3,
  Advanced: 4,
};

const STATUS_ORDER = {
  New: 1,
  Practicing: 2,
  Confident: 3,
};

export function mapOverviewStats(settings: StudySettings, range: ProgressRange): OverviewStats {
  const fullSeries = buildProgressSeries(settings, "all");
  const progressSeries = range === "all" ? fullSeries : buildProgressSeries(settings, range);
  const discoveredToday = fullSeries[fullSeries.length - 1]?.discoveredWords ?? 0;
  const wordsLearned = fullSeries[fullSeries.length - 1]?.cumulativeWords ?? 0;

  return {
    wordsLearned,
    discoveredToday,
    streakDays: 18,
    activeLevel: settings.learningLevel,
    progressSeries,
    recentActivity: buildRecentActivity(settings),
  };
}

export function mapVocabularyEntries(filters: VocabularyFilters): VocabularyEntry[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const filtered = getVocabularySeedEntries().filter((entry) => {
    const matchesQuery =
      query.length === 0 ||
      entry.sourceWord.toLowerCase().includes(query) ||
      entry.learnedWord.toLowerCase().includes(query);
    const matchesLanguage =
      filters.languageCode === "all" || entry.languageCode === filters.languageCode;
    const matchesLevel = filters.level === "all" || entry.level === filters.level;
    const matchesStatus = filters.status === "all" || entry.status === filters.status;

    return matchesQuery && matchesLanguage && matchesLevel && matchesStatus;
  });

  filtered.sort((left, right) => {
    let comparison = 0;

    if (filters.sortBy === "dateDiscovered") {
      comparison = left.dateDiscovered.localeCompare(right.dateDiscovered);
    }

    if (filters.sortBy === "sourceWord") {
      comparison = left.sourceWord.localeCompare(right.sourceWord);
    }

    if (filters.sortBy === "learnedWord") {
      comparison = left.learnedWord.localeCompare(right.learnedWord);
    }

    if (filters.sortBy === "level") {
      comparison = LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level];
    }

    if (filters.sortBy === "status") {
      comparison = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    }

    return filters.sortDirection === "asc" ? comparison : comparison * -1;
  });

  return filtered;
}
