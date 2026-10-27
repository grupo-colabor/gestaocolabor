/**
 * EXPORT DO DASHBOARD — escrita XLSX (I/O: ExcelJS)
 *
 * Os helpers de estilo e a seção "título + cabeçalho + linhas" viviam dentro
 * de `handleExportDashboard` (components/Dashboard.tsx). Saíram para cá por
 * dois motivos: o Dashboard não precisa crescer para ganhar duas abas, e o
 * smoke (`npm run smoke:nao-reembolsaveis`) consegue gerar o MESMO arquivo em
 * Node, ler de volta e conferir posições, fórmulas, congelamento e autofiltro
 * — e gravar o Excel das fixtures em C:\tmp para conferência.
 *
 * O workbook chega de fora (ExcelJS entra por `import()` dinâmico no
 * Dashboard, como em todos os exports do app); aqui só se escreve nele.
 *
 * ---------------------------------------------------------------------------
 * Abas "Não reemb. por demanda" e "Não reemb. por item"
 * ---------------------------------------------------------------------------
 *   linha 1  título da aba + "Exportado em"
 *   linha 2  "Filtros: P1: … · Empresa: …"
 *   linha 3  "Total visível" — SUBTOTAL(109, …) nas colunas numéricas. Fica
 *            ACIMA do cabeçalho, fora do intervalo do autofiltro, para não ser
 *            filtrada nem ordenada junto; 109 = SOMA ignorando linhas ocultas,
 *            então o total acompanha o filtro que a pessoa aplicar no Excel.
 *   linha 4  cabeçalho — congelamento e autofiltro começam aqui
 *   linha 5… dados (número como número, moeda com formato)
 *
 * As linhas vêm prontas do domínio (`buildNonReimbursableBy*Rows`): este
 * arquivo não soma nada.
 */
import type { Workbook, Worksheet, Row } from 'exceljs';
import {
  buildNonReimbursableByDemandRows,
  buildNonReimbursableByItemRows,
  buildNonReimbursableCustosRows,
  NR_BY_DEMAND_COLUMNS,
  NR_BY_ITEM_COLUMNS,
  type NonReimbursableColumn,
  type NonReimbursableList,
  type NonReimbursableRow,
} from '../../domain/nonReimbursableExpenses';

export const NR_SHEET_BY_DEMAND = 'Não reemb. por demanda';
export const NR_SHEET_BY_ITEM = 'Não reemb. por item';
/** Linha do "Total visível" (acima do cabeçalho). */
export const NR_TOTAL_ROW = 3;
/** Linha do cabeçalho: congelamento e autofiltro começam nela. */
export const NR_HEADER_ROW = 4;

const HEADER_FILL = 'FF1E293B';
const SECTION_FILL = 'FFF1F5F9';
const FMT_MOEDA = '"R$" #,##0.00';
const FMT_INT = '0';

/* ─────────────────────── estilos (como eram no Dashboard) ─────────────────────── */

export function styleHeader(row: Row): void {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
  row.height = 22;
}

export function styleSection(row: Row): void {
  row.eachCell(cell => {
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  });
  row.height = 18;
}

/** Seção das abas do Dashboard: linha em branco, título mesclado, cabeçalho, linhas. */
export function addSection(ws: Worksheet, title: string, headers: string[], rows: (string | number)[][]): void {
  ws.addRow([]);
  const titleRow = ws.addRow([title]);
  styleSection(titleRow);
  ws.mergeCells(titleRow.number, 1, titleRow.number, headers.length);
  const hRow = ws.addRow(headers);
  styleHeader(hRow);
  rows.forEach(r => {
    const dr = ws.addRow(r);
    dr.eachCell(cell => { cell.font = { size: 10 }; cell.alignment = { vertical: 'middle' }; });
  });
}

/**
 * As duas primeiras linhas de toda aba: título + "Exportado em" (linha 1,
 * como sempre foi) e a linha de filtros aplicados (linha 2, nova).
 */
export function addDashboardMeta(ws: Worksheet, label: string, filtros: string, exportadoEm: string): void {
  const meta = ws.addRow([`Dashboard Colabor — ${label}`, '', `Exportado em: ${exportadoEm}`]);
  meta.getCell(1).font = { bold: true, size: 12 };
  meta.getCell(3).font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
  meta.getCell(3).alignment = { horizontal: 'right' };
  ws.mergeCells(meta.number, 1, meta.number, 2);

  const f = ws.addRow([`Filtros: ${filtros}`]);
  f.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
}

