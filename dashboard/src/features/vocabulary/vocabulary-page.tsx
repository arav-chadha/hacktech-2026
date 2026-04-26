"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SemanticMapCard } from "@/features/vocabulary/semantic-map-card";
import type {
  LearningLevel,
  SemanticGraphNode,
  SemanticGraphSnapshot,
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
  const { repository, languages, settings } = useDashboard();
  const [filters, setFilters] = useState<VocabularyFilters>(DEFAULT_FILTERS);
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [semanticMap, setSemanticMap] = useState<SemanticGraphSnapshot | null>(null);
  const [selectedSemanticNode, setSelectedSemanticNode] = useState<SemanticGraphNode | null>(null);
  const [didInitializeLanguage, setDidInitializeLanguage] = useState(false);
  const deferredSearch = useDeferredValue(filters.searchQuery);

  useEffect(() => {
    if (didInitializeLanguage || !settings?.studyLanguageCode) {
      return;
    }

    setFilters((current) => ({
      ...current,
      languageCode: settings.studyLanguageCode,
    }));
    setDidInitializeLanguage(true);
  }, [didInitializeLanguage, settings?.studyLanguageCode]);

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
    void repository.getVocabularySemanticMap().then((snapshot) => {
      if (isActive) {
        setSemanticMap(snapshot);
      }
    });

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

  const relatedSemanticEntries =
    selectedSemanticNode?.kind === "learned-word"
      ? entries.filter(
          (entry) =>
            entry.sourceWord.toLowerCase() === selectedSemanticNode.sourceWord.toLowerCase() ||
            entry.learnedWord.toLowerCase() === selectedSemanticNode.learnedWord.toLowerCase()
        )
      : selectedSemanticNode?.kind === "anchor" && semanticMap
        ? entries.filter((entry) =>
            semanticMap.nodes.some(
              (node) =>
                node.kind === "learned-word" &&
                node.anchorId === selectedSemanticNode.id &&
                (
                  node.sourceWord.toLowerCase() === entry.sourceWord.toLowerCase() ||
                  node.learnedWord.toLowerCase() === entry.learnedWord.toLowerCase()
                )
            )
          )
        : entries;

  const languageLabels = useMemo(
    () => Object.fromEntries(languages.map((language) => [language.code, language.label])),
    [languages]
  );

  const visibleSemanticMap = useMemo(() => {
    if (!semanticMap) {
      return null;
    }

    const visibleEntryKeys = new Set(
      entries.map(
        (entry) =>
          `${entry.languageCode}::${entry.sourceWord.toLowerCase()}::${entry.learnedWord.toLowerCase()}`
      )
    );

    const visibleNodes = semanticMap.nodes.filter((node) => {
      if (node.kind === "anchor") {
        return true;
      }

      return visibleEntryKeys.has(
        `${node.languageCode}::${node.sourceWord.toLowerCase()}::${node.learnedWord.toLowerCase()}`
      );
    });

    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleLinks = semanticMap.links.filter(
      (link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)
    );

    return {
      ...semanticMap,
      nodes: visibleNodes,
      links: visibleLinks,
    };
  }, [entries, semanticMap]);

  useEffect(() => {
    if (!visibleSemanticMap || !selectedSemanticNode) {
      return;
    }

    const stillVisible = visibleSemanticMap.nodes.some((node) => node.id === selectedSemanticNode.id);
    if (!stillVisible) {
      setSelectedSemanticNode(null);
    }
  }, [selectedSemanticNode, visibleSemanticMap]);

  useEffect(() => {
    if (!visibleSemanticMap || deferredSearch.trim().length === 0) {
      return;
    }

    const query = deferredSearch.trim().toLowerCase();
    const nextNode =
      visibleSemanticMap.nodes.find((node) => node.label.toLowerCase() === query) ??
      visibleSemanticMap.nodes.find(
        (node) =>
          node.kind === "learned-word" &&
          (
            node.learnedWord.toLowerCase() === query ||
            node.sourceWord.toLowerCase() === query
          )
      ) ??
      visibleSemanticMap.nodes.find((node) => node.label.toLowerCase().includes(query)) ??
      visibleSemanticMap.nodes.find(
        (node) =>
          node.kind === "learned-word" &&
          (
            node.learnedWord.toLowerCase().includes(query) ||
            node.sourceWord.toLowerCase().includes(query)
          )
      );

    if (nextNode) {
      setSelectedSemanticNode(nextNode);
    }
  }, [deferredSearch, visibleSemanticMap]);

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
        title="Your learned words"
        description="Search, filter, and manage your vocabulary with focused controls."
      />

      <Card className="mb-6">
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

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <p className="text-sm text-ink-500">{relatedSemanticEntries.length} words in this view</p>
        </div>
      </Card>

      <div className="mb-6">
        <SemanticMapCard
          snapshot={visibleSemanticMap}
          selectedNodeId={selectedSemanticNode?.id ?? null}
          languageLabels={languageLabels}
          onSelectNode={setSelectedSemanticNode}
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => updateFilter("searchQuery", query)}
          languageCode={filters.languageCode}
          onLanguageChange={(code) => updateFilter("languageCode", code)}
          level={filters.level}
          onLevelChange={(level) => updateFilter("level", level as LearningLevel | "all")}
          status={filters.status}
          onStatusChange={(status) => updateFilter("status", status as VocabularyStatus | "all")}
        />
      </div>

      <Card>
        {selectedSemanticNode ? (
          <div className="mb-5 rounded-xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-accent-800">
            Table context is currently focused by the semantic map selection:
            {" "}
            <strong>{selectedSemanticNode.label}</strong>
            {selectedSemanticNode.kind === "anchor"
              ? " and its linked learned words."
              : " and its matching vocabulary row."}
          </div>
        ) : null}

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
              {relatedSemanticEntries.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer text-sm text-ink-700 transition hover:bg-ink-50/80"
                  onClick={() => {
                    const matchingNode = visibleSemanticMap?.nodes.find(
                      (node) =>
                        node.kind === "learned-word" &&
                        node.languageCode === entry.languageCode &&
                        node.sourceWord.toLowerCase() === entry.sourceWord.toLowerCase() &&
                        node.learnedWord.toLowerCase() === entry.learnedWord.toLowerCase()
                    );

                    if (matchingNode) {
                      setSelectedSemanticNode(matchingNode);
                    }
                  }}
                >
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

          {relatedSemanticEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-6 py-10 text-center text-sm text-ink-500">
              No words match the current search, filter set, and semantic-map selection.
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
