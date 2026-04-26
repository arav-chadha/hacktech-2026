export function LoadingState({
  title = "Loading your study space",
  description = "Pulling your dashboard session and preparing the current study snapshot.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] px-6">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
          Language Dashboard
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-500">
          {description}
        </p>
      </div>
    </div>
  );
}
