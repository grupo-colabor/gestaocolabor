import React from 'react';
import {
  Home,
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
  Calendar,
} from 'lucide-react';

import type {
  AccommodationType,
  LogisticaHospedagem,
  PaymentMethod,
} from '../../types';
import { PAYMENT_METHODS } from '../../constants';
import { supabase } from '../../lib/supabase';
import DataViewField from './DataViewField';
import { formatDateOnlySafe } from './formatters';
import type { DemandFormMode, DemandFormSetter, DemandFormState, NotifyFn } from './types';

/**
 * Seção "Logística — Hospedagem" do formulário de demanda.
 *
 * Extraída de `Demands.tsx` sem alteração de marcação nem de regra, junto com
 * os handlers multi-bloco (a sincronização de `logisticsHotel` pelo bloco 0 é
 * parte da seção, não do formulário que a hospeda).
 *
 * ⚠️ Os `<datalist>` `cidades-list` e `hoteis-list` continuam sendo
 * responsabilidade de quem renderiza a seção.
 */

/** UUID v4 sem crypto.randomUUID() — a coluna id de logistic_blocks é uuid. */
const generateId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Bloco vazio — mesmos defaults do `addHospedagemBlock` original. */
export const emptyHospedagemBlock = (): LogisticaHospedagem => ({
  id: generateId(),
  accommodationType: null,
  hotelPayment: null,
});

interface LogisticaHospedagemSectionProps {
  form: DemandFormState;
  setForm: DemandFormSetter;
  mode: DemandFormMode;
  isOpen: boolean;
  onToggle: () => void;
  onNotify: NotifyFn;
}

