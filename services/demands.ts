import { supabase } from '../lib/supabase';
import { deleteDemandDocumentsByDemandId } from './demandDocuments';
import { fetchAllPaginated } from './pagination';

export type DemandRow = {
  id: string; // "DEM-6301"
  number: number; // 6301

  company_id: string | null;
  training_id: string | null;

  status: string;
  modality: string;

  date_mode: string;              // 'CONTINUO' | 'DIAS_ESPECIFICOS'
  specific_dates: string[] | null; // ['2026-02-12', ...] ou null

  start_date: string; // timestamptz (ISO string)
  end_date: string;

  practice_start_date: string | null;
  practice_end_date: string | null;

  region_id: string | null; 
  training_local: string | null;
  demand_state: string | null;
  corredor: string | null;
  
  instructor_id: string | null;

  created_at?: string;
  updated_at?: string;

  client_demand_id?: string | null;

  requester: string | null;
  observations: string | null;

  approver: string | null;
  analyst: string | null;
  matriculador: string | null;
  confirmation_status: string | null;
  cancel_reason: string | null;
};

/**
 * Lista demandas (ordenadas por number desc)
 *
 * Pagina via fetchAllPaginated: select() sem .range() é cortado
 * silenciosamente em ~1000 linhas pelo PostgREST/Supabase — com 1008
 * linhas em `demands`, 8 demandas já estavam ficando de fora do app.
 */
export async function fetchDemands(): Promise<DemandRow[]> {
  try {
    return await fetchAllPaginated<DemandRow>((from, to) =>
      supabase
        .from('demands')
        .select(`
          id, number, company_id, training_id, status, modality,
          date_mode, specific_dates,
          start_date, end_date,
          practice_start_date, practice_end_date,
          region_id, training_local,
          client_demand_id,
          instructor_id,
          requester, observations, approver, analyst, matriculador,
          created_at, updated_at, corredor, demand_state,
          confirmation_status, cancel_reason
        `)
        .order('number', { ascending: false })
        .range(from, to)
    );
  } catch (error) {
    console.error('fetchDemands error:', error);
    throw error;
  }
}

/**
 * Busca o maior número (number) existente no banco.
 * Retorna 0 se não houver registros.
 */
export async function fetchMaxDemandNumber(): Promise<number> {
  const { data, error } = await supabase
    .from('demands')
    .select('number')
    .order('number', { ascending: false })
    .limit(1);

  if (error) {
    console.error('fetchMaxDemandNumber error:', error);
    throw error;
  }

  const max = data?.[0]?.number;
  return typeof max === 'number' ? max : 0;
}

/**
 * INSERT demanda
 * - Compatível com App.tsx: retorna { data?, error? }
 */
export async function insertDemand(payload: Omit<DemandRow, 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('demands')
    .insert(payload)
    .select('id')
    .single();

  return { data: data as { id: string } | null, error };
}

/**
 * UPDATE por id
 * - Compatível com App.tsx: retorna { error }
 */
export async function updateDemandById(
  id: string,
  payload: Partial<DemandRow> | Record<string, any>
) {
  const { error } = await supabase.from('demands').update(payload).eq('id', id);
  return { error };
}

/**
 * DELETE por id (COM LIMPEZA DE DOCUMENTOS)
 * - Remove documentos (storage + tabela demand_documents)
 * - Remove demanda
 * - Retorna { data, error }
 */
export async function deleteDemandById(id: string) {
  const safeId = (id ?? '').trim();
  if (!safeId) return { data: null, error: new Error('id inválido') as any };

  // 1) Limpa documentos primeiro (evita "PDF fantasma" no storage/tabela)
  try {
    const res = await deleteDemandDocumentsByDemandId(safeId);
    if (!res.ok) {
      console.error('[deleteDemandById] erro ao limpar documentos:', res.error);
      return { data: null, error: res.error };
    }
  } catch (e) {
    console.error('[deleteDemandById] exception ao limpar documentos:', e);
    return { data: null, error: e as any };
  }

  // 2) Agora remove a demanda
  const { data, error } = await supabase
    .from('demands')
    .delete()
    .eq('id', safeId)
    .select('id'); // confirma

  return { data, error };
}

/**
 * (Opcional) Aliases para não quebrar chamadas antigas (se existirem em outros arquivos)
 */
export async function updateDemandDb(id: string, payload: Partial<DemandRow>) {
  const { error } = await updateDemandById(id, payload);
  if (error) throw error;
}

export async function deleteDemandDb(id: string) {
  const { error } = await deleteDemandById(id);
  if (error) throw error;
}
