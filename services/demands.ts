import { supabase } from '../lib/supabase';

export type DemandRow = {
  id: string;                 // "DEM-6301"
  number: number;             // 6301
  company_id: string | null;
  training_id: string | null;
  status: string;
  modality: string;

  start_date: string;         // timestamptz (ISO string)
  end_date: string;

  practice_start_date: string | null;
  practice_end_date: string | null;

  region_id: string | null;   // você deixou text no banco
  training_local: string | null;

  instructor_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export async function fetchDemands(): Promise<DemandRow[]> {
  const { data, error } = await supabase
    .from('demands')
    .select(
      `
      id, number, company_id, training_id, status, modality,
      start_date, end_date,
      practice_start_date, practice_end_date,
      region_id, training_local,
      instructor_id,
      created_at, updated_at
    `
    )
    .order('number', { ascending: false });

  if (error) throw error;
  return (data || []) as DemandRow[];
}

export async function insertDemand(payload: Omit<DemandRow, 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('demands')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data as { id: string };
}

export async function updateDemandDb(id: string, payload: Partial<DemandRow>) {
  const { error } = await supabase.from('demands').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteDemandDb(id: string) {
  const { error } = await supabase.from('demands').delete().eq('id', id);
  if (error) throw error;
}
