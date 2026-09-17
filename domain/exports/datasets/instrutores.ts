/**
 * DATASET INSTRUTORES — uma linha por PESSOA × DEMANDA (vínculo)
 *
 * A Agenda (components/CalendarView.tsx) desenha um card por (pessoa, dia) a
 * partir de três fontes: `instructor_allocations` (titular), `companion_allocations`
 * (acompanhante de cliente) e `demand_participants` (participante de interna).
 * Essa expansão vive dentro do useMemo da tela e não é reaproveitável; o que
 * é reaproveitável, e é usado aqui, são as regras do domínio:
 *
 *   • TITULAR — `resolveDemandInstructors`: as linhas de instructor_allocations
 *     da demanda, com fallback para `demands.instructor_id` quando não há
 *     nenhuma (vínculo 'principal', que acompanha a demanda inteira);
 *   • ACOMPANHANTE — `companion_allocations` (só demanda de cliente), uma
 *     linha por dia no banco → aqui UMA linha por pessoa, com a união dos dias;
 *   • PARTICIPANTE — `demand_participants` (só demanda interna), idem
 *     (decisão 17/09/2026: o terceiro papel entra);
 *   • DIAS — `assignmentDays` (domain/personScheduleConflict.ts): os dias do
 *     vínculo interseccionados com os dias reais da demanda; sem período
 *     próprio, todos os dias da demanda. É o mesmo cálculo que a checagem de
 *     conflito de agenda usa. Quem é titular não repete como acompanhante ou
 *     participante da mesma demanda (a mesma regra de `resolveMeasurementPeople`).
 *
 * "Dias no período" recorta esses dias pelo período do FILTRO (data de
 * início/fim da tela): a linha da demanda entra por interseção, como nos
 * outros datasets, e a coluna diz quantos dos dias caem dentro do intervalo.
 * "Total de dias do instrutor no período" (desligada) é o nº de DIAS DISTINTOS
 * da pessoa no período em todas as demandas não canceladas da carga — um fato
 * da pessoa, que não muda com os outros filtros da tela. Dois vínculos no
 * mesmo dia contam um dia.
 *
 * SEM DADO SENSÍVEL, POR CONSTRUÇÃO: a fonte só recebe id, nome e UF de
 * residência do instrutor (`ExportSourceData.instructors`); nada de CPF,
 * e-mail, endereço, observações, tarifa ou valor. O smoke prende isso no tipo,
 * na fonte deste arquivo e nas colunas.
 *
 * Híbrida: os dias são os do VÍNCULO (alocação/participação), não só os da
 * prática que a Agenda destaca — o dataset descreve a alocação, não o card.
 */
