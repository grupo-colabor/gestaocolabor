import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

// Row do banco
export type InstructorAllocationRow = {
  id: string;
  demand_id: string;
  instructor_id: string;
  start_date: string;
  end_date: string;
  created_at?: string;
  updated_at?: string;
};

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase — com 932
// linhas hoje, instructor_allocations está prestes a estourar o corte.
export async function fetchInstructorAllocations() {
  return fetchAllPaginated<InstructorAllocationRow>((from, to) =>
    supabase
      .from('instructor_allocations')
      .select('*')
      .order('start_date', { ascending: true })
      .range(from, to)
  );
}

// Upsert de 1 alocação
export async function upsertInstructorAllocation(row: InstructorAllocationRow) {
  const { data, error } = await supabase
    .from('instructor_allocations')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) throw error;
  return data as InstructorAllocationRow;
}

export async function deleteInstructorAllocationById(id: string) {
  const { data, error } = await supabase
    .from('instructor_allocations')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (instructor_allocations) — verifique permissões (RLS).');
  }
}

// ✅ “Replace”: apaga tudo da demanda e reinsere (resolve seu caso de split/merge)
//
// ⚠️ NÃO endurecido com "throw se 0 linhas": delete por demand_id é legitimamente
// 0 quando a demanda ainda não tinha alocação nenhuma (primeira alocação). Só que
// aqui, ao contrário de um DELETE isolado, 0-por-RLS é mais perigoso: se havia N
// linhas antigas e o delete for silenciosamente bloqueado, o passo 3 insere as
// novas por cima SEM remover as antigas — duplica alocação em vez de substituir.
// Não dá pra distinguir "0 porque não tinha nada" de "0 porque RLS bloqueou N"
// sem uma contagem prévia (não implementada agora — mesmo escopo do bug de
// trainings, mas esse aqui é silencioso por corrupção, não por reaparecimento;
// registrar como acompanhamento separado).
export async function replaceInstructorAllocationsForDemand(
  demandId: string,
  rows: Array<Omit<InstructorAllocationRow, 'created_at' | 'updated_at'>>
) {
  // 1) delete tudo
  const { error: delError } = await supabase
    .from('instructor_allocations')
    .delete()
    .eq('demand_id', demandId);

  if (delError) throw delError;

  // 2) se não tem nada, acabou
  if (!rows.length) return [];

  // 3) insert tudo
  const { data, error: insError } = await supabase
    .from('instructor_allocations')
    .insert(rows)
    .select();

  if (insError) throw insError;
  return (data ?? []) as InstructorAllocationRow[];
}

// ⚠️ Mesma observação do replace acima: delete por demand_id, 0 linhas pode ser
// estado legítimo (demanda sem alocação) — não endurecido com throw.
export async function deleteInstructorAllocationsByDemandId(demandId: string) {
  const { error } = await supabase
    .from('instructor_allocations')
    .delete()
    .eq('demand_id', demandId);
  if (error) throw error;
}
