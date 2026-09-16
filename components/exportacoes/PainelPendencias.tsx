import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, FileSpreadsheet, Loader2, ListChecks } from 'lucide-react';
import type { PendenciaRow } from '../../domain/exports/pendencias';
import { PENDENCIAS_DATASET } from '../../domain/exports/pendencias';
import { buildTable, defaultColumnKeys } from '../../domain/exports/buildRows';
import { downloadXlsx } from '../../services/exports/xlsxWriter';
import { buildExportFileName } from '../../services/exports/csvWriter';
import { toBrDate } from '../../domain/exports/shared';

/**
 * "O que falta para fechar a medição": as demandas do recorte com pendência
 * e o motivo. ⛔ fato (não entra na planilha) · ⚠ aviso (entra, mas olhe).
 * Exportável em XLSX simples pelo escritor da F1. O filtro por corredor é o
 * mesmo da tela (já aplicado nas linhas recebidas).
 */
const PainelPendencias: React.FC<{ pendencias: PendenciaRow[]; totalNoRecorte: number }> = ({ pendencias, totalNoRecorte }) => {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fatos = pendencias.filter(p => p.fatos > 0).length;

  const baixar = async () => {
    setBaixando(true);
    setErro(null);
    try {
      const table = buildTable(PENDENCIAS_DATASET, pendencias, defaultColumnKeys(PENDENCIAS_DATASET));
      await downloadXlsx(table, buildExportFileName(PENDENCIAS_DATASET.fileBase, 'xlsx'), { sheetName: 'Pendências' });
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <ListChecks size={14} /> O que falta para fechar a medição
          </h3>
          <p className="text-[11px] text-slate-400 mt-1">
            {pendencias.length === 0
              ? `Nenhuma pendência nas ${totalNoRecorte} demandas do recorte.`
              : `${pendencias.length} de ${totalNoRecorte} demandas com pendência — ${fatos} fora da planilha (⛔), ${pendencias.length - fatos} só com avisos (⚠).`}
          </p>
        </div>
        <button
          type="button"
          onClick={baixar}
          disabled={baixando || pendencias.length === 0}
          className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {baixando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Pendências XLSX
        </button>
      </div>
      {erro && <p className="px-6 py-2 text-xs text-red-700 bg-red-50">Falha ao gerar: {erro}</p>}
      {pendencias.length > 0 && (
        <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {pendencias.map(p => (
            <li key={p.demand.id} className="px-6 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-700">
                <span className="font-black font-mono text-blue-600">{p.demand.id}</span>
                {p.origem.input.clientDemandId && <span className="text-slate-400 font-mono">({p.origem.input.clientDemandId})</span>}
                <span className="font-bold truncate max-w-[320px]" title={p.origem.input.trainingName}>{p.origem.input.trainingName}</span>
                <span className="text-slate-400">· {p.origem.input.local || '—'} · {toBrDate(p.origem.input.dataInicio)}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {p.pendencias.map((x, i) => (
                  <li key={i} className={`flex items-start gap-1.5 ${x.tipo === 'fato' ? 'text-red-700' : 'text-amber-700'}`}>
                    {x.tipo === 'fato' ? <AlertOctagon size={12} className="mt-0.5 shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                    <span>{x.texto}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PainelPendencias;
