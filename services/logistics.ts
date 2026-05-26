import { supabase } from '../lib/supabase';

export type LogisticAllocationRow = {
  id: string; // text
  demand_id: string; // text (DEM-xxxx)

  start_date: string | null; // timestamptz
  end_date: string | null; // timestamptz

  transport_mode: string | null; // 'CARRO_ALUGADO' | 'CARRO_PROPRIO' | 'NA'
  lodging_mode: string | null; // 'PRECISA_HOTEL' | 'NA'

  // ===== DETALHES (CARRO ALUGADO) =====
  rental_company: string | null;
  rental_agency_location: string | null;
  rental_locator: string | null;
  car_category: string | null;
  rental_check_in: string | null; // timestamptz
  rental_check_out: string | null; // timestamptz

  // ===== DETALHES (HOTEL) =====
  hotel_city: string | null;
  hotel_name: string | null;
  hotel_check_in: string | null; // date ou timestamptz (string)
  hotel_check_out: string | null; // date ou timestamptz (string)
  hotel_payment: string | null;

  // ===== FLAGS / STATUS =====
  has_hotel: boolean;
  has_car: boolean;
  has_material: boolean;
  has_release_pdf: boolean;
  has_class_list_pdf: boolean;

  overall_status: string; // 'PENDENTE' | 'CONCLUIDA' etc.

  created_at?: string;
  updated_at?: string;
};

const SELECT_FIELDS = `
  id, demand_id,
  start_date, end_date,
  transport_mode, lodging_mode,

  rental_company, rental_agency_location, rental_locator, car_category,
  rental_check_in, rental_check_out,

  hotel_city, hotel_name, hotel_check_in, hotel_check_out, hotel_payment,

  has_hotel, has_car, has_material, has_release_pdf, has_class_list_pdf,
  overall_status,
  created_at, updated_at
`;

/** Gera um id estável (necessário se o banco NÃO tem default para id) */
function buildLogisticId(demandId: string) {
  // Ex: LOG-DEM-6301  (estável e 1:1)
  return `LOG-${demandId}`;
}

/** Normaliza strings vazias para null (evita gravar '' em timestamptz/text) */
function emptyToNull(v: any) {
  // ✅ se não mandou o campo (undefined), NÃO altera no banco
  if (v === undefined) return undefined;

  // ✅ se mandou string vazia, grava null (limpa)
  if (v === '') return null;

  // mantém null ou valor
  return v;
}


export async function fetchLogisticAllocations(): Promise<LogisticAllocationRow[]> {
  const { data, error } = await supabase
    .from('logistic_allocations')
    .select(SELECT_FIELDS)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as LogisticAllocationRow[];
}

export async function fetchLogisticByDemandId(demandId: string) {
  const { data, error } = await supabase
    .from('logistic_allocations')
    .select(SELECT_FIELDS)
    .eq('demand_id', demandId)
    .maybeSingle();

  return { data: (data as LogisticAllocationRow | null) ?? null, error };
}

/**
 * UPSERT 1:1 por demanda (graças ao unique(demand_id))
 * - você pode mandar só alguns campos (patch)
 * - IMPORTANTE: garante `id` no insert (tabela tem id text, geralmente sem default)
 */
