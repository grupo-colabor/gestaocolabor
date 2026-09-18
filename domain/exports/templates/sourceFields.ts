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
  /**
   * Modalidade do TREINAMENTO (não a da demanda), já canônica
   * (domain/modalityOptions). OPCIONAL de propósito: o campo entrou no
   * catálogo na Fase 1 dos modelos por empresa (18/09/2026), e quem monta a
   * linha (`datasets/medicaoVale.ts`) só passa a preenchê-lo na fase do
   * dataset. Enquanto isso, uma coluna mapeada para "Modalidade" resolve em
   * branco — e o smoke prende esse comportamento para ele não surpreender
   * ninguém depois.
   */
  modalidade?: string;
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
  | 'training.modalidade'
  | 'people.titulares'
  | 'expenses.locomocao'
  | 'expenses.alimentacao'
  | 'expenses.hospedagem'
  | 'expenses.outros'
  | 'expenses.total'
  | 'measurement.status';

/**
 * Os grupos em que a TELA DE MAPEAMENTO oferece os campos. São rótulos de
 * negócio: quem configura um modelo procura por "Despesas", não pelo prefixo
 * `expenses.` da chave. Campo novo declara o grupo dele aqui — a tela não tem
 * lista própria, para não existirem duas verdades sobre onde cada campo mora.
 */
export type SourceFieldGroup = 'Demanda' | 'Cliente' | 'Treinamento' | 'Pessoas' | 'Despesas' | 'Medição';

/** Ordem em que os grupos aparecem na tela. */
export const SOURCE_FIELD_GROUPS: SourceFieldGroup[] = [
  'Demanda',
  'Cliente',
  'Treinamento',
  'Pessoas',
  'Despesas',
  'Medição',
];

export interface SourceFieldDef {
  label: string;
  grupo: SourceFieldGroup;
  get: (r: TemplateRowInput) => CellValue;
}

/** Separador dos titulares na mesma célula (demanda dividida por dias). */
export const TITULARES_SEPARATOR = ' / ';

export const SOURCE_FIELDS: Record<SourceField, SourceFieldDef> = {
  'demand.id': { label: 'Demanda (DEM-xxxx)', grupo: 'Demanda', get: r => r.demandId },
  'demand.clientDemandId': { label: 'ID SAP / Pedido Cliente', grupo: 'Demanda', get: r => r.clientDemandId || null },
  'demand.local': { label: 'Local do treinamento', grupo: 'Demanda', get: r => r.local },
  'demand.corredor': { label: 'Corredor', grupo: 'Demanda', get: r => r.corredor },
  'demand.uf': { label: 'UF', grupo: 'Demanda', get: r => r.uf },
  'demand.dataInicio': { label: 'Data de início', grupo: 'Demanda', get: r => r.dataInicio },
  'demand.horarioInicio': { label: 'Horário de início', grupo: 'Demanda', get: r => r.horarioInicio },
  'demand.nDias': { label: 'Nº de dias', grupo: 'Demanda', get: r => r.nDias },
  'demand.cargaHoraria': { label: 'Carga horária', grupo: 'Treinamento', get: r => r.cargaHoraria },
  'demand.statusCalculado': { label: 'Status (calculado)', grupo: 'Demanda', get: r => r.statusCalculado },
  'company.name': { label: 'Empresa', grupo: 'Cliente', get: r => r.companyName },
  'training.name': { label: 'Treinamento', grupo: 'Treinamento', get: r => r.trainingName },
  'training.modalidade': { label: 'Modalidade', grupo: 'Treinamento', get: r => r.modalidade ?? null },
  'people.titulares': { label: 'Instrutor(es) titular(es)', grupo: 'Pessoas', get: r => r.titulares.join(TITULARES_SEPARATOR) },
  'expenses.locomocao': { label: 'Despesa: locomoção (reembolsável)', grupo: 'Despesas', get: r => r.despesas.locomocao },
  'expenses.alimentacao': { label: 'Despesa: alimentação (reembolsável)', grupo: 'Despesas', get: r => r.despesas.alimentacao },
  'expenses.hospedagem': { label: 'Despesa: hospedagem (reembolsável)', grupo: 'Despesas', get: r => r.despesas.hospedagem },
  'expenses.outros': { label: 'Despesa: outros (reembolsável)', grupo: 'Despesas', get: r => r.despesas.outros },
  'expenses.total': { label: 'Despesa: total reembolsável', grupo: 'Despesas', get: r => r.despesas.total },
  'measurement.status': { label: 'Status da medição', grupo: 'Medição', get: r => r.medicaoStatus },
};

export const isSourceField = (s: string): s is SourceField =>
  Object.prototype.hasOwnProperty.call(SOURCE_FIELDS, s);
