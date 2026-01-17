import { supabase } from '../lib/supabase';

export type AgendaItemRow = {
  id: string; // text
  instructor_id: string | null; // uuid
  related_demand_id: string | null; // text
  title: string;
  start_date: string; // timestamptz (ISO)
  end_date: string; // timestamptz (ISO)
  created_at?: string;
  updated_at?: string;
};

export async function fetchAgendaItems(): Promise<AgendaItemRow[]> {
  const { data, error } = await supabase
    .from('agenda_items')
    .select(
      `
      id,
      instructor_id,
      related_demand_id,
      title,
      start_date,
      end_date,
      created_at,
      updated_at
    `
    )
    .order('start_date', { ascending: true });

  if (error) {
    console.error('fetchAgendaItems error:', error);
    throw error;
  }

  return (data || []) as AgendaItemRow[];
}

export async function insertAgendaItem(payload: Omit<AgendaItemRow, 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('agenda_items')
    .insert(payload)
    .select('id')
    .single();

  return { data: data as { id: string } | null, error };
}

export async function updateAgendaItemById(
  id: string,
  payload: Partial<AgendaItemRow> | Record<string, any>
) {
  const { error } = await supabase.from('agenda_items').update(payload).eq('id', id);
  return { error };
}

export async function deleteAgendaItemById(id: string) {
  const { error } = await supabase.from('agenda_items').delete().eq('id', id);
  return { error };
}
