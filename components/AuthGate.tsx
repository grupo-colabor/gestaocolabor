import { type ReactNode } from 'react';
import { useAuth } from '../contexts/useAuth';
import Login from './Login';

type Props = {
  children: ReactNode;
};

export default function AuthGate({ children }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span>Carregando...</span>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}