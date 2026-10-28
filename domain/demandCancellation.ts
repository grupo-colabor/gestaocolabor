/**
 * CANCELAMENTO DE DEMANDA — regras puras (fonte única)
 *
 * Até aqui o cancelamento vivia espalhado: a lista de motivos copiada nos dois
 * modais (cliente e interna), a exceção do No-Show comparada por string em
 * seis lugares da Medição, três tabelas de permissão que precisavam andar
 * juntas, e um "Reativar" que apagava medição, agenda e alocação. Este módulo
 * concentra:
 *
 *   • os MOTIVOS (lista única) e a normalização do motivo — "No-Show",
 *     "no show", "noshow" e "NO_SHOW" são o mesmo motivo;
 *   • a REGRA POR STATUS: cancelar vale para qualquer status que não seja
 *     CANCELADA. Cancelar é só uma marca de status mais quatro campos
 *     (motivo, observação, data, status anterior). Nada é apagado nem liberado
 *     em tabela: agenda e conflitos já liberam por status
 *     (personScheduleConflict, resourceConflict, instructorAvailability);
 *   • a PERMISSÃO: admin e analista em qualquer status; medição FATURADA só
 *     admin, com confirmação extra (digitar o número da demanda);
 *   • os PATCHES de cancelar e reativar — a reativação é o inverso exato:
 *     devolve o status gravado antes do cancelamento e limpa os quatro campos.
 *     Instrutor, alocações, medição e agenda ficam como estão;
 *   • o RESUMO DE IMPACTO para o modal de confirmação de demanda que já
 *     começou ou terminou;
 *   • a VISIBILIDADE na Medição (cancelada com conteúdo aparece; vazia não;
 *     No-Show sempre), o aviso do reembolso que não entra no pagamento, as
 *     frases de auditoria e o texto da pendência da Medição Vale.
 *
 * `status_before_cancel` guarda o status GRAVADO (NOVA/PENDENTE/ALOCADA…),
 * nunca o calculado: CONCLUIDA e EM_ANDAMENTO só existem calculados pela data
 * (domain/demandStatus.ts), então uma concluída reativada volta como
 * CONCLUIDA sozinha, porque a coluna só guardava ALOCADA.
 *
 * Sem import de React, Supabase ou ExcelJS: roda no smoke em Node
 * (`npm run smoke:cancelamento`).
 */
import type { DemandStatus } from './demandStatus';
import {
  computeMeasurementTotals,
  computePanelExpenseBreakdown,
  isPagoPeloInstrutor,
  type TotalizableMeasurement,
} from './measurementTotals';
import { measurementStatusLabel } from './measurementStatus';
import { STATUS_LABELS } from './exports/shared';

/* ─────────────────────────────── motivos ─────────────────────────────── */

/** Lista ÚNICA — os dois modais leem daqui. A ordem é a de exibição. */
export const CANCEL_REASONS = [
  'Baixo quórum',
  'Falta de instrutor',
  'Reagendamento',
  'Solicitação do cliente',
  'No-Show',
  'Outro',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export const NO_SHOW_REASON: CancelReason = 'No-Show';
/** Motivo que pede observação livre no modal. */
export const REASON_WITH_NOTE: CancelReason = 'Outro';

/**
 * Normaliza o motivo para comparação: sem acento, sem caixa, sem espaço,
 * hífen, traço ou sublinhado. "No-Show", "no show", "noshow", "NO_SHOW" e
 * "Nó–Show" viram todos "noshow".
 */
export function normalizeCancelReason(reason: unknown): string {
  return String(reason ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-_–—.]+/g, '');
}

export const isNoShowReason = (reason: unknown): boolean =>
  normalizeCancelReason(reason) === normalizeCancelReason(NO_SHOW_REASON);

/* ─────────────────────────── campos da demanda ─────────────────────────── */

/** Só o que este módulo lê e escreve numa demanda (aceita `Demand` e o rascunho do formulário). */
export interface CancellationFields {
  status?: DemandStatus | string | null;
  instructorId?: string | null;
  cancelReason?: string | null;
  cancelNote?: string | null;
  /** Instante do cancelamento (ISO). */
  cancelledAt?: string | null;
  /** Status GRAVADO antes do cancelamento; a reativação volta para ele. */
  statusBeforeCancel?: DemandStatus | string | null;
}

export const isCancelledDemand = (d: Pick<CancellationFields, 'status'> | null | undefined): boolean =>
  !!d && d.status === 'CANCELADA';

