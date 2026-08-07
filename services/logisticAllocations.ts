// services/logisticAllocations.ts
import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

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
 * Busca todas as rows de logistic_allocations, paginando via fetchAllPaginated
 * (select('*') sem .range() é cortado silenciosamente em ~1000 linhas pelo
 * PostgREST/Supabase — foi a causa raiz do bug em que DEM-1059/DEM-725
 * sumiam do Controle Logístico assim que a tabela passou de 1000 linhas).
 * ✅ Retorna ARRAY DIRETO (compatível com seu LogisticsControl atual).
 */
export async function fetchLogisticAllocations(): Promise<LogisticAllocationRow[]> {
  try {
    return await fetchAllPaginated<LogisticAllocationRow>((from, to) =>
      supabase
        .from('logistic_allocations')
        .select('*')
        .order('demand_id', { ascending: true })
        .range(from, to)
    );
  } catch (error) {
    console.error('[logisticAllocations] fetch error:', error);
    throw error;
  }
}

/**
 * Atualiza (patch) uma row por demand_id.
 * ✅ Não cria (upsert) — apenas update.
 *
 * ⚠️ Todo caller (LogisticsControl.tsx) só chama isto para demand_id que já
 * apareceu num fetch anterior de logistic_allocations — a row sempre existe
 * antes desta chamada. `.maybeSingle()` não lança erro em 0 linhas (ao
 * contrário de `.single()`), então sem este guard um RLS sem policy de
 * UPDATE devolvia `null` silencioso — mesma classe do bug de trainings.
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

  if (!data) {
    const err = new Error('Nenhuma linha atualizada (logistic_allocations) — verifique permissões (RLS).');
    console.error('[logisticAllocations] update error:', err);
    throw err;
  }

  return data as LogisticAllocationRow;
}
