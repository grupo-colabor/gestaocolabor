/**
 * Formatação de célula para a PRÉVIA (tela). Os arquivos têm os seus próprios
 * escritores (services/exports); aqui é só como o valor aparece na tabela.
 * `null` vira travessão claro: em branco é "não se aplica", nunca zero.
 */
import type { CellKind, CellValue } from '../../domain/exports/types';
import type { TemplateFormat } from '../../domain/exports/templates/types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const hours = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function formatPreviewCell(value: CellValue, kind: CellKind): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    if (kind === 'currency') return brl.format(value);
    if (kind === 'hours') return hours.format(value);
    return String(value);
  }
  return String(value);
}

export const isNumericKind = (kind: CellKind): boolean =>
  kind === 'currency' || kind === 'hours' || kind === 'number';

/**
 * Como um valor de TEMPLATE aparece na prévia. `TemplateFormat` tem dois
 * formatos que o motor de tabela não tem — 'percent' e 'integer' — e um
 * ('time') que é texto puro; sem esta tradução a tela mostraria "0,2" onde a
 * pessoa espera "20%".
 */
export function formatTemplateCell(value: CellValue, format?: TemplateFormat): string {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'percent' && typeof value === 'number') {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value * 100)}%`;
  }
  if (format === 'integer' && typeof value === 'number') return String(Math.round(value));
  const kind: CellKind =
    format === 'currency' ? 'currency' :
    format === 'hours' ? 'hours' :
    format === 'date' ? 'date' :
    'text';
  return formatPreviewCell(value, kind);
}
