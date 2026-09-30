/**
 * Cores de P1…P6 no Dashboard Gerencial — KPIs do topo, "Distribuição de
 * Status", "Volume por Região", os cartões de ranking e o relatório. Mora num
 * módulo próprio para os cartões (components/dashboard/) e a tela
 * (components/Dashboard.tsx) lerem a mesma lista sem import circular.
 */
export const PERIOD_COLORS = ['#378ADD', '#1D9E75', '#EF9F27', '#D85A30', '#7F77DD', '#D4537E'] as const;

export const periodColor = (i: number): string => PERIOD_COLORS[i % PERIOD_COLORS.length];