import type {
  Demand,
  DemandStatus,
  Training,
  InstructorAllocation,
  DemandParticipant,
  CompanionAllocation,
} from '../../../types';
import type { MeasurementRole } from '../../measurementTotals';
import { resolveDemandInstructors } from '../../demandInstructors';
import { assignmentDays } from '../../personScheduleConflict';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, getDemandCategoria, isInternalDemand } from '../../demandLabel';
import {
  resolveCalculatedStatus,
  resolveCompanyLabel,
  resolveModalityLabel,
  statusLabel,
  tipoLabel,
  toBrDate,
  formatDiasList,
} from '../shared';
import { PAPEL_LABELS } from '../filters';
import { DEFAULT_OPTIONS, type ExportOptions } from '../options';
import type { CellValue, ColumnDef, DatasetDef, FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

/** Só o que este dataset pode saber de um instrutor. Sem CPF, e-mail, endereço, tarifa. */
export interface InstrutorPublico {
  id: string;
  name: string;
  /** `instructors.residence_location` — a UF de residência, a mesma da recomendação por estado. */
  uf?: string;
}

export interface InstrutoresSource {
  demands: Demand[];
  trainings: Training[];
  instructors: InstrutorPublico[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  participants: DemandParticipant[];
  companions: CompanionAllocation[];
  regionNameById?: Map<string, string>;
  now?: Date;
  options?: ExportOptions;
  /** Período do filtro da tela ('YYYY-MM-DD' ou ''). Ausente/vazio = sem recorte. */
  periodo?: { dataInicio: string; dataFim: string };
}

/* ─────────────────────────────── linha ─────────────────────────────── */

export type VinculoInstrutor = 'alocacao' | 'principal' | 'acompanhante' | 'participante';

export interface InstrutorRow extends FilterableRow {
  demand: Demand;
  instructorId: string;
  instructorName: string;
  instructorUf: string;
  papel: MeasurementRole;
  vinculo: VinculoInstrutor;

  empresa: string;
  titulo: string;
  categoria: string;
  tipo: string;
  modalidade: string;
  statusCalculado: DemandStatus;
  uf: string;
  regiao: string;

  /** Dias reais do vínculo ('YYYY-MM-DD', ordenados). */
  dias: string[];
  /** Os de `dias` dentro do período do filtro (todos, sem período). */
  diasNoPeriodo: string[];
  /** Carga do treinamento (cliente) ou horas previstas (interna); null sem cadastro. */
  cargaHoraria: number | null;
  /** Dias distintos da pessoa no período, em todas as demandas não canceladas. */
  totalDiasInstrutorPeriodo: number;
}

/* ─────────────────────────── construção ─────────────────────────── */

const noPeriodo = (dias: string[], p?: { dataInicio: string; dataFim: string }) => {
  if (!p || (!p.dataInicio && !p.dataFim)) return dias;
  return dias.filter(d => (!p.dataInicio || d >= p.dataInicio) && (!p.dataFim || d <= p.dataFim));
};

export function buildInstrutoresRows(src: InstrutoresSource): InstrutorRow[] {
  const now = src.now ?? new Date();
  const opts = src.options ?? DEFAULT_OPTIONS;
  const trainingsById = buildTrainingsById(src.trainings);
  const instructorById = new Map(src.instructors.map(i => [i.id, i]));
  const nameOf = (id: string) => instructorById.get(id)?.name ?? `Instrutor ${id}`;
  const ufOf = (id: string) => (instructorById.get(id)?.uf ?? '').trim().toUpperCase();

  const participantsByDemand = new Map<string, DemandParticipant[]>();
  for (const p of src.participants) {
    const l = participantsByDemand.get(p.demandId) ?? [];
    l.push(p);
    participantsByDemand.set(p.demandId, l);
  }
  const companionsByDemand = new Map<string, CompanionAllocation[]>();
  for (const c of src.companions) {
    const l = companionsByDemand.get(c.demandId) ?? [];
    l.push(c);
    companionsByDemand.set(c.demandId, l);
  }

  const rows: InstrutorRow[] = [];

  for (const demand of src.demands) {
    const training = trainingsById.get(String(demand.trainingId)) as Training | undefined;
    const interna = isInternalDemand(demand);
    const base = {
      demand,
      empresa: resolveCompanyLabel(demand, src.companies),
      titulo: getDemandTitle(demand, src.trainings as any, '—'),
      categoria: getDemandCategoria(demand),
      tipo: tipoLabel(demand),
      modalidade: resolveModalityLabel(demand, trainingsById),
      statusCalculado: resolveCalculatedStatus(demand, trainingsById, now),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      regiao: src.regionNameById?.get(demand.regionId) ?? demand.regionId ?? '',
      cargaHoraria: interna
        ? (Number(demand.horasPrevistas) > 0 ? Number(demand.horasPrevistas) : null)
        : (typeof training?.hours === 'number' && training.hours > 0 ? training.hours : null),
    };
    const push = (instructorId: string, papel: MeasurementRole, vinculo: VinculoInstrutor, dias: string[]) =>
      rows.push({
        ...base,
        instructorId,
        instructorName: nameOf(instructorId),
        instructorUf: ufOf(instructorId),
        papel,
        vinculo,
        dias,
        diasNoPeriodo: noPeriodo(dias, src.periodo),
        totalDiasInstrutorPeriodo: 0, // preenchido abaixo, depois de todas as linhas
      });

    // Titulares: uma linha por pessoa, união dos dias das alocações dela.
    const titulares = new Map<string, { dias: Set<string>; vinculo: VinculoInstrutor }>();
    for (const e of resolveDemandInstructors(demand.id, demand.instructorId, src.instructorAllocations)) {
      const dias = assignmentDays({ demandId: demand.id, startDate: e.startDate, endDate: e.endDate }, demand);
      const t = titulares.get(e.instructorId) ?? { dias: new Set<string>(), vinculo: e.source === 'principal' ? 'principal' : 'alocacao' };
      for (const d of dias) t.dias.add(d);
      titulares.set(e.instructorId, t);
    }
    for (const [id, t] of titulares) push(id, 'TITULAR', t.vinculo, [...t.dias].sort());

    // Segunda categoria: participante (interna) ou acompanhante (cliente), sem repetir titular.
    const segunda: { rows: { instructorId: string; startDate?: string | null; endDate?: string | null }[]; papel: MeasurementRole; vinculo: VinculoInstrutor } = interna
      ? { rows: participantsByDemand.get(demand.id) ?? [], papel: 'PARTICIPANTE', vinculo: 'participante' }
      : { rows: companionsByDemand.get(demand.id) ?? [], papel: 'ACOMPANHANTE', vinculo: 'acompanhante' };
    const outros = new Map<string, Set<string>>();
    for (const r of segunda.rows) {
      if (!r.instructorId || titulares.has(r.instructorId)) continue;
      const dias = assignmentDays({ demandId: demand.id, startDate: r.startDate, endDate: r.endDate }, demand);
      const s = outros.get(r.instructorId) ?? new Set<string>();
      for (const d of dias) s.add(d);
      outros.set(r.instructorId, s);
    }
    for (const [id, s] of outros) push(id, segunda.papel, segunda.vinculo, [...s].sort());
  }

  // Total por pessoa: dias distintos no período, demandas não canceladas (salvo opção).
  const porPessoa = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!opts.incluirCanceladas && r.statusCalculado === 'CANCELADA') continue;
    const s = porPessoa.get(r.instructorId) ?? new Set<string>();
    for (const d of r.diasNoPeriodo) s.add(d);
    porPessoa.set(r.instructorId, s);
  }
  for (const r of rows) r.totalDiasInstrutorPeriodo = porPessoa.get(r.instructorId)?.size ?? 0;

  const ordemPapel: Record<MeasurementRole, number> = { TITULAR: 0, PARTICIPANTE: 1, ACOMPANHANTE: 2 };
  rows.sort(
    (a, b) =>
      a.instructorName.localeCompare(b.instructorName, 'pt-BR') ||
      (a.dias[0] ?? '').localeCompare(b.dias[0] ?? '') ||
      a.demand.id.localeCompare(b.demand.id) ||
      ordemPapel[a.papel] - ordemPapel[b.papel]
  );
  return rows;
}

