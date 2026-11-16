import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

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

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase.
export async function fetchMeasurements(): Promise<MeasurementRow[]> {
  return fetchAllPaginated<MeasurementRow>((from, to) =>
    supabase
      .from('measurements')
      .select(SELECT_FIELDS)
      .order('created_at', { ascending: false })
      .range(from, to)
  );
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
 * GARANTE que a demanda tem medição — cria a linha vazia SÓ quando falta
 * (ON CONFLICT DO NOTHING). Nunca toca numa medição existente.
 *
 * Substitui `upsertMeasurementByDemandId(demandId, {})` no salvar da demanda:
 * aquele upsert manda `status: 'NAO_INICIADA'`, `expenses: {}`,
 * `attachments: []` e `other_expenses: []` como padrão e, com
 * `merge-duplicates`, SOBRESCREVE a medição que já existe — editar a demanda
 * depois de lançar as despesas zerava a medição.
 *
 * Devolve o erro do banco (não lança): quem chama mostra o aviso.
 */
export async function ensureMeasurementForDemand(demandId: string) {
  const { error } = await supabase
    .from('measurements')
    .upsert(
      {
        id: `MEA-${demandId}`,
        demand_id: demandId,
        status: 'NAO_INICIADA',
        expenses: {},
        attachments: [],
        other_expenses: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'demand_id', ignoreDuplicates: true }
    );
  return { error };
}

/**
 * UPSERT 1:1 por demanda (unique(demand_id))
 *
 * ⚠️ Sobrescreve as colunas do payload — inclusive os padrões abaixo. Só para
 * quem manda a medição INTEIRA (o Salvar do Painel de Medição). Para "garantir
 * que existe", use `ensureMeasurementForDemand`.
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
