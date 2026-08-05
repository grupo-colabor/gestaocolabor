// services/agendaItems.ts
import { supabase } from '../lib/supabase';
import type { AgendaItem, AgendaType } from '../types';
import { fetchAllPaginated } from './pagination';

export type AgendaItemRow = {
  id: string; // texto (AG-...)
  instructor_id: string;
  start_date: string; // timestamptz ISO
  end_date: string; // timestamptz ISO
  type: AgendaType;
  title: string;
  source: 'MANUAL' | 'DEMANDA';
  description: string | null;
  related_demand_id: string | null;

  created_at?: string;
  updated_at?: string;
};

const SELECT_FIELDS = `
  id,
  instructor_id,
  start_date,
  end_date,
  type,
  title,
  source,
  description,
  related_demand_id,
  created_at,
  updated_at
`;

// ====== Mappers (DB <-> App) ======

export function mapAgendaItemFromDb(r: AgendaItemRow): AgendaItem {
  return {
    id: r.id,
    instructorId: r.instructor_id,
    startDate: r.start_date,
    endDate: r.end_date,
    type: r.type,
    title: r.title,
    source: r.source,
    description: r.description ?? undefined,
    relatedDemandId: r.related_demand_id ?? undefined
  };
}

export function mapAgendaItemToDb(
  item: AgendaItem
): Omit<AgendaItemRow, 'created_at' | 'updated_at'> {
  return {
    id: item.id,
    instructor_id: item.instructorId,
    start_date: item.startDate,
    end_date: item.endDate,
    type: item.type,
    title: item.title,
    source: item.source,
    description: item.description ?? null,
    related_demand_id: item.relatedDemandId ?? null
  };
}

// ====== Queries ======

/**
 * Lista registros da agenda (ordenado por início)
 *
 * Pagina via fetchAllPaginated: select() sem .range() é cortado
 * silenciosamente em ~1000 linhas pelo PostgREST/Supabase.
 */
export async function fetchAgendaItems(): Promise<AgendaItemRow[]> {
  try {
    return await fetchAllPaginated<AgendaItemRow>((from, to) =>
      supabase
        .from('agenda_items')
        .select(SELECT_FIELDS)
        .order('start_date', { ascending: true })
        .range(from, to)
    );
  } catch (error) {
    console.error('fetchAgendaItems error:', error);
    throw error;
  }
}

/**
 * INSERT
 * ✅ Assinatura compatível com seu Provider:
 *   const { data, error } = await insertAgendaItem(item);
 *   if (data) setAgendaItems(prev => [...prev, mapAgendaItemFromDb(data)])
 */
export async function insertAgendaItem(item: AgendaItem): Promise<{
  data: AgendaItemRow | null;
  error: any;
}> {
  const payload = mapAgendaItemToDb(item);

  const { data, error } = await supabase
    .from('agenda_items')
    .insert(payload)
    .select(SELECT_FIELDS)
    .single();

  return { data: (data as AgendaItemRow | null) ?? null, error };
}

/**
 * UPDATE por id
 * ✅ Recebe PATCH do modelo do app e converte para campos do DB
 * ✅ Retorna a linha atualizada (SELECT) para você mapear no state
 */
export async function updateAgendaItemById(
  id: string,
  patch: Partial<AgendaItem>
): Promise<{ data: AgendaItemRow | null; error: any }> {
  const dbPatch: Partial<AgendaItemRow> = {};

  if (patch.instructorId !== undefined) dbPatch.instructor_id = patch.instructorId;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
  if (patch.type !== undefined) dbPatch.type = patch.type;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.source !== undefined) dbPatch.source = patch.source;
  if (patch.description !== undefined) dbPatch.description = patch.description ?? null;
  if (patch.relatedDemandId !== undefined) dbPatch.related_demand_id = patch.relatedDemandId ?? null;

  // garante updated_at caso não exista trigger no banco
  (dbPatch as any).updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('agenda_items')
    .update(dbPatch)
    .eq('id', id)
    .select(SELECT_FIELDS)
    .single();

  return { data: (data as AgendaItemRow | null) ?? null, error };
}

/**
 * DELETE por id
 * ✅ Faz select('id') para confirmar exclusão
 */
export async function deleteAgendaItemById(id: string) {
  const { data, error } = await supabase
    .from('agenda_items')
    .delete()
    .eq('id', id)
    .select('id');

  return { data, error };
}
