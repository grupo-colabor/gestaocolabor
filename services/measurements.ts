import { supabase } from '../lib/supabase';

export type MeasurementRow = {
  id: string; // "MEA-DEM-6301"
  demand_id: string; // "DEM-6301"
  status: string; // 'NAO_INICIADA' etc.
  expenses: any; // jsonb
  attachments: any[]; // jsonb
  other_expenses: any[]; // jsonb
  updated_at?: string;
  created_at?: string;
};

const SELECT_FIELDS = `
  id, demand_id, status,
  expenses, attachments, other_expenses,
  updated_at, created_at
`;

export async function fetchMeasurements(): Promise<MeasurementRow[]> {
  const { data, error } = await supabase
    .from('measurements')
    .select(SELECT_FIELDS)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as MeasurementRow[];
}

export async function fetchMeasurementByDemandId(demandId: string) {
  const { data, error } = await supabase
    .from('measurements')
    .select(SELECT_FIELDS)
    .eq('demand_id', demandId)
    .maybeSingle();

  return { data: (data as MeasurementRow | null) ?? null, error };
}

/**
 * UPSERT 1:1 por demanda (unique(demand_id))
 */
export async function upsertMeasurementByDemandId(
  demandId: string,
  patch: Partial<Omit<MeasurementRow, 'demand_id' | 'created_at'>>
) {
  // não deixa created_at “vazar” caso alguém passe no patch
  const { created_at, ...safePatch } = (patch as any) || {};

  const payload: any = {
    demand_id: demandId,
    ...safePatch
  };

  // defaults pro primeiro insert
  if (!payload.id) payload.id = `MEA-${demandId}`;
  if (!payload.status) payload.status = 'NAO_INICIADA';
  if (payload.expenses == null) payload.expenses = {};
  if (payload.attachments == null) payload.attachments = [];
  if (payload.other_expenses == null) payload.other_expenses = [];

  // garante atualização (se não tiver trigger)
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('measurements')
    .upsert(payload, { onConflict: 'demand_id' })
    .select(SELECT_FIELDS)
    .single();

  return { data: (data as MeasurementRow | null) ?? null, error };
}
