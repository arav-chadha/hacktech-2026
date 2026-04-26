const DEFAULT_DASHBOARD_API_PORT = "8787";
const DEFAULT_DASHBOARD_API_HOSTNAME = "127.0.0.1";
const DEFAULT_GOOGLE_CLIENT_ID =
  "1005130732109-rsq1vv3mkd3lqaqep9evho5ndknpcbsn.apps.googleusercontent.com";

function getDefaultDashboardApiBaseUrl() {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_DASHBOARD_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window !== "undefined" && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_DASHBOARD_API_PORT}`;
  }

  return `http://${DEFAULT_DASHBOARD_API_HOSTNAME}:${DEFAULT_DASHBOARD_API_PORT}`;
}

export const dashboardConfig = {
  get apiBaseUrl() {
    return getDefaultDashboardApiBaseUrl();
  },
  googleClientId:
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID,
};
