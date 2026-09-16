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

export type DatasetKey = 'medicoes' | 'demandas' | 'medicao-vale';

export type FilterKey =
  | 'periodo'
  /** Período pela DATA DE INÍCIO dentro do intervalo (Medição Vale), não por interseção. */
  | 'periodoInicio'
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
  | 'statusMedicao';

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
};

/** Cabeçalho + matriz, prontos para qualquer escritor. */
export interface ExportTable {
  columns: { key: string; header: string; kind: CellKind; width?: number }[];
  rows: CellValue[][];
}
