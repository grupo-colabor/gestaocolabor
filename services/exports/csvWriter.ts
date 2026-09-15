/**
 * EXPORTAÇÕES — escritor CSV (I/O: só o download)
 *
 * O texto é montado em domain/exports/csv.ts (puro, coberto pelo smoke).
 */
import type { ExportTable } from '../../domain/exports/types';
import { buildCsv } from '../../domain/exports/csv';
import { triggerDownload, CSV_MIME } from '../../utils/download';

export function downloadCsv(table: ExportTable, fileName: string): void {
  triggerDownload(buildCsv(table), fileName, CSV_MIME);
}

/** `medicoes_2026-09-15.xlsx` — mesmo padrão dos outros exports do app. */
export function buildExportFileName(fileBase: string, ext: 'xlsx' | 'csv', when: Date = new Date()): string {
  return `${fileBase}_${when.toISOString().slice(0, 10)}.${ext}`;
}
