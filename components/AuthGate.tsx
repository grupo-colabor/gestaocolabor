import { type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import Login from "./Login";

type Props = { children: ReactNode };

export default function AuthGate({ children }: Props) {
  const { user, initializing } = useAuth();

  // ✅ enquanto estiver inicializando auth, não decide nada
  if (initializing) {
    return (
      <div className="p-6">
        <p>Carregando sessão...</p>
      </div>
    );
  }

  // ✅ sem user => login | com user => app
  if (!user) return <Login />;

  return <>{children}</>;
}
