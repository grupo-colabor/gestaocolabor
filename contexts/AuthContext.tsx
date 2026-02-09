import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { AUTH_MODE } from '../config/authMode';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

export type Role = 'admin' | 'analista' | 'coordenador';

export type Profile = {
  id: string;
  email: string;
  role: Role;
  full_name?: string | null;
};

type AuthContextType = {
  user: any;
  profile: Profile | null;
  role: Role | null;
  initializing: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isAnalista: boolean;
  isCoordenador: boolean;
  canAccessDashboard: boolean;
  canAccessAgenda: boolean;
};

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/* =========================
   UTILIDADES DE LOG E DEBUG
========================= */
const LOG_PREFIX = '[Auth]';

function logAuth(action: string, data?: any) {
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  console.log(`${LOG_PREFIX} [${timestamp}] ${action}`, data ?? '');
}

function logAuthWarn(action: string, data?: any) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.warn(`${LOG_PREFIX} [${timestamp}] ⚠️ ${action}`, data ?? '');
}

function logAuthError(action: string, data?: any) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`${LOG_PREFIX} [${timestamp}] ❌ ${action}`, data ?? '');
}

/* =========================
   NORMALIZAÇÃO DE ROLE
========================= */
function normalizeRole(role: any): Role {
  if (role === 'admin' || role === 'analista' || role === 'coordenador') return role;
  return 'coordenador';
}

/* =========================
   TIMEOUT COM PROMISE
========================= */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        logAuthWarn(`Timeout (${ms}ms) em: ${label}`);
        reject(new Error(`Timeout: ${label}`));
      }, ms)
    ),
  ]);
}

