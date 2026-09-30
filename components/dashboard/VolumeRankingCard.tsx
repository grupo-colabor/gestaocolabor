/**
 * CARTÃO DE RANKING POR PERÍODO — "Volume por Local", "Volume por Corredor" e
 * "Volume por Estado (UF)" da aba Geral do Dashboard.
 *
 * O cartão NÃO calcula nada: recebe um `VolumeRanking` pronto, que a tela
 * monta com `rankVolumeByPeriod` (domain/dashboardVolume.ts) sobre os mesmos
 * recortes P1…PN dos KPIs do topo. Aqui só se desenha:
 *
 * - uma barra por período em cada linha, nas cores de PERIOD_COLORS e na
 *   mesma ordem dos outros gráficos, com o número ao lado de cada barra;
 * - com UM período, uma barra só, na cor do cartão — como sempre foi;
 * - a variação de P1 contra P2 ao lado do número de P1, no formato dos KPIs
 *   (↓ -12 (-27%)), só quando há P2. Contra P3/P4 não: vira poluição;
 * - "+N ocultos" no título e a linha "Outros (N …)", que expande e soma por
 *   período;
 * - a escala das barras é `ranking.max` — o maior valor entre todos os
 *   períodos de todas as linhas — para uma barra ser comparável com qualquer
 *   outra do cartão, de outra linha ou de outro período.
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

export type VolumeAccent = 'blue' | 'emerald' | 'amber';

const ACCENT: Record<VolumeAccent, { bar: string; badge: string; toggleOn: string }> = {
  blue:    { bar: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-400',       toggleOn: 'bg-blue-500 text-white' },
  emerald: { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-400', toggleOn: 'bg-emerald-500 text-white' },
  amber:   { bar: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-400',     toggleOn: 'bg-amber-500 text-white' },
};

const TOGGLE_OFF = 'bg-slate-100 text-slate-400 hover:bg-slate-200';

/** Horas com fração só quando necessário (75.5, mas 88 em vez de 88.0). */
const formatNumber = (v: number) => {
  const r = Math.round((v + Number.EPSILON) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export interface VolumeRankingCardProps {
  title: string;
  icon: LucideIcon;
  accent: VolumeAccent;
  ranking: VolumeRanking;
  metric: VolumeMetric;
  onMetricChange: (metric: VolumeMetric) => void;
  /** Rótulo de cada período, P1 primeiro (ex.: "01 de set. de 26 – 30 de set. de 26"), para o tooltip da barra. */
  periodLabels: string[];
  /** O que se agrupa, no plural, para "Outros (N locais)". */
  unitLabel?: string;
  emptyLabel?: string;
}

const VolumeRankingCard: React.FC<VolumeRankingCardProps> = ({
  title, icon: Icon, accent, ranking, metric, onMetricChange, periodLabels,
  unitLabel = 'locais', emptyLabel = 'Sem dados',
}) => {
  const [expanded, setExpanded] = useState(false);
  const styles = ACCENT[accent];
  const { items, othersDetail, others } = ranking;
  const nPeriods = periodLabels.length;
  const compare = nPeriods >= 2;
  const max = Math.max(ranking.max, 1);

  const fmt = (v: number) => (metric === 'hours' ? `${formatNumber(v)}h` : String(v));
  const valueWidth = metric === 'hours' ? 'w-12' : 'w-6';

  const renderRow = (row: VolumeRankRow, position: string, isOthers: boolean, onClick?: () => void) => (
    <div
      key={`${row.name}-${position}`}
      className={`flex items-start gap-2 py-1 px-1.5 rounded-lg transition-colors ${isOthers ? 'cursor-pointer hover:bg-slate-50 group' : ''}`}
      onClick={onClick}
      title={isOthers ? `Clique para ver todos os ${unitLabel}` : row.name}
    >
      <span className="text-[9px] font-black text-slate-300 w-3.5 text-right shrink-0 leading-3">{position}</span>
      <span className={`text-[10px] font-bold truncate shrink-0 w-28 leading-3 ${isOthers ? 'text-blue-500 group-hover:underline' : 'text-slate-600'}`}>
        {row.name}
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
                title={compare ? `P${i + 1} · ${periodLabels[i]} · ${fmt(value)}` : `${periodLabels[0]} · ${fmt(value)}`}
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
              <span className={`${valueWidth} shrink-0 text-right text-[10px] font-black leading-3 ${isOthers ? 'text-slate-400' : i === 0 ? 'text-slate-700' : 'text-slate-500'}`}>
                {fmt(value)}
              </span>
              {compare && (
                <span className={`w-[4.5rem] shrink-0 text-[9px] font-black leading-3 flex items-center gap-0.5 ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                  {variation && (
                    <>
                      <span>{good ? '↑' : '↓'}</span>
                      <span>{variation.delta >= 0 ? '+' : ''}{formatNumber(variation.delta)}</span>
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

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
        <span>{title}</span>
        <div className="flex items-center gap-1.5">
          {othersDetail.length > 0 && (
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${styles.badge}`}>
              +{othersDetail.length} ocultos
            </span>
          )}
          <Icon size={13} />
        </div>
      </h3>
      <div className="flex gap-1 mb-3 shrink-0">
        <button
          onClick={() => onMetricChange('count')}
          className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${metric === 'count' ? styles.toggleOn : TOGGLE_OFF}`}
        >
          Qtd. Treinamentos
        </button>
        <button
          onClick={() => onMetricChange('hours')}
          className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${metric === 'hours' ? styles.toggleOn : TOGGLE_OFF}`}
        >
          Horas
        </button>
      </div>

      {isEmpty ? (
        <div className="h-full flex-1 flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-0.5">
          {items.map((row, idx) => renderRow(row, String(idx + 1), false))}
          {expanded
            ? othersDetail.map((row, j) => renderRow(row, String(items.length + j + 1), false))
            : others && renderRow(
                { name: `Outros (${othersDetail.length} ${unitLabel})`, periods: others.periods },
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