export async function upsertLogisticByDemandId(
  demandId: string,
  patch: Partial<Omit<LogisticAllocationRow, 'demand_id' | 'created_at' | 'updated_at'>>
) {
  const payload: Partial<LogisticAllocationRow> & { demand_id: string } = {
    // ✅ id obrigatório no insert
    id: (patch as any)?.id || buildLogisticId(demandId),

    demand_id: demandId,

    // datas (evita '')
    start_date: emptyToNull((patch as any)?.start_date),
    end_date: emptyToNull((patch as any)?.end_date),

    // modos (evita '')
    transport_mode: emptyToNull((patch as any)?.transport_mode),
    lodging_mode: emptyToNull((patch as any)?.lodging_mode),

    // ===== DETALHES (CARRO ALUGADO) =====
    rental_company: emptyToNull((patch as any)?.rental_company),
    rental_agency_location: emptyToNull((patch as any)?.rental_agency_location),
    rental_locator: emptyToNull((patch as any)?.rental_locator),
    car_category: emptyToNull((patch as any)?.car_category),
    rental_check_in: emptyToNull((patch as any)?.rental_check_in),
    rental_check_out: emptyToNull((patch as any)?.rental_check_out),

    // ===== DETALHES (HOTEL) =====
    hotel_city: emptyToNull((patch as any)?.hotel_city),
    hotel_name: emptyToNull((patch as any)?.hotel_name),
    hotel_check_in: emptyToNull((patch as any)?.hotel_check_in),
    hotel_check_out: emptyToNull((patch as any)?.hotel_check_out),
    hotel_payment: emptyToNull((patch as any)?.hotel_payment),

    // ===== defaults seguros =====
    has_hotel: (patch as any)?.has_hotel ?? false,
    has_car: (patch as any)?.has_car ?? false,
    has_material: (patch as any)?.has_material ?? false,
    has_release_pdf: (patch as any)?.has_release_pdf ?? false,
    has_class_list_pdf: (patch as any)?.has_class_list_pdf ?? false,

    overall_status: (patch as any)?.overall_status || 'PENDENTE',

    // se sua coluna updated_at tiver trigger, isso não atrapalha;
    // se NÃO tiver, ajuda a manter atualizado
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('logistic_allocations')
    .upsert(payload, { onConflict: 'demand_id' })
    .select(SELECT_FIELDS)
    .single();

  return { data: (data as LogisticAllocationRow | null) ?? null, error };
}

// =============================================================
// logistic_blocks — suporte a múltiplos instrutores por demanda
// =============================================================

export type LogisticBlockRow = {
  id: string;
  demand_id: string;
  block_type: string; // 'LOCOMOCAO' | 'HOSPEDAGEM'
  block_order: number;
  instructor_name: string | null;

  // Locomoção
  transport_mode: string | null;
  rental_company: string | null;
  rental_agency_location: string | null;
  rental_locator: string | null;
  car_category: string | null;
  rental_check_in: string | null;
  rental_check_out: string | null;
  receipt_url?: string[] | null;

  // Hospedagem
  lodging_mode: string | null;
  hotel_city: string | null;
  hotel_name: string | null;
  hotel_check_in: string | null;
  hotel_check_out: string | null;
  hotel_payment: string | null;
  hotel_receipt_urls?: string[] | null;

  created_at?: string;
  updated_at?: string;
};

export async function fetchLogisticBlocksByDemandId(demandId: string): Promise<LogisticBlockRow[]> {
  const { data, error } = await supabase
    .from('logistic_blocks')
    .select('*')
    .eq('demand_id', demandId)
    .order('block_type', { ascending: true })
    .order('block_order', { ascending: true });

  if (error) throw error;
  return (data || []) as LogisticBlockRow[];
}

/**
 * Substitui todos os blocos da demanda: exclui os antigos e insere os novos.
 * Usa delete + insert para garantir que blocos removidos pelo usuário sejam apagados.
 */
export async function upsertLogisticBlocks(
  demandId: string,
  blocks: Array<Partial<LogisticBlockRow> & { id: string; block_type: string; block_order: number }>
): Promise<void> {
  const { error: delError } = await supabase
    .from('logistic_blocks')
    .delete()
    .eq('demand_id', demandId);

  if (delError) throw delError;

  if (blocks.length === 0) return;

  const rows = blocks.map(b => ({
    ...b,
    demand_id: demandId,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('logistic_blocks').insert(rows);
  if (error) throw error;
}

export async function deleteLogisticBlock(blockId: string): Promise<void> {
  const { error } = await supabase
    .from('logistic_blocks')
    .delete()
    .eq('id', blockId);

  if (error) throw error;
}
