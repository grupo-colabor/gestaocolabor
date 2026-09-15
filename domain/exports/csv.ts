/**
 * MOTOR DE EXPORTAÇÃO — CSV (texto puro; o download fica em services/exports)
 *
 * Alvo: Excel pt-BR abrindo com duplo clique. Por isso:
 *   • separador ';' (a vírgula é o decimal);
 *   • decimal com vírgula; moeda com 2 casas; horas até 2 casas;
 *   • BOM UTF-8 no início, senão a acentuação sai errada;
 *   • CRLF entre linhas;
 *   • aspas só quando o campo tem ';', '"', quebra de linha ou espaço nas
 *     pontas; aspas internas dobradas.
 * Datas já chegam como 'dd/mm/yyyy' (kind 'date') e vão como texto.
 * `null` vira campo vazio — em branco é "não se aplica", nunca zero.
 */
import type { CellKind, CellValue, ExportTable } from './types';

export const CSV_SEPARATOR = ';';
export const CSV_BOM = '﻿';

export function formatCsvCell(value: CellValue, kind: CellKind): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const text =
      kind === 'currency'
        ? value.toFixed(2)
        : kind === 'hours'
          ? String(Math.round((value + Number.EPSILON) * 100) / 100)
          : String(value);
    return text.replace('.', ',');
  }
  return String(value);
}

export function escapeCsvField(s: string): string {
  const precisa =
    s.includes(CSV_SEPARATOR) || s.includes('"') || /[\r\n]/.test(s) || s !== s.trim();
  return precisa ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(table: ExportTable): string {
  const header = table.columns.map(c => escapeCsvField(c.header)).join(CSV_SEPARATOR);
  const lines = table.rows.map(row =>
    row
      .map((v, i) => escapeCsvField(formatCsvCell(v, table.columns[i].kind)))
      .join(CSV_SEPARATOR)
  );
  return CSV_BOM + [header, ...lines].join('\r\n') + '\r\n';
}
