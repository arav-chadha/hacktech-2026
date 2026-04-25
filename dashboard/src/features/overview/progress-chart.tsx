"use client";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ProgressPoint, ProgressRange } from "@/lib/types/dashboard";
import { formatDateLabel } from "@/lib/utils/format";

const RANGE_OPTIONS: Array<{ label: string; value: ProgressRange }> = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "All", value: "all" },
];

function buildLinePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function ProgressChart({
  range,
  series,
  onRangeChange,
}: {
  range: ProgressRange;
  series: ProgressPoint[];
  onRangeChange: (range: ProgressRange) => void;
}) {
  const width = 640;
  const height = 230;
  const chartHeight = 156;
  const chartTop = 26;
  const baseline = chartTop + chartHeight;
  const maxDiscovered = Math.max(...series.map((point) => point.discoveredWords), 1);
  const minCumulative = Math.min(...series.map((point) => point.cumulativeWords), 0);
  const maxCumulative = Math.max(...series.map((point) => point.cumulativeWords), 1);
  const xStep = series.length > 1 ? width / (series.length - 1) : width;

  const linePoints = series.map((point, index) => {
    const x = index * xStep;
    const ratio =
      maxCumulative === minCumulative
        ? 0.5
        : (point.cumulativeWords - minCumulative) / (maxCumulative - minCumulative);
    const y = chartTop + (1 - ratio) * chartHeight;
    return { x, y };
  });

  const linePath = buildLinePath(linePoints);
  const lineFillPath =
    linePoints.length > 1
      ? `${linePath} L ${linePoints[linePoints.length - 1]?.x ?? 0} ${baseline} L ${
          linePoints[0]?.x ?? 0
        } ${baseline} Z`
      : "";

  return (
    <Card>
      <SectionHeading
        title="Daily progress"
        description="Track daily discoveries and the longer-term growth of your vocabulary."
        action={<SegmentedControl value={range} options={RANGE_OPTIONS} onChange={onRangeChange} />}
      />

      <div className="rounded-xl border border-ink-100 bg-ink-50/70 p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="Progress chart">
          {[0, 1, 2, 3].map((step) => {
            const y = chartTop + (chartHeight / 3) * step;
            return (
              <line
                key={step}
                x1="0"
                x2={width}
                y1={y}
                y2={y}
                stroke="#dbe4ee"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
            );
          })}

          {series.map((point, index) => {
            const barHeight = (point.discoveredWords / maxDiscovered) * 82;
            const x = index * xStep;

            return (
              <rect
                key={point.date}
                x={Math.max(0, x - Math.max(3, xStep * 0.2))}
                y={baseline - barHeight}
                width={Math.max(6, xStep * 0.4)}
                height={barHeight}
                rx="4"
                fill={index === series.length - 1 ? "#2563eb" : "#cbd5e1"}
              />
            );
          })}

          {lineFillPath ? <path d={lineFillPath} fill="rgba(37, 99, 235, 0.08)" /> : null}
          <path d={linePath} fill="none" stroke="#0f172a" strokeWidth="2.5" />
          {linePoints.length > 0 ? (
            <circle
              cx={linePoints[linePoints.length - 1]?.x ?? 0}
              cy={linePoints[linePoints.length - 1]?.y ?? 0}
              r="5"
              fill="#0f172a"
            />
          ) : null}
        </svg>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent-600" />
              Daily discoveries
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-ink-900" />
              Cumulative growth
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>{formatDateLabel(series[0]?.date ?? new Date().toISOString().slice(0, 10))}</span>
            <span className="text-ink-300">to</span>
            <span>{formatDateLabel(series[series.length - 1]?.date ?? new Date().toISOString().slice(0, 10))}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
