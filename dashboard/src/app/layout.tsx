import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardAuthProvider } from "@/components/providers/dashboard-auth-provider";
import { DashboardProvider } from "@/components/providers/dashboard-provider";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Language Dashboard",
  description: "Backend-connected learning dashboard for the language extension.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <DashboardAuthProvider>
          <DashboardProvider>
            <AppShell>{children}</AppShell>
          </DashboardProvider>
        </DashboardAuthProvider>
      </body>
    </html>
  );
}
