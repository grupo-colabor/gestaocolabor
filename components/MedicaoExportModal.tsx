import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FileSpreadsheet, Loader2 } from 'lucide-react';

import { exportMedicaoMensal } from '../services/medicaoExportService';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

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
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [isGenerating, setIsGenerating] = useState(false);

  // Reabrir o modal volta para o mês anterior (default), não para a última escolha.
  useEffect(() => {
    if (!isOpen) return;
    const { year: y, month: m } = previousMonth();
    setYear(y);
    setMonth(m);
  }, [isOpen]);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current + 1, current, current - 1, current - 2, current - 3];
  }, []);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsGenerating(true);
    try {
      const result = await exportMedicaoMensal(year, month);

      if (result.status === 'VAZIO') {
        alert(
          `Nenhuma alocação de instrutor em demanda concluída no período ${MONTH_LABELS[month - 1]}/${year}.\n\n` +
          'Nenhum arquivo foi gerado.'
        );
        return;
      }

      onClose();
    } catch (err: any) {
      console.error('exportMedicaoMensal error:', err);
      alert(`Erro ao gerar a medição: ${err?.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-white/20">

        {/* ===== HEADER ===== */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Exportar Medição</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              Medição mensal de instrutores em Excel (.xlsx)
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

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-900 leading-relaxed">
            <p className="font-black uppercase tracking-widest text-[10px] mb-1">Como preencher</p>
            O valor da <strong>Hora/Aula</strong> não sai do sistema: preencha a coluna amarela da aba
            <strong> Resumo</strong>, e o total do instrutor, o TOTAL GERAL e a coluna Valor da aba dele
            são calculados pelo próprio Excel.
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Entram apenas demandas <strong>concluídas</strong> com instrutor alocado. Demandas que atravessam
            a virada do mês entram proporcionalmente aos dias dentro do período.
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
            disabled={isGenerating}
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
