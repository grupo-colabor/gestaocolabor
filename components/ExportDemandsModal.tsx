import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Filter,
  CheckSquare,
  Square,
  Calendar,
  FileDown,
  Search
} from 'lucide-react';
// ExcelJS é importado dinamicamente em handleExportExcel para reduzir bundle inicial

import { Demand, Company, Training, Region, Instructor, InstructorAllocation } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { demandIntersectsRange } from '../domain/demandDays';

/* ========== STATUS STYLING (idêntico ao Measurement.tsx) ========== */
const STATUS_STYLING: Record<string, string> = {
  NOVA: 'bg-purple-100 text-purple-700',
  PENDENTE: 'bg-orange-100 text-orange-700',
  ALOCADA: 'bg-blue-100 text-blue-700',
  EM_ANDAMENTO: 'bg-indigo-100 text-indigo-700',
  CONCLUIDA: 'bg-green-100 text-green-700',
  CANCELADA: 'bg-red-100 text-red-700',
};

/* ========== PROPS ========== */
interface ExportDemandsModalProps {
  isOpen: boolean;
  onClose: () => void;
  demands: Demand[];
  companies: Company[];
  trainings: Training[];
  regions: Region[];
  instructors: Instructor[];
  instructorAllocations: InstructorAllocation[];
}

