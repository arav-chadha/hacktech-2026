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
    <div className="panel h-full min-h-[calc(100vh-2rem)] border-ink-200 bg-white p-6 sm:p-8">
      <PageHeader
        eyebrow="Settings"
        title="Learning preferences"
        description="Configure your study experience and learning behavior."
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
              <p className="mt-2 text-sm text-ink-500">
                The dashboard and later article recommendations will align to this language.
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
              <p className="mt-2 text-sm text-ink-500">
                Use this to keep replacements and review tone matched to your actual reading comfort.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save settings"}
              </Button>
              <span className="text-sm text-ink-500">{status}</span>
            </div>
          </div>
        </Card>

        <Card className="h-fit">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
            Current profile
          </p>
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-ink-100 bg-ink-50 p-4">
              <p className="text-sm font-medium text-ink-500">Language</p>
              <p className="mt-2 text-lg font-semibold text-ink-900">
                {languages.find((language) => language.code === formState.studyLanguageCode)?.label}
              </p>
            </div>
            <div className="rounded-xl border border-ink-100 bg-ink-50 p-4">
              <p className="text-sm font-medium text-ink-500">Level</p>
              <p className="mt-2 text-lg font-semibold text-ink-900">{formState.learningLevel}</p>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}
