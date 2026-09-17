/**
 * DATASET LOGÍSTICA — uma linha por BLOCO LOGÍSTICO
 *
 * O Controle Logístico (components/LogisticsControl.tsx) mostra uma linha por
 * DEMANDA, lida de `logistic_allocations` + `demand_documents`, e pinta o
 * checklist com `buildLogisticsChecklist`. Os blocos por pessoa (locomoção e
 * hospedagem, um ou mais por demanda) vivem em `logistic_blocks` e só aparecem
 * dentro do formulário da demanda. Este dataset é a visão por BLOCO: cada linha
 * é um bloco, com a demanda, a pessoa do bloco e, repetidos em cada linha, o
 * checklist e os documentos da demanda — para quem filtra por corredor, UF ou
 * modo de transporte ver o bloco e a prontidão juntos.
 *
 * O que existe no banco e o que NÃO existe (decisão 17/09/2026):
 *   • `block_type` é só 'LOCOMOCAO' ou 'HOSPEDAGEM' (migration 003). Não há
 *     "ida/volta": as datas do bloco de locomoção são `rental_check_in` /
 *     `rental_check_out`, e as de hospedagem `hotel_check_in` / `hotel_check_out`.
 *   • O instrutor do bloco vem de `instructor_id` (migration 016) e, nas linhas
 *     legadas, só de `instructor_name`. A coluna imprime o nome nos dois casos;
 *     o FILTRO de instrutor só alcança blocos com id (legado sem id fica de fora
 *     do filtro, nunca da lista).
 *   • Demanda sem bloco não tem linha aqui — é o dataset Demandas que a mostra.
 *
 * Checklist: a MESMA função da tela (`buildLogisticsChecklist`) com a MESMA
 * montagem de entrada do Controle Logístico: PDF de `demand_documents` (anexado
 * OU marcado N/A) tem prioridade sobre as flags gravadas na linha de
 * `logistic_allocations`; sem linha de logística valem os campos legados da
 * demanda. "Documentos pendentes" conta as colunas Liberação e Lista em
 * PENDENTE nesse checklist — na interna a Lista é NAO_APLICA, como na tela.
 *
 * Filtros próprios (row-level, como o de instrutor):
 *   • modoTransporte — só linhas de Locomoção têm modo; com o filtro ativo as
 *     linhas de Hospedagem saem (decisão aprovada);
 *   • pendenciaDoc — "só com pendência de documento".
 *
 * Nada aqui recalcula prontidão: a regra é a de domain/demandLogisticsStatus.ts.
 */
