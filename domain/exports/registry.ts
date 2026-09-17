/**
 * MOTOR DE EXPORTAÇÃO — registro dos datasets
 *
 * F1: Medições e Demandas. Etapa 2: Medição Vale e BM Vale (templates).
 * 17/09/2026: Logística. Módulos novos entram aqui, com `requiredView`.
 *
 * ⚠️ ACESSO — DEFESA DE UI, NÃO DE BANCO
 * ---------------------------------------------------------------------------
 * `requiredView` é a view de `ROLE_PERMISSIONS` (App.tsx) que o perfil precisa
 * ter para VER o dataset na aba Exportações. Hoje o analista não tem
 * 'measurement', então não vê Medições; o coordenador não tem 'exportacoes' e
 * não vê a aba. Isso reproduz o gate que a UI já aplica em cada tela.
 *
 * O BANCO não sabe disso: todas as policies de SELECT são "qualquer
 * autenticado" (migrations 003, 007, 012, 016 e as não versionadas de
 * `measurements`/`instructors`/`companies`), sem filtro por papel ou coluna.
 * Um analista com a sessão aberta consegue ler `measurements` pela API. RLS por
 * papel é migration e pertence à leva de segurança — fora da F1. Enquanto isso,
 * este registro é o ÚNICO ponto que decide o que cada perfil baixa por aqui, e
 * é por isso que a checagem fica em dado (registry) e não espalhada na tela.
 */
import { MEDICOES_DATASET } from './datasets/medicoes';
import { DEMANDAS_DATASET } from './datasets/demandas';
import { LOGISTICA_DATASET } from './datasets/logistica';
import { VALE_TEMPLATE } from './templates/vale';
import { VALE_BM_TEMPLATE } from './templates/vale-bm';
import type { MeasurementTemplate } from './templates/types';
import type { OptionKey } from './options';
import type { DatasetDef, DatasetKey, FilterKey, FilterableRow } from './types';

export type AnyDataset = DatasetDef<any>;

/**
 * Dataset de TEMPLATE (Etapa 2): gera o XLSX no layout do cliente em vez de
 * uma tabela de colunas livres. Mesmo gate (`requiredView`), mesmos filtros e
 * opções do motor; o que muda é o caminho de saída (templateXlsxWriter).
 */
export interface TemplateDatasetDef {
  kind: 'template';
  key: DatasetKey;
  label: string;
  description: string;
  requiredView: string;
  filters: FilterKey[];
  options: OptionKey[];
  template: MeasurementTemplate;
  /**
   * Templates cujos valores manuais a tela precisa carregar. Default =
   * [template.id]. O BM lê os preços do vale-v1 e o cabeçalho do vale-bm-v1.
   */
  templateIds?: string[];
}

export type ExportDatasetEntry = AnyDataset | TemplateDatasetDef;

export const isTemplateDataset = (d: ExportDatasetEntry): d is TemplateDatasetDef =>
  (d as TemplateDatasetDef).kind === 'template';

export const MEDICAO_VALE_DATASET: TemplateDatasetDef = {
  kind: 'template',
  key: 'medicao-vale',
  label: 'Medição Vale',
  description:
    'Planilha no modelo da Vale: uma turma por demanda concluída, com preço HH, despesas reembolsáveis e a aba Plantas.',
  requiredView: 'measurement',
  filters: ['periodoInicio', 'corredor', 'site', 'statusMedicao'],
  options: ['incluirCanceladas'],
  template: VALE_TEMPLATE,
};

export const VALE_BM_DATASET: TemplateDatasetDef = {
  kind: 'template',
  key: 'vale-bm',
  label: 'BM Vale',
  description:
    'Boletim de Medição no modelo da Vale: a mesma seleção da Medição Vale agregada por treinamento, um BM por (corredor, mina).',
  requiredView: 'measurement',
  filters: ['periodoInicio', 'corredor', 'site', 'statusMedicao'],
  options: ['incluirCanceladas'],
  template: VALE_BM_TEMPLATE,
  templateIds: [VALE_TEMPLATE.id, VALE_BM_TEMPLATE.id],
};

export const EXPORT_DATASETS: ExportDatasetEntry[] = [
  MEDICOES_DATASET,
  DEMANDAS_DATASET,
  LOGISTICA_DATASET,
  MEDICAO_VALE_DATASET,
  VALE_BM_DATASET,
];

export const templateIdsOf = (d: TemplateDatasetDef): string[] => d.templateIds ?? [d.template.id];

export function getDataset(key: DatasetKey): ExportDatasetEntry {
  const d = EXPORT_DATASETS.find(x => x.key === key);
  if (!d) throw new Error(`Dataset desconhecido: ${key}`);
  return d;
}

/**
 * Os datasets que um perfil pode ver, dado o predicado de acesso do App
 * (`canAccessView(role, view)`), injetado para o domínio não conhecer papéis.
 */
export function visibleDatasets(canAccessView: (view: string) => boolean): ExportDatasetEntry[] {
  return EXPORT_DATASETS.filter(d => canAccessView(d.requiredView));
}

/** Guarda de tipo para chamadas genéricas. */
export const isFilterableRow = (r: unknown): r is FilterableRow =>
  !!r && typeof r === 'object' && 'demand' in (r as any);
