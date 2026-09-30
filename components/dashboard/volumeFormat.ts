/**
 * Formatação de PARTICIPAÇÃO (%) do Dashboard — só a tela formata.
 *
 * O domínio (buildVolumeComparison, findDominantRow) devolve o número cru
 * (164/171 × 100 = 95,906…); aqui vira "95,9%": uma casa decimal sempre,
 * vírgula pt-BR. Um lugar só para o aviso da empresa dominante, o tooltip
 * das barras e o eixo Y escreverem igual.
 */
export const formatShare = (v: number): string =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Eixo Y em participação: os ticks redondos ficam curtos (25%), os demais ganham a casa (12,5%). */
export const formatShareTick = (v: number): string => (Number.isInteger(v) ? `${v}%` : formatShare(v));
