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
  }, [range, repository, settings?.studyLanguageCode, settings?.learningLevel, settings?.replacementDensity]);

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
        title="A cleaner view of your language growth"
        description="Keep the main learning signals in one place: what language you are focusing on, how fast your vocabulary is growing, and which study habits are holding steady."
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

        <Card className="h-fit">
          <div className="border-b border-ink-100 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
              Recent movement
            </p>
            <h2 className="mt-2 text-lg font-semibold text-ink-900">Momentum this week</h2>
            <p className="mt-2 text-sm leading-6 text-ink-500">
              Small events that explain the trend in your chart without adding noisy analytics.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {stats.recentActivity.map((item) => (
              <div key={item.id} className="rounded-xl border border-ink-100 bg-ink-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink-500">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-ink-400">
                    {item.dateLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
