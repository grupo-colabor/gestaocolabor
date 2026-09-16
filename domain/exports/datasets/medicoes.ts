/**
 * DATASET MEDIÇÕES — uma linha por PESSOA × DEMANDA
 *
 * Escopo: demandas que TÊM linha em `measurements`, em qualquer status
 * (inclusive NAO_INICIADA). Demanda sem medição aberta só aparece no dataset
 * de Demandas.
 *
 * Nada aqui recalcula: cada número vem de uma função do domínio que já
 * alimenta o painel, o Dashboard ou o Excel de pagamento. O que este arquivo
 * faz é MONTAR a linha e ROTULAR a origem — e, como o app tem mais de uma
 * resolução para "horas" (measurementTotals.ts, seção "DUAS resoluções do
 * mesmo ausente"), a linha carrega as três, cada uma com o nome do lugar de
 * onde veio:
 *
 *   • Horas informadas  — o que está gravado no bloco (ou em `classHours`, na
 *                         v1). Em branco = ninguém digitou.
 *   • Horas painel      — `blockPanelHours` com o MESMO contexto da tela
 *                         (carga padrão do painel; híbrida sem default).
 *   • Horas pagamento   — a linha que o Excel de pagamento imprimiria para
 *                         (demanda, pessoa): rateio de `instructor_allocations`
 *                         com o override do bloco (`applyMeasurementOverrides`),
 *                         restrita às demandas elegíveis (CONCLUÍDA calculada).
 *                         EM BRANCO quando o Excel não geraria linha — nunca 0.
 *
 * Sem recorte de período aqui: `Horas pagamento` é a carga cheia da pessoa na
 * demanda (a planilha mensal rateia pelos dias dentro do mês; este export não).
 *
 * PESSOAS: `resolveMeasurementPeople` (titulares do rateio + participantes ou
 * acompanhantes). O caminho v1/v2 dos blocos espelha o painel:
 *   • medição COM `participantes`, ou demanda com segunda categoria de pessoa
 *     → um bloco por pessoa da lista (gravado ?? bloco vazio), como
 *       `secoesPorPessoa` em Measurement.tsx;
 *   • senão → v1: UM bloco de titular (`demands.instructor_id`) com todos os
 *     anexos. Um segundo titular do rateio (cliente dividido por dias) ganha
 *     linha própria com as horas de pagamento dele, mas sem bloco: o painel
 *     atribui hora/aula e despesas da v1 a um titular só, e a soma por medição
 *     tem que continuar fechando com `computeMeasurementTotals`.
 *
 * DESPESAS por pessoa: os quatro buckets do painel (`blockExpenseBreakdown`);
 * `Não reembolsável` é um RECORTE (o item continua no total — regra de
 * measurementTotals.ts), então `Total despesas` inclui os marcados e
 * `Despesas reembolsáveis` = total − não reembolsável. `Total geral` =
 * hora/aula painel + total despesas, a composição do card "Custo das Demandas
 * Internas" do Dashboard.
 */
