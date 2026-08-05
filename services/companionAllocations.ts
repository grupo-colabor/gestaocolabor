import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

export interface CompanionAllocationDb {
  id: string;
  demand_id: string;
  instructor_id: string;
  start_date: string;
  end_date: string;
  created_at?: string;
}

/**
 * Buscar todos os acompanhantes
 *
 * Pagina via fetchAllPaginated: select() sem .range() é cortado
 * silenciosamente em ~1000 linhas pelo PostgREST/Supabase. Não havia
 * .order() aqui — adicionado por 'id' (PK) para a paginação ser estável.
 */
export async function fetchCompanionAllocations() {
  return fetchAllPaginated<CompanionAllocationDb>((from, to) =>
    supabase
      .from('companion_allocations')
      .select('*')
      .order('id', { ascending: true })
      .range(from, to)
  );
}

/**
 * Criar um acompanhante
 */
export async function insertCompanionAllocation(payload: Omit<CompanionAllocationDb, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('companion_allocations')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as CompanionAllocationDb;
}

/**
 * Remover acompanhante
 */
export async function deleteCompanionAllocationById(id: string) {
  const { error } = await supabase
    .from('companion_allocations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
