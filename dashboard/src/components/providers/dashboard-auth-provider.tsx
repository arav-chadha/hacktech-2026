"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { dashboardConfig } from "@/lib/config";

type DashboardAuthContextValue = {
  email: string | null;
  loading: boolean;
  error: Error | null;
  signIn: () => Promise<string | null>;
  logout: () => Promise<void>;
};

type DashboardSessionResponse = {
  session?: {
    email?: string;
  };
  error?: string;
};

type PendingSignInState = {
  resolve: (value: string | null) => void;
  reject: (reason?: unknown) => void;
};

const DashboardAuthContext = createContext<DashboardAuthContextValue | null>(null);

let googleIdentityScriptPromise: Promise<void> | null = null;

function normalizeError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}

function buildDashboardAuthError(message: string, status?: number) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function readAuthResponse(response: Response) {
  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText) as DashboardSessionResponse;
  } catch {
    throw new Error("Dashboard auth returned an unreadable response.");
  }
}

async function requestDashboardAuth(
  path: string,
  init?: RequestInit
): Promise<DashboardSessionResponse> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${dashboardConfig.apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const payload = await readAuthResponse(response);

  if (!response.ok) {
    throw buildDashboardAuthError(
      payload?.error || `Dashboard auth request failed (${response.status}).`,
      response.status
    );
  }

  return payload;
}

function loadGoogleIdentityScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Identity Services are only available in the browser."));
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google Identity Services.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(script);
  }).catch((error) => {
    googleIdentityScriptPromise = null;
    throw error;
  });

  return googleIdentityScriptPromise;
}

export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const tokenClientRef = useRef<GoogleTokenClient | null>(null);
  const pendingSignInRef = useRef<PendingSignInState | null>(null);

  function settlePendingSignIn(result: { email?: string | null; error?: Error | null }) {
    const pendingState = pendingSignInRef.current;
    pendingSignInRef.current = null;

    if (!pendingState) {
      return;
    }

    if (result.error) {
      pendingState.reject(result.error);
      return;
    }

    pendingState.resolve(result.email ?? null);
  }

  async function ensureTokenClient() {
    await loadGoogleIdentityScript();

    if (tokenClientRef.current) {
      return tokenClientRef.current;
    }

    if (!window.google?.accounts?.oauth2) {
      throw new Error("Google Identity Services did not finish loading.");
    }

    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: dashboardConfig.googleClientId,
      scope: "openid email profile https://www.googleapis.com/auth/userinfo.email",
      callback: async (response) => {
        try {
          if (response.error || !response.access_token) {
            throw new Error(
              response.error_description || response.error || "Google sign-in was cancelled."
            );
          }

          const payload = await requestDashboardAuth("/dashboard/auth/google", {
            method: "POST",
            body: JSON.stringify({
              accessToken: response.access_token,
            }),
          });
          const nextEmail = String(payload?.session?.email ?? "").trim();

          if (!nextEmail) {
            throw new Error("Dashboard auth completed without a user email.");
          }

          setEmail(nextEmail);
          setError(null);
          settlePendingSignIn({ email: nextEmail });
        } catch (signInError) {
          const normalizedError = normalizeError(signInError, "Google sign-in failed.");
          setError(normalizedError);
          settlePendingSignIn({ error: normalizedError });
        } finally {
          setLoading(false);
        }
      },
      error_callback: (googleError) => {
        const normalizedError = new Error(
          googleError?.message || "Google sign-in failed to open."
        );
        setError(normalizedError);
        setLoading(false);
        settlePendingSignIn({ error: normalizedError });
      },
    });

    return tokenClientRef.current;
  }

  useEffect(() => {
    let isActive = true;

    async function hydrateSession() {
      try {
        await loadGoogleIdentityScript().catch((scriptError) => {
          if (isActive) {
            setError(normalizeError(scriptError, "Google sign-in is unavailable."));
          }
        });

        const payload = await requestDashboardAuth("/dashboard/auth/me", {
          method: "GET",
        });

        if (!isActive) {
          return;
        }

        const nextEmail = String(payload?.session?.email ?? "").trim();
        setEmail(nextEmail || null);
        setError(null);
      } catch (sessionError) {
        if (!isActive) {
          return;
        }

        const normalizedError = normalizeError(sessionError, "Failed to load dashboard session.");
        const sessionStatus = (normalizedError as Error & { status?: number }).status;

        if (sessionStatus === 401) {
          setEmail(null);
          return;
        }

        setError(normalizedError);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      isActive = false;
    };
  }, []);

  async function signIn() {
    setError(null);
    setLoading(true);

    try {
      const tokenClient = await ensureTokenClient();

      return await new Promise<string | null>((resolve, reject) => {
        pendingSignInRef.current = { resolve, reject };
        tokenClient.requestAccessToken({ prompt: "consent" });
      });
    } catch (signInError) {
      const normalizedError = normalizeError(signInError, "Google sign-in failed.");
      setError(normalizedError);
      setLoading(false);
      throw normalizedError;
    }
  }

  async function logout() {
    setLoading(true);

    try {
      await requestDashboardAuth("/dashboard/auth/logout", {
        method: "POST",
      });
      setEmail(null);
      setError(null);
    } catch (logoutError) {
      setError(normalizeError(logoutError, "Failed to sign out of the dashboard."));
      throw logoutError;
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardAuthContext.Provider
      value={{
        email,
        loading,
        error,
        signIn,
        logout,
      }}
    >
      {children}
    </DashboardAuthContext.Provider>
  );
}

export function useDashboardAuth() {
  const context = useContext(DashboardAuthContext);

  if (!context) {
    throw new Error("useDashboardAuth must be used within a DashboardAuthProvider.");
  }

  return context;
}
