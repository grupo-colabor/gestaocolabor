import { supabase } from '../lib/supabase';
import type { Role } from '../contexts/AuthContext';

export interface CreateUserData {
  email: string;
  password: string;
  role: Role;
  full_name?: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  role: Role;
  full_name?: string;
}

/**
 * Cria um novo usuário via Edge Function do Supabase
 * Apenas admins podem chamar esta função
 */
export async function createUser(data: CreateUserData): Promise<CreatedUser> {
  // Pega o token de acesso atual para autenticar na Edge Function
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Você precisa estar logado para criar usuários');
  }

  // URL da Edge Function - ajuste para seu projeto
  // Em produção, será algo como: https://<project-ref>.supabase.co/functions/v1/create-user
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Erro ao criar usuário');
  }

  return result.user as CreatedUser;
}

/**
 * Método alternativo: criar usuário diretamente via Supabase Auth
 * ⚠️ ATENÇÃO: Este método só funciona se você tiver:
 *    1. Desabilitado "Email confirmations" no Supabase Auth settings, OU
 *    2. O usuário confirmar o email depois
 *
 * Para produção, recomendo usar a Edge Function acima.
 */
export async function createUserDirect(data: CreateUserData): Promise<void> {
  // Este método usa signUp que está disponível para qualquer um
  // Não é ideal para admin criar usuários, pois:
  // 1. Pode disparar email de confirmação
  // 2. Não garante que o usuário será criado com o role correto

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.full_name,
        role: data.role,
      },
    },
  });

  if (signUpError) {
    throw signUpError;
  }

  // Se conseguiu criar, atualiza o profile com o role correto
  if (signUpData.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: signUpData.user.id,
        email: data.email,
        role: data.role,
        full_name: data.full_name || null,
      });

    if (profileError) {
      console.error('[users] Erro ao criar profile:', profileError);
      // Não lança erro aqui pois o usuário já foi criado
    }
  }
}
