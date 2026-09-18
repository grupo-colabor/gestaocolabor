/**
 * TEMPLATES DE MEDIÇÃO — resolvedor (puro)
 *
 * Transforma template + linhas do dataset + valores manuais em células
 * prontas para o escritor: valor ou fórmula, formato, editável, destaque.
 * Nada de ExcelJS aqui — o smoke confere a saída sem abrir arquivo.
 *
 * Fórmulas: `{col:key}` vira a letra da coluna na ordem ATUAL do template,
 * `{row}` a linha da célula, `{first}`/`{last}` a faixa de dados, e
 * `{const:nome}` o LITERAL da constante do modelo (0.2, "texto", TRUE).
 *
 * DOIS MODOS, e a diferença importa (18/09/2026):
 *
 *   • template em CÓDIGO (`origin: 'code'`) — chave desconhecida, source
 *     inválido, total sobre coluna que não existe: tudo LANÇA. Ali é bug de
 *     quem escreveu o template, e falhar alto é o certo. Nada mudou.
 *
 *   • template do BANCO (`origin: 'db'`) — os mesmos casos são CONFIGURAÇÃO
 *     VELHA, não bug: alguém apagou uma coluna que uma conta usava, ou o app
 *     perdeu um campo que o mapeamento apontava. Vira `ResolveProblem` em
 *     português, a célula sai em branco, e quem chama BLOQUEIA a geração. Uma
 *     exceção na cara de quem está usando a tela seria a resposta errada.
 *
 * O modo tolerante liga com `ResolveContext.problems` presente —
 * `resolveTemplateWithProblems` cria o coletor sozinho quando o template é do
 * banco. Não existe caminho em que um problema de template do banco vire
 * exceção nem em que ele se perca em silêncio.
 */
import { compileFormulaSpec, formulaLiteral, validateFormulaSpec } from './formula';
import { SOURCE_FIELDS, isSourceField, type TemplateRowInput } from './sourceFields';
import { getTemplateValue, type TemplateValuesIndex, type TemplateValue } from './values';
import type {
  MeasurementTemplate,
  ResolvedCell,
  ResolvedColumn,
  ResolvedFormCell,
  ResolvedFormSheet,
  ResolvedRegion,
  ResolvedRowsSheet,
  ResolvedSheet,
  TemplateCellValue,
  TemplateColumn,
  TemplateConstantValue,
  TemplateSheet,
} from './types';

/* ─────────────────── problemas de configuração (modo tolerante) ─────────────────── */

/**
 * Um defeito de CONFIGURAÇÃO do modelo, em português, pronto para o painel de
 * pendências. `key` deduplica: uma fórmula quebrada dá o mesmo problema em
 * todas as linhas e o painel mostra um item, não duzentos.
 */
export interface ResolveProblem {
  key: string;
  texto: string;
  sheet?: string;
  columnKey?: string;
}

export interface ProblemSink {
  add(p: ResolveProblem): void;
  list(): ResolveProblem[];
}

export function createProblemSink(): ProblemSink {
  const porChave = new Map<string, ResolveProblem>();
  return {
    add(p) {
      if (!porChave.has(p.key)) porChave.set(p.key, p);
    },
    list() {
      return [...porChave.values()];
    },
  };
}

export interface ResolveContext {
  /** Constantes do modelo, para `{const:nome}` e para `source: 'constant'`. */
  constants?: Record<string, TemplateConstantValue>;
  /** Presente = MODO TOLERANTE: problema entra aqui em vez de lançar. */
  problems?: ProblemSink;
  /** Nome da aba, para o problema dizer onde foi. */
  sheetName?: string;
}

/** Lança (template de código) ou coleta (template do banco). Ver o cabeçalho. */
function problema(
  ctx: ResolveContext | undefined,
  p: { key: string; texto: string; dev?: string; columnKey?: string }
): void {
  if (ctx?.problems) {
    ctx.problems.add({ key: p.key, texto: p.texto, sheet: ctx.sheetName, columnKey: p.columnKey });
    return;
  }
  throw new Error(p.dev ?? p.texto);
}

const rotuloCol = (c: TemplateColumn) => c.header || c.key;

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

export function resolveColumns(sheet: TemplateSheet, ctx?: ResolveContext): ResolvedColumn[] {
  const cols = sheet.columns ?? [];
  const keys = new Set<string>();
  return cols.map((c, i) => {
    if (keys.has(c.key)) {
      problema(ctx, {
        key: `chave-repetida:${c.key}`,
        columnKey: c.key,
        texto: `Duas colunas do modelo têm a mesma identificação («${rotuloCol(c)}»). Renomeie uma delas.`,
        dev: `Template: chave de coluna repetida "${c.key}" na aba ${sheet.name}`,
      });
    }
    keys.add(c.key);
    return { key: c.key, header: c.header, letter: columnLetter(i), format: c.format, editable: c.editable };
  });
}

