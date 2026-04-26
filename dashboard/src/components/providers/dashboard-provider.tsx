"use client";

import type { ReactNode } from "react";
import { createContext, startTransition, useContext, useEffect, useState } from "react";
import { useDashboardAuth } from "@/components/providers/dashboard-auth-provider";
import { createDashboardRepository } from "@/lib/data/dashboard-repository";
import type { DashboardRepository, StudyLanguage, StudySettings } from "@/lib/types/dashboard";

type DashboardContextValue = {
  repository: DashboardRepository;
  settings: StudySettings | null;
  languages: StudyLanguage[];
  ready: boolean;
  saving: boolean;
  updateSettings: (nextSettings: StudySettings) => Promise<void>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

const repository = createDashboardRepository();

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { email, loading, resetSession } = useDashboardAuth();
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [languages, setLanguages] = useState<StudyLanguage[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!email) {
      setSettings(null);
      setLanguages([]);
      setReady(false);
      return;
    }

    let isActive = true;

    async function load() {
      try {
        const [loadedSettings, availableLanguages] = await Promise.all([
          repository.getStudySettings(),
          repository.getAvailableLanguages(),
        ]);

        if (!isActive) return;
        setSettings(loadedSettings);
        setLanguages(availableLanguages);
        setReady(true);
      } catch (loadError) {
        const normalizedError =
          loadError instanceof Error
            ? loadError
            : new Error("Failed to load dashboard bootstrap data.");
        const dashboardError = normalizedError as Error & { status?: number };

        if (dashboardError.status === 401) {
          resetSession(normalizedError);
          return;
        }

        console.error("Failed to load dashboard bootstrap data:", loadError);
        if (isActive) {
          setSettings(null);
          setLanguages([]);
          setReady(false);
        }
      }
    }

    setReady(false);
    void load();

    return () => {
      isActive = false;
    };
  }, [email, loading, resetSession]);

  async function updateSettings(nextSettings: StudySettings) {
    setSaving(true);
    try {
      const savedSettings = await repository.updateStudySettings(nextSettings);

      startTransition(() => {
        setSettings(savedSettings);
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardContext.Provider
      value={{
        repository,
        settings,
        languages,
        ready,
        saving,
        updateSettings,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);

  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider.");
  }

  return context;
}
