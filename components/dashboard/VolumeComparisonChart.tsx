/**
 * COMPARATIVO ENTRE EMPRESAS — barras agrupadas por período (Recharts, como
 * "Volume por Região"), abaixo do ranking "Clientes mais Ativos".
 *
 * É OUTRA VISTA do mesmo VolumeRanking do cartão: a tela passa um
 * `VolumeComparison` (domain/dashboardVolume.ts → buildVolumeComparison), em
 * que cada barra é a célula do ranking e a participação é a célula sobre o
 * total do período. Este componente não soma nada: monta a série do Recharts,
 * o tooltip e os controles.
 *
 * - eixo X = empresas; uma barra por período P1…PN nas cores padrão; legenda
 *   por período (clique esconde a série);
 * - toggle Demandas / Horas (a métrica) e Escala: absoluta / participação (%).
 *   Em participação cada barra vira a fatia da empresa dentro do período
 *   (Vale 164 de 171 = 96%) — sem isso a Vale esmaga as outras e o gráfico
 *   não mostra nada;
 * - as 8 maiores em P1 + "Outras"; um seletor multi-escolha troca quais
 *   aparecem (comparar Vale com uma segunda empresa só);
 * - tooltip: empresa, período (rótulo), valor — e, em participação, "x de
 *   total" — e a variação de P1 contra P2, sobre os valores absolutos.
 */
import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Building2, ChevronDown, X } from 'lucide-react';
import { findDominantRow, volumeVariation, type VolumeComparison, type VolumeMetric } from '../../domain/dashboardVolume';
import { periodColor } from './periodColors';
import { formatVolumeDelta, formatVolumeValue } from './VolumeRankingCard';
import { formatShare, formatShareTick } from './volumeFormat';

export type VolumeScale = 'abs' | 'share';

const PILL_ON = 'bg-white text-slate-800 shadow-sm';
const PILL_OFF = 'text-slate-400 hover:text-slate-600';

export interface VolumeComparisonChartProps {
  title: string;
  subtitle?: string;
  comparison: VolumeComparison;
  metric: VolumeMetric;
  onMetricChange: (m: VolumeMetric) => void;
  metricLabels?: Partial<Record<VolumeMetric, string>>;
  scale: VolumeScale;
  onScaleChange: (s: VolumeScale) => void;
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  /** Rótulo de cada período, P1 primeiro. */
  periodLabels: string[];
  /** O que está no eixo X, no plural ("empresas"). */
  unitLabel?: string;
  emptyLabel?: string;
  /** Quantas entram antes de "Outras" no modo automático (só para o texto do seletor). */
  limit?: number;
}

