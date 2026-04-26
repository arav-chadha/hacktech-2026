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
    <div className="panel h-full min-h-[calc(100vh-2rem)] bg-[var(--surface)] p-6 sm:p-8">
      <PageHeader
        eyebrow="Overview"
        title="Your everyday learning rhythm"
        description="Follow the small reading moments, saved words, and steady progress that make WordLoom feel natural over time."
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
          supporting="Saved vocabulary currently active in your learning space."
        />
        <StatCard
          label="Discovered today"
          value={String(stats.discoveredToday)}
          supporting="Fresh finds from today’s browsing and lightweight review."
        />
        <StatCard
          label="Current streak"
          value={`${stats.streakDays} days`}
          supporting="A gentle daily rhythm that keeps retention moving."
        />
        <StatCard
          label="Active level"
          value={stats.activeLevel}
          supporting="WordLoom is tuning reveal depth and challenge to this stage."
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
        <ProgressChart range={range} series={stats.progressSeries} onRangeChange={setRange} />
        <div className="grid gap-6">
          <Card className="bg-oat-50">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-700">
              Daily note
            </p>
            <h2 className="mt-3 font-display text-[2rem] tracking-[-0.04em] text-ink-900">
              Learning stays light when the next step is obvious.
            </h2>
            <p className="mt-3 text-sm leading-7 text-ink-600">
              Keep browsing. WordLoom will reveal meaning on interaction,
              save the words worth keeping, and gradually raise the reading challenge as your EXP grows.
            </p>
          </Card>

          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">
              Recent activity
            </p>
            <div className="mt-5 space-y-4">
              {stats.recentActivity.map((item) => (
                <div key={item.id} className="rounded-2xl border border-ink-100 bg-[var(--surface-soft)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-ink-900">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-ink-600">{item.detail}</p>
                    </div>
                    <span className="soft-pill shrink-0">{item.dateLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
