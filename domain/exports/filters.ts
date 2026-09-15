/**
 * MOTOR DE EXPORTAÇÃO — filtros
 *
 * Predicados puros sobre linhas já construídas. Os dados chegam completos
 * (fetchAllPaginated) e a filtragem é em memória, como no Export Modal.
 *
 * `applyFilters` só aplica as chaves que o dataset declarou em `filters`:
 * assim um filtro de instrutor que sobrou no estado da tela não zera o
 * dataset de Demandas em silêncio.
 *
 * PERÍODO é por INTERSEÇÃO (`demandIntersectsRange`): a demanda entra se algum
 * dia dela cai no intervalo. Não há rateio de horas pelos dias dentro do
 * período — isso é regra da planilha de pagamento (domain/instructorHours),
 * não deste export, e a aba avisa em texto fixo.
 */
import type { Demand } from '../../types';
import { demandIntersectsRange } from '../demandDays';
import { matchesModality, buildModalityOptions, type ModalityOption } from '../modalityOptions';
import { resolveCalculatedStatus, STATUS_ORDER, STATUS_LABELS } from './shared';
import type { ExportFilters, FilterKey, FilterableRow } from './types';

type TrainingLike = { id: string; modality?: unknown };

export interface FilterContext {
  trainingsById: Map<string, TrainingLike>;
  /** Injetável para o smoke fixar "hoje". */
  now?: Date;
}

export function matchesFilters(
  row: FilterableRow,
  f: ExportFilters,
  allowed: FilterKey[],
  ctx: FilterContext
): boolean {
  const d = row.demand;
  const on = (k: FilterKey) => allowed.includes(k);

  if (on('periodo') && (f.dataInicio || f.dataFim)) {
    if (!demandIntersectsRange(d, f.dataInicio || undefined, f.dataFim || undefined)) return false;
  }
  if (on('status') && f.status) {
    if (resolveCalculatedStatus(d, ctx.trainingsById, ctx.now) !== f.status) return false;
  }
  if (on('modalidade') && f.modalidade) {
    if (!matchesModality(d, ctx.trainingsById, f.modalidade)) return false;
  }
  if (on('tipo') && f.tipo) {
    if ((d.tipo ?? 'cliente') !== f.tipo) return false;
  }
  if (on('uf') && f.uf) {
    if ((d.demandState ?? '').trim().toUpperCase() !== f.uf.toUpperCase()) return false;
  }
  if (on('cliente') && f.companyId) {
    if ((d.companyId ?? '') !== f.companyId) return false;
  }
  if (on('instrutor') && f.instructorId) {
    if ((row.instructorId ?? '') !== f.instructorId) return false;
  }
  if (on('papel') && f.papel) {
    if (row.papel !== f.papel) return false;
  }
  return true;
}

export function applyFilters<Row extends FilterableRow>(
  rows: Row[],
  f: ExportFilters,
  allowed: FilterKey[],
  ctx: FilterContext
): Row[] {
  return rows.filter(r => matchesFilters(r, f, allowed, ctx));
}

/* ────────────────────────── opções dos selects ────────────────────────── */

export interface FilterOptions {
  status: { value: string; label: string }[];
  modalidade: ModalityOption[];
  tipo: { value: 'cliente' | 'interna'; label: string }[];
  uf: string[];
  clientes: { id: string; name: string }[];
  instrutores: { id: string; name: string }[];
  papel: { value: string; label: string }[];
}

export const PAPEL_LABELS: Record<string, string> = {
  TITULAR: 'Titular',
  PARTICIPANTE: 'Participante',
  ACOMPANHANTE: 'Acompanhante',
};

/**
 * Opções derivadas dos DADOS carregados (UF, clientes e instrutores presentes),
 * mais as listas fechadas (status, tipo, papel). Modalidade vem de
 * `buildModalityOptions`, a mesma fonte dos outros filtros do app.
 */
export function buildFilterOptions<Row extends FilterableRow>(
  rows: Row[],
  trainings: TrainingLike[],
  companies: { id: string; name: string }[],
  instructors: { id: string; name: string }[]
): FilterOptions {
  const demandsSeen = new Map<string, Demand>();
  const ufs = new Set<string>();
  const companyIds = new Set<string>();
  const instructorIds = new Set<string>();

  for (const r of rows) {
    demandsSeen.set(r.demand.id, r.demand);
    const uf = (r.demand.demandState ?? '').trim().toUpperCase();
    if (uf) ufs.add(uf);
    if (r.demand.companyId) companyIds.add(r.demand.companyId);
    if (r.instructorId) instructorIds.add(r.instructorId);
  }

  const nameOf = (list: { id: string; name: string }[], id: string) =>
    list.find(x => x.id === id)?.name ?? id;

  return {
    status: STATUS_ORDER.map(s => ({ value: s, label: STATUS_LABELS[s] })),
    modalidade: buildModalityOptions([...demandsSeen.values()], trainings),
    tipo: [
      { value: 'cliente', label: 'Cliente' },
      { value: 'interna', label: 'Interna' },
    ],
    uf: [...ufs].sort(),
    clientes: [...companyIds]
      .map(id => ({ id, name: nameOf(companies, id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    instrutores: [...instructorIds]
      .map(id => ({ id, name: nameOf(instructors, id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    papel: Object.entries(PAPEL_LABELS).map(([value, label]) => ({ value, label })),
  };
}
