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
import { demandIntersectsRange, toDateKey } from '../demandDays';
import { matchesModality, buildModalityOptions, type ModalityOption } from '../modalityOptions';
import { resolveCalculatedStatus, STATUS_ORDER, STATUS_LABELS } from './shared';
import { DEFAULT_OPTIONS, type ExportOptions } from './options';
import { SEM_MEDICAO, type ExportFilters, type FilterKey, type FilterableRow } from './types';
import { transportLabel } from './datasets/demandas';

/** Rótulos dos estágios da medição — os mesmos de STAGE_LABELS em Measurement.tsx. */
export const MEDICAO_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'NAO_INICIADA', label: 'Não iniciada' },
  { value: 'LANCAMENTO', label: 'Em lançamento de despesas' },
  { value: 'CONFERENCIA', label: 'Em conferência' },
  { value: 'PRONTA_FATURAMENTO', label: 'Pronta para faturamento' },
  { value: 'FATURADA', label: 'Faturada' },
  { value: SEM_MEDICAO, label: 'Sem medição' },
];

type TrainingLike = { id: string; modality?: unknown };

export interface FilterContext {
  trainingsById: Map<string, TrainingLike>;
  /** Injetável para o smoke fixar "hoje". */
  now?: Date;
  /**
   * Opções marcáveis. Só `incluirCanceladas` age aqui: desligada, a demanda
   * cancelada sai — exceto quando o filtro de status pede exatamente
   * 'CANCELADA', que força a inclusão (ver options.ts).
   */
  options?: ExportOptions;
}

export function matchesFilters(
  row: FilterableRow,
  f: ExportFilters,
  allowed: FilterKey[],
  ctx: FilterContext
): boolean {
  const d = row.demand;
  const on = (k: FilterKey) => allowed.includes(k);
  const opts = ctx.options ?? DEFAULT_OPTIONS;

  if (on('periodo') && (f.dataInicio || f.dataFim)) {
    if (!demandIntersectsRange(d, f.dataInicio || undefined, f.dataFim || undefined)) return false;
  }
  if (on('periodoInicio') && (f.dataInicio || f.dataFim)) {
    const inicio = toDateKey(d.startDate);
    if (f.dataInicio && inicio < f.dataInicio) return false;
    if (f.dataFim && inicio > f.dataFim) return false;
  }
  if (on('corredor') && f.corredor) {
    if ((d.corredor ?? '') !== f.corredor) return false;
  }
  if (on('site') && f.site) {
    if ((d.trainingLocal ?? '') !== f.site) return false;
  }
  if (on('statusMedicao') && f.statusMedicao.length > 0) {
    const atual = row.medicaoStatus || SEM_MEDICAO;
    if (!f.statusMedicao.includes(atual)) return false;
  }
  // Status calculado uma vez: serve ao filtro de status e à regra de canceladas.
  const statusCalculado =
    (on('status') && f.status) || !opts.incluirCanceladas
      ? resolveCalculatedStatus(d, ctx.trainingsById, ctx.now)
      : null;
  if (on('status') && f.status) {
    if (statusCalculado !== f.status) return false;
  }
  if (!opts.incluirCanceladas && statusCalculado === 'CANCELADA' && f.status !== 'CANCELADA') {
    return false;
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
  // Linha sem modo (bloco de Hospedagem) sai quando o filtro está ativo — decisão aprovada.
  if (on('modoTransporte') && f.modoTransporte) {
    if ((row.modoTransporte ?? '') !== f.modoTransporte) return false;
  }
  if (on('pendenciaDoc') && f.somentePendenciaDoc) {
    if (!row.pendenciaDoc) return false;
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
  /** Corredores presentes nos dados, unidos aos da base operacional quando informados. */
  corredores: string[];
  /** Locais/sites presentes nos dados. */
  sites: string[];
  statusMedicao: { value: string; label: string }[];
  /** Modos de transporte presentes nas linhas (chave crua + rótulo da tela). */
  modosTransporte: { value: string; label: string }[];
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
  instructors: { id: string; name: string }[],
  /** `operationalBases.corredores` do contexto — a mesma fonte dos filtros de Demandas e Controle Logístico. */
  corredoresBase: string[] = []
): FilterOptions {
  const demandsSeen = new Map<string, Demand>();
  const ufs = new Set<string>();
  const companyIds = new Set<string>();
  const instructorIds = new Set<string>();
  const corredores = new Set<string>(corredoresBase.filter(Boolean));
  const sites = new Set<string>();
  const modos = new Set<string>();

  for (const r of rows) {
    demandsSeen.set(r.demand.id, r.demand);
    const uf = (r.demand.demandState ?? '').trim().toUpperCase();
    if (uf) ufs.add(uf);
    if (r.demand.companyId) companyIds.add(r.demand.companyId);
    if (r.instructorId) instructorIds.add(r.instructorId);
    if (r.demand.corredor) corredores.add(r.demand.corredor);
    if (r.demand.trainingLocal && r.demand.trainingLocal !== 'N/A') sites.add(r.demand.trainingLocal);
    if (r.modoTransporte) modos.add(r.modoTransporte);
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
    corredores: [...corredores].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    sites: [...sites].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    statusMedicao: MEDICAO_STATUS_OPTIONS,
    modosTransporte: [...modos]
      .map(value => ({ value, label: transportLabel(value) || value }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  };
}
