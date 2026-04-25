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
    <Card className="h-full">
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
      <p className="mt-2 text-sm leading-6 text-ink-500">{supporting}</p>
    </Card>
  );
}
