import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  ListChecks,
  Search,
} from 'lucide-react';
import type { Pendencia, PendenciaRow } from '../../domain/exports/pendencias';
import { PENDENCIAS_DATASET } from '../../domain/exports/pendencias';
import { buildTable, defaultColumnKeys } from '../../domain/exports/buildRows';
import { downloadXlsx } from '../../services/exports/xlsxWriter';
import { buildExportFileName } from '../../services/exports/csvWriter';
import { toBrDate } from '../../domain/exports/shared';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../Pagination';

/**
 * "O que falta para fechar a medição" — recolhido por padrão; o cabeçalho já
 * traz o resumo e o botão de XLSX. Expandido: busca (DEM-, ID SAP,
 * treinamento, instrutor — client-side), grupos por motivo com contagem,
 * cada grupo recolhível e paginado (25 por página).
 *
 * ⛔ fato (não entra na planilha) · ⚠ aviso (entra, mas olhe).
 */

const PAGE = 25;

const normalize = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Motivo sem o sufixo dinâmico entre parênteses: "Demanda não concluída (Alocada)" → "Demanda não concluída". */
const motivoBase = (texto: string) => texto.replace(/\s*\([^)]*\)\s*$/, '').trim();

interface Grupo {
  motivo: string;
  tipo: Pendencia['tipo'];
  itens: { row: PendenciaRow; texto: string }[];
}

const GrupoPendencia: React.FC<{ grupo: Grupo; aberto: boolean; onToggle: () => void }> = ({ grupo, aberto, onToggle }) => {
  const pag = usePagination<Grupo['itens'][number]>(grupo.itens, `exportacoes.pendencias.${grupo.motivo}`, PAGE);
  const fato = grupo.tipo === 'fato';
  return (
    <li className="border-t border-slate-100">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-6 py-3 flex items-center gap-3 text-left hover:bg-slate-50"
      >
        {aberto ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
        {fato ? <AlertOctagon size={14} className="text-red-600 shrink-0" /> : <AlertTriangle size={14} className="text-amber-600 shrink-0" />}
        <span className={`text-xs font-bold ${fato ? 'text-red-700' : 'text-amber-800'}`}>{grupo.motivo}</span>
        <span className="ml-auto text-[10px] font-black text-slate-400 uppercase tracking-widest">{grupo.itens.length}</span>
      </button>
      {aberto && (
        <div className="bg-slate-50/60">
          <ul className="divide-y divide-slate-100">
            {pag.paginatedItems.map(({ row, texto }) => (
              <li key={row.demand.id} className="px-10 py-2 text-xs flex flex-wrap items-center gap-2 text-slate-700">
                <span className="font-black font-mono text-blue-600">{row.demand.id}</span>
                {row.origem.input.clientDemandId && <span className="text-slate-400 font-mono">({row.origem.input.clientDemandId})</span>}
                <span className="font-bold truncate max-w-[320px]" title={row.origem.input.trainingName}>{row.origem.input.trainingName}</span>
                <span className="text-slate-400">· {row.origem.input.local || '—'} · {toBrDate(row.origem.input.dataInicio)}</span>
                {row.origem.input.titulares.length > 0 && <span className="text-slate-400">· {row.origem.input.titulares.join(' / ')}</span>}
                {texto !== grupo.motivo && <span className="text-slate-400 italic">— {texto}</span>}
              </li>
            ))}
          </ul>
          {grupo.itens.length > PAGE && (
            <Pagination
              currentPage={pag.currentPage}
              totalPages={pag.totalPages}
              totalItems={grupo.itens.length}
              itemsPerPage={pag.itemsPerPage}
              startIdx={pag.startIdx}
              entityLabel="demandas"
              onPageChange={pag.setCurrentPage}
              onItemsPerPageChange={pag.handleItemsPerPageChange}
              hideSizeSelector
            />
          )}
        </div>
      )}
    </li>
  );
};

const PainelPendencias: React.FC<{ pendencias: PendenciaRow[]; totalNoRecorte: number }> = ({ pendencias, totalNoRecorte }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set());
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fatos = pendencias.filter(p => p.fatos > 0).length;

  const filtradas = useMemo(() => {
    const q = normalize(busca.trim());
    if (!q) return pendencias;
    return pendencias.filter(p => {
      const alvo = normalize(
        [p.demand.id, p.origem.input.clientDemandId, p.origem.input.trainingName, ...p.origem.input.titulares].join(' ')
      );
      return alvo.includes(q);
    });
  }, [pendencias, busca]);

  const grupos = useMemo<Grupo[]>(() => {
    const porMotivo = new Map<string, Grupo>();
    for (const row of filtradas) {
      for (const p of row.pendencias) {
        const motivo = motivoBase(p.texto);
        const g = porMotivo.get(motivo) ?? { motivo, tipo: p.tipo, itens: [] };
        g.itens.push({ row, texto: p.texto });
        porMotivo.set(motivo, g);
      }
    }
    return [...porMotivo.values()].sort(
      (a, b) => Number(b.tipo === 'fato') - Number(a.tipo === 'fato') || b.itens.length - a.itens.length || a.motivo.localeCompare(b.motivo, 'pt-BR')
    );
  }, [filtradas]);

  const toggleGrupo = (motivo: string) =>
    setGruposAbertos(prev => {
      const next = new Set(prev);
      if (next.has(motivo)) next.delete(motivo);
      else next.add(motivo);
      return next;
    });

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
      <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <button type="button" onClick={() => setAberto(a => !a)} className="text-left flex items-start gap-3 min-w-0">
          {aberto ? <ChevronDown size={16} className="mt-0.5 text-slate-400 shrink-0" /> : <ChevronRight size={16} className="mt-0.5 text-slate-400 shrink-0" />}
          <span>
            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <ListChecks size={14} /> O que falta para fechar a medição
            </span>
            <span className="block text-[11px] text-slate-500 mt-1">
              {pendencias.length === 0
                ? `Nenhuma pendência nas ${totalNoRecorte} demandas do recorte.`
                : `${pendencias.length} demandas com pendência — ${fatos} fora da planilha, ${pendencias.length - fatos} só com avisos.`}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={baixar}
          disabled={baixando || pendencias.length === 0}
          className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {baixando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Pendências XLSX
        </button>
      </div>
      {erro && <p className="px-6 py-2 text-xs text-red-700 bg-red-50">Falha ao gerar: {erro}</p>}

      {aberto && pendencias.length > 0 && (
        <>
          <div className="px-6 pb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por DEM-, ID SAP, treinamento ou instrutor"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {busca && (
              <p className="text-[10px] text-slate-400 mt-1">
                {filtradas.length} de {pendencias.length} demandas casam com a busca.
              </p>
            )}
          </div>
          <ul>
            {grupos.map(g => (
              <GrupoPendencia key={g.motivo} grupo={g} aberto={gruposAbertos.has(g.motivo)} onToggle={() => toggleGrupo(g.motivo)} />
            ))}
            {grupos.length === 0 && <li className="px-6 py-6 text-center text-xs text-slate-300 font-bold border-t border-slate-100">Nada encontrado.</li>}
          </ul>
        </>
      )}
    </div>
  );
};

export default PainelPendencias;