/** As chaves que um texto de fórmula referencia — para validar antes de resolver. */
export function formulaTextRefs(formula: string): { colunas: string[]; constantes: string[] } {
  const colunas = [...formula.matchAll(/\{col:([^}]+)\}/g)].map(m => m[1]);
  const constantes = [...formula.matchAll(/\{const:([^}]+)\}/g)].map(m => m[1]);
  return { colunas, constantes };
}

export interface FormulaContext {
  row?: number;
  first?: number;
  last?: number;
  /** Constantes do modelo: `{const:nome}` vira o LITERAL do valor. */
  constants?: Record<string, TemplateConstantValue>;
}

/**
 * '={col:a}{row}*{col:b}{row}' -> 'G5*H5' (sem o '=' inicial — o ExcelJS não o
 * quer). SEMPRE lança em referência desconhecida: quem está em modo tolerante
 * valida ANTES de chamar (ver `problemasDaFormula`), e nunca chega aqui com
 * uma fórmula quebrada.
 */
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
  out = out.replace(/\{const:([^}]+)\}/g, (_, nome: string) => {
    const v = ctx.constants?.[nome];
    if (v === undefined) throw new Error(`Template: fórmula referencia valor fixo desconhecido "${nome}"`);
    return formulaLiteral(v);
  });
  const need = (name: 'row' | 'first' | 'last') => {
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

/**
 * O texto da fórmula de uma coluna: `formulaSpec` (modelo do banco, montada
 * por seleção) vence `formula` (texto escrito à mão no template de código).
 * `null` = a coluna diz ser fórmula e não tem conta nenhuma.
 */
export function formulaTextOf(c: TemplateColumn): string | null {
  if (c.formulaSpec) return compileFormulaSpec(c.formulaSpec);
  return c.formula ?? null;
}

/**
 * O que impede esta fórmula de ser resolvida, em português. Roda ANTES de
 * `resolveFormula` no modo tolerante — é o que troca a exceção por um item de
 * painel sem deixar o defeito passar.
 */
function problemasDaFormula(
  c: TemplateColumn,
  texto: string,
  columns: ResolvedColumn[],
  ctx: ResolveContext | undefined
): string[] {
  const escopo = {
    colunas: columns.map(x => x.key),
    constantes: Object.keys(ctx?.constants ?? {}),
  };
  // Com spec, a validação entende a operação (inclusive intervalo invertido).
  if (c.formulaSpec) return validateFormulaSpec(c.formulaSpec, escopo, rotuloCol(c));
  // Sem spec (texto à mão), confere só as referências que o texto cita.
  const refs = formulaTextRefs(texto);
  const problemas: string[] = [];
  const conhecidas = new Set(escopo.colunas);
  const constantes = new Set(escopo.constantes);
  for (const k of refs.colunas) {
    if (!conhecidas.has(k)) {
      problemas.push(`A coluna «${rotuloCol(c)}» usa a coluna «${k}», que não existe mais no modelo.`);
    }
  }
  for (const n of refs.constantes) {
    if (!constantes.has(n)) {
      problemas.push(`A coluna «${rotuloCol(c)}» usa o valor fixo «${n}», que não está declarado no modelo.`);
    }
  }
  return problemas;
}

export function resolveRowsSheet(
  sheet: TemplateSheet,
  rows: RowsSheetInput[],
  values: TemplateValuesIndex,
  ctxIn?: ResolveContext
): ResolvedRowsSheet {
  if (sheet.kind !== 'rows') throw new Error(`Template: aba ${sheet.name} não é de linhas`);
  const ctx: ResolveContext | undefined = ctxIn ? { ...ctxIn, sheetName: ctxIn.sheetName ?? sheet.name } : undefined;
  const columns = resolveColumns(sheet, ctx);
  const headerRow = sheet.headerRow ?? 1;
  const firstDataRow = sheet.firstDataRow ?? headerRow + 1;
  const lastDataRow = firstDataRow + rows.length - 1;
  const cols = sheet.columns ?? [];
  const constants = ctx?.constants ?? {};

  /**
   * Fórmula por coluna, resolvida UMA vez em relação ao defeito: a conta é a
   * mesma em toda linha, então validar por linha encheria o painel de cópias.
   * `null` = a coluna não sai como fórmula (defeituosa, no modo tolerante).
   */
  const textoFormula = new Map<string, string | null>();
  for (const c of cols) {
    if (c.source !== 'formula') continue;
    const texto = formulaTextOf(c);
    if (!texto) {
      problema(ctx, {
        key: `formula-vazia:${c.key}`,
        columnKey: c.key,
        texto: `A coluna «${rotuloCol(c)}» está marcada como calculada, mas não tem conta configurada.`,
        dev: `Template: coluna ${c.key} é fórmula sem texto`,
      });
      textoFormula.set(c.key, null);
      continue;
    }
    const problemas = ctx?.problems ? problemasDaFormula(c, texto, columns, ctx) : [];
    if (problemas.length > 0) {
      for (const p of problemas) {
        problema(ctx, { key: `formula:${c.key}:${p}`, columnKey: c.key, texto: p });
      }
      textoFormula.set(c.key, null);
      continue;
    }
    textoFormula.set(c.key, texto);
  }

  const resolvedRows: ResolvedCell[][] = rows.map((r, i) => {
    const rowNumber = firstDataRow + i;
    return cols.map((c): ResolvedCell => {
      const base: ResolvedCell = { format: c.format, editable: c.editable };
      if (c.source === 'sequence') return { ...base, value: i + 1 };
      if (c.source === 'blank') return { ...base, value: null };
      if (c.source === 'formula') {
        const texto = textoFormula.get(c.key) ?? null;
        // Defeituosa no modo tolerante: célula vazia. O problema já está no
        // painel e a geração fica bloqueada por quem chama.
        if (!texto) return { ...base, value: null };
        return {
          ...base,
          formula: resolveFormula(texto, columns, {
            row: rowNumber,
            first: firstDataRow,
            last: lastDataRow,
            constants,
          }),
        };
      }
      let value: TemplateCellValue;
      if (c.source === 'manual') {
        value = resolveManualValue(c, r.refs, values).value;
      } else if (c.source === 'constant') {
        const nome = c.constantName ?? c.key;
        const v = constants[nome];
        if (v === undefined) {
          problema(ctx, {
            key: `constante-ausente:${c.key}`,
            columnKey: c.key,
            texto: `A coluna «${rotuloCol(c)}» usa o valor fixo «${nome}», que não está declarado no modelo.`,
            dev: `Template: coluna ${c.key} usa constante desconhecida "${nome}"`,
          });
          value = null;
        } else {
          value = v;
        }
        if (isEmpty(value) && c.defaultValue !== undefined) value = c.defaultValue;
      } else if (isSourceField(c.source)) {
        value = SOURCE_FIELDS[c.source].get(r.input);
        if (isEmpty(value) && c.defaultValue !== undefined) value = c.defaultValue;
      } else {
        problema(ctx, {
          key: `campo-extinto:${c.key}`,
          columnKey: c.key,
          texto: `A coluna «${rotuloCol(c)}» está ligada a um campo que não existe mais no sistema («${c.source}»). Edite o modelo.`,
          dev: `Template: source desconhecido "${c.source}" na coluna ${c.key}`,
        });
        value = null;
      }
      return { ...base, value, highlight: !!c.highlightWhenEmpty && isEmpty(value) };
    });
  });

  let totalsRow: (ResolvedCell | null)[] | undefined;
  if (sheet.totals) {
    const soma = new Set(sheet.totals.sumColumns);
    for (const k of soma) {
      if (!columns.some(c => c.key === k)) {
        problema(ctx, {
          key: `total-coluna-extinta:${k}`,
          columnKey: k,
          texto: `A linha de totais soma a coluna «${k}», que não existe mais no modelo.`,
          dev: `Template: total em coluna desconhecida "${k}"`,
        });
        soma.delete(k);
      }
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

/* ─────────────────────────── folha form (BM) ─────────────────────────── */

/** Uma linha da região já agregada pelo dataset: campo → valor. */
export type RegionRowInput = Record<string, TemplateCellValue>;

export interface FormSheetInput {
  /** Cadastro por contexto da mina desta geração (values.context.get(chave)). */
  context?: Map<string, TemplateValue>;
  /** Valores digitados para esta geração (ex.: dataEnvio). Não persistidos. */
  manual?: Record<string, TemplateCellValue>;
  /** 'dd/mm/yyyy a dd/mm/yyyy'. */
  periodoLabel?: string;
  regionRows?: RegionRowInput[];
}

export function resolveFormSheet(sheet: TemplateSheet, input: FormSheetInput): ResolvedFormSheet {
  if (sheet.kind !== 'form') throw new Error(`Template: aba ${sheet.name} não é form`);
  const manual = input.manual ?? {};

  const cells: ResolvedFormCell[] = (sheet.cells ?? []).map(c => {
    let value: TemplateCellValue;
    switch (c.source) {
      case 'context': {
        const v = input.context?.get(c.key);
        value = v === undefined ? null : v;
        break;
      }
      case 'manual':
      case 'dataEnvio':
        value = manual[c.key] ?? null;
        break;
      case 'periodo':
        value = input.periodoLabel ?? null;
        break;
      default:
        throw new Error(`Template: source desconhecido "${(c as any).source}" na célula ${c.cell}`);
    }
    if (isEmpty(value) && c.defaultValue !== undefined) value = c.defaultValue;
    return { address: c.cell, value, format: c.format, highlight: !!c.highlightWhenEmpty && isEmpty(value) };
  });

  let region: ResolvedRegion | undefined;
  if (sheet.region) {
    const r = sheet.region;
    const rowsIn = input.regionRows ?? [];
    const columns: ResolvedColumn[] = r.columns.map(c => ({ key: c.key, header: c.key, letter: c.col, format: c.format }));
    const capacity = r.lastRowInFile - r.firstRow + 1;
    const extraRows = Math.max(0, rowsIn.length - capacity);
    const totalsRow = r.totalsRowInFile + extraRows;
    const lastRow = totalsRow - 1;

    const rows = rowsIn.map((row, i) => {
      const rowNumber = r.firstRow + i;
      return r.columns.map(c => {
        const base: ResolvedCell = { format: c.format };
        if (c.source === 'formula') {
          if (!c.formula) throw new Error(`Template: coluna ${c.key} da região é fórmula sem texto`);
          return { col: c.col, cell: { ...base, formula: resolveFormula(c.formula, columns, { row: rowNumber, first: r.firstRow, last: lastRow }) } };
        }
        const value: TemplateCellValue = c.source === 'constant' ? (c.value ?? null) : (row[c.field ?? c.key] ?? null);
        return { col: c.col, cell: { ...base, value, highlight: !!c.highlightWhenEmpty && isEmpty(value) } };
      });
    });

    region = {
      firstRow: r.firstRow,
      lastRowInFile: r.lastRowInFile,
      totalsRowInFile: r.totalsRowInFile,
      capacity,
      extraRows,
      totalsRow,
      lastRow,
      mergeCols: r.mergeCols,
      clearCols: r.clearCols ?? r.columns.filter(c => c.source !== 'formula').map(c => c.col),
      rows,
      // Sempre reescrita na faixa real (first..lastRow), com ou sem inserção.
      totalsCell: { col: r.totals.col, formula: resolveFormula(r.totals.formula, columns, { first: r.firstRow, last: lastRow }) },
    };
  }

  return { name: sheet.name, kind: 'form', cells, region };
}

export interface ResolveOutcome {
  sheets: ResolvedSheet[];
  /**
   * Defeitos de CONFIGURAÇÃO do modelo, deduplicados. Sempre vazio para
   * template de código (lá qualquer defeito lança). Não vazio = a geração
   * fica bloqueada e o painel mostra estes textos.
   */
  problems: ResolveProblem[];
}

/**
 * A porta para os templates do BANCO: resolve e devolve os problemas em vez de
 * lançar. Para template de código o comportamento é o de sempre (lança), e
 * `problems` volta vazio.
 */
export function resolveTemplateWithProblems(
  template: MeasurementTemplate,
  rows: RowsSheetInput[],
  values: TemplateValuesIndex,
  form?: FormSheetInput
): ResolveOutcome {
  const sink = template.origin === 'db' ? createProblemSink() : undefined;
  const ctx: ResolveContext = { constants: template.constants, problems: sink };

  const sheets = template.sheets.map(s => {
    if (s.kind === 'static') return { name: s.name, kind: 'static', staticFrom: s.staticFrom ?? 'file' } as ResolvedSheet;
    if (s.kind === 'form') {
      if (!form) throw new Error(`Template: aba ${s.name} é form e precisa de FormSheetInput`);
      // Folha form é posicional e só existe em template de código (o BM);
      // modelo do banco é V1 só `kind: 'rows'`.
      return resolveFormSheet(s, form);
    }
    return resolveRowsSheet(s, rows, values, ctx);
  });

  return { sheets, problems: sink?.list() ?? [] };
}

/**
 * Assinatura histórica, inalterada — é por aqui que a Vale passa.
 *
 * ⚠️ Recusa template do BANCO de propósito: por aqui os problemas de
 * configuração não teriam para onde ir, e engolir defeito em silêncio é o que
 * este repositório não faz. Modelo do banco usa `resolveTemplateWithProblems`.
 */
export function resolveTemplate(
  template: MeasurementTemplate,
  rows: RowsSheetInput[],
  values: TemplateValuesIndex,
  form?: FormSheetInput
): ResolvedSheet[] {
  if (template.origin === 'db') {
    throw new Error(
      `Template "${template.label}" vem do banco: use resolveTemplateWithProblems, que devolve os problemas de configuração em vez de escondê-los.`
    );
  }
  return resolveTemplateWithProblems(template, rows, values, form).sheets;
}

/** As colunas editáveis de uma aba de linhas, para a grade da prévia. */
export function editableColumns(sheet: TemplateSheet): TemplateColumn[] {
  return (sheet.columns ?? []).filter(c => c.editable && c.source === 'manual');
}
