/**
 * MODELOS DE EXPORTAÇÃO SALVOS — `export_presets` (migration 021), I/O
 *
 * O gateway Supabase do domínio (domain/exports/presets.ts, `PresetGateway`).
 *
 *   • Leitura: TUDO do usuário, paginado via fetchAllPaginated. A RLS por
 *     dono (021) já recorta ao `auth.uid()`; o app não filtra por user_id.
 *     Usuário novo, sem modelo: [] — resultado legítimo, não erro. Erro de
 *     banco PROPAGA (a tela mostra banner e desabilita a barra).
 *   • Escrita: INSERT sem user_id (DEFAULT auth.uid()), UPDATE com
 *     `updated_at` explícito (o repositório não tem trigger), DELETE pela
 *     chave. Endurecido como templateValues.ts: se o banco devolver zero
 *     linhas num update/delete, é RLS filtrando em silêncio (ou linha de
 *     outro usuário) — lança, nunca finge que gravou.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaginated } from '../pagination';
import type { ExportPreset, NewPreset, PresetConfig, PresetGateway, PresetPatch } from '../../domain/exports/presets';

export interface ExportPresetRow {
  id: string;
  user_id: string;
  dataset_id: string;
  name: string;
  config: unknown;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

const SELECT_FIELDS = 'id, user_id, dataset_id, name, config, is_default, created_at, updated_at';

/** jsonb chega como objeto; um valor torto vira {} e o domínio avisa ao aplicar. */
export function mapExportPreset(row: ExportPresetRow): ExportPreset {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    name: row.name,
    config: (row.config && typeof row.config === 'object' ? row.config : {}) as PresetConfig,
    isDefault: row.is_default === true,
    updatedAt: row.updated_at ?? undefined,
  };
}

export async function fetchExportPresets(): Promise<ExportPreset[]> {
  const rows = await fetchAllPaginated<ExportPresetRow>((from, to) =>
    supabase
      .from('export_presets')
      .select(SELECT_FIELDS)
      .order('dataset_id', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );
  return rows.map(mapExportPreset);
}

export async function insertExportPreset(p: NewPreset): Promise<ExportPreset> {
  const { data, error } = await supabase
    .from('export_presets')
    .insert({ dataset_id: p.datasetId, name: p.name, config: p.config, is_default: p.isDefault })
    .select(SELECT_FIELDS);
  if (error) {
    console.error('[export_presets] insert error', error);
    throw error;
  }
  const row = (data ?? [])[0] as ExportPresetRow | undefined;
  if (!row) throw new Error('Modelo não gravado: o banco não devolveu a linha — verifique permissões (RLS).');
  return mapExportPreset(row);
}

export async function updateExportPreset(id: string, patch: PresetPatch): Promise<ExportPreset> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.config !== undefined) payload.config = patch.config;
  if (patch.isDefault !== undefined) payload.is_default = patch.isDefault;
  const { data, error } = await supabase.from('export_presets').update(payload).eq('id', id).select(SELECT_FIELDS);
  if (error) {
    console.error('[export_presets] update error', error);
    throw error;
  }
  const row = (data ?? [])[0] as ExportPresetRow | undefined;
  if (!row) throw new Error('Modelo não atualizado: nenhuma linha afetada — não existe ou é de outro usuário (RLS).');
  return mapExportPreset(row);
}

export async function deleteExportPreset(id: string): Promise<void> {
  const { data, error } = await supabase.from('export_presets').delete().eq('id', id).select('id');
  if (error) {
    console.error('[export_presets] delete error', error);
    throw error;
  }
  if ((data ?? []).length === 0) throw new Error('Modelo não excluído: nenhuma linha afetada — não existe ou é de outro usuário (RLS).');
}

export const supabasePresetGateway: PresetGateway = {
  list: fetchExportPresets,
  insert: insertExportPreset,
  update: updateExportPreset,
  remove: deleteExportPreset,
};
