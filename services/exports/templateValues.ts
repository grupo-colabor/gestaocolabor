/**
 * VALORES MANUAIS DOS TEMPLATES DE MEDIÇÃO — `measurement_template_values`
 *
 * Migration 017. Dois escopos:
 *   • 'training' — valor por treinamento (o preço HH padrão da Vale);
 *   • 'demand'   — valor por demanda (preço sobrescrito, combustível, % de
 *                  despesa, observação).
 *
 * Leitura: TUDO de um template, paginado via fetchAllPaginated. Tabela vazia
 * (primeira execução, ou nenhum valor digitado ainda) é um resultado
 * legítimo — devolve [] sem erro. Erro de banco PROPAGA.
 *
 * Escrita: upsert pela chave (template_id, scope, column_key, training_id,
 * demand_id), que casa com a constraint UNIQUE NULLS NOT DISTINCT da 017.
 * Endurecido: se o banco devolver menos linhas do que as enviadas, é RLS
 * filtrando em silêncio — lança, nunca finge que gravou. A tela grava só no
 * "Salvar" da prévia, nunca no download.
 *
 * Nada aqui é lido pelo Excel de pagamento nem pelo painel de Medição.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaginated } from '../pagination';
import type { TemplateValueScope } from '../../domain/exports/templates/values';

export type { TemplateValueScope };

export interface TemplateValueRow {
  id: string;
  template_id: string;
  scope: TemplateValueScope;
  column_key: string;
  training_id: string | null;
  demand_id: string | null;
  /** jsonb escalar: número (preço, %) ou string (observação). */
  value: number | string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/** O que a tela manda ao salvar. `refId` é o treinamento ou a demanda, conforme o escopo. */
export interface TemplateValueInput {
  scope: TemplateValueScope;
  refId: string;
  columnKey: string;
  value: number | string | null;
}

const SELECT_FIELDS = 'id, template_id, scope, column_key, training_id, demand_id, value, updated_at, updated_by';

export async function fetchTemplateValues(templateId: string): Promise<TemplateValueRow[]> {
  return fetchAllPaginated<TemplateValueRow>((from, to) =>
    supabase
      .from('measurement_template_values')
      .select(SELECT_FIELDS)
      .eq('template_id', templateId)
      .order('id', { ascending: true })
      .range(from, to)
  );
}

export async function saveTemplateValues(templateId: string, items: TemplateValueInput[]): Promise<TemplateValueRow[]> {
  if (items.length === 0) return [];

  const payload = items.map(i => ({
    template_id: templateId,
    scope: i.scope,
    column_key: i.columnKey,
    training_id: i.scope === 'training' ? i.refId : null,
    demand_id: i.scope === 'demand' ? i.refId : null,
    value: i.value,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from('measurement_template_values')
    .upsert(payload, { onConflict: 'template_id,scope,column_key,training_id,demand_id' })
    .select(SELECT_FIELDS);

  if (error) {
    console.error('[measurement_template_values] upsert error', error);
    throw error;
  }
  const rows = (data ?? []) as TemplateValueRow[];
  if (rows.length < items.length) {
    throw new Error(
      `Valores não gravados: ${items.length - rows.length} de ${items.length} sem retorno — verifique permissões (RLS).`
    );
  }
  return rows;
}

/** Apaga um valor manual (ex.: limpar o preço sobrescrito de uma demanda). */
export async function deleteTemplateValue(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('measurement_template_values')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (measurement_template_values) — verifique permissões (RLS).');
  }
}

// O índice em memória que o resolvedor consome é puro e vive no domínio
// (domain/exports/templates/values.ts): `indexTemplateValues(rows)`.
export { indexTemplateValues, type TemplateValuesIndex } from '../../domain/exports/templates/values';