/** Cancelada por No-Show — a exceção da Medição e o vermelho dos exports. */
export const isNoShowCancellation = (
  d: Pick<CancellationFields, 'status' | 'cancelReason'> | null | undefined
): boolean => isCancelledDemand(d) && isNoShowReason(d?.cancelReason);

/** "Cancelada · No-Show" — selo da Medição. */
export const cancelBadgeLabel = (d: Pick<CancellationFields, 'cancelReason'>): string =>
  `Cancelada · ${String(d.cancelReason ?? '').trim() || 'sem motivo'}`;

/* ───────────────────────────── regra por status ───────────────────────────── */

/** Cancelar vale para qualquer status que não seja CANCELADA. */
export const canCancelByStatus = (statusCalculado: string): boolean => statusCalculado !== 'CANCELADA';

/** EM_ANDAMENTO ou CONCLUIDA: a demanda já aconteceu (ou está acontecendo). */
export const demandJaComecou = (statusCalculado: string): boolean =>
  statusCalculado === 'EM_ANDAMENTO' || statusCalculado === 'CONCLUIDA';

/* ───────────────────────────────── permissão ───────────────────────────────── */

export type CancelDecision =
  | { allowed: true; extraConfirmation: boolean }
  | { allowed: false; reason: string };

const ROLES_QUE_CANCELAM: ReadonlySet<string> = new Set(['admin', 'analista']);

/**
 * Permissão para cancelar — ÚNICA regra, usada pelos dois modais.
 * Admin e analista em qualquer status. Medição FATURADA: só admin, e com
 * confirmação extra (digitar o número da demanda). Substitui as três regras
 * que existiam (ROLE_ACTIONS do App, DEMAND_ROLE_ACTIONS e o `canCancel`
 * da demanda interna).
 */
export function canCancelDemand(
  role: string | null | undefined,
  statusCalculado: string,
  statusMedicao?: string | null
): CancelDecision {
  if (!role || !ROLES_QUE_CANCELAM.has(role)) {
    return { allowed: false, reason: 'Seu perfil não pode cancelar demandas.' };
  }
  if (statusCalculado === 'CANCELADA') {
    return { allowed: false, reason: 'A demanda já está cancelada.' };
  }
  if (statusMedicao === 'FATURADA') {
    if (role !== 'admin') {
      return { allowed: false, reason: 'Medição faturada: só o administrador pode cancelar esta demanda.' };
    }
    return { allowed: true, extraConfirmation: true };
  }
  return { allowed: true, extraConfirmation: false };
}

/** Reativar: os mesmos perfis que cancelam. */
export const canReactivateDemand = (role: string | null | undefined): boolean =>
  !!role && ROLES_QUE_CANCELAM.has(role);

/** Confirmação extra: o número digitado é o id da demanda (caixa e espaços ignorados). */
export const extraConfirmationMatches = (typed: string | null | undefined, demandId: string): boolean =>
  String(typed ?? '').trim().toUpperCase() === String(demandId ?? '').trim().toUpperCase();

/* ─────────────────────────────────── patches ─────────────────────────────────── */

export interface CancelInput {
  reason: string;
  note?: string | null;
  /** Instante do cancelamento (ISO) — vem do chamador para a função ser pura. */
  now: string;
}

/**
 * O patch de cancelar: status CANCELADA + os quatro campos. TODO o resto da
 * demanda (instrutor, datas, logística…) passa intacto — é isso que o smoke
 * prende. Cancelar o que já está cancelado mantém o status anterior gravado.
 */
export function buildCancelPatch<T extends CancellationFields>(demand: T, input: CancelInput): T {
  const note = String(input.note ?? '').trim();
  const statusBeforeCancel = demand.status === 'CANCELADA'
    ? (demand.statusBeforeCancel ?? undefined)
    : (demand.status ?? undefined);
  return {
    ...demand,
    status: 'CANCELADA',
    cancelReason: input.reason,
    cancelNote: note || undefined,
    cancelledAt: input.now,
    statusBeforeCancel,
  } as T;
}

/** Status que a coluna `demands.status` guarda de fato (os demais são calculados). */
const STATUS_GRAVAVEIS: ReadonlySet<string> = new Set(['NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA']);

/** Cancelada antiga (sem `status_before_cancel`): ALOCADA se tem instrutor, NOVA se não. */
export const fallbackStatusBeforeCancel = (d: Pick<CancellationFields, 'instructorId'>): DemandStatus =>
  d.instructorId ? 'ALOCADA' : 'NOVA';

