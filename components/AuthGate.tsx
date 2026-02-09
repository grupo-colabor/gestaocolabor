import { type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import Login from "./Login";

type Props = { children: ReactNode };

/**
 * AuthGate - Controla acesso ao app baseado no estado de autenticação
 *
 * IMPORTANTE: Nunca mostra Login enquanto estiver verificando sessão.
 * Isso evita o "flash" de login ao fazer F5 com sessão válida.
 */
export default function AuthGate({ children }: Props) {
  const { user, initializing } = useAuth();

  // ✅ Enquanto estiver inicializando auth, mostra loading elegante
  // NUNCA mostra Login antes de confirmar que não há sessão
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

  // ✅ Só mostra Login DEPOIS de confirmar que não há sessão válida
  if (!user) {
    console.log('[AuthGate] Sem sessão válida, mostrando Login');
    return <Login />;
  }

  // ✅ Usuário autenticado, mostra o app
  return <>{children}</>;
}
