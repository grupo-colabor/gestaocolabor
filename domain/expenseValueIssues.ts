/**
 * VALOR DO ITEM DE DESPESA — o que está gravado merece aviso?
 *
 * O parser pt-BR (domain/moneyBR.ts) resolve o que se DIGITA. Este módulo
 * olha o que JÁ ESTÁ no item — número gravado, texto antigo, nada — e diz se
 * as superfícies precisam avisar, sem mudar o número que elas somam:
 *
 *   • ok        — número de até 2 casas, ou zero digitado de propósito
 *                 (`valorDigitado` preenchido: alguém escreveu "0");
 *   • semValor  — valor 0, ausente, `null` ou texto em branco, sem ninguém ter
 *                 digitado um número. É o rascunho (decisão 7) e o dado antigo
 *                 zerado (31 itens em produção em 13/11/2026). Soma ZERO — é
 *                 o que já somava — e por isso fica "fora da soma" no aviso;
 *   • suspeito  — número gravado cujo texto de edição o parser recusa: 3+ casas
 *                 (assinatura do milhar cortado pelo Salvar antigo) ou
 *                 negativo. CONTINUA SOMANDO o próprio número: nenhum valor
 *                 gravado muda em superfície nenhuma; o aviso é que aparece;
 *   • ilegivel  — texto gravado que o parser recusa (não existe hoje em
 *                 produção; o Salvar sempre gravou número). Soma ZERO, como
 *                 sempre somou, e entra no "fora da soma".
 *
 * Quem usa: o Painel de Medição (selos no item), a Medição Vale e o BM
 * (pendência por turma + célula amarela), o Dashboard (nota "N itens sem
 * valor fora da soma") e o Excel de pagamento (célula amarela + Resumo).
 *
 * O órfão de OUTROS (anexo apontando para linha apagada de `other_expenses`)
 * fica de fora: nenhuma superfície o soma, e avisar o valor dele seria ruído.
 */
import { formatarValorParaEdicao, parseMoneyBR, type MotivoValorInvalido } from './moneyBR';
import {
  isOrfaoOutrosIds,
  panelBucketOf,
  type PanelExpenseBucket,
  type TotalizableAttachment,
  type TotalizableMeasurement,
} from './measurementTotals';
import { resolveAttachmentLink, type AttachmentLike } from './measurementAttachment';

export type ExpenseValueStatus = 'ok' | 'semValor' | 'suspeito' | 'ilegivel';

/** Só o que a classificação lê do item. */
export interface ExpenseItemLike extends TotalizableAttachment, AttachmentLike {
  id?: string;
  /** Texto como a pessoa digitou (gravado pelo Salvar desde 13/11/2026). Ausente no dado antigo. */
  valorDigitado?: string | null;
}

/**
 * O texto que o CAMPO do item mostra — e que a validação lê. Número gravado
 * sai sem perder casas (`formatarValorParaEdicao`); texto em edição sai como
 * está; nada sai vazio.
 */
export function textoDeEdicao(value: unknown): string {
  if (typeof value === 'number') return formatarValorParaEdicao(value);
  if (typeof value === 'string') return value;
  return '';
}

/** Alguém digitou um número para este item (inclusive "0")? */
const digitouValor = (a: ExpenseItemLike): boolean =>
  typeof a.valorDigitado === 'string' && a.valorDigitado.trim() !== '' && parseMoneyBR(a.valorDigitado).ok;

/** Ver o cabeçalho. */
export function expenseValueStatus(a: ExpenseItemLike | null | undefined): ExpenseValueStatus {
  if (!a) return 'ok';
  const v = a.value;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'ilegivel';
    if (v === 0) return digitouValor(a) ? 'ok' : 'semValor';
    return parseMoneyBR(formatarValorParaEdicao(v)).ok ? 'ok' : 'suspeito';
  }
  if (typeof v === 'string') {
    const r = parseMoneyBR(v);
    if (r.ok) return 'ok'; // texto em edição: "0" digitado é zero de propósito
    return r.motivo === 'vazio' ? 'semValor' : 'ilegivel';
  }
  if (v === null || v === undefined) return 'semValor';
  return 'ilegivel';
}

/** Notinha (arquivo, inclusive o que perdeu o link) ou lançamento avulso? */
export const temArquivo = (a: AttachmentLike): boolean => resolveAttachmentLink(a).kind !== 'plain';

/** Por que o texto de um item suspeito/ilegível foi recusado (para o aviso). */
export function motivoDoValor(a: ExpenseItemLike): MotivoValorInvalido | null {
  const r = parseMoneyBR(textoDeEdicao(a.value));
  return r.ok ? null : r.motivo;
}

export interface ExpenseValueIssue {
  itemId: string;
  categoria: string;
  bucket: PanelExpenseBucket;
  status: Exclude<ExpenseValueStatus, 'ok'>;
  temArquivo: boolean;
  /** O que o campo mostra (número gravado sem perder casas, ou o texto gravado). */
  texto: string;
  motivo: MotivoValorInvalido | null;
  instructorId?: string | null;
}

