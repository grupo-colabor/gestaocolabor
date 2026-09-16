/**
 * EXPORTAÇÕES — escritor XLSX de TEMPLATE (I/O: ExcelJS + arquivo-base + download)
 *
 * Recebe as abas já resolvidas (domain/exports/templates/resolve.ts) e escreve
 * o arquivo do cliente. Com ARQUIVO-BASE (o modelo em public/templates/), o
 * escritor carrega o modelo, preenche a aba de linhas DENTRO dele e deixa as
 * abas estáticas (Plantas) como estão — cabeçalhos, larguras, fontes, fills
 * de tema e a aba estática vêm do próprio arquivo, sem transcrição. Não é
 * byte a byte (o ExcelJS reserializa), é conteúdo idêntico; o smoke lê de
 * volta e confere.
 *
 * Aba de linhas com `file` (layout pré-formatado no modelo):
 *   1. guarda o estilo de cada célula da 1ª linha de dados (protótipo) e da
 *      linha de totais, mais as alturas;
 *   2. remove as linhas pré-formatadas (dados + totais) — sobras do modelo
 *      não ficam com "0,2" e "R$ 0,00" soltos;
 *   3. escreve N linhas copiando o estilo do protótipo, e a linha de totais
 *      logo abaixo da última, com o estilo da linha de totais do modelo.
 *
 * Fórmulas entram como `{ formula }` (sem '='), como no Excel de pagamento.
 * Datas de verdade (UTC à meia-noite, para o serial do Excel cair no dia
 * certo) com dd/mm/yyyy; moeda e percentual com os formatos do modelo.
 * Célula editável vazia (`highlight`) fica amarela. Sem proteção, sem
 * congelamento, sem autofiltro — como o arquivo.
 *
 * Sem arquivo-base, gera do zero com um cabeçalho simples (é o caminho dos
 * templates da Etapa 3 antes do upload, e o fallback do smoke).
 */
import type {
  MeasurementTemplate,
  ResolvedCell,
  ResolvedRowsSheet,
  ResolvedSheet,
  TemplateCellValue,
  TemplateFormat,
} from '../../domain/exports/templates/types';
import { triggerDownload, XLSX_MIME } from '../../utils/download';

const NUMFMT: Partial<Record<TemplateFormat, string>> = {
  currency: '"R$" #,##0.00',
  percent: '0.00%',
  date: 'dd/mm/yyyy',
  integer: '0',
};

const HIGHLIGHT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

/** 'YYYY-MM-DD' -> Date UTC à meia-noite (o ExcelJS converte por UTC). */
function toExcelDate(v: TemplateCellValue): Date | null {
  if (v instanceof Date) return v;
  const s = String(v ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function cellValue(cell: ResolvedCell): any {
  if (cell.formula) return { formula: cell.formula };
  const v = cell.value;
  if (v === undefined || v === null) return null;
  if (cell.format === 'date') return toExcelDate(v);
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (v instanceof Date) return v;
  return v;
}

const clone = <T,>(o: T): T => (o ? JSON.parse(JSON.stringify(o)) : o);

function applyCell(target: any, cell: ResolvedCell | null, protoStyle?: any) {
  if (protoStyle) target.style = clone(protoStyle);
  if (!cell) {
    target.value = null;
    return;
  }
  target.value = cellValue(cell);
  const fmt = cell.format ? NUMFMT[cell.format] : undefined;
  if (fmt) target.numFmt = fmt;
  if (cell.highlight) target.fill = clone(HIGHLIGHT_FILL);
}

/**
 * Preenche a aba de linhas DENTRO do arquivo-base.
 *
 * ⚠️ `worksheet.spliceRows` é no-op numa planilha carregada de arquivo no
 * ExcelJS 4.4 (verificado: `_rows.length` não muda). Por isso a aba não é
 * editada no lugar: o escritor guarda o que o modelo traz (linhas acima e
 * inclusive o cabeçalho, com valores e estilos; estilo da 1ª linha de dados;
 * estilo da linha de totais; larguras; views; alturas), REMOVE a aba e a
 * recria com o mesmo `orderNo` — que é o que o ExcelJS usa para ordenar as
 * abas ao gravar, então a Vale continua vendo "Turmas Realizadas" antes de
 * "Plantas". Fills de tema, fontes e bordas sobrevivem porque são copiados
 * como estilo de célula.
 */
function writeRowsSheetIntoBase(workbook: any, ws: any, sheet: ResolvedRowsSheet) {
  const layout = sheet.file;
  if (!layout) throw new Error(`Template: aba ${sheet.name} sem layout do arquivo-base`);
  const nCols = sheet.columns.length;

  // 1) O que o modelo traz e tem de continuar igual.
  const orderNo = ws.orderNo;
  const views = clone(ws.views);
  const pageSetup = clone(ws.pageSetup);
  const properties = clone(ws.properties);
  const widths: (number | undefined)[] = [];
  for (let c = 1; c <= Math.max(nCols, ws.columnCount); c++) widths.push(ws.getColumn(c).width);

  const acima: { height?: number; cells: { value: any; style: any }[] }[] = [];
  for (let r = 1; r < layout.firstDataRow; r++) {
    const row = ws.getRow(r);
    const cells: { value: any; style: any }[] = [];
    for (let c = 1; c <= Math.max(nCols, row.cellCount); c++) {
      const cell = row.getCell(c);
      cells.push({ value: clone(cell.value), style: clone(cell.style) });
    }
    acima.push({ height: row.height, cells });
  }

  const protoRow = ws.getRow(layout.firstDataRow);
  const protoStyles: any[] = [];
  for (let c = 1; c <= nCols; c++) protoStyles.push(clone(protoRow.getCell(c).style));
  const protoHeight = protoRow.height;

  const totalsProto = ws.getRow(layout.totalsRow);
  const totalsStyles: any[] = [];
  for (let c = 1; c <= nCols; c++) totalsStyles.push(clone(totalsProto.getCell(c).style));
  const totalsHeight = totalsProto.height;

  // 2) Recria a aba no mesmo lugar.
  workbook.removeWorksheet(ws.id);
  const novo = workbook.addWorksheet(sheet.name, { views, pageSetup, properties });
  novo.orderNo = orderNo;
  widths.forEach((w, i) => {
    if (w) novo.getColumn(i + 1).width = w;
  });

  acima.forEach((r, i) => {
    const row = novo.getRow(i + 1);
    r.cells.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.value = c.value;
      cell.style = c.style;
    });
    if (r.height) row.height = r.height;
  });

  // 3) Dados e totais, com o estilo do modelo.
  sheet.rows.forEach((cells, i) => {
    const row = novo.getRow(sheet.firstDataRow + i);
    cells.forEach((cell, j) => applyCell(row.getCell(j + 1), cell, protoStyles[j]));
    if (protoHeight) row.height = protoHeight;
  });

  if (sheet.totalsRow) {
    const row = novo.getRow(sheet.firstDataRow + sheet.rows.length);
    sheet.totalsRow.forEach((cell, j) => applyCell(row.getCell(j + 1), cell, totalsStyles[j]));
    if (totalsHeight) row.height = totalsHeight;
  }
}

