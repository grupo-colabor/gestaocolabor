import React from 'react';
import { Filter, RotateCcw, ChevronUp, ChevronDown, Search } from 'lucide-react';

/**
 * PRIMITIVOS DO PAINEL DE FILTROS
 *
 * Só a casca e o campo — a lista de filtros continua sendo de cada tela, porque
 * os conjuntos divergem de verdade: a demanda de cliente filtra por treinamento
 * e modalidade, a interna por categoria (e nunca por modalidade, que é sempre
 * PRESENCIAL). Um componente "renderize estes N descritores de campo" seria uma
 * abstração maior do que qualquer uma das duas telas precisa.
 *
 * O que estava duplicado de fato eram as CLASSES — a casca do card, o rótulo em
 * caps, o input e o select. É isso que mora aqui, para os dois painéis não
 * divergirem visualmente com o tempo.
 *
 * ⚠️ `components/Demands.tsx` ainda monta o painel dele inline, com esta mesma
 * marcação. Migrar aquela tela para cá é seguro mas não é de graça, e ela é a
 * tela mais usada do app — fica para quando houver apetite de mexer nela.
 */

/** Classes do input/select de filtro. Exportadas para campos fora do padrão. */
export const FILTER_INPUT_CLASS =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none';

export const FILTER_LABEL_CLASS =
  'text-[10px] font-black text-slate-400 uppercase tracking-tight';

/** Campo rotulado do painel — label em caps + controle. */
export const FilterField: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className = '',
}) => (
  <div className={`space-y-1.5 ${className}`}>
    <label className={FILTER_LABEL_CLASS}>{label}</label>
    {children}
  </div>
);

/** Campo de busca com a lupa embutida. */
export const FilterSearchField: React.FC<{
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, placeholder, value, onChange }) => (
  <FilterField label={label}>
    <div className="relative">
      <Search className="absolute left-3 top-2.5 text-slate-300" size={16} />
      <input
        type="text"
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  </FilterField>
);

/** Par de datas De/Até, ocupando uma célula da grade. */
export const FilterDateRangeField: React.FC<{
  label: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}> = ({ label, from, to, onFromChange, onToChange }) => (
  <FilterField label={label}>
    <div className="grid grid-cols-2 gap-2">
      <input type="date" className={FILTER_INPUT_CLASS} value={from} onChange={e => onFromChange(e.target.value)} />
      <input type="date" className={FILTER_INPUT_CLASS} value={to} onChange={e => onToChange(e.target.value)} />
    </div>
  </FilterField>
);

/** Grade de 4 colunas usada nas duas linhas do painel. */
export const FilterGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}>{children}</div>
);

/**
 * Casca do painel: cabeçalho "Filtros" + "Limpar Filtros", a linha principal
 * (`children`) e o bloco avançado sob o toggle (`advanced`).
 */
export const FilterPanelShell: React.FC<{
  onClear: () => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  children: React.ReactNode;
  advanced?: React.ReactNode;
}> = ({ onClear, showAdvanced, onToggleAdvanced, children, advanced }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <Filter size={14} /> Filtros
      </h3>
      <button
        onClick={onClear}
        className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
      >
        <RotateCcw size={12} /> Limpar Filtros
      </button>
    </div>

    {children}

    {advanced && (
      <>
        <button
          onClick={onToggleAdvanced}
          className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
        >
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showAdvanced ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}
        </button>

        {showAdvanced && (
          <FilterGrid className="pt-2 border-t border-slate-100">{advanced}</FilterGrid>
        )}
      </>
    )}
  </div>
);