/* ─────────────────────────────── colunas ─────────────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<InstrutorRow>['kind'],
  defaultOn: boolean,
  get: (r: InstrutorRow) => CellValue,
  extra: Partial<Pick<ColumnDef<InstrutorRow>, 'width' | 'help'>> = {}
): ColumnDef<InstrutorRow> => ({ key, header, kind, defaultOn, get, ...extra });

const VINCULO_LABELS: Record<VinculoInstrutor, string> = {
  alocacao: 'Alocação (instructor_allocations)',
  principal: 'Instrutor principal da demanda',
  acompanhante: 'Acompanhante (companion_allocations)',
  participante: 'Participante (demand_participants)',
};

export const INSTRUTORES_COLUMNS: ColumnDef<InstrutorRow>[] = [
  col('instrutor', 'Instrutor', 'text', true, r => r.instructorName, { width: 28 }),
  col('papel', 'Papel', 'text', true, r => PAPEL_LABELS[r.papel] ?? r.papel, { width: 14, help: 'Titular, Participante (interna) ou Acompanhante (cliente).' }),
  col('instrutorUf', 'UF do instrutor', 'text', true, r => r.instructorUf, { width: 8, help: 'UF de residência do cadastro — a mesma da recomendação por estado.' }),
  col('vinculo', 'Vínculo', 'text', false, r => VINCULO_LABELS[r.vinculo], { width: 30 }),

  col('demandId', 'Demanda', 'text', true, r => r.demand.id, { width: 12 }),
  col('clientDemandId', 'ID Cliente', 'text', false, r => r.demand.clientDemandId ?? '', { width: 14 }),
  col('tipo', 'Tipo', 'text', true, r => r.tipo, { width: 10 }),
  col('empresa', 'Empresa', 'text', true, r => r.empresa, { width: 30 }),
  col('titulo', 'Treinamento / Descrição', 'text', true, r => r.titulo, { width: 40 }),
  col('categoria', 'Categoria (interna)', 'text', false, r => r.categoria, { width: 18 }),
  col('modalidade', 'Modalidade', 'text', false, r => r.modalidade, { width: 16 }),
  col('status', 'Status (calculado)', 'text', true, r => statusLabel(r.statusCalculado), { width: 16 }),
  col('dataInicio', 'Data início', 'date', true, r => toBrDate(r.demand.startDate), { width: 12 }),
  col('dataFim', 'Data fim', 'date', true, r => toBrDate(r.demand.endDate), { width: 12 }),
  col('local', 'Local', 'text', true, r => r.demand.trainingLocal ?? '', { width: 22 }),
  col('corredor', 'Corredor', 'text', false, r => r.demand.corredor ?? '', { width: 16 }),
  col('uf', 'UF (demanda)', 'text', true, r => r.uf, { width: 8 }),
  col('regiao', 'Região', 'text', false, r => r.regiao, { width: 16 }),

  col('diasVinculo', 'Dias do vínculo', 'text', false, r => formatDiasList(r.dias), { width: 26, help: 'Dias reais em que a pessoa está na demanda (vínculo ∩ dias da demanda).' }),
  col('nDias', 'Nº de dias do vínculo', 'number', false, r => r.dias.length, { width: 8 }),
  col('diasNoPeriodo', 'Dias no período', 'text', false, r => formatDiasList(r.diasNoPeriodo), { width: 26 }),
  col('nDiasNoPeriodo', 'Dias alocados no período', 'number', true, r => r.diasNoPeriodo.length, { width: 10, help: 'Dos dias do vínculo, quantos caem dentro do período filtrado. Sem período, todos.' }),
  col('cargaHoraria', 'Carga do treinamento', 'hours', true, r => r.cargaHoraria, { width: 10, help: 'Cliente: horas do treinamento. Interna: horas previstas. Não é rateio nem pagamento.' }),
  col('totalDiasInstrutorPeriodo', 'Total de dias do instrutor no período', 'number', false, r => r.totalDiasInstrutorPeriodo, { width: 12, help: 'Dias distintos da pessoa no período em todas as demandas não canceladas da carga — independe dos outros filtros da tela. Dois vínculos no mesmo dia contam um.' }),
];

export const INSTRUTORES_DATASET: DatasetDef<InstrutorRow> = {
  key: 'instrutores',
  label: 'Instrutores',
  description: 'Uma linha por pessoa em cada demanda (titular, participante de interna, acompanhante): dias alocados no período e carga do treinamento. Sem valores.',
  requiredView: 'calendar',
  filters: ['periodo', 'instrutor', 'papel', 'uf', 'cliente'],
  options: ['incluirCanceladas'],
  columns: INSTRUTORES_COLUMNS,
  fileBase: 'instrutores',
};