import type {
  Demand,
  DemandStatus,
  Measurement,
  Training,
  InstructorAllocation,
  DemandParticipant,
  CompanionAllocation,
} from '../../../types';
import {
  normalizeMeasurementBlocks,
  blockPanelHours,
  blockHoraAula,
  blockExpenseBreakdown,
  computePanelExpenseBreakdown,
  isNaoReembolsavel,
  parseExpenseValue,
  type MeasurementPersonBlock,
  type MeasurementRole,
  type PanelExpenseBreakdown,
  type TotalizableMeasurement,
} from '../../measurementTotals';
import { computeInstructorHoursByDemand, eligibleDemandIdsForPayment } from '../../instructorHours';
import { applyMeasurementOverrides, type HoursRowLike } from '../../measurementOverrides';
import { resolveMeasurementPeople, type MeasurementPerson } from '../../measurementPeople';
import { panelDefaultHours } from '../../demandDefaultHours';
import { isHybridModality } from '../../modalityRules';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, getDemandCategoria, isInternalDemand } from '../../demandLabel';
import {
  resolveCalculatedStatus,
  resolveCompanyLabel,
  resolveModalityLabel,
  resolveNoturno,
  statusLabel,
  tipoLabel,
  toBrDate,
  formatDiasList,
  demandDayCount,
  round2,
} from '../shared';
import { PAPEL_LABELS } from '../filters';
import { DEFAULT_OPTIONS, type ExportOptions } from '../options';
import type { CellValue, ColumnDef, DatasetDef, FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

export interface MedicoesSource {
  demands: Demand[];
  measurements: Measurement[];
  trainings: Training[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  participants: DemandParticipant[];
  companions: CompanionAllocation[];
  /** `regions` do contexto: id -> nome. Ausente = imprime o id. */
  regionNameById?: Map<string, string>;
  /** Injetável para o smoke fixar "hoje" no status calculado. */
  now?: Date;
  /** Opções marcáveis (options.ts). Ausente = defaults. */
  options?: ExportOptions;
}

/* ─────────────────────────────── linha ─────────────────────────────── */

/**
 * De onde vem o Valor HH da linha — ou por que está em branco/zero.
 *
 * A Colabor ainda não preenche o HH da medição, então um R$ 0,00 de hora/aula
 * costuma ser "ninguém digitou", não "vale zero". `normalizeMeasurementBlocks`
 * devolve 0 nos dois casos (parseExpenseValue), por isso o dataset olha o JSON
 * cru ao lado do bloco, com a mesma regra de "ausente" do domínio (undefined,
 * null ou string vazia — 0 NÃO é ausente).
 */
export type OrigemTarifa =
  | 'Tarifa da medição'
  | 'Tarifa zero (digitada)'
  | 'Sem tarifa na medição'
  | 'Tarifa da medição desativada';

const tarifaNaoInformada = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export type OrigemHoras =
  | 'Informada na medição'
  | 'Rateio da alocação'
  | 'Rateio da alocação (dividida)'
  | 'Horas previstas da demanda (participante)'
  | 'Não elegível: demanda não concluída'
  | 'Não elegível: sem dias na demanda'
  | 'Acompanhante sem horas informadas'
  | 'Sem alocação em instructor_allocations'
  | 'Sem horas de pagamento (> 0)';

export interface MedicaoRow extends FilterableRow {
  demand: Demand;
  measurement: Measurement;
  instructorId: string;
  instructorName: string;
  papel: MeasurementRole;
  vinculo: MeasurementPerson['vinculo'] | 'sem-pessoa';
  /** A 5ª chave da aba Tarifas: só ACOMPANHANTE se separa. */
  papelTarifa: 'Titular' | 'Acompanhante';

  empresa: string;
  titulo: string;
  categoria: string;
  tipo: string;
  modalidade: string;
  hibrida: boolean;
  statusCalculado: DemandStatus;
  uf: string;
  regiao: string;
  local: string;
  noturno: boolean;
  nDiasDemanda: number;

  /** `null` = o painel não atribui bloco a esta pessoa (segundo titular da v1). */
  temBloco: boolean;
  horasInformadas: number | null;
  horasPainel: number | null;
  horasPagamento: number | null;
  elegivelPagamento: boolean;
  origemHoras: OrigemHoras | string;
  diasPagamento: string;

  /** `null` também quando a opção usarValorHH está desligada. */
  valorHH: number | null;
  /** '' quando a pessoa não tem bloco no painel. */
  origemTarifa: OrigemTarifa | '';
  horaAulaPainel: number | null;
  /** Horas pagamento × valorHH da medição. O Excel usa a aba Tarifas, não este valor. */
  horaAulaPagamento: number | null;

  despesas: PanelExpenseBreakdown;
  naoReembolsavel: number;
  despesasReembolsaveis: number;
  /** `null` quando usarValorHH está desligada: sem hora/aula não há total. */
  totalGeral: number | null;

  medicaoStatus: string;
  medicaoAtualizadaEm: string;
}

/* ─────────────────────────── construção ─────────────────────────── */

const chave = (demandId: string, instructorId: string) => `${demandId} ${instructorId}`;

const zeroBreakdown = (): PanelExpenseBreakdown => ({
  hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0, total: 0, itens: 0, itensOrfaos: 0,
});

export function buildMedicoesRows(src: MedicoesSource): MedicaoRow[] {
  const now = src.now ?? new Date();
  const opts = src.options ?? DEFAULT_OPTIONS;
  const trainingsById = buildTrainingsById(src.trainings);
  const demandsById = new Map(src.demands.map(d => [d.id, d]));
  const instructorName = (id: string) =>
    id ? (src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`) : '(sem instrutor)';

  // Pagamento: exatamente o caminho do Excel (sem recorte de período).
  const rateio = computeInstructorHoursByDemand({
    demands: src.demands,
    instructorAllocations: src.instructorAllocations,
    trainings: src.trainings,
    measurements: src.measurements,
  });
  const elegiveis = eligibleDemandIdsForPayment({ demands: src.demands, trainings: src.trainings });
  const pagamento = applyMeasurementOverrides({
    rows: rateio,
    measurements: src.measurements as any,
    demands: src.demands as any,
    participants: src.participants.map(p => ({
      demandId: p.demandId, instructorId: p.instructorId, startDate: p.startDate, endDate: p.endDate,
    })),
    companions: src.companions.map(c => ({
      demandId: c.demandId, instructorId: c.instructorId, startDate: c.startDate,
    })),
    eligibleDemandIds: elegiveis,
  });
  const rateioPorChave = new Map(rateio.map(r => [chave(r.demandId, r.instructorId), r]));
  const pagamentoPorChave = new Map<string, HoursRowLike>(
    pagamento.map(r => [chave(r.demandId, r.instructorId), r])
  );

  const rows: MedicaoRow[] = [];

  for (const m of src.measurements) {
    const demand = demandsById.get(m.demandId);
    if (!demand) continue; // medição órfã: sem demanda não há linha a montar

    const training = trainingsById.get(String(demand.trainingId));
    const interna = isInternalDemand(demand);
    const hibrida = !interna && isHybridModality((training as Training | undefined)?.modality ?? demand.modality);
    const classHours = parseExpenseValue(m.expenses?.classHours as any);
    const ctx = {
      demandDefaultHours: classHours > 0 ? classHours : panelDefaultHours(demand, training as Training | undefined),
      hibrida,
    };

    const pessoas = resolveMeasurementPeople(demand, src.instructorAllocations, src.participants, src.companions);
    const temSegundaCategoria = pessoas.some(p => p.papel !== 'TITULAR');
    const gravados = m.expenses?.participantes ?? [];
    const titularId = demand.instructorId || pessoas.find(p => p.papel === 'TITULAR')?.instructorId || '';

    // Caminho v2 (o do painel) ou v1 — ver cabeçalho.
    const v2 = gravados.length > 0 || temSegundaCategoria;
    const paraNormalizar: TotalizableMeasurement = v2
      ? {
          ...(m as any),
          expenses: {
            ...(m.expenses as any),
            participantes: pessoas.map(p => {
              const g = gravados.find(x => x.instructorId === p.instructorId);
              return g ?? { instructorId: p.instructorId, papel: p.papel };
            }),
          },
        }
      : (m as any);
    const blocos = normalizeMeasurementBlocks(paraNormalizar, titularId);
    const blocoDe = (instructorId: string): MeasurementPersonBlock | undefined =>
      v2
        ? blocos.find(b => b.instructorId === instructorId)
        : blocos[0]?.instructorId === instructorId || (!blocos[0]?.instructorId && !instructorId)
          ? blocos[0]
          : undefined;

    const base = {
      demand,
      measurement: m,
      empresa: resolveCompanyLabel(demand, src.companies),
      titulo: getDemandTitle(demand, src.trainings as any, '—'),
      categoria: getDemandCategoria(demand),
      tipo: tipoLabel(demand),
      modalidade: resolveModalityLabel(demand, trainingsById),
      hibrida,
      statusCalculado: resolveCalculatedStatus(demand, trainingsById, now),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      regiao: src.regionNameById?.get(demand.regionId) ?? demand.regionId ?? '',
      local: demand.trainingLocal ?? '',
      noturno: resolveNoturno(demand),
      nDiasDemanda: demandDayCount(demand),
      medicaoStatus: m.status ?? '',
      medicaoAtualizadaEm: toBrDate(m.updatedAt),
    };

    // Sem ninguém no cadastro: a medição ainda existe e as despesas dela
    // precisam sair — uma linha "sem pessoa" com o bloco v1.
    const lista: MeasurementPerson[] = pessoas.length
      ? pessoas
      : [{ instructorId: '', papel: 'TITULAR', vinculo: 'principal' }];

    for (const pessoa of lista) {
      const bloco = blocoDe(pessoa.instructorId);
      // O papel da LISTA manda (o JSON pode ter sido gravado antes de a pessoa
      // mudar de papel) — mesma regra de `secoesPorPessoa`.
      const papel: MeasurementRole = pessoa.papel;
      const blocoComPapel = bloco ? { ...bloco, papel } : undefined;

      const horasPainel = blocoComPapel ? blockPanelHours(blocoComPapel, ctx) : null;

      // Tarifa: o número vem do bloco; o "de onde veio" vem do JSON cru.
      const tarifaCrua = !blocoComPapel
        ? undefined
        : v2
          ? gravados.find(g => g.instructorId === pessoa.instructorId)?.valorHH
          : (m.expenses as any)?.hourRate;
      const origemTarifa: MedicaoRow['origemTarifa'] = !blocoComPapel
        ? ''
        : !opts.usarValorHH
          ? 'Tarifa da medição desativada'
          : tarifaNaoInformada(tarifaCrua)
            ? 'Sem tarifa na medição'
            : blocoComPapel.valorHH === 0
              ? 'Tarifa zero (digitada)'
              : 'Tarifa da medição';
      const usarHH = opts.usarValorHH;
      const horaAulaPainel = blocoComPapel && usarHH ? blockHoraAula(blocoComPapel, ctx) : null;
      const valorHH = blocoComPapel && usarHH ? blocoComPapel.valorHH : null;
      const horasInformadas =
        blocoComPapel && blocoComPapel.horasInformadas && blocoComPapel.horas !== undefined
          ? blocoComPapel.horas
          : null;

      const despesas = blocoComPapel ? blockExpenseBreakdown(paraNormalizar, blocoComPapel) : zeroBreakdown();
      const naoReembolsavel = blocoComPapel
        ? (() => {
            const doBloco = new Set(blocoComPapel.attachments);
            return computePanelExpenseBreakdown(paraNormalizar, {
              itemFilter: a => doBloco.has(a) && isNaoReembolsavel(a),
            }).total;
          })()
        : 0;

      const k = chave(demand.id, pessoa.instructorId);
      const pag = pagamentoPorChave.get(k);
      const doRateio = rateioPorChave.get(k);

      const origemHoras: OrigemHoras = (() => {
        if (pag) {
          if (horasInformadas !== null && v2) return 'Informada na medição';
          if (doRateio) return doRateio.dividida ? 'Rateio da alocação (dividida)' : 'Rateio da alocação';
          return 'Horas previstas da demanda (participante)';
        }
        if (!elegiveis.has(demand.id)) {
          return base.statusCalculado === 'CONCLUIDA'
            ? 'Não elegível: sem dias na demanda'
            : 'Não elegível: demanda não concluída';
        }
        if (papel === 'ACOMPANHANTE') return 'Acompanhante sem horas informadas';
        if (!doRateio && papel === 'TITULAR') return 'Sem alocação em instructor_allocations';
        return 'Sem horas de pagamento (> 0)';
      })();

      const horasPagamento = pag ? round2(pag.horas) : null;

      rows.push({
        ...base,
        instructorId: pessoa.instructorId,
        instructorName: instructorName(pessoa.instructorId),
        papel,
        vinculo: pessoas.length ? pessoa.vinculo : 'sem-pessoa',
        papelTarifa: (pag?.papel ?? papel) === 'ACOMPANHANTE' ? 'Acompanhante' : 'Titular',
        temBloco: !!blocoComPapel,
        horasInformadas,
        horasPainel,
        horasPagamento,
        elegivelPagamento: !!pag,
        origemHoras,
        diasPagamento: pag ? formatDiasList(pag.dias) : '',
        valorHH,
        origemTarifa,
        horaAulaPainel,
        horaAulaPagamento: pag && valorHH !== null ? round2(pag.horas * valorHH) : null,
        despesas,
        naoReembolsavel,
        despesasReembolsaveis: round2(despesas.total - naoReembolsavel),
        // Sem tarifa não há total: em branco, nunca "só as despesas" com cara de total.
        totalGeral: usarHH ? round2((horaAulaPainel ?? 0) + despesas.total) : null,
      });
    }
  }

  rows.sort(
    (a, b) =>
      (b.demand.startDate ?? '').localeCompare(a.demand.startDate ?? '') ||
      a.demand.id.localeCompare(b.demand.id) ||
      a.instructorName.localeCompare(b.instructorName, 'pt-BR')
  );
  return rows;
}

/* ─────────────────────────────── colunas ─────────────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<MedicaoRow>['kind'],
  defaultOn: boolean,
  get: (r: MedicaoRow) => CellValue,
  extra: Partial<Pick<ColumnDef<MedicaoRow>, 'width' | 'help'>> = {}
): ColumnDef<MedicaoRow> => ({ key, header, kind, defaultOn, get, ...extra });

export const MEDICOES_COLUMNS: ColumnDef<MedicaoRow>[] = [
  col('demandId', 'Demanda', 'text', true, r => r.demand.id, { width: 12 }),
  col('clientDemandId', 'ID Cliente', 'text', false, r => r.demand.clientDemandId ?? '', { width: 14 }),
  col('tipo', 'Tipo', 'text', true, r => r.tipo, { width: 10 }),
  col('empresa', 'Empresa', 'text', true, r => r.empresa, { width: 30 }),
  col('titulo', 'Treinamento / Descrição', 'text', true, r => r.titulo, { width: 40 }),
  col('categoria', 'Categoria (interna)', 'text', false, r => r.categoria, { width: 18 }),
  col('modalidade', 'Modalidade', 'text', true, r => r.modalidade, { width: 16, help: 'Resolvida pelo treinamento; a da demanda só vale sem treinamento.' }),
  col('status', 'Status (calculado)', 'text', true, r => statusLabel(r.statusCalculado), { width: 16, help: 'O mesmo status do Dashboard e da lista de demandas, não a coluna crua do banco.' }),
  col('uf', 'UF', 'text', true, r => r.uf, { width: 6 }),
  col('regiao', 'Região', 'text', false, r => r.regiao, { width: 16 }),
  col('local', 'Local', 'text', false, r => r.local, { width: 22 }),
  col('dataInicio', 'Data início', 'date', true, r => toBrDate(r.demand.startDate), { width: 12 }),
  col('dataFim', 'Data fim', 'date', true, r => toBrDate(r.demand.endDate), { width: 12 }),
  col('nDiasDemanda', 'Dias da demanda', 'number', false, r => r.nDiasDemanda, { width: 10 }),
  col('noturno', 'Noturno', 'boolean', false, r => r.noturno, { width: 9, help: 'Fim às 19:00 ou depois, ou turno que vira o dia — a mesma chave da aba Tarifas.' }),

  col('instrutor', 'Pessoa', 'text', true, r => r.instructorName, { width: 28 }),
  col('papel', 'Papel', 'text', true, r => PAPEL_LABELS[r.papel] ?? r.papel, { width: 14 }),
  col('papelTarifa', 'Chave tarifa (papel)', 'text', false, r => r.papelTarifa, { width: 14, help: 'Titular ou Acompanhante — participante de interna é Titular para a tarifa.' }),
  col('vinculo', 'Vínculo', 'text', false, r => r.vinculo, { width: 12, help: 'alocacao = linha em instructor_allocations; principal = só demands.instructor_id.' }),

  col('horasInformadas', 'Horas informadas', 'hours', false, r => r.horasInformadas, { width: 12, help: 'O que está gravado na medição. Em branco = ninguém digitou.' }),
  col('horasPainel', 'Horas (painel)', 'hours', false, r => r.horasPainel, { width: 12, help: 'O que o Painel de Medição conta: ausente vale a carga padrão da demanda; acompanhante e híbrida valem 0 até digitar.' }),
  col('origemHoras', 'Origem das horas', 'text', false, r => r.origemHoras, { width: 34, help: 'De onde vem a coluna Horas pagamento, ou por que ela está em branco.' }),
  col('horasPagamento', 'Horas pagamento', 'hours', true, r => r.horasPagamento, { width: 12, help: 'A linha que o Excel de pagamento imprimiria: rateio da alocação com override do bloco. Carga cheia, sem recorte de mês. Em branco = não gera linha.' }),
  col('elegivelPagamento', 'Elegível pagamento', 'boolean', true, r => r.elegivelPagamento, { width: 10, help: 'Demanda concluída (status calculado) e pessoa com linha de pagamento.' }),
  col('diasPagamento', 'Dias (pagamento)', 'text', false, r => r.diasPagamento, { width: 24 }),

  col('valorHH', 'Valor HH (R$)', 'currency', true, r => r.valorHH, { width: 12, help: 'Gravado na medição. O Excel de pagamento usa a aba Tarifas, não este valor. Em branco com a opção "Usar Valor HH da medição" desligada.' }),
  col('origemTarifa', 'Origem da tarifa', 'text', true, r => r.origemTarifa, { width: 26, help: 'Tarifa da medição, tarifa zero digitada, sem tarifa na medição (R$ 0,00 por ausência) ou desativada pela opção.' }),
  col('horaAulaPainel', 'Hora/aula (R$, painel)', 'currency', true, r => r.horaAulaPainel, { width: 14, help: 'Horas (painel) × Valor HH — o mesmo número da seção da pessoa no painel.' }),
  col('horaAulaPagamento', 'Hora/aula (R$, horas pagamento)', 'currency', false, r => r.horaAulaPagamento, { width: 16, help: 'Horas pagamento × Valor HH da medição. Estimativa; a tarifa oficial é a da planilha.' }),

  col('hospedagem', 'Hospedagem (R$)', 'currency', true, r => r.despesas.hospedagem, { width: 12 }),
  col('locomocao', 'Locomoção (R$)', 'currency', true, r => r.despesas.locomocao, { width: 12 }),
  col('alimentacao', 'Alimentação (R$)', 'currency', true, r => r.despesas.alimentacao, { width: 12, help: 'Café + almoço + jantar, como no painel.' }),
  col('outros', 'Outros (R$)', 'currency', true, r => r.despesas.outros, { width: 12 }),
  col('totalDespesas', 'Total despesas (R$)', 'currency', true, r => r.despesas.total, { width: 14, help: 'Soma dos quatro buckets. Inclui os itens marcados como não reembolsáveis — eles foram gastos.' }),
  col('naoReembolsavel', 'Não reembolsável (R$)', 'currency', true, r => r.naoReembolsavel, { width: 14, help: 'Recorte dos itens que o cliente não reembolsa. Já está dentro do total.' }),
  col('despesasReembolsaveis', 'Despesas reembolsáveis (R$)', 'currency', false, r => r.despesasReembolsaveis, { width: 14, help: 'Total despesas − Não reembolsável.' }),
  col('totalGeral', 'Total geral (R$)', 'currency', true, r => r.totalGeral, { width: 14, help: 'Hora/aula (painel) + Total despesas — a composição do card Custo das Demandas Internas.' }),
  col('itensDespesa', 'Itens de despesa', 'number', false, r => r.despesas.itens, { width: 10 }),
  col('itensOrfaos', 'Itens órfãos', 'number', false, r => r.despesas.itensOrfaos, { width: 10, help: 'Anexos de Outros apontando para linha apagada: fora do total, como no painel.' }),

  col('medicaoStatus', 'Status da medição', 'text', true, r => r.medicaoStatus, { width: 18 }),
  col('medicaoAtualizadaEm', 'Medição atualizada em', 'date', false, r => r.medicaoAtualizadaEm, { width: 12 }),
];

export const MEDICOES_DATASET: DatasetDef<MedicaoRow> = {
  key: 'medicoes',
  label: 'Medições',
  description: 'Uma linha por pessoa em cada demanda com medição aberta: horas, hora/aula e despesas por pessoa.',
  requiredView: 'measurement',
  filters: ['periodo', 'status', 'modalidade', 'tipo', 'uf', 'cliente', 'instrutor', 'papel'],
  options: ['usarValorHH', 'incluirCanceladas'],
  columns: MEDICOES_COLUMNS,
  fileBase: 'medicoes',
};
