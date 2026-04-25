"use client";

import { AVAILABLE_LANGUAGES, DEFAULT_SETTINGS } from "@/lib/data/mock-data";
import { mapOverviewStats, mapVocabularyEntries } from "@/lib/data/mappers";
import type {
  DashboardRepository,
  ProgressRange,
  StudyLanguage,
  StudySettings,
  VocabularyFilters,
  VocabularyEntry,
} from "@/lib/types/dashboard";

const STORAGE_KEY = "hacktech.dashboard.v1";

type PersistedDashboardState = {
  settings: StudySettings;
};

function readPersistedState(): PersistedDashboardState {
  if (typeof window === "undefined") {
    return { settings: DEFAULT_SETTINGS };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { settings: DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedDashboardState>;
    return {
      settings: parsed.settings ?? DEFAULT_SETTINGS,
    };
  } catch {
    return { settings: DEFAULT_SETTINGS };
  }
}

function writePersistedState(state: PersistedDashboardState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function getStoredSettings(): Promise<StudySettings> {
  const state = readPersistedState();
  return state.settings;
}

export function createDashboardRepository(): DashboardRepository {
  return {
    async getOverviewStats(range: ProgressRange) {
      const settings = await getStoredSettings();
      // BACKEND_INTEGRATION: Replace this local mapper call with an API-backed overview query.
      return mapOverviewStats(settings, range);
    },

    async getVocabularyEntries(filters: VocabularyFilters): Promise<VocabularyEntry[]> {
      void filters;
      // BACKEND_INTEGRATION: Replace this local mapper call with a backend vocabulary search endpoint.
      return mapVocabularyEntries(filters);
    },

    async getStudySettings() {
      // BACKEND_INTEGRATION: Replace local storage reads with a user settings fetch when backend exists.
      return getStoredSettings();
    },

    async updateStudySettings(input: StudySettings) {
      // BACKEND_INTEGRATION: Replace local persistence with a settings mutation request.
      writePersistedState({ settings: input });
      return input;
    },

    async getAvailableLanguages(): Promise<StudyLanguage[]> {
      // BACKEND_INTEGRATION: Replace static language list with backend-managed language capabilities if needed.
      return AVAILABLE_LANGUAGES;
    },
  };
}
