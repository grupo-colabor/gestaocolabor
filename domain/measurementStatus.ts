/**
 * RÓTULOS DE STATUS DA MEDIÇÃO — fonte única
 *
 * Os cinco estágios de `measurements.status` tinham rótulo em três lugares:
 * o funil "Status das Medições" do Dashboard, o export do Dashboard e o
 * Painel de Medição (que só tem as cores). A lista de não reembolsáveis e as
 * abas novas do Excel precisam do mesmo texto — daí o mapa aqui, sem import,
 * para rodar nos smokes em Node.
 */
import type { MeasurementStatus } from '../types';

export const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = {
  NAO_INICIADA: 'Não Iniciada',
  LANCAMENTO: 'Em Lançamento',
  CONFERENCIA: 'Em Conferência',
  PRONTA_FATURAMENTO: 'Pronta Faturamento',
  FATURADA: 'Faturada',
};

/** Ordem do funil, como o Dashboard sempre mostrou. */
export const MEASUREMENT_STATUS_ORDER: MeasurementStatus[] = [
  'NAO_INICIADA',
  'LANCAMENTO',
  'CONFERENCIA',
  'PRONTA_FATURAMENTO',
  'FATURADA',
];

/** Status desconhecido/vazio volta como veio (ou '—'), nunca some. */
export const measurementStatusLabel = (s: string | null | undefined): string =>
  (MEASUREMENT_STATUS_LABELS as Record<string, string>)[String(s ?? '')] ?? (s ? String(s) : '—');
