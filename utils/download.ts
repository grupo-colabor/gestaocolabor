/**
 * DOWNLOAD NO NAVEGADOR — helper único
 *
 * O mesmo bloco `Blob -> createObjectURL -> <a download> -> click -> revoke`
 * existe copiado em medicaoExportService.ts, utils/exportXLSX.ts,
 * ExportDemandsModal.tsx, Registrations.tsx e Audit.tsx. Este arquivo nasce
 * para o módulo de Exportações não virar a sexta cópia; migrar as cinco
 * existentes para cá é seguro, mas fica fora da F1 (os exports existentes
 * ficam intocados de propósito).
 *
 * Só DOM: nada de Supabase, nada de domínio.
 */

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** CSV com charset explícito: o Excel pt-BR abre com acentuação certa junto do BOM. */
export const CSV_MIME = 'text/csv;charset=utf-8';

export function triggerDownload(
  content: ArrayBuffer | Uint8Array | string,
  fileName: string,
  mime: string
): void {
  const blob = new Blob([content as any], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
