/**
 * TEMPLATES DE MEDIÇÃO POR EMPRESA — tipos
 *
 * Um template descreve, COMO DADO, o XLSX que um cliente exige para a
 * medição: abas, colunas, de onde cada coluna vem, quais são digitadas,
 * quais são fórmula, e a linha de totais. O primeiro template (Vale) vive em
 * código (`vale.ts`); nada aqui é específico da Vale.
 *
 * Quatro decisões que sustentam a Etapa 3 (upload + mapeamento visual +
 * template no banco) SEM refatoração — não as desfaça por conveniência:
 *
 *   1. FÓRMULAS POR CHAVE, nunca por letra. `={col:cargaHoraria}{row}*
 *      {col:precoHH}{row}`; o resolvedor (`resolve.ts`) troca `{col:key}` pela
 *      letra da coluna NA ORDEM ATUAL do template. Se alguém reordenar ou
 *      inserir uma coluna no mapeamento, a fórmula continua certa. Uma
 *      fórmula com `G2` escrita à mão apontaria para a coluna errada.
 *      Placeholders: `{col:key}`, `{row}` (linha atual), `{first}`/`{last}`
 *      (primeira/última linha de dados — para os totais).
 *
 *   2. `key` ESTÁVEL por coluna. É o `column_key` de
 *      `measurement_template_values` (migration 017) e o identificador que a
 *      tela de mapeamento vai mostrar. Cabeçalho pode mudar; key, não.
 *
 *   3. `source` de campo do app passa por um CATÁLOGO (`sourceFields.ts`,
 *      `SOURCE_FIELDS`): união fechada de strings com rótulo e getter. É a
 *      lista que a UI de mapeamento oferece; um campo novo entra no catálogo,
 *      não no template.
 *
 *   4. A ABA tem forma explícita: `kind: 'rows'` (uma linha por item do
 *      `rowScope`) ou `kind: 'static'` (copiada do arquivo-base, como a aba
 *      Plantas), linha do cabeçalho, primeira linha de dados, totais e, quando
 *      há arquivo-base, o trecho pré-formatado do arquivo (`file`).
 *
 * O QUE A ETAPA 3 VAI ACRESCENTAR (e só isso):
 *   • `origin: 'db'` com o template carregado de `measurement_templates`
 *     (json com este mesmo shape) — hoje só `'code'`;
 *   • `baseFile` apontando para o storage em vez de `public/templates/`;
 *   • FK `measurement_template_values.template_id -> measurement_templates`,
 *     com NOT VALID (os ids de código, ex. 'vale-v1', ganham linha na tabela
 *     antes da validação);
 *   • `rowScope: 'person'` quando algum cliente pedir linha por pessoa.
 *
 * Este diretório não importa React, Supabase nem ExcelJS (guarda de fonte no
 * smoke:medicao-vale). O escritor é services/exports/templateXlsxWriter.ts.
 */
import type { CellValue } from '../types';
import type { SourceField } from './sourceFields';

/** Valor de célula do template: o do motor mais Date (formato 'date' grava data de verdade). */
export type TemplateCellValue = CellValue | Date;

export type TemplateFormat =
  | 'currency'
  | 'percent'
  | 'date'
  | 'time'
  | 'hours'
  | 'integer'
  | 'text';

export type TemplateColumnSource = SourceField | 'manual' | 'formula' | 'sequence';

export type TemplatePersistScope = 'training' | 'demand';

export interface TemplateColumn {
  /** Estável: é o column_key da persistência e o id no mapeamento. */
  key: string;
  /** Texto EXATO do cabeçalho no arquivo do cliente (inclusive espaços). */
  header: string;
  source: TemplateColumnSource;
  /** Só com source 'formula'. Com placeholders — ver o cabeçalho. */
  formula?: string;
  format?: TemplateFormat;
  /** Valor quando ninguém digitou (ex.: 0.2 para o % de despesa; 0 para combustível). */
  defaultValue?: TemplateCellValue;
  /** Aparece como célula editável na prévia. */
  editable?: boolean;
  /**
   * Onde o valor digitado é guardado (migration 017). 'training' = vale para
   * toda demanda daquele treinamento (o preço HH); 'demand' = só aquela demanda.
   */
  persistScope?: TemplatePersistScope;
  /**
   * Coluna com persistScope 'training' que admite SOBRESCRITA por demanda:
   * o valor da demanda vence o do treinamento. Só faz sentido com 'training'.
   */
  overrideScope?: 'demand';
  /** Célula em amarelo quando sai vazia (ID SAP, preço HH). */
  highlightWhenEmpty?: boolean;
  /** Largura sugerida quando NÃO há arquivo-base (com base, a largura vem do arquivo). */
  width?: number;
}

