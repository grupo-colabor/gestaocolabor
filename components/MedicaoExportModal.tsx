import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react';

import {
  countDaysInclusive,
  exportMedicao,
  monthBounds,
  type MedicaoPeriodo,
} from '../services/medicaoExportService';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type Modo = 'MES' | 'PERSONALIZADO';

/** Ciclo típico de medição. Acima disso é provável erro de digitação — mas não é proibido. */
const CICLO_TIPICO_DIAS = 45;

/** Mês anterior ao atual — o mês que normalmente se fecha para pagamento. */
function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

interface MedicaoExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MedicaoExportModal: React.FC<MedicaoExportModalProps> = ({ isOpen, onClose }) => {
  const initial = useMemo(previousMonth, []);
  const [modo, setModo] = useState<Modo>('MES');
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Reabrir o modal volta para o default (mês anterior), não para a última escolha.
  useEffect(() => {
    if (!isOpen) return;
    const { year: y, month: m } = previousMonth();
    setModo('MES');
    setYear(y);
    setMonth(m);
    setDataInicio('');
    setDataFim('');
  }, [isOpen]);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current + 1, current, current - 1, current - 2, current - 3];
  }, []);

  /** Trocar para personalizado pré-carrega o mês escolhido — evita dois campos vazios. */
  const handleModo = (next: Modo) => {
    if (next === 'PERSONALIZADO' && !dataInicio && !dataFim) {
      const { start, end } = monthBounds(year, month);
      setDataInicio(start);
      setDataFim(end);
    }
    setModo(next);
  };

  const erro = useMemo(() => {
    if (modo !== 'PERSONALIZADO') return null;
    if (!dataInicio || !dataFim) return 'Informe a data de início e a data de fim.';
    if (dataFim < dataInicio) return 'A data de fim não pode ser anterior à de início.';
    return null;
  }, [modo, dataInicio, dataFim]);

  // Aviso não-bloqueante: sinaliza, mas o botão continua liberado.
  const aviso = useMemo(() => {
    if (modo !== 'PERSONALIZADO' || erro) return null;
    const dias = countDaysInclusive(dataInicio, dataFim);
    if (dias <= CICLO_TIPICO_DIAS) return null;
    return `Período de ${dias} dias — maior que um ciclo típico. Confirme as datas.`;
  }, [modo, dataInicio, dataFim, erro]);

  if (!isOpen) return null;

  const handleExport = async () => {
    if (erro) return;

    const periodo: MedicaoPeriodo =
      modo === 'MES'
        ? { modo: 'MES', year, month }
        : { modo: 'PERSONALIZADO', dataInicio, dataFim };

    setIsGenerating(true);
    try {
      const result = await exportMedicao(periodo);

      if (result.status === 'VAZIO') {
        alert(
          `Nenhuma alocação de instrutor em demanda concluída no período ${result.periodoLabel}.\n\n` +
          'Nenhum arquivo foi gerado.'
        );
        return;
      }

      onClose();
    } catch (err: any) {
      console.error('exportMedicao error:', err);
      alert(`Erro ao gerar a medição: ${err?.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const tabClass = (ativo: boolean) =>
    `flex-1 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition ${
      ativo ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
    }`;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-white/20">

        {/* ===== HEADER ===== */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Exportar Medição</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              Medição de instrutores em Excel (.xlsx)
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-2xl transition shadow-sm disabled:opacity-40"
          >
            <X size={24} />
          </button>
        </div>

        {/* ===== BODY ===== */}
        <div className="p-6 space-y-5">
          {/* Modo */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            <button onClick={() => handleModo('MES')} disabled={isGenerating} className={tabClass(modo === 'MES')}>
              Mês
            </button>
            <button
              onClick={() => handleModo('PERSONALIZADO')}
              disabled={isGenerating}
              className={tabClass(modo === 'PERSONALIZADO')}
            >
              Período personalizado
            </button>
          </div>

          {modo === 'MES' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Mês</label>
                <select
                  value={month}
                  onChange={e => setMonth(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-50"
                >
                  {MONTH_LABELS.map((label, i) => (
                    <option key={label} value={i + 1}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Ano</label>
                <select
                  value={year}
                  onChange={e => setYear(Number(e.target.value))}
                  disabled={isGenerating}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-50"
                >
                  {yearOptions.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Início</label>
                  <input
                    type="date"
                    value={dataInicio}
                    onChange={e => setDataInicio(e.target.value)}
                    disabled={isGenerating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Fim</label>
                  <input
                    type="date"
                    value={dataFim}
                    onChange={e => setDataFim(e.target.value)}
                    disabled={isGenerating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-50"
                  />
                </div>
              </div>

              {erro && (
                <div className="flex items-start gap-2 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-px flex-shrink-0" /> {erro}
                </div>
              )}

              {aviso && (
                <div className="flex items-start gap-2 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-px flex-shrink-0" /> {aviso}
                </div>
              )}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-900 leading-relaxed">
            <p className="font-black uppercase tracking-widest text-[10px] mb-1">Como preencher</p>
            O valor da <strong>Hora/Aula</strong> não sai do sistema: preencha a coluna amarela da aba
            <strong> Resumo</strong>, e o total do instrutor, o TOTAL GERAL e a coluna Valor da aba dele
            são calculados pelo próprio Excel.
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Entram apenas demandas <strong>concluídas</strong> com instrutor alocado. Demandas que atravessam
            os limites do período entram proporcionalmente aos dias dentro dele.
          </p>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-500 hover:bg-slate-100 transition disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleExport}
            disabled={isGenerating || !!erro}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isGenerating
              ? <><Loader2 size={18} className="animate-spin" /> <span>Gerando...</span></>
              : <><FileSpreadsheet size={18} /> <span>Gerar Planilha</span></>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MedicaoExportModal;
