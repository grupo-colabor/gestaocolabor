import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Search, AlertTriangle, CalendarRange, CheckSquare, Square } from 'lucide-react';

import type { Demand, Instructor } from '../types';
import { getDemandDays, getDayHorarioInicio, getDayHorarioFim } from '../domain/demandDays';
import { groupInstructorsForCompanion } from '../domain/instructorRecommendation';
import { requiresLogistics } from '../domain/modalityRules';
import InstructorCard from './InstructorCard';

/**
 * SELEÇÃO DE ACOMPANHANTE — instrutor + dias, num lugar só
 *
 * Substitui duas telas que faziam a mesma coisa de jeitos diferentes: a lista
 * plana "nome + SELECIONAR" da tela de Logística e o seletor de um-dia-por-vez
 * do AllocationDrawer. As duas passam a consumir este componente.
 *
 * ---------------------------------------------------------------------------
 * O que mudou, e por quê
 * ---------------------------------------------------------------------------
 * • A LINHA é o `InstructorCard` da lista principal de alocação — o mesmo
 *   componente, não uma cópia. Avatar, score, região e o aviso de conflito
 *   aparecem aqui exatamente como aparecem lá.
 *
 * • A ORDEM é a mesma classificação da lista principal
 *   (domain/instructorRecommendation.ts), em três grupos: qualificados para
 *   este treinamento → exceção (fora do estado da demanda) → demais ativos.
 *   O terceiro grupo é exclusivo daqui: a lista principal descarta quem não
 *   tem a habilitação, mas acompanhante NÃO ministra — esconder os
 *   não-qualificados esconderia justamente quem mais costuma acompanhar.
 *
 * • Os DIAS são caixas de seleção sobre `getDemandDays`, com "todos" e um
 *   intervalo de/até. O acompanhante só existe em dias da demanda, então não
 *   há caminho para escolher um dia de fora — o que antes era possível
 *   digitando uma data no campo livre.
 *
 * ---------------------------------------------------------------------------
 * O conflito é dos DIAS SELECIONADOS, não do período todo
 * ---------------------------------------------------------------------------
 * É a diferença que torna o aviso útil: quem tem compromisso só no dia 3 não
 * deve aparecer em vermelho quando o usuário escolheu o dia 1. Por isso o
 * cálculo roda por dia e o card recebe o resultado pronto (`conflictOverride`).
 *
 * Como sempre nesta tela: AVISA, não bloqueia. Com conflito, o botão vira
 * "Alocar mesmo assim".
 */

export interface CompanionPickerProps {
  open: boolean;
  demand: Demand;
  instructors: Instructor[];
  /** Quem já é acompanhante desta demanda — sai da lista. */
  alreadyCompanionIds?: string[];
  /** `hasScheduleConflict` do App: já inclui participante e acompanhante. */
  hasScheduleConflict: (id: string, s: string, e: string, ex?: string) => boolean;
  /**
   * Detalhe do conflito para o tooltip (qual demanda). Recebe só o instrutor —
   * quem chama já fecha sobre a demanda, que é a assinatura que o
   * `AllocationDrawer` já tinha.
   */
  getConflictDetails?: (instructorId: string) => string[];
  onCancel: () => void;
  /** Dias em 'YYYY-MM-DD', sempre não-vazio. */
  onConfirm: (instructorId: string, dias: string[]) => void;
}

