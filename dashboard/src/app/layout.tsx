import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardProvider } from "@/components/providers/dashboard-provider";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Language Dashboard",
  description: "Frontend-only learning dashboard for the language extension.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <DashboardProvider>
          <AppShell>{children}</AppShell>
        </DashboardProvider>
      </body>
    </html>
  );
}
