/**
 * ALERTAS DA CENTRAL DE NOTIFICAÇÕES — regras de disparo
 *
 * A tela de Notificações não lê nenhuma tabela de notificação: não existe
 * `notifications` no banco, nem trigger, nem job. Os 5 blocos são RECALCULADOS
 * a cada render a partir de `demands` + o status externo de cada pendência
 * (logística, evidência, medição). "Gatilho", aqui, é um predicado — e é ele
 * que mora neste módulo.
 *
 * Isto foi extraído de `components/Notifications.tsx` para que a regra de cada
 * bloco fosse verificável por execução (scripts/smokeNotificacoesInternas.ts).
 * Enquanto vivia dentro de `useMemo`s do componente, a única forma de saber se
 * uma demanda interna disparava um alerta era abrir a tela e olhar.
 *
 * DEMANDA INTERNA — a regra por bloco:
 *  - Logística, alocação de instrutor, medição e cancelamento VALEM para
 *    interna: alguém se desloca, alguém ministra, alguém paga. As telas de
 *    destino (Controle Logístico, Medição) já tratam interna explicitamente.
 *  - Evidência NÃO vale: lista de presença e certificado são documentação de
 *    treinamento de cliente. `Evidences.tsx` exclui interna com
 *    `.filter(d => d.tipo !== 'interna')` — o alerta precisa excluir pelo mesmo
 *    critério, senão aponta para uma tela onde a demanda não existe.
 */
import { requiresInstructor, requiresLogistics } from './modalityRules';
import { isInternalDemand } from './demandLabel';
import type { Demand } from '../types';

/** Só o que os predicados leem — aceita `Demand` e qualquer subconjunto dela. */
export type AlertableDemand = Pick<Demand, 'id' | 'tipo'> &
  Partial<Pick<Demand, 'status' | 'instructorId'>>;

/**
 * Contexto já resolvido de uma demanda. O componente faz os lookups (status
 * calculado, modalidade efetiva, linhas de logística/evidência/medição) e
 * entrega prontos — os predicados não refazem busca em array.
 */
export interface DemandAlertContext {
  demand: AlertableDemand;
  /** Saída de `calculateDemandStatus` — o status REAL, não o da coluna. */
  status: string;
  /** Modalidade efetiva: a do TREINAMENTO prevalece sobre a da demanda. */
  modality: string;
  /** `overall_status` da linha em logistic_allocations; `null` = sem linha. */
  logisticsStatus?: string | null;
  /**
   * Prontidão logística recalculada por `domain/demandLogisticsStatus.ts` a
   * partir da MESMA linha que o Controle Logístico usa. Quando vem preenchida
   * ela manda, e as duas telas passam a concordar por construção.
   * `undefined`/`null` = não foi calculada; cai no `logisticsStatus` persistido.
   */
  logisticsReady?: boolean | null;
  /** Saída de `getEvidenceAutoStatus(demandId)`. */
  evidenceStatus?: string | null;
  /** `status` da medição; `null`/`undefined` = nenhuma linha de medição. */
  measurementStatus?: string | null;
}

const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** Cancelada nunca gera pendência operacional — só entra no bloco 5. */
const isCancelled = (ctx: DemandAlertContext) =>
  ctx.status === 'CANCELADA' || ctx.demand.status === 'CANCELADA';

/**
 * Bloco 1 — Pendências Logísticas.
 * Demanda ainda não concluída, de modalidade que exige logística, com linha em
 * `logistic_allocations` que não fechou. Sem linha não há pendência: o alerta
 * cobre logística ABERTA, não logística ausente.
 *
 * Interna entra: é sempre PRESENCIAL por construção, e o formulário dela cria a
 * linha de logística no save (upsertLogisticByDemandId).
 *
 * A prontidão vem de `ctx.logisticsReady` — a regra compartilhada com o
 * Controle Logístico (`domain/demandLogisticsStatus.ts`). O `logisticsStatus`
 * persistido continua como fallback para quem não calcula o checklist: ele só
 * fica correto depois que alguém abre o Controle Logístico (que faz o
 * write-back), e era justamente essa dependência que fazia as duas telas
 * divergirem.
 */
