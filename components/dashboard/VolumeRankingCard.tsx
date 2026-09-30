/**
 * CARTÃO DE RANKING POR PERÍODO — todos os rankings do Dashboard: "Volume por
 * Local / Corredor / UF" (Geral), "Top Treinamentos" e "Demandas por Instrutor"
 * (Operacional), "Horas Ministradas por Instrutor" e "Reaproveitamento"
 * (Instrutores), "Clientes mais Ativos" (Clientes), "Top Instrutores por Custo"
 * (Custos), "Distribuição por Categoria" e "Top Instrutores em Horas Internas"
 * (Internas).
 *
 * O cartão NÃO calcula nada: recebe um `VolumeRanking` pronto, que a tela
 * monta com `rankVolumeByPeriod` / `rankVolumeRows` (domain/dashboardVolume.ts)
 * sobre os mesmos recortes P1…PN dos KPIs do topo. Aqui só se desenha:
 *
 * - uma barra por período em cada linha, nas cores de PERIOD_COLORS e na
 *   mesma ordem dos outros gráficos, com o número ao lado de cada barra;
 * - com UM período, uma barra só, na cor do cartão — como sempre foi;
 * - a variação de P1 contra P2 ao lado do número de P1, no formato dos KPIs
 *   (↓ -12 (-27%)), só quando há P2. Contra P3/P4 não: vira poluição;
 * - "+N ocultos" no título e a linha "Outros (N …)", que expande e soma por
 *   período;
 * - o toggle de métrica só quando a tela passa `onMetricChange` — ou seja,
 *   quando o cartão já tinha duas métricas (Qtd/Horas, Horas/Demandas);
 * - a escala das barras é `ranking.max` — o maior valor entre todos os
 *   períodos de todas as linhas — para uma barra ser comparável com qualquer
 *   outra do cartão, de outra linha ou de outro período;
 * - altura máxima com rolagem interna quando há mais de 3 períodos ou mais
 *   de 8 linhas; cabeçalho, subtítulo e toggle ficam fixos no topo.
 */
import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  volumeValue,
  volumeVariation,
  type VolumeMetric,
  type VolumeRanking,
  type VolumeRankRow,
} from '../../domain/dashboardVolume';
import { periodColor } from './periodColors';

export type VolumeAccent = 'blue' | 'emerald' | 'amber' | 'violet' | 'indigo' | 'teal';

