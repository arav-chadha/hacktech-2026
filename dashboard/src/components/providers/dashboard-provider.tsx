"use client";

import type { ReactNode } from "react";
import { createContext, startTransition, useContext, useEffect, useState } from "react";
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
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [languages, setLanguages] = useState<StudyLanguage[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function load() {
      const [loadedSettings, availableLanguages] = await Promise.all([
        repository.getStudySettings(),
        repository.getAvailableLanguages(),
      ]);

      if (!isActive) return;
      setSettings(loadedSettings);
      setLanguages(availableLanguages);
      setReady(true);
    }

    void load();

    return () => {
      isActive = false;
    };
  }, []);

  async function updateSettings(nextSettings: StudySettings) {
    setSaving(true);
    const savedSettings = await repository.updateStudySettings(nextSettings);

    startTransition(() => {
      setSettings(savedSettings);
      setSaving(false);
    });
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
