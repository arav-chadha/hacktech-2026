"use client";

import { dashboardConfig } from "@/lib/config";
import type {
  DashboardRepository,
  OverviewStats,
  ProgressRange,
  SemanticGraphSnapshot,
  StudyLanguage,
  StudySettings,
  VocabularyFilters,
  VocabularyEntry,
} from "@/lib/types/dashboard";

type DashboardRequestError = Error & {
  status?: number;
};

async function readDashboardResponse(response: Response) {
  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new Error("Dashboard backend returned unreadable JSON.");
  }
}

async function requestDashboard<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${dashboardConfig.apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const payload = await readDashboardResponse(response);

  if (!response.ok) {
    const error = new Error(
      String(payload?.error ?? `Dashboard request failed (${response.status}).`)
    ) as DashboardRequestError;
    error.status = response.status;
    throw error;
  }

  return payload as T;
}

export function createDashboardRepository(): DashboardRepository {
  return {
    async getOverviewStats(range: ProgressRange) {
      const response = await requestDashboard<{ overview: OverviewStats }>(
        `/dashboard/overview?range=${encodeURIComponent(range)}`
      );
      return response.overview;
    },

    async getVocabularyEntries(filters: VocabularyFilters): Promise<VocabularyEntry[]> {
      const searchParams = new URLSearchParams({
        searchQuery: filters.searchQuery,
        languageCode: filters.languageCode,
        level: filters.level,
        status: filters.status,
        sortBy: filters.sortBy,
        sortDirection: filters.sortDirection,
      });
      const response = await requestDashboard<{ entries: VocabularyEntry[] }>(
        `/dashboard/vocabulary?${searchParams.toString()}`
      );
      return response.entries;
    },

    async getVocabularySemanticMap(): Promise<SemanticGraphSnapshot | null> {
      const response = await requestDashboard<{ snapshot: SemanticGraphSnapshot | null }>(
        "/dashboard/semantic-map"
      );
      return response.snapshot;
    },

    async getStudySettings() {
      const response = await requestDashboard<{ settings: StudySettings }>("/dashboard/settings");
      return response.settings;
    },

    async updateStudySettings(input: StudySettings) {
      const response = await requestDashboard<{ settings: StudySettings }>("/dashboard/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: input,
        }),
      });
      return response.settings;
    },

    async getAvailableLanguages(): Promise<StudyLanguage[]> {
      const response = await requestDashboard<{ languages: StudyLanguage[] }>("/dashboard/languages");
      return response.languages;
    },
  };
}
