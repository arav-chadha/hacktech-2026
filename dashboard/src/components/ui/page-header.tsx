import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-5 border-b border-ink-200 pb-6 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">{eyebrow}</p>
        <h1 className="mt-3 font-display text-3xl tracking-[-0.03em] text-ink-900 sm:text-[2.35rem]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-7 text-ink-600">{description}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
