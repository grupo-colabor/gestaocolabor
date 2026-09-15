/**
 * EXPORTAÇÕES — escritor XLSX (I/O: ExcelJS + download)
 *
 * Recebe a tabela pronta (cabeçalho + matriz, domain/exports/buildRows) e só
 * escreve. Sem fórmula, sem proteção, sem aba de tarifas: isso é o Excel de
 * PAGAMENTO (services/medicaoWorkbook.ts), que continua intocado. Aqui é
 * planilha de análise: uma aba, cabeçalho congelado, autofiltro, número como
 * número.
 *
 * ExcelJS entra por `import()` dinâmico, como em todos os exports do app, para
 * não pesar o bundle inicial.
 */
import type { CellKind, CellValue, ExportTable } from '../../domain/exports/types';
import { triggerDownload, XLSX_MIME } from '../../utils/download';

const HEADER_FILL = 'FF1E293B'; // o mesmo azul-escuro dos outros exports
const FMT_MOEDA = '"R$" #,##0.00';
const FMT_HORAS = '0.00';

function numFmt(kind: CellKind): string | undefined {
  if (kind === 'currency') return FMT_MOEDA;
  if (kind === 'hours') return FMT_HORAS;
  return undefined;
}

/** `null` vira célula vazia; boolean vira Sim/Não; número fica número. */
function cellValue(v: CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
}

export interface XlsxOptions {
  sheetName: string;
  /** Linha de contexto na 1ª célula do rodapé? Não: vai em `workbook.title`, para não quebrar o autofiltro. */
  title?: string;
}

export async function buildXlsxBuffer(table: ExportTable, opts: XlsxOptions): Promise<ArrayBuffer> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestão Colabor';
  workbook.created = new Date();
  if (opts.title) workbook.title = opts.title;

  const ws = workbook.addWorksheet(opts.sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = table.columns.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
  }));

  ws.getRow(1).eachCell({ includeEmpty: true }, (cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.getRow(1).height = 30;

  for (const row of table.rows) {
    const added = ws.addRow(row.map(cellValue));
    table.columns.forEach((c, i) => {
      const fmt = numFmt(c.kind);
      if (fmt) added.getCell(i + 1).numFmt = fmt;
    });
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, table.rows.length + 1), column: table.columns.length },
  };

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadXlsx(table: ExportTable, fileName: string, opts: XlsxOptions): Promise<void> {
  const buffer = await buildXlsxBuffer(table, opts);
  triggerDownload(buffer, fileName, XLSX_MIME);
}
