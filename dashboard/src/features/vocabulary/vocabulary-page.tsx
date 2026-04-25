"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type {
  LearningLevel,
  VocabularyEntry,
  VocabularyFilters,
  VocabularySortBy,
  VocabularyStatus,
} from "@/lib/types/dashboard";
import { formatDateLabel } from "@/lib/utils/format";

const DEFAULT_FILTERS: VocabularyFilters = {
  searchQuery: "",
  languageCode: "all",
  level: "all",
  status: "all",
  sortBy: "dateDiscovered",
  sortDirection: "desc",
};

export function VocabularyPage() {
  const { repository, languages } = useDashboard();
  const [filters, setFilters] = useState<VocabularyFilters>(DEFAULT_FILTERS);
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const deferredSearch = useDeferredValue(filters.searchQuery);

  useEffect(() => {
    let isActive = true;

    async function load() {
      const nextEntries = await repository.getVocabularyEntries({
        ...filters,
        searchQuery: deferredSearch,
      });

      if (isActive) {
        setEntries(nextEntries);
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [
    deferredSearch,
    filters.languageCode,
    filters.level,
    filters.sortBy,
    filters.sortDirection,
    filters.status,
    repository,
  ]);

  function updateFilter<K extends keyof VocabularyFilters>(key: K, value: VocabularyFilters[K]) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] border-ink-200 bg-white p-6 sm:p-8">
      <PageHeader
        eyebrow="Vocabulary"
        title="Your learned words, kept readable"
        description="Use this table as the dependable source of truth for what has already entered your study loop. Search fast, sort clearly, and keep the controls close to the data."
      />

      <Card>
        <div className="grid gap-4 border-b border-ink-100 pb-5 md:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <label className="field-label" htmlFor="vocabulary-search">
              Search words
            </label>
            <input
              id="vocabulary-search"
              className="field-input"
              value={filters.searchQuery}
              onChange={(event) => updateFilter("searchQuery", event.target.value)}
              placeholder="Search English or translated words"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="vocabulary-language">
              Language
            </label>
            <select
              id="vocabulary-language"
              className="field-input"
              value={filters.languageCode}
              onChange={(event) => updateFilter("languageCode", event.target.value)}
            >
              <option value="all">All languages</option>
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="vocabulary-level">
              Level
            </label>
            <select
              id="vocabulary-level"
              className="field-input"
              value={filters.level}
              onChange={(event) =>
                updateFilter("level", event.target.value as LearningLevel | "all")
              }
            >
              <option value="all">All levels</option>
              <option value="Beginner">Beginner</option>
              <option value="Elementary">Elementary</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="vocabulary-status">
              Status
            </label>
            <select
              id="vocabulary-status"
              className="field-input"
              value={filters.status}
              onChange={(event) =>
                updateFilter("status", event.target.value as VocabularyStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              <option value="New">New</option>
              <option value="Practicing">Practicing</option>
              <option value="Confident">Confident</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-b border-ink-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <label className="field-label mb-0" htmlFor="vocabulary-sort">
              Sort by
            </label>
            <select
              id="vocabulary-sort"
              className="field-input min-w-44"
              value={filters.sortBy}
              onChange={(event) => updateFilter("sortBy", event.target.value as VocabularySortBy)}
            >
              <option value="dateDiscovered">Date discovered</option>
              <option value="sourceWord">Source word</option>
              <option value="learnedWord">Learned word</option>
              <option value="level">Level</option>
              <option value="status">Status</option>
            </select>
            <select
              aria-label="Sort direction"
              className="field-input min-w-32"
              value={filters.sortDirection}
              onChange={(event) =>
                updateFilter("sortDirection", event.target.value as "asc" | "desc")
              }
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          <p className="text-sm text-ink-500">{entries.length} words in this view</p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.15em] text-ink-400">
                <th className="border-b border-ink-100 pb-3 pr-6">Source</th>
                <th className="border-b border-ink-100 pb-3 pr-6">Learned word</th>
                <th className="border-b border-ink-100 pb-3 pr-6">Language</th>
                <th className="border-b border-ink-100 pb-3 pr-6">Level</th>
                <th className="border-b border-ink-100 pb-3 pr-6">Date discovered</th>
                <th className="border-b border-ink-100 pb-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="text-sm text-ink-700">
                  <td className="border-b border-ink-100 py-4 pr-6 font-medium text-ink-900">
                    {entry.sourceWord}
                  </td>
                  <td className="border-b border-ink-100 py-4 pr-6">{entry.learnedWord}</td>
                  <td className="border-b border-ink-100 py-4 pr-6">{entry.languageLabel}</td>
                  <td className="border-b border-ink-100 py-4 pr-6">{entry.level}</td>
                  <td className="border-b border-ink-100 py-4 pr-6">
                    {formatDateLabel(entry.dateDiscovered)}
                  </td>
                  <td className="border-b border-ink-100 py-4">
                    <span className="inline-flex rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-xs font-medium text-ink-700">
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-6 py-10 text-center text-sm text-ink-500">
              No words match the current search and filter set.
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