/* ========== COMPONENT ========== */
const ExportDemandsModal: React.FC<ExportDemandsModalProps> = ({
  isOpen,
  onClose,
  demands,
  companies,
  trainings,
  regions,
  instructors,
  instructorAllocations,
}) => {
  /* ---------- helpers ---------- */
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || companies.find(c => c.id === id)?.razaoSocial || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';

  const getInstructorName = (demand: Demand) => {
    // Primeiro tenta via instructorAllocations
    const allocs = instructorAllocations.filter(a => a.demandId === demand.id);
    if (allocs.length > 0) {
      const sorted = [...allocs].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
      const principal = instructors.find(i => i.id === sorted[0].instructorId);
      if (principal) return principal.name;
    }
    // Fallback para instructorId direto
    if (demand.instructorId) {
      const inst = instructors.find(i => i.id === demand.instructorId);
      if (inst) return inst.name;
    }
    return 'Não Alocado';
  };

  const getCalculatedStatus = (d: Demand) => calculateDemandStatus({
    startDate: d.startDate,
    endDate: d.endDate,
    instructorId: d.instructorId,
    cancelled: d.status === 'CANCELADA',
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-BR');
    } catch { return dateStr; }
  };

  /* ---------- state ---------- */
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    trainingId: '',
    instructorId: '',
    regionId: '',
    status: '',
    search: '',
    trainingLocal: '',
    corredor: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /* ---------- filtered list ---------- */
  const filteredDemands = useMemo(() => {
    const normalize = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return demands.filter(d => {
      if (d.status === 'CANCELADA' && !filters.status) return true; // mostrar canceladas se sem filtro de status

      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.trainingId && d.trainingId !== filters.trainingId) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;
      if (filters.trainingLocal && (d.trainingLocal || '') !== filters.trainingLocal) return false;
      if (filters.corredor && (d.corredor || '') !== filters.corredor) return false;

      if (filters.instructorId) {
        const allocs = instructorAllocations.filter(a => a.demandId === d.id);
        const hasInstructor = allocs.some(a => a.instructorId === filters.instructorId) || d.instructorId === filters.instructorId;
        if (!hasInstructor) return false;
      }

      if (filters.status) {
        const calcStatus = getCalculatedStatus(d);
        if (calcStatus !== filters.status) return false;
      }

      // ✅ Filtro por período: suporta dias específicos
      if (filters.startDate || filters.endDate) {
        if (!demandIntersectsRange(d, filters.startDate || undefined, filters.endDate || undefined)) return false;
      }

      if (filters.search) {
        const term = normalize(filters.search);
        const haystack = [
          d.id,
          d.clientDemandId || '',
          getCompanyName(d.companyId),
          getTrainingName(d.trainingId),
        ].map(normalize).join(' ');
        if (!haystack.includes(term)) return false;
      }

      return true;
    }).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }, [demands, filters, instructorAllocations]);

  /* ---------- selection helpers ---------- */
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDemands.length && filteredDemands.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDemands.map(d => d.id)));
    }
  };

  const resetFilters = () => {
    setFilters({ startDate: '', endDate: '', companyId: '', trainingId: '', instructorId: '', regionId: '', status: '', search: '', trainingLocal: '', corredor: '' });
    setSelectedIds(new Set());
  };

  /* ---------- EXPORT EXCEL ---------- */
  const handleExportExcel = async () => {
    const toExport = selectedIds.size > 0
      ? filteredDemands.filter(d => selectedIds.has(d.id))
      : filteredDemands;

    if (toExport.length === 0) return;

    // Import dinâmico: carregado somente ao exportar (bundle menor)
    const ExcelJSModule = await import('exceljs');
    const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Demandas');

    // Extrai HH:MM do datetime ISO (ex: "2026-02-12T18:30" → "18:30")
    const getHorario = (dateStr?: string): string => {
      if (!dateStr || !dateStr.includes('T')) return '—';
      return dateStr.split('T')[1]?.slice(0, 5) || '—';
    };

    // Demanda noturna = horário de início a partir das 18:00
    const isNocturnal = (dateStr?: string): boolean => {
      if (!dateStr || !dateStr.includes('T')) return false;
      const hour = parseInt((dateStr.split('T')[1] || '').split(':')[0], 10);
      return !isNaN(hour) && hour >= 18;
    };

    // Definição das colunas
    // Nova ordem: ID | ID Cliente | Empresa | Treinamento | Local do Treinamento | Região | Data Início | Horário | Data Fim | ...
    worksheet.columns = [
      { header: 'ID',                   key: 'id',               width: 14 },
      { header: 'ID Cliente',            key: 'clientDemandId',   width: 16 },
      { header: 'Empresa',               key: 'empresa',          width: 30 },
      { header: 'Treinamento',           key: 'treinamento',      width: 35 },
      { header: 'Local do Treinamento',  key: 'trainingLocal',    width: 28 },
      { header: 'Região',                key: 'regiao',           width: 18 },
      { header: 'Data Início',           key: 'dataInicio',       width: 14 },
      { header: 'Horário Início',          key: 'horarioInicio',    width: 10 },
      { header: 'Horário Fim',            key: 'horarioFim',       width: 10 },
      { header: 'Data Fim',              key: 'dataFim',          width: 14 },
      { header: 'Modo Datas',            key: 'modoDatas',        width: 18 },
      { header: 'Dias Específicos',      key: 'diasEspecificos',  width: 40 },
      { header: 'Instrutor Principal',   key: 'instrutor',        width: 25 },
      { header: 'Status',                key: 'status',           width: 16 },
      { header: 'Modalidade',            key: 'modalidade',       width: 16 },
      { header: 'Corredor',              key: 'corredor',         width: 18 },
      { header: 'Aprovador',             key: 'aprovador',              width: 20 },
      { header: 'Analista',              key: 'analista',               width: 18 },
      { header: 'Motivo do Cancelamento', key: 'motivoCancelamento',    width: 26 },
    ];

    // Estiliza o cabeçalho (linha 1): fundo escuro + texto branco + negrito
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    });

    // Adiciona as linhas de dados
    toExport.forEach(d => {
      const row = worksheet.addRow({
        id:              d.id || '',
        clientDemandId:  d.clientDemandId || '',
        empresa:         getCompanyName(d.companyId),
        treinamento:     getTrainingName(d.trainingId),
        trainingLocal:   d.trainingLocal || '',
        regiao:          getRegionName(d.regionId),
        dataInicio:      formatDate(d.startDate),
        horarioInicio:   getHorario(d.startDate),
        horarioFim:      getHorario(d.endDate),
        dataFim:         formatDate(d.endDate),
        modoDatas:       d.dateMode === 'DIAS_ESPECIFICOS' ? 'Dias Específicos' : 'Contínuo',
        diasEspecificos: d.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(d.specificDates)
                           ? d.specificDates.sort((a, b) => a.data.localeCompare(b.data)).map(e => `${e.data} ${e.horarioInicio}-${e.horarioFim}`).join(', ')
                           : '',
        instrutor:       getInstructorName(d),
        status:          getCalculatedStatus(d).replace('_', ' '),
        modalidade:      d.modality || '',
        corredor:        d.corredor || '',
        aprovador:            d.approver || '',
        analista:             d.analyst || '',
        motivoCancelamento:   d.status === 'CANCELADA' ? (d.cancelReason || '—') : '',
      });

      // Demandas noturnas (≥ 18:00): negrito + fundo laranja-claro em toda a linha
      if (isNocturnal(d.startDate)) {
        row.eachCell({ includeEmpty: true }, (cell: any) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
        });
      }
    });

    // AutoFilter cobrindo todas as colunas (19) e todas as linhas com dados
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: toExport.length + 1, column: 19 },
    };

    // Gera o arquivo e faz o download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `demandas_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* ---------- dropdown options (derivadas dos dados) ---------- */
  const companyOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.companyId))) as string[];
    return ids.map(id => ({ id, name: getCompanyName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, companies]);

  const trainingOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.trainingId))) as string[];
    return ids.map(id => ({ id, name: getTrainingName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, trainings]);

  const regionOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.regionId))) as string[];
    return ids.map(id => ({ id, name: getRegionName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, regions]);

  const instructorOptions = useMemo(() => {
    const ids = new Set<string>();
    demands.forEach(d => {
      if (d.instructorId) ids.add(d.instructorId);
      instructorAllocations.filter(a => a.demandId === d.id).forEach(a => ids.add(a.instructorId));
    });
    return [...ids].map(id => {
      const inst = instructors.find(i => i.id === id);
      return { id, name: inst?.name || 'N/A' };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, instructors, instructorAllocations]);

  const trainingLocalOptions = useMemo(() =>
    [...new Set(demands.map((d: Demand) => d.trainingLocal).filter((v: string | undefined): v is string => !!v && v !== 'N/A'))].sort(),
  [demands]);

  const corredorOptions = useMemo(() =>
    [...new Set(demands.map((d: Demand) => d.corredor).filter((v: string | undefined): v is string => !!v))].sort(),
  [demands]);

  /* ---------- render ---------- */
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const exportCount = selectedIds.size > 0 ? selectedIds.size : filteredDemands.length;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh] border border-white/20">

        {/* ===== HEADER ===== */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Exportação de Demandas</h2>
            <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Selecione as demandas para exportar em Excel (.xlsx)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-2xl transition shadow-sm"><X size={28} /></button>
        </div>

        {/* ===== BODY ===== */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

          {/* ----- FILTROS (esquerda) ----- */}
          <div className="w-full lg:w-80 p-8 border-r border-slate-100 space-y-6 overflow-y-auto bg-slate-50/30">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Filter size={14} /> Filtros de Refinamento
            </h3>

            <div className="space-y-4">
              {/* Período */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Período</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} />
                  <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} />
                </div>
              </div>

              {/* Empresa / Cliente */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Cliente</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.companyId} onChange={e => setFilters({ ...filters, companyId: e.target.value })}>
                  <option value="">Todos</option>
                  {companyOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Treinamento */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Treinamento</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingId} onChange={e => setFilters({ ...filters, trainingId: e.target.value })}>
                  <option value="">Todos</option>
                  {trainingOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* Instrutor */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Instrutor</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.instructorId} onChange={e => setFilters({ ...filters, instructorId: e.target.value })}>
                  <option value="">Todos</option>
                  {instructorOptions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              {/* Região */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Região</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.regionId} onChange={e => setFilters({ ...filters, regionId: e.target.value })}>
                  <option value="">Todas</option>
                  {regionOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {/* Local de Treinamento */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Local de Treinamento</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingLocal} onChange={e => setFilters({ ...filters, trainingLocal: e.target.value })}>
                  <option value="">Todos</option>
                  {trainingLocalOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Corredor */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Corredor</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.corredor} onChange={e => setFilters({ ...filters, corredor: e.target.value })}>
                  <option value="">Todos</option>
                  {corredorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Status</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="NOVA">Nova</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="ALOCADA">Alocada</option>
                  <option value="EM_ANDAMENTO">Em Andamento</option>
                  <option value="CONCLUIDA">Concluída</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
              </div>

              {/* Busca por ID / Palavra-chave */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Buscar ID / Palavra-chave</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input
                    type="text"
                    placeholder="DEM-xx, empresa, treinamento..."
                    className="w-full border border-slate-200 rounded-xl p-2.5 pl-9 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white"
                    value={filters.search}
                    onChange={e => setFilters({ ...filters, search: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Resetar */}
            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={resetFilters}
                className="w-full py-2.5 text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition tracking-widest"
              >
                Resetar Filtros
              </button>
            </div>
          </div>

          {/* ----- LISTA (direita) ----- */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* Topo: selecionar todas */}
            <div className="p-4 border-b border-slate-50 flex items-center justify-between">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 px-4 py-2 rounded-xl transition"
              >
                {selectedIds.size === filteredDemands.length && filteredDemands.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                Selecionar Todas ({filteredDemands.length})
              </button>
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                {selectedIds.size} de {filteredDemands.length} marcadas
              </span>
            </div>

            {/* Lista scrollável */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredDemands.length === 0 && (
                <div className="text-center py-16 text-slate-300 text-sm font-bold">Nenhuma demanda encontrada com os filtros aplicados.</div>
              )}
              {filteredDemands.map(d => {
                const isSelected = selectedIds.has(d.id);
                const calcStatus = getCalculatedStatus(d);

                return (
                  <div
                    key={d.id}
                    onClick={() => toggleSelection(d.id)}
                    className={`p-4 rounded-[1.5rem] border-2 transition-all cursor-pointer group flex items-center gap-4
                      ${isSelected ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-slate-50 hover:border-slate-100'}`}
                  >
                    {/* Checkbox */}
                    <div className={`transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-200 group-hover:text-slate-300'}`}>
                      {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Título + ID + Empresa + Status */}
                      <div className="md:col-span-5">
                        <h4 className="text-sm font-black text-slate-800 truncate" title={getTrainingName(d.trainingId)}>{getTrainingName(d.trainingId)}</h4>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[10px] font-bold text-blue-600 font-mono tracking-tighter">#{d.id}</span>
                          {d.clientDemandId && <span className="text-[10px] font-bold text-slate-400 font-mono">({d.clientDemandId})</span>}
                          <span className="text-[10px] font-bold text-slate-400 uppercase truncate" title={getCompanyName(d.companyId)}>{getCompanyName(d.companyId)}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded shadow-sm ${STATUS_STYLING[calcStatus] || 'bg-slate-200'}`}>
                            {calcStatus.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Data */}
                      <div className="md:col-span-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                          <Calendar size={12} /> {formatDate(d.startDate)}
                        </div>
                      </div>

                      {/* Região + Instrutor */}
                      <div className="md:col-span-4 flex flex-col items-end gap-1">
                        <span className="text-[10px] font-bold text-slate-400">{getRegionName(d.regionId)}</span>
                        <span className="text-[10px] font-bold text-slate-500">{getInstructorName(d)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="p-8 bg-slate-900 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Selecionadas</span>
              <span className="text-xl font-black text-white">{selectedIds.size > 0 ? selectedIds.size : filteredDemands.length} Demandas</span>
            </div>
            <div className="h-8 w-px bg-white/10 hidden md:block"></div>
            {selectedIds.size === 0 && filteredDemands.length > 0 && (
              <span className="text-[10px] font-bold text-slate-500 uppercase">Exportará todas as {filteredDemands.length} filtradas</span>
            )}
          </div>

          <div className="flex items-center gap-8 w-full md:w-auto">
            <button
              onClick={handleExportExcel}
              disabled={filteredDemands.length === 0}
              className={`px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-3 transition-all active:scale-95 shadow-2xl
                ${filteredDemands.length > 0 ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              <FileDown size={20} /> Baixar Excel
            </button>
          </div>
        </div>

      </div>
    </div>
  , document.body);
};

export default ExportDemandsModal;
