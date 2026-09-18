/**
 * EXPORTAÇÕES — carga dos dados (I/O)
 *
 * Busca TUDO que os datasets precisam, em paralelo, pelos services existentes
 * — todos paginados via `fetchAllPaginated` e todos propagando erro. Um
 * `Promise.all` que rejeita derruba a carga inteira: a tela mostra o banner e
 * bloqueia a geração. Nunca devolve lista parcial (ver a memória do projeto:
 * falha de banco não pode virar "0 linhas" em silêncio).
 *
 * Refaz a busca a cada "Carregar" em vez de ler o contexto do React — a mesma
 * decisão do Excel de pagamento (medicaoExportService.ts), para o arquivo não
 * sair de um estado defasado.
 *
 * Mapeamento DB → domínio: os MESMOS mappers do Excel de pagamento
 * (exportados em medicaoExportService.ts), completados aqui com os campos de
 * cadastro que só o dataset Demandas usa (id do cliente, corredor, aprovador,
 * analista, matriculador, solicitante, observações, confirmação, motivo de
 * cancelamento) — mesmos nomes de coluna que `mapDemandFromDb` do App.tsx lê.
 */
import { fetchDemands } from '../demands';
import { fetchMeasurements } from '../measurements';
import { fetchTrainings } from '../trainings';
import { fetchInstructors } from '../instructors';
import { fetchCompanies } from '../companies';
import { fetchInstructorAllocations } from '../instructorAllocations';
import { fetchDemandParticipants } from '../demandParticipants';
import { fetchCompanionAllocations } from '../companionAllocations';
import { fetchAllLogisticBlocks } from '../logistics';
import { fetchAllDemandDocumentFlags } from '../demandDocuments';
import { fetchLogisticAllocations, type LogisticAllocationRow } from '../logisticAllocations';
import { fetchTemplateValues, type TemplateValueRow } from './templateValues';
import { fetchActiveMeasurementTemplates } from './templates';
import { loadTemplates, type LoadedTemplate } from '../../domain/exports/templates/store';
import {
  mapDemand,
  mapTraining,
  mapMeasurement,
  mapInstructor,
  mapAllocation,
} from '../medicaoExportService';
import type {
  Demand,
  Measurement,
  Training,
  InstructorAllocation,
  DemandParticipant,
  CompanionAllocation,
} from '../../types';
import type { LogisticBlockLike, DocFlagLike } from '../../domain/exports/datasets/demandas';

