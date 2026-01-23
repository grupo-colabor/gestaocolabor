import { supabase } from '../lib/supabase';
import { deleteDemandDocumentsByDemandId } from './demandDocuments';

export type DemandRow = {
  id: string; // "DEM-6301"
  number: number; // 6301

  company_id: string | null;
  training_id: string | null;

  status: string;
  modality: string;

  start_date: string; // timestamptz (ISO string)
  end_date: string;

  practice_start_date: string | null;
  practice_end_date: string | null;

  region_id: string | null; // no banco pode ser text
  training_local: string | null;

  instructor_id: string | null;

  created_at?: string;
  updated_at?: string;
};

/**
 * Lista demandas (ordenadas por number desc)
 */
export async function fetchDemands(): Promise<DemandRow[]> {
  const { data, error } = await supabase
    .from('demands')
    .select(
      `
      id, number, company_id, training_id, status, modality,
      start_date, end_date,
      practice_start_date, practice_end_date,
      region_id, training_local,client_demand_id,
      instructor_id,
      created_at, updated_at
    `
    )
    .order('number', { ascending: false });

  if (error) {
    console.error('fetchDemands error:', error);
    throw error;
  }

  return (data || []) as DemandRow[];
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
export async function updateDemandById(id: string, payload: Partial<DemandRow> | Record<string, any>) {
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
  //    Se falhar aqui, a gente retorna erro e NÃO deleta a demanda (pra você ver o erro).
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
