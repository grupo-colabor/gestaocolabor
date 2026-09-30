/**
 * TOGGLE DE MÉTRICA — "Demandas / Horas" (ou "Qtd. Treinamentos / Horas") no
 * cabeçalho de todo cartão do Dashboard que conta demandas e faz sentido em
 * horas. Um componente só, o mesmo visual dos cartões de Volume: pílulas
 * pequenas, a ativa na cor do cartão.
 *
 * O toggle é POR CARTÃO, não global — quem compara quer "quantidade aqui,
 * horas ali". O estado mora na tela (Dashboard), então cada cartão lembra a
 * escolha enquanto o Dashboard estiver aberto. Aqui só se desenha.
 */
import React from 'react';
import type { VolumeMetric } from '../../domain/dashboardVolume';

export type VolumeAccent = 'blue' | 'emerald' | 'amber' | 'violet' | 'indigo' | 'teal';

export const ACCENT: Record<VolumeAccent, { bar: string; badge: string; toggleOn: string }> = {
  blue:    { bar: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-400',       toggleOn: 'bg-blue-500 text-white' },
  emerald: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-400', toggleOn: 'bg-emerald-500 text-white' },
  amber:   { bar: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-400',     toggleOn: 'bg-amber-500 text-white' },
  violet:  { bar: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-400',   toggleOn: 'bg-violet-500 text-white' },
  indigo:  { bar: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-400',   toggleOn: 'bg-indigo-500 text-white' },
  teal:    { bar: 'bg-teal-500',    badge: 'bg-teal-50 text-teal-400',       toggleOn: 'bg-teal-500 text-white' },
};

export const TOGGLE_OFF = 'bg-slate-100 text-slate-400 hover:bg-slate-200';

export const DEMANDAS_HORAS: Partial<Record<VolumeMetric, string>> = { count: 'Demandas', hours: 'Horas' };

/** Rótulo curto de um valor na métrica: inteiro para demandas, "h" sem decimal para horas. */
export const metricLabel = (metric: VolumeMetric, v: number): string =>
  metric === 'hours' ? `${Math.round(v)}h` : String(Math.round(v));

export interface MetricToggleProps {
  metric: VolumeMetric;
  onChange: (metric: VolumeMetric) => void;
  /** Rótulos (e ordem) das opções. Padrão: Demandas / Horas. */
  labels?: Partial<Record<VolumeMetric, string>>;
  accent?: VolumeAccent;
  className?: string;
}

export const MetricToggle: React.FC<MetricToggleProps> = ({ metric, onChange, labels = DEMANDAS_HORAS, accent = 'blue', className = '' }) => (
  <div className={`flex gap-1 ${className}`}>
    {(Object.keys(labels) as VolumeMetric[]).map(m => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${metric === m ? ACCENT[accent].toggleOn : TOGGLE_OFF}`}
      >
        {labels[m]}
      </button>
    ))}
  </div>
);

export default MetricToggle;
