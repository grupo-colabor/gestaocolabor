/**
 * TEMPLATES DE MEDIÇÃO — valores manuais em memória (puro)
 *
 * O que a tabela `measurement_template_values` (migration 017) guarda, no
 * formato que o resolvedor do template consome: escopo → referência (id do
 * treinamento ou da demanda) → chave da coluna → valor. Quem lê o banco é
 * services/exports/templateValues.ts; o domínio só recebe o índice pronto.
 */
export type TemplateValueScope = 'training' | 'demand';

export type TemplateValue = number | string | null;

export interface TemplateValueLike {
  scope: TemplateValueScope;
  column_key: string;
  training_id: string | null;
  demand_id: string | null;
  value: TemplateValue;
}

export interface TemplateValuesIndex {
  training: Map<string, Map<string, TemplateValue>>;
  demand: Map<string, Map<string, TemplateValue>>;
}

export const emptyTemplateValuesIndex = (): TemplateValuesIndex => ({
  training: new Map(),
  demand: new Map(),
});

export function indexTemplateValues(rows: TemplateValueLike[]): TemplateValuesIndex {
  const idx = emptyTemplateValuesIndex();
  for (const r of rows) {
    const ref = r.scope === 'training' ? r.training_id : r.demand_id;
    if (!ref) continue;
    const porRef = idx[r.scope].get(ref) ?? new Map<string, TemplateValue>();
    porRef.set(r.column_key, r.value);
    idx[r.scope].set(ref, porRef);
  }
  return idx;
}

/** Valor de uma coluna para uma referência, ou `undefined` quando nunca foi digitado. */
export function getTemplateValue(
  idx: TemplateValuesIndex,
  scope: TemplateValueScope,
  refId: string,
  columnKey: string
): TemplateValue | undefined {
  return idx[scope].get(refId)?.get(columnKey);
}