/* =========================
   PROVIDER PRINCIPAL
========================= */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(true);

  // Refs para evitar race conditions
  const refreshingRef = useRef(false);
  const profilePromiseRef = useRef<Promise<Profile | null> | null>(null);
  const mountedRef = useRef(true);
  const lastEventRef = useRef<string>('');
  const sessionCheckedRef = useRef(false);

  // Safe state setter - só atualiza se montado
  const safeSetState = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T, label: string) => {
    if (mountedRef.current) {
      logAuth(`setState: ${label}`, typeof value === 'object' ? JSON.stringify(value)?.slice(0, 100) : value);
      setter(value);
    } else {
      logAuthWarn(`setState ignorado (unmounted): ${label}`);
    }
  };

  /* =========================
     BUSCAR/CRIAR PROFILE
  ========================= */
  async function loadOrCreateProfile(sessionUser: any): Promise<Profile | null> {
    if (!supabase || !sessionUser?.id) {
      logAuthWarn('loadOrCreateProfile: sem supabase ou sessionUser');
      return null;
    }

    // Single-flight: reutiliza promise em andamento
    if (profilePromiseRef.current) {
      logAuth('loadOrCreateProfile: reutilizando promise em andamento');
      return profilePromiseRef.current;
    }

    profilePromiseRef.current = (async () => {
      const uid = sessionUser.id as string;
      const email = sessionUser.email ?? null;

      logAuth('loadOrCreateProfile: buscando', { uid, email });

      // 1) Tenta buscar profile existente
      try {
        const { data: existingProfile, error } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

        if (error) {
          logAuthError('loadOrCreateProfile: erro ao buscar', error);
          return null;
        }

        if (existingProfile) {
          const normalized = {
            ...existingProfile,
            role: normalizeRole(existingProfile.role),
          } as Profile;
          logAuth('loadOrCreateProfile: profile encontrado', { role: normalized.role });
          return normalized;
        }
      } catch (err) {
        logAuthError('loadOrCreateProfile: exception ao buscar', err);
        return null;
      }

      // 2) Profile não existe -> criar
      logAuth('loadOrCreateProfile: criando novo profile');
      try {
        const { error: insertError } = await supabase.from('profiles').insert({
          id: uid,
          email,
          role: 'coordenador',
          full_name: null,
        });

        if (insertError) {
          logAuthError('loadOrCreateProfile: erro ao criar', insertError);
          return null;
        }
      } catch (err) {
        logAuthError('loadOrCreateProfile: exception ao criar', err);
        return null;
      }

      // 3) Busca novamente após criar
      try {
        const { data: newProfile, error } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

        if (error || !newProfile) {
          logAuthError('loadOrCreateProfile: erro ao re-buscar', error);
          return null;
        }

        const normalized = {
          ...newProfile,
          role: normalizeRole(newProfile.role),
        } as Profile;
        logAuth('loadOrCreateProfile: profile criado', { role: normalized.role });
        return normalized;
      } catch (err) {
        logAuthError('loadOrCreateProfile: exception ao re-buscar', err);
        return null;
      }
    })();

    try {
      return await profilePromiseRef.current;
    } finally {
      profilePromiseRef.current = null;
    }
  }

  /* =========================
     CARREGAR PROFILE COM RETRY
  ========================= */
  async function loadProfileWithRetry(sessionUser: any, maxAttempts = 2): Promise<Profile | null> {
    let profile: Profile | null = null;
    let attempts = 0;

    while (!profile && attempts < maxAttempts) {
      attempts++;
      try {
        profile = await withTimeout(
          loadOrCreateProfile(sessionUser),
          20000, // 20s timeout
          `loadOrCreateProfile (attempt ${attempts})`
        );
      } catch (err) {
        logAuthWarn(`loadProfileWithRetry: tentativa ${attempts} falhou`, err);
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 1500)); // Espera 1.5s antes de retry
        }
      }
    }

    return profile;
  }

  /* =========================
     VERIFICAR SESSÃO (para refresh/foco)
  ========================= */
  async function checkSession(reason: string) {
    if (AUTH_MODE !== 'supabase' || !supabase) return;

    // Evita chamadas simultâneas
    if (refreshingRef.current) {
      logAuth(`checkSession: ignorado (já em andamento)`, { reason });
      return;
    }

    refreshingRef.current = true;
    logAuth(`checkSession: iniciando`, { reason });

    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        20000,
        'getSession'
      );

      if (error) {
        logAuthWarn('checkSession: erro em getSession (NÃO faz logout)', { error: error.message, reason });
        // ⚠️ IMPORTANTE: NÃO limpa estado em caso de erro de rede
        return;
      }

      const sessionUser = data.session?.user ?? null;

      if (!sessionUser) {
        logAuth('checkSession: sem sessão válida', { reason });
        // Só limpa se realmente não tem sessão (não é erro)
        safeSetState(setUser, null, 'user (sem sessão)');
        safeSetState(setProfile, null, 'profile (sem sessão)');
        return;
      }

      // Sessão válida - atualiza user
      safeSetState(setUser, sessionUser, 'user');

      // Carrega profile
      const p = await loadProfileWithRetry(sessionUser);

      if (p) {
        safeSetState(setProfile, p, 'profile');
        logAuth('checkSession: profile OK', { role: p.role, reason });
      } else {
        // ⚠️ Profile não carregou, mas NÃO faz logout
        logAuthWarn('checkSession: profile não carregou (mantém sessão)', { reason });
      }

    } catch (err) {
      logAuthError('checkSession: exception (NÃO faz logout)', { err, reason });
      // ⚠️ IMPORTANTE: NÃO limpa estado em caso de exception
    } finally {
      refreshingRef.current = false;
      safeSetState(setLoading, false, 'loading');
    }
  }

  /* =========================
     HANDLER DE EVENTOS DE AUTH
  ========================= */
  async function handleAuthEvent(event: AuthChangeEvent, session: Session | null) {
    const eventKey = `${event}-${session?.user?.id ?? 'none'}-${Date.now()}`;

    // Evita processar eventos duplicados em sequência rápida
    if (lastEventRef.current === eventKey.slice(0, -13)) { // Ignora timestamp nos últimos 13 chars
      logAuth('handleAuthEvent: evento duplicado ignorado', { event });
      return;
    }
    lastEventRef.current = eventKey.slice(0, -13);

    logAuth('handleAuthEvent', {
      event,
      hasSession: !!session,
      userId: session?.user?.id?.slice(0, 8),
      expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
    });

    switch (event) {
      case 'INITIAL_SESSION':
        // Evento inicial - já tratado pelo loadSession
        logAuth('handleAuthEvent: INITIAL_SESSION (ignorado, loadSession já tratou)');
        break;

      case 'SIGNED_IN':
        // Login bem-sucedido
        if (session?.user) {
          safeSetState(setUser, session.user, 'user (SIGNED_IN)');
          safeSetState(setLoading, true, 'loading (SIGNED_IN)');

          const p = await loadProfileWithRetry(session.user);
          if (p) {
            safeSetState(setProfile, p, 'profile (SIGNED_IN)');
          }
          safeSetState(setLoading, false, 'loading (SIGNED_IN done)');
        }
        break;

      case 'SIGNED_OUT':
        // Logout confirmado
        logAuth('handleAuthEvent: SIGNED_OUT - limpando estado');
        safeSetState(setUser, null, 'user (SIGNED_OUT)');
        safeSetState(setProfile, null, 'profile (SIGNED_OUT)');
        safeSetState(setLoading, false, 'loading (SIGNED_OUT)');
        break;

      case 'TOKEN_REFRESHED':
        // Token renovado - atualiza user se necessário
        if (session?.user) {
          logAuth('handleAuthEvent: TOKEN_REFRESHED', {
            newExpiry: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
          });
          safeSetState(setUser, session.user, 'user (TOKEN_REFRESHED)');
          // Não precisa recarregar profile, só o token mudou
        } else {
          // ⚠️ TOKEN_REFRESHED sem sessão é ANÔMALO
          logAuthWarn('handleAuthEvent: TOKEN_REFRESHED sem sessão (possível problema)');
          // NÃO faz logout automático - deixa o próximo getSession decidir
        }
        break;

      case 'USER_UPDATED':
        // Usuário atualizado (email, metadata, etc)
        if (session?.user) {
          logAuth('handleAuthEvent: USER_UPDATED');
          safeSetState(setUser, session.user, 'user (USER_UPDATED)');
        }
        break;

      case 'PASSWORD_RECOVERY':
        logAuth('handleAuthEvent: PASSWORD_RECOVERY');
        break;

      default:
        logAuthWarn('handleAuthEvent: evento desconhecido', { event });
    }
  }

  /* =========================
     EFEITO PRINCIPAL - INICIALIZAÇÃO
  ========================= */
  useEffect(() => {
    mountedRef.current = true;

    if (AUTH_MODE !== 'supabase') {
      logAuth('Modo não-supabase, inicializando vazio');
      setUser(null);
      setProfile(null);
      setLoading(false);
      setInitializing(false);
      return;
    }

    if (!supabase) {
      logAuthError('Supabase client não disponível');
      setUser(null);
      setProfile(null);
      setLoading(false);
      setInitializing(false);
      return;
    }

    /* ---- Carrega sessão inicial ---- */
    const loadSession = async () => {
      logAuth('loadSession: iniciando');
      safeSetState(setLoading, true, 'loading (loadSession start)');
      safeSetState(setInitializing, true, 'initializing (loadSession start)');

      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          25000, // 25s timeout generoso
          'getSession inicial'
        );

        logAuth('loadSession: getSession result', {
          hasSession: !!data?.session,
          error: error?.message,
          userId: data?.session?.user?.id?.slice(0, 8),
          expiresAt: data?.session?.expires_at
            ? new Date(data.session.expires_at * 1000).toISOString()
            : null
        });

        if (error) {
          logAuthError('loadSession: erro em getSession', error);
          // ⚠️ NÃO limpa estado - pode ser erro de rede temporário
          safeSetState(setLoading, false, 'loading (getSession error)');
          safeSetState(setInitializing, false, 'initializing (getSession error)');
          return;
        }

        const sessionUser = data.session?.user ?? null;
        safeSetState(setUser, sessionUser, 'user (loadSession)');

        if (sessionUser) {
          const p = await loadProfileWithRetry(sessionUser);

          if (p) {
            safeSetState(setProfile, p, 'profile (loadSession)');
            logAuth('loadSession: profile carregado', { role: p.role });
          } else {
            logAuthWarn('loadSession: profile não carregou (mantém user)');
            safeSetState(setProfile, null, 'profile null (loadSession)');
          }
        } else {
          logAuth('loadSession: sem sessão válida');
          safeSetState(setProfile, null, 'profile (sem sessão)');
        }

        sessionCheckedRef.current = true;

      } catch (err) {
        logAuthError('loadSession: exception', err);
        // ⚠️ NÃO limpa estado em caso de exception
      } finally {
        safeSetState(setLoading, false, 'loading (loadSession done)');
        safeSetState(setInitializing, false, 'initializing (loadSession done)');
        logAuth('loadSession: finalizado');
      }
    };

    loadSession();

    /* ---- Listener de eventos de auth ---- */
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignora INITIAL_SESSION se já processamos a sessão
      if (event === 'INITIAL_SESSION' && sessionCheckedRef.current) {
        logAuth('onAuthStateChange: INITIAL_SESSION ignorado (já processado)');
        return;
      }

      handleAuthEvent(event, session);
    });

    logAuth('Listener de auth registrado');

    /* ---- Cleanup ---- */
    return () => {
      mountedRef.current = false;
      listener.subscription.unsubscribe();
      logAuth('Cleanup: listener removido');
    };
  }, []);

  /* =========================
     EFEITO - FOCO/VISIBILIDADE
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;

    let focusTimeout: NodeJS.Timeout | null = null;

    const onFocus = () => {
      // Debounce para evitar múltiplas chamadas
      if (focusTimeout) clearTimeout(focusTimeout);
      focusTimeout = setTimeout(() => {
        checkSession('focus');
      }, 500); // Espera 500ms após foco para evitar spam
    };

    const onVisibility = () => {
      if (!document.hidden) {
        // Debounce para evitar múltiplas chamadas
        if (focusTimeout) clearTimeout(focusTimeout);
        focusTimeout = setTimeout(() => {
          checkSession('visibility');
        }, 500);
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (focusTimeout) clearTimeout(focusTimeout);
    };
  }, []);

  /* =========================
     AÇÕES DE AUTH
  ========================= */
  async function signIn(email: string, password: string) {
    if (AUTH_MODE === 'mock') return;
    if (!supabase) throw new Error('Supabase não configurado');

    logAuth('signIn: iniciando', { email });
    safeSetState(setLoading, true, 'loading (signIn)');

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        logAuthError('signIn: erro', error);
        throw error;
      }

      logAuth('signIn: sucesso');
      // O listener vai cuidar de atualizar o estado
      await checkSession('signIn');

    } finally {
      safeSetState(setLoading, false, 'loading (signIn done)');
    }
  }

  async function signOut() {
    logAuth('signOut: iniciando');

    if (AUTH_MODE === 'mock') {
      safeSetState(setUser, null, 'user (signOut mock)');
      safeSetState(setProfile, null, 'profile (signOut mock)');
      return;
    }

    if (!supabase) return;

    try {
      await supabase.auth.signOut();
      logAuth('signOut: sucesso');
    } catch (err) {
      logAuthError('signOut: erro', err);
    }

    // Limpa estado local independente do resultado
    safeSetState(setUser, null, 'user (signOut)');
    safeSetState(setProfile, null, 'profile (signOut)');
  }

  /* =========================
     COMPUTED VALUES
  ========================= */
  const role = profile?.role ?? null;
  const isAdmin = role === 'admin';
  const isAnalista = role === 'analista';
  const isCoordenador = role === 'coordenador';
  const canAccessDashboard = isAdmin || isAnalista;
  const canAccessAgenda = isAdmin || isCoordenador;

  const value = useMemo(
    () => ({
      user,
      profile,
      role,
      initializing,
      loading,
      signIn,
      signOut,
      isAdmin,
      isAnalista,
      isCoordenador,
      canAccessDashboard,
      canAccessAgenda,
    }),
    [user, profile, role, initializing, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
