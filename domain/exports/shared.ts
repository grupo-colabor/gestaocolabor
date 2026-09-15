/**
 * MOTOR DE EXPORTAÇÃO — resoluções compartilhadas pelos datasets
 *
 * Tudo aqui delega ao domínio existente. O que este arquivo decide é QUAL
 * variante usar quando o app tem mais de uma — e cada escolha está anotada,
 * porque foi aprovada no parecer da F1:
 *
 *   • STATUS: o calculado, passando a modalidade RESOLVIDA (treinamento
 *     prevalece). É a variante de domain/instructorHours (`isDemandConcluida`),
 *     não a do Export Modal, que não passa modalidade e pode divergir em EAD.
 *   • MODALIDADE: `resolveDemandModality` + `getModalityLabel`, nunca a coluna
 *     crua da demanda.
 *   • NOTURNO: `isNightDemand` (fim >= 19:00 ou vira o dia), a mesma chave da
 *     aba Tarifas — não a marca laranja do Export Modal (início >= 18).
 *   • EMPRESA: a convenção do Excel de pagamento — interna sem empresa é
 *     'Colabor (Interna)'; cliente sem empresa '(sem empresa)'; empresa que
 *     não veio na busca '(empresa não encontrada)', que é sintoma de bug e
 *     tem que continuar visível.
 *   • DATAS: 'dd/mm/yyyy' fatiando a string, nunca por `new Date()` — o mesmo
 *     cuidado de components/demand-form/formatters.ts (shift de fuso na borda
 *     da meia-noite). O smoke confere a equivalência.
 */
import type { Demand, DemandStatus } from '../../types';
import { calculateDemandStatus } from '../demandStatus';
import { getDemandCompanyLabel, isInternalDemand } from '../demandLabel';
import { resolveDemandModality, getModalityLabel } from '../modalityOptions';
import { isNightDemand, getDemandDays } from '../demandDays';

type TrainingLike = { id: string; modality?: unknown };
type NamedRow = { id: string; name: string };

export function resolveCalculatedStatus(
  demand: Demand,
  trainingsById: Map<string, TrainingLike>,
  now: Date = new Date()
): DemandStatus {
  return calculateDemandStatus(
    {
      startDate: demand.startDate,
      endDate: demand.endDate,
      instructorId: demand.instructorId,
      cancelled: demand.status === 'CANCELADA',
      trainingLocal: demand.trainingLocal,
      modality: resolveDemandModality(demand, trainingsById),
    },
    now
  );
}

export const STATUS_LABELS: Record<DemandStatus, string> = {
  NOVA: 'Nova',
  PENDENTE: 'Pendente',
  ALOCADA: 'Alocada',
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

export const STATUS_ORDER: DemandStatus[] = [
  'NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA',
];

export const statusLabel = (s: string): string =>
  (STATUS_LABELS as Record<string, string>)[s] ?? s;

export function resolveModalityLabel(demand: Demand, trainingsById: Map<string, TrainingLike>): string {
  return getModalityLabel(resolveDemandModality(demand, trainingsById));
}

export const resolveNoturno = (demand: Demand): boolean => isNightDemand(demand);

/** Convenção do Excel de pagamento (services/medicaoExportService.ts, `nomeEmpresa`). */
export function resolveCompanyLabel(demand: Demand, companies: NamedRow[]): string {
  if (isInternalDemand(demand)) return getDemandCompanyLabel(demand, companies);
  if (!demand.companyId) return '(sem empresa)';
  const nome = companies.find(c => c.id === demand.companyId)?.name;
  if (!nome) return '(empresa não encontrada)';
  return nome;
}

export const TIPO_LABELS: Record<'cliente' | 'interna', string> = {
  cliente: 'Cliente',
  interna: 'Interna',
};

export const tipoLabel = (d: Demand): string =>
  isInternalDemand(d) ? TIPO_LABELS.interna : TIPO_LABELS.cliente;

/** 'YYYY-MM-DD...' -> 'dd/mm/yyyy'. Vazio/inválido -> ''. Sem `new Date()`. */
export function toBrDate(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  const datePart = s.includes('T') ? s.split('T')[0] : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return '';
  const [y, m, d] = datePart.split('-');
  return `${d}/${m}/${y}`;
}

/** 'YYYY-MM-DDTHH:mm...' -> 'HH:mm'. Sem hora -> ''. */
export function toBrTime(v: string | null | undefined): string {
  const s = String(v ?? '');
  if (!s.includes('T')) return '';
  const hhmm = s.split('T')[1]?.slice(0, 5) ?? '';
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '';
}

/** Nº de dias reais da demanda (dias específicos ou intervalo contínuo). */
export const demandDayCount = (demand: Demand): number => getDemandDays(demand).length;

/** 2 casas, mesmo arredondamento do Excel de pagamento. Evita ruído de float. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/* ────────────────────────────── dias ────────────────────────────── */

function isContiguous(dias: string[]): boolean {
  for (let i = 1; i < dias.length; i++) {
    const prev = new Date(`${dias[i - 1]}T12:00:00`);
    prev.setDate(prev.getDate() + 1);
    const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    if (expected !== dias[i]) return false;
  }
  return true;
}

/**
 * '05/03/2026' | '05/03/2026 a 07/03/2026' | '05/03/2026, 09/03/2026'.
 * Mesma regra de `formatDias` em services/medicaoWorkbook.ts — reescrita aqui
 * porque domain/ não importa services/ (guarda de fonte); o smoke confere que
 * as duas continuam iguais.
 */
export function formatDiasList(dias: string[]): string {
  if (!dias.length) return '';
  if (dias.length === 1) return toBrDate(dias[0]);
  if (isContiguous(dias)) return `${toBrDate(dias[0])} a ${toBrDate(dias[dias.length - 1])}`;
  return dias.map(toBrDate).join(', ');
}
