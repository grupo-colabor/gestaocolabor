/**
 * ESTILOS DE LINHA DO XLSX — compartilhados pelos escritores (ExcelJS)
 *
 * Um ponto só para "como fica a linha de uma demanda cancelada por No-Show":
 * fonte vermelha na linha INTEIRA, sem fundo, para continuar legível e
 * imprimível. Compõe com o que a célula já tinha (negrito, fill do noturno no
 * Excel de demandas): só a cor da fonte muda.
 *
 * Quem decide SE a linha é No-Show é o domínio (`isNoShowCancellation` em
 * domain/demandCancellation.ts, via `ExportTable.marks` ou `noShow` do item);
 * aqui só se pinta. Usado por xlsxWriter (Exportações e painel de
 * pendências), dashboardXlsx (abas de não reembolsáveis) e pelo
 * ExportDemandsModal (Excel de demandas do botão).
 */

/** red-600 em ARGB — o mesmo vermelho dos selos da Medição. */
export const NO_SHOW_FONT_ARGB = 'FFDC2626';

/** Pinta a fonte de todas as células da linha (1..columnCount) de vermelho, preservando o resto do estilo. */
export function paintNoShowRow(row: { getCell: (n: number) => any }, columnCount: number): void {
  for (let i = 1; i <= columnCount; i++) {
    const cell = row.getCell(i);
    cell.font = { ...(cell.font ?? {}), color: { argb: NO_SHOW_FONT_ARGB } };
  }
}
