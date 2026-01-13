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

function normalizeRole(role: any): Role {
  if (role === 'admin' || role === 'analista' || role === 'coordenador') return role;
  return 'coordenador';
}

// Aceita PromiseLike (os builders do Supabase são “thenable”)
async function withTimeout<T>(
  promiseLike: PromiseLike<T>,
  ms: number,
  label: string
): Promise<T> {
  const p = Promise.resolve(promiseLike);

  // Se a aba estiver em background, NÃO force timeout curto (evita “Acesso não autorizado” ao trocar de aba)
  const effectiveMs = document.hidden ? Math.max(ms, 60000) : ms;

  let t: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = window.setTimeout(() => reject(new Error(`Timeout: ${label}`)), effectiveMs);
  });

  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) window.clearTimeout(t);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // evita reentrância / loops quando eventos de foco disparam
  const refreshingRef = useRef(false);

  console.log('[Auth] render', { AUTH_MODE, hasSupabase: !!supabase, loading });

  /* =========================
     MODO MOCK (DEV/TESTE)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'mock') return;

    // IMPORTANTE: em mock, precisa ter user truthy pra passar do AuthGate
    setUser({ id: 'dev-user', email: 'dev@local.test' });

    setProfile({
      id: 'dev-user',
      email: 'dev@local.test',
      role: 'admin',
      full_name: 'Dev User',
    });

    setLoading(false);
  }, []);

  /* =========================
     Buscar perfil / Criar se não existir
  ========================= */
  async function loadOrCreateProfile(sessionUser: any): Promise<Profile | null> {
    if (!supabase || !sessionUser?.id) return null;

    const uid = sessionUser.id as string;
    const email = (sessionUser.email as string | undefined) ?? null;

    // 1) tenta buscar
    try {
      const { data: p1, error: e1 } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle(),
        20000,
        'profiles.select'
      );

      if (e1) {
        console.error('[Auth] profiles select error', e1);
        return null;
      }

      if (p1) {
        return {
          ...(p1 as any),
          role: normalizeRole((p1 as any).role),
        } as Profile;
      }
    } catch (err) {
      console.error('[Auth] profiles select exception', err);
      return null;
    }

    // 2) não existe -> tenta criar (policy INSERT own deve permitir)
    console.warn('[Auth] profile not found -> creating...');

    try {
      const { error: e2 } = await withTimeout(
        supabase.from('profiles').insert({
          id: uid,
          email,
          role: 'coordenador', // default seguro
          full_name: null,
        }),
        20000,
        'profiles.insert'
      );

      if (e2) {
        console.error('[Auth] profiles insert error', e2);
        return null;
      }
    } catch (err) {
      console.error('[Auth] profiles insert exception', err);
      return null;
    }

    // 3) busca novamente
    try {
      const { data: p2, error: e3 } = await withTimeout(
        supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle(),
        20000,
        'profiles.reselect'
      );

      if (e3) {
        console.error('[Auth] profiles re-select error', e3);
        return null;
      }

      if (!p2) return null;

      return {
        ...(p2 as any),
        role: normalizeRole((p2 as any).role),
      } as Profile;
    } catch (err) {
      console.error('[Auth] profiles re-select exception', err);
      return null;
    }
  }

  async function refreshProfileIfNeeded(reason: string) {
    if (AUTH_MODE !== 'supabase') return;
    if (!supabase) return;
    if (refreshingRef.current) return;

    // só tenta se tiver user e profile estiver null (ou inválido)
    const currentUser = user;
    if (!currentUser?.id) return;
    if (profile?.id === currentUser.id) return; // já ok

    refreshingRef.current = true;
    console.log('[Auth] refreshProfileIfNeeded', { reason });

    try {
      setLoading(true);
      const p = await loadOrCreateProfile(currentUser);
      setProfile(p);
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }

  /* =========================
     Sessão inicial + listener (SUPABASE)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;

    console.log('[Auth] supabase effect start');

    if (!supabase) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    const safeSet = (fn: () => void) => mounted && fn();

    const loadSession = async () => {
      safeSet(() => setLoading(true));
      console.log('[Auth] getSession start');

      try {
        // getSession normalmente é rápido — não vamos “matar” com timeout curto
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error('[Auth] getSession error', error);

        const sessionUser = data.session?.user ?? null;
        safeSet(() => setUser(sessionUser));

        if (sessionUser) {
          const p = await loadOrCreateProfile(sessionUser);
          safeSet(() => setProfile(p));
        } else {
          safeSet(() => setProfile(null));
        }
      } catch (e) {
        console.error('[Auth] loadSession exception', e);
        safeSet(() => {
          setUser(null);
          setProfile(null);
        });
      } finally {
        safeSet(() => setLoading(false));
        console.log('[Auth] getSession end -> setLoading(false)');
      }
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const sessionUser = session?.user ?? null;
        safeSet(() => setUser(sessionUser));

        if (!sessionUser) {
          safeSet(() => {
            setProfile(null);
            setLoading(false);
          });
          return;
        }

        safeSet(() => setLoading(true));
        try {
          const p = await loadOrCreateProfile(sessionUser);
          safeSet(() => setProfile(p));
        } finally {
          safeSet(() => setLoading(false));
        }
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /* =========================
     Quando volta o foco/visibilidade, recarrega profile se necessário
     (corrige o "Acesso não autorizado" depois de trocar de aba/janela)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;

    const onFocus = () => refreshProfileIfNeeded('focus');
    const onVisibility = () => {
      if (!document.hidden) refreshProfileIfNeeded('visibility');
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUTH_MODE, user?.id, profile?.id]);

  /* =========================
     Auth actions
  ========================= */
  async function signIn(email: string, password: string) {
    if (AUTH_MODE === 'mock') return;
    if (!supabase) throw new Error('Supabase não configurado (VITE_SUPABASE_URL/ANON_KEY).');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // depois do login, garante profile
    const { data } = await supabase.auth.getSession();
    const sessionUser = data.session?.user ?? null;
    setUser(sessionUser);

    if (sessionUser) {
      setLoading(true);
      try {
        const p = await loadOrCreateProfile(sessionUser);
        setProfile(p);
      } finally {
        setLoading(false);
      }
    }
  }

  async function signOut() {
    if (AUTH_MODE === 'mock') {
      setUser(null);
      setProfile(null);
      return;
    }
    if (!supabase) return;

    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  /* =========================
     Regras de acesso
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
      loading,
      signIn,
      signOut,
      isAdmin,
      isAnalista,
      isCoordenador,
      canAccessDashboard,
      canAccessAgenda,
    }),
    [user, profile, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
