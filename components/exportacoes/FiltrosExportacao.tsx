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
import { OPTION_LABELS, type ExportOptions, type OptionKey } from '../../domain/exports/options';

/**
 * Filtros da exportação. Só renderiza as chaves que o dataset declara
 * (`dataset.filters`); as opções vêm dos dados carregados
 * (domain/exports/filters.buildFilterOptions). Primitivos visuais do painel
 * de filtros da demanda interna (components/demand-form/FilterPanel.tsx).
 *
 * `periodo` (interseção) e `periodoInicio` (data de início dentro do
 * intervalo) usam o mesmo par de datas — o rótulo diz qual regra vale.
 */
const FiltrosExportacao: React.FC<{
  allowed: FilterKey[];
  value: ExportFilters;
  options: FilterOptions | null;
  onChange: (next: ExportFilters) => void;
  /** Opções marcáveis que o dataset oferece (options.ts) e o estado delas. */
  allowedOptions: OptionKey[];
  optionValues: ExportOptions;
  onOptionsChange: (next: ExportOptions) => void;
  /** Texto fixo abaixo dos filtros (regra do período). */
  nota?: React.ReactNode;
}> = ({ allowed, value, options, onChange, allowedOptions, optionValues, onOptionsChange, nota }) => {
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

  const toggleStatusMedicao = (s: string) =>
    set({
      statusMedicao: value.statusMedicao.includes(s)
        ? value.statusMedicao.filter(x => x !== s)
        : [...value.statusMedicao, s],
    });

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
        {on('periodoInicio') && (
          <FilterDateRangeField
            label="Período (data de início da turma)"
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
        {on('corredor') && (
          <Select label="Corredor" v={value.corredor} onV={s => set({ corredor: s })} items={(options?.corredores ?? []).map(c => ({ value: c, label: c }))} />
        )}
        {on('site') && (
          <Select label="Site / planta (local)" v={value.site} onV={s => set({ site: s })} items={(options?.sites ?? []).map(c => ({ value: c, label: c }))} />
        )}
        {on('instrutor') && (
          <Select label="Pessoa (instrutor)" v={value.instructorId} onV={s => set({ instructorId: s })} items={(options?.instrutores ?? []).map(i => ({ value: i.id, label: i.name }))} todos="Todas" />
        )}
        {on('papel') && (
          <Select label="Papel" v={value.papel} onV={s => set({ papel: s as ExportFilters['papel'] })} items={options?.papel ?? []} />
        )}
        {on('modoTransporte') && (
          <Select label="Modo de transporte (blocos de locomoção)" v={value.modoTransporte} onV={s => set({ modoTransporte: s })} items={options?.modosTransporte ?? []} />
        )}
        {on('pendenciaDoc') && (
          <FilterField label="Documentos">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer pt-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={value.somentePendenciaDoc}
                onChange={e => set({ somentePendenciaDoc: e.target.checked })}
              />
              Só com pendência de documento
            </label>
          </FilterField>
        )}
        {on('statusMedicao') && (
          <FilterField label="Status da medição (vazio = todas)" className="lg:col-span-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {(options?.statusMedicao ?? []).map(o => (
                <label key={o.value} className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={value.statusMedicao.includes(o.value)}
                    onChange={() => toggleStatusMedicao(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </FilterField>
        )}
      </FilterGrid>

      {allowedOptions.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-3">
          {allowedOptions.map(k => (
            <label key={k} className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer" title={OPTION_LABELS[k].help}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={optionValues[k]}
                onChange={e => onOptionsChange({ ...optionValues, [k]: e.target.checked })}
              />
              {OPTION_LABELS[k].label}
            </label>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-3">
        {nota ?? (
          <>
            O período seleciona as demandas que têm ao menos um dia dentro do intervalo. As horas saem
            inteiras, sem rateio pelos dias do período — o rateio mensal é regra da planilha de pagamento
            (Medição → Exportar Medição), não desta aba.
          </>
        )}
      </p>
    </div>
  );
};

export default FiltrosExportacao;
