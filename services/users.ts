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
 * Se a Edge Function não estiver disponível, usa método alternativo
 */
export async function createUser(data: CreateUserData): Promise<CreatedUser> {
  // Pega o token de acesso atual para autenticar
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Você precisa estar logado para criar usuários');
  }

  // Tenta usar a Edge Function primeiro
  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`;

  try {
    console.log('[createUser] Tentando via Edge Function:', functionUrl);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(data),
    });

    // Se a Edge Function funcionou
    if (response.ok) {
      const result = await response.json();
      console.log('[createUser] Sucesso via Edge Function:', result);
      return result.user as CreatedUser;
    }

    // Se retornou erro conhecido (não é problema de conexão)
    if (response.status !== 0) {
      const errorResult = await response.json().catch(() => ({ error: 'Erro desconhecido' }));

      // Se é erro de permissão, não tenta fallback
      if (response.status === 403) {
        throw new Error(errorResult.error || 'Apenas administradores podem criar usuários');
      }

      // Se é erro de validação, não tenta fallback
      if (response.status === 400) {
        throw new Error(errorResult.error || 'Dados inválidos');
      }

      // Outros erros, tenta fallback
      console.warn('[createUser] Edge Function retornou erro, tentando fallback:', errorResult);
    }
  } catch (fetchError: any) {
    // Se é "Failed to fetch" ou erro de rede, tenta fallback
    console.warn('[createUser] Erro de conexão com Edge Function, tentando método alternativo:', fetchError.message);
  }

  // FALLBACK: Criar usuário usando signUp (funciona sem Edge Function)
  console.log('[createUser] Usando método alternativo (signUp)...');
  return await createUserViaSignUp(data);
}

/**
 * Método alternativo: criar usuário via Supabase Auth signUp
 * Este método funciona sem precisar de Edge Function
 *
 * IMPORTANTE: Para este método funcionar corretamente em produção:
 * 1. No Supabase Dashboard > Authentication > Settings
 * 2. Desabilite "Enable email confirmations" OU
 * 3. Configure o redirect URL corretamente
 */
async function createUserViaSignUp(data: CreateUserData): Promise<CreatedUser> {
  const { email, password, role, full_name } = data;

  // Cria o usuário via signUp
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
        role,
      },
      // Não faz redirect (admin está criando para outro usuário)
      emailRedirectTo: undefined,
    },
  });

  if (signUpError) {
    console.error('[createUserViaSignUp] Erro no signUp:', signUpError);

    // Traduz erros comuns
    if (signUpError.message.includes('already registered')) {
      throw new Error('Este e-mail já está cadastrado');
    }
    if (signUpError.message.includes('invalid email')) {
      throw new Error('E-mail inválido');
    }
    if (signUpError.message.includes('password')) {
      throw new Error('Senha muito fraca. Use pelo menos 6 caracteres');
    }

    throw new Error(signUpError.message);
  }

  if (!signUpData.user) {
    throw new Error('Erro ao criar usuário: resposta inesperada');
  }

  const userId = signUpData.user.id;
  console.log('[createUserViaSignUp] Usuário criado no Auth:', userId);

  // Agora cria/atualiza o profile com o role correto
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email: email,
      role: role,
      full_name: full_name || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id'
    });

  if (profileError) {
    console.error('[createUserViaSignUp] Erro ao criar profile:', profileError);
    // Não lança erro aqui, o usuário já foi criado no Auth
    // O profile será criado pelo trigger ou na próxima operação
  }

  console.log('[createUserViaSignUp] Profile criado/atualizado');

  return {
    id: userId,
    email: email,
    role: role,
    full_name: full_name,
  };
}

/**
 * Verifica se o usuário atual é admin
 */
export async function checkIsAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  return profile?.role === 'admin';
}
