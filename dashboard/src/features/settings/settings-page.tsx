"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { LearningLevel, StudySettings } from "@/lib/types/dashboard";

export function SettingsPage() {
  const { languages, settings, updateSettings, saving } = useDashboard();
  const [formState, setFormState] = useState<StudySettings | null>(settings);
  const [status, setStatus] = useState("Your settings are synced through the backend.");

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  if (!formState) {
    return null;
  }

  function updateField<K extends keyof StudySettings>(key: K, value: StudySettings[K]) {
    setFormState((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formState) {
      return;
    }
    await updateSettings(formState);
    setStatus("Saved to the backend and ready on your next refresh.");
  }

  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] bg-[var(--surface)] p-6 sm:p-8">
      <PageHeader
        eyebrow="Settings"
        title="Learning preferences"
        description="Shape how WordLoom shows language throughout the day, from your target language to the level of challenge you want in context."
      />

      <form className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]" onSubmit={handleSubmit}>
        <Card>
          <div className="grid gap-6">
            <div>
              <label className="field-label" htmlFor="settings-language">
                Study language
              </label>
              <select
                id="settings-language"
                className="field-input"
                value={formState.studyLanguageCode}
                onChange={(event) => updateField("studyLanguageCode", event.target.value)}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm text-ink-600">
                Your popup, dashboard, and future discovery suggestions all follow this study language.
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="settings-level">
                Learning level
              </label>
              <select
                id="settings-level"
                className="field-input"
                value={formState.learningLevel}
                onChange={(event) =>
                  updateField("learningLevel", event.target.value as LearningLevel)
                }
              >
                <option value="Beginner">Beginner</option>
                <option value="Elementary">Elementary</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
              <p className="mt-2 text-sm text-ink-600">
                WordLoom uses this to decide how much to translate, when to reveal support, and how advanced your reading should feel.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save settings"}
              </Button>
              <span className="text-sm text-ink-600">{status}</span>
            </div>
          </div>
        </Card>

        <Card className="h-fit bg-oat-50">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700">
            Current profile
          </p>
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-ink-100 bg-[var(--surface)] p-4">
              <p className="text-sm font-medium text-ink-600">Language</p>
              <p className="mt-2 font-display text-2xl tracking-[-0.03em] text-ink-900">
                {languages.find((language) => language.code === formState.studyLanguageCode)?.label}
              </p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-[var(--surface)] p-4">
              <p className="text-sm font-medium text-ink-600">Level</p>
              <p className="mt-2 font-display text-2xl tracking-[-0.03em] text-ink-900">{formState.learningLevel}</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-[var(--surface)] p-4">
              <p className="text-sm font-medium text-ink-600">Experience style</p>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Calm support first, more independence later. The interface stays soft while the content grows with you.
              </p>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
