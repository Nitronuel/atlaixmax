export const APP_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || '',
  appBaseUrl: (import.meta.env.VITE_APP_BASE_URL || 'https://beta.atlaix.com').replace(/\/+$/, ''),
  marketingBaseUrl: (import.meta.env.VITE_MARKETING_BASE_URL || 'https://atlaix.com').replace(/\/+$/, ''),
  authMode: import.meta.env.VITE_AUTH_MODE === 'public' ? 'public' : 'invite_only',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '') || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
};

export function apiUrl(path: string) {
  return APP_CONFIG.apiBaseUrl ? `${APP_CONFIG.apiBaseUrl}${path}` : path;
}

export function appUrl(path: string) {
  return `${APP_CONFIG.appBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
