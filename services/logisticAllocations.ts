// services/logisticAllocations.ts
import { supabase } from '../lib/supabase';

// ✅ Tipagem da linha da tabela logistic_allocations
export type LogisticAllocationRow = {
  id?: string;
  demand_id: string;

  start_date?: string | null;
  end_date?: string | null;

  transport_mode?: string | null; // 'CARRO_ALUGADO' | 'CARRO_PROPRIO' | 'NAO_NECESSARIO' | ...
  lodging_mode?: string | null;   // 'PRECISA_HOTEL' | 'NAO_NECESSARIO' | ...

  // flags principais do controle
  has_car?: boolean | null;
  has_hotel?: boolean | null;
  has_material?: boolean | null;

  has_release_pdf?: boolean | null;
  has_class_list_pdf?: boolean | null;

  overall_status?: string | null;

  created_at?: string | null;
  updated_at?: string | null;

  [key: string]: any;
};

/**
 * Busca todas as rows de logistic_allocations.
 * ✅ Retorna ARRAY DIRETO (compatível com seu LogisticsControl atual).
 */
export async function fetchLogisticAllocations(): Promise<LogisticAllocationRow[]> {
  const { data, error } = await supabase
    .from('logistic_allocations')
    .select('*');

  if (error) {
    console.error('[logisticAllocations] fetch error:', error);
    throw error;
  }

  return (data || []) as LogisticAllocationRow[];
}

/**
 * Atualiza (patch) uma row por demand_id.
 * ✅ Não cria (upsert) — apenas update.
 */
export async function updateLogisticAllocationByDemandId(
  demandId: string,
  patch: Partial<LogisticAllocationRow>
): Promise<LogisticAllocationRow | null> {
  const { data, error } = await supabase
    .from('logistic_allocations')
    .update(patch)
    .eq('demand_id', demandId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[logisticAllocations] update error:', error);
    throw error;
  }

  return (data || null) as LogisticAllocationRow | null;
}
