import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export function DiscoverPage() {
  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] border-ink-200 bg-white p-6 sm:p-8">
      <PageHeader
        eyebrow="Discover"
        title="A reserved space for smarter reading recommendations"
        description="This page is intentionally lightweight for now. It keeps the structure ready for a later agentic search flow that can recommend articles aligned to your study language and level."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <Card className="h-fit">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
            Planned filters
          </p>
          <div className="mt-5 space-y-3 text-sm text-ink-600">
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-4 py-3">
              Current study language
            </div>
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-4 py-3">
              Reading difficulty
            </div>
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-4 py-3">
              Topic preferences
            </div>
          </div>
        </Card>

        <EmptyState
          eyebrow="Coming later"
          title="Article recommendations are not wired up yet"
          description="When the search and recommendation backend is added, this space can show curated articles in the active learning language, along with lightweight reasoning for why each article fits your level and goals."
        />
      </div>
    </div>
  );
}
