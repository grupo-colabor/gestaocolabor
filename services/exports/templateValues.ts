/**
 * VALORES MANUAIS DOS TEMPLATES DE MEDIÇÃO — `measurement_template_values`
 *
 * Migrations 017 e 018. Três escopos:
 *   • 'training' — valor por treinamento (o preço HH padrão da Vale);
 *   • 'demand'   — valor por demanda (preço sobrescrito, combustível, % de
 *                  despesa, observação);
 *   • 'context'  — valor por contexto "<corredor>|<mina>" (cabeçalho do BM).
 *
 * Leitura: TUDO de um ou mais templates, paginado via fetchAllPaginated.
 * Tabela vazia (primeira execução, ou nenhum valor digitado ainda) é um
 * resultado legítimo — devolve [] sem erro. Erro de banco PROPAGA.
 *
 * Escrita: upsert pela chave (template_id, scope, column_key, training_id,
 * demand_id, context_key), que casa com a constraint UNIQUE NULLS NOT
 * DISTINCT da 018. Endurecido: se o banco devolver menos linhas do que as
 * enviadas, é RLS filtrando em silêncio — lança, nunca finge que gravou. A
 * tela grava só no "Salvar" da prévia, nunca no download.
 *
 * Campo ESVAZIADO: DELETE da linha pela mesma chave, nunca upsert com
 * `value: null` (09/2026). Quem decide o que é upsert e o que é delete é o
 * domínio (`planTemplateValueWrites`); aqui só a porta para o banco
 * (`persistTemplateValueWrites`). Erro de delete sobe como o de upsert.
 *
 * Nada aqui é lido pelo Excel de pagamento nem pelo painel de Medição.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaginated } from '../pagination';
import {
  applyTemplateValueWrites,
  isTemplateValueEmpty,
  type TemplateValueGateway,
  type TemplateValueKey,
  type TemplateValueScope,
  type TemplateValueWritePlan,
  type TemplateValueWriteResult,
} from '../../domain/exports/templates/values';

export type { TemplateValueScope, TemplateValueKey, TemplateValueWritePlan };

export interface TemplateValueRow {
  id: string;
  template_id: string;
  scope: TemplateValueScope;
  column_key: string;
  training_id: string | null;
  demand_id: string | null;
  context_key: string | null;
  /** jsonb escalar: número (preço, %) ou string (observação, cabeçalho). */
  value: number | string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/** O que a tela manda ao salvar. `refId` é o treinamento, a demanda ou a chave de contexto, conforme o escopo. */
export interface TemplateValueInput {
  scope: TemplateValueScope;
  refId: string;
  columnKey: string;
  value: number | string | null;
}

const SELECT_FIELDS =
  'id, template_id, scope, column_key, training_id, demand_id, context_key, value, updated_at, updated_by';

export async function fetchTemplateValues(templateIds: string | string[]): Promise<TemplateValueRow[]> {
  const ids = Array.isArray(templateIds) ? templateIds : [templateIds];
  if (ids.length === 0) return [];
  return fetchAllPaginated<TemplateValueRow>((from, to) =>
    supabase
      .from('measurement_template_values')
      .select(SELECT_FIELDS)
      .in('template_id', ids)
      .order('id', { ascending: true })
      .range(from, to)
  );
}

export async function saveTemplateValues(templateId: string, items: TemplateValueInput[]): Promise<TemplateValueRow[]> {
  if (items.length === 0) return [];

  // Valor vazio NÃO é upsert: é delete pela chave (planTemplateValueWrites).
  // Chegar aqui vazio é erro de programação, não de dado — lança para não
  // gravar `value: null` em silêncio.
  const vazio = items.find(i => isTemplateValueEmpty(i.value));
  if (vazio) {
    throw new Error(
      `saveTemplateValues recebeu valor vazio (${vazio.scope}/${vazio.refId}/${vazio.columnKey}) — campo esvaziado deve virar DELETE (persistTemplateValueWrites).`
    );
  }

  const payload = items.map(i => ({
    template_id: templateId,
    scope: i.scope,
    column_key: i.columnKey,
    training_id: i.scope === 'training' ? i.refId : null,
    demand_id: i.scope === 'demand' ? i.refId : null,
    context_key: i.scope === 'context' ? i.refId : null,
    value: i.value,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from('measurement_template_values')
    .upsert(payload, { onConflict: 'template_id,scope,column_key,training_id,demand_id,context_key' })
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

/**
 * Apaga UMA linha pela chave lógica (template, escopo, coluna, referência) —
 * o que o Salvar faz quando um campo que tinha valor é esvaziado. As colunas
 * de referência que não pertencem ao escopo são NULL na linha, e o filtro
 * precisa dizer isso (`.is(null)`), senão `.eq(null)` não casa nada.
 *
 * 0 linhas apagadas é erro: a tela só pede delete do que ela viu salvo, então
 * "nada apagado" é RLS filtrando (ou alguém apagou antes — recarregar resolve).
 */
export async function deleteTemplateValueByKey(templateId: string, key: TemplateValueKey): Promise<void> {
  let q = supabase
    .from('measurement_template_values')
    .delete()
    .eq('template_id', templateId)
    .eq('scope', key.scope)
    .eq('column_key', key.columnKey);
  q = key.scope === 'training' ? q.eq('training_id', key.refId) : q.is('training_id', null);
  q = key.scope === 'demand' ? q.eq('demand_id', key.refId) : q.is('demand_id', null);
  q = key.scope === 'context' ? q.eq('context_key', key.refId) : q.is('context_key', null);

  const { data, error } = await q.select('id');
  if (error) {
    console.error('[measurement_template_values] delete by key error', error);
    throw error;
  }
  if (!data || data.length === 0) {
    throw new Error(
      `Valor não apagado (${key.scope}/${key.refId}/${key.columnKey}): nenhuma linha excluída — verifique permissões (RLS) ou recarregue.`
    );
  }
}

/** A porta do domínio sobre o Supabase, para um template. */
export function supabaseTemplateValueGateway(templateId: string): TemplateValueGateway<TemplateValueRow> {
  return {
    upsert: items => saveTemplateValues(templateId, items),
    deleteByKey: key => deleteTemplateValueByKey(templateId, key),
  };
}

/**
 * Executa o plano do domínio (upserts + deletes) para um template. É o que o
 * Salvar da grade chama; erro de qualquer um dos dois sobe para o banner.
 */
export async function persistTemplateValueWrites(
  templateId: string,
  plan: TemplateValueWritePlan
): Promise<TemplateValueWriteResult<TemplateValueRow>> {
  return applyTemplateValueWrites(plan, supabaseTemplateValueGateway(templateId));
}

/** Apaga um valor manual pelo id da linha. */
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
