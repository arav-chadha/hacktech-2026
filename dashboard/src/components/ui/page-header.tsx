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
    <div className="mb-6 flex flex-col gap-4 border-b border-ink-200 pb-6 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-900 sm:text-[2rem]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-7 text-ink-500">{description}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}
