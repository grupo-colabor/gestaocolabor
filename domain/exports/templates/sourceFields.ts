/**
 * TEMPLATES DE MEDIÇÃO — catálogo dos campos do app que uma coluna pode ler
 *
 * `SOURCE_FIELDS` é a lista fechada que a tela de mapeamento da Etapa 3 vai
 * oferecer: cada entrada tem rótulo e um getter sobre `TemplateRowInput`, a
 * linha já resolvida pelo dataset (datasets/medicaoVale.ts monta uma por
 * demanda). Um campo novo entra AQUI, com rótulo; template nenhum precisa
 * mudar.
 *
 * Os getters não calculam nada: recebem valores que o dataset já resolveu
 * pelo domínio (despesas reembolsáveis por `computePanelExpenseBreakdown`,
 * titulares por `resolveDemandInstructors`, status calculado, etc.).
 */
import type { CellValue } from '../types';

/** Uma linha de template, já resolvida pelo dataset. Só o que os getters leem. */
export interface TemplateRowInput {
  demandId: string;
  clientDemandId: string;
  companyName: string;
  trainingId: string;
  trainingName: string;
  /** Carga horária contratada (training.hours; interna: horas previstas). */
  cargaHoraria: number | null;
  local: string;
  corredor: string;
  uf: string;
  /** 'YYYY-MM-DD' do primeiro dia da demanda. */
  dataInicio: string;
  /** 'HH:mm' do primeiro dia. */
  horarioInicio: string;
  nDias: number;
  statusCalculado: string;
  /** Nomes dos titulares, na ordem do rateio. */
  titulares: string[];
  /** Despesas REEMBOLSÁVEIS nos quatro buckets do painel. */
  despesas: { locomocao: number; alimentacao: number; hospedagem: number; outros: number; total: number };
  medicaoStatus: string;
  temMedicao: boolean;
}

export type SourceField =
  | 'demand.id'
  | 'demand.clientDemandId'
  | 'demand.local'
  | 'demand.corredor'
  | 'demand.uf'
  | 'demand.dataInicio'
  | 'demand.horarioInicio'
  | 'demand.nDias'
  | 'demand.cargaHoraria'
  | 'demand.statusCalculado'
  | 'company.name'
  | 'training.name'
  | 'people.titulares'
  | 'expenses.locomocao'
  | 'expenses.alimentacao'
  | 'expenses.hospedagem'
  | 'expenses.outros'
  | 'expenses.total'
  | 'measurement.status';

export interface SourceFieldDef {
  label: string;
  get: (r: TemplateRowInput) => CellValue;
}

/** Separador dos titulares na mesma célula (demanda dividida por dias). */
export const TITULARES_SEPARATOR = ' / ';

export const SOURCE_FIELDS: Record<SourceField, SourceFieldDef> = {
  'demand.id': { label: 'Demanda (DEM-xxxx)', get: r => r.demandId },
  'demand.clientDemandId': { label: 'ID SAP / Pedido Cliente', get: r => r.clientDemandId || null },
  'demand.local': { label: 'Local do treinamento', get: r => r.local },
  'demand.corredor': { label: 'Corredor', get: r => r.corredor },
  'demand.uf': { label: 'UF', get: r => r.uf },
  'demand.dataInicio': { label: 'Data de início', get: r => r.dataInicio },
  'demand.horarioInicio': { label: 'Horário de início', get: r => r.horarioInicio },
  'demand.nDias': { label: 'Nº de dias', get: r => r.nDias },
  'demand.cargaHoraria': { label: 'Carga horária', get: r => r.cargaHoraria },
  'demand.statusCalculado': { label: 'Status (calculado)', get: r => r.statusCalculado },
  'company.name': { label: 'Empresa', get: r => r.companyName },
  'training.name': { label: 'Treinamento', get: r => r.trainingName },
  'people.titulares': { label: 'Instrutor(es) titular(es)', get: r => r.titulares.join(TITULARES_SEPARATOR) },
  'expenses.locomocao': { label: 'Despesa: locomoção (reembolsável)', get: r => r.despesas.locomocao },
  'expenses.alimentacao': { label: 'Despesa: alimentação (reembolsável)', get: r => r.despesas.alimentacao },
  'expenses.hospedagem': { label: 'Despesa: hospedagem (reembolsável)', get: r => r.despesas.hospedagem },
  'expenses.outros': { label: 'Despesa: outros (reembolsável)', get: r => r.despesas.outros },
  'expenses.total': { label: 'Despesa: total reembolsável', get: r => r.despesas.total },
  'measurement.status': { label: 'Status da medição', get: r => r.medicaoStatus },
};

export const isSourceField = (s: string): s is SourceField =>
  Object.prototype.hasOwnProperty.call(SOURCE_FIELDS, s);
