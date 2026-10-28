import React from 'react';
import { createPortal } from 'react-dom';
import { Ban, AlertTriangle } from 'lucide-react';
import {
  CANCEL_REASONS,
  REASON_WITH_NOTE,
  extraConfirmationMatches,
  type CancelDecision,
  type CancellationImpact,
} from '../../domain/demandCancellation';

/**
 * MODAL DE CANCELAMENTO — o MESMO para a demanda de cliente e a interna.
 *
 * Motivo obrigatório (lista única do domínio), observação em "Outro", e, para
 * demanda que já começou ou terminou, o bloco "Impacto" com o que a pessoa
 * precisa saber antes de confirmar: status atual, medição e etapa, despesas
 * lançadas, reembolso que deixaria de entrar no Excel de pagamento, pessoas
 * alocadas, e a frase "Nada será apagado". Medição FATURADA exige digitar o
 * número da demanda (só admin chega aqui — ver canCancelDemand).
 *
 * Quem decide o que pode é o domínio (`decision`, `impacto`); este componente
 * só mostra e coleta. `busy` segura o botão enquanto o banco responde: se o
 * banco recusar, o chamador mantém o modal aberto e o banner de erro já subiu.
 */
export interface CancelDemandModalProps {
  open: boolean;
  demandId: string;
  interna?: boolean;
  decision: CancelDecision;
  impacto: CancellationImpact;
  reason: string;
  onReasonChange: (reason: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  confirmText: string;
  onConfirmTextChange: (text: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CancelDemandModal: React.FC<CancelDemandModalProps> = ({
  open, demandId, interna, decision, impacto,
  reason, onReasonChange, note, onNoteChange,
  confirmText, onConfirmTextChange, busy, onConfirm, onBack,
}) => {
  if (!open) return null;

  const extra = decision.allowed && decision.extraConfirmation;
  const extraOk = !extra || extraConfirmationMatches(confirmText, demandId);
  const podeConfirmar = decision.allowed && !!reason && !busy && extraOk;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-demand-title"
        className="bg-white p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-5 border border-slate-100 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="p-3 bg-orange-100 rounded-full text-orange-600">
            <Ban size={40} />
          </div>
          <h3 id="cancel-demand-title" className="text-xl font-black text-slate-800 uppercase tracking-tight">
            {interna ? 'Cancelar demanda interna' : 'Motivo do Cancelamento'}
          </h3>
          <p className="text-sm text-slate-500">
            Selecione o motivo real do cancelamento de <strong>{demandId}</strong>.
          </p>
        </div>

        {!decision.allowed && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700" role="alert">
            {decision.reason}
          </div>
        )}

        {impacto.jaComecou && (
          <div
            data-testid="cancel-impacto"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2"
          >
            <p className="flex items-center gap-2 font-black uppercase tracking-widest text-[10px]">
              <AlertTriangle size={14} />
              Impacto: esta demanda já {impacto.statusCalculado === 'CONCLUIDA' ? 'terminou' : 'começou'}
            </p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>Status atual: <strong>{impacto.statusCalculadoLabel}</strong></li>
              <li>
                Medição: <strong>{impacto.medicaoStatusLabel}</strong>
                {impacto.medicaoFaturada && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-600 text-white font-black uppercase text-[9px] tracking-widest">Faturada</span>
                )}
              </li>
              {impacto.temMedicao && (
                <li>Despesas lançadas: <strong>{fmtBRL(impacto.totalDespesas)}</strong> em {impacto.qtdItens} item(ns)</li>
              )}
              {impacto.reembolsoInstrutor > 0 && (
                <li>Reembolso ao instrutor que <strong>não entrará</strong> no Excel de pagamento: <strong>{fmtBRL(impacto.reembolsoInstrutor)}</strong></li>
              )}
              <li>
                Pessoas alocadas: {impacto.pessoas.titulares} titular(es), {impacto.pessoas.acompanhantes} acompanhante(s), {impacto.pessoas.participantes} participante(s)
              </li>
            </ul>
            <p className="font-bold">{impacto.frase}</p>
          </div>
        )}

        <div className="space-y-3">
          {CANCEL_REASONS.map((r) => (
            <label
              key={r}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${reason === r ? 'border-orange-500 bg-orange-50' : 'border-slate-100 hover:border-slate-200'}`}
            >
              <input
                type="radio"
                name="cancelReason"
                value={r}
                className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-slate-300"
                checked={reason === r}
                onChange={() => onReasonChange(r)}
                disabled={!decision.allowed || busy}
              />
              <span className={`text-sm font-bold ${reason === r ? 'text-orange-900' : 'text-slate-600'}`}>{r}</span>
            </label>
          ))}
        </div>

        {reason === REASON_WITH_NOTE && (
          <div className="animate-fade-in">
            <label htmlFor="cancel-demand-note" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Observação Adicional</label>
            <textarea
              id="cancel-demand-note"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none h-24 resize-none shadow-inner bg-slate-50"
              placeholder="Explique o motivo..."
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {extra && (
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-2">
            <p className="text-xs font-bold text-purple-900">
              A medição desta demanda está <strong>FATURADA</strong>. Para confirmar, digite o número da demanda.
            </p>
            <input
              type="text"
              aria-label="Digite o número da demanda para confirmar"
              className="w-full border border-purple-200 rounded-xl px-4 py-2.5 text-sm font-mono uppercase focus:ring-2 focus:ring-purple-500 outline-none bg-white"
              placeholder={demandId}
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition disabled:opacity-60"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!podeConfirmar}
            className={`flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg
              ${podeConfirmar ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            {busy ? 'Gravando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CancelDemandModal;
