import { supabase } from '../lib/supabase';
import type { AgendaItem, AgendaType } from '../types';

/**
 * Tabela: agenda_items
 * Campos esperados no DB:
 * - id (text)
 * - instructor_id (uuid, nullable)
 * - related_demand_id (text, nullable)
 * - type (text)                ✅
 * - title (text)
 * - source (text)              ✅
 * - description (text, nullable) ✅
 * - start_date (timestamptz)
 * - end_date (timestamptz)
 * - created_at (timestamptz)
 * - updated_at (timestamptz)
 */

export type AgendaItemRow = {
  id: string; // text (ex: "AG-123" ou uuid/text)
  instructor_id: string | null; // uuid
  related_demand_id: string | null; // text

  type: string; // AgendaType no app (FOLGA, ESCRITORIO, etc)
  title: string;

  source: string; // 'MANUAL' | 'DEMANDA' (no app)
  description: string | null;

  start_date: string; // timestamptz (ISO)
  end_date: string; // timestamptz (ISO)

  created_at?: string;
  updated_at?: string;
};

const SELECT_FIELDS = `
  id,
  instructor_id,
  related_demand_id,
  type,
  title,
  source,
  description,
  start_date,
  end_date,
  created_at,
  updated_at
`;

function normalizeAgendaType(type: any): AgendaType {
  // mantém compatível com seus tipos (se vier algo estranho do DB)
  const allowed: AgendaType[] = ['FOLGA', 'ESCRITORIO', 'INDISPONIVEL', 'DESCANSO', 'OUTRO', 'TREINAMENTO'] as any;
  return allowed.includes(type) ? type : ('OUTRO' as AgendaType);
}

function normalizeSource(source: any): 'MANUAL' | 'DEMANDA' {
  return source === 'DEMANDA' ? 'DEMANDA' : 'MANUAL';
}

/** =========================
 *  MAPPERS (DB <-> APP)
 *  ========================= */

export function mapAgendaItemFromDb(row: AgendaItemRow): AgendaItem {
  return {
    id: row.id,
    instructorId: row.instructor_id ?? '', // no app você usa string; se quiser, trate null no caller
    relatedDemandId: row.related_demand_id ?? undefined,

    type: normalizeAgendaType(row.type),
    title: row.title,

    source: normalizeSource(row.source),
    description: row.description ?? undefined,

    startDate: row.start_date,
    endDate: row.end_date
  };
}

/**
 * Payload para INSERT/UPDATE no banco
 * - aqui você converte camelCase -> snake_case
 */
export function mapAgendaItemToDb(item: AgendaItem): Omit<AgendaItemRow, 'created_at' | 'updated_at'> {
  return {
    id: item.id,
    instructor_id: item.instructorId || null,
    related_demand_id: item.relatedDemandId || null,

    type: item.type,
    title: item.title,

    source: item.source,
    description: item.description ?? null,

    start_date: item.startDate,
    end_date: item.endDate
  };
}

/** =========================
 *  CRUD (SUPABASE)
 *  ========================= */

export async function fetchAgendaItems(): Promise<AgendaItemRow[]> {
  const { data, error } = await supabase
    .from('agenda_items')
    .select(SELECT_FIELDS)
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

  return { data: (data as { id: string } | null) ?? null, error };
}

export async function updateAgendaItemById(
  id: string,
  payload: Partial<AgendaItemRow> | Record<string, any>
) {
  const { error } = await supabase.from('agenda_items').update(payload).eq('id', id);
  return { error };
}

export async function deleteAgendaItemById(id: string) {
  const { data, error } = await supabase
    .from('agenda_items')
    .delete()
    .eq('id', id)
    .select('id'); // ✅ confirma deleção

  return { data: (data as any) ?? null, error };
}
