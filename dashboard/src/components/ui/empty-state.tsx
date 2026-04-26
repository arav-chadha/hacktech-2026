import { Card } from "@/components/ui/card";

export function EmptyState({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <Card className="flex min-h-64 flex-col justify-center bg-[var(--surface)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-700">{eyebrow}</p>
      <h2 className="mt-4 max-w-xl font-display text-3xl tracking-[-0.03em] text-ink-900">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-600">{description}</p>
    </Card>
  );
}
