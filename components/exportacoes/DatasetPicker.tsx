import React from 'react';
import { Database } from 'lucide-react';
import type { AnyDataset } from '../../domain/exports/registry';
import type { DatasetKey } from '../../domain/exports/types';

/**
 * Escolha do módulo a exportar. Recebe só os datasets que o perfil pode ver
 * (registry.visibleDatasets) — o que o perfil não vê não aparece nem apagado.
 */
const DatasetPicker: React.FC<{
  datasets: AnyDataset[];
  value: DatasetKey;
  onChange: (key: DatasetKey) => void;
  disabled?: boolean;
}> = ({ datasets, value, onChange, disabled }) => (
  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-3">
      <Database size={14} /> Módulo
    </h3>
    <div className="flex flex-wrap gap-2">
      {datasets.map(d => {
        const ativo = d.key === value;
        return (
          <button
            key={d.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(d.key)}
            title={d.description}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition border ${
              ativo
                ? 'bg-slate-900 text-white border-slate-900 shadow'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
    <p className="text-[11px] text-slate-400 mt-3">
      {datasets.find(d => d.key === value)?.description}
    </p>
  </div>
);

export default DatasetPicker;
