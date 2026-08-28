import React from 'react';
import { createPortal } from 'react-dom';
import { X, Truck, AlertCircle, Info } from 'lucide-react';

import { formatDateTime } from './demand-form/formatters';

/**
 * MODAL DE ALOCAÇÃO DE CTM — componente único, usado pelos dois modais
 *
 * Extraído de `components/Demands.tsx` (JSX inline) sem nenhuma alteração de
 * marcação ou comportamento, para que a demanda INTERNA use exatamente a mesma
 * tela — e não uma cópia que diverge no primeiro ajuste de layout ou de
 * validação.
 *
 * Puramente de apresentação: o estado e as regras vivem em
 * `hooks/useResourceAllocation.ts`, que é o outro metade do par.
 */

export interface ResourceAllocationModalProps {
  open: boolean;
  startDate: string;
  endDate: string;
  onChangeStartDate: (value: string) => void;
  onChangeEndDate: (value: string) => void;
  /** Período da demanda, mostrado no aviso — o CTM precisa caber dentro dele. */
  demandStartDate?: string;
  demandEndDate?: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const ResourceAllocationModal: React.FC<ResourceAllocationModalProps> = ({
  open,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  demandStartDate,
  demandEndDate,
  error,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-black text-amber-700 uppercase tracking-tight">Alocar Centro Móvel</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in mb-2">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold text-red-700 leading-tight">
                {error}
              </p>
            </div>
          )}
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-4">
            <div className="p-3 bg-white rounded-xl text-amber-600 shadow-sm border border-amber-100"><Truck size={24}/></div>
            <div>
               <p className="text-sm font-black text-amber-900 uppercase">Recurso Logístico</p>
               <p className="text-xs font-bold text-amber-600">Centro de Treinamento Móvel</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Início</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={startDate}
                onChange={e => onChangeStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Fim</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={endDate}
                onChange={e => onChangeEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2">
            <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-blue-700 leading-tight">
              O CTM deve estar dentro do período: {formatDateTime(demandStartDate?.split('T')[0])} e {formatDateTime(demandEndDate?.split('T')[0])}
            </p>
          </div>
        </div>
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500">Cancelar</button>
          <button onClick={onConfirm} className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-200">Confirmar</button>
        </div>
      </div>
    </div>
  , document.body);
};

export default ResourceAllocationModal;
