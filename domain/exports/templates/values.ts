/**
 * TEMPLATES DE MEDIÇÃO — valores manuais em memória (puro)
 *
 * O que a tabela `measurement_template_values` (migrations 017 e 018) guarda,
 * no formato que o resolvedor do template consome: escopo → referência →
 * chave da coluna → valor. Três escopos:
 *   • 'training' — referência = id do treinamento (preço HH padrão);
 *   • 'demand'   — referência = id da demanda (sobrescritas, combustível, %, obs);
 *   • 'context'  — referência = chave de contexto "<corredor>|<mina>"
 *                  (cabeçalho do BM: contrato, gerências, gestor, QQP…).
 * Quem lê o banco é services/exports/templateValues.ts; o domínio só recebe
 * o índice pronto.
 */
export type TemplateValueScope = 'training' | 'demand' | 'context';

export type TemplateValue = number | string | null;

export interface TemplateValueLike {
  scope: TemplateValueScope;
  column_key: string;
  training_id: string | null;
  demand_id: string | null;
  /** Só no escopo 'context' (018). Opcional para linhas anteriores à 018 e fixtures. */
  context_key?: string | null;
  value: TemplateValue;
}

export interface TemplateValuesIndex {
  training: Map<string, Map<string, TemplateValue>>;
  demand: Map<string, Map<string, TemplateValue>>;
  context: Map<string, Map<string, TemplateValue>>;
}

export const TEMPLATE_VALUE_SCOPES: TemplateValueScope[] = ['training', 'demand', 'context'];

export const emptyTemplateValuesIndex = (): TemplateValuesIndex => ({
  training: new Map(),
  demand: new Map(),
  context: new Map(),
});

/** A referência de uma linha, conforme o escopo. */
export function templateValueRef(r: TemplateValueLike): string | null {
  if (r.scope === 'training') return r.training_id;
  if (r.scope === 'demand') return r.demand_id;
  return r.context_key ?? null;
}

export function indexTemplateValues(rows: TemplateValueLike[]): TemplateValuesIndex {
  const idx = emptyTemplateValuesIndex();
  for (const r of rows) {
    const ref = templateValueRef(r);
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

/**
 * Chave de contexto do BM: "<corredor>|<mina>". Os dois lados passam por trim;
 * um '|' dentro de corredor ou mina viraria ambiguidade na chave, então é
 * trocado por '/'. Vazio de um lado é permitido (mina desconhecida), mas o BM
 * não gera para turma sem local — quem usa a chave decide.
 */
export const CONTEXT_KEY_SEPARATOR = '|';

export function contextKey(corredor: string, mina: string): string {
  const limpa = (s: string) => String(s ?? '').trim().replace(/\|/g, '/');
  return `${limpa(corredor)}${CONTEXT_KEY_SEPARATOR}${limpa(mina)}`;
}

export function parseContextKey(key: string): { corredor: string; mina: string } {
  const i = key.indexOf(CONTEXT_KEY_SEPARATOR);
  if (i < 0) return { corredor: key, mina: '' };
  return { corredor: key.slice(0, i), mina: key.slice(i + 1) };
}

/* ───────────────────────── gravação: upsert × delete ─────────────────────────
 *
 * Campo esvaziado NÃO vira `value: null` gravado: a linha é APAGADA (mesma
 * chave: template, escopo, coluna, treinamento/demanda/contexto). Campo que
 * nunca teve valor e continua vazio não gera nada. Vale para os três escopos.
 * A decisão é pura — recebe as edições pendentes e o índice do que está salvo
 * — para o smoke provar as três situações sem banco.
 */

/** Vazio = ausente, null, ou texto só de espaços. 0 NÃO é vazio. */
export const isTemplateValueEmpty = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Uma edição vinda da tela (GradeEditavel / CabecalhoBm). */
export interface TemplateValueEdit {
  scope: TemplateValueScope;
  refId: string;
  columnKey: string;
  value: TemplateValue;
  templateId?: string;
}

/** A chave de uma linha em measurement_template_values, sem o valor. */
export interface TemplateValueKey {
  scope: TemplateValueScope;
  refId: string;
  columnKey: string;
  templateId?: string;
}

export interface TemplateValueWritePlan {
  /** Valores não vazios: upsert. */
  upserts: TemplateValueEdit[];
  /** Vazios que TINHAM linha salva: delete pela chave. */
  deletes: TemplateValueKey[];
  /** Vazios que nunca existiram: nada a fazer (contados para o smoke). */
  ignorados: number;
}

/**
 * Separa as edições em upserts e deletes olhando o índice do que está SALVO
 * (`indexTemplateValues` das linhas do banco, do MESMO template).
 *
 * "Tinha linha salva" = a chave existe no índice, mesmo que com valor null
 * (linha gravada assim antes desta regra) — apagar limpa o legado também.
 */
export function planTemplateValueWrites(
  edits: TemplateValueEdit[],
  saved: TemplateValuesIndex
): TemplateValueWritePlan {
  const plan: TemplateValueWritePlan = { upserts: [], deletes: [], ignorados: 0 };
  for (const e of edits) {
    if (!isTemplateValueEmpty(e.value)) {
      plan.upserts.push(e);
      continue;
    }
    const existe = saved[e.scope].get(e.refId)?.has(e.columnKey) === true;
    if (existe) plan.deletes.push({ scope: e.scope, refId: e.refId, columnKey: e.columnKey, templateId: e.templateId });
    else plan.ignorados += 1;
  }
  return plan;
}

/**
 * Porta para o banco. O service (services/exports/templateValues.ts) implementa
 * sobre o Supabase; o smoke, sobre um Map. Os dois lançam em erro — quem chama
 * (o Salvar da grade) mostra o banner, igual para upsert e delete.
 */
export interface TemplateValueGateway<Row> {
  upsert: (items: TemplateValueEdit[]) => Promise<Row[]>;
  deleteByKey: (key: TemplateValueKey) => Promise<void>;
}

export interface TemplateValueWriteResult<Row> {
  gravados: Row[];
  apagados: TemplateValueKey[];
}

/**
 * Executa o plano: upserts numa chamada, deletes um a um. Plano vazio não
 * toca o gateway — é o que "limpar algo que nunca existiu" tem de garantir.
 * O primeiro erro interrompe e sobe.
 */
export async function applyTemplateValueWrites<Row>(
  plan: TemplateValueWritePlan,
  gateway: TemplateValueGateway<Row>
): Promise<TemplateValueWriteResult<Row>> {
  const gravados = plan.upserts.length > 0 ? await gateway.upsert(plan.upserts) : [];
  const apagados: TemplateValueKey[] = [];
  for (const key of plan.deletes) {
    await gateway.deleteByKey(key);
    apagados.push(key);
  }
  return { gravados, apagados };
}
