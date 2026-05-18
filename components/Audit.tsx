import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield, ChevronDown, ChevronRight, Download,
  Filter, Search, LayoutList, FolderOpen, Folder,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { fetchAuditLogs, type AuditLog, type AuditModulo } from '../services/auditLog';
import { supabase } from '../lib/supabase';

/* -------------------------------------------------------
   Constantes
------------------------------------------------------- */
const MODULOS: AuditModulo[] = [
  'Demandas', 'Agendamento', 'Programação', 'Medição', 'Evidências',
];

const MODULE_ORDER: string[] = [
  'Demandas', 'Agendamento', 'Programação', 'Medição', 'Evidências',
];

const ACTION_COLORS: Record<string, string> = {
  Criar:     'bg-green-50 text-green-700',
  Cancelar:  'bg-red-50 text-red-700',
  Reprovar:  'bg-red-50 text-red-700',
  Aprovar:   'bg-emerald-50 text-emerald-700',
  Confirmar: 'bg-emerald-50 text-emerald-700',
};

/* -------------------------------------------------------
   CSV export
------------------------------------------------------- */
function exportToCSV(logs: AuditLog[]): void {
  const headers = ['Data/hora', 'Usuário', 'Módulo', 'Ação', 'Descrição'];
  const rows = logs.map(l => [
    new Date(l.created_at).toLocaleString('pt-BR'),
    l.user_name, l.modulo, l.acao, l.descricao,
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------
   Excel export
------------------------------------------------------- */
async function exportToExcel(groups: DemandGroup[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Auditoria');

  ws.columns = [
    { key: 'data',      width: 22 },
    { key: 'usuario',   width: 32 },
    { key: 'modulo',    width: 16 },
    { key: 'acao',      width: 14 },
    { key: 'descricao', width: 90 },
  ];

  for (const group of groups) {
    const label = group.demandId === 'outros'
      ? 'Outros'
      : `${group.demandId}${group.treinamento ? ' — ' + group.treinamento : ''}${group.empresa ? ' | ' + group.empresa : ''}`;

    // Linha de cabeçalho da demanda — azul escuro
    const demandRow = ws.addRow([label, '', '', '', '']);
    ws.mergeCells(`A${demandRow.number}:E${demandRow.number}`);
    const demandCell = demandRow.getCell(1);
    demandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
    demandCell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    demandCell.alignment = { vertical: 'middle' };
    demandRow.height = 20;

    // Linha de cabeçalho das colunas — cinza claro
    const colRow = ws.addRow(['Data/hora', 'Usuário', 'Módulo', 'Ação', 'Descrição']);
    colRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
      cell.font = { bold: true };
    });

    // Linhas de registro
    for (const moduleGroup of group.modules) {
      for (const log of moduleGroup.logs) {
        ws.addRow([
          new Date(log.created_at).toLocaleString('pt-BR'),
          log.user_name,
          log.modulo,
          log.acao,
          log.descricao,
        ]);
      }
    }

    // Linha em branco separadora
    ws.addRow([]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------
   Extração de ID da demanda
------------------------------------------------------- */
function extractDemandId(log: AuditLog): string {
  // 1. DEM-NNNN na descrição (qualquer módulo)
  const demMatch = log.descricao.match(/\bDEM-\d+\b/);
  if (demMatch) return demMatch[0];

  // 2. demandId em dados_depois / dados_antes
  const depois = log.dados_depois as any;
  const antes  = log.dados_antes  as any;
  const demandId: unknown = depois?.demandId || antes?.demandId;
  if (typeof demandId === 'string' && /^DEM-\d+$/.test(demandId)) return demandId;

  return 'outros';
}

function extractFromDesc(desc: string, key: string): string {
  const match = desc.match(new RegExp(`${key}: ([^|]+)`));
  return match ? match[1].trim() : '';
}

/* -------------------------------------------------------
   Estrutura de agrupamento — dois níveis
------------------------------------------------------- */
interface ModuleGroup {
  modulo: string;
  logs: AuditLog[];
}

interface DemandGroup {
  demandId: string;
  empresa: string;
  treinamento: string;
  totalLogs: number;
  lastAt: string;
  modules: ModuleGroup[];
  excluida: boolean;
}

function buildDemandGroups(logs: AuditLog[]): DemandGroup[] {
  // Árvore: demandId → modulo → logs[]
  const tree = new Map<string, Map<string, AuditLog[]>>();

  for (const log of logs) {
    const demandId = extractDemandId(log);
    if (!tree.has(demandId)) tree.set(demandId, new Map());
    const mmap = tree.get(demandId)!;
    if (!mmap.has(log.modulo)) mmap.set(log.modulo, []);
    mmap.get(log.modulo)!.push(log);
  }

  const groups: DemandGroup[] = [];

  for (const [demandId, mmap] of tree) {
    const allLogs = Array.from(mmap.values()).flat();
    allLogs.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Extrai empresa/treinamento — prioridade para logs do módulo Demandas
    const demLogs = mmap.get('Demandas') ?? [];
    let empresa = '';
    let treinamento = '';
    for (const l of [...demLogs, ...allLogs]) {
      if (!empresa)     empresa     = extractFromDesc(l.descricao, 'Empresa');
      if (!treinamento) treinamento = extractFromDesc(l.descricao, 'Treinamento');
      if (empresa && treinamento) break;
    }

    // Módulos ordenados pela ordem canônica
    const modules: ModuleGroup[] = Array.from(mmap.entries())
      .map(([modulo, mlogs]) => ({
        modulo,
        logs: mlogs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }))
      .sort((a, b) => {
        const ia = MODULE_ORDER.indexOf(a.modulo);
        const ib = MODULE_ORDER.indexOf(b.modulo);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });

    groups.push({
      demandId,
      empresa,
      treinamento,
      totalLogs: allLogs.length,
      lastAt: allLogs[0]?.created_at ?? '',
      modules,
      excluida: allLogs.length > 0 && allLogs.every(l => l.demanda_excluida === true),
    });
  }

  // DEM-* ordenados por data decrescente; 'outros' sempre ao final
  return groups.sort((a, b) => {
    if (a.demandId === 'outros') return 1;
    if (b.demandId === 'outros') return -1;
    return b.lastAt.localeCompare(a.lastAt);
  });
}

/* -------------------------------------------------------
   Sub-componente: linha de log expandível
   (reutilizado em "Por entidade" e "Cronológico")
------------------------------------------------------- */
const LogRow: React.FC<{
  log: AuditLog;
  compact?: boolean;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}> = ({ log, compact = false, expandedId, setExpandedId }) => {
  const isExpanded = expandedId === log.id;
  const hasDetails = log.dados_antes != null || log.dados_depois != null;
  const actionClass = ACTION_COLORS[log.acao] ?? 'bg-gray-100 text-gray-600';

  if (compact) {
    return (
      <React.Fragment>
        <div
          className={`flex items-start gap-3 px-6 py-3 text-sm border-t border-gray-50
            hover:bg-gray-50/50 transition-colors ${hasDetails ? 'cursor-pointer' : ''}`}
          onClick={() => hasDetails && setExpandedId(isExpanded ? null : log.id)}
        >
          <span className="text-gray-400 whitespace-nowrap text-xs pt-0.5 w-36 shrink-0">
            {new Date(log.created_at).toLocaleString('pt-BR')}
          </span>
          <span className="text-gray-600 text-xs pt-0.5 w-28 shrink-0 truncate" title={log.user_name}>
            {log.user_name}
          </span>
          <span className={`px-2 py-0.5 rounded-lg text-xs font-medium shrink-0 ${actionClass}`}>
            {log.acao}
          </span>
          <span className="text-gray-600 text-xs flex-1 min-w-0 leading-relaxed">
            {log.descricao}
          </span>
          {hasDetails && (
            <span className="text-gray-300 shrink-0 mt-0.5">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          )}
        </div>
        {isExpanded && hasDetails && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {log.dados_antes != null && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Dados Antes
                  </p>
                  <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-64 leading-relaxed">
                    {JSON.stringify(log.dados_antes, null, 2)}
                  </pre>
                </div>
              )}
              {log.dados_depois != null && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Dados Depois
                  </p>
                  <pre className="bg-gray-900 text-blue-400 rounded-xl p-4 text-xs overflow-auto max-h-64 leading-relaxed">
                    {JSON.stringify(log.dados_depois, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  // Linha completa para a tabela cronológica
  return (
    <React.Fragment>
      <tr
        className={`transition-colors hover:bg-blue-50/30 ${hasDetails ? 'cursor-pointer' : ''}
          ${isExpanded ? 'bg-blue-50/20' : ''}`}
        onClick={() => hasDetails && setExpandedId(isExpanded ? null : log.id)}
      >
        <td className="px-4 py-3 text-gray-400 w-8">
          {hasDetails && (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        </td>
        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-sm">
          {new Date(log.created_at).toLocaleString('pt-BR')}
        </td>
        <td className="px-4 py-3 font-medium text-gray-800 text-sm">{log.user_name}</td>
        <td className="px-4 py-3">
          <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium">
            {log.modulo}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded-lg text-xs font-medium ${actionClass}`}>
            {log.acao}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-600 text-sm">{log.descricao}</td>
      </tr>
      {isExpanded && hasDetails && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {log.dados_antes != null && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Dados Antes
                  </p>
                  <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-64 leading-relaxed">
                    {JSON.stringify(log.dados_antes, null, 2)}
                  </pre>
                </div>
              )}
              {log.dados_depois != null && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Dados Depois
                  </p>
                  <pre className="bg-gray-900 text-blue-400 rounded-xl p-4 text-xs overflow-auto max-h-64 leading-relaxed">
                    {JSON.stringify(log.dados_depois, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};

/* -------------------------------------------------------
   Página principal
------------------------------------------------------- */
const AuditPage: React.FC = () => {
  const [logs, setLogs]       = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Abas
  const [tab, setTab] = useState<'entidade' | 'cronologico'>('entidade');

  // Aba "Por entidade" — dois níveis de accordion
  const [searchEntity, setSearchEntity]         = useState('');
  const [expandedDemands, setExpandedDemands]   = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules]   = useState<Set<string>>(new Set());
  const [showExcluidas, setShowExcluidas]       = useState(false);

  // Aba "Cronológico" — filtros
  const [filterModulo, setFilterModulo]         = useState('');
  const [filterUsuario, setFilterUsuario]       = useState('');
  const [filterDataInicio, setFilterDataInicio] = useState('');
  const [filterDataFim, setFilterDataFim]       = useState('');
  const [usuarios, setUsuarios] = useState<string[]>([]);

  /* Carrega logs */
  useEffect(() => {
    fetchAuditLogs().then(data => {
      setLogs(data);
      setLoading(false);
    });
  }, []);

  /* Carrega usuários para o dropdown */
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .not('full_name', 'is', null)
      .order('full_name')
      .then(({ data }) => {
        if (!data) return;
        setUsuarios(data.map((r: { id: string; full_name: string }) => r.full_name));
      });
  }, []);

  /* ---- Aba cronológica ---- */
  const filtered = useMemo(() => logs.filter(l => {
    if (filterModulo && l.modulo !== filterModulo) return false;
    if (filterUsuario && l.user_name !== filterUsuario) return false;
    if (filterDataInicio && l.created_at < filterDataInicio) return false;
    if (filterDataFim && l.created_at > filterDataFim + 'T23:59:59') return false;
    return true;
  }), [logs, filterModulo, filterUsuario, filterDataInicio, filterDataFim]);

  /* ---- Aba por entidade ---- */
  const demandGroups = useMemo(() => buildDemandGroups(logs), [logs]);

  const filteredDemandGroups = useMemo(() => {
    const q = searchEntity.trim().toLowerCase();
    return demandGroups.filter(g => {
      if (g.excluida && !showExcluidas) return false;
      if (!q) return true;
      return (
        g.demandId.toLowerCase().includes(q) ||
        g.empresa.toLowerCase().includes(q) ||
        g.treinamento.toLowerCase().includes(q) ||
        g.modules.some(m =>
          m.modulo.toLowerCase().includes(q) ||
          m.logs.some(l => l.descricao.toLowerCase().includes(q))
        )
      );
    });
  }, [demandGroups, searchEntity, showExcluidas]);

  const toggleDemand = (demandId: string) => {
    setExpandedDemands(prev => {
      const next = new Set(prev);
      next.has(demandId) ? next.delete(demandId) : next.add(demandId);
      return next;
    });
  };

  const toggleModule = (moduleKey: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      next.has(moduleKey) ? next.delete(moduleKey) : next.add(moduleKey);
      return next;
    });
  };

  /* ---- Render ---- */
  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Shield size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Auditoria</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Histórico de ações do sistema (somente leitura)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToCSV(tab === 'cronologico' ? filtered : logs)}
            disabled={loading || logs.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm
              font-semibold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Exportar CSV
          </button>
          <button
            onClick={() => { void exportToExcel(filteredDemandGroups); }}
            disabled={loading || logs.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm
              font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('entidade')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${tab === 'entidade' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <FolderOpen size={15} />
          Por entidade
        </button>
        <button
          onClick={() => setTab('cronologico')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${tab === 'cronologico' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <LayoutList size={15} />
          Cronológico
        </button>
      </div>

      {/* ============================================================
          ABA: POR ENTIDADE — dois níveis de accordion
      ============================================================ */}
      {tab === 'entidade' && (
        <div className="space-y-3">

          {/* Busca + toggle excluídas */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por ID (DEM-299), empresa, treinamento, módulo ou texto..."
                value={searchEntity}
                onChange={e => setSearchEntity(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white
                  text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
            </div>
            {demandGroups.some(g => g.excluida) && (
              <button
                onClick={() => setShowExcluidas(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors shrink-0
                  ${showExcluidas
                    ? 'bg-red-50 border-red-200 text-red-600'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-500'}`}
              >
                {showExcluidas ? 'Ocultar excluídas' : 'Mostrar excluídas'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-16 text-center text-gray-400 text-sm bg-white rounded-2xl border border-gray-100">
              Carregando registros de auditoria...
            </div>
          ) : filteredDemandGroups.length === 0 ? (
            <div className="p-16 text-center text-gray-400 text-sm bg-white rounded-2xl border border-gray-100">
              Nenhuma demanda encontrada.
            </div>
          ) : (
            filteredDemandGroups.map(demandGroup => {
              const isDemandOpen = expandedDemands.has(demandGroup.demandId);
              const isOthers = demandGroup.demandId === 'outros';
              const lastDate = demandGroup.lastAt
                ? new Date(demandGroup.lastAt).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '—';

              const isExcluida = demandGroup.excluida;

              return (
                <div
                  key={demandGroup.demandId}
                  className={`rounded-2xl shadow-sm overflow-hidden border
                    ${isExcluida
                      ? 'bg-gray-50 border-red-100 opacity-75'
                      : 'bg-white border-gray-100'}`}
                >
                  {/* ── Nível 1: cabeçalho da demanda ── */}
                  <button
                    onClick={() => toggleDemand(demandGroup.demandId)}
                    className="w-full flex items-center justify-between px-5 py-4
                      hover:bg-gray-100/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isDemandOpen
                        ? <FolderOpen size={18} className={`shrink-0 ${isExcluida ? 'text-red-300' : isOthers ? 'text-gray-400' : 'text-blue-500'}`} />
                        : <Folder     size={18} className={`shrink-0 ${isExcluida ? 'text-red-200' : isOthers ? 'text-gray-300' : 'text-blue-400'}`} />
                      }
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono font-bold text-sm ${isExcluida ? 'text-gray-400 line-through' : isOthers ? 'text-gray-500' : 'text-blue-700'}`}>
                            {isOthers ? 'Outros' : demandGroup.demandId}
                          </span>
                          {isExcluida && (
                            <span className="px-1.5 py-0.5 rounded-md bg-red-100 text-red-600 text-xs font-semibold">
                              Excluída
                            </span>
                          )}
                          {(demandGroup.treinamento || demandGroup.empresa) && (
                            <span className="text-gray-400 text-sm truncate">
                              — {[demandGroup.treinamento, demandGroup.empresa].filter(Boolean).join(' | ')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          última ação: {lastDate}
                          {' · '}
                          {demandGroup.modules.length} módulo{demandGroup.modules.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">
                        {demandGroup.totalLogs} registro{demandGroup.totalLogs !== 1 ? 's' : ''}
                      </span>
                      {isDemandOpen
                        ? <ChevronDown  size={16} className="text-gray-400" />
                        : <ChevronRight size={16} className="text-gray-400" />}
                    </div>
                  </button>

                  {/* ── Nível 2: pastas de módulo ── */}
                  {isDemandOpen && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {demandGroup.modules.map(moduleGroup => {
                        const moduleKey = `${demandGroup.demandId}::${moduleGroup.modulo}`;
                        const isModuleOpen = expandedModules.has(moduleKey);

                        return (
                          <div key={moduleKey}>
                            {/* Cabeçalho da pasta de módulo */}
                            <button
                              onClick={() => toggleModule(moduleKey)}
                              className="w-full flex items-center justify-between pl-10 pr-5 py-3
                                hover:bg-blue-50/30 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                {isModuleOpen
                                  ? <FolderOpen size={14} className="text-indigo-400 shrink-0" />
                                  : <Folder     size={14} className="text-indigo-300 shrink-0" />
                                }
                                <span className="text-sm font-semibold text-gray-700">
                                  {moduleGroup.modulo}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100
                                  px-2 py-0.5 rounded-md font-medium">
                                  {moduleGroup.logs.length} registro{moduleGroup.logs.length !== 1 ? 's' : ''}
                                </span>
                                {isModuleOpen
                                  ? <ChevronDown  size={13} className="text-gray-300" />
                                  : <ChevronRight size={13} className="text-gray-300" />}
                              </div>
                            </button>

                            {/* ── Nível 3: linhas de log ── */}
                            {isModuleOpen && (
                              <div className="bg-gray-50/40">
                                {moduleGroup.logs.map(log => (
                                  <LogRow
                                    key={log.id}
                                    log={log}
                                    compact
                                    expandedId={expandedId}
                                    setExpandedId={setExpandedId}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {!loading && filteredDemandGroups.length > 0 && (
            <p className="text-xs text-gray-400 text-center pt-1">
              {filteredDemandGroups.filter(g => g.demandId !== 'outros').length} demanda
              {filteredDemandGroups.filter(g => g.demandId !== 'outros').length !== 1 ? 's' : ''}
              {' · '}
              {filteredDemandGroups.reduce((s, g) => s + g.totalLogs, 0)} registros no total
            </p>
          )}
        </div>
      )}

      {/* ============================================================
          ABA: CRONOLÓGICO (inalterada)
      ============================================================ */}
      {tab === 'cronologico' && (
        <div className="space-y-4">

          {/* Filtros */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Filtros</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select
                value={filterModulo}
                onChange={e => setFilterModulo(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50
                  text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos os módulos</option>
                {MODULOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <select
                value={filterUsuario}
                onChange={e => setFilterUsuario(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50
                  text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos os usuários</option>
                {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
              </select>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 pl-1">Data início</label>
                <input
                  type="date"
                  value={filterDataInicio}
                  onChange={e => setFilterDataInicio(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50
                    text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 pl-1">Data fim</label>
                <input
                  type="date"
                  value={filterDataFim}
                  onChange={e => setFilterDataFim(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50
                    text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-16 text-center text-gray-400 text-sm">
                Carregando registros de auditoria...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center text-gray-400 text-sm">
                Nenhum registro encontrado para os filtros aplicados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left w-8"></th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">
                        Data/hora
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Usuário</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Módulo</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Ação</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Descrição</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(log => (
                      <LogRow
                        key={log.id}
                        log={log}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!loading && filtered.length > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {filtered.length} registro{filtered.length !== 1 ? 's' : ''} encontrado
              {filtered.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

    </div>
  );
};

export default AuditPage;