const VolumeComparisonChart: React.FC<VolumeComparisonChartProps> = ({
  title, subtitle, comparison, metric, onMetricChange, metricLabels = { count: 'Demandas', hours: 'Horas' },
  scale, onScaleChange, selectedKeys, onSelectedKeysChange, periodLabels, unitLabel = 'empresas',
  emptyLabel = 'Sem dados', limit = 8,
}) => {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const nPeriods = periodLabels.length;
  const keys = periodLabels.map((_, i) => `P${i + 1}`);
  const { rows, totals, available } = comparison;

  const data = rows.map(r => {
    const row: Record<string, any> = { name: r.name, key: r.key, isOthers: !!r.isOthers, values: r.values, shares: r.shares };
    // Participação vai crua para a barra; quem arredonda é só o texto (formatShare).
    keys.forEach((k, i) => { row[k] = scale === 'share' ? r.shares[i] : r.values[i]; });
    return row;
  });

  const fmt = (v: number) => formatVolumeValue(metric, v);
  const fmtAxis = (v: number) => (scale === 'share' ? formatShareTick(v) : metric === 'hours' ? `${v}h` : String(v));
  const barSize = Math.max(8, Math.floor(40 / Math.max(1, nPeriods)));

  // Quem concentra mais de DOMINANCE_THRESHOLD do P1 esmaga as outras em qualquer escala. O aviso
  // transforma a descoberta ("tire a Vale no seletor") num clique: o link
  // aplica o seletor com todas as demais. A decisão é do domínio, sobre a
  // participação já calculada.
  const dominant = findDominantRow(comparison);

  const toggleKey = (key: string) =>
    onSelectedKeysChange(selectedKeys.includes(key) ? selectedKeys.filter(k => k !== key) : [...selectedKeys, key]);
  const selectionLabel = selectedKeys.length > 0
    ? `${selectedKeys.length} ${selectedKeys.length === 1 ? 'selecionada' : 'selecionadas'}`
    : `Top ${Math.min(limit, available.length)}${available.length > limit ? ' + Outras' : ''}`;

  const TooltipContent = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload as { name: string; values: number[]; shares: number[] };
    const variation = nPeriods >= 2 ? volumeVariation(row.values[0], row.values[1]) : null;
    const good = variation ? variation.delta >= 0 : true;
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-[10px] font-bold text-slate-600 space-y-1">
        <p className="text-[11px] font-black text-slate-800">{row.name}</p>
        {keys.map((k, i) => (
          <div key={k} className={`flex items-center gap-1.5 ${hidden[k] ? 'opacity-40' : ''}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: periodColor(i) }} />
            <span className="font-black" style={{ color: periodColor(i) }}>{k}</span>
            <span className="text-slate-400">{periodLabels[i]}</span>
            <span className="font-black text-slate-800 ml-1">
              {scale === 'share'
                ? `${fmt(row.values[i])} de ${fmt(totals[i])} — ${formatShare(row.shares[i])}`
                : fmt(row.values[i])}
            </span>
            {i === 0 && variation && (
              <span className={`font-black ${good ? 'text-emerald-600' : 'text-red-500'}`}>
                {good ? '↑' : '↓'} {variation.delta >= 0 ? '+' : ''}{formatVolumeDelta(metric, variation.delta)}
                {variation.pct !== null && <span className="opacity-70"> ({variation.pct > 0 ? '+' : ''}{variation.pct}%)</span>}
                <span className="text-slate-400 font-bold"> vs P2</span>
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4 shrink-0">
        <div>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <span>{title}</span>
            <Building2 size={14} className="text-slate-300" />
          </h3>
          {subtitle && <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mt-1">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Métrica */}
          <span className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg">
            {(Object.keys(metricLabels) as VolumeMetric[]).map(m => (
              <button key={m} onClick={() => onMetricChange(m)} className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition ${metric === m ? PILL_ON : PILL_OFF}`}>
                {metricLabels[m]}
              </button>
            ))}
          </span>
          {/* Escala */}
          <span className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            <span className="pl-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Escala</span>
            <button onClick={() => onScaleChange('abs')} className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition ${scale === 'abs' ? PILL_ON : PILL_OFF}`}>Absoluta</button>
            <button onClick={() => onScaleChange('share')} className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition ${scale === 'share' ? PILL_ON : PILL_OFF}`}>Participação (%)</button>
          </span>
          {/* Seletor de empresas */}
          <span className="relative">
            <button
              onClick={() => setPickerOpen(o => !o)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-300 transition"
            >
              <span className="capitalize">{unitLabel}:</span> {selectionLabel}
              <ChevronDown size={11} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto custom-scrollbar bg-white border border-slate-200 rounded-xl shadow-xl p-2">
                <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Comparar {unitLabel}</span>
                  <div className="flex items-center gap-2">
                    {selectedKeys.length > 0 && (
                      <button onClick={() => onSelectedKeysChange([])} className="text-[9px] font-black text-blue-500 uppercase tracking-widest hover:text-blue-700">Limpar</button>
                    )}
                    <button onClick={() => setPickerOpen(false)} className="text-slate-300 hover:text-slate-600" title="Fechar"><X size={12} /></button>
                  </div>
                </div>
                {available.length === 0 ? (
                  <p className="px-1 py-2 text-[10px] text-slate-300 italic">Sem {unitLabel} no período</p>
                ) : available.map(a => (
                  <label key={a.key} className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" className="accent-blue-600" checked={selectedKeys.includes(a.key)} onChange={() => toggleKey(a.key)} />
                    <span className="text-[10px] font-bold text-slate-600 truncate">{a.name}</span>
                  </label>
                ))}
                <p className="px-1 pt-1.5 mt-1 border-t border-slate-100 text-[9px] text-slate-300 font-bold">
                  Sem seleção: as {limit} maiores em P1 e "Outras".
                </p>
              </div>
            )}
          </span>
        </div>
      </div>

      {dominant && (
        <div className="flex items-center gap-2 mb-3 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-[10px] font-bold text-slate-500 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>
            <span className="font-black text-slate-700 uppercase">{dominant.name}</span> concentra {formatShare(dominant.share)} de P1
          </span>
          <span className="text-slate-300">—</span>
          <button
            onClick={() => onSelectedKeysChange(dominant.otherKeys)}
            className="font-black text-blue-500 hover:text-blue-700 underline underline-offset-2"
          >
            ver as demais
          </button>
        </div>
      )}

      {/* Altura FIXA de propósito: o ResponsiveContainer do Recharts mede em
          porcentagem, e porcentagem de um pai com altura indefinida (só
          min-height) vira zero — o gráfico some sem erro. */}
      <div className="shrink-0" style={{ height: '18rem' }}>
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">{emptyLabel}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} interval={0} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={fmtAxis} domain={scale === 'share' ? [0, 100] : [0, 'auto']} />
              <Tooltip cursor={{ fill: '#F8FAFC' }} content={<TooltipContent />} />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                onClick={(e: any) => setHidden(h => ({ ...h, [e.dataKey]: !h[e.dataKey] }))}
              />
              {keys.map((k, i) => (
                <Bar key={k} dataKey={k} name={k} fill={periodColor(i)} radius={[4, 4, 0, 0]} barSize={barSize} hide={!!hidden[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default VolumeComparisonChart;