function writeRowsSheetFromScratch(ws: any, sheet: ResolvedRowsSheet) {
  ws.columns = sheet.columns.map(c => ({ width: 16 }));
  const header = ws.getRow(sheet.headerRow);
  sheet.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = clone(HEADER_FILL);
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.rows.forEach((cells, r) => {
    const row = ws.getRow(sheet.firstDataRow + r);
    cells.forEach((cell, i) => applyCell(row.getCell(i + 1), cell));
  });
  if (sheet.totalsRow) {
    const row = ws.getRow(sheet.firstDataRow + sheet.rows.length);
    sheet.totalsRow.forEach((cell, i) => {
      const target = row.getCell(i + 1);
      applyCell(target, cell);
      if (cell) target.font = { bold: true };
    });
  }
}

export async function buildTemplateWorkbook(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  baseFile?: ArrayBuffer | Uint8Array | null
): Promise<any> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();

  if (baseFile) {
    await workbook.xlsx.load(baseFile as any);
  } else {
    workbook.creator = 'Gestão Colabor';
    workbook.created = new Date();
  }

  for (const sheet of sheets) {
    const existing = workbook.getWorksheet(sheet.name);
    if (sheet.kind === 'static') {
      if (!existing) {
        // Sem arquivo-base a aba estática não tem de onde vir: fica vazia, com o nome.
        workbook.addWorksheet(sheet.name);
      }
      continue;
    }
    if (baseFile) {
      if (!existing) throw new Error(`O arquivo-base do template "${template.label}" não tem a aba "${sheet.name}".`);
      writeRowsSheetIntoBase(workbook, existing, sheet);
    } else {
      writeRowsSheetFromScratch(existing ?? workbook.addWorksheet(sheet.name), sheet);
    }
  }

  return workbook;
}

export async function buildTemplateXlsxBuffer(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  baseFile?: ArrayBuffer | Uint8Array | null
): Promise<ArrayBuffer> {
  const wb = await buildTemplateWorkbook(template, sheets, baseFile);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * Busca o arquivo-base do template (public/templates/…). Falha PROPAGA: sem o
 * modelo não há como garantir o layout, então não se gera nada.
 */
export async function fetchTemplateBaseFile(template: MeasurementTemplate): Promise<ArrayBuffer | null> {
  if (!template.baseFile) return null;
  const resp = await fetch(template.baseFile);
  if (!resp.ok) throw new Error(`Arquivo-base do template não encontrado (${template.baseFile}: HTTP ${resp.status}).`);
  return resp.arrayBuffer();
}

export async function downloadTemplateXlsx(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  fileName: string
): Promise<void> {
  const base = await fetchTemplateBaseFile(template);
  const buffer = await buildTemplateXlsxBuffer(template, sheets, base);
  triggerDownload(buffer, fileName, XLSX_MIME);
}
