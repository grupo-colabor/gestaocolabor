
import React, { useState, useMemo } from 'react';
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
import { EvidenceData } from '../types';
import EvidenceDetails from './EvidenceDetails';

const Evidences: React.FC = () => {
  const { demands, companies, trainings, evidenceStore, updateEvidence } = useApp();


  // Estado para os filtros
  const [filterId, setFilterId] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Estado para gerenciar qual demanda está sendo visualizada (null = lista)
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
  

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

  // Filtrar demandas com base nos inputs e status (não canceladas)
  const activeDemands = useMemo(() => {
    return demands
      .filter(d => d.status !== 'CANCELADA')
      .filter(d => {
        // Filtro por ID
        const matchesId = !filterId || d.id.toLowerCase().includes(filterId.toLowerCase());
        if (!matchesId) return false;

        // Filtro por Período (Interseção)
        // Regra: demand.startDate <= filterEndDate AND demand.endDate >= filterStartDate
        const dStart = d.startDate.split('T')[0];
        const dEnd = d.endDate.split('T')[0];

        if (startDateFilter && dEnd < startDateFilter) return false;
        if (endDateFilter && dStart > endDateFilter) return false;

        return true;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [demands, filterId, startDateFilter, endDateFilter]);

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
          
          <div className="flex flex-col md:flex-row items-center gap-4 w-full lg:justify-end">
            {/* Filtro por ID */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-2.5 text-slate-300" size={16} />
              <input 
                type="text" 
                placeholder="Buscar por ID da demanda" 
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                value={filterId}
                onChange={(e) => setFilterId(e.target.value)}
              />
            </div>

            {/* Filtros de Data */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-40">
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
              <div className="relative flex-1 md:w-40">
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
              {activeDemands.length > 0 ? activeDemands.map(demand => {
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
        </div>
      </div>
    </div>
  );
};

export default Evidences;