export interface TemplateTotals {
  /** Chaves das colunas que recebem SUM({col}{first}:{col}{last}). */
  sumColumns: string[];
}

/**
 * O trecho pré-formatado da aba no ARQUIVO-BASE, para o escritor saber o que
 * reaproveitar (estilo da 1ª linha de dados e da linha de totais) e o que
 * remover (linhas sobrando).
 */
export interface TemplateSheetFileLayout {
  firstDataRow: number;
  lastDataRow: number;
  totalsRow: number;
}

/* ───────────────────── folha 'form' (documento assinável, ex. BM) ───────────────────── */

/**
 * Célula endereçada por posição fixa no arquivo do cliente ('F13'). A
 * mesclagem vem do arquivo-base e não é tocada. `source`:
 *   • 'context'   — cadastro por contexto (measurement_template_values, escopo
 *                   'context', chave "<corredor>|<mina>"), lido por `key`;
 *   • 'manual'    — digitado na tela para esta geração, não persistido;
 *   • 'periodo'   — rótulo do período do filtro ('dd/mm/yyyy a dd/mm/yyyy');
 *   • 'dataEnvio' — data de envio (hoje por padrão, editável), formato date.
 */
export type TemplateFormCellSource = 'context' | 'manual' | 'periodo' | 'dataEnvio';

export interface TemplateFormCell {
  key: string;
  /** Endereço no arquivo ('F13'). Numa mesclagem, a célula superior esquerda. */
  cell: string;
  source: TemplateFormCellSource;
  format?: TemplateFormat;
  defaultValue?: TemplateCellValue;
  highlightWhenEmpty?: boolean;
  /** Rótulo na tela (bloco "Cabeçalho"). */
  label?: string;
}

/**
 * Coluna da REGIÃO de linhas dentro da folha form. Aqui a letra vem do
 * arquivo (`col`), porque a folha é posicional — diferente da aba de linhas,
 * onde a letra segue a ordem do template. Fórmulas continuam por chave
 * (`{col:key}`), resolvidas para a letra da coluna.
 */
export interface TemplateRegionColumn {
  key: string;
  col: string;
  source: 'field' | 'formula' | 'constant';
  /** 'field': campo da linha agregada (default = key). */
  field?: string;
  formula?: string;
  /** 'constant': valor fixo em toda linha. */
  value?: TemplateCellValue;
  format?: TemplateFormat;
  highlightWhenEmpty?: boolean;
}

export interface TemplateRowRegion {
  /** 'training' = uma linha por treinamento agregado (+ preço). */
  rowScope: 'training';
  firstRow: number;
  /** Última linha pré-formatada no arquivo; acima disso o escritor insere linhas. */
  lastRowInFile: number;
  /** Linha do total no arquivo (é deslocada quando há inserção). */
  totalsRowInFile: number;
  columns: TemplateRegionColumn[];
  /** Mesclagens por linha, em letras ('C:E'), recriadas nas linhas inseridas. */
  mergeCols: string[];
  /** Célula do total (coluna) e a fórmula com {first}/{last}. Sempre reescrita. */
  totals: { col: string; formula: string };
  /** Colunas cujos valores são limpos nas linhas pré-formatadas não usadas. */
  clearCols?: string[];
}

/** Campo do cadastro por contexto que a tela oferece (bloco "Cabeçalho"). */
export interface TemplateContextField {
  key: string;
  label: string;
  defaultValue?: string;
}

