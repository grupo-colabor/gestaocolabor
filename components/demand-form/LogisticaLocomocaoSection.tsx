import React from 'react';
import {
  Truck,
  ChevronUp,
  ChevronDown,
  Trash2,
  User,
  Paperclip,
  Upload,
  X,
  Plus,
  Tag,
  Building2,
  MapPin,
  Clock,
} from 'lucide-react';

import type {
  LogisticaLocomocao,
  OperationalBases,
  RentalCompany,
  TransportType,
} from '../../types';
import { supabase } from '../../lib/supabase';
import DataViewField from './DataViewField';
import { formatDateTime } from './formatters';
import type { DemandFormMode, DemandFormSetter, DemandFormState, NotifyFn } from './types';

/**
 * Seção "Logística — Locomoção" do formulário de demanda.
 *
 * Extraída de `Demands.tsx` sem alteração de marcação nem de regra: os
 * handlers multi-bloco vieram junto porque são a própria seção (o
 * `logisticsTransport` derivado do bloco 0 não faz sentido fora dela).
 *
 * A seção lê e escreve apenas `logisticasLocomocao` e `logisticsTransport` do
 * rascunho; recebe o par estado/setter inteiro para que a sincronização do
 * bloco primário continue sendo uma única atualização atômica, como era antes.
 *
 * ⚠️ O `<datalist id="agencias-list">` continua sendo responsabilidade de quem
 * renderiza a seção — nenhum dos dois formulários renderiza datalists aqui.
 */

/** UUID v4 sem crypto.randomUUID() — a coluna id de logistic_blocks é uuid. */
const generateId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Bloco vazio — mesmos defaults do `addLocomocaoBlock` original. */
export const emptyLocomocaoBlock = (): LogisticaLocomocao => ({
  id: generateId(),
  transportType: null,
  rentalCompany: 'Localiza',
  carCategory: 'Grupo CE',
  rentalAgencyLocation: '',
  rentalLocator: '',
});

interface LogisticaLocomocaoSectionProps {
  form: DemandFormState;
  setForm: DemandFormSetter;
  mode: DemandFormMode;
  isOpen: boolean;
  onToggle: () => void;
  operationalBases: OperationalBases;
  onNotify: NotifyFn;
}