export function hasPendingLogistics(ctx: DemandAlertContext): boolean {
  if (isCancelled(ctx)) return false;
  if (!requiresLogistics(ctx.modality)) return false;
  if (ctx.status === 'CONCLUIDA') return false;
  if (ctx.logisticsStatus == null) return false;
  if (ctx.logisticsReady != null) return !ctx.logisticsReady;
  return upper(ctx.logisticsStatus || 'PENDENTE') !== 'CONCLUIDA';
}

/**
 * Bloco 2 — Pendências de Evidência.
 * Demanda concluída, com instrutor por modalidade, cuja evidência não está
 * completa.
 *
 * ⚠️ Interna fica FORA. Evidência é lista de presença + certificados +
 * fotos de turma de cliente; interna (visita, SIPAT, apoio logístico) não gera
 * nenhum desses documentos. `Evidences.tsx` já a exclui da listagem, então uma
 * interna aqui produzia um alerta INSOLÚVEL: clicar levava para Evidências
 * filtrada pelo ID dela, e a tela devolvia lista vazia — sem jeito de baixar a
 * pendência, e ela ainda somava no contador do cabeçalho.
 */
export function hasPendingEvidence(ctx: DemandAlertContext): boolean {
  if (isInternalDemand(ctx.demand)) return false;
  if (isCancelled(ctx)) return false;
  if (ctx.status !== 'CONCLUIDA') return false;
  if (!requiresInstructor(ctx.modality)) return false;
  return upper(ctx.evidenceStatus) !== 'COMPLETA';
}

/**
 * Bloco 3 — Aguardando Alocação de Instrutor.
 * Demanda ainda não concluída, de modalidade que exige instrutor, sem
 * `instructor_id`.
 *
 * Interna entra: alguém precisa ser designado para a visita/SIPAT/evento — é a
 * mesma pergunta operacional de uma demanda de cliente.
 */
export function isAwaitingInstructor(ctx: DemandAlertContext): boolean {
  if (isCancelled(ctx)) return false;
  if (ctx.status === 'CONCLUIDA') return false;
  if (!requiresInstructor(ctx.modality)) return false;
  return !String(ctx.demand.instructorId ?? '').trim();
}

/**
 * Bloco 4 — Medições Administrativas Pendentes.
 * Demanda concluída, com instrutor, cuja medição não existe ou não saiu de
 * NAO_INICIADA.
 *
 * Interna entra: ela é paga ao instrutor como qualquer outra — a medição usa
 * `horasPrevistas` no lugar da carga do treinamento (ver instructorHours).
 */
export function hasPendingMeasurement(ctx: DemandAlertContext): boolean {
  if (isCancelled(ctx)) return false;
  if (ctx.status !== 'CONCLUIDA') return false;
  if (!String(ctx.demand.instructorId ?? '').trim()) return false;
  if (ctx.measurementStatus == null) return true; // sem linha de medição
  return upper(ctx.measurementStatus) === 'NAO_INICIADA';
}

/**
 * Para qual tela o clique no alerta deve navegar quando o destino é a LISTA de
 * demandas. `Demands.tsx` mostra só `tipo='cliente'` (filtro na linha 154) e
 * `InternalDemands.tsx` só `tipo='interna'` — mandar uma interna para
 * 'demands' filtra a tela de cliente por um ID que não está lá e devolve lista
 * vazia. Os blocos 3 e 5 são os que caem aqui.
 */
export function demandListView(demand: AlertableDemand | null | undefined): 'demands' | 'internal-demands' {
  return isInternalDemand(demand) ? 'internal-demands' : 'demands';
}
