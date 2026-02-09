import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] ❌ Variáveis de ambiente não configuradas:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey
  });
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      // ✅ Persiste sessão no localStorage (padrão)
      persistSession: true,

      // ✅ Auto refresh do token antes de expirar
      autoRefreshToken: true,

      // ✅ Detecta tokens na URL (para OAuth/magic links)
      detectSessionInUrl: true,

      // ✅ Storage padrão (localStorage)
      // Não customizar a menos que tenha um motivo específico
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,

      // ✅ Intervalo de auto-refresh (5 minutos antes de expirar)
      // O token JWT do Supabase dura 1 hora por padrão
      // storageKey: 'supabase.auth.token', // padrão

      // ✅ Flow type para SPA
      flowType: 'pkce',
    },

    // ✅ Configurações globais de fetch
    global: {
      headers: {
        'x-client-info': 'colabor-training-manager',
      },
    },

    // ✅ Realtime config
    realtime: {
      params: {
        eventsPerSecond: 10, // Limita eventos por segundo
      },
    },
  }
);

// Log de inicialização
console.log('[Supabase] Cliente inicializado', {
  url: supabaseUrl?.slice(0, 30) + '...',
  hasKey: !!supabaseAnonKey,
});
