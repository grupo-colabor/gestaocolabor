/**
 * DATASET MEDIÇÃO POR TEMPLATE (Vale) — uma linha por DEMANDA
 *
 * Alimenta a aba "Turmas Realizadas" do template da empresa (templates/vale.ts)
 * e o painel de pendências. Regras aprovadas na Etapa 2:
 *
 *   • Entram as demandas de CLIENTE cuja empresa casa com o template (a Vale
 *     por nome, como o formulário faz em Demands.tsx `isValeSelected`).
 *     Interna com empresa Vale entra na lista com BLOQUEIO, para o painel
 *     avisar, e nunca na aba Turmas.
 *   • Só as CONCLUÍDAS (status calculado) viram linha da aba; cancelada e
 *     sem instrutor titular são bloqueios de fato. Status da medição NÃO
 *     bloqueia — é filtro na tela (multi-seleção, com "Sem medição").
 *   • DESPESAS: os quatro buckets do painel (`computePanelExpenseBreakdown`)
 *     restritos aos itens REEMBOLSÁVEIS (`!isNaoReembolsavel`), porque as
 *     colunas do modelo se chamam "Despesa reembolsável" e a flag existe
 *     justamente para o que o cliente não paga. O que foi excluído fica em
 *     `naoReembolsavelExcluido`, para o painel avisar. Órfãos de Outros fora,
 *     como no painel. Combustível não é inferido: coluna manual do template.
 *   • DATA = primeiro dia; HORÁRIO = hora de parede do primeiro dia
 *     (getDayHorarioInicio); CARGA = training.hours, inclusive híbrida. A
 *     coluna "Data" da planilha continua sendo a de INÍCIO — o que mudou em
 *     23/09/2026 foi só o critério de seleção do período (ver abaixo).
 *   • CONSULTOR = titulares do rateio (`resolveDemandInstructors`), nomes
 *     unidos por " / " quando a demanda foi dividida.
 *
 * O período (data de TÉRMINO da turma dentro do intervalo), corredor, site,
 * status da medição e canceladas são FILTROS aplicados pela tela (filters.ts),
 * não aqui.
 *
 * REGRA DO PERÍODO (Micaelle, 23/09/2026): a turma entra na medição do mês em
 * que TERMINA, mesmo que tenha começado antes. O caso que mostrou isso foi a
 * DEM-1418 (dias 19, 20, 21 e 25/08), que sumia da medição 20/08–21/09 porque
 * o critério antigo olhava a data de início. A garantia que motivou o critério
 * antigo continua de pé: cada turma tem UMA data de fim, então cai em
 * exatamente uma medição — nunca em duas.
 */
