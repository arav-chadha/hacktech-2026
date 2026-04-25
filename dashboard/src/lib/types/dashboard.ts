export type LearningLevel = "Beginner" | "Elementary" | "Intermediate" | "Advanced";

export type ReplacementDensity = "light" | "balanced" | "immersive";

export type VocabularyStatus = "New" | "Practicing" | "Confident";

export type ProgressRange = "7d" | "30d" | "90d" | "all";

export type VocabularySortBy =
  | "dateDiscovered"
  | "sourceWord"
  | "learnedWord"
  | "level"
  | "status";

export interface StudyLanguage {
  code: string;
  label: string;
  locale: string;
}

export interface StudySettings {
  studyLanguageCode: string;
  learningLevel: LearningLevel;
  replacementDensity: ReplacementDensity;
}

export interface ProgressPoint {
  date: string;
  discoveredWords: number;
  cumulativeWords: number;
}

export interface RecentActivityItem {
  id: string;
  title: string;
  detail: string;
  dateLabel: string;
}

export interface OverviewStats {
  wordsLearned: number;
  discoveredToday: number;
  streakDays: number;
  activeLevel: LearningLevel;
  progressSeries: ProgressPoint[];
  recentActivity: RecentActivityItem[];
}

export interface VocabularyEntry {
  id: string;
  sourceWord: string;
  learnedWord: string;
  languageCode: string;
  languageLabel: string;
  level: LearningLevel;
  dateDiscovered: string;
  status: VocabularyStatus;
}

export interface VocabularyFilters {
  searchQuery: string;
  languageCode: string;
  level: LearningLevel | "all";
  status: VocabularyStatus | "all";
  sortBy: VocabularySortBy;
  sortDirection: "asc" | "desc";
}

export interface DashboardRepository {
  getOverviewStats(range: ProgressRange): Promise<OverviewStats>;
  getVocabularyEntries(filters: VocabularyFilters): Promise<VocabularyEntry[]>;
  getStudySettings(): Promise<StudySettings>;
  updateStudySettings(input: StudySettings): Promise<StudySettings>;
  getAvailableLanguages(): Promise<StudyLanguage[]>;
}