export interface ListIssuesOptions {
  /** Recorte por item (ex.: `entraNaMedicaoDoCliente`, `isPagoPeloInstrutor`). */
  itemFilter?: (a: TotalizableAttachment) => boolean;
}

/** Os itens de UMA medição que merecem aviso de valor, na ordem do JSON. */
export function listExpenseValueIssues(
  m: TotalizableMeasurement | null | undefined,
  opts: ListIssuesOptions = {}
): ExpenseValueIssue[] {
  const outrosIds = new Set((m?.otherExpenses ?? []).map(o => o.id));
  const out: ExpenseValueIssue[] = [];
  for (const raw of (m?.attachments ?? []) as ExpenseItemLike[]) {
    if (!raw) continue;
    if (opts.itemFilter && !opts.itemFilter(raw)) continue;
    if (isOrfaoOutrosIds(raw, outrosIds)) continue;
    const status = expenseValueStatus(raw);
    if (status === 'ok') continue;
    out.push({
      itemId: String(raw.id ?? ''),
      categoria: String(raw.category ?? ''),
      bucket: panelBucketOf(raw.category),
      status,
      temArquivo: temArquivo(raw),
      texto: textoDeEdicao(raw.value),
      motivo: motivoDoValor(raw),
      instructorId: raw.instructorId ?? null,
    });
  }
  return out;
}

export interface ExpenseValueIssueSummary {
  semValor: number;
  suspeitos: number;
  ilegiveis: number;
  /** Itens que somam ZERO por falta de valor legível: sem valor + ilegíveis. */
  foraDaSoma: number;
  total: number;
}

export function summarizeExpenseValueIssues(issues: ExpenseValueIssue[]): ExpenseValueIssueSummary {
  const semValor = issues.filter(i => i.status === 'semValor').length;
  const suspeitos = issues.filter(i => i.status === 'suspeito').length;
  const ilegiveis = issues.filter(i => i.status === 'ilegivel').length;
  return { semValor, suspeitos, ilegiveis, foraDaSoma: semValor + ilegiveis, total: issues.length };
}

/** Soma de várias medições — o que a nota do Dashboard conta. */
export function summarizeMeasurementsValueIssues(
  ms: (TotalizableMeasurement | null | undefined)[] | null | undefined,
  opts: ListIssuesOptions = {}
): ExpenseValueIssueSummary {
  return summarizeExpenseValueIssues((ms ?? []).flatMap(m => listExpenseValueIssues(m, opts)));
}

/** "1 item sem valor fora da soma" / "3 itens sem valor fora da soma". */
export function notaItensSemValor(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'itens'} sem valor fora da soma`;
}

const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

const porQueSuspeito = (motivo: MotivoValorInvalido | null): string =>
  motivo === 'negativo' ? 'negativo' : motivo === 'casasDemais' ? '3+ casas decimais' : 'fora do formato';

/** Um aviso de valor: `texto` é o motivo; `detalhe` (contagem, valor) vai entre parênteses. */
export interface AvisoValor {
  texto: string;
  detalhe: string;
}

/**
 * Os avisos de um conjunto de itens já recortado (uma categoria, uma pessoa):
 * um por tipo. A parte que VARIA (contagem, valor) fica em `detalhe`, para ir
 * no parêntese final — o painel de pendências agrupa pelo texto sem ele, e
 * "2 notinhas" e "3 notinhas" precisam cair no mesmo grupo.
 */
export function avisosDeValor(issues: ExpenseValueIssue[], onde: string): AvisoValor[] {
  const out: AvisoValor[] = [];
  const notinhas = issues.filter(i => i.status === 'semValor' && i.temArquivo).length;
  const avulsos = issues.filter(i => i.status === 'semValor' && !i.temArquivo).length;
  if (notinhas) out.push({ texto: `Notinha sem valor em ${onde}`, detalhe: itens(notinhas) });
  if (avulsos) out.push({ texto: `Lançamento sem valor em ${onde}`, detalhe: itens(avulsos) });
  const suspeitos = issues.filter(x => x.status === 'suspeito');
  if (suspeitos.length) {
    out.push({ texto: `Valor suspeito em ${onde}`, detalhe: suspeitos.map(i => `${i.texto} — ${porQueSuspeito(i.motivo)}`).join('; ') });
  }
  const ilegiveis = issues.filter(x => x.status === 'ilegivel');
  if (ilegiveis.length) {
    out.push({ texto: `Valor ilegível em ${onde} — fora da soma`, detalhe: ilegiveis.map(i => `"${i.texto}"`).join('; ') });
  }
  return out;
}

/** O aviso numa frase só: "Notinha sem valor em Locomoção (2 itens)". */
export const avisoValorEmTexto = (a: AvisoValor): string => (a.detalhe ? `${a.texto} (${a.detalhe})` : a.texto);
