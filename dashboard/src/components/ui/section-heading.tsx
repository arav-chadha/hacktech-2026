import type { ReactNode } from "react";

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-ink-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="font-display text-[1.6rem] tracking-[-0.03em] text-ink-900">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
