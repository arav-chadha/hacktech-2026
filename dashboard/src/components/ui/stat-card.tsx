import { Card } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting: string;
}) {
  return (
    <Card className="h-full bg-[var(--surface)]">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-ink-500">{label}</p>
      <p className="mt-4 font-display text-4xl tracking-[-0.04em] text-ink-900">{value}</p>
      <p className="mt-3 text-sm leading-6 text-ink-600">{supporting}</p>
    </Card>
  );
}