export interface TemplateSheet {
  /** Nome EXATO da aba no arquivo do cliente. */
  name: string;
  kind: 'rows' | 'static' | 'form';
  /** 'form': células endereçadas. */
  cells?: TemplateFormCell[];
  /** 'form': região de linhas (opcional). */
  region?: TemplateRowRegion;
  /** 'rows': o que vira linha. F1/Etapa 2: uma linha por demanda. */
  rowScope?: 'demand';
  /** 'rows': linha do cabeçalho (1 quando não há título acima). */
  headerRow?: number;
  /** 'rows': primeira linha de dados. */
  firstDataRow?: number;
  columns?: TemplateColumn[];
  totals?: TemplateTotals;
  /** 'rows' com arquivo-base: o layout pré-formatado que o arquivo traz. */
  file?: TemplateSheetFileLayout;
  /** 'static': de onde vem o conteúdo. Hoje só do arquivo-base. */
  staticFrom?: 'file';
}

export interface TemplateCompanyMatch {
  /** id em `companies`, quando conhecido (Etapa 3: escolhido na UI). */
  id?: string;
  /**
   * Trecho do nome, comparado em maiúsculas — a MESMA regra do formulário de
   * demanda para mostrar o campo "ID SAP / Pedido Cliente" (Demands.tsx,
   * `isValeSelected`). O id da Vale não é conhecido em código.
   */
  nameIncludes?: string;
}

export interface MeasurementTemplate {
  /** 'vale-v1' — vai para measurement_template_values.template_id. */
  id: string;
  version: number;
  origin: 'code' | 'db';
  label: string;
  company: TemplateCompanyMatch;
  sheets: TemplateSheet[];
  /** Caminho público do arquivo-base (fetch). Ausente = gera do zero. */
  baseFile?: string;
  fileNameBase: string;
  /** Texto fixo que a aba mostra (diferenças de regra, ex.: período por data de início). */
  notes?: string[];
  /**
   * Constantes de regra do template, trocáveis em uma linha (ex.:
   * `despesasComAcrescimo: true` no BM). Não são campos por demanda.
   */
  constants?: Record<string, string | number | boolean>;
  /** Campos do cadastro por contexto ("<corredor>|<mina>") que a tela oferece. */
  contextFields?: TemplateContextField[];
}

/* ─────────────────────────── saída do resolvedor ─────────────────────────── */

export interface ResolvedCell {
  value?: TemplateCellValue;
  formula?: string;
  format?: TemplateFormat;
  editable?: boolean;
  /** Pintar em amarelo (editável e vazia). */
  highlight?: boolean;
}

export interface ResolvedColumn {
  key: string;
  header: string;
  /** Letra na ordem atual do template ('A', 'B', ... 'AA'). */
  letter: string;
  format?: TemplateFormat;
  editable?: boolean;
}

export interface ResolvedRowsSheet {
  name: string;
  kind: 'rows';
  headerRow: number;
  firstDataRow: number;
  columns: ResolvedColumn[];
  rows: ResolvedCell[][];
  /** Uma célula por coluna; `null` onde não há total. Ausente = sem linha de totais. */
  totalsRow?: (ResolvedCell | null)[];
  file?: TemplateSheetFileLayout;
}

export interface ResolvedStaticSheet {
  name: string;
  kind: 'static';
  staticFrom: 'file';
}

export interface ResolvedFormCell {
  address: string;
  value?: TemplateCellValue;
  formula?: string;
  format?: TemplateFormat;
  highlight?: boolean;
}

export interface ResolvedRegion {
  firstRow: number;
  lastRowInFile: number;
  totalsRowInFile: number;
  /** Quantas linhas pré-formatadas o arquivo traz. */
  capacity: number;
  /** Linhas a inserir antes do total (0 quando cabe). */
  extraRows: number;
  /** Linha do total DEPOIS da inserção. */
  totalsRow: number;
  /** Última linha da faixa somada (totalsRow − 1). */
  lastRow: number;
  mergeCols: string[];
  clearCols: string[];
  /** Uma linha = células por coluna (letra). */
  rows: { col: string; cell: ResolvedCell }[][];
  totalsCell: { col: string; formula: string };
}

export interface ResolvedFormSheet {
  name: string;
  kind: 'form';
  cells: ResolvedFormCell[];
  region?: ResolvedRegion;
}

export type ResolvedSheet = ResolvedRowsSheet | ResolvedStaticSheet | ResolvedFormSheet;
