/**
 * DATASET DEMANDAS — uma linha por DEMANDA
 *
 * O equivalente analítico do Export Modal (components/ExportDemandsModal.tsx),
 * que fica INTOCADO. As diferenças são as aprovadas no parecer da F1, todas
 * resolvidas em `../shared.ts`:
 *   • status CALCULADO com modalidade resolvida (o modal não passa modalidade);
 *   • modalidade RESOLVIDA pelo treinamento (o modal imprime a coluna crua);
 *   • noturno pela regra do domínio, fim >= 19:00 (o modal marca início >= 18);
 *   • empresa na convenção do Excel de pagamento.
 *
 * Pessoas: titulares do rateio (`resolveDemandInstructors`), participantes de
 * interna e acompanhantes distintos — três colunas separadas, porque vêm de
 * três tabelas e misturá-las diria que participante é instrutor alocado.
 *
 * Logística: o bloco PRIMÁRIO (block_order 0) de locomoção e de hospedagem,
 * como o modal; blocos adicionais ficam contados em "Blocos de logística".
 * Os rótulos de transporte/hospedagem reproduzem `dbTransportToUI` e
 * `dbLodgingToUI` de Demands.tsx.
 *
 * Documentos: os flags de `demand_documents` (Lista de turma / Liberação do
 * instrutor), como o Controle Logístico lê: PDF anexado, N/A ou pendente.
 *
 * Medição: se existe linha em `measurements` e em que status — só isso. Os
 * valores por pessoa moram no dataset Medições.
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
import { resolveDemandInstructors } from '../../demandInstructors';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, getDemandCategoria, isInternalDemand } from '../../demandLabel';
import { getDemandDays } from '../../demandDays';
import {
  resolveCalculatedStatus,
  resolveCompanyLabel,
  resolveModalityLabel,
  resolveNoturno,
  statusLabel,
  tipoLabel,
  toBrDate,
  toBrTime,
  toBrDateTimeLocal,
  round2,
} from '../shared';
import type { CellValue, ColumnDef, DatasetDef, FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

/** Só o que este dataset lê de `logistic_blocks` (estrutural; sem importar services/). */
export interface LogisticBlockLike {
  demand_id: string;
  block_type: string;
  block_order: number;
  instructor_name?: string | null;
  /** Dono por id (migration 016); nulo nas linhas legadas. Lido pelo dataset Logística. */
  instructor_id?: string | null;
  transport_mode?: string | null;
  transport_other_description?: string | null;
  rental_company?: string | null;
  rental_agency_location?: string | null;
  rental_locator?: string | null;
  car_category?: string | null;
  rental_check_in?: string | null;
  rental_check_out?: string | null;
  receipt_url?: string[] | null;
  lodging_mode?: string | null;
  hotel_city?: string | null;
  hotel_name?: string | null;
  hotel_check_in?: string | null;
  hotel_check_out?: string | null;
  hotel_payment?: string | null;
  hotel_receipt_urls?: string[] | null;
}

/** Projeção de `demand_documents` (services/demandDocuments.ts, DemandDocumentFlagRow). */
export interface DocFlagLike {
  demand_id: string;
  doc_type: string;
  file_path: string | null;
  is_na: boolean | null;
}

export interface DemandasSource {
  demands: Demand[];
  measurements: Measurement[];
  trainings: Training[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  participants: DemandParticipant[];
  companions: CompanionAllocation[];
  logisticBlocks: LogisticBlockLike[];
  documentFlags: DocFlagLike[];
  regionNameById?: Map<string, string>;
  now?: Date;
}

/* ─────────────────────────────── linha ─────────────────────────────── */

export type DocFlagLabel = 'Anexado' | 'N/A' | 'Pendente';

export interface DemandaRow extends FilterableRow {
  demand: Demand;
  empresa: string;
  titulo: string;
  categoria: string;
  tipo: string;
  cargaHoraria: number | null;
  modalidade: string;
  statusCalculado: DemandStatus;
  uf: string;
  regiao: string;
  noturno: boolean;
  nDias: number;
  diasEspecificos: string;

  titulares: string[];
  participantes: string[];
  acompanhantes: string[];

  locomocao?: LogisticBlockLike;
  hospedagem?: LogisticBlockLike;
  nBlocosLogistica: number;

  listaTurma: DocFlagLabel;
  liberacaoInstrutor: DocFlagLabel;

