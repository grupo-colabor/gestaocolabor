/**
 * TEMPLATES DE MEDIÇÃO — resolvedor (puro)
 *
 * Transforma template + linhas do dataset + valores manuais em células
 * prontas para o escritor: valor ou fórmula, formato, editável, destaque.
 * Nada de ExcelJS aqui — o smoke confere a saída sem abrir arquivo.
 *
 * Fórmulas: `{col:key}` vira a letra da coluna na ordem ATUAL do template,
 * `{row}` a linha da célula, `{first}`/`{last}` a faixa de dados. Chave
 * desconhecida é erro (é bug de template, não entrada de usuário).
 */
import { SOURCE_FIELDS, isSourceField, type TemplateRowInput } from './sourceFields';
import { getTemplateValue, type TemplateValuesIndex, type TemplateValue } from './values';
import type {
  MeasurementTemplate,
  ResolvedCell,
  ResolvedColumn,
  ResolvedRowsSheet,
  ResolvedSheet,
  TemplateCellValue,
  TemplateColumn,
  TemplateSheet,
} from './types';

/** 0 -> 'A', 25 -> 'Z', 26 -> 'AA'. */
export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function resolveColumns(sheet: TemplateSheet): ResolvedColumn[] {
  const cols = sheet.columns ?? [];
  const keys = new Set<string>();
  return cols.map((c, i) => {
    if (keys.has(c.key)) throw new Error(`Template: chave de coluna repetida "${c.key}" na aba ${sheet.name}`);
    keys.add(c.key);
    return { key: c.key, header: c.header, letter: columnLetter(i), format: c.format, editable: c.editable };
  });
}

export interface FormulaContext {
  row?: number;
  first?: number;
  last?: number;
}

/** '={col:a}{row}*{col:b}{row}' -> 'G5*H5' (sem o '=' inicial — o ExcelJS não o quer). */
export function resolveFormula(
  formula: string,
  columns: ResolvedColumn[],
  ctx: FormulaContext
): string {
  const letterOf = new Map(columns.map(c => [c.key, c.letter]));
  let out = formula.trim();
  if (out.startsWith('=')) out = out.slice(1);
  out = out.replace(/\{col:([^}]+)\}/g, (_, key: string) => {
    const letter = letterOf.get(key);
    if (!letter) throw new Error(`Template: fórmula referencia coluna desconhecida "${key}"`);
    return letter;
  });
  const need = (name: keyof FormulaContext) => {
    const v = ctx[name];
    if (v === undefined) throw new Error(`Template: fórmula usa {${name}} sem contexto`);
    return String(v);
  };
  out = out.replace(/\{row\}/g, () => need('row'));
  out = out.replace(/\{first\}/g, () => need('first'));
  out = out.replace(/\{last\}/g, () => need('last'));
  if (/\{[a-z:]+\}/i.test(out)) throw new Error(`Template: placeholder não resolvido em "${formula}"`);
  return out;
}

/* ───────────────────────── valores manuais ───────────────────────── */

export type ManualValueSource = 'demanda' | 'treinamento' | 'padrão' | 'vazio';

export interface ManualValueResolution {
  value: TemplateCellValue;
  fonte: ManualValueSource;
}

export interface ManualRefs {
  trainingId: string;
  demandId: string;
}

/**
 * O valor de uma coluna manual para uma linha: sobrescrita da demanda vence o
 * valor do treinamento, que vence o default, que vence o vazio. `fonte` é a
 * coluna "fonte do preço" da grade da prévia.
 */
export function resolveManualValue(
  column: TemplateColumn,
  refs: ManualRefs,
  values: TemplateValuesIndex
): ManualValueResolution {
  const presente = (v: TemplateValue | undefined): v is TemplateValue =>
    v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

  if (column.persistScope === 'training') {
    if (column.overrideScope === 'demand') {
      const porDemanda = getTemplateValue(values, 'demand', refs.demandId, column.key);
      if (presente(porDemanda)) return { value: porDemanda, fonte: 'demanda' };
    }
    const porTreinamento = refs.trainingId
      ? getTemplateValue(values, 'training', refs.trainingId, column.key)
      : undefined;
    if (presente(porTreinamento)) return { value: porTreinamento, fonte: 'treinamento' };
  } else if (column.persistScope === 'demand') {
    const porDemanda = getTemplateValue(values, 'demand', refs.demandId, column.key);
    if (presente(porDemanda)) return { value: porDemanda, fonte: 'demanda' };
  }
  if (column.defaultValue !== undefined && column.defaultValue !== null) {
    return { value: column.defaultValue, fonte: 'padrão' };
  }
  return { value: null, fonte: 'vazio' };
}