const CompanionPicker: React.FC<CompanionPickerProps> = ({
  open,
  demand,
  instructors,
  alreadyCompanionIds = [],
  hasScheduleConflict,
  getConflictDetails,
  onCancel,
  onConfirm,
}) => {
  const [search, setSearch] = useState('');
  const [diasSelecionados, setDiasSelecionados] = useState<string[]>([]);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  /** Os dias reais da demanda — cobre CONTINUO e DIAS_ESPECIFICOS. */
  const diasDaDemanda = useMemo(() => (demand ? getDemandDays(demand) : []), [demand]);

  /**
   * Conflito por pessoa, sobre os DIAS ESCOLHIDOS. Sem nenhum dia marcado,
   * a pergunta é sobre o período inteiro — que é o que faz sentido antes de o
   * usuário decidir os dias.
   */
  const conflitoDe = useMemo(() => {
    const alvo = diasSelecionados.length > 0 ? diasSelecionados : diasDaDemanda;
    const cache = new Map<string, { conflito: boolean; detalhe: string }>();
    return (instructorId: string) => {
      const emCache = cache.get(instructorId);
      if (emCache) return emCache;

      let conflito = false;
      const detalhes: string[] = [];
      for (const dia of alvo) {
        if (hasScheduleConflict(instructorId, dia, dia, demand.id)) {
          conflito = true;
          if (getConflictDetails && detalhes.length === 0) {
            for (const d of getConflictDetails(instructorId) ?? []) {
              if (!detalhes.includes(d)) detalhes.push(d);
            }
          }
        }
      }
      const r = {
        conflito,
        detalhe: detalhes.length ? `Conflito: ${detalhes.join(' | ')}` : 'Já alocado em algum dos dias escolhidos',
      };
      cache.set(instructorId, r);
      return r;
    };
  }, [diasSelecionados, diasDaDemanda, hasScheduleConflict, getConflictDetails, demand]);

  const grupos = useMemo(
    () =>
      groupInstructorsForCompanion({
        instructors: instructors as any,
        demand: demand as any,
        hasConflict: id => conflitoDe(id).conflito,
        requiresLogistics,
        excludeInstructorIds: alreadyCompanionIds,
        search,
      }),
    [instructors, demand, conflitoDe, alreadyCompanionIds, search]
  );

  if (!open || !demand) return null;

  const reset = () => {
    setSearch('');
    setDiasSelecionados([]);
    setDe('');
    setAte('');
    setErro(null);
  };

  const fechar = () => { reset(); onCancel(); };

  const alternarDia = (dia: string) => {
    setErro(null);
    setDiasSelecionados(prev => (prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia].sort()));
  };

  /** O intervalo MARCA os dias da demanda que caem nele — não cria dias novos. */
  const aplicarIntervalo = () => {
    if (!de || !ate) { setErro('Preencha as duas datas do intervalo.'); return; }
    if (de > ate) { setErro('A data inicial do intervalo não pode ser maior que a final.'); return; }
    const noIntervalo = diasDaDemanda.filter(d => d >= de && d <= ate);
    if (noIntervalo.length === 0) {
      setErro('Nenhum dia da demanda cai nesse intervalo.');
      return;
    }
    setErro(null);
    setDiasSelecionados(prev => [...new Set([...prev, ...noIntervalo])].sort());
  };

  const confirmar = (instructorId: string) => {
    if (diasSelecionados.length === 0) {
      setErro('Escolha ao menos um dia.');
      return;
    }
    onConfirm(instructorId, [...diasSelecionados].sort());
    reset();
  };

  const brDate = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y, m, d] = iso.split('-');
    return `${d}/${m}`;
  };

  const grupo = (
    titulo: string,
    lista: typeof grupos.qualificados,
    cor: string,
    nota?: string
  ) =>
    lista.length === 0 ? null : (
      <div key={titulo}>
        <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1 ${cor}`}>
          {titulo} ({lista.length})
          {nota && <span className="text-slate-400 font-bold normal-case tracking-normal">— {nota}</span>}
        </p>
        {lista.map(({ instructor, score, hasConflict }) => (
          <InstructorCard
            key={instructor.id}
            variant="picker"
            actionLabel="Selecionar"
            instructor={{ ...(instructor as Instructor), score }}
            isException={titulo.startsWith('EXCEÇÃO')}
            selectedDemand={demand}
            companionMode={false}
            previewItems={[]}
            conflictOverride={hasConflict}
            conflictTitle={conflitoDe(instructor.id).detalhe}
            hasScheduleConflict={hasScheduleConflict}
            onPreview={() => {}}
            onCompanionDays={() => {}}
            onAllocate={() => confirmar(instructor.id)}
          />
        ))}
      </div>
    );

  const nenhum =
    grupos.qualificados.length === 0 && grupos.excecoes.length === 0 && grupos.demais.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <p className="text-sm font-black text-slate-800 uppercase">Selecionar acompanhante</p>
            <p className="text-[11px] font-semibold text-slate-500">
              Escolha os dias e depois o instrutor — {demand.id}
            </p>
          </div>
          <button
            type="button"
            onClick={fechar}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {erro && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold text-red-700 leading-tight">{erro}</p>
            </div>
          )}

          {/* ── DIAS ────────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                <CalendarRange size={12} /> Dias do acompanhante
                <span className="text-slate-400 font-bold normal-case tracking-normal">
                  ({diasSelecionados.length} de {diasDaDemanda.length})
                </span>
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { setDiasSelecionados([...diasDaDemanda]); setErro(null); }}
                  className="px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                >
                  Todos os dias
                </button>
                <button
                  type="button"
                  onClick={() => { setDiasSelecionados([]); setErro(null); }}
                  className="px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {diasDaDemanda.map(dia => {
                const marcado = diasSelecionados.includes(dia);
                return (
                  <button
                    key={dia}
                    type="button"
                    onClick={() => alternarDia(dia)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold transition ${
                      marcado
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                    title={`${getDayHorarioInicio(demand, dia)} às ${getDayHorarioFim(demand, dia)}`}
                  >
                    {marcado ? <CheckSquare size={11} /> : <Square size={11} />}
                    {brDate(dia)}
                  </button>
                );
              })}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">De</label>
                <input
                  type="date"
                  value={de}
                  min={diasDaDemanda[0]}
                  max={diasDaDemanda[diasDaDemanda.length - 1]}
                  onChange={e => { setDe(e.target.value); setErro(null); }}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Até</label>
                <input
                  type="date"
                  value={ate}
                  min={diasDaDemanda[0]}
                  max={diasDaDemanda[diasDaDemanda.length - 1]}
                  onChange={e => { setAte(e.target.value); setErro(null); }}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={aplicarIntervalo}
                className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border border-slate-200 hover:bg-slate-50"
              >
                Marcar intervalo
              </button>
            </div>
            <p className="text-[9px] text-slate-400 leading-snug">
              O intervalo marca apenas os dias que pertencem à demanda. Acompanhante
              só existe em dia de demanda.
            </p>
          </div>

          {/* ── INSTRUTORES ─────────────────────────────────────────────── */}
          <div>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar instrutor por nome..."
                className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-3">
              {grupo('QUALIFICADOS', grupos.qualificados, 'text-blue-600')}
              {grupo('EXCEÇÃO', grupos.excecoes, 'text-amber-600', 'fora do estado da demanda')}
              {grupo('DEMAIS ATIVOS', grupos.demais, 'text-slate-500', 'sem habilitação neste treinamento')}

              {nenhum && (
                <p className="text-xs text-slate-400 italic py-6 text-center">
                  {search
                    ? 'Nenhum instrutor com esse nome.'
                    : 'Nenhum instrutor disponível — todos já acompanham esta demanda.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
            <Users size={12} />
            {diasSelecionados.length === 0
              ? 'Escolha ao menos um dia para liberar a seleção'
              : `${diasSelecionados.length} dia(s) selecionado(s)`}
          </p>
          <button
            onClick={fechar}
            className="px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-wider text-slate-500 hover:bg-slate-200 transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CompanionPicker;