  temMedicao: boolean;
  medicaoStatus: string;
}

/* ─────────────────────────── rótulos logística ─────────────────────────── */

export function transportLabel(mode: string | null | undefined, outros?: string | null): string {
  if (mode === 'CARRO_ALUGADO') return 'Carro Alugado';
  if (mode === 'CARRO_PROPRIO') return 'Carro Próprio';
  if (mode === 'TAXI') return 'Táxi';
  if (mode === 'CARRO_APLICATIVO') return 'Carro Aplicativo';
  if (mode === 'OUTROS') return outros ? `Outros — ${outros}` : 'Outros';
  if (mode === 'NAO_NECESSARIO' || mode === 'NA') return 'N/A';
  return '';
}

export function lodgingLabel(mode: string | null | undefined): string {
  if (mode === 'PRECISA_HOTEL') return 'Hotel';
  if (mode === 'NAO_NECESSARIO' || mode === 'NA') return 'N/A';
  return '';
}

function docFlag(flags: DocFlagLike[] | undefined, docType: string): DocFlagLabel {
  const f = flags?.find(x => x.doc_type === docType);
  if (f?.file_path) return 'Anexado';
  if (f?.is_na) return 'N/A';
  return 'Pendente';
}

/* ─────────────────────────── construção ─────────────────────────── */

export function buildDemandasRows(src: DemandasSource): DemandaRow[] {
  const now = src.now ?? new Date();
  const trainingsById = buildTrainingsById(src.trainings);
  const nameOf = (id: string) => src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`;
  const measurementByDemand = new Map(src.measurements.map(m => [m.demandId, m]));

  const blocksByDemand = new Map<string, LogisticBlockLike[]>();
  for (const b of src.logisticBlocks) {
    const l = blocksByDemand.get(b.demand_id) ?? [];
    l.push(b);
    blocksByDemand.set(b.demand_id, l);
  }
  const flagsByDemand = new Map<string, DocFlagLike[]>();
  for (const f of src.documentFlags) {
    const l = flagsByDemand.get(f.demand_id) ?? [];
    l.push(f);
    flagsByDemand.set(f.demand_id, l);
  }
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

  const rows: DemandaRow[] = src.demands.map(demand => {
    const training = trainingsById.get(String(demand.trainingId)) as Training | undefined;
    const interna = isInternalDemand(demand);

    const titularIds = [
      ...new Set(
        resolveDemandInstructors(demand.id, demand.instructorId, src.instructorAllocations).map(t => t.instructorId)
      ),
    ];
    const titularSet = new Set(titularIds);
    const participanteIds = interna
      ? [...new Set((participantsByDemand.get(demand.id) ?? []).map(p => p.instructorId).filter(id => id && !titularSet.has(id)))]
      : [];
    const acompanhanteIds = interna
      ? []
      : [...new Set((companionsByDemand.get(demand.id) ?? []).map(c => c.instructorId).filter(id => id && !titularSet.has(id)))];

    const blocos = blocksByDemand.get(demand.id) ?? [];
    const primario = (tipo: string) =>
      blocos.filter(b => b.block_type === tipo).sort((a, b) => a.block_order - b.block_order)[0];

    const m = measurementByDemand.get(demand.id);
    const flags = flagsByDemand.get(demand.id);

    const cargaHoraria = interna
      ? (Number(demand.horasPrevistas) > 0 ? Number(demand.horasPrevistas) : null)
      : (typeof training?.hours === 'number' && training.hours > 0 ? training.hours : null);

    return {
      demand,
      empresa: resolveCompanyLabel(demand, src.companies),
      titulo: getDemandTitle(demand, src.trainings as any, '—'),
      categoria: getDemandCategoria(demand),
      tipo: tipoLabel(demand),
      cargaHoraria,
      modalidade: resolveModalityLabel(demand, trainingsById),
      statusCalculado: resolveCalculatedStatus(demand, trainingsById, now),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      regiao: src.regionNameById?.get(demand.regionId) ?? demand.regionId ?? '',
      noturno: resolveNoturno(demand),
      nDias: getDemandDays(demand).length,
      diasEspecificos:
        demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates)
          ? [...demand.specificDates]
              .sort((a, b) => a.data.localeCompare(b.data))
              .map(e => `${toBrDate(e.data)} ${e.horarioInicio}-${e.horarioFim}`)
              .join(', ')
          : '',
      titulares: titularIds.map(nameOf),
      participantes: participanteIds.map(nameOf),
      acompanhantes: acompanhanteIds.map(nameOf),
      locomocao: primario('LOCOMOCAO'),
      hospedagem: primario('HOSPEDAGEM'),
      nBlocosLogistica: blocos.length,
      listaTurma: docFlag(flags, 'LISTA_TURMA'),
      liberacaoInstrutor: docFlag(flags, 'LIBERACAO_INSTRUTOR'),
      temMedicao: !!m,
      medicaoStatus: m?.status ?? '',
    };
  });

  rows.sort(
    (a, b) =>
      (b.demand.startDate ?? '').localeCompare(a.demand.startDate ?? '') || a.demand.id.localeCompare(b.demand.id)
  );
  return rows;
}

/* ─────────────────────────────── colunas ─────────────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<DemandaRow>['kind'],
  defaultOn: boolean,
  get: (r: DemandaRow) => CellValue,
  extra: Partial<Pick<ColumnDef<DemandaRow>, 'width' | 'help'>> = {}
): ColumnDef<DemandaRow> => ({ key, header, kind, defaultOn, get, ...extra });

const lista = (xs: string[]) => xs.join(', ');

export const DEMANDAS_COLUMNS: ColumnDef<DemandaRow>[] = [
  col('demandId', 'Demanda', 'text', true, r => r.demand.id, { width: 12 }),
  col('clientDemandId', 'ID Cliente', 'text', true, r => r.demand.clientDemandId ?? '', { width: 14 }),
  col('tipo', 'Tipo', 'text', true, r => r.tipo, { width: 10 }),
  col('empresa', 'Empresa', 'text', true, r => r.empresa, { width: 30 }),
  col('titulo', 'Treinamento / Descrição', 'text', true, r => r.titulo, { width: 40 }),
  col('categoria', 'Categoria (interna)', 'text', false, r => r.categoria, { width: 18 }),
  col('cargaHoraria', 'Carga horária', 'hours', true, r => r.cargaHoraria, { width: 10, help: 'Cliente: horas do treinamento. Interna: horas previstas. Em branco = sem carga cadastrada.' }),
  col('modalidade', 'Modalidade', 'text', true, r => r.modalidade, { width: 16, help: 'Resolvida pelo treinamento.' }),
  col('status', 'Status (calculado)', 'text', true, r => statusLabel(r.statusCalculado), { width: 16 }),
  col('statusCadastro', 'Status (cadastro)', 'text', false, r => statusLabel(r.demand.status), { width: 16, help: 'A coluna crua do banco. Difere do calculado quando ninguém atualizou o registro.' }),
  col('confirmacao', 'Confirmação', 'text', false, r => r.demand.confirmationStatus === 'CONFIRMADO' ? 'Confirmado' : r.demand.confirmationStatus === 'A_CONFIRMAR' ? 'A confirmar' : '', { width: 12 }),
  col('local', 'Local', 'text', true, r => r.demand.trainingLocal ?? '', { width: 22 }),
  col('regiao', 'Região', 'text', true, r => r.regiao, { width: 16 }),
  col('uf', 'UF', 'text', true, r => r.uf, { width: 6 }),
  col('corredor', 'Corredor', 'text', false, r => r.demand.corredor ?? '', { width: 16 }),
  col('dataInicio', 'Data início', 'date', true, r => toBrDate(r.demand.startDate), { width: 12 }),
  col('horarioInicio', 'Horário início', 'text', false, r => toBrTime(r.demand.startDate), { width: 8 }),
  col('dataFim', 'Data fim', 'date', true, r => toBrDate(r.demand.endDate), { width: 12 }),
  col('horarioFim', 'Horário fim', 'text', false, r => toBrTime(r.demand.endDate), { width: 8 }),
  col('modoDatas', 'Modo de datas', 'text', false, r => r.demand.dateMode === 'DIAS_ESPECIFICOS' ? 'Dias específicos' : 'Contínuo', { width: 14 }),
  col('diasEspecificos', 'Dias específicos', 'text', false, r => r.diasEspecificos, { width: 40 }),
  col('nDias', 'Nº de dias', 'number', true, r => r.nDias, { width: 8 }),
  col('noturno', 'Noturno', 'boolean', false, r => r.noturno, { width: 9, help: 'Fim às 19:00 ou depois, ou turno que vira o dia.' }),

  col('titulares', 'Instrutores (titulares)', 'text', true, r => lista(r.titulares), { width: 30, help: 'Linhas de instructor_allocations, com fallback para o instrutor principal.' }),
  col('nTitulares', 'Nº de titulares', 'number', false, r => r.titulares.length, { width: 8 }),
  col('participantes', 'Participantes (interna)', 'text', true, r => lista(r.participantes), { width: 30 }),
  col('acompanhantes', 'Acompanhantes (cliente)', 'text', true, r => lista(r.acompanhantes), { width: 30 }),

  col('locomocaoMeio', 'Locomoção — meio', 'text', true, r => transportLabel(r.locomocao?.transport_mode, r.locomocao?.transport_other_description), { width: 22 }),
  col('locomocaoLocadora', 'Locomoção — locadora', 'text', false, r => r.locomocao?.rental_company ?? '', { width: 16 }),
  col('locomocaoAgencia', 'Locomoção — agência', 'text', false, r => r.locomocao?.rental_agency_location ?? '', { width: 20 }),
  col('locomocaoLocalizador', 'Locomoção — localizador', 'text', false, r => r.locomocao?.rental_locator ?? '', { width: 16 }),
  col('locomocaoCategoria', 'Locomoção — categoria', 'text', false, r => r.locomocao?.car_category ?? '', { width: 14 }),
  col('locomocaoCheckIn', 'Locomoção — check-in', 'text', false, r => toBrDateTimeLocal(r.locomocao?.rental_check_in), { width: 16 }),
  col('locomocaoCheckOut', 'Locomoção — check-out', 'text', false, r => toBrDateTimeLocal(r.locomocao?.rental_check_out), { width: 16 }),
  col('locomocaoNotas', 'Locomoção — notas fiscais', 'number', false, r => r.locomocao?.receipt_url?.length ?? 0, { width: 10 }),
  col('hospedagemTipo', 'Hospedagem — tipo', 'text', true, r => lodgingLabel(r.hospedagem?.lodging_mode), { width: 12 }),
  col('hospedagemHotel', 'Hospedagem — hotel', 'text', false, r => r.hospedagem?.hotel_name ?? '', { width: 24 }),
  col('hospedagemCidade', 'Hospedagem — cidade', 'text', false, r => r.hospedagem?.hotel_city ?? '', { width: 18 }),
  col('hospedagemCheckIn', 'Hospedagem — check-in', 'date', false, r => toBrDate(r.hospedagem?.hotel_check_in), { width: 12 }),
  col('hospedagemCheckOut', 'Hospedagem — check-out', 'date', false, r => toBrDate(r.hospedagem?.hotel_check_out), { width: 12 }),
  col('hospedagemPagamento', 'Hospedagem — pagamento', 'text', false, r => r.hospedagem?.hotel_payment ?? '', { width: 12 }),
  col('nBlocosLogistica', 'Blocos de logística', 'number', false, r => r.nBlocosLogistica, { width: 8, help: 'Total de blocos (locomoção + hospedagem, todas as pessoas). As colunas acima mostram só o primário.' }),

  col('listaTurma', 'Lista de turma', 'text', false, r => r.listaTurma, { width: 12 }),
  col('liberacaoInstrutor', 'Liberação do instrutor', 'text', false, r => r.liberacaoInstrutor, { width: 12 }),

  col('temMedicao', 'Tem medição', 'boolean', true, r => r.temMedicao, { width: 9 }),
  col('medicaoStatus', 'Status da medição', 'text', true, r => r.medicaoStatus, { width: 18 }),

  col('aprovador', 'Aprovador', 'text', false, r => r.demand.approver ?? '', { width: 18 }),
  col('analista', 'Analista', 'text', false, r => r.demand.analyst ?? '', { width: 18 }),
  col('matriculador', 'Matriculador', 'text', false, r => r.demand.matriculador ?? '', { width: 18 }),
  col('solicitante', 'Solicitante', 'text', false, r => r.demand.requester ?? '', { width: 18 }),
  col('motivoCancelamento', 'Motivo do cancelamento', 'text', false, r => r.demand.status === 'CANCELADA' ? (r.demand.cancelReason ?? '') : '', { width: 24 }),
  col('observacoes', 'Observações', 'text', false, r => r.demand.observations ?? '', { width: 50 }),
];

// `round2` fica importado para manter o mesmo helper à mão em colunas futuras.
void round2;

export const DEMANDAS_DATASET: DatasetDef<DemandaRow> = {
  key: 'demandas',
  label: 'Demandas',
  description: 'Uma linha por demanda: cadastro, pessoas, logística primária, documentos e se há medição.',
  requiredView: 'demands',
  filters: ['periodo', 'status', 'modalidade', 'tipo', 'uf', 'cliente'],
  options: ['incluirCanceladas'],
  columns: DEMANDAS_COLUMNS,
  fileBase: 'demandas',
};
