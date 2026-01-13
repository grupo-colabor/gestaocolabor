export type AuthMode = 'mock' | 'supabase';

export const AUTH_MODE: AuthMode =
  (import.meta.env.VITE_AUTH_MODE as AuthMode) || 'mock';
