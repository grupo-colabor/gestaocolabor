import { supabase } from '../lib/supabase';
import type { OperationalBaseKey } from '../types';

export async function deleteOperationalBaseItem(baseKey: OperationalBaseKey, value: string) {
  const { error } = await supabase
    .from('operational_bases_items')
    .delete()
    .eq('base_key', baseKey)
    .eq('value', value);

  if (error) throw error;
}