/* ──────────────────── bloco da aba Custos ──────────────────── */

/**
 * Bloco "Despesas Não Reembolsáveis" na aba Custos: as quatro categorias do
 * card, com Café/Almoço/Jantar indentadas sob Alimentação. Valores como
 * número (moeda), diferente das seções antigas que gravam texto — assim dá
 * para somar no Excel. A seção "Despesas por Categoria" segue intocada.
 */
export function addNonReimbursableCustosSection(ws: Worksheet, list: NonReimbursableList): void {
  ws.addRow([]);
  const titleRow = ws.addRow(['Despesas Não Reembolsáveis']);
  styleSection(titleRow);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  const hRow = ws.addRow(['Indicador', 'Valor']);
  styleHeader(hRow);
  for (const r of buildNonReimbursableCustosRows(list)) {
    const dr = ws.addRow([r.sub ? `   ${r.label}` : r.label, r.value]);
    dr.getCell(1).font = { size: 10, italic: !!r.sub, color: r.sub ? { argb: 'FF64748B' } : undefined };
    dr.getCell(2).font = { size: 10 };
    dr.getCell(2).numFmt = r.kind === 'currency' ? FMT_MOEDA : FMT_INT;
    dr.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
  }
}

/* ──────────────────── as duas abas novas ──────────────────── */

export interface NonReimbursableSheetMeta {
  filtros: string;
  exportadoEm: string;
}

const colLetter = (n: number): string => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

function addTableSheet(
  wb: Workbook,
  name: string,
  columns: NonReimbursableColumn[],
  rows: NonReimbursableRow[],
  meta: NonReimbursableSheetMeta
): Worksheet {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: NR_HEADER_ROW }],
  });
  ws.columns = columns.map(c => ({ width: c.width }));

  addDashboardMeta(ws, name, meta.filtros, meta.exportadoEm); // linhas 1 e 2

  // Linha 3: "Total visível" — acima do cabeçalho, fora do autofiltro.
  const primeira = NR_HEADER_ROW + 1;
  const ultima = Math.max(primeira, NR_HEADER_ROW + rows.length);
  const totalRow = ws.addRow(['Total visível']);
  totalRow.getCell(1).font = { bold: true, size: 10 };
  columns.forEach((c, i) => {
    if (c.kind === 'text') return;
    const L = colLetter(i + 1);
    const cell = totalRow.getCell(i + 1);
    cell.value = { formula: `SUBTOTAL(109,${L}${primeira}:${L}${ultima})` };
    cell.numFmt = c.kind === 'currency' ? FMT_MOEDA : FMT_INT;
    cell.font = { bold: true, size: 10 };
  });
  if (totalRow.number !== NR_TOTAL_ROW) throw new Error(`Total visível caiu na linha ${totalRow.number}, esperado ${NR_TOTAL_ROW}`);

  // Linha 4: cabeçalho.
  const hRow = ws.addRow(columns.map(c => c.header));
  styleHeader(hRow);
  if (hRow.number !== NR_HEADER_ROW) throw new Error(`Cabeçalho caiu na linha ${hRow.number}, esperado ${NR_HEADER_ROW}`);

  // Linhas 5…: dados.
  for (const r of rows) {
    const dr = ws.addRow(r);
    columns.forEach((c, i) => {
      const cell = dr.getCell(i + 1);
      cell.font = { size: 10 };
      if (c.kind === 'currency') cell.numFmt = FMT_MOEDA;
      else if (c.kind === 'int') cell.numFmt = FMT_INT;
    });
  }

  ws.autoFilter = {
    from: { row: NR_HEADER_ROW, column: 1 },
    to: { row: Math.max(NR_HEADER_ROW, NR_HEADER_ROW + rows.length), column: columns.length },
  };
  return ws;
}

/**
 * Acrescenta as abas "Não reemb. por demanda" e "Não reemb. por item" ao
 * workbook — SEMPRE as duas, independentemente da visão escolhida na tela.
 */
export function addNonReimbursableSheets(wb: Workbook, list: NonReimbursableList, meta: NonReimbursableSheetMeta): void {
  addTableSheet(wb, NR_SHEET_BY_DEMAND, NR_BY_DEMAND_COLUMNS, buildNonReimbursableByDemandRows(list), meta);
  addTableSheet(wb, NR_SHEET_BY_ITEM, NR_BY_ITEM_COLUMNS, buildNonReimbursableByItemRows(list), meta);
}
