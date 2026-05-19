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
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('[profiles] fetchMyProfile auth error:', authError);
      return null;
    }

    if (!user) {
      console.log('[profiles] fetchMyProfile: no user logged in');
      return null;
    }

    if (import.meta.env.DEV) console.log('[profiles] fetchMyProfile for user:', user.id);

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, full_name, created_at, updated_at')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('[profiles] fetchMyProfile error:', error);

      // Se o profile não existe, tenta criar um básico
      if (error.code === 'PGRST116') { // Row not found
        console.log('[profiles] Profile not found, creating basic profile...');
        return await createBasicProfile(user.id, user.email || '');
      }

      return null;
    }

    if (import.meta.env.DEV) console.log('[profiles] fetchMyProfile success:', data?.email);
    return data as ProfileData;
  } catch (e) {
    console.error('[profiles] fetchMyProfile exception:', e);
    return null;
  }
}

/**
 * Cria um perfil básico para usuário que não tem
 */
async function createBasicProfile(userId: string, email: string): Promise<ProfileData | null> {
  try {
    const newProfile = {
      id: userId,
      email: email,
      role: 'coordenador' as Role, // Role padrão
      full_name: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('profiles')
      .insert(newProfile)
      .select()
      .single();

    if (error) {
      console.error('[profiles] createBasicProfile error:', error);
      return null;
    }

    console.log('[profiles] createBasicProfile success');
    return data as ProfileData;
  } catch (e) {
    console.error('[profiles] createBasicProfile exception:', e);
    return null;
  }
}

/**
 * Atualiza o perfil do usuário logado
 */
export async function updateMyProfile(updates: Partial<Pick<ProfileData, 'full_name'>>): Promise<ProfileData | null> {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('Usuário não autenticado');
    }

    if (import.meta.env.DEV) console.log('[profiles] updateMyProfile for user:', user.id, updates);

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

    console.log('[profiles] updateMyProfile success');
    return data as ProfileData;
  } catch (e: any) {
    console.error('[profiles] updateMyProfile exception:', e);
    throw e;
  }
}

/**
 * Busca todos os perfis (somente admin)
 * Retorna lista vazia em caso de erro (não quebra a UI)
 */
export async function fetchAllProfiles(): Promise<ProfileData[]> {
  try {
    console.log('[profiles] fetchAllProfiles starting...');

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, full_name, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[profiles] fetchAllProfiles error:', error);

      // Se for erro de permissão (RLS), retorna vazio
      if (error.code === '42501' || error.message.includes('permission')) {
        console.warn('[profiles] Permission denied - user may not be admin');
        return [];
      }

      throw error;
    }

    console.log('[profiles] fetchAllProfiles success, count:', data?.length || 0);
    return (data || []) as ProfileData[];
  } catch (e) {
    console.error('[profiles] fetchAllProfiles exception:', e);
    return []; // Retorna vazio para não quebrar a UI
  }
}

/**
 * Atualiza o role de um usuário (somente admin)
 */
export async function updateUserRole(userId: string, role: Role): Promise<void> {
  try {
    if (import.meta.env.DEV) console.log('[profiles] updateUserRole:', userId, role);

    const { error } = await supabase
      .from('profiles')
      .update({
        role,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      console.error('[profiles] updateUserRole error:', error);
      throw error;
    }

    console.log('[profiles] updateUserRole success');
  } catch (e) {
    console.error('[profiles] updateUserRole exception:', e);
    throw e;
  }
}

/**
 * Busca um perfil específico por ID
 */
export async function fetchProfileById(userId: string): Promise<ProfileData | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, full_name, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[profiles] fetchProfileById error:', error);
      return null;
    }

    return data as ProfileData;
  } catch (e) {
    console.error('[profiles] fetchProfileById exception:', e);
    return null;
  }
}
