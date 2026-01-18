import { type ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";
import Login from "./Login";

type Props = { children: ReactNode };

export default function AuthGate({ children }: Props) {
  const { user } = useAuth();

  // ✅ Regra simples: sem user => login | com user => app
  if (!user) return <Login />;

  return <>{children}</>;
}