import type {
  Demand,
  DemandStatus,
  Measurement,
  Training,
  InstructorAllocation,
} from '../../../types';
import { computePanelExpenseBreakdown, isNaoReembolsavel } from '../../measurementTotals';
import { resolveDemandInstructors } from '../../demandInstructors';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, isInternalDemand } from '../../demandLabel';
import { getDemandDays, getDayHorarioInicio, getDemandLastDay } from '../../demandDays';
import { resolveCalculatedStatus, resolveCompanyLabel, statusLabel } from '../shared';
import { DEFAULT_OPTIONS, type ExportOptions } from '../options';
import { TITULARES_SEPARATOR, type TemplateRowInput } from '../templates/sourceFields';
import type { ManualRefs, RowsSheetInput } from '../templates/resolve';
import type { MeasurementTemplate, TemplateCompanyMatch } from '../templates/types';
import type { TemplateValuesIndex } from '../templates/values';
import type { FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

export interface MedicaoValeSource {
  template: MeasurementTemplate;
  demands: Demand[];
  measurements: Measurement[];
  trainings: Training[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  templateValues: TemplateValuesIndex;
  regionNameById?: Map<string, string>;
  now?: Date;
  options?: ExportOptions;
}

/* ─────────────────────────────── linha ─────────────────────────────── */

export interface MedicaoValeRow extends FilterableRow {
  demand: Demand;
  measurement?: Measurement;
  /** O que o template lê (SOURCE_FIELDS). */
  input: TemplateRowInput;
  /** Referências para os valores manuais (preço por treinamento / por demanda). */
  refs: ManualRefs;
  companyName: string;
  trainingId: string;
  /**
   * Último dia REAL da turma — é por ele que o filtro de período escolhe a
   * medição (`periodoFim` em filters.ts). Em dias específicos pode ser
   * diferente do campo de data fim, por isso vem de `getDemandLastDay`.
   */
  ultimoDia: string;
  titularIds: string[];
  statusCalculado: DemandStatus;
  cancelada: boolean;
  interna: boolean;
  medicaoStatus: string;
  /** Todas as despesas (reembolsáveis ou não), como o painel mostra. */
  despesasTotalTodas: number;
  /** O que ficou fora das colunas da Vale por estar marcado como não reembolsável. */
  naoReembolsavelExcluido: number;
  itensDespesa: number;
  /** Fatos que tiram a demanda da aba Turmas. Vazio = elegível. */
  bloqueios: string[];
  elegivelTurmas: boolean;
}

/* ─────────────────────────── empresa do template ─────────────────────────── */

export function matchesTemplateCompany(
  match: TemplateCompanyMatch,
  company: { id: string; name: string } | undefined
): boolean {
  if (!company) return false;
  if (match.id) return company.id === match.id;
  if (match.nameIncludes) return company.name.toUpperCase().includes(match.nameIncludes.toUpperCase());
  return false;
}

/* ─────────────────────────── construção ─────────────────────────── */

export function buildMedicaoValeRows(src: MedicaoValeSource): MedicaoValeRow[] {
  const now = src.now ?? new Date();
  void (src.options ?? DEFAULT_OPTIONS); // canceladas e demais opções agem no filtro, não aqui
  const trainingsById = buildTrainingsById(src.trainings);
  const companiesById = new Map(src.companies.map(c => [c.id, c]));
  const measurementByDemand = new Map(src.measurements.map(m => [m.demandId, m]));
  const nameOf = (id: string) => src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`;

  const rows: MedicaoValeRow[] = [];

  for (const demand of src.demands) {
    const company = demand.companyId ? companiesById.get(demand.companyId) : undefined;
    if (!matchesTemplateCompany(src.template.company, company)) continue;

    const interna = isInternalDemand(demand);
    const training = trainingsById.get(String(demand.trainingId)) as Training | undefined;
    const statusCalculado = resolveCalculatedStatus(demand, trainingsById, now);
    const cancelada = statusCalculado === 'CANCELADA';
    const m = measurementByDemand.get(demand.id);

    const titularIds = [
      ...new Set(
        resolveDemandInstructors(demand.id, demand.instructorId, src.instructorAllocations).map(t => t.instructorId)
      ),
    ];

    // Despesas reembolsáveis (colunas da Vale) e o total cheio (painel), para o aviso.
    const reembolsaveis = computePanelExpenseBreakdown(m as any, { itemFilter: a => !isNaoReembolsavel(a) });
    const todas = computePanelExpenseBreakdown(m as any);

    const dias = getDemandDays(demand);
    const primeiroDia = dias[0] ?? String(demand.startDate ?? '').slice(0, 10);
    const cargaHoraria = interna
      ? Number(demand.horasPrevistas) > 0 ? Number(demand.horasPrevistas) : null
      : typeof training?.hours === 'number' && training.hours > 0 ? training.hours : null;

    const bloqueios: string[] = [];
    if (interna) bloqueios.push('Demanda interna com empresa Vale — não entra na medição da Vale');
    if (cancelada) bloqueios.push('Demanda cancelada');
    else if (statusCalculado !== 'CONCLUIDA') bloqueios.push(`Demanda não concluída (${statusLabel(statusCalculado)})`);
    if (titularIds.length === 0) bloqueios.push('Sem instrutor titular');

    const input: TemplateRowInput = {
      demandId: demand.id,
      clientDemandId: (demand.clientDemandId ?? '').trim(),
      companyName: resolveCompanyLabel(demand, src.companies),
      trainingId: String(demand.trainingId ?? ''),
      trainingName: getDemandTitle(demand, src.trainings as any, '—'),
      cargaHoraria,
      local: (demand.trainingLocal ?? '').trim(),
      corredor: demand.corredor ?? '',
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      dataInicio: primeiroDia,
      horarioInicio: getDayHorarioInicio(demand, primeiroDia),
      nDias: dias.length,
      statusCalculado,
      titulares: titularIds.map(nameOf),
      despesas: {
        locomocao: reembolsaveis.locomocao,
        alimentacao: reembolsaveis.alimentacao,
        hospedagem: reembolsaveis.hospedagem,
        outros: reembolsaveis.outros,
        total: reembolsaveis.total,
      },
      medicaoStatus: m?.status ?? '',
      temMedicao: !!m,
    };

    rows.push({
      demand,
      measurement: m,
      input,
      refs: { trainingId: input.trainingId, demandId: demand.id },
      companyName: input.companyName,
      trainingId: input.trainingId,
      ultimoDia: getDemandLastDay(demand),
      titularIds,
      statusCalculado,
      cancelada,
      interna,
      medicaoStatus: m?.status ?? '',
      despesasTotalTodas: todas.total,
      naoReembolsavelExcluido: Math.round((todas.total - reembolsaveis.total + Number.EPSILON) * 100) / 100,
      itensDespesa: todas.itens,
      bloqueios,
      elegivelTurmas: bloqueios.length === 0,
    });
  }

  // Ordem da planilha: data de início crescente, depois id — a Vale lê o mês em ordem.
  rows.sort(
    (a, b) => a.input.dataInicio.localeCompare(b.input.dataInicio) || a.demand.id.localeCompare(b.demand.id)
  );
  return rows;
}

/* ──────────────── turmas que vieram do período anterior ──────────────── */

/**
 * As turmas do recorte que COMEÇARAM antes do início do período e terminam
 * dentro dele. Não é defeito nem bloqueio: é o efeito esperado da regra de
 * seleção pela data de término. A tela mostra como aviso informativo para
 * quem compara com a medição do mês passado entender por que a turma está
 * aqui — e não some sem explicação.
 */
export function turmasComecaramAntes(rows: MedicaoValeRow[], dataInicio?: string): MedicaoValeRow[] {
  if (!dataInicio) return [];
  return rows.filter(r => r.input.dataInicio && r.input.dataInicio < dataInicio);
}

/** "dd/mm" — o formato curto que os avisos de período usam. */
const diaMes = (iso: string): string => {
  const [a, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : String(iso ?? '');
};

/** O aviso da barra: uma linha para todas as turmas herdadas do mês anterior. */
export function avisoComecaramAntes(quantas: number, dataInicio: string): string {
  return `${quantas} turma(s) começaram antes de ${diaMes(dataInicio)} e terminam neste período — entram nesta medição`;
}

/** O mesmo fato, na linha da turma no painel de pendências. */
export function avisoTurmaComecouAntes(row: MedicaoValeRow): string {
  return `Começou em ${diaMes(row.input.dataInicio)}, antes do início do período — entra nesta medição porque termina em ${diaMes(row.ultimoDia)}`;
}

/** As linhas que entram na aba de turmas, no formato do resolvedor. */
export function toRowsSheetInput(rows: MedicaoValeRow[]): RowsSheetInput[] {
  return rows.filter(r => r.elegivelTurmas).map(r => ({ input: r.input, refs: r.refs }));
}

export { TITULARES_SEPARATOR };
