const DEFAULT_DASHBOARD_API_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_GOOGLE_CLIENT_ID =
  "1005130732109-rsq1vv3mkd3lqaqep9evho5ndknpcbsn.apps.googleusercontent.com";

export const dashboardConfig = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_DASHBOARD_API_BASE_URL?.trim() || DEFAULT_DASHBOARD_API_BASE_URL,
  googleClientId:
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID,
};
