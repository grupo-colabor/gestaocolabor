import { supabase } from '../lib/supabase';
import type { Role } from '../contexts/AuthContext';

export interface ProfileData {
  id: string;
  email: string;
  role: Role;
  full_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Busca o perfil do usuário logado
 */
export async function fetchMyProfile(): Promise<ProfileData | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('[profiles] fetchMyProfile error:', error);
    return null;
  }

  return data as ProfileData;
}

/**
 * Atualiza o perfil do usuário logado
 */
export async function updateMyProfile(updates: Partial<Pick<ProfileData, 'full_name'>>): Promise<ProfileData | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    console.error('[profiles] updateMyProfile error:', error);
    throw error;
  }

  return data as ProfileData;
}

/**
 * Busca todos os perfis (somente admin)
 */
export async function fetchAllProfiles(): Promise<ProfileData[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[profiles] fetchAllProfiles error:', error);
    throw error;
  }

  return (data || []) as ProfileData[];
}

/**
 * Atualiza o role de um usuário (somente admin)
 */
export async function updateUserRole(userId: string, role: Role): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error('[profiles] updateUserRole error:', error);
    throw error;
  }
}
