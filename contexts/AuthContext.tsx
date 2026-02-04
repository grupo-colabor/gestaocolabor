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

function normalizeRole(role: any): Role {
  if (role === 'admin' || role === 'analista' || role === 'coordenador') return role;
  return 'coordenador';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(true);

  const profilePromiseRef = useRef<Promise<Profile | null> | null>(null);
  const refreshingRef = useRef(false);

  /* =========================
     🔧 CORREÇÃO 1: Buscar perfil SEM forçar logout em caso de erro
  ========================= */
  async function loadOrCreateProfile(sessionUser: any): Promise<Profile | null> {
    if (!supabase || !sessionUser?.id) return null;

    // Single-flight: se já tem uma busca rolando, reutiliza
    if (profilePromiseRef.current) return profilePromiseRef.current;

    profilePromiseRef.current = (async () => {
      const uid = sessionUser.id as string;
      const email = (sessionUser.email as string | undefined) ?? null;

      // 1) Tenta buscar perfil existente
      try {
        const { data: p1, error: e1 } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

        if (e1) {
          console.error('[Auth] profiles select error', e1);
          // ❌ ANTES: return null (causava logout)
          // ✅ AGORA: tenta criar mesmo assim
        }

        if (p1) {
          return {
            ...(p1 as any),
            role: normalizeRole((p1 as any).role),
          } as Profile;
        }
      } catch (err) {
        console.error('[Auth] profiles select exception', err);
        // Continua para tentar criar
      }

      // 2) Se não existe, tenta criar
      try {
        const { error: e2 } = await supabase.from('profiles').insert({
          id: uid,
          email,
          role: 'coordenador',
          full_name: null,
        });

        if (e2) {
          console.error('[Auth] profiles insert error', e2);
          // ❌ ANTES: return null
          // ✅ AGORA: continua para tentar buscar novamente
        }
      } catch (err) {
        console.error('[Auth] profiles insert exception', err);
      }

      // 3) Busca novamente após criar
      try {
        const { data: p2, error: e3 } = await supabase
          .from('profiles')
          .select('id, email, role, full_name')
          .eq('id', uid)
          .maybeSingle();

        if (e3) {
          console.error('[Auth] profiles re-select error', e3);
        }

        if (p2) {
          return {
            ...(p2 as any),
            role: normalizeRole((p2 as any).role),
          } as Profile;
        }

        // ✅ FALLBACK: se não conseguiu buscar, retorna um perfil temporário
        console.warn('[Auth] usando perfil temporário até conseguir sincronizar');
        return {
          id: uid,
          email: email || 'sem-email',
          role: 'coordenador' as Role,
          full_name: null,
        };

      } catch (err) {
        console.error('[Auth] profiles re-select exception', err);
        
        // ✅ FALLBACK: retorna perfil temporário
        return {
          id: uid,
          email: email || 'sem-email',
          role: 'coordenador' as Role,
          full_name: null,
        };
      }
    })();

    try {
      return await profilePromiseRef.current;
    } finally {
      profilePromiseRef.current = null;
    }
  }

  /* =========================
     🔧 CORREÇÃO 2: Revalidar sessão SEM fazer logout agressivo
  ========================= */
  async function ensureSessionAndProfile(reason: string) {
    if (AUTH_MODE !== 'supabase') return;
    if (!supabase) return;
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('[Auth] getSession error', error);
        // ❌ ANTES: fazia logout
        // ✅ AGORA: apenas loga o erro e continua
      }

      const sessionUser = data?.session?.user ?? null;
      setUser(sessionUser);

      if (!sessionUser) {
        setProfile(null);
        return;
      }

      // Busca o perfil (com fallback temporário)
      const p = await loadOrCreateProfile(sessionUser);
      setProfile(p);

    } catch (e) {
      console.error('[Auth] ensureSession exception', e, { reason });
      // ❌ ANTES: fazia logout e zerava tudo
      // ✅ AGORA: apenas loga o erro
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }

  /* =========================
     🔧 CORREÇÃO 3: Sessão inicial SEM timeouts agressivos
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') {
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
        // ✅ SEM TIMEOUT - deixa o Supabase resolver naturalmente
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[Auth] getSession error', error);
          // ❌ ANTES: fazia logout
          // ✅ AGORA: continua normalmente
        }

        const sessionUser = data?.session?.user ?? null;
        safeSet(() => setUser(sessionUser));

        if (sessionUser) {
          // Busca perfil (com fallback temporário)
          const p = await loadOrCreateProfile(sessionUser);
          safeSet(() => setProfile(p));
        } else {
          safeSet(() => setProfile(null));
        }

      } catch (e) {
        console.error('[Auth] loadSession exception', e);
        // ❌ ANTES: fazia logout forçado
        // ✅ AGORA: apenas loga o erro e deixa o usuário tentar login
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

    // Listener de mudanças de autenticação
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
      } catch (e) {
        console.error('[Auth] onAuthStateChange error', e);
        // ✅ Não faz logout, apenas loga
      } finally {
        safeSet(() => setLoading(false));
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /* =========================
     🔧 CORREÇÃO 4: Revalidação em foco/visibilidade (mais suave)
  ========================= */
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;

    const onFocus = () => {
      // Só revalida se já tiver usuário
      if (user) ensureSessionAndProfile('focus');
    };

    const onVisibility = () => {
      if (!document.hidden && user) {
        ensureSessionAndProfile('visibility');
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  /* =========================
     Sign In / Sign Out
  ========================= */
  async function signIn(email: string, password: string) {
    if (AUTH_MODE !== 'supabase' || !supabase) {
      throw new Error('Auth não configurado');
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);

      if (sessionUser) {
        const p = await loadOrCreateProfile(sessionUser);
        setProfile(p);
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    if (AUTH_MODE !== 'supabase' || !supabase) return;

    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
    } catch (e) {
      console.error('[Auth] signOut error', e);
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     Computed Values
  ========================= */
  const role = useMemo(() => profile?.role ?? null, [profile]);
  const isAdmin = useMemo(() => role === 'admin', [role]);
  const isAnalista = useMemo(() => role === 'analista', [role]);
  const isCoordenador = useMemo(() => role === 'coordenador', [role]);

  const canAccessDashboard = useMemo(
    () => isAdmin || isAnalista,
    [isAdmin, isAnalista]
  );

  const canAccessAgenda = useMemo(() => true, []);

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
    [
      user,
      profile,
      role,
      initializing,
      loading,
      isAdmin,
      isAnalista,
      isCoordenador,
      canAccessDashboard,
      canAccessAgenda,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}