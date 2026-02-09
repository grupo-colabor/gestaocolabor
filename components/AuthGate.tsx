import { type ReactNode, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import Login from "./Login";

type Props = { children: ReactNode };

/**
 * AuthGate - Controla acesso ao app baseado no estado de autenticação
 *
 * REGRAS:
 * 1. NUNCA mostra Login enquanto `initializing === true`
 * 2. Só mostra Login quando `initializing === false` E `user === null`
 * 3. Loga todas as decisões para diagnóstico
 */
export default function AuthGate({ children }: Props) {
  const { user, initializing, loading } = useAuth();
  const lastDecisionRef = useRef<string>('');

  // Log de decisões para diagnóstico
  useEffect(() => {
    const decision = initializing
      ? 'LOADING'
      : user
        ? 'AUTHENTICATED'
        : 'SHOW_LOGIN';

    // Só loga se a decisão mudou
    if (decision !== lastDecisionRef.current) {
      const timestamp = new Date().toISOString().slice(11, 23);
      console.log(`[AuthGate] [${timestamp}] Decisão: ${decision}`, {
        initializing,
        hasUser: !!user,
        loading,
        userId: user?.id?.slice(0, 8),
      });
      lastDecisionRef.current = decision;
    }
  }, [initializing, user, loading]);

  // ✅ Estado 1: Inicializando - mostra loading
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* Spinner animado */}
          <div className="inline-block w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-600 text-lg font-medium">Verificando sessão...</p>
          <p className="text-gray-400 text-sm mt-1">Aguarde um momento</p>
        </div>
      </div>
    );
  }

  // ✅ Estado 2: Sem usuário - mostra Login
  if (!user) {
    return <Login />;
  }

  // ✅ Estado 3: Usuário autenticado - mostra o app
  return <>{children}</>;
}
