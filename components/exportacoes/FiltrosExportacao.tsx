import React from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import {
  FilterField,
  FilterDateRangeField,
  FilterGrid,
  FILTER_INPUT_CLASS,
} from '../demand-form/FilterPanel';
import type { ExportFilters, FilterKey } from '../../domain/exports/types';
import type { FilterOptions } from '../../domain/exports/filters';
import { EMPTY_FILTERS } from '../../domain/exports/types';

/**
 * Filtros da exportação. Só renderiza as chaves que o dataset declara
 * (`dataset.filters`); as opções vêm dos dados carregados
 * (domain/exports/filters.buildFilterOptions). Primitivos visuais do painel
 * de filtros da demanda interna (components/demand-form/FilterPanel.tsx).
 */
const FiltrosExportacao: React.FC<{
  allowed: FilterKey[];
  value: ExportFilters;
  options: FilterOptions | null;
  onChange: (next: ExportFilters) => void;
}> = ({ allowed, value, options, onChange }) => {
  const on = (k: FilterKey) => allowed.includes(k);
  const set = (patch: Partial<ExportFilters>) => onChange({ ...value, ...patch });

  const Select: React.FC<{
    label: string;
    v: string;
    onV: (s: string) => void;
    items: { value: string; label: string }[];
    todos?: string;
  }> = ({ label, v, onV, items, todos = 'Todos' }) => (
    <FilterField label={label}>
      <select className={FILTER_INPUT_CLASS} value={v} onChange={e => onV(e.target.value)}>
        <option value="">{todos}</option>
        {items.map(i => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </FilterField>
  );

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Filter size={14} /> Filtros
        </h3>
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw size={12} /> Limpar Filtros
        </button>
      </div>

      <FilterGrid>
        {on('periodo') && (
          <FilterDateRangeField
            label="Período (demandas que tocam o intervalo)"
            from={value.dataInicio}
            to={value.dataFim}
            onFromChange={v => set({ dataInicio: v })}
            onToChange={v => set({ dataFim: v })}
          />
        )}
        {on('status') && (
          <Select label="Status (calculado)" v={value.status} onV={s => set({ status: s })} items={options?.status ?? []} />
        )}
        {on('modalidade') && (
          <Select label="Modalidade" v={value.modalidade} onV={s => set({ modalidade: s })} items={options?.modalidade ?? []} todos="Todas" />
        )}
        {on('tipo') && (
          <Select
            label="Tipo"
            v={value.tipo}
            onV={s => set({ tipo: s as ExportFilters['tipo'] })}
            items={options?.tipo ?? []}
          />
        )}
        {on('uf') && (
          <Select label="UF" v={value.uf} onV={s => set({ uf: s })} items={(options?.uf ?? []).map(u => ({ value: u, label: u }))} todos="Todas" />
        )}
        {on('cliente') && (
          <Select label="Cliente" v={value.companyId} onV={s => set({ companyId: s })} items={(options?.clientes ?? []).map(c => ({ value: c.id, label: c.name }))} />
        )}
        {on('instrutor') && (
          <Select label="Pessoa (instrutor)" v={value.instructorId} onV={s => set({ instructorId: s })} items={(options?.instrutores ?? []).map(i => ({ value: i.id, label: i.name }))} todos="Todas" />
        )}
        {on('papel') && (
          <Select label="Papel" v={value.papel} onV={s => set({ papel: s as ExportFilters['papel'] })} items={options?.papel ?? []} />
        )}
      </FilterGrid>

      <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
        O período seleciona as demandas que têm ao menos um dia dentro do intervalo. As horas saem
        inteiras, sem rateio pelos dias do período — o rateio mensal é regra da planilha de pagamento
        (Medição → Exportar Medição), não desta aba.
      </p>
    </div>
  );
};

export default FiltrosExportacao;
