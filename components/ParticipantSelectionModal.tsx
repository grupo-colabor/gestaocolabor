import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, AlertCircle, Search, Check, CalendarRange } from 'lucide-react';

import type { Instructor } from '../types';

/**
 * MODAL DE SELEÇÃO DE PARTICIPANTE — demanda interna
 *
 * Escolhe UM instrutor do cadastro e, opcionalmente, um período próprio dentro
 * da demanda. Puramente de apresentação, no mesmo espírito do
 * `ResourceAllocationModal`: quem grava é o `InternalDemands.tsx`, quem valida
 * de verdade é o banco (migration 016).
 *
 * ---------------------------------------------------------------------------
 * Conflito AVISA, não bloqueia
 * ---------------------------------------------------------------------------
 * Mesma postura do `AllocationDrawer` (que marca o instrutor em conflito mas
 * deixa alocar): quem monta a equipe às vezes sabe de um remanejamento que o
 * sistema ainda não viu. O aviso existe para a decisão ser consciente, não
 * para ser impedida.
 *
 * ---------------------------------------------------------------------------
 * As três validações do período
 * ---------------------------------------------------------------------------
 * 1. TUDO-OU-NADA — os dois vazios (= período inteiro da demanda) ou os dois
 *    preenchidos. É o CHECK `demand_participants_periodo_check`; validar aqui
 *    é o que troca "violates check constraint" por uma frase em português.
 * 2. INÍCIO <= FIM — mesmo CHECK.
 * 3. DENTRO DO PERÍODO DA DEMANDA — esta NÃO é regra de banco, e é a mais
 *    traiçoeira: um período fora da demanda passa no insert e produz um
 *    participante que não aparece em dia nenhum da agenda (a interseção com os
 *    dias reais da demanda dá vazio). Falha silenciosa, então bloqueia aqui.
 */

export interface ParticipantSelectionModalProps {
  open: boolean;
  /** Instrutores já filtrados pelo chamador (ATIVOS, sem os já participantes). */
  instructors: Instructor[];
  /** Limites da demanda, 'YYYY-MM-DD'. */
  demandStartDate: string;
  demandEndDate: string;
  /** `true` se o instrutor já está comprometido no período da demanda. */
  hasConflict: (instructorId: string) => boolean;
  onCancel: () => void;
  onConfirm: (payload: { instructorId: string; startDate: string | null; endDate: string | null }) => void;
}

const ParticipantSelectionModal: React.FC<ParticipantSelectionModalProps> = ({
  open,
  instructors,
  demandStartDate,
  demandEndDate,
  hasConflict,
  onCancel,
  onConfirm,
}) => {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = [...instructors].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!q) return base;
    return base.filter(i => i.name.toLowerCase().includes(q));
  }, [instructors, search]);

  if (!open) return null;

  const reset = () => {
    setSearch('');
    setSelectedId(null);
    setStart('');
    setEnd('');
    setError(null);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleConfirm = () => {
    if (!selectedId) {
      setError('Selecione um instrutor.');
      return;
    }

    const s = start.trim();
    const e = end.trim();

    // (1) tudo-ou-nada
    if (!!s !== !!e) {
      setError('Preencha início e fim juntos, ou deixe os dois vazios para o participante cobrir todo o período da demanda.');
      return;
    }

    if (s && e) {
      // (2) ordem
      if (s > e) {
        setError('A data de início do participante não pode ser maior que a de fim.');
        return;
      }
      // (3) dentro da demanda
      const dStart = (demandStartDate || '').slice(0, 10);
      const dEnd = (demandEndDate || '').slice(0, 10);
      if (dStart && dEnd && (s < dStart || e > dEnd)) {
        setError(`O período do participante precisa estar dentro do período da demanda (${brDate(dStart)} a ${brDate(dEnd)}).`);
        return;
      }
    }

    onConfirm({ instructorId: selectedId, startDate: s || null, endDate: e || null });
    reset();
  };

  return createPortal(
    <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-scale-up flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-black text-blue-700 uppercase tracking-tight">Adicionar Participante</h3>
          <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold text-red-700 leading-tight">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Instrutor</label>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome..."
                className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-slate-400 italic p-4">
                  {instructors.length === 0
                    ? 'Nenhum instrutor disponível — todos já são participantes ou o instrutor principal.'
                    : 'Nenhum instrutor com esse nome.'}
                </p>
              ) : (
                filtered.map(i => {
                  const isSelected = selectedId === i.id;
                  const conflict = hasConflict(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => { setSelectedId(i.id); setError(null); }}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                      }`}>
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className="text-sm font-bold text-slate-700 flex-1 truncate">{i.name}</span>
                      {conflict && (
                        <span
                          className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest shrink-0"
                          title="Este instrutor já tem compromisso em algum dia do período da demanda. O aviso não impede a inclusão."
                        >
                          <AlertCircle size={9} strokeWidth={2.5} /> Conflito
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <CalendarRange size={12} /> Período do participante (opcional)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={start}
                min={(demandStartDate || '').slice(0, 10) || undefined}
                max={(demandEndDate || '').slice(0, 10) || undefined}
                onChange={e => { setStart(e.target.value); setError(null); }}
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[10px] font-black text-slate-400 uppercase">até</span>
              <input
                type="date"
                value={end}
                min={(demandStartDate || '').slice(0, 10) || undefined}
                max={(demandEndDate || '').slice(0, 10) || undefined}
                onChange={e => { setEnd(e.target.value); setError(null); }}
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
              Deixe os dois vazios para o participante cobrir <strong>todo o período da demanda</strong>
              {demandStartDate && demandEndDate
                ? ` (${brDate((demandStartDate || '').slice(0, 10))} a ${brDate((demandEndDate || '').slice(0, 10))})`
                : ''}.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-wider text-slate-500 hover:bg-slate-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className={`px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-wider transition flex items-center gap-2 ${
              selectedId
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Users size={14} /> Adicionar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY', por fatia — nada de new Date() aqui. */
function brDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default ParticipantSelectionModal;
