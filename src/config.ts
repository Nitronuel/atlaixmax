export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || ''
};

export function apiUrl(path: string) {
  return APP_CONFIG.apiBaseUrl ? `${APP_CONFIG.apiBaseUrl}${path}` : path;
}
