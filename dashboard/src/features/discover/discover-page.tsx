import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export function DiscoverPage() {
  return (
    <div className="panel h-full min-h-[calc(100vh-2rem)] bg-[var(--surface)] p-6 sm:p-8">
      <PageHeader
        eyebrow="Discover"
        title="Find your next gentle reading moment"
        description="This space is ready for search and discovery features that help you find web content matched to your language, level, and current curiosity."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <Card className="h-fit bg-oat-50">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700">
            Planned filters
          </p>
          <div className="mt-5 space-y-3 text-sm text-ink-600">
            <div className="rounded-2xl border border-dashed border-ink-200 bg-[var(--surface)] px-4 py-3">
              Current study language
            </div>
            <div className="rounded-2xl border border-dashed border-ink-200 bg-[var(--surface)] px-4 py-3">
              Reading difficulty
            </div>
            <div className="rounded-2xl border border-dashed border-ink-200 bg-[var(--surface)] px-4 py-3">
              Topic preferences
            </div>
            <div className="rounded-2xl border border-dashed border-ink-200 bg-[var(--surface)] px-4 py-3">
              Saved words you want to reinforce
            </div>
          </div>
        </Card>

        <EmptyState
          eyebrow="Coming later"
          title="A curated reading shelf will live here"
          description="When discovery is wired up, this page can recommend approachable articles, short reads, and searchable topics with a clear explanation of why each option fits your language level and daily pace."
        />
      </div>
    </div>
  );
}