/** Para onde a reativação leva: o status gravado antes, ou o fallback. */
export function reactivationTargetStatus(d: CancellationFields): DemandStatus {
  const s = String(d.statusBeforeCancel ?? '');
  return STATUS_GRAVAVEIS.has(s) ? (s as DemandStatus) : fallbackStatusBeforeCancel(d);
}

/** O inverso exato do cancelamento: volta o status e limpa os quatro campos. Nada mais muda. */
export function buildReactivatePatch<T extends CancellationFields>(demand: T): T {
  return {
    ...demand,
    status: reactivationTargetStatus(demand),
    cancelReason: undefined,
    cancelNote: undefined,
    cancelledAt: undefined,
    statusBeforeCancel: undefined,
  } as T;
}

export const statusLabel = (s: string | null | undefined): string =>
  (STATUS_LABELS as Record<string, string>)[String(s ?? '')] ?? String(s ?? '');

/* ─────────────────────────────────── impacto ─────────────────────────────────── */

export type MeasurementLike = TotalizableMeasurement & { status?: string | null };

export interface CancellationImpactInput {
  statusCalculado: string;
  /** A linha de `measurements` da demanda, se existe. */
  measurement?: MeasurementLike | null;
  pessoas: { titulares: number; acompanhantes: number; participantes: number };
}

export interface CancellationImpact {
  statusCalculado: string;
  statusCalculadoLabel: string;
  /** EM_ANDAMENTO ou CONCLUIDA — é quando o bloco de impacto aparece. */
  jaComecou: boolean;
  temMedicao: boolean;
  medicaoStatus: string;
  medicaoStatusLabel: string;
  medicaoFaturada: boolean;
  /** `computeMeasurementTotals(m).total` — todas as despesas lançadas. */
  totalDespesas: number;
  /** Itens de despesa que entram em alguma categoria do painel. */
  qtdItens: number;
  /** Itens "pago pelo instrutor": o que deixaria de ser reembolsado pelo Excel de pagamento. */
  reembolsoInstrutor: number;
  pessoas: { titulares: number; acompanhantes: number; participantes: number };
  frase: string;
}

export const FRASE_NADA_APAGADO =
  'Nada será apagado: medição, despesas, alocações, agenda e evidências continuam como estão. Só o status muda, e a reativação devolve o status anterior.';

export function summarizeCancellationImpact(input: CancellationImpactInput): CancellationImpact {
  const m = input.measurement ?? null;
  const medicaoStatus = String(m?.status ?? '');
  return {
    statusCalculado: input.statusCalculado,
    statusCalculadoLabel: statusLabel(input.statusCalculado),
    jaComecou: demandJaComecou(input.statusCalculado),
    temMedicao: !!m,
    medicaoStatus,
    medicaoStatusLabel: m ? measurementStatusLabel(medicaoStatus) : 'Sem medição',
    medicaoFaturada: medicaoStatus === 'FATURADA',
    totalDespesas: m ? computeMeasurementTotals(m).total : 0,
    qtdItens: m ? computePanelExpenseBreakdown(m).itens : 0,
    reembolsoInstrutor: m ? computePanelExpenseBreakdown(m, { itemFilter: isPagoPeloInstrutor }).total : 0,
    pessoas: { ...input.pessoas },
    frase: FRASE_NADA_APAGADO,
  };
}

/* ───────────────────────── visibilidade na Medição ───────────────────────── */

export interface MeasurementContentLike {
  status?: string | null;
  attachments?: unknown[] | null;
  otherExpenses?: unknown[] | null;
}

/** Medição com algo lançado: etapa além de "Não Iniciada", ou qualquer item/linha. */
export const measurementHasContent = (m: MeasurementContentLike | null | undefined): boolean =>
  !!m && (
    (!!m.status && m.status !== 'NAO_INICIADA') ||
    (m.attachments?.length ?? 0) > 0 ||
    (m.otherExpenses?.length ?? 0) > 0
  );

/**
 * A lista da Medição mostra esta medição? Demanda ativa: sempre. Cancelada:
 * só com conteúdo (nada some em silêncio) — e No-Show sempre, como já era.
 * Cancelada com medição vazia fica fora, como antes.
 */
export function isMeasurementListed(
  demand: Pick<CancellationFields, 'status' | 'cancelReason'> | null | undefined,
  m: MeasurementContentLike | null | undefined
): boolean {
  if (!demand) return false;
  if (!isCancelledDemand(demand)) return true;
  return isNoShowCancellation(demand) || measurementHasContent(m);
}

