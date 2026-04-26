export type LearningLevel = "Beginner" | "Elementary" | "Intermediate" | "Advanced";

export type VocabularyStatus = "New" | "Practicing" | "Confident";

export type ProgressRange = "7d" | "30d" | "90d" | "all";

export type VocabularySortBy =
  | "dateDiscovered"
  | "sourceWord"
  | "learnedWord"
  | "level"
  | "status";

export type SemanticNodeKind = "anchor" | "learned-word";

export interface StudyLanguage {
  code: string;
  label: string;
  locale: string;
}

export interface StudySettings {
  studyLanguageCode: string;
  learningLevel: LearningLevel;
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

export interface SemanticProjectionMetadata {
  algorithm: string;
  dimensions: number;
  randomSeed: number | null;
}

export type SemanticEmbeddingVector = number[];

export interface SemanticAnchorNode {
  id: string;
  kind: "anchor";
  label: string;
  definition: string;
  x: number;
  y: number;
  z: number;
  embedding?: SemanticEmbeddingVector;
  tags?: string[];
  notes?: string;
}

export interface SemanticLearnedWordNode {
  id: string;
  kind: "learned-word";
  label: string;
  sourceWord: string;
  learnedWord: string;
  languageCode: string;
  anchorId: string;
  x: number;
  y: number;
  z: number;
  embedding?: SemanticEmbeddingVector;
  definition?: string;
  status?: VocabularyStatus;
  level?: LearningLevel;
}

export type SemanticGraphNode = SemanticAnchorNode | SemanticLearnedWordNode;

export interface SemanticGraphLink {
  source: string;
  target: string;
}

export interface SemanticGraphSnapshot {
  schemaVersion: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  generatedAt: string | null;
  projection: SemanticProjectionMetadata | null;
  nodes: SemanticGraphNode[];
  links: SemanticGraphLink[];
}

export interface DashboardRepository {
  getOverviewStats(range: ProgressRange): Promise<OverviewStats>;
  getVocabularyEntries(filters: VocabularyFilters): Promise<VocabularyEntry[]>;
  getVocabularySemanticMap(): Promise<SemanticGraphSnapshot | null>;
  getStudySettings(): Promise<StudySettings>;
  updateStudySettings(input: StudySettings): Promise<StudySettings>;
  getAvailableLanguages(): Promise<StudyLanguage[]>;
}