import type { Demand, DemandStatus, Training } from '../../../types';
import { buildLogisticsChecklist, type LogisticsChecklist } from '../../demandLogisticsStatus';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, isInternalDemand } from '../../demandLabel';
import {
  resolveCalculatedStatus,
  resolveCompanyLabel,
  resolveModalityLabel,
  statusLabel,
  tipoLabel,
  toBrDate,
  toBrDateTimeLocal,
} from '../shared';
import { transportLabel, lodgingLabel, type LogisticBlockLike, type DocFlagLike, type DocFlagLabel } from './demandas';
import type { CellValue, ColumnDef, DatasetDef, FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

/** Só o que este dataset lê de `logistic_allocations` (a linha do Controle Logístico). */
export interface LogisticAllocationLike {
  demand_id: string;
  transport_mode?: string | null;
  lodging_mode?: string | null;
  has_car?: boolean | null;
  has_hotel?: boolean | null;
  has_material?: boolean | null;
  has_release_pdf?: boolean | null;
  has_class_list_pdf?: boolean | null;
  overall_status?: string | null;
}

export interface LogisticaSource {
  demands: Demand[];
  trainings: Training[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  logisticBlocks: LogisticBlockLike[];
  logisticAllocations: LogisticAllocationLike[];
  documentFlags: DocFlagLike[];
  regionNameById?: Map<string, string>;
  now?: Date;
}

/* ─────────────────────────────── linha ─────────────────────────────── */

export type BlocoTipoLabel = 'Locomoção' | 'Hospedagem';

export interface LogisticaRow extends FilterableRow {
  demand: Demand;
  bloco: LogisticBlockLike;
  blocoTipo: BlocoTipoLabel;
  /** 1 = bloco primário (block_order 0). */
  blocoOrdem: number;

  empresa: string;
  titulo: string;
  tipo: string;
  modalidade: string;
  statusCalculado: DemandStatus;
  uf: string;
  regiao: string;

  /** `logistic_blocks.instructor_id`, ou '' na linha legada (só nome). */
  instructorId: string;
  instructorName: string;
  instrutorOrigem: 'id' | 'nome' | '';

  /** Chave crua de `transport_mode` — só em Locomoção (alimenta o filtro). */
  modoTransporte?: string;
  transporteLabel: string;
  hospedagemLabel: string;

  /** Há linha em `logistic_allocations` para a demanda? */
  temControle: boolean;
  /** `overall_status` gravado na linha (o write-back do Controle), ou ''. */
  statusGravado: string;
  checklist: LogisticsChecklist;

  listaTurma: DocFlagLabel;
  liberacaoInstrutor: DocFlagLabel;
  /** Liberação + Lista em PENDENTE no checklist (interna: Lista não conta). */
  documentosPendentes: number;
  pendenciaDoc: boolean;
}

/* ─────────────────────────── construção ─────────────────────────── */

function docFlag(flags: DocFlagLike[] | undefined, docType: string): DocFlagLabel {
  const f = flags?.find(x => x.doc_type === docType);
  if (f?.file_path) return 'Anexado';
  if (f?.is_na) return 'N/A';
  return 'Pendente';
}

/**
 * A entrada do checklist EXATAMENTE como o Controle Logístico a monta
 * (`checklistFor` + `docsMap`): documento concluído = PDF anexado OU N/A; com
 * qualquer linha de `demand_documents` para a demanda, os documentos vêm dela;
 * sem nenhuma, valem as flags da linha de logística.
 */
export function checklistInputFor(
  demand: Demand,
  alloc: LogisticAllocationLike | undefined,
  flags: DocFlagLike[] | undefined
) {
  const docs = flags && flags.length > 0
    ? {
        has_class_list_pdf: flags.some(f => f.doc_type === 'LISTA_TURMA' && (!!f.file_path || f.is_na === true)),
        has_release_pdf: flags.some(f => f.doc_type === 'LIBERACAO_INSTRUTOR' && (!!f.file_path || f.is_na === true)),
      }
    : undefined;
  return {
    isInternal: isInternalDemand(demand),
    hasAlloc: !!alloc,
    hasCar: alloc?.has_car,
    transportMode: alloc?.transport_mode,
    hasHotel: alloc?.has_hotel,
    lodgingMode: alloc?.lodging_mode,
    hasMaterial: alloc?.has_material,
    hasReleasePdf: docs ? docs.has_release_pdf : alloc?.has_release_pdf,
    hasClassListPdf: docs ? docs.has_class_list_pdf : alloc?.has_class_list_pdf,
    legacy: {
      logisticsHotel: demand.logisticsHotel,
      logisticsTransport: demand.logisticsTransport,
      materialReady: demand.materialReady,
    },
  };
}

const BLOCO_LABEL: Record<string, BlocoTipoLabel> = { LOCOMOCAO: 'Locomoção', HOSPEDAGEM: 'Hospedagem' };

export function buildLogisticaRows(src: LogisticaSource): LogisticaRow[] {
  const now = src.now ?? new Date();
  const trainingsById = buildTrainingsById(src.trainings);
  const demandsById = new Map(src.demands.map(d => [d.id, d]));
  const nameOf = (id: string) => src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`;
  const allocByDemand = new Map(src.logisticAllocations.map(a => [a.demand_id, a]));
  const flagsByDemand = new Map<string, DocFlagLike[]>();
  for (const f of src.documentFlags) {
    const l = flagsByDemand.get(f.demand_id) ?? [];
    l.push(f);
    flagsByDemand.set(f.demand_id, l);
  }

  // Checklist e rótulos da demanda uma vez por demanda; repetidos em cada bloco.
  const porDemanda = new Map<string, Omit<LogisticaRow, 'bloco' | 'blocoTipo' | 'blocoOrdem' | 'instructorId' | 'instructorName' | 'instrutorOrigem' | 'modoTransporte' | 'transporteLabel' | 'hospedagemLabel'>>();
  const baseDe = (demand: Demand) => {
    const pronto = porDemanda.get(demand.id);
    if (pronto) return pronto;
    const alloc = allocByDemand.get(demand.id);
    const flags = flagsByDemand.get(demand.id);
    const checklist = buildLogisticsChecklist(checklistInputFor(demand, alloc, flags));
    const documentosPendentes = [checklist.release, checklist.list].filter(s => s === 'PENDENTE').length;
    const base = {
      demand,
      empresa: resolveCompanyLabel(demand, src.companies),
      titulo: getDemandTitle(demand, src.trainings as any, '—'),
      tipo: tipoLabel(demand),
      modalidade: resolveModalityLabel(demand, trainingsById),
      statusCalculado: resolveCalculatedStatus(demand, trainingsById, now),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      regiao: src.regionNameById?.get(demand.regionId) ?? demand.regionId ?? '',
      temControle: !!alloc,
      statusGravado: alloc?.overall_status ?? '',
      checklist,
      listaTurma: docFlag(flags, 'LISTA_TURMA'),
      liberacaoInstrutor: docFlag(flags, 'LIBERACAO_INSTRUTOR'),
      documentosPendentes,
      pendenciaDoc: documentosPendentes > 0,
    };
    porDemanda.set(demand.id, base);
    return base;
  };

  const rows: LogisticaRow[] = [];
  for (const b of src.logisticBlocks) {
    const demand = demandsById.get(b.demand_id);
    if (!demand) continue; // bloco órfão: sem demanda não há linha a montar
    const base = baseDe(demand);
    const locomocao = b.block_type === 'LOCOMOCAO';
    const instructorId = b.instructor_id ?? '';
    const instructorName = instructorId ? nameOf(instructorId) : (b.instructor_name ?? '').trim();
    rows.push({
      ...base,
      bloco: b,
      blocoTipo: BLOCO_LABEL[b.block_type] ?? (b.block_type as BlocoTipoLabel),
      blocoOrdem: (Number(b.block_order) || 0) + 1,
      instructorId,
      instructorName,
      instrutorOrigem: instructorId ? 'id' : instructorName ? 'nome' : '',
      modoTransporte: locomocao ? (b.transport_mode ?? '') || undefined : undefined,
      transporteLabel: locomocao ? transportLabel(b.transport_mode, b.transport_other_description) : '',
      hospedagemLabel: locomocao ? '' : lodgingLabel(b.lodging_mode),
    });
  }

  const ordemTipo = (t: string) => (t === 'LOCOMOCAO' ? 0 : 1);
  rows.sort(
    (a, b) =>
      (b.demand.startDate ?? '').localeCompare(a.demand.startDate ?? '') ||
      a.demand.id.localeCompare(b.demand.id) ||
      ordemTipo(a.bloco.block_type) - ordemTipo(b.bloco.block_type) ||
      a.blocoOrdem - b.blocoOrdem
  );
  return rows;
}

/* ─────────────────────────────── colunas ─────────────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<LogisticaRow>['kind'],
  defaultOn: boolean,
  get: (r: LogisticaRow) => CellValue,
  extra: Partial<Pick<ColumnDef<LogisticaRow>, 'width' | 'help'>> = {}
): ColumnDef<LogisticaRow> => ({ key, header, kind, defaultOn, get, ...extra });

const CHECK_LABEL: Record<string, string> = { OK: 'OK', PENDENTE: 'Pendente', NAO_APLICA: 'Não se aplica' };
const checkLabel = (s: string) => CHECK_LABEL[s] ?? s;

export const LOGISTICA_COLUMNS: ColumnDef<LogisticaRow>[] = [
  col('demandId', 'Demanda', 'text', true, r => r.demand.id, { width: 12 }),
  col('clientDemandId', 'ID Cliente', 'text', false, r => r.demand.clientDemandId ?? '', { width: 14 }),
  col('tipo', 'Tipo', 'text', true, r => r.tipo, { width: 10 }),
  col('empresa', 'Empresa', 'text', true, r => r.empresa, { width: 30 }),
  col('titulo', 'Treinamento / Descrição', 'text', true, r => r.titulo, { width: 40 }),
  col('modalidade', 'Modalidade', 'text', false, r => r.modalidade, { width: 16 }),
  col('status', 'Status (calculado)', 'text', true, r => statusLabel(r.statusCalculado), { width: 16 }),
  col('dataInicio', 'Data início', 'date', true, r => toBrDate(r.demand.startDate), { width: 12 }),
  col('dataFim', 'Data fim', 'date', true, r => toBrDate(r.demand.endDate), { width: 12 }),
  col('local', 'Local', 'text', true, r => r.demand.trainingLocal ?? '', { width: 22 }),
  col('corredor', 'Corredor', 'text', true, r => r.demand.corredor ?? '', { width: 16 }),
  col('uf', 'UF', 'text', true, r => r.uf, { width: 6 }),
  col('regiao', 'Região', 'text', false, r => r.regiao, { width: 16 }),

  col('blocoTipo', 'Bloco', 'text', true, r => r.blocoTipo, { width: 12, help: 'Locomoção ou Hospedagem — os dois tipos que existem em logistic_blocks.' }),
  col('blocoOrdem', 'Ordem do bloco', 'number', false, r => r.blocoOrdem, { width: 8, help: '1 = bloco primário (o que o dataset Demandas mostra).' }),
  col('instrutor', 'Instrutor do bloco', 'text', true, r => r.instructorName, { width: 28, help: 'Pelo id do bloco; nas linhas legadas, o nome gravado.' }),
  col('instrutorOrigem', 'Instrutor — origem', 'text', false, r => r.instrutorOrigem === 'id' ? 'Cadastro (id)' : r.instrutorOrigem === 'nome' ? 'Nome gravado (legado)' : '', { width: 18 }),

  col('transporteMeio', 'Locomoção — meio', 'text', true, r => r.transporteLabel, { width: 22 }),
  col('transporteLocadora', 'Locomoção — locadora', 'text', false, r => r.bloco.rental_company ?? '', { width: 16 }),
  col('transporteAgencia', 'Locomoção — agência', 'text', false, r => r.bloco.rental_agency_location ?? '', { width: 20 }),
  col('transporteLocalizador', 'Locomoção — localizador', 'text', false, r => r.bloco.rental_locator ?? '', { width: 16 }),
  col('transporteCategoria', 'Locomoção — categoria', 'text', false, r => r.bloco.car_category ?? '', { width: 14 }),
  col('transporteCheckIn', 'Locomoção — retirada', 'text', true, r => toBrDateTimeLocal(r.bloco.rental_check_in), { width: 16, help: 'rental_check_in no fuso do navegador.' }),
  col('transporteCheckOut', 'Locomoção — devolução', 'text', true, r => toBrDateTimeLocal(r.bloco.rental_check_out), { width: 16 }),
  col('transporteNotas', 'Locomoção — notas fiscais', 'number', false, r => r.blocoTipo === 'Locomoção' ? (r.bloco.receipt_url?.length ?? 0) : null, { width: 10 }),

  col('hospedagemTipo', 'Hospedagem — precisa', 'text', true, r => r.hospedagemLabel, { width: 12, help: 'Hotel ou N/A, pelo lodging_mode do bloco.' }),
  col('hospedagemHotel', 'Hospedagem — hotel', 'text', true, r => r.bloco.hotel_name ?? '', { width: 24 }),
  col('hospedagemCidade', 'Hospedagem — cidade', 'text', false, r => r.bloco.hotel_city ?? '', { width: 18 }),
  col('hospedagemCheckIn', 'Hospedagem — check-in', 'date', true, r => toBrDate(r.bloco.hotel_check_in), { width: 12 }),
  col('hospedagemCheckOut', 'Hospedagem — check-out', 'date', true, r => toBrDate(r.bloco.hotel_check_out), { width: 12 }),
  col('hospedagemPagamento', 'Hospedagem — pagamento', 'text', false, r => r.bloco.hotel_payment ?? '', { width: 12 }),
  col('hospedagemComprovantes', 'Hospedagem — comprovantes', 'number', false, r => r.blocoTipo === 'Hospedagem' ? (r.bloco.hotel_receipt_urls?.length ?? 0) : null, { width: 10 }),

  col('checkCarro', 'Check — Carro', 'text', false, r => checkLabel(r.checklist.car), { width: 12 }),
  col('checkHotel', 'Check — Hotel', 'text', false, r => checkLabel(r.checklist.hotel), { width: 12 }),
  col('checkMaterial', 'Check — Material', 'text', false, r => checkLabel(r.checklist.material), { width: 12 }),
  col('checkLiberacao', 'Check — Liberação', 'text', true, r => checkLabel(r.checklist.release), { width: 12 }),
  col('checkLista', 'Check — Lista', 'text', true, r => checkLabel(r.checklist.list), { width: 12, help: 'Na interna, "Não se aplica" (Documento de Apoio é opcional).' }),
  col('logisticaPronta', 'Logística pronta', 'boolean', true, r => r.checklist.ready, { width: 10, help: 'O mesmo checklist do Controle Logístico: nenhuma coluna pendente.' }),
  col('statusGravado', 'Status gravado (controle)', 'text', false, r => r.statusGravado, { width: 14, help: 'overall_status como está em logistic_allocations — o write-back da tela. Pode estar defasado até alguém abrir o Controle.' }),
  col('temControle', 'Tem linha no controle', 'boolean', false, r => r.temControle, { width: 10 }),

  col('listaTurma', 'Lista de turma (doc)', 'text', false, r => r.listaTurma, { width: 12 }),
  col('liberacaoInstrutor', 'Liberação do instrutor (doc)', 'text', false, r => r.liberacaoInstrutor, { width: 12 }),
  col('documentosPendentes', 'Documentos pendentes', 'number', true, r => r.documentosPendentes, { width: 10, help: 'Liberação e Lista em Pendente no checklist (a Lista não conta na interna).' }),
];

export const LOGISTICA_DATASET: DatasetDef<LogisticaRow> = {
  key: 'logistica',
  label: 'Logística',
  description: 'Uma linha por bloco de locomoção ou hospedagem: pessoa do bloco, datas, checklist do Controle Logístico e documentos da demanda.',
  requiredView: 'logistics-control',
  filters: ['periodo', 'corredor', 'uf', 'instrutor', 'modoTransporte', 'pendenciaDoc'],
  options: ['incluirCanceladas'],
  columns: LOGISTICA_COLUMNS,
  fileBase: 'logistica',
};
