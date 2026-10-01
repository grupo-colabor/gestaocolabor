import React from 'react';
import { AlertTriangle, Calendar, Plus, Trash2, Users } from 'lucide-react';

import type { CompanionBlockMode, CompanionPersonSummary } from '../../domain/companionRows';

/**
 * BLOCO "ACOMPANHANTES" DA VISUALIZAÇÃO DA DEMANDA (cliente)
 *
 * Terceiro card da seção de alocações, irmão de "Instrutores" e "Centro Móvel".
 * Existe porque acompanhante só entrava pela Orquestração Logística — que só
 * lista demanda SEM instrutor. Depois de alocada, a operação removia o titular,
 * punha o acompanhante e realocava. Aqui o "+ Adicionar" funciona com a demanda
 * já alocada.
 *
 * Puramente apresentacional: sem estado e sem escrita. Quem decide se o bloco
 * aparece e se escreve é `companionBlockMode` (domain/companionRows.ts), e quem
 * grava é a tela, pelo mesmo caminho da Logística. O seletor é o
 * `CompanionPicker` de sempre — este card só o abre.
 *
 * UMA LINHA POR PESSOA, não por dia: `companion_allocations` guarda um dia por
 * linha, e listar as linhas mostraria o mesmo nome três vezes. A lixeira remove
 * a pessoa (todas as linhas dela).
 *
 * Ocupa a linha inteira do grid, como o card de Participantes da interna: a
 * lista cresce com a equipe, ao contrário dos dois de cima.
 */
export interface AcompanhantesBlockProps {
  mode: CompanionBlockMode;
  /** Uma entrada por pessoa — `summarizeCompanions`. */
  entries: CompanionPersonSummary[];
  getInstructorName: (id?: string) => string;
  onAdd: () => void;
  onRemove: (entry: CompanionPersonSummary) => void;
}

/** 'YYYY-MM-DD' -> 'DD/MM'. */
const diaCurto = (iso: string) => {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
};

const AcompanhantesBlock: React.FC<AcompanhantesBlockProps> = ({
  mode,
  entries,
  getInstructorName,
  onAdd,
  onRemove,
}) => {
  if (mode === 'OCULTO') return null;
  const podeEscrever = mode === 'EDICAO';

  return (
    <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="w-full px-6 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><Users size={20} /></div>
          <div>
            <h3 className="font-bold text-slate-800 uppercase text-sm">Acompanhantes</h3>
            <p className="text-[10px] font-medium text-slate-400">
              Instrutores que acompanham a demanda, sem ministrar
            </p>
          </div>
        </div>
        {podeEscrever && (
          <button
            onClick={onAdd}
            className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1.5 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={14} /> Adicionar
          </button>
        )}
      </div>

      <div className="px-6 py-4 border-t border-slate-100 bg-white">
        {entries.length > 0 ? (
          <div className="space-y-3">
            {entries.map(entry => {
              const nome = getInstructorName(entry.instructorId);
              const foraDoPeriodo = entry.cobertura !== 'DENTRO';
              return (
                <div
                  key={entry.instructorId}
                  className={`flex items-center justify-between gap-4 p-3 rounded-xl border group ${
                    foraDoPeriodo
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-emerald-50/50 border-emerald-100'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs uppercase shrink-0">
                      {nome.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{nome}</p>
                      <p
                        className={`text-[10px] font-medium flex items-center gap-2 ${foraDoPeriodo ? 'text-amber-700' : 'text-slate-500'}`}
                        title={entry.diasDentro.map(diaCurto).join(', ')}
                      >
                        <Calendar size={10} className="shrink-0" />
                        <span className="truncate">
                          {entry.rotuloDias}
                          {!entry.periodoTodo && entry.diasDentro.length > 0 && (
                            <> · {entry.diasDentro.map(diaCurto).join(', ')}</>
                          )}
                        </span>
                      </p>
                      {foraDoPeriodo && (
                        <p
                          className="mt-1 text-[10px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1.5"
                          title={`Dias gravados que a demanda não tem mais: ${entry.diasFora.map(diaCurto).join(', ')}. Eles não aparecem na agenda nem contam na medição — remova e adicione de novo nos dias da demanda.`}
                        >
                          <AlertTriangle size={11} className="shrink-0" />
                          {entry.cobertura === 'FORA'
                            ? 'Fora do período da demanda'
                            : 'Parcialmente fora do período da demanda'}
                        </p>
                      )}
                    </div>
                  </div>
                  {podeEscrever && (
                    <button
                      onClick={() => onRemove(entry)}
                      className={`p-2 text-slate-300 hover:text-red-500 transition-colors shrink-0 ${
                        foraDoPeriodo ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      title="Remover acompanhante"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic py-2">Nenhum acompanhante alocado.</p>
        )}
      </div>
    </div>
  );
};

export default AcompanhantesBlock;
