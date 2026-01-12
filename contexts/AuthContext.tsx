import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';

/* =========================
   Tipos
========================= */

export type Role = 'admin' | 'analista' | 'coordenador';

export type Profile = {
  id: string;
  email: string;
  role: Role;
};

type AuthContextType = {
  user: any;
  profile: Profile | null;
  role: Role | null;
  loading: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Helpers
  isAdmin: boolean;
  isAnalista: boolean;
  isCoordenador: boolean;

  canAccessDashboard: boolean;
  canAccessAgenda: boolean;
};

/* =========================
   Context
========================= */

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

/* =========================
   Provider
========================= */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  setProfile({
    id: 'dev-user',
    email: 'dev@local.test',
    role: 'admin' // troque depois para analista / coordenador / admin
  });
  setLoading(false);
}, []);

  /* =========================
     Carregar perfil
  ========================= */
  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('id', userId)
      .single();

    if (!error) {
      setProfile(data as Profile);
    }
  }

  /* =========================
     Sessão inicial + listener
  ========================= */
  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user ?? null;

      setUser(sessionUser);

      if (sessionUser) {
        await loadProfile(sessionUser.id);
      } else {
        setProfile(null);
      }

      setLoading(false);
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const sessionUser = session?.user ?? null;
        setUser(sessionUser);

        if (sessionUser) {
          await loadProfile(sessionUser.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  /* =========================
     Auth actions
  ========================= */
  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
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

  /* =========================
     Provider
  ========================= */
  return (
    <AuthContext.Provider
      value={{
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/* =========================
   Hook
========================= */

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
}
