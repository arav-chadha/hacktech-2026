"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ProgressChart } from "@/features/overview/progress-chart";
import type { OverviewStats, ProgressRange } from "@/lib/types/dashboard";
import { formatCompactNumber } from "@/lib/utils/format";

export function OverviewPage() {
  const { languages, repository, settings, updateSettings, saving } = useDashboard();
  const [range, setRange] = useState<ProgressRange>("30d");
  const [stats, setStats] = useState<OverviewStats | null>(null);

  useEffect(() => {
    let isActive = true;

    async function load() {
      const nextStats = await repository.getOverviewStats(range);
      if (isActive) {
        setStats(nextStats);
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [range, repository, settings?.studyLanguageCode, settings?.learningLevel]);

  if (!settings || !stats) {
    return null;
  }

  const currentSettings = settings;

  async function handleLanguageChange(nextLanguageCode: string) {
    await updateSettings({
      ...currentSettings,
      studyLanguageCode: nextLanguageCode,
    });
  }

  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] border-ink-200 bg-white p-6 sm:p-8">
      <PageHeader
        eyebrow="Overview"
        title="Language growth overview"
        description="Track your vocabulary expansion and learning progress over time."
        aside={
          <div className="min-w-56">
            <label className="field-label" htmlFor="overview-language">
              Current study language
            </label>
            <select
              id="overview-language"
              className="field-input"
              value={currentSettings.studyLanguageCode}
              onChange={(event) => void handleLanguageChange(event.target.value)}
              disabled={saving}
            >
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Words learned"
          value={formatCompactNumber(stats.wordsLearned)}
          supporting="Current cumulative vocabulary in the selected range."
        />
        <StatCard
          label="Discovered today"
          value={String(stats.discoveredToday)}
          supporting="Fresh additions from reading and lightweight review."
        />
        <StatCard
          label="Current streak"
          value={`${stats.streakDays} days`}
          supporting="Consistent daily exposure is driving retention upward."
        />
        <StatCard
          label="Active level"
          value={stats.activeLevel}
          supporting="Settings and review tone are aligned to this level."
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
        <ProgressChart range={range} series={stats.progressSeries} onRangeChange={setRange} />

              </div>
    </div>
  );
}
