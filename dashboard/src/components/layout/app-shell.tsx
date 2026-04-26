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
    <div className="min-h-screen bg-[#f4f6f8] px-4 py-4 text-ink-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4 lg:flex-row">
        <aside className="panel w-full border-ink-200 bg-white/95 p-4 lg:w-60 lg:p-4">
          <div className="flex items-center justify-between border-b border-ink-200 pb-4 lg:block">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
                Language Dashboard
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
                Study workspace
              </h1>
            </div>
            <div className="rounded-full border border-accent-100 bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
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
                    "rounded-xl border px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "border-accent-200 bg-accent-50 text-accent-700"
                      : "border-transparent bg-ink-50 text-ink-600 hover:border-ink-200 hover:bg-white hover:text-ink-900"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
              Current focus
            </p>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-ink-900">{activeLanguage?.label}</p>
                <p className="mt-1 text-sm text-ink-500">{settings.learningLevel} level</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-ink-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
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
