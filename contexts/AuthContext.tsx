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

  // ✅ compatível com AuthGate.tsx
  initializing: boolean;

  // (mantém como você já usa no AppProvider)
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // ✅ "initializing" só para primeira carga (AuthGate usa isso)
  const [initializing, setInitializing] = useState(true);

  // ✅ "loading" para operações de auth / refresh (AppProvider usa isso)
  const [loading, setLoading] = useState(true);

  // evita reentrância / loops quando eventos de foco disparam
  const refreshingRef = useRef(false);

  // ✅ garante que não dispare vários loads de profile ao mesmo tempo
  const profilePromiseRef = useRef<Promise<Profile | null> | null>(null);

  /* =========================
     Buscar perfil / Criar se não existir
  ========================= */
  async function loadOrCreateProfile(sessionUser: any): Promise<Profile | null> {
    if (!supabase || !sessionUser?.id) return null;

    // ✅ single-flight: se já tem uma busca rolando, reutiliza
    if (profilePromiseRef.current) return profilePromiseRef.current;

    profilePromiseRef.current = (async () => {
      const uid = sessionUser.id as string;
      const email = (sessionUser.email as string | undefined) ?? null;

      // 1) tenta buscar
      try {
        const { data: p1, error: e1 } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

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

      // 2) não existe -> tenta criar
      try {
        const { error: e2 } = await supabase.from('profiles').insert({
          id: uid,
          email,
          role: 'coordenador',
          full_name: null,
        });

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
        const { data: p2, error: e3 } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

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
    })();

    try {
      return await profilePromiseRef.current;
    } finally {
      profilePromiseRef.current = null;
    }
  }

  /**
   * ✅ Revalida sessão e profile sem precisar F5
   * (quando volta foco/visibilidade, ou se algo ficar stale)
   */
  async function ensureSessionAndProfile(reason: string) {
    if (AUTH_MODE !== 'supabase') return;
    if (!supabase) return;
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      if (error) console.error('[Auth] ensureSession getSession error', error, { reason });

      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);

      if (!sessionUser) {
        setProfile(null);
        return;
      }

      const p = await loadOrCreateProfile(sessionUser);
      setProfile(p);
    } catch (e) {
      console.error('[Auth] ensureSession exception', e, { reason });
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }

  /* =========================
     Sessão inicial + listener (SUPABASE)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') {
      // modo mock: não travar AuthGate
      setUser(null);
      setProfile(null);
      setLoading(false);
      setInitializing(false);
      return;
    }

    if (!supabase) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      setInitializing(false);
      return;
    }

    let mounted = true;
    const safeSet = (fn: () => void) => mounted && fn();

    const loadSession = async () => {
      safeSet(() => {
        setLoading(true);
        setInitializing(true);
      });

      try {
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
        safeSet(() => {
          setLoading(false);
          setInitializing(false);
        });
      }
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================
     Quando volta o foco/visibilidade, revalida sessão+profile (sem F5)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;

    const onFocus = () => ensureSessionAndProfile('focus');
    const onVisibility = () => {
      if (!document.hidden) ensureSessionAndProfile('visibility');
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUTH_MODE]);

  /* =========================
     Auth actions
  ========================= */
  async function signIn(email: string, password: string) {
    if (AUTH_MODE === 'mock') return;
    if (!supabase) throw new Error('Supabase não configurado (VITE_SUPABASE_URL/ANON_KEY).');

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // ✅ garante sessão + profile logo após login (sem depender do listener)
      await ensureSessionAndProfile('signIn');
    } finally {
      setLoading(false);
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