const ACCENT: Record<VolumeAccent, { bar: string; badge: string; toggleOn: string }> = {
  blue:    { bar: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-400',       toggleOn: 'bg-blue-500 text-white' },
  emerald: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-400', toggleOn: 'bg-emerald-500 text-white' },
  amber:   { bar: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-400',     toggleOn: 'bg-amber-500 text-white' },
  violet:  { bar: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-400',   toggleOn: 'bg-violet-500 text-white' },
  indigo:  { bar: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-400',   toggleOn: 'bg-indigo-500 text-white' },
  teal:    { bar: 'bg-teal-500',    badge: 'bg-teal-50 text-teal-400',       toggleOn: 'bg-teal-500 text-white' },
};

const TOGGLE_OFF = 'bg-slate-100 text-slate-400 hover:bg-slate-200';

const DEFAULT_METRIC_LABELS: Partial<Record<VolumeMetric, string>> = { count: 'Qtd. Treinamentos', hours: 'Horas' };

/** Acima disto (períodos ou linhas visíveis) a lista ganha teto e rola por dentro. */
const MAX_PERIODS_WITHOUT_CAP = 3;
const MAX_ROWS_WITHOUT_CAP = 8;

/** Horas com fração só quando necessário (75.5, mas 88 em vez de 88.0). */
const formatNumber = (v: number) => {
  const r = Math.round((v + Number.EPSILON) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** Como cada métrica aparece: valor, delta da variação e largura das colunas. */
const METRIC_FORMAT: Record<VolumeMetric, { value: (v: number) => string; delta: (v: number) => string; valueWidth: string; variationWidth: string }> = {
  count:    { value: v => String(v),                 delta: v => String(v),         valueWidth: 'w-6',  variationWidth: 'w-[4.5rem]' },
  distinct: { value: v => String(v),                 delta: v => String(v),         valueWidth: 'w-6',  variationWidth: 'w-[4.5rem]' },
  hours:    { value: v => `${formatNumber(v)}h`,      delta: v => formatNumber(v),   valueWidth: 'w-12', variationWidth: 'w-[4.5rem]' },
  cost:     { value: v => formatCurrency(v),          delta: v => formatCurrency(v), valueWidth: 'w-20', variationWidth: 'w-32' },
};

export interface VolumeRankingCardProps {
  title: string;
  /** Linha discreta sob o título (ex.: "Soma de despesas das medições por instrutor no período"). */
  subtitle?: string;
  icon: LucideIcon;
  accent: VolumeAccent;
  ranking: VolumeRanking;
  metric: VolumeMetric;
  /** Quando presente, o cartão mostra o toggle de métrica (as chaves de `metricLabels`). */
  onMetricChange?: (metric: VolumeMetric) => void;
  /** Rótulos (e ordem) das métricas do toggle. Padrão: Qtd. Treinamentos / Horas. */
  metricLabels?: Partial<Record<VolumeMetric, string>>;
  /** Rótulo de cada período, P1 primeiro (ex.: "01 de set. de 26 – 30 de set. de 26"), para o tooltip da barra. */
  periodLabels: string[];
  /** O que se agrupa, no plural, para "Outros (N locais)". */
  unitLabel?: string;
  emptyLabel?: string;
  /** Controles extras no cabeçalho, entre o título e o ícone (ex.: o toggle Treinamentos/Internas). */
  headerExtra?: React.ReactNode;
  /** Classes do cartão na grade (ex.: "lg:col-span-4"). */
  className?: string;
  /** Altura mínima do cartão. Padrão 20rem. */
  minHeight?: string;
}

const VolumeRankingCard: React.FC<VolumeRankingCardProps> = ({
  title, subtitle, icon: Icon, accent, ranking, metric, onMetricChange, metricLabels = DEFAULT_METRIC_LABELS,
  periodLabels, unitLabel = 'locais', emptyLabel = 'Sem dados', headerExtra, className = '', minHeight = '20rem',
}) => {
  const [expanded, setExpanded] = useState(false);
  const styles = ACCENT[accent];
  const format = METRIC_FORMAT[metric];
  const { items, othersDetail, others } = ranking;
  const nPeriods = periodLabels.length;
  const compare = nPeriods >= 2;
  const max = Math.max(ranking.max, 1);

  const visibleRows = expanded ? items.length + othersDetail.length : items.length + (others ? 1 : 0);
  const capped = nPeriods > MAX_PERIODS_WITHOUT_CAP || visibleRows > MAX_ROWS_WITHOUT_CAP;

  const renderRow = (row: VolumeRankRow, position: string, isOthers: boolean, onClick?: () => void) => (
    <div
      key={`${row.key}-${position}`}
      className={`flex items-start gap-2 py-1 px-1.5 rounded-lg transition-colors ${isOthers ? 'cursor-pointer hover:bg-slate-50 group' : ''}`}
      onClick={onClick}
      title={isOthers ? `Clique para ver todos os ${unitLabel}` : row.note ? `${row.name} · ${row.note}` : row.name}
    >
      <span className="text-[9px] font-black text-slate-300 w-3.5 text-right shrink-0 leading-3">{position}</span>
      <span className={`text-[10px] font-bold truncate shrink-0 w-28 leading-3 ${isOthers ? 'text-blue-500 group-hover:underline' : 'text-slate-600'}`}>
        {row.name}
        {row.note && !isOthers && (
          <span className="ml-1 text-[8px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 uppercase whitespace-nowrap align-middle">
            {row.note}
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {row.periods.map((totals, i) => {
          const value = volumeValue(totals, metric);
          const color = compare ? periodColor(i) : undefined;
          const variation = compare && i === 0 ? volumeVariation(value, volumeValue(row.periods[1], metric)) : null;
          const good = variation ? variation.delta >= 0 : true;
          return (
            <div key={i} className="flex items-center gap-1.5 h-3">
              {compare && (
                <span className="text-[8px] font-black uppercase tracking-wider w-4 shrink-0 leading-3" style={{ color }}>
                  P{i + 1}
                </span>
              )}
              <div
                className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"
                title={compare ? `P${i + 1} · ${periodLabels[i]} · ${format.value(value)}` : `${periodLabels[0]} · ${format.value(value)}`}
              >
                <div
                  className={`h-full rounded-full transition-all ${compare ? '' : isOthers ? 'bg-slate-300' : styles.bar}`}
                  style={{
                    width: `${Math.min(100, Math.round((value / max) * 100))}%`,
                    background: color,
                    opacity: compare && isOthers ? 0.45 : 1,
                  }}
                />
              </div>
              <span className={`${format.valueWidth} shrink-0 text-right text-[10px] font-black leading-3 whitespace-nowrap ${isOthers ? 'text-slate-400' : i === 0 ? 'text-slate-700' : 'text-slate-500'}`}>
                {format.value(value)}
              </span>
              {compare && (
                <span className={`${format.variationWidth} shrink-0 text-[9px] font-black leading-3 flex items-center gap-0.5 whitespace-nowrap ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                  {variation && (
                    <>
                      <span>{good ? '↑' : '↓'}</span>
                      <span>{variation.delta >= 0 ? '+' : ''}{format.delta(variation.delta)}</span>
                      {variation.pct !== null && (
                        <span className="opacity-70">({variation.pct > 0 ? '+' : ''}{variation.pct}%)</span>
                      )}
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const isEmpty = items.length === 0 && othersDetail.length === 0;
  const toggleMetrics = Object.keys(metricLabels) as VolumeMetric[];

  return (
    <div className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col ${className}`} style={{ minHeight }}>
      <h3 className={`text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between shrink-0 ${subtitle ? 'mb-1' : 'mb-3'}`}>
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {headerExtra}
          {othersDetail.length > 0 && (
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${styles.badge}`}>
              +{othersDetail.length} ocultos
            </span>
          )}
          <Icon size={13} />
        </div>
      </h3>
      {subtitle && (
        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-3 shrink-0">{subtitle}</p>
      )}
      {onMetricChange && (
        <div className="flex gap-1 mb-3 shrink-0">
          {toggleMetrics.map(m => (
            <button
              key={m}
              onClick={() => onMetricChange(m)}
              className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${metric === m ? styles.toggleOn : TOGGLE_OFF}`}
            >
              {metricLabels[m]}
            </button>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="h-full flex-1 flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold text-center px-4">
          {emptyLabel}
        </div>
      ) : (
        <div className={`flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-0.5 custom-scrollbar ${capped ? 'max-h-[24rem]' : ''}`}>
          {items.map((row, idx) => renderRow(row, String(idx + 1), false))}
          {expanded
            ? othersDetail.map((row, j) => renderRow(row, String(items.length + j + 1), false))
            : others && renderRow(
                { ...others, name: `Outros (${othersDetail.length} ${unitLabel})` },
                '…',
                true,
                () => setExpanded(true),
              )}
          {expanded && othersDetail.length > 0 && (
            <button
              onClick={() => setExpanded(false)}
              className="mt-1 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors text-center"
            >
              ▲ Recolher
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VolumeRankingCard;