const LogisticaLocomocaoSection: React.FC<LogisticaLocomocaoSectionProps> = ({
  form,
  setForm,
  mode,
  isOpen,
  onToggle,
  operationalBases,
  onNotify,
}) => {
  // ─── Handlers multi-bloco: Locomoção ─────────────────────────────────────

  const updateLocomocaoBlock = (index: number, patch: Partial<LogisticaLocomocao>) => {
    setForm(prev => {
      const blocks = [...(prev.logisticasLocomocao || [])];
      blocks[index] = { ...blocks[index], ...patch };
      // Sincroniza status logístico pelo bloco 0 (para checklist operacional)
      const primary = blocks[0];
      const isAlugado = primary?.transportType === 'Carro Alugado';
      const isNA = primary?.transportType === 'N/A';
      return {
        ...prev,
        logisticasLocomocao: blocks,
        ...(index === 0
          ? {
              logisticsTransport:
                isAlugado || (!isNA && primary?.transportType != null)
                  ? 'CONFIRMADO'
                  : 'NAO_NECESSARIO',
            }
          : {}),
      };
    });
  };

  const handleBlockTransportClick = (index: number, t: TransportType) => {
    const isAlugado = t === 'Carro Alugado';
    const isOutros = t === 'Outros';
    const needsReceipt = t === 'Táxi' || t === 'Carro Aplicativo' || isOutros;
    const needsCheckInOut = isAlugado || isOutros;
    updateLocomocaoBlock(index, {
      transportType: t,
      ...(!isAlugado ? { rentalAgencyLocation: '', rentalLocator: '' } : {}),
      ...(!needsCheckInOut ? { rentalCheckIn: '', rentalCheckOut: '' } : {}),
      ...(!needsReceipt ? { receiptUrls: null } : {}),
      ...(!isOutros ? { otherTransportDescription: '' } : {}),
    });
  };

  const addLocomocaoBlock = () => {
    setForm(prev => ({
      ...prev,
      logisticasLocomocao: [...(prev.logisticasLocomocao || []), emptyLocomocaoBlock()],
    }));
  };

  const removeLocomocaoBlock = (index: number) => {
    setForm(prev => {
      const blocks = (prev.logisticasLocomocao || []).filter((_, i) => i !== index);
      return { ...prev, logisticasLocomocao: blocks };
    });
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const block = form.logisticasLocomocao?.[index];
    if (!block) return;
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `receipts/${block.id}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('evidences').upload(path, file, { upsert: true });
      if (error) throw error;
      updateLocomocaoBlock(index, { receiptUrls: [...(block.receiptUrls || []), path] });
      onNotify({ message: 'Nota fiscal anexada com sucesso.', type: 'success' });
    } catch (err) {
      console.error('Erro ao fazer upload da nota fiscal:', err);
      onNotify({ message: 'Erro ao fazer upload da nota fiscal.', type: 'error' });
    }
    e.target.value = '';
  };

  const handleRemoveReceipt = (index: number, urlToRemove: string) => {
    const block = form.logisticasLocomocao?.[index];
    if (!block) return;
    const remaining = (block.receiptUrls || []).filter(u => u !== urlToRemove);
    updateLocomocaoBlock(index, { receiptUrls: remaining.length ? remaining : null });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <button onClick={onToggle} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"><div className="flex items-center gap-3"><div className="p-2 bg-amber-50 rounded-lg text-amber-600"><Truck size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Logística — Locomoção</h3></div>{isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
      {isOpen && (
        <div className="px-6 py-6 border-t border-slate-100 bg-white space-y-6">
          {mode === 'FORM' ? (
            <>
              {(form.logisticasLocomocao || []).map((block, idx) => {
                const isMulti = (form.logisticasLocomocao?.length ?? 0) > 1;
                return (
                  <div key={block.id} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-amber-700 uppercase tracking-widest">
                        {isMulti ? `Bloco ${idx + 1}` : 'Locomoção'}
                      </span>
                      {(form.logisticasLocomocao?.length ?? 0) > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLocomocaoBlock(idx)}
                          className="text-xs text-red-400 hover:text-red-600 font-bold flex items-center gap-1 transition"
                        >
                          <Trash2 size={13} /> Remover
                        </button>
                      )}
                    </div>

                    {isMulti && (
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1"><User size={12} /> Nome do Instrutor</label>
                        <input
                          type="text"
                          className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                          placeholder="Ex.: João Silva"
                          value={block.instructorName || ''}
                          onChange={e => updateLocomocaoBlock(idx, { instructorName: e.target.value })}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Meio de Transporte</label>
                      <div className="flex flex-wrap gap-2">
                        {(['Carro Alugado', 'Carro Próprio', 'Táxi', 'Carro Aplicativo', 'Outros', 'N/A'] as TransportType[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleBlockTransportClick(idx, t)}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all min-w-[80px]
                              ${block.transportType === t
                                ? 'bg-amber-600 text-white border-amber-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-amber-400'
                              }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(block.transportType === 'Táxi' || block.transportType === 'Carro Aplicativo' || block.transportType === 'Outros') && (
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                          <Paperclip size={12} /> Nota Fiscal
                        </label>
                        <div className="space-y-1">
                          {(block.receiptUrls || []).map((url, urlIdx) => (
                            <div key={urlIdx} className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                              <Paperclip size={14} className="text-amber-600 flex-shrink-0" />
                              <span className="text-sm text-slate-700 truncate flex-1">
                                {url.split('/').pop()?.replace(/^\d+_/, '') || `nota fiscal ${urlIdx + 1}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveReceipt(idx, url)}
                                className="text-xs text-red-400 hover:text-red-600 font-bold flex items-center gap-1 transition flex-shrink-0"
                              >
                                <X size={12} /> Remover
                              </button>
                            </div>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer p-2 mt-1 border border-dashed border-amber-300 hover:border-amber-500 rounded-lg transition">
                          <Upload size={14} className="text-amber-600" />
                          <span className="text-sm text-slate-500">
                            {(block.receiptUrls?.length ?? 0) > 0 ? 'Adicionar outra nota fiscal' : 'Clique para anexar nota fiscal'}
                          </span>
                          <input
                            type="file"
                            accept="*/*"
                            onChange={(e) => handleReceiptUpload(e, idx)}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}

                    {block.transportType === 'Outros' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                        <div className="md:col-span-1">
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Meio de Transporte</label>
                          <input type="text" className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none" value={block.otherTransportDescription || ''} onChange={(e) => updateLocomocaoBlock(idx, { otherTransportDescription: e.target.value })} placeholder="Ex: Van fretada, Barco, Ônibus intermunicipal" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-in</label>
                          <input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={block.rentalCheckIn || ''} onChange={e => updateLocomocaoBlock(idx, { rentalCheckIn: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-out</label>
                          <input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={block.rentalCheckOut || ''} onChange={e => updateLocomocaoBlock(idx, { rentalCheckOut: e.target.value })} />
                        </div>
                      </div>
                    )}

                    {block.transportType === 'Carro Alugado' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-amber-50/60 rounded-xl border border-amber-100">
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-2">Empresa de Locação</label>
                          <select className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={block.rentalCompany || 'Localiza'} onChange={(e) => updateLocomocaoBlock(idx, { rentalCompany: e.target.value as RentalCompany })}>
                            {operationalBases.locadoras.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Local da Agência</label>
                          <input list="agencias-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={block.rentalAgencyLocation || ''} onChange={(e) => updateLocomocaoBlock(idx, { rentalAgencyLocation: e.target.value })} placeholder="Onde retira o carro?" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1 flex items-center gap-1"><Tag size={12} /> Localizador</label>
                          <input type="text" className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none" value={block.rentalLocator || ''} onChange={(e) => updateLocomocaoBlock(idx, { rentalLocator: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Categoria</label>
                          <select className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={block.carCategory || 'Grupo CE'} onChange={(e) => updateLocomocaoBlock(idx, { carCategory: e.target.value })}>
                            {(operationalBases.categoriasCarros ?? []).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-in</label>
                          <input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={block.rentalCheckIn || ''} onChange={e => updateLocomocaoBlock(idx, { rentalCheckIn: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-out</label>
                          <input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={block.rentalCheckOut || ''} onChange={e => updateLocomocaoBlock(idx, { rentalCheckOut: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addLocomocaoBlock}
                className="flex items-center gap-2 text-xs font-bold text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 hover:border-amber-500 rounded-lg px-4 py-2 transition"
              >
                <Plus size={14} /> Adicionar Locomoção
              </button>
            </>
          ) : (
            <div className="space-y-6">
              {(form.logisticasLocomocao || []).map((block, idx) => {
                const isMulti = (form.logisticasLocomocao?.length ?? 0) > 1;
                return (
                  <div key={block.id} className="space-y-4">
                    {isMulti && (
                      <p className="text-xs font-black text-amber-700 uppercase tracking-widest">
                        {block.instructorName ? `Locomoção — ${block.instructorName}` : `Locomoção — Bloco ${idx + 1}`}
                      </p>
                    )}
                    <DataViewField label="Meio de Transporte" value={block.transportType === 'Outros' ? `Outros${block.otherTransportDescription ? ` — ${block.otherTransportDescription}` : ''}` : (block.transportType || (form.logisticsTransport === 'NAO_NECESSARIO' ? 'N/A' : 'Pendente'))} icon={Truck} />
                    {(block.transportType === 'Táxi' || block.transportType === 'Carro Aplicativo' || block.transportType === 'Outros') && (block.receiptUrls?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                          <Paperclip size={12} /> Nota Fiscal
                        </p>
                        <div className="space-y-1">
                          {(block.receiptUrls || []).map((url, urlIdx) => (
                            <button
                              key={urlIdx}
                              type="button"
                              onClick={async () => {
                                const { data } = await supabase.storage.from('evidences').createSignedUrl(url, 3600);
                                if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                              }}
                              className="flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-900 font-medium transition"
                            >
                              <Paperclip size={14} /> {url.split('/').pop()?.replace(/^\d+_/, '') || `Nota fiscal ${urlIdx + 1}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {block.transportType === 'Carro Alugado' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <DataViewField label="Locadora" value={block.rentalCompany} icon={Building2} />
                        <DataViewField label="Local da Agência" value={block.rentalAgencyLocation} icon={MapPin} />
                        <DataViewField label="Localizador" value={block.rentalLocator} icon={Tag} />
                        <DataViewField label="Categoria" value={block.carCategory} icon={Tag} />
                        <DataViewField label="Check-in" value={block.rentalCheckIn ? formatDateTime(block.rentalCheckIn) : '---'} icon={Clock} />
                        <DataViewField label="Check-out" value={block.rentalCheckOut ? formatDateTime(block.rentalCheckOut) : '---'} icon={Clock} />
                      </div>
                    )}
                    {block.transportType === 'Outros' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <DataViewField label="Check-in" value={block.rentalCheckIn ? formatDateTime(block.rentalCheckIn) : '---'} icon={Clock} />
                        <DataViewField label="Check-out" value={block.rentalCheckOut ? formatDateTime(block.rentalCheckOut) : '---'} icon={Clock} />
                      </div>
                    )}
                    {isMulti && idx < (form.logisticasLocomocao?.length ?? 1) - 1 && (
                      <hr className="border-slate-100" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LogisticaLocomocaoSection;
