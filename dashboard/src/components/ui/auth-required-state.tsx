import { Button } from "@/components/ui/button";

export function AuthRequiredState({
  error,
  onSignIn,
  loading,
}: {
  error: Error | null;
  onSignIn: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
      <div className="panel w-full max-w-lg p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
          WordLoom Dashboard
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-[-0.03em] text-ink-900">
          Sign in to load your dashboard
        </h1>
        <p className="mt-3 text-sm leading-7 text-ink-600">
          Your everyday learning space syncs reading progress, saved vocabulary, and language
          settings through the backend, so it needs your verified Google session first.
        </p>

        <div className="mt-6 flex justify-center">
          <Button onClick={onSignIn} disabled={loading}>
            {loading ? "Connecting..." : "Sign in with Google"}
          </Button>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-accent-700">
            {error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
