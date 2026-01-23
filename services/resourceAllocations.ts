import { supabase } from '../lib/supabase';

export type ResourceAllocationRow = {
  id?: string;
  demand_id: string;
  resource_type: 'CENTRO_TREINAMENTO_MOVEL';
  start_date: string;
  end_date: string;
  created_at?: string;
  updated_at?: string;
};

/** Buscar todos os CTMs */
export async function fetchResourceAllocations(): Promise<ResourceAllocationRow[]> {
  const { data, error } = await supabase
    .from('resource_allocations')
    .select('*')
    .eq('resource_type', 'CENTRO_TREINAMENTO_MOVEL');

  if (error) {
    console.error('[resource_allocations] fetch error', error);
    throw error;
  }

  return data ?? [];
}

/** Criar ou atualizar CTM da demanda (upsert lógico) */
export async function upsertResourceAllocation(
  payload: ResourceAllocationRow
): Promise<ResourceAllocationRow | null> {
  const { data, error } = await supabase
    .from('resource_allocations')
    .upsert(payload, {
      onConflict: 'demand_id,resource_type'
    })
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[resource_allocations] upsert error', error);
    throw error;
  }

  return data ?? null;
}

/** 
 * Remover CTM (Centro de Treinamento Móvel) por demand_id
 * ⚠️ Remove APENAS o CTM, sem afetar outros recursos logísticos
 */
export async function deleteResourceAllocationByDemandId(demandId: string) {
  const { error } = await supabase
    .from('resource_allocations')
    .delete()
    .eq('demand_id', demandId)
    .eq('resource_type', 'CENTRO_TREINAMENTO_MOVEL');

  if (error) {
    console.error('[resource_allocations] delete error', error);
    throw error;
  }
}