const LogisticaHospedagemSection: React.FC<LogisticaHospedagemSectionProps> = ({
  form,
  setForm,
  mode,
  isOpen,
  onToggle,
  onNotify,
}) => {
  // ─── Handlers multi-bloco: Hospedagem ────────────────────────────────────

  const updateHospedagemBlock = (index: number, patch: Partial<LogisticaHospedagem>) => {
    setForm(prev => {
      const blocks = [...(prev.logisticasHospedagem || [])];
      blocks[index] = { ...blocks[index], ...patch };
      const primary = blocks[0];
      const isHotel = primary?.accommodationType === 'Hotel';
      const isNA = primary?.accommodationType === 'N/A';
      return {
        ...prev,
        logisticasHospedagem: blocks,
        ...(index === 0
          ? {
              logisticsHotel: isHotel
                ? 'CONFIRMADO'
                : isNA
                ? 'NAO_NECESSARIO'
                : prev.logisticsHotel,
            }
          : {}),
      };
    });
  };

  const handleBlockAccommodationClick = (index: number, type: AccommodationType) => {
    if (type === 'N/A') {
      updateHospedagemBlock(index, {
        accommodationType: 'N/A',
        hotelCity: '',
        hotelName: '',
        hotelCheckIn: '',
        hotelCheckOut: '',
        hotelPayment: null,
        hotelReceiptUrls: null,
      });
    } else {
      updateHospedagemBlock(index, { accommodationType: 'Hotel' });
    }
  };

  const addHospedagemBlock = () => {
    setForm(prev => ({
      ...prev,
      logisticasHospedagem: [...(prev.logisticasHospedagem || []), emptyHospedagemBlock()],
    }));
  };

  const removeHospedagemBlock = (index: number) => {
    setForm(prev => {
      const blocks = (prev.logisticasHospedagem || []).filter((_, i) => i !== index);
      return { ...prev, logisticasHospedagem: blocks };
    });
  };

  const handleHotelReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const block = form.logisticasHospedagem?.[index];
    if (!block) return;
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `hotel-receipts/${block.id}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('evidences').upload(path, file, { upsert: true });
      if (error) throw error;
      updateHospedagemBlock(index, { hotelReceiptUrls: [...(block.hotelReceiptUrls || []), path] });
      onNotify({ message: 'Nota fiscal do hotel anexada com sucesso.', type: 'success' });
    } catch (err) {
      console.error('Erro ao fazer upload da nota fiscal do hotel:', err);
      onNotify({ message: 'Erro ao fazer upload da nota fiscal do hotel.', type: 'error' });
    }
    e.target.value = '';
  };

  const handleRemoveHotelReceipt = (index: number, urlToRemove: string) => {
    const block = form.logisticasHospedagem?.[index];
    if (!block) return;
    const remaining = (block.hotelReceiptUrls || []).filter(u => u !== urlToRemove);
    updateHospedagemBlock(index, { hotelReceiptUrls: remaining.length ? remaining : null });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg text-green-600">
            <Home size={20} />
          </div>
          <h3 className="font-bold text-slate-800 uppercase text-sm">Logística — Hospedagem</h3>
        </div>
        {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>

      {isOpen && (
        <div className="px-6 py-6 border-t border-slate-100 bg-white space-y-6">
          {mode === 'FORM' ? (
            <>
              {(form.logisticasHospedagem || []).map((block, idx) => {
                const isMulti = (form.logisticasHospedagem?.length ?? 0) > 1;
                return (
                  <div key={block.id} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-green-700 uppercase tracking-widest">
                        {isMulti ? `Bloco ${idx + 1}` : 'Hospedagem'}
                      </span>
                      {(form.logisticasHospedagem?.length ?? 0) > 1 && (
                        <button
                          type="button"
                          onClick={() => removeHospedagemBlock(idx)}
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
                          className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-400"
                          placeholder="Ex.: Maria Souza"
                          value={block.instructorName || ''}
                          onChange={e => updateHospedagemBlock(idx, { instructorName: e.target.value })}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Hospedagem</label>
                      <div className="flex gap-2">
                        {(['Hotel', 'N/A'] as AccommodationType[]).map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => handleBlockAccommodationClick(idx, type)}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all
                              ${block.accommodationType === type
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-green-400'
                              }`}
                          >
                            {type === 'N/A' ? 'N/A' : 'Precisa de Hotel'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {block.accommodationType === 'Hotel' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-green-50/60 rounded-xl border border-green-100">
                          <div>
                            <label className="block text-xs font-bold text-green-800 uppercase mb-1">Cidade / Estado</label>
                            <input
                              list="cidades-list"
                              className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={block.hotelCity || ''}
                              onChange={(e) => updateHospedagemBlock(idx, { hotelCity: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-green-800 uppercase mb-1">Hotel</label>
                            <input
                              list="hoteis-list"
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              value={block.hotelName || ''}
                              onChange={(e) => updateHospedagemBlock(idx, { hotelName: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-in</label>
                            <input
                              type="date"
                              className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                              value={block.hotelCheckIn || ''}
                              onChange={(e) => updateHospedagemBlock(idx, { hotelCheckIn: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-out</label>
                            <input
                              type="date"
                              className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                              value={block.hotelCheckOut || ''}
                              onChange={(e) => updateHospedagemBlock(idx, { hotelCheckOut: e.target.value })}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-green-800 uppercase mb-1">Pagamento</label>
                            <select
                              className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              value={block.hotelPayment || 'Faturado'}
                              onChange={(e) => updateHospedagemBlock(idx, { hotelPayment: e.target.value as PaymentMethod })}
                            >
                              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-1">
                            <Paperclip size={12} /> Nota Fiscal do Hotel
                          </label>
                          <div className="space-y-1">
                            {(block.hotelReceiptUrls || []).map((url, urlIdx) => (
                              <div key={urlIdx} className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                                <Paperclip size={14} className="text-green-600 flex-shrink-0" />
                                <span className="text-sm text-slate-700 truncate flex-1">
                                  {url.split('/').pop()?.replace(/^\d+_/, '') || `nota fiscal ${urlIdx + 1}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveHotelReceipt(idx, url)}
                                  className="text-xs text-red-400 hover:text-red-600 font-bold flex items-center gap-1 transition flex-shrink-0"
                                >
                                  <X size={12} /> Remover
                                </button>
                              </div>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer p-2 mt-1 border border-dashed border-green-300 hover:border-green-500 rounded-lg transition">
                            <Upload size={14} className="text-green-600" />
                            <span className="text-sm text-slate-500">
                              {(block.hotelReceiptUrls?.length ?? 0) > 0 ? 'Adicionar outra nota fiscal' : 'Clique para anexar nota fiscal do hotel'}
                            </span>
                            <input
                              type="file"
                              accept="*/*"
                              onChange={(e) => handleHotelReceiptUpload(e, idx)}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addHospedagemBlock}
                className="flex items-center gap-2 text-xs font-bold text-green-700 hover:text-green-900 border border-dashed border-green-300 hover:border-green-500 rounded-lg px-4 py-2 transition"
              >
                <Plus size={14} /> Adicionar Hospedagem
              </button>
            </>
          ) : (
            <div className="space-y-6">
              {(form.logisticasHospedagem || []).map((block, idx) => {
                const isMulti = (form.logisticasHospedagem?.length ?? 0) > 1;
                return (
                  <div key={block.id} className="space-y-4">
                    {isMulti && (
                      <p className="text-xs font-black text-green-700 uppercase tracking-widest">
                        {block.instructorName ? `Hospedagem — ${block.instructorName}` : `Hospedagem — Bloco ${idx + 1}`}
                      </p>
                    )}
                    <DataViewField
                      label="Hospedagem"
                      value={
                        block.accommodationType === 'Hotel'
                          ? 'Hotel Requerido'
                          : block.accommodationType === 'N/A'
                          ? 'N/A'
                          : form.logisticsHotel === 'NAO_NECESSARIO'
                          ? 'N/A'
                          : 'Pendente'
                      }
                      icon={Home}
                    />
                    {block.accommodationType === 'Hotel' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-green-50 rounded-xl border border-green-100">
                          <DataViewField label="Cidade / Estado" value={block.hotelCity} icon={MapPin} />
                          <DataViewField label="Hotel" value={block.hotelName} icon={Building2} />
                          <DataViewField label="Check-in" value={block.hotelCheckIn ? formatDateOnlySafe(block.hotelCheckIn) : '---'} icon={Calendar} />
                          <DataViewField label="Check-out" value={block.hotelCheckOut ? formatDateOnlySafe(block.hotelCheckOut) : '---'} icon={Calendar} />
                          <DataViewField label="Pagamento" value={block.hotelPayment} icon={Tag} />
                        </div>
                        {(block.hotelReceiptUrls?.length ?? 0) > 0 && (
                          <div>
                            <p className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                              <Paperclip size={12} /> Nota Fiscal do Hotel
                            </p>
                            <div className="space-y-1">
                              {(block.hotelReceiptUrls || []).map((url, urlIdx) => (
                                <button
                                  key={urlIdx}
                                  type="button"
                                  onClick={async () => {
                                    const { data } = await supabase.storage.from('evidences').createSignedUrl(url, 3600);
                                    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                  }}
                                  className="flex items-center gap-1.5 text-sm text-green-700 hover:text-green-900 font-medium transition"
                                >
                                  <Paperclip size={14} /> {url.split('/').pop()?.replace(/^\d+_/, '') || `Nota fiscal ${urlIdx + 1}`}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {isMulti && idx < (form.logisticasHospedagem?.length ?? 1) - 1 && (
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

export default LogisticaHospedagemSection;
