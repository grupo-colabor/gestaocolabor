import { supabase } from '../lib/supabase';
import type { OperationalBaseKey } from '../types';

export async function deleteOperationalBaseItem(baseKey: OperationalBaseKey, value: string) {
  const { data, error } = await supabase
    .from('operational_bases_items')
    .delete()
    .eq('base_key', baseKey)
    .eq('value', value)
    .select('base_key');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (operational_bases_items) — verifique permissões (RLS).');
  }
}
