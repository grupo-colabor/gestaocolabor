import { supabase } from '../lib/supabase';

export type OperationalBaseKey =
  | 'aprovadores'
  | 'analistas'
  | 'corredores'
  | 'localidades'
  | 'hoteis'
  | 'locadoras'
  | 'tiposTreinamento';

export async function deleteOperationalBaseItem(baseKey: OperationalBaseKey, value: string) {
  const { error } = await supabase
    .from('operational_bases_items')
    .delete()
    .eq('base_key', baseKey)
    .eq('value', value);

  if (error) throw error;
}
