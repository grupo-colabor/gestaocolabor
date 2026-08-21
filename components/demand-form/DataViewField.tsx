import React from 'react';
import { FileCheck } from 'lucide-react';

/**
 * Campo somente-leitura do modo VIEW do formulário de demanda.
 *
 * Movido de dentro do componente `Demands` (onde era redefinido a cada render,
 * remontando a subárvore inteira sem necessidade). Puramente apresentacional:
 * sem estado, sem efeito, mesma marcação de antes.
 */
const DataViewField = ({
  label,
  value,
  icon: Icon,
  isPdf = false,
  onDownload,
}: {
  label: string;
  value: string | number | undefined;
  icon?: any;
  isPdf?: boolean;
  onDownload?: () => void;
}) => (
  <div className="flex flex-col space-y-1">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className="text-slate-400" />}
      {isPdf && value ? (
        <button onClick={onDownload} className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1.5">
          <FileCheck size={14} /> {value}
        </button>
      ) : (
        <span className="text-sm font-bold text-slate-700">{value || '---'}</span>
      )}
    </div>
  </div>
);

export default DataViewField;
