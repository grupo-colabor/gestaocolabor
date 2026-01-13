import { type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import Login from "./Login";

type Props = { children: ReactNode };

export default function AuthGate({ children }: Props) {
  const { user, loading } = useAuth();

  // ✅ Só mostra loader se ainda NÃO tem usuário (primeira carga / sem sessão)
  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span>Carregando...</span>
      </div>
    );
  }

  if (!user) return <Login />;

  // ✅ Se já tem user, renderiza o app mesmo que loading fique true por refresh
  return <>{children}</>;
}
