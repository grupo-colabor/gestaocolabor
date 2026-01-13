import { type ReactNode } from 'react';
import { useAuth } from '../contexts/useAuth';
import Login from './Login';

type Props = { children: ReactNode };

export default function AuthGate({ children }: Props) {
  const { user, initializing } = useAuth();

  // só bloqueia a tela na primeira inicialização
  if (initializing) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span>Carregando...</span>
      </div>
    );
  }

  if (!user) return <Login />;

  return <>{children}</>;
}
