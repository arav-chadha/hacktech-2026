import crypto from "node:crypto";
import { getDashboardGoogleClientId, getDashboardSessionSecret } from "./dashboardConfig.js";

const DASHBOARD_SESSION_COOKIE_NAME = "hacktech_dashboard_session";
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function toBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(String(value ?? ""), "base64url").toString("utf8");
}

function signValue(value) {
  return crypto
    .createHmac("sha256", getDashboardSessionSecret())
    .update(value)
    .digest("base64url");
}

function appendCookie(response, cookieValue) {
  const existingCookies = response.getHeader("Set-Cookie");

  if (!existingCookies) {
    response.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(existingCookies)) {
    response.setHeader("Set-Cookie", [...existingCookies, cookieValue]);
    return;
  }

  response.setHeader("Set-Cookie", [existingCookies, cookieValue]);
}

function buildCookieAttributes(maxAgeSeconds) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function parseCookies(request) {
  const rawCookieHeader = String(request.headers.cookie ?? "");
  if (!rawCookieHeader) {
    return new Map();
  }

  return new Map(
    rawCookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex === -1) {
          return [entry, ""];
        }

        return [
          entry.slice(0, separatorIndex).trim(),
          decodeURIComponent(entry.slice(separatorIndex + 1).trim()),
        ];
      })
  );
}

function buildSessionCookieValue(email) {
  const payload = {
    email,
    exp: Date.now() + DASHBOARD_SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseSessionCookieValue(cookieValue) {
  const [encodedPayload = "", signature = ""] = String(cookieValue ?? "").split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    const email = normalizeEmail(payload?.email);
    const expiresAt = Number(payload?.exp ?? 0);

    if (!email || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    return {
      email,
      userEmailLower: email,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function readJsonResponse(response) {
  const responseText = await response.text();

  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Google returned an unreadable verification payload.");
  }
}

async function verifyAccessToken(accessToken) {
  const tokenInfoUrl = new URL("https://www.googleapis.com/oauth2/v3/tokeninfo");
  tokenInfoUrl.searchParams.set("access_token", accessToken);

  const tokenInfoResponse = await fetch(tokenInfoUrl);
  const tokenInfo = await readJsonResponse(tokenInfoResponse);

  if (!tokenInfoResponse.ok) {
    throw new Error(tokenInfo?.error_description || tokenInfo?.error || "Google token verification failed.");
  }

  const expectedClientId = getDashboardGoogleClientId();
  if (expectedClientId && tokenInfo?.aud && tokenInfo.aud !== expectedClientId) {
    throw new Error("Google token audience did not match the configured dashboard client.");
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const userInfo = await readJsonResponse(userInfoResponse);

  if (!userInfoResponse.ok) {
    throw new Error(userInfo?.error?.message || userInfo?.error || "Failed to read Google user profile.");
  }

  const email = normalizeEmail(userInfo?.email);
  if (!email) {
    throw new Error("Google did not return an email address for this account.");
  }

  if (userInfo?.verified_email === false) {
    throw new Error("Google account email must be verified.");
  }

  return {
    email,
    name: String(userInfo?.name ?? "").trim() || null,
    picture: String(userInfo?.picture ?? "").trim() || null,
  };
}

async function verifyIdToken(idToken) {
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("id_token", idToken);

  const response = await fetch(tokenInfoUrl);
  const tokenInfo = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(tokenInfo?.error_description || tokenInfo?.error || "Google ID token verification failed.");
  }

  const expectedClientId = getDashboardGoogleClientId();
  if (expectedClientId && tokenInfo?.aud && tokenInfo.aud !== expectedClientId) {
    throw new Error("Google token audience did not match the configured dashboard client.");
  }

  const email = normalizeEmail(tokenInfo?.email);
  if (!email) {
    throw new Error("Google did not return an email address for this account.");
  }

  if (String(tokenInfo?.email_verified ?? "").toLowerCase() !== "true") {
    throw new Error("Google account email must be verified.");
  }

  return {
    email,
    name: String(tokenInfo?.name ?? "").trim() || null,
    picture: String(tokenInfo?.picture ?? "").trim() || null,
  };
}

export function getDashboardSessionFromRequest(request) {
  const cookies = parseCookies(request);
  const cookieValue = cookies.get(DASHBOARD_SESSION_COOKIE_NAME);
  if (!cookieValue) {
    return null;
  }

  return parseSessionCookieValue(cookieValue);
}

export function setDashboardSessionCookie(response, email) {
  const normalizedEmail = normalizeEmail(email);
  const cookiePayload = buildSessionCookieValue(normalizedEmail);

  appendCookie(
    response,
    `${DASHBOARD_SESSION_COOKIE_NAME}=${encodeURIComponent(cookiePayload)}; ${buildCookieAttributes(
      DASHBOARD_SESSION_MAX_AGE_SECONDS
    )}`
  );
}

export function clearDashboardSessionCookie(response) {
  appendCookie(
    response,
    `${DASHBOARD_SESSION_COOKIE_NAME}=; ${buildCookieAttributes(0)}`
  );
}

export async function verifyGoogleDashboardCredential({
  accessToken,
  idToken,
}) {
  const normalizedAccessToken = String(accessToken ?? "").trim();
  const normalizedIdToken = String(idToken ?? "").trim();

  if (normalizedAccessToken) {
    return verifyAccessToken(normalizedAccessToken);
  }

  if (normalizedIdToken) {
    return verifyIdToken(normalizedIdToken);
  }

  throw new Error("A Google access token or ID token is required.");
}
