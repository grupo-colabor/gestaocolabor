
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../App';
import { 
  FileSearch, 
  Building2, 
  GraduationCap, 
  MapPin, 
  Calendar as CalendarIcon,
  ExternalLink,
  Search,
  LayoutGrid,
  CheckCircle2,
  Clock,
  Calendar
} from 'lucide-react';
import { calculateDemandStatus } from '../domain/demandStatus';
import { Demand, EvidenceData } from '../types';
import EvidenceDetails from './EvidenceDetails';
import { usePagination } from '../hooks/usePagination';
import Pagination from './Pagination';

const Evidences: React.FC = () => {
  const {
    demands, companies, trainings, instructors, instructorAllocations, evidenceStore, updateEvidence,
    notificationTarget, setNotificationTarget,
  } = useApp();

  // Estado para os filtros
  const [filterId, setFilterId] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState('');
  const [filterTrainingId, setFilterTrainingId] = useState('');
  const [filterInstructorId, setFilterInstructorId] = useState('');
  const [filterLocal, setFilterLocal] = useState('');

  // Estado para gerenciar qual demanda está sendo visualizada (null = lista)
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);

  // Navegação a partir de Notificações
  useEffect(() => {
    if (notificationTarget?.view === 'evidences') {
      setFilterId(notificationTarget.demandId);
      setNotificationTarget(null);
    }
  }, [notificationTarget]);
  

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '---';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('pt-BR');
  };

  const statusColor = (status: string) => {
    switch(status) {
      case 'NOVA': return 'bg-purple-100 text-purple-800';
      case 'PENDENTE': return 'bg-orange-100 text-orange-800';
      case 'ALOCADA': return 'bg-blue-100 text-blue-800';
      case 'EM_ANDAMENTO': return 'bg-emerald-100 text-emerald-800';
      case 'CONCLUIDA': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Lógica de Status Automático de Evidências
const getEvidenceAutoStatus = (
  demandId: string
): 'COMPLETA' | 'PENDENTE' | 'AGUARDANDO' => {
  const demand = demands.find(d => d.id === demandId);
  if (!demand) return 'AGUARDANDO';

  // 🔒 Evidência só vira pendência após o treinamento CONCLUÍDO
  const trainingStatus = calculateDemandStatus({
    startDate: demand.startDate,
    endDate: demand.endDate,
    instructorId: demand.instructorId,
    cancelled: demand.status === 'CANCELADA'
  });

  if (trainingStatus !== 'CONCLUIDA') {
    return 'AGUARDANDO';
  }

  const data = evidenceStore[demandId];
  if (!data) return 'PENDENTE';

  const training = trainings.find(t => t.id === demand.trainingId);
  const modality = String(training?.modality ?? '').toUpperCase();

  const isOnline = modality === 'ONLINE';
  // HÍBRIDO e PRESENCIAL exigem fotos

  const hasAttendance = (data.attendanceList || []).length > 0;
  const hasCertificates = (data.certificates || []).length > 0;
  const hasPhotos = (data.photos || []).length > 0;

  const isComplete = isOnline
    ? hasAttendance && hasCertificates
    : hasAttendance && hasCertificates && hasPhotos;

  return isComplete ? 'COMPLETA' : 'PENDENTE';
};

  // Opções derivadas dos dados para os dropdowns
  const companyOptions = useMemo(() => {
    const ids = Array.from(new Set<string>(demands.filter((d: Demand) => d.status !== 'CANCELADA').map((d: Demand) => d.companyId)));
    return ids.map((id: string) => ({ id, name: getCompanyName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, companies]);

  const trainingOptions = useMemo(() => {
    const ids = Array.from(new Set<string>(demands.filter((d: Demand) => d.status !== 'CANCELADA').map((d: Demand) => d.trainingId)));
    return ids.map((id: string) => ({ id, name: getTrainingName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, trainings]);

  const instructorOptions = useMemo(() => {
    const ids = new Set<string>();
    demands.filter((d: Demand) => d.status !== 'CANCELADA').forEach((d: Demand) => {
      if (d.instructorId) ids.add(d.instructorId);
      instructorAllocations.filter((a: { demandId: string; instructorId: string }) => a.demandId === d.id).forEach((a: { instructorId: string }) => ids.add(a.instructorId));
    });
    return [...ids].map((id: string) => {
      const inst = instructors.find((i: { id: string; name: string }) => i.id === id);
      return { id, name: inst?.name || 'N/A' };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, instructors, instructorAllocations]);

  const localOptions = useMemo(() =>
    [...new Set<string>(demands.filter((d: Demand) => d.status !== 'CANCELADA').map((d: Demand) => d.trainingLocal as string).filter((v: string) => !!v && v !== 'N/A'))].sort(),
  [demands]);

  // Filtrar demandas com base nos inputs e status (não canceladas)
  const activeDemands = useMemo(() => {
    return demands
      .filter(d => d.status !== 'CANCELADA')
      .filter(d => {
        // Filtro por ID
        const matchesId = !filterId || d.id.toLowerCase().includes(filterId.toLowerCase());
        if (!matchesId) return false;

        // Filtro por Período (Interseção)
        const dStart = d.startDate.split('T')[0];
        const dEnd = d.endDate.split('T')[0];
        if (startDateFilter && dEnd < startDateFilter) return false;
        if (endDateFilter && dStart > endDateFilter) return false;

        // Novos filtros
        if (filterCompanyId && d.companyId !== filterCompanyId) return false;
        if (filterTrainingId && d.trainingId !== filterTrainingId) return false;
        if (filterLocal && (d.trainingLocal || '') !== filterLocal) return false;

        if (filterInstructorId) {
          const allocs = instructorAllocations.filter(a => a.demandId === d.id);
          const hasInstructor = allocs.some(a => a.instructorId === filterInstructorId) || d.instructorId === filterInstructorId;
          if (!hasInstructor) return false;
        }

        return true;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [demands, filterId, startDateFilter, endDateFilter, filterCompanyId, filterTrainingId, filterInstructorId, filterLocal, instructorAllocations]);

  const {
    currentPage: evidPage,
    totalPages: evidTotalPages,
    itemsPerPage: evidItemsPerPage,
    paginatedItems: paginatedActiveDemands,
    startIdx: evidStartIdx,
    setCurrentPage: setEvidPage,
    handleItemsPerPageChange: handleEvidItemsPerPage,
  } = usePagination<Demand>(activeDemands, 'pagination:evidences');

  const handleOpenDetails = async (id: string) => {
  // Inicializar dados se não existirem no store global
  if (!evidenceStore[id]) {
    await updateEvidence(id, {
      demandId: id,
      attendanceList: [],
      certificates: [],
      photos: [],
      notes: ''
    });
  }
  setSelectedDemandId(id);
};


  const handleUpdateEvidence = async (updated: EvidenceData) => {
  await updateEvidence(updated.demandId, updated);
};


  // Se uma demanda estiver selecionada, renderiza o componente de detalhes
  if (selectedDemandId) {
    const demand = demands.find(d => d.id === selectedDemandId)!;
    const company = companies.find(c => c.id === demand.companyId)!;
    const training = trainings.find(t => t.id === demand.trainingId)!;
    const evidenceData = evidenceStore[selectedDemandId];

    return (
      <EvidenceDetails 
        demand={demand}
        company={company}
        training={training}
        data={evidenceData}
        onBack={() => setSelectedDemandId(null)}
        onUpdate={handleUpdateEvidence}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Evidências</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Repositório de Documentação de Treinamentos</p>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex flex-col lg:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4 shrink-0">
             <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
               <LayoutGrid size={16} /> Painel de Documentação
             </h3>
          </div>
          
          <div className="flex flex-col gap-3 w-full lg:w-auto">
            {/* Linha 1: ID + Período */}
            <div className="flex flex-col md:flex-row items-center gap-3 w-full lg:justify-end">
              <div className="relative w-full md:w-56">
                <Search className="absolute left-3 top-2.5 text-slate-300" size={16} />
                <input
                  type="text"
                  placeholder="Buscar por ID da demanda"
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                  value={filterId}
                  onChange={(e) => setFilterId(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-36">
                  <Calendar className="absolute left-3 top-2.5 text-slate-300" size={14} />
                  <input
                    type="date"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    title="Data Inicial"
                  />
                </div>
                <span className="text-slate-300 font-bold">-</span>
                <div className="relative flex-1 md:w-36">
                  <Calendar className="absolute left-3 top-2.5 text-slate-300" size={14} />
                  <input
                    type="date"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    title="Data Final"
                  />
                </div>
              </div>
            </div>

            {/* Linha 2: Empresa, Treinamento, Instrutor, Local + Limpar */}
            <div className="flex flex-col md:flex-row items-center gap-3 w-full lg:justify-end">
              <select
                className="w-full md:w-44 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
                value={filterCompanyId}
                onChange={(e) => setFilterCompanyId(e.target.value)}
              >
                <option value="">Empresa</option>
                {companyOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <select
                className="w-full md:w-56 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
                value={filterTrainingId}
                onChange={(e) => setFilterTrainingId(e.target.value)}
              >
                <option value="">Treinamento</option>
                {trainingOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              <select
                className="w-full md:w-44 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
                value={filterInstructorId}
                onChange={(e) => setFilterInstructorId(e.target.value)}
              >
                <option value="">Instrutor</option>
                {instructorOptions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>

              <select
                className="w-full md:w-44 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
                value={filterLocal}
                onChange={(e) => setFilterLocal(e.target.value)}
              >
                <option value="">Local</option>
                {localOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>

              {(filterId || startDateFilter || endDateFilter || filterCompanyId || filterTrainingId || filterInstructorId || filterLocal) && (
                <button
                  onClick={() => { setFilterId(''); setStartDateFilter(''); setEndDateFilter(''); setFilterCompanyId(''); setFilterTrainingId(''); setFilterInstructorId(''); setFilterLocal(''); }}
                  className="shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-600 transition whitespace-nowrap px-3 py-2"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-black text-slate-500">
                <th className="p-6">ID Demanda</th>
                <th className="p-6">Empresa</th>
                <th className="p-6">Treinamento</th>
                <th className="p-6 text-center">Período</th>
                <th className="p-6 text-center">Status Trein.</th>
                <th className="p-6 text-center">Status Evidência</th>
                <th className="p-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {activeDemands.length > 0 ? paginatedActiveDemands.map(demand => {
                const currentStatus = calculateDemandStatus({
                startDate: demand.startDate,
                endDate: demand.endDate,
                instructorId: demand.instructorId,
                cancelled: demand.status === 'CANCELADA'
              });

              // ✅ Só calcula evidência depois que o treinamento concluir
              const evidStatus = currentStatus === 'CONCLUIDA'
                ? getEvidenceAutoStatus(demand.id)
                : 'AGUARDANDO';

                return (
                  <tr key={demand.id} className="hover:bg-slate-50/30 transition-colors text-xs text-slate-600">
                    <td className="p-6">
                      <span className="font-mono text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded-lg">#{demand.id}</span>
                    </td>
                    <td className="p-6">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-slate-300" />
                        <span className="font-bold text-slate-700">{getCompanyName(demand.companyId)}</span>
                      </div>
                    </td>
                    <td className="p-6 max-w-xs">
                      <div className="flex items-start gap-2">
                        <GraduationCap size={14} className="text-slate-300 mt-0.5 shrink-0" />
                        <span className="font-medium text-slate-600 leading-relaxed">{getTrainingName(demand.trainingId)}</span>
                      </div>
                    </td>
                    <td className="p-6 text-center whitespace-nowrap">
                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
                        {formatDateTime(demand.startDate)} <span className="text-slate-400 mx-1">→</span> {formatDateTime(demand.endDate)}
                      </span>
                    </td>
                    <td className="p-6 text-center">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${statusColor(currentStatus)} whitespace-nowrap`}>
                        {currentStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-6 text-center">
                      <div className="flex justify-center">
                        {evidStatus === 'AGUARDANDO' ? (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 text-slate-500 rounded-full border border-slate-200">
                            <Clock size={12} />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              Aguardando conclusão
                            </span>
                          </div>
                        ) : evidStatus === 'COMPLETA' ? (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 animate-fade-in">
                            <CheckCircle2 size={12} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Completa</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                            <Clock size={12} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Pendente</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-6 text-right">
                      <button 
                        className="px-4 py-2 bg-slate-900 hover:bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 ml-auto shadow-sm"
                        onClick={() => handleOpenDetails(demand.id)}
                      >
                        <ExternalLink size={14} /> Visualizar
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} className="p-20 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-4">
                      <FileSearch size={48} className="opacity-10" />
                      <p className="font-bold text-sm italic uppercase tracking-widest">Nenhuma demanda correspondente encontrada.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            currentPage={evidPage}
            totalPages={evidTotalPages}
            totalItems={activeDemands.length}
            itemsPerPage={evidItemsPerPage}
            startIdx={evidStartIdx}
            entityLabel="demandas"
            onPageChange={setEvidPage}
            onItemsPerPageChange={handleEvidItemsPerPage}
          />
        </div>
      </div>
    </div>
  );
};

export default Evidences;
