import { supabase } from '../lib/supabase';

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

export async function fetchInstructorAllocations() {
  const { data, error } = await supabase
    .from('instructor_allocations')
    .select('*')
    .order('start_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as InstructorAllocationRow[];
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
  const { error } = await supabase.from('instructor_allocations').delete().eq('id', id);
  if (error) throw error;
}

// ✅ “Replace”: apaga tudo da demanda e reinsere (resolve seu caso de split/merge)
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