export interface ExportSourceData {
  demands: Demand[];
  measurements: Measurement[];
  trainings: Training[];
  /**
   * SÓ id, nome e UF de residência. O mapper do Excel de pagamento devolve
   * também o CPF (mapInstructor) e ele é descartado AQUI de propósito: nenhum
   * dataset da aba recebe CPF, e-mail, endereço, observações, tarifa ou valor
   * do instrutor. O smoke prende este tipo e este mapeamento.
   */
  instructors: { id: string; name: string; uf: string }[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  participants: DemandParticipant[];
  companions: CompanionAllocation[];
  logisticBlocks: LogisticBlockLike[];
  documentFlags: DocFlagLike[];
  /** `logistic_allocations` (a linha do Controle Logístico) — só com includeLogistics. */
  logisticAllocations: LogisticAllocationRow[];
  /** Valores manuais dos templates pedidos em `templateIds`; vazio quando não pedido. */
  templateValues: TemplateValueRow[];
  /** Ordenados, para a tela comparar a carga com o dataset atual. */
  templateIds: string[];
  /**
   * Modelos de medição ATIVOS (migration 022), já lidos pelo domínio — com os
   * avisos de quem tem mapeamento torto. Vazio quando não pedido.
   *
   * ⚠️ A LISTA DE MÓDULOS NÃO PODE DEPENDER DESTA CARGA. A aba precisa dos
   * módulos para a pessoa ESCOLHER um, o que acontece antes de "Carregar
   * dados". Isto aqui serve a quem já escolheu — e para a tela reconferir, na
   * hora de gerar, que o modelo continua o mesmo do banco. Quem monta a lista
   * busca os ativos por conta própria (`fetchActiveMeasurementTemplates`).
   */
  measurementTemplates: LoadedTemplate[];
  /** Quando os dados foram lidos — vai para o rodapé da tela. */
  loadedAt: Date;
}

function mapDemandForExport(row: any): Demand {
  return {
    ...mapDemand(row),
    clientDemandId: row.client_demand_id ?? undefined,
    corredor: row.corredor ?? undefined,
    requester: row.requester ?? undefined,
    observations: row.observations ?? undefined,
    approver: row.approver ?? undefined,
    analyst: row.analyst ?? undefined,
    matriculador: row.matriculador ?? undefined,
    confirmationStatus: (row.confirmation_status || undefined) as Demand['confirmationStatus'],
    cancelReason: row.cancel_reason ?? undefined,
  };
}

export interface LoadExportDataOptions {
  /**
   * Logística e documentos só servem ao dataset Demandas. O de Medições não
   * paga essas 5 a 7 requisições a mais.
   */
  includeLogistics: boolean;
  /** Templates de medição cujos valores manuais devem vir junto (Etapa 2 / BM). */
  templateIds?: string[];
  /** Trazer os modelos de medição ativos (migration 022) junto. */
  includeMeasurementTemplates?: boolean;
}

export async function loadExportData(opts: LoadExportDataOptions): Promise<ExportSourceData> {
  const [
    demandRows,
    measurementRows,
    trainingRows,
    instructorRows,
    companyRows,
    allocationRows,
    participantRows,
    companionRows,
    logisticRows,
    docRows,
    logisticAllocationRows,
    templateValueRows,
    measurementTemplateRows,
  ] = await Promise.all([
    fetchDemands(),
    fetchMeasurements(),
    fetchTrainings(),
    fetchInstructors(),
    fetchCompanies(),
    fetchInstructorAllocations(),
    fetchDemandParticipants(),
    fetchCompanionAllocations(),
    opts.includeLogistics ? fetchAllLogisticBlocks() : Promise.resolve([]),
    opts.includeLogistics ? fetchAllDemandDocumentFlags() : Promise.resolve([]),
    // Pelo fetcher paginado existente (Controle Logístico), não por query nova.
    opts.includeLogistics ? fetchLogisticAllocations() : Promise.resolve([]),
    opts.templateIds && opts.templateIds.length ? fetchTemplateValues(opts.templateIds) : Promise.resolve([]),
    opts.includeMeasurementTemplates ? fetchActiveMeasurementTemplates() : Promise.resolve([]),
  ]);

  return {
    demands: (demandRows ?? []).map(mapDemandForExport),
    measurements: (measurementRows ?? []).map(mapMeasurement),
    trainings: (trainingRows ?? []).map(mapTraining),
    instructors: (instructorRows ?? []).map(r => {
      const i = mapInstructor(r);
      // residence_location é a UF de residência (domain/instructorRecommendation, isSameDemandState).
      return { id: i.id, name: i.name, uf: String((r as any).residence_location ?? '').trim() };
    }),
    // Mesmo rótulo do Excel de pagamento: `name`, senão `razao_social`.
    companies: (companyRows ?? []).map(c => ({ id: c.id, name: (c.name || c.razao_social || '').trim() })),
    instructorAllocations: (allocationRows ?? []).map(mapAllocation),
    participants: (participantRows ?? []).map(p => ({
      id: p.id,
      demandId: p.demand_id,
      instructorId: p.instructor_id,
      startDate: p.start_date,
      endDate: p.end_date,
    })),
    companions: (companionRows ?? []).map(c => ({
      id: c.id,
      demandId: c.demand_id,
      instructorId: c.instructor_id,
      startDate: c.start_date,
      endDate: c.end_date,
    })),
    logisticBlocks: (logisticRows ?? []) as LogisticBlockLike[],
    documentFlags: (docRows ?? []) as DocFlagLike[],
    logisticAllocations: logisticAllocationRows ?? [],
    templateValues: templateValueRows ?? [],
    templateIds: [...(opts.templateIds ?? [])].sort(),
    measurementTemplates: loadTemplates(measurementTemplateRows ?? []),
    loadedAt: new Date(),
  };
}
