import React from 'react';
import { AlertTriangle, Eye, UserCheck, Users } from 'lucide-react';

import type { Demand, Instructor } from '../types';
import type { AllocationPreview } from './AllocationDrawer';

/**
 * CARD DE INSTRUTOR — a linha da lista de alocação
 *
 * Extraído de `AllocationDrawer.tsx` sem nenhuma alteração de marcação, para
 * que a seleção de ACOMPANHANTE (components/CompanionPicker.tsx) mostre a mesma
 * linha da lista principal em vez de uma lista plana com nome e um botão. O
 * pedido era explícito: reusar o render, não copiá-lo.
 *
 * A generalização é uma só — a variante `picker`, que troca o par
 * Preview + Alocar por um botão único. Todo o resto (cores por estado, avatar,
 * badge de score, aviso de conflito) é idêntico nas duas telas, porque é o
 * mesmo componente.
 *
 * ⚠️ Conflito AVISA, não bloqueia, nas duas variantes. Quem monta a equipe às
 * vezes sabe de um remanejamento que o sistema ainda não viu — a decisão é
 * consciente, não impedida.
 */
export interface InstructorCardProps {
  instructor: Instructor & { score: number };
  isException: boolean;
  isAlreadyAllocated?: boolean;
  selectedDemand: Demand;
  companionMode: boolean;
  previewItems: AllocationPreview[];
  onPreview: () => void;
  onAllocate: () => void;
  onCompanionDays: () => void;
  hasScheduleConflict: (id: string, s: string, e: string, ex?: string) => boolean;
  /**
   * `picker`: um botão só (usado na seleção de acompanhante).
   * Ausente/`allocation`: o comportamento original da lista principal.
   */
  variant?: 'allocation' | 'picker';
  /** Só em `picker`: rótulo do botão único. */
  actionLabel?: string;
  /**
   * Só em `picker`: conflito já calculado pelo chamador.
   *
   * O card sozinho consulta o período INTEIRO da demanda; o picker de
   * acompanhante consulta os DIAS SELECIONADOS, que é uma pergunta diferente
   * (e mais útil: quem tem conflito só no dia 3 não deveria aparecer vermelho
   * quando o usuário escolheu o dia 1).
   */
  conflictOverride?: boolean;
  /** Só em `picker`: detalhe do conflito, para o tooltip. */
  conflictTitle?: string;
}

const InstructorCard: React.FC<InstructorCardProps> = ({
  instructor,
  isException,
  isAlreadyAllocated,
  selectedDemand,
  companionMode,
  previewItems,
  onPreview,
  onAllocate,
  onCompanionDays,
  hasScheduleConflict,
  variant = 'allocation',
  actionLabel = 'Selecionar',
  conflictOverride,
  conflictTitle,
}) => {
  const hasPreview = previewItems.some(p => p.instructorId === instructor.id && p.demandId === selectedDemand.id);
  const hasConflict =
    conflictOverride !== undefined
      ? conflictOverride
      : hasScheduleConflict(instructor.id, selectedDemand.startDate, selectedDemand.endDate, selectedDemand.id);

  return (
    <div className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 mb-1.5 ${
      isAlreadyAllocated ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400' :
      hasConflict ? 'border-red-200 bg-red-50/30' :
      isException ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300' :
      'border-slate-200 bg-white hover:border-blue-300'
    }`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs border shadow-sm shrink-0 ${
          isAlreadyAllocated ? 'bg-amber-100 text-amber-700 border-amber-300' :
          hasConflict ? 'bg-red-100 text-red-600 border-red-200' :
          isException ? 'bg-amber-50 text-amber-600 border-amber-200' :
          'bg-blue-100 text-blue-600 border-blue-200'
        }`}>
          {instructor.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-800 truncate" title={instructor.name}>{instructor.name}</p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {isAlreadyAllocated ? (
              <span className="text-[8px] font-black uppercase px-1 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-0.5">
                <AlertTriangle size={7} /> Já alocado neste dia
              </span>
            ) : (
              <>
                <span className={`text-[8px] font-black uppercase px-1 py-0.5 rounded border ${
                  isException ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                }`}>Score: {instructor.score}</span>
                {/* Região de residência: a informação que separa qualificado de
                    exceção, e que a lista plana antiga não mostrava. */}
                {instructor.residenceLocation && (
                  <span className="text-[8px] font-bold text-slate-400 uppercase">{instructor.residenceLocation}</span>
                )}
                {hasConflict && (
                  <span
                    className="text-[8px] font-black text-red-600 flex items-center gap-0.5"
                    title={conflictTitle || 'Já alocado neste período'}
                  >
                    <AlertTriangle size={8} /> {variant === 'picker' ? 'Já alocado neste dia' : 'Conflito'}
                  </span>
                )}
                {isException && !hasConflict && (
                  <span className="text-[8px] font-bold text-amber-600">Exceção</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {variant === 'picker' ? (
          <button
            onClick={onAllocate}
            title={hasConflict ? conflictTitle || 'Já alocado neste dia' : undefined}
            className={`px-2 py-1.5 font-black text-[8px] uppercase rounded-lg transition shadow-sm flex items-center gap-1 ${
              hasConflict
                ? 'bg-white border border-amber-400 text-amber-700 hover:bg-amber-50'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            <UserCheck size={10} /> {hasConflict ? 'Alocar mesmo assim' : actionLabel}
          </button>
        ) : companionMode ? (
          <button onClick={onCompanionDays}
            className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[8px] uppercase rounded-lg transition shadow-sm flex items-center gap-1">
            <Users size={10} /> Dias
          </button>
        ) : isAlreadyAllocated ? (
          <button onClick={onAllocate}
            className="px-2 py-1.5 font-black text-[8px] uppercase rounded-lg transition shadow-sm flex items-center gap-1 bg-white border border-amber-400 text-amber-700 hover:bg-amber-50">
            <UserCheck size={10} /> Alocar mesmo assim
          </button>
        ) : (
          <>
            <button onClick={onPreview} disabled={hasPreview}
              className={`px-2 py-1.5 font-black text-[8px] uppercase rounded-lg transition shadow-sm flex items-center gap-1 ${
                hasPreview ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600'
              }`}><Eye size={10} /> Preview</button>
            <button onClick={onAllocate}
              className={`px-2 py-1.5 font-black text-[8px] uppercase rounded-lg transition shadow-sm flex items-center gap-1 ${
                isException ? 'bg-white border border-amber-200 text-amber-700 hover:bg-amber-50'
                : 'bg-slate-900 hover:bg-blue-600 text-white'
              }`}><UserCheck size={10} /> Alocar</button>
          </>
        )}
      </div>
    </div>
  );
};

export default InstructorCard;
