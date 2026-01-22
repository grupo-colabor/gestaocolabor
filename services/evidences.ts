import { supabase } from '../lib/supabase';

export type EvidenceRow = {
  id: string;                // "EVI-DEM-6301"
  demand_id: string;         // "DEM-6301"
  status: 'PENDENTE' | 'COMPLETA';

  attendance_list: any[];    // jsonb
  certificates: any[];       // jsonb
  photos: any[];             // jsonb

  created_at?: string;
  updated_at?: string;
  notes?: string;
};

const SELECT_FIELDS = `
  demand_id,
  id,
  status,
  attendance_list,
  certificates,
  photos,
  notes,
  created_at,
  updated_at
`;

/**
 * 🔹 Buscar TODAS as evidências
 */
export async function fetchEvidences(): Promise<EvidenceRow[]> {
  const { data, error } = await supabase
    .from('evidences')
    .select(SELECT_FIELDS)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as EvidenceRow[];
}

/**
 * 🔹 Buscar evidência por DEMANDA
 */
export async function fetchEvidenceByDemandId(demandId: string) {
  const { data, error } = await supabase
    .from('evidences')
    .select(SELECT_FIELDS)
    .eq('demand_id', demandId)
    .maybeSingle();

  return { data: (data as EvidenceRow | null) ?? null, error };
}

/**
 * 🔹 UPSERT 1:1 por demanda
 */
export async function upsertEvidenceByDemandId(
  demandId: string,
  patch: Partial<Omit<EvidenceRow, 'demand_id' | 'created_at'>>
) {
  const { created_at, ...safePatch } = (patch as any) || {};

  const payload: any = {
    demand_id: demandId,
    ...safePatch,
  };

  // Defaults para primeiro insert
  if (!payload.id) payload.id = `EVI-${demandId}`;
  if (!payload.status) payload.status = 'PENDENTE';
  if (payload.attendance_list == null) payload.attendance_list = [];
  if (payload.certificates == null) payload.certificates = [];
  if (payload.photos == null) payload.photos = [];

  // ✅ FIX: garantir notes sempre definido (evita voltar ''/undefined e "travar" a digitação)
  if (payload.notes == null) payload.notes = '';

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('evidences')
    .upsert(payload, { onConflict: 'demand_id' })
    .select(SELECT_FIELDS) // ✅ IMPORTANTE: SELECT_FIELDS precisa incluir "notes"
    .single();

  return { data: (data as EvidenceRow | null) ?? null, error };
}

