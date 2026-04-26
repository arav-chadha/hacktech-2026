import * as localConfig from "./local-config.js";

const DEFAULT_DASHBOARD_GOOGLE_CLIENT_ID =
  "1005130732109-rsq1vv3mkd3lqaqep9evho5ndknpcbsn.apps.googleusercontent.com";
const DEFAULT_DASHBOARD_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

function normalizeString(value) {
  return String(value ?? "").trim();
}

function parseOriginList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeString).filter(Boolean);
  }

  return normalizeString(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getDashboardGoogleClientId() {
  return (
    normalizeString(process.env.DASHBOARD_GOOGLE_CLIENT_ID) ||
    normalizeString(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) ||
    normalizeString(localConfig.DASHBOARD_GOOGLE_CLIENT_ID) ||
    normalizeString(localConfig.GOOGLE_CLIENT_ID) ||
    DEFAULT_DASHBOARD_GOOGLE_CLIENT_ID
  );
}

export function getDashboardAllowedOrigins() {
  const configuredOrigins = [
    ...parseOriginList(process.env.DASHBOARD_ALLOWED_ORIGINS),
    ...parseOriginList(localConfig.DASHBOARD_ALLOWED_ORIGINS),
  ];

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  return DEFAULT_DASHBOARD_ALLOWED_ORIGINS;
}

export function resolveDashboardOrigin(origin) {
  const normalizedOrigin = normalizeString(origin);
  if (!normalizedOrigin) {
    return null;
  }

  return getDashboardAllowedOrigins().includes(normalizedOrigin) ? normalizedOrigin : null;
}

export function getDashboardSessionSecret() {
  return (
    normalizeString(process.env.DASHBOARD_SESSION_SECRET) ||
    normalizeString(localConfig.DASHBOARD_SESSION_SECRET) ||
    "hacktech-dashboard-session-dev-secret"
  );
}

export function getFirecrawlApiKey() {
  return (
    normalizeString(process.env.FIRECRAWL_API_KEY) ||
    normalizeString(localConfig.FIRECRAWL_API_KEY) ||
    ""
  );
}
