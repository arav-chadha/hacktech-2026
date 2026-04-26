"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboardAuth } from "@/components/providers/dashboard-auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Button } from "@/components/ui/button";
import { AuthRequiredState } from "@/components/ui/auth-required-state";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/vocabulary", label: "Vocabulary" },
  { href: "/settings", label: "Settings" },
  { href: "/discover", label: "Discover" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = useDashboardAuth();
  const { ready, languages, settings } = useDashboard();
  const activeLanguage = languages.find((entry) => entry.code === settings?.studyLanguageCode);

  if (auth.loading) {
    return (
      <LoadingState
        title="Checking your dashboard session"
        description="Verifying your Google sign-in and restoring the secure backend session."
      />
    );
  }

  if (!auth.email) {
    return (
      <AuthRequiredState
        error={auth.error}
        loading={auth.loading}
        onSignIn={() => {
          void auth.signIn();
        }}
      />
    );
  }

  if (!ready || !settings) {
    return (
      <LoadingState
        title="Loading your study space"
        description="Pulling your Mongo-backed settings, vocabulary history, and dashboard metadata."
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-4 text-ink-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4 lg:flex-row">
        <aside className="panel w-full bg-[var(--surface)] p-5 lg:w-72 lg:p-6">
          <div className="flex items-center justify-between border-b border-ink-200 pb-5 lg:block">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-700">
                WordLoom
              </p>
              <h1 className="mt-2 font-display text-3xl tracking-[-0.04em] text-ink-900">
                Everyday learning
              </h1>
              <p className="mt-3 max-w-xs text-sm leading-6 text-ink-600">
                A calm place to keep your reading practice, saved vocabulary, and next study moves in view.
              </p>
            </div>
            <div className="soft-pill">
              Connected
            </div>
          </div>

          <nav className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-8 lg:grid-cols-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-2xl border px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "border-accent-100 bg-blush-50 text-accent-700"
                      : "border-transparent bg-oat-50 text-ink-600 hover:border-ink-200 hover:bg-[var(--surface)] hover:text-ink-900"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 rounded-2xl border border-ink-200 bg-oat-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Current focus
            </p>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-2xl tracking-[-0.03em] text-ink-900">{activeLanguage?.label}</p>
                <p className="mt-1 text-sm text-ink-600">{settings.learningLevel} level</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-ink-200 bg-[var(--surface-soft)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Signed in
            </p>
            <p className="mt-3 break-all text-sm font-medium text-ink-900">{auth.email}</p>
            <Button
              className="mt-4 w-full"
              variant="secondary"
              onClick={() => {
                void auth.logout();
              }}
            >
              Sign out
            </Button>
          </div>
        </aside>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
