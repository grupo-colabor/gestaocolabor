import React from 'react';
import { Columns3, ArrowUp, ArrowDown, CheckSquare, Square, RotateCcw } from 'lucide-react';
import type { AnyDataset } from '../../domain/exports/registry';
import type { ColumnDef } from '../../domain/exports/types';
import { defaultColumnKeys } from '../../domain/exports/buildRows';

/**
 * Escolha e ORDEM das colunas. Sem drag-and-drop (F1): ↑/↓ por teclado e
 * mouse, zero dependência. `selected` é a lista ordenada de chaves ligadas;
 * as desligadas aparecem depois, na ordem do dataset, para poderem ser
 * religadas.
 */
const ColunasSelector: React.FC<{
  dataset: AnyDataset;
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ dataset, selected, onChange }) => {
  const byKey = new Map<string, ColumnDef<any>>(dataset.columns.map(c => [c.key, c]));
  const ligadas = selected.filter(k => byKey.has(k));
  const desligadas = dataset.columns.map(c => c.key).filter(k => !ligadas.includes(k));

  const toggle = (key: string) =>
    onChange(ligadas.includes(key) ? ligadas.filter(k => k !== key) : [...ligadas, key]);

  const move = (key: string, delta: -1 | 1) => {
    const i = ligadas.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ligadas.length) return;
    const next = [...ligadas];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const Linha: React.FC<{ k: string; idx: number; ligada: boolean }> = ({ k, idx, ligada }) => {
    const c = byKey.get(k)!;
    return (
      <li
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
          ligada ? 'bg-white border-slate-200' : 'bg-slate-50 border-transparent text-slate-400'
        }`}
        title={c.help}
      >
        <button type="button" onClick={() => toggle(k)} aria-label={ligada ? 'Desligar coluna' : 'Ligar coluna'} className={ligada ? 'text-blue-600' : 'text-slate-300'}>
          {ligada ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
        <span className={`flex-1 truncate ${ligada ? 'font-bold text-slate-700' : ''}`}>{c.header}</span>
        {ligada && (
          <>
            <span className="text-[10px] text-slate-300 font-mono w-5 text-right">{idx + 1}</span>
            <button type="button" onClick={() => move(k, -1)} disabled={idx === 0} aria-label="Subir" className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
              <ArrowUp size={12} />
            </button>
            <button type="button" onClick={() => move(k, 1)} disabled={idx === ligadas.length - 1} aria-label="Descer" className="p-1 rounded hover:bg-slate-100 disabled:opacity-30">
              <ArrowDown size={12} />
            </button>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Columns3 size={14} /> Colunas ({ligadas.length} de {dataset.columns.length})
        </h3>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onChange(dataset.columns.map(c => c.key))} className="text-[10px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest">
            Todas
          </button>
          <button type="button" onClick={() => onChange([])} className="text-[10px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest">
            Nenhuma
          </button>
          <button type="button" onClick={() => onChange(defaultColumnKeys(dataset))} className="text-[10px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest flex items-center gap-1">
            <RotateCcw size={11} /> Padrão
          </button>
        </div>
      </div>

      <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {ligadas.map((k, i) => <Linha key={k} k={k} idx={i} ligada />)}
        {desligadas.length > 0 && ligadas.length > 0 && (
          <li className="text-[10px] font-black text-slate-300 uppercase tracking-widest pt-2 px-1">Desligadas</li>
        )}
        {desligadas.map(k => <Linha key={k} k={k} idx={-1} ligada={false} />)}
      </ul>
    </div>
  );
};

export default ColunasSelector;
