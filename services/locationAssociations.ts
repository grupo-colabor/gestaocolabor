import { supabase } from '../lib/supabase';

export interface LocationAssociation {
  id: string;
  local: string;
  regiao: string;
  corredor: string;
  uf: string;
}

export async function fetchLocationAssociations(): Promise<LocationAssociation[]> {
  const { data, error } = await supabase
    .from('location_associations')
    .select('id, local, regiao, corredor, uf')
    .order('local');
  if (error) throw error;
  return (data ?? []) as LocationAssociation[];
}

export async function upsertLocationAssociation(
  item: Omit<LocationAssociation, 'id'> & { id?: string }
): Promise<LocationAssociation> {
  const payload = item.id ? item : { local: item.local, regiao: item.regiao, corredor: item.corredor, uf: item.uf };
  const { data, error } = await supabase
    .from('location_associations')
    .upsert(payload, { onConflict: item.id ? 'id' : 'local' })
    .select('id, local, regiao, corredor, uf')
    .single();
  if (error) throw error;
  return data as LocationAssociation;
}

export async function deleteLocationAssociation(id: string): Promise<void> {
  const { error } = await supabase
    .from('location_associations')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
