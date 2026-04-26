export function LoadingState({
  title = "Loading your study space",
  description = "Pulling your dashboard session and preparing the current study snapshot.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
          WordLoom Dashboard
        </p>
        <h1 className="mt-3 font-display text-3xl tracking-[-0.03em] text-ink-900">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          {description}
        </p>
      </div>
    </div>
  );
}
