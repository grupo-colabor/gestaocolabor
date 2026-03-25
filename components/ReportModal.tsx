import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileDown, FileSpreadsheet, FileText, Loader2, CheckSquare, Square } from 'lucide-react';
import type { ReportInput, ReportConfig } from '../utils/reportTypes';
import { exportToXLSX } from '../utils/exportXLSX';
import { exportToPDF } from '../utils/exportPDF';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportInput: ReportInput;
}

const TAB_LABELS: Record<string, string> = {
  GERAL:        'Geral',
  OPERACIONAL:  'Operacional',
  INSTRUTORES:  'Instrutores',
  CLIENTES:     'Clientes',
  CUSTOS:       'Custos',
};

const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, reportInput }) => {
  const allTabIds = reportInput.tabs.map(t => t.id);

  const [title,      setTitle]      = useState('');
  const [format,     setFormat]     = useState<'pdf' | 'excel'>('excel');
  const [includeTabs, setIncludeTabs] = useState<Record<string, boolean>>(
    Object.fromEntries(allTabIds.map(id => [id, true]))
  );
  const [loading,    setLoading]    = useState(false);
  const [progress,   setProgress]   = useState('');
  const [error,      setError]      = useState('');

  // Pre-fill title from periods whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    const labels = reportInput.periods.map(p =>
      p.startDate ? `${p.label} (${p.startDate} → ${p.endDate})` : p.label
    ).join(' vs ');
    setTitle(`Relatório Comparativo — ${labels}`);
    setError('');
    setProgress('');
    setIncludeTabs(Object.fromEntries(allTabIds.map(id => [id, true])));
  }, [isOpen]);

  const toggleTab = (id: string) =>
    setIncludeTabs(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleAll = () => {
    const allOn = allTabIds.every(id => includeTabs[id]);
    setIncludeTabs(Object.fromEntries(allTabIds.map(id => [id, !allOn])));
  };

  const anySelected = allTabIds.some(id => includeTabs[id]);

  const handleGenerate = async () => {
    if (!anySelected) { setError('Selecione ao menos um dashboard.'); return; }
    setLoading(true);
    setError('');

    const sanitizedInput: ReportInput = {
      ...reportInput,
      title,
      generatedAt: new Date(),
    };

    const safeFilename = title
      .replace(/[^a-zA-Z0-9\-_\u00C0-\u024F]/g, '_')
      .substring(0, 60);

    try {
      if (format === 'excel') {
        await exportToXLSX(sanitizedInput, {
          includeTabs,
          filename: `${safeFilename}.xlsx`,
        });
      } else {
        await exportToPDF(sanitizedInput, {
          includeTabs,
          filename: `${safeFilename}.pdf`,
        }, setProgress);
      }
      onClose();
    } catch (err: any) {
      console.error('[ReportModal] export error:', err);
      setError(`Erro ao gerar: ${err?.message || 'desconhecido'}`);
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <FileDown size={18} className="text-blue-500" />
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">
              Gerar Relatório
            </h2>
          </div>
          <button
            onClick={() => !loading && onClose()}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Title */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Nome do Relatório
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2.5 text-sm text-slate-800 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              placeholder="Ex: Comparativo Jan vs Fev"
            />
          </div>

          {/* Format */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Formato de Exportação
            </label>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: 'excel', label: 'Excel (.xlsx)', Icon: FileSpreadsheet, desc: 'Planilha multi-aba com formatação condicional' },
                { id: 'pdf',   label: 'PDF (.pdf)',    Icon: FileText,        desc: 'Documento com capa, tabelas e gráficos' },
              ] as const).map(({ id, label, Icon, desc }) => (
                <button
                  key={id}
                  onClick={() => !loading && setFormat(id)}
                  className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 transition-all text-left ${
                    format === id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <Icon size={18} className={format === id ? 'text-blue-500' : 'text-slate-400'} />
                  <span className={`text-xs font-black ${format === id ? 'text-blue-700' : 'text-slate-700'}`}>
                    {label}
                  </span>
                  <span className="text-[9px] text-slate-400 leading-tight">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dashboards to include */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Dashboards a Incluir
              </label>
              <button
                onClick={toggleAll}
                disabled={loading}
                className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest transition-colors"
              >
                {allTabIds.every(id => includeTabs[id]) ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {reportInput.tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => !loading && toggleTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                    includeTabs[tab.id]
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {includeTabs[tab.id]
                    ? <CheckSquare size={13} className="text-blue-500 shrink-0" />
                    : <Square      size={13} className="text-slate-300 shrink-0" />
                  }
                  {tab.label}
                  <span className="ml-auto text-[9px] opacity-60">{tab.kpis.length} KPIs</span>
                </button>
              ))}
            </div>
          </div>

          {/* Periods summary */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Períodos ({reportInput.periods.length})
            </p>
            <div className="space-y-1">
              {reportInput.periods.map(p => (
                <div key={p.label} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: p.color }}
                  />
                  <span className="text-[10px] font-bold" style={{ color: p.color }}>{p.label}</span>
                  <span className="text-[10px] text-slate-500">
                    {p.startDate ? `${p.startDate} → ${p.endDate}` : 'Todo o período'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600">
              {error}
            </div>
          )}

          {/* Progress */}
          {loading && progress && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs font-bold text-blue-600">
              <Loader2 size={12} className="animate-spin" />
              {progress}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={() => !loading && onClose()}
            disabled={loading}
            className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-700 uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || !anySelected || !title.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> Gerando…</>
              : <><FileDown size={13} /> Gerar {format === 'pdf' ? 'PDF' : 'Excel'}</>
            }
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReportModal;