export const AVISO_REEMBOLSO_CANCELADA = 'Demanda cancelada: este reembolso não entra no Excel de pagamento.';

/**
 * Reembolso ao instrutor que o Excel de pagamento NÃO vai pagar porque a
 * demanda está cancelada (o pagamento só olha demanda CONCLUÍDA). Zero quando
 * a demanda está ativa ou quando não há item "pago pelo instrutor".
 */
export function reembolsoForaDoPagamento(
  demand: Pick<CancellationFields, 'status'> | null | undefined,
  m: TotalizableMeasurement | null | undefined
): number {
  if (!isCancelledDemand(demand) || !m) return 0;
  return computePanelExpenseBreakdown(m, { itemFilter: isPagoPeloInstrutor }).total;
}

/* ─────────────────────────────── auditoria ─────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** dd/mm/yyyy HH:mm no fuso local; '' para data inválida. */
export function formatBrDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** dd/mm no fuso local; '' para data inválida. */
export function formatBrDayMonth(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

export interface CancellationAuditInput {
  demandId: string;
  interna?: boolean;
  empresa?: string;
  treinamento?: string;
  categoria?: string | null;
  descricao?: string | null;
  reason: string;
  note?: string | null;
  /** Status calculado no momento do cancelamento (o que a tela mostrava). */
  statusCalculado: string;
  /** Status gravado na coluna (o que a reativação devolve). */
  statusGravado: string | null | undefined;
  medicaoStatus?: string | null;
}

/** Descrição do evento "Cancelar" — mesmo formato " | " das demais descrições da trilha. */
export function describeCancellation(p: CancellationAuditInput): string {
  return [
    `Demanda${p.interna ? ' interna' : ''} ${p.demandId} cancelada`,
    p.interna ? `Categoria: ${p.categoria || '—'}` : `Empresa: ${p.empresa || 'N/A'}`,
    p.interna ? `Descrição: ${p.descricao || '—'}` : `Treinamento: ${p.treinamento || 'N/A'}`,
    `Motivo: ${p.reason || 'não informado'}`,
    String(p.note ?? '').trim() ? `Obs: ${String(p.note).trim()}` : null,
    `Status anterior: ${statusLabel(p.statusCalculado)} (calculado) / ${p.statusGravado || '—'} (gravado)`,
    p.medicaoStatus ? `Medição: ${measurementStatusLabel(p.medicaoStatus)}` : null,
  ].filter(Boolean).join(' | ');
}

export interface ReactivationAuditInput {
  demandId: string;
  interna?: boolean;
  voltaPara: string;
  cancelledAt?: string | null;
  reason?: string | null;
}

/** Descrição do evento "Reativar". */
export function describeReactivation(p: ReactivationAuditInput): string {
  return [
    `Demanda${p.interna ? ' interna' : ''} ${p.demandId} reativada`,
    `Volta para: ${statusLabel(p.voltaPara)}`,
    p.cancelledAt ? `Cancelada em: ${formatBrDateTime(p.cancelledAt)}` : null,
    p.reason ? `Motivo do cancelamento: ${p.reason}` : null,
    'Nada apagado',
  ].filter(Boolean).join(' | ');
}

/* ───────────────────────── pendência da Medição Vale ───────────────────────── */

/** O cancelamento aconteceu depois do último dia real da turma? */
export function cancelledAfterEnd(cancelledAt: string | null | undefined, ultimoDia: string | null | undefined): boolean {
  if (!cancelledAt || !ultimoDia) return false;
  const t = new Date(cancelledAt).getTime();
  if (Number.isNaN(t)) return false;
  const fimDoDia = new Date(`${String(ultimoDia).slice(0, 10)}T23:59:59`).getTime();
  if (Number.isNaN(fimDoDia)) return false;
  return t > fimDoDia;
}

/**
 * Texto do bloqueio na Medição Vale. Cancelada depois de terminar a turma:
 * "Demanda cancelada em dd/mm, após o término da turma" — é o sinal de que
 * uma medição já enviada pode precisar de ajuste. Antes disso: só
 * "Demanda cancelada", como sempre foi.
 */
export function cancellationBlockText(cancelledAt: string | null | undefined, ultimoDia: string | null | undefined): string {
  return cancelledAfterEnd(cancelledAt, ultimoDia)
    ? `Demanda cancelada em ${formatBrDayMonth(cancelledAt)}, após o término da turma`
    : 'Demanda cancelada';
}
