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
  const { data, error } = await supabase
    .from('companion_allocations')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (companion_allocations) — verifique permissões (RLS).');
  }
}

/**
 * Atualiza as datas de UMA linha de acompanhante.
 *
 * Uma linha por dia: isto NUNCA deve ser usado para mover alguém de dia — o
 * recorte de período (domain/allocationReschedule) mantém o dia e só reescreve
 * a hora, e o que sai do período é DELETADO, não remendado. Foi um UPDATE em
 * lote com o mesmo par de datas que fez três dias virarem três cards no mesmo
 * dia.
 */
export async function updateCompanionAllocationDates(
  id: string,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from('companion_allocations')
    .update({ start_date: startDate, end_date: endDate })
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha atualizada (companion_allocations) — verifique permissões (RLS).');
  }
}
