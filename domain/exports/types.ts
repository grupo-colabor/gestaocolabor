/**
 * MOTOR DE EXPORTAÇÃO — tipos
 *
 * Um DATASET é uma lista de LINHAS já resolvidas (domínio) mais a lista de
 * COLUNAS que sabem ler cada linha. O usuário escolhe e ordena colunas; o
 * escritor (XLSX/CSV) só recebe cabeçalho + matriz de células. Nenhuma conta
 * acontece aqui: as linhas chegam prontas de `datasets/*`, que por sua vez só
 * chamam o domínio de medição (measurementTotals, measurementOverrides,
 * instructorHours). O exportador não recalcula nada.
 *
 * Este diretório NÃO importa React, Supabase nem ExcelJS (guarda de fonte no
 * smoke:exportacoes). I/O mora em services/exports/.
 */
import type { Demand } from '../../types';
import type { MeasurementRole } from '../measurementTotals';
import type { OptionKey } from './options';

/** O que uma célula pode carregar. `null` = em branco ("não se aplica"), NUNCA zero. */
export type CellValue = string | number | boolean | null;

/**
 * Como a célula deve ser escrita:
 *   • number   → número puro (horas, contagens);
 *   • currency → número com formato monetário no XLSX, 2 casas no CSV;
 *   • date     → string 'dd/mm/yyyy' já formatada (nunca Date, nunca fuso);
 *   • boolean  → 'Sim'/'Não' na escrita.
 */
export type CellKind = 'text' | 'number' | 'currency' | 'hours' | 'date' | 'boolean';

export interface ColumnDef<Row> {
  /** Chave estável — é o que a seleção do usuário guarda. Única no dataset. */
  key: string;
  header: string;
  kind: CellKind;
  /** Nasce ligada na seleção inicial? */
  defaultOn: boolean;
  /** Largura sugerida no XLSX (caracteres). */
  width?: number;
  /** Uma frase para o tooltip do seletor de colunas. */
  help?: string;
  get: (row: Row) => CellValue;
}

/**
 * Os módulos de CÓDIGO têm chave fixa; um módulo por empresa (migration 022)
 * tem a chave do modelo dele, que é sempre `tpl:<uuid>` (mapping.ts,
 * `templateIdOf`) — o prefixo é o que impede colisão com as fixas.
 */
export type DatasetKeyEstatica = 'medicoes' | 'demandas' | 'medicao-vale' | 'vale-bm' | 'logistica' | 'instrutores' | 'despesas';

export type DatasetKey = DatasetKeyEstatica | `tpl:${string}`;

export const isDatasetDeEmpresa = (k: DatasetKey): k is `tpl:${string}` => k.startsWith('tpl:');

export type FilterKey =
  | 'periodo'
  /**
   * Período pela DATA DE TÉRMINO da turma dentro do intervalo (Medição Vale),
   * não por interseção. Cada turma tem UMA data de fim, então cai em
   * exatamente uma medição — nunca em duas.
   */
  | 'periodoFim'
  | 'status'
  | 'modalidade'
  | 'tipo'
  | 'uf'
  | 'cliente'
  | 'instrutor'
  | 'papel'
  | 'corredor'
  | 'site'
  /** Status da medição, multi-seleção; 'SEM_MEDICAO' = demanda sem linha em measurements. */
  | 'statusMedicao'
  /** Modo de transporte do bloco (Logística) — só linhas de Locomoção têm modo. */
  | 'modoTransporte'
  /** "Só com pendência de documento" (Logística). */
  | 'pendenciaDoc'
  /** Categoria do item (Despesas): as seis do painel. */
  | 'categoriaDespesa'
  /** Flag "Vale não reembolsa" (Despesas): sim/não. */
  | 'flagNaoReembolsa'
  /** Flag "Pago pelo instrutor" (Despesas): sim/não. */
  | 'flagPagoInstrutor';

export const SEM_MEDICAO = 'SEM_MEDICAO';

/**
 * Toda linha exportável carrega a demanda de origem (é sobre ela que período,
 * status, modalidade, tipo, UF e cliente filtram) e, quando é uma linha de
 * pessoa, quem é a pessoa e o papel dela.
 */
export interface FilterableRow {
  demand: Demand;
  instructorId?: string;
  papel?: MeasurementRole;
  /** Status da medição da demanda; vazio/ausente = sem medição aberta. */
  medicaoStatus?: string;
  /** Chave crua do modo de transporte da linha (bloco de Locomoção); ausente = a linha não tem modo. */
  modoTransporte?: string;
  /** A linha tem documento pendente (Logística). */
  pendenciaDoc?: boolean;
  /** Chave crua da categoria do item (Despesas). */
  categoriaDespesa?: string;
  /** Flags do item (Despesas). */
  naoReembolsa?: boolean;
  pagoPeloInstrutor?: boolean;
}

export interface DatasetDef<Row extends FilterableRow> {
  key: DatasetKey;
  label: string;
  description: string;
  /**
   * View do App (`ROLE_PERMISSIONS`) que o perfil precisa ter para VER este
   * dataset. Ver o comentário em registry.ts: é defesa de UI, não de banco.
   */
  requiredView: string;
  /** Filtros que fazem sentido para este dataset — a UI só mostra estes. */
  filters: FilterKey[];
  /** Opções marcáveis (domain/exports/options.ts) que este dataset oferece. */
  options: OptionKey[];
  columns: ColumnDef<Row>[];
  /** Prefixo do nome do arquivo. */
  fileBase: string;
}

export interface ExportFilters {
  /** 'YYYY-MM-DD' ou ''. Seleciona demandas que INTERSECTAM o intervalo; não rateia. */
  dataInicio: string;
  dataFim: string;
  /** DemandStatus calculado, ou '' = todos. */
  status: string;
  /** Chave canônica de modalidade (domain/modalityOptions), ou ''. */
  modalidade: string;
  tipo: '' | 'cliente' | 'interna';
  /** `demands.demand_state`, ou ''. */
  uf: string;
  /** `demands.company_id`, ou ''. */
  companyId: string;
  /** Só em datasets de pessoa. */
  instructorId: string;
  papel: '' | MeasurementRole;
  /** `demands.corredor`, ou ''. */
  corredor: string;
  /** `demands.training_local` (site/planta), ou ''. */
  site: string;
  /** Status da medição (multi). Vazio = todos. Aceita SEM_MEDICAO. */
  statusMedicao: string[];
  /** Chave crua de `transport_mode` (Logística), ou ''. */
  modoTransporte: string;
  /** Logística: só linhas com documento pendente. */
  somentePendenciaDoc: boolean;
  /** Despesas: chave da categoria, ou ''. */
  categoriaDespesa: string;
  /** Despesas: '' = todas, 'sim' / 'nao'. */
  naoReembolsa: '' | 'sim' | 'nao';
  pagoPeloInstrutor: '' | 'sim' | 'nao';
}

export const EMPTY_FILTERS: ExportFilters = {
  dataInicio: '',
  dataFim: '',
  status: '',
  modalidade: '',
  tipo: '',
  uf: '',
  companyId: '',
  instructorId: '',
  papel: '',
  corredor: '',
  site: '',
  statusMedicao: [],
  modoTransporte: '',
  somentePendenciaDoc: false,
  categoriaDespesa: '',
  naoReembolsa: '',
  pagoPeloInstrutor: '',
};

/** Cabeçalho + matriz, prontos para qualquer escritor. */
export interface ExportTable {
  columns: { key: string; header: string; kind: CellKind; width?: number }[];
  rows: CellValue[][];
}
