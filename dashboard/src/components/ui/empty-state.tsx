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
    <Card className="flex min-h-64 flex-col justify-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">{eyebrow}</p>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-500">{description}</p>
    </Card>
  );
}
