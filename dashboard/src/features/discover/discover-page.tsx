"use client";

import { useMemo, useState } from "react";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { DiscoverRecommendation } from "@/lib/types/dashboard";

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return date.toLocaleString();
}

function DiscoverRecommendationCard({
  recommendation,
}: {
  recommendation: DiscoverRecommendation;
}) {
  return (
    <div className="grid gap-4">
      {recommendation.articles.map((article, index) => (
        <a key={article.url} href={article.url} className="block">
          <Card className="h-full transition hover:border-accent-300 hover:bg-oat-50">
            <div className="flex items-center justify-between gap-4">
              <span className="soft-pill">Article {index + 1}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">
                {article.sourceHost || "Web"}
              </span>
            </div>

            <h2 className="mt-4 font-display text-2xl tracking-[-0.02em] text-ink-900">
              {article.title}
            </h2>

            <p className="mt-3 text-sm leading-7 text-ink-600">
              {article.description || article.preview}
            </p>

            <p className="mt-4 rounded-2xl border border-ink-100 bg-[var(--surface-soft)] px-4 py-3 text-sm leading-7 text-ink-700">
              {article.preview}
            </p>

            <div className="mt-5 flex items-center justify-between gap-4">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">
                English focus word: {recommendation.focusWord}
              </span>
              <span className="text-sm font-medium text-ink-700">Open article</span>
            </div>
          </Card>
        </a>
      ))}
    </div>
  );
}

export function DiscoverPage() {
  const { repository, settings, languages } = useDashboard();
  const [recommendation, setRecommendation] = useState<DiscoverRecommendation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const studyLanguageLabel = useMemo(() => {
    if (!settings?.studyLanguageCode) {
      return "Not selected";
    }

    return (
      languages.find((language) => language.code === settings.studyLanguageCode)?.label ??
      settings.studyLanguageCode.toUpperCase()
    );
  }, [languages, settings?.studyLanguageCode]);

  async function handleDiscover() {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextRecommendation = await repository.discoverArticles();
      setRecommendation(nextRecommendation);

      if (!nextRecommendation) {
        setErrorMessage("No under-exposed focus words are available for discovery right now.");
      }
    } catch (error) {
      setRecommendation(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We could not build a discovery shelf right now."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] bg-[var(--surface)] p-6 sm:p-8">
      <PageHeader
        eyebrow="Discover"
        title="Find your next gentle reading moment"
        description="Press the button when you want a few short English reads centered on an under-exposed focus word from your learning graph."
        aside={
          <Button onClick={handleDiscover} disabled={isLoading || !settings}>
            {isLoading ? "Finding articles..." : "Discover unseen words"}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)]">
        <Card className="h-fit bg-oat-50">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700">
            Discovery context
          </p>

          <div className="mt-5 space-y-3 text-sm text-ink-600">
            <div className="rounded-2xl border border-ink-200 bg-[var(--surface)] px-4 py-3">
              <span className="field-label">Study language</span>
              <div className="font-medium text-ink-900">{studyLanguageLabel}</div>
            </div>

            <div className="rounded-2xl border border-ink-200 bg-[var(--surface)] px-4 py-3">
              <span className="field-label">Reading difficulty</span>
              <div className="font-medium text-ink-900">
                {settings?.learningLevel ?? "Not selected"}
              </div>
            </div>

            <div className="rounded-2xl border border-ink-200 bg-[var(--surface)] px-4 py-3">
              <span className="field-label">Current English focus word</span>
              <div className="font-medium text-ink-900">
                {recommendation?.focusWord ?? "Press discover to choose one"}
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                {recommendation?.focusDefinition ??
                  "We will look for an anchor meaning that does not yet have much learned vocabulary around it, then show its English focus word here."}
              </p>
            </div>

            {recommendation?.focusTags?.length ? (
              <div className="rounded-2xl border border-ink-200 bg-[var(--surface)] px-4 py-3">
                <span className="field-label">Meaning tags</span>
                <div className="flex flex-wrap gap-2">
                  {recommendation.focusTags.map((tag) => (
                    <span key={tag} className="soft-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {recommendation ? (
              <div className="rounded-2xl border border-ink-200 bg-[var(--surface)] px-4 py-3">
                <span className="field-label">Generated</span>
                <div className="font-medium text-ink-900">
                  {formatGeneratedAt(recommendation.generatedAt)}
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {isLoading ? (
          <Card className="flex min-h-64 flex-col justify-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-700">
              Building your reading shelf
            </p>
            <h2 className="mt-4 font-display text-3xl tracking-[-0.03em] text-ink-900">
              Looking for articles around your next focus word
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">
              We are finding short English articles that repeatedly use the chosen English focus
              word and fit the current dashboard discovery pass.
            </p>
          </Card>
        ) : errorMessage ? (
          <EmptyState
            eyebrow="Discover paused"
            title="We could not build this reading shelf"
            description={errorMessage}
          />
        ) : !recommendation ? (
          <EmptyState
            eyebrow="Ready when you are"
            title="A focused article shelf will appear here"
            description="When you press discover, the dashboard will choose an under-explored anchor meaning, show its English focus word, and return up to three short article previews you can open directly."
          />
        ) : recommendation.articles.length === 0 ? (
          <EmptyState
            eyebrow="No strong matches"
            title={`No article previews came back for ${recommendation.focusWord}`}
            description="Try the discover button again and we will pick another low-exposure focus word."
          />
        ) : (
          <DiscoverRecommendationCard recommendation={recommendation} />
        )}
      </div>
    </div>
  );
}
