/**
 * MOTOR DE EXPORTAÇÃO — registro dos datasets
 *
 * F1: Medições e Demandas. Etapa 2: Medição Vale e BM Vale (templates).
 * 17/09/2026: Logística, Instrutores e Despesas. Módulos novos entram aqui, com `requiredView`.
 *
 * 18/09/2026 — O REGISTRO DEIXOU DE SER SÓ UMA CONSTANTE. `EXPORT_DATASETS`
 * continua sendo os sete módulos de CÓDIGO, imutável e na ordem de sempre; e
 * `buildRegistry(modelosDoBanco)` acrescenta, DEPOIS deles, um módulo por
 * modelo de medição ativo (migration 022). `buildRegistry([])` é idêntico a
 * `EXPORT_DATASETS` — é o que garante que ligar o mecanismo não mexe em nada
 * para quem ainda não cadastrou modelo nenhum.
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
import { INSTRUTORES_DATASET } from './datasets/instrutores';
import { DESPESAS_DATASET } from './datasets/despesas';
import { VALE_TEMPLATE } from './templates/vale';
import { VALE_BM_TEMPLATE } from './templates/vale-bm';
import type { MeasurementTemplate } from './templates/types';
import { validarTemplate } from './templates/validate';
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
  /**
   * Presente = o módulo APARECE na lista, desabilitado, e este texto diz o que
   * falta. Ver `buildRegistry`. Ausente = o módulo gera normalmente.
   */
  indisponivel?: string;
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
  INSTRUTORES_DATASET,
  DESPESAS_DATASET,
  MEDICAO_VALE_DATASET,
  VALE_BM_DATASET,
];

export const templateIdsOf = (d: TemplateDatasetDef): string[] => d.templateIds ?? [d.template.id];

/* ─────────────────── módulos por empresa, vindos do banco ─────────────────── */

/**
 * Um modelo ATIVO vira um módulo de medição da empresa dele. Os de CÓDIGO vêm
 * primeiro, sempre: são os oito que existem desde a F1, e a ordem deles é
 * conhecida de quem usa a aba todo dia.
 *
 * MODELO ATIVO MAS INCOMPLETO APARECE DESABILITADO, COM O MOTIVO — não some.
 * Sumir seria a pior das opções: quem acabou de configurar o modelo abriria a
 * aba, não o encontraria, e não teria como saber se esqueceu de ativar, se não
 * tem permissão ou se o app está quebrado. Aparecendo apagado com "falta
 * enviar a planilha-base", a resposta está na mesma tela em que a pessoa já
 * está. O que não pode — e não acontece — é aparecer habilitado e falhar na
 * geração: `indisponivel` é justamente o que a tela usa para travar.
 *
 * Ordenados pelo RÓTULO, que é "Medição <Empresa>": como o prefixo é igual em
 * todos, ordenar por ele é ordenar pelo nome da empresa. Um modelo ativo por
 * empresa (índice único da 022), então cada empresa aparece uma vez só.
 */
export function buildRegistry(dbTemplates: MeasurementTemplate[]): ExportDatasetEntry[] {
  const doBanco = dbTemplates
    .filter(t => t.origin === 'db')
    .map(templateDataset)
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return [...EXPORT_DATASETS, ...doBanco];
}

/** O que falta para este modelo gerar, em português. `null` = está pronto. */
export function motivoIndisponivel(t: MeasurementTemplate): string | null {
  const aba = t.sheets.find(s => s.kind === 'rows');
  if (!aba || (aba.columns ?? []).length === 0) {
    return 'Falta configurar o mapeamento das colunas.';
  }
  if (!t.baseFile) {
    return 'Falta enviar a planilha-base que a empresa usa na medição.';
  }
  const { podeGerar, problemas } = validarTemplate(t);
  if (!podeGerar) {
    const bloqueios = problemas.filter(p => p.severidade === 'bloqueio');
    const primeiro = bloqueios[0]?.texto ?? 'O mapeamento precisa de conserto.';
    return bloqueios.length > 1
      ? `${primeiro} (e mais ${bloqueios.length - 1} problema(s) no mapeamento.)`
      : primeiro;
  }
  return null;
}

function templateDataset(t: MeasurementTemplate): TemplateDatasetDef {
  const indisponivel = motivoIndisponivel(t);
  return {
    kind: 'template',
    key: t.id as DatasetKey,
    label: t.label,
    description: indisponivel
      ? `Modelo de medição configurado para esta empresa. ${indisponivel}`
      : 'Planilha de medição no modelo desta empresa: uma turma por demanda concluída, no recorte do período.',
    // O mesmo gate dos módulos de medição em código: o analista não tem esta
    // view, então não vê modelo de empresa nenhum.
    requiredView: 'measurement',
    filters: ['periodoInicio', 'corredor', 'site', 'statusMedicao'],
    options: ['incluirCanceladas'],
    template: t,
    ...(indisponivel ? { indisponivel } : {}),
  };
}

/**
 * Busca a entrada pela chave. Recebe a LISTA — com os módulos por empresa, o
 * registro deixou de ser uma constante. O default mantém quem só conhece os de
 * código (a aba de hoje) funcionando sem mudar nada.
 */
export function getDataset(key: DatasetKey, datasets: ExportDatasetEntry[] = EXPORT_DATASETS): ExportDatasetEntry {
  const d = datasets.find(x => x.key === key);
  if (!d) throw new Error(`Dataset desconhecido: ${key}`);
  return d;
}

/**
 * Os datasets que um perfil pode ver, dado o predicado de acesso do App
 * (`canAccessView(role, view)`), injetado para o domínio não conhecer papéis.
 */
export function visibleDatasets(
  canAccessView: (view: string) => boolean,
  datasets: ExportDatasetEntry[] = EXPORT_DATASETS
): ExportDatasetEntry[] {
  return datasets.filter(d => canAccessView(d.requiredView));
}

/** Guarda de tipo para chamadas genéricas. */
export const isFilterableRow = (r: unknown): r is FilterableRow =>
  !!r && typeof r === 'object' && 'demand' in (r as any);
