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
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] px-6">
      <div className="panel w-full max-w-lg p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
          Language Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
          Sign in to load your dashboard
        </h1>
        <p className="mt-3 text-sm leading-7 text-ink-500">
          The dashboard now reads your study settings and vocabulary history through the Node
          backend, so it needs a verified Google session before it can query MongoDB.
        </p>

        <div className="mt-6 flex justify-center">
          <Button onClick={onSignIn} disabled={loading}>
            {loading ? "Connecting..." : "Sign in with Google"}
          </Button>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