/* ─────────────────────────── aba de linhas ─────────────────────────── */

export interface RowsSheetInput {
  /** A linha do dataset, na ordem em que sai na planilha. */
  input: TemplateRowInput;
  refs: ManualRefs;
}

const isEmpty = (v: TemplateCellValue | undefined): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function resolveRowsSheet(
  sheet: TemplateSheet,
  rows: RowsSheetInput[],
  values: TemplateValuesIndex
): ResolvedRowsSheet {
  if (sheet.kind !== 'rows') throw new Error(`Template: aba ${sheet.name} não é de linhas`);
  const columns = resolveColumns(sheet);
  const headerRow = sheet.headerRow ?? 1;
  const firstDataRow = sheet.firstDataRow ?? headerRow + 1;
  const lastDataRow = firstDataRow + rows.length - 1;
  const cols = sheet.columns ?? [];

  const resolvedRows: ResolvedCell[][] = rows.map((r, i) => {
    const rowNumber = firstDataRow + i;
    return cols.map((c): ResolvedCell => {
      const base: ResolvedCell = { format: c.format, editable: c.editable };
      if (c.source === 'sequence') return { ...base, value: i + 1 };
      if (c.source === 'formula') {
        if (!c.formula) throw new Error(`Template: coluna ${c.key} é fórmula sem texto`);
        return { ...base, formula: resolveFormula(c.formula, columns, { row: rowNumber, first: firstDataRow, last: lastDataRow }) };
      }
      let value: TemplateCellValue;
      if (c.source === 'manual') {
        value = resolveManualValue(c, r.refs, values).value;
      } else if (isSourceField(c.source)) {
        value = SOURCE_FIELDS[c.source].get(r.input);
        if (isEmpty(value) && c.defaultValue !== undefined) value = c.defaultValue;
      } else {
        throw new Error(`Template: source desconhecido "${c.source}" na coluna ${c.key}`);
      }
      return { ...base, value, highlight: !!c.highlightWhenEmpty && isEmpty(value) };
    });
  });

  let totalsRow: (ResolvedCell | null)[] | undefined;
  if (sheet.totals) {
    const soma = new Set(sheet.totals.sumColumns);
    for (const k of soma) {
      if (!columns.some(c => c.key === k)) throw new Error(`Template: total em coluna desconhecida "${k}"`);
    }
    totalsRow = cols.map((c): ResolvedCell | null => {
      if (!soma.has(c.key)) return null;
      if (rows.length === 0) return { value: 0, format: c.format };
      return {
        formula: resolveFormula(`SUM({col:${c.key}}{first}:{col:${c.key}}{last})`, columns, { first: firstDataRow, last: lastDataRow }),
        format: c.format,
      };
    });
  }

  return { name: sheet.name, kind: 'rows', headerRow, firstDataRow, columns, rows: resolvedRows, totalsRow, file: sheet.file };
}

export function resolveTemplate(
  template: MeasurementTemplate,
  rows: RowsSheetInput[],
  values: TemplateValuesIndex
): ResolvedSheet[] {
  return template.sheets.map(s =>
    s.kind === 'static'
      ? { name: s.name, kind: 'static', staticFrom: s.staticFrom ?? 'file' }
      : resolveRowsSheet(s, rows, values)
  );
}

/** As colunas editáveis de uma aba de linhas, para a grade da prévia. */
export function editableColumns(sheet: TemplateSheet): TemplateColumn[] {
  return (sheet.columns ?? []).filter(c => c.editable && c.source === 'manual');
}
