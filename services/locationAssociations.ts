import { supabase } from '../lib/supabase';

/**
 * Conjunto ao qual a associação pertence. São dois conjuntos independentes:
 * a cascata Local → Corredor → Estado → Região do formulário de demanda de
 * cliente lê 'cliente', a do formulário de demanda interna lê 'interna'.
 * Local criado num não aparece no outro (migration 014).
 */
export type LocationContext = 'cliente' | 'interna';

export interface LocationAssociation {
  id: string;
  local: string;
  regiao: string;
  corredor: string;
  uf: string;
  contexto: LocationContext;
}

const SELECT_FIELDS = 'id, local, regiao, corredor, uf, contexto';

/**
 * Lista as associações de UM contexto.
 *
 * O contexto é obrigatório de propósito: um caller que esquecesse de filtrar
 * receberia os dois conjuntos misturados e a separação vazaria silenciosamente
 * na cascata — exatamente o bug que a 014 existe para evitar.
 */
export async function fetchLocationAssociations(
  contexto: LocationContext
): Promise<LocationAssociation[]> {
  const { data, error } = await supabase
    .from('location_associations')
    .select(SELECT_FIELDS)
    .eq('contexto', contexto)
    .order('local');
  if (error) throw error;
  return (data ?? []) as LocationAssociation[];
}

export async function upsertLocationAssociation(
  item: Omit<LocationAssociation, 'id'> & { id?: string }
): Promise<LocationAssociation> {
  const payload = item.id
    ? item
    : {
        local: item.local,
        regiao: item.regiao,
        corredor: item.corredor,
        uf: item.uf,
        contexto: item.contexto,
      };

  // ⚠️ onConflict passou de 'local' para 'local,contexto': a unicidade agora é
  // por par (índice location_associations_local_contexto_uq, migration 014).
  // Com 'local' sozinho o upsert de um local que existe nos dois contextos
  // sobrescreveria a linha do outro conjunto.
  const { data, error } = await supabase
    .from('location_associations')
    .upsert(payload, { onConflict: item.id ? 'id' : 'local,contexto' })
    .select(SELECT_FIELDS)
    .single();
  if (error) throw error;
  return data as LocationAssociation;
}

export async function deleteLocationAssociation(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('location_associations')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (location_associations) — verifique permissões (RLS).');
  }
}
