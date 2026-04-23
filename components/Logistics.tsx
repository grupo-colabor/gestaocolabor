import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App';
import { logAction } from '../services/auditLog';
import { Instructor, LogisticAllocation } from '../types';
import { 
  Briefcase, 
  ChevronRight, 
  MapPin, 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  ArrowRight,
  UserCheck,
  Building,
  Target,
  Search,
  Globe,
  Truck,
  Info,
  X,
  AlertTriangle
} from 'lucide-react';

const Logistics: React.FC = () => {
  const {
    demands,
    companies,
    trainings,
    regions,
    instructors,
    resourceAllocations,
    hasScheduleConflict,
    hasResourceConflict,
    recommendInstructors,
    allocateInstructor,
    addResourceAllocation,
    removeResourceAllocation,
    companionAllocations,
    addCompanionAllocation,
    removeCompanionAllocation,
    updateDemand,
    setHybridPracticePeriod,
    setNotification,
    setCalendarDrawerDemandId,
    setCurrentView,
  } = useApp();

  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  // Modal de Alocação de CTM
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [resourceForm, setResourceForm] = useState({
    startDate: '',
    endDate: '',
    startTime: '08:00',
    endTime: '18:00'
  });
  
  const [isCompanionPickerOpen, setIsCompanionPickerOpen] = useState(false);

  // Modal de confirmação para alocar instrutor já alocado no dia
  const [pendingForceAlloc, setPendingForceAlloc] = useState<(Instructor & { score: number }) | null>(null);
 
  // Modal de datas do acompanhante (dias avulsos)
  const [isCompanionDatesOpen, setIsCompanionDatesOpen] = useState(false);
  const [pendingCompanionInstructorId, setPendingCompanionInstructorId] = useState<string | null>(null);

  // Body scroll lock when any modal is open
  useEffect(() => {
    const anyOpen = isCompanionDatesOpen || isCompanionPickerOpen || isResourceModalOpen || !!pendingForceAlloc;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isCompanionDatesOpen, isCompanionPickerOpen, isResourceModalOpen, pendingForceAlloc]);
  const [companionSelectedDays, setCompanionSelectedDays] = useState<string[]>([]);
  const [companionDayInput, setCompanionDayInput] = useState('');

  // HÍBRIDO (MVP) — formulário do período presencial (prática)
  const [hybridPracticeForm, setHybridPracticeForm] = useState({
    practiceStartDate: '',
    practiceEndDate: '',
    practiceStartTime: '08:00',
    practiceEndTime: '18:00'
  });

  const selectedDemand = useMemo(() => 
    demands.find(d => d.id === selectedDemandId), 
  [demands, selectedDemandId]);

  // Helpers de data/hora (compatível com strings "YYYY-MM-DD" e "YYYY-MM-DDTHH:mm")
  const splitDateTime = (value?: string) => {
    const v = value || '';
    if (!v) return { date: '', time: '' };
    const parts = v.split('T');
    const date = parts[0] || '';
    const time = (parts[1] || '').slice(0, 5); // HH:mm
    return { date, time };
  };

  const toDateOnly = (value?: string) => splitDateTime(value).date;

  const buildDateTime = (date: string, time: string, fallbackTime: string) => {
    if (!date) return '';
    const t = (time || fallbackTime || '08:00').slice(0, 5);
    return `${date}T${t}`;
  };

  const formatDateBR = (value?: string) => {
    const d = toDateOnly(value);
    if (!d) return '';
    return new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');
  };

  const formatTimeHHmm = (value?: string) => {
    const { time } = splitDateTime(value);
    return time || '';
  };

  const companionsForSelectedDemand = useMemo(() => {
  if (!selectedDemandId) return [];
  return companionAllocations.filter((a: any) => a.demandId === selectedDemandId);
}, [companionAllocations, selectedDemandId]);

const handleAddCompanion = (companionInstructorId: string) => {
  if (!selectedDemand) return;

  // evita duplicar
  const already = companionsForSelectedDemand.some((a: any) => a.instructorId === companionInstructorId);
  if (already) {
    setNotification({ type: 'error', message: 'Este instrutor já está como acompanhante nesta demanda.' });
    return;
  }

  // Conflito de agenda do acompanhante no período da demanda
  if (hasScheduleConflict(companionInstructorId, selectedDemand.startDate, selectedDemand.endDate, selectedDemand.id)) {
    setNotification({ type: 'error', message: 'Não é possível alocar: o acompanhante já possui conflito na agenda.' });
    return;
  }

  addCompanionAllocation({
    id: `CA-${Date.now()}`,
    demandId: selectedDemand.id,
    instructorId: companionInstructorId,
    startDate: selectedDemand.startDate,
    endDate: selectedDemand.endDate
  });

  setNotification({ type: 'success', message: 'Acompanhante alocado com sucesso.' });
  setIsCompanionPickerOpen(false);
};

const handleRemoveCompanion = (allocationId: string) => {
  removeCompanionAllocation(allocationId);
  logAction({
    modulo: 'Programação',
    acao: 'Cancelar',
    descricao: [
      `Acompanhante removido`,
      selectedDemand ? `Empresa: ${getCompanyName(selectedDemand.companyId)}` : null,
      selectedDemand ? `Treinamento: ${getTrainingName(selectedDemand.trainingId)}` : null,
      `Alocação ID: ${allocationId}`,
    ].filter(Boolean).join(' | '),
    dadosAntes: { allocationId },
    dadosDepois: { demandId: selectedDemand?.id },
  });
  setNotification({ type: 'success', message: 'Acompanhante removido.' });
};

const openCompanionDatesModal = (instructorId: string) => {
  if (!selectedDemand) return;

  setPendingCompanionInstructorId(instructorId);
  setCompanionSelectedDays([]); // começa vazio (dias avulsos)
  setCompanionDayInput('');
  setIsCompanionDatesOpen(true);
};

const closeCompanionDatesModal = () => {
  setIsCompanionDatesOpen(false);
  setPendingCompanionInstructorId(null);
  setCompanionSelectedDays([]);
  setCompanionDayInput('');
};

const addCompanionDay = (day: string) => {
  if (!day) return;
  setCompanionSelectedDays(prev => (prev.includes(day) ? prev : [...prev, day].sort()));
  setCompanionDayInput('');
};

const removeCompanionDay = (day: string) => {
  setCompanionSelectedDays(prev => prev.filter(d => d !== day));
};

const handleSaveCompanionDays = () => {
  if (!selectedDemand) return;
  if (!pendingCompanionInstructorId) return;

  // evita duplicar instrutor acompanhante (regra atual)
  const already = companionsForSelectedDemand.some((a: any) => a.instructorId === pendingCompanionInstructorId);
  if (already) {
    setNotification({ type: 'error', message: 'Este instrutor já está como acompanhante nesta demanda.' });
    return;
  }

  if (companionSelectedDays.length === 0) {
    setNotification({ type: 'error', message: 'Selecione pelo menos 1 dia para o acompanhante.' });
    return;
  }

  // horários padrão (usa o que existir na demanda; senão 08/18)
  const demandStart = splitDateTime(selectedDemand.startDate);
  const demandEnd = splitDateTime(selectedDemand.endDate);
  const startTime = demandStart.time || '08:00';
  const endTime = demandEnd.time || '18:00';

  // valida conflito dia a dia e cria 1 allocation por dia
  for (const day of companionSelectedDays) {
    const startDateTime = buildDateTime(day, startTime, '08:00');
    const endDateTime = buildDateTime(day, endTime, '18:00');

    if (hasScheduleConflict(pendingCompanionInstructorId, startDateTime, endDateTime, selectedDemand.id)) {
      setNotification({
        type: 'error',
        message: `Conflito na agenda do acompanhante no dia ${formatDateBR(day)}.`
      });
      return;
    }
  }

  companionSelectedDays.forEach(day => {
    const startDateTime = buildDateTime(day, startTime, '08:00');
    const endDateTime = buildDateTime(day, endTime, '18:00');

    addCompanionAllocation({
      id: `CA-${Date.now()}-${day}`,
      demandId: selectedDemand.id,
      instructorId: pendingCompanionInstructorId,
      startDate: startDateTime,
      endDate: endDateTime
    });
  });

  logAction({
    modulo: 'Programação',
    acao: 'Confirmar',
    descricao: [
      `Acompanhante adicionado`,
      selectedDemand ? `Empresa: ${getCompanyName(selectedDemand.companyId)}` : null,
      selectedDemand ? `Treinamento: ${getTrainingName(selectedDemand.trainingId)}` : null,
      `Instrutor: ${instructors.find((i: any) => i.id === pendingCompanionInstructorId)?.name || pendingCompanionInstructorId}`,
      `Dias: ${companionSelectedDays.join(', ')}`,
    ].filter(Boolean).join(' | '),
    dadosDepois: { demandId: selectedDemand?.id, instructorId: pendingCompanionInstructorId, days: companionSelectedDays },
  });
  setNotification({ type: 'success', message: 'Dias do acompanhante salvos com sucesso.' });
  closeCompanionDatesModal();
};


  // Sincroniza o form quando muda a demanda selecionada
  useEffect(() => {
    if (!selectedDemand) return;

    const ps = splitDateTime(selectedDemand.practiceStartDate);
    const pe = splitDateTime(selectedDemand.practiceEndDate);

    setHybridPracticeForm(prev => ({
      ...prev,
      practiceStartDate: ps.date,
      practiceEndDate: pe.date,
      practiceStartTime: ps.time || prev.practiceStartTime || '08:00',
      practiceEndTime: pe.time || prev.practiceEndTime || '18:00'
    }));
  }, [selectedDemandId, selectedDemand]);

  // Demandas Não Alocadas
  const unallocatedDemands = useMemo(() => {
    return demands.filter(d => 
      d.status !== 'CANCELADA' && 
      !d.instructorId &&
      d.modality?.toString().toUpperCase() !== 'ONLINE' &&
      d.trainingLocal !== 'N/A'
    ).sort((a, b) => a.startDate.localeCompare(b.startDate))
    .filter(d => {
      if (filterText) {
        const company = companies.find(c => c.id === d.companyId)?.name || '';
        const training = trainings.find(t => t.id === d.trainingId)?.name || '';
        return company.toLowerCase().includes(filterText.toLowerCase()) || 
               training.toLowerCase().includes(filterText.toLowerCase()) ||
               d.id.toLowerCase().includes(filterText.toLowerCase());
      }
      return true;
    });
  }, [demands, filterText, companies, trainings]);

  // Alocação de Recurso para a demanda selecionada
  const currentResourceAllocation = useMemo(() => {
    if (!selectedDemandId) return null;
    return resourceAllocations.find(a => a.demandId === selectedDemandId && a.resourceType === 'CENTRO_TREINAMENTO_MOVEL');
  }, [resourceAllocations, selectedDemandId]);

  const recommendation = useMemo(() => {
    if (!selectedDemand) return { suggested: [], exceptions: [], alreadyAllocated: [] };
    return recommendInstructors(selectedDemand);
  }, [selectedDemand, recommendInstructors]);

  // Helpers
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'Empresa N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'Treinamento N/A';
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'Região N/A';

  const isUrgent = (dateStr: string) => {
    const today = new Date();
    const start = new Date(dateStr);
    const diffDays = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  };

  const handleAllocate = (instructor: Instructor) => {
    if (!selectedDemandId || !selectedDemand) return;

    // MVP segurança: demanda híbrida precisa do período de prática definido
    if (selectedDemand.modality === 'HIBRIDO') {
      const hasPractice = !!selectedDemand.practiceStartDate && !!selectedDemand.practiceEndDate;
      if (!hasPractice) {
        alert('Para demandas HÍBRIDAS, defina primeiro o período presencial (prática) antes de alocar o instrutor.');
        return;
      }
    }

    // Lógica unificada para alocação
    const demandState = (selectedDemand.demandState || '').trim().toUpperCase();
    const isException = !!demandState && (instructor.residenceLocation || '').trim().toUpperCase() !== demandState;
    if (isException) {
      alert("Este instrutor não reside no estado da demanda. Alocação por exceção.");
    }

    const success = allocateInstructor(selectedDemandId, instructor.id);
    if (success) {
      logAction({
        modulo: 'Programação',
        acao: 'Criar',
        descricao: [
          `Instrutor alocado`,
          `Empresa: ${getCompanyName(selectedDemand.companyId)}`,
          `Treinamento: ${getTrainingName(selectedDemand.trainingId)}`,
          `Instrutor: ${instructor.name}`,
        ].join(' | '),
        dadosDepois: { demandId: selectedDemandId, instructorId: instructor.id, instructorName: instructor.name },
      });
      setSelectedDemandId(null);
    }
  };

  const handleAllocateAnyway = (instructor: Instructor & { score: number }) => {
    setPendingForceAlloc(instructor);
  };

  const handleConfirmForceAlloc = () => {
    if (!pendingForceAlloc) return;
    const allocatedInstructor = pendingForceAlloc;
    handleAllocate(allocatedInstructor);
    logAction({
      modulo: 'Programação',
      acao: 'Confirmar',
      descricao: [
        `Alocação forçada confirmada`,
        selectedDemand ? `Empresa: ${getCompanyName(selectedDemand.companyId)}` : null,
        selectedDemand ? `Treinamento: ${getTrainingName(selectedDemand.trainingId)}` : null,
        `Instrutor: ${(allocatedInstructor as any).name || (allocatedInstructor as any).id || ''}`,
      ].filter(Boolean).join(' | '),
      dadosDepois: { demandId: selectedDemand?.id, instructorId: (allocatedInstructor as any).id },
    });
    setPendingForceAlloc(null);
  };

  const handleOpenResourceModal = () => {
    if (!selectedDemand) return;

    const demandStartDateOnly = toDateOnly(selectedDemand.startDate) || selectedDemand.startDate.split('T')[0];
    const demandEndDateOnly = toDateOnly(selectedDemand.endDate) || selectedDemand.endDate.split('T')[0];

    setResourceForm(prev => ({
      ...prev,
      startDate: demandStartDateOnly,
      endDate: demandEndDateOnly,
      startTime: prev.startTime || '08:00',
      endTime: prev.endTime || '18:00'
    }));
    setIsResourceModalOpen(true);
  };

  const handleAddResourceAllocation = () => {
    if (!selectedDemand || !resourceForm.startDate || !resourceForm.endDate) return;

    // Normalização para comparação inclusiva (por dia)
    const normalizeStart = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T00:00:00');
    const normalizeEnd = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T23:59:59');

    const allocStartLimit = normalizeStart(resourceForm.startDate);
    const allocEndLimit = normalizeEnd(resourceForm.endDate);

    const demandStartLimit = normalizeStart(selectedDemand.startDate);
    const demandEndLimit = normalizeEnd(selectedDemand.endDate);

    if (allocStartLimit < demandStartLimit || allocEndLimit > demandEndLimit) {
      alert("O período do CTM deve estar dentro do período da demanda.");
      return;
    }

    // Conflito por dia (mantém regra anterior)
    if (hasResourceConflict(resourceForm.startDate, resourceForm.endDate, selectedDemand.id)) {
      alert("O Centro de Treinamento Móvel já possui um compromisso neste período.");
      return;
    }

    // Salva com data+hora
    const startDateTime = buildDateTime(resourceForm.startDate, resourceForm.startTime, '08:00');
    const endDateTime = buildDateTime(resourceForm.endDate, resourceForm.endTime, '18:00');

    const newAllocation: LogisticAllocation = {
      id: `RES-${Date.now()}`,
      demandId: selectedDemand.id,
      resourceType: 'CENTRO_TREINAMENTO_MOVEL',
      startDate: startDateTime,
      endDate: endDateTime
    };

    addResourceAllocation(newAllocation);
    logAction({
      modulo: 'Programação',
      acao: 'Criar',
      descricao: [
        `CTM alocado`,
        `Empresa: ${getCompanyName(selectedDemand.companyId)}`,
        `Treinamento: ${getTrainingName(selectedDemand.trainingId)}`,
        `Período: ${startDateTime.slice(0, 10)} a ${endDateTime.slice(0, 10)}`,
      ].join(' | '),
      dadosDepois: newAllocation,
    });
    setIsResourceModalOpen(false);
  };

  const handleSaveHybridPractice = () => {
    if (!selectedDemand) return;
    if (selectedDemand.modality !== 'HIBRIDO') return;

    if (!hybridPracticeForm.practiceStartDate || !hybridPracticeForm.practiceEndDate) return;

    // Salva com data+hora
    const practiceStartDateTime = buildDateTime(
      hybridPracticeForm.practiceStartDate,
      hybridPracticeForm.practiceStartTime,
      '08:00'
    );

    const practiceEndDateTime = buildDateTime(
      hybridPracticeForm.practiceEndDate,
      hybridPracticeForm.practiceEndTime,
      '18:00'
    );

    // Mantém a função existente (caso tenha validações internas)
    // e também garante atualização do objeto demanda com datetime.
    const ok = setHybridPracticePeriod(
      selectedDemand.id,
      practiceStartDateTime,
      practiceEndDateTime
    );

    // Backup seguro: caso setHybridPracticePeriod não persista o datetime,
    // garantimos via updateDemand (não muda layout nem regras)
    if (ok) {
      updateDemand({
        ...selectedDemand,
        practiceStartDate: practiceStartDateTime,
        practiceEndDate: practiceEndDateTime
      });
      logAction({
        modulo: 'Programação',
        acao: 'Editar',
        descricao: [
          `Período prática híbrida definido`,
          `Empresa: ${getCompanyName(selectedDemand.companyId)}`,
          `Treinamento: ${getTrainingName(selectedDemand.trainingId)}`,
          `Prática: ${practiceStartDateTime.slice(0, 10)} a ${practiceEndDateTime.slice(0, 10)}`,
        ].join(' | '),
        dadosAntes: { practiceStartDate: selectedDemand.practiceStartDate, practiceEndDate: selectedDemand.practiceEndDate },
        dadosDepois: { demandId: selectedDemand.id, practiceStartDate: practiceStartDateTime, practiceEndDate: practiceEndDateTime },
      });
    }

    return ok;
  };
  
  const handleRemoveHybridPractice = () => {
  if (!selectedDemand) return;
  if (selectedDemand.modality !== 'HIBRIDO') return;

  const confirmed = window.confirm('Remover o período de prática desta demanda?');
  if (!confirmed) return;

  // Limpa no FORM (UI)
  setHybridPracticeForm(prev => ({
    ...prev,
    practiceStartDate: '',
    practiceEndDate: '',
    practiceStartTime: '08:00',
    practiceEndTime: '18:00'
  }));

  // Limpa na DEMANDA (persistência via updateDemand -> sanitize -> mapDemandToDb -> null no Supabase)
  updateDemand({
    ...selectedDemand,
    practiceStartDate: undefined,
    practiceEndDate: undefined
  });
  logAction({
    modulo: 'Programação',
    acao: 'Cancelar',
    descricao: [
      `Prática híbrida removida`,
      `Empresa: ${getCompanyName(selectedDemand.companyId)}`,
      `Treinamento: ${getTrainingName(selectedDemand.trainingId)}`,
    ].join(' | '),
    dadosAntes: { practiceStartDate: selectedDemand.practiceStartDate, practiceEndDate: selectedDemand.practiceEndDate },
    dadosDepois: { demandId: selectedDemand.id },
  });
};

  const handleRemoveResource = () => {
    if (currentResourceAllocation) {
      removeResourceAllocation(currentResourceAllocation.id);
      logAction({
        modulo: 'Programação',
        acao: 'Cancelar',
        descricao: [
          `CTM removido`,
          selectedDemand ? `Empresa: ${getCompanyName(selectedDemand.companyId)}` : null,
          selectedDemand ? `Treinamento: ${getTrainingName(selectedDemand.trainingId)}` : null,
          `Período: ${currentResourceAllocation.startDate?.slice(0, 10)} a ${currentResourceAllocation.endDate?.slice(0, 10)}`,
        ].filter(Boolean).join(' | '),
        dadosAntes: currentResourceAllocation,
      });
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Orquestração Logística</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Alocação Inteligente Baseada em Disponibilidade e Qualificação Técnica</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (selectedDemandId) setCalendarDrawerDemandId(selectedDemandId);
              setCurrentView('calendar');
            }}
            className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all shadow-md flex items-center gap-2"
          >
            <CalendarIcon size={14} /> Ver na Agenda
          </button>
          <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg border border-blue-100 flex items-center text-sm font-semibold">
            <Briefcase size={16} className="mr-2" />
            {unallocatedDemands.length} Demandas Pendentes
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        
        {/* --- COLUNA ESQUERDA: DEMANDAS --- */}
        <div className="lg:col-span-4 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder="Filtrar demandas..."
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {unallocatedDemands.length > 0 ? (
              unallocatedDemands.map(demand => (
                <button
                  key={demand.id}
                  onClick={() => setSelectedDemandId(demand.id)}
                  className={`w-full text-left p-4 rounded-xl transition-all border-2 flex items-start gap-4 relative group
                    ${selectedDemandId === demand.id 
                      ? 'bg-blue-50 border-blue-500 shadow-md' 
                      : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}
                >
                  <div className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${isUrgent(demand.startDate) ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-slate-800 truncate text-sm" title={getCompanyName(demand.companyId)}>{getCompanyName(demand.companyId)}</h3>
                      <span className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter">#{demand.id}</span>
                    </div>
                    <p className="text-xs font-semibold text-blue-600 mb-2 truncate" title={getTrainingName(demand.trainingId)}>{getTrainingName(demand.trainingId)}</p>
                    
                    <div className="flex flex-wrap gap-y-2 gap-x-4 items-center text-[11px] text-slate-500">
                      <div className="flex items-center"><CalendarIcon size={12} className="mr-1" /> {new Date(demand.startDate).toLocaleDateString('pt-BR')}</div>
                      <div className="flex flex-wrap items-center gap-1">
                        <MapPin size={12} className="mr-0.5" />
                        <span>{getRegionName(demand.regionId)}</span>
                        {demand.trainingLocal && demand.trainingLocal !== 'N/A' && <><span className="text-slate-300">|</span><span>{demand.trainingLocal}</span></>}
                        {demand.corredor && <><span className="text-slate-300">|</span><span>{demand.corredor}</span></>}
                        {demand.demandState && <><span className="text-slate-300">|</span><span>{demand.demandState}</span></>}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={18} className={`mt-2 transition-transform ${selectedDemandId === demand.id ? 'text-blue-600 translate-x-1' : 'text-slate-300 group-hover:text-slate-400'}`} />
                </button>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-400">
                <CheckCircle2 size={48} className="mb-4 opacity-20" />
                <p className="text-sm font-medium">Tudo em dia! Nenhuma demanda pendente de alocação.</p>
              </div>
            )}
          </div>
        </div>

        {/* --- COLUNA DIREITA: PAINEL DE ALOCAÇÃO --- */}
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative">
          {selectedDemand ? (
            <div className="flex flex-col h-full animate-fade-in">
              
              <div className="p-6 border-b border-slate-100 bg-slate-50/30">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded">DEMANDA</span>
                      <span className="text-xs font-mono text-slate-400 font-bold">{selectedDemand.id}</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 leading-tight">{getTrainingName(selectedDemand.trainingId)}</h2>
                    <div className="flex items-center text-slate-600 text-sm font-medium">
                      <Building size={16} className="mr-2 text-slate-400" />
                      {getCompanyName(selectedDemand.companyId)}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-1 gap-3 md:text-right">
                    <div className="flex md:justify-end items-center text-sm font-bold text-slate-700">
                      <CalendarIcon size={16} className="mr-2 text-blue-500" />
                      {new Date(selectedDemand.startDate).toLocaleDateString('pt-BR')} <ArrowRight size={12} className="mx-2" /> {new Date(selectedDemand.endDate).toLocaleDateString('pt-BR')}
                    </div>
                    <div className="flex md:justify-end flex-wrap items-center gap-1 text-sm font-bold text-slate-700">
                      <MapPin size={16} className="mr-1 text-blue-500 shrink-0" />
                      <span>{getRegionName(selectedDemand.regionId)}</span>
                      {selectedDemand.trainingLocal && selectedDemand.trainingLocal !== 'N/A' && <><span className="text-slate-300">|</span><span>{selectedDemand.trainingLocal}</span></>}
                      {selectedDemand.corredor && <><span className="text-slate-300">|</span><span>{selectedDemand.corredor}</span></>}
                      {selectedDemand.demandState && <><span className="text-slate-300">|</span><span>{selectedDemand.demandState}</span></>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                
                {/* --- SEÇÃO RECURSO MÓVEL (CTM) --- */}
                <section className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Truck size={16} className="text-amber-500" />
                      Centro de Treinamento Móvel
                    </h3>
                  </div>

                  <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center border-2 transition-all
                        ${currentResourceAllocation ? 'bg-amber-100 border-amber-300 text-amber-600' : 'bg-white border-slate-200 text-slate-300'}`}>
                        <Truck size={24} />
                      </div>
                      <div>
                        {currentResourceAllocation ? (
                          <>
                            <p className="text-sm font-black text-amber-900 uppercase">CTM Alocado por Período</p>
                            <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1.5 mt-1">
                              <CalendarIcon size={12} />
                              {formatDateBR(currentResourceAllocation.startDate)} ({formatTimeHHmm(currentResourceAllocation.startDate) || '—'})
                              {' '}até{' '}
                              {formatDateBR(currentResourceAllocation.endDate)} ({formatTimeHHmm(currentResourceAllocation.endDate) || '—'})
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-bold text-slate-500 uppercase">Nenhum Recurso Alocado</p>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OPCIONAL</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      {currentResourceAllocation ? (
                        <button 
                          onClick={handleRemoveResource}
                          className="px-6 py-2.5 bg-white text-red-600 border border-red-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition shadow-sm"
                        >
                          Remover CTM
                        </button>
                      ) : (
                        <button 
                          onClick={handleOpenResourceModal}
                          className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition shadow-lg"
                        >
                          Alocar Centro Móvel
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                {/* --- HÍBRIDO (MVP): PERÍODO PRESENCIAL (PRÁTICA) --- */}
                {selectedDemand.modality === 'HIBRIDO' && (
                  <section className="bg-blue-50/60 p-6 rounded-2xl border border-blue-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-blue-800 uppercase tracking-widest flex items-center gap-2">
                        <Globe size={16} className="text-blue-600" />
                        Período Presencial (Prática) — Híbrido
                      </h3>

                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${
                        selectedDemand.practiceStartDate && selectedDemand.practiceEndDate
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-slate-500 border-slate-200'
                      }`}>
                        {selectedDemand.practiceStartDate && selectedDemand.practiceEndDate ? 'DEFINIDO' : 'PENDENTE'}
                      </span>
                    </div>

                    {/* LINHA 1: DATAS (layout original) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          Início prática
                        </label>
                        <input
                          type="date"
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={hybridPracticeForm.practiceStartDate}
                          min={selectedDemand.startDate.split('T')[0]}
                          max={selectedDemand.endDate.split('T')[0]}
                          onChange={(e) => setHybridPracticeForm(prev => ({ ...prev, practiceStartDate: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          Fim prática
                        </label>
                        <input
                          type="date"
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={hybridPracticeForm.practiceEndDate}
                          min={selectedDemand.startDate.split('T')[0]}
                          max={selectedDemand.endDate.split('T')[0]}
                          onChange={(e) => setHybridPracticeForm(prev => ({ ...prev, practiceEndDate: e.target.value }))}
                        />
                      </div>
                        <div className="w-full flex flex-col gap-2">
                          <button
                            onClick={handleSaveHybridPractice}
                            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg"
                          >
                            Salvar prática
                          </button>

                          {selectedDemand.practiceStartDate && selectedDemand.practiceEndDate && (
                            <button
                              onClick={handleRemoveHybridPractice}
                              className="w-full px-6 py-3 bg-white hover:bg-red-50 text-red-600 border border-red-200 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-sm"
                            >
                              Remover prática
                            </button>
                          )}
                        </div>
                    </div>

                    {/* LINHA 2: HORÁRIOS (novo, mantendo o mesmo padrão visual) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mt-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          Horário início
                        </label>
                        <input
                          type="time"
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={hybridPracticeForm.practiceStartTime}
                          onChange={(e) => setHybridPracticeForm(prev => ({ ...prev, practiceStartTime: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                          Horário fim
                        </label>
                        <input
                          type="time"
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={hybridPracticeForm.practiceEndTime}
                          onChange={(e) => setHybridPracticeForm(prev => ({ ...prev, practiceEndTime: e.target.value }))}
                        />
                      </div>

                      {/* Coluna 3 vazia para manter o grid (e não mexer no layout do botão acima) */}
                      <div className="hidden md:block" />
                    </div>

                    <div className="mt-4 p-3 bg-white rounded-xl border border-blue-100 flex items-start gap-2">
                      <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                      <div className="text-[10px] font-bold text-slate-600 leading-tight">
                        <div>
                          Período total da demanda: {new Date(selectedDemand.startDate).toLocaleDateString('pt-BR')} até {new Date(selectedDemand.endDate).toLocaleDateString('pt-BR')}
                        </div>
                        <div className="mt-1">
                          Dica: os dias fora do período de prática são tratados como a parte ONLINE do treinamento (MVP).
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* --- INSTRUTORES --- */}
                <section className="space-y-8">
                  {/* Grupo 1: Sugeridos (Mesmo Estado) */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <MapPin size={16} className="text-blue-500" />
                        Instrutores Sugeridos (Estado da Demanda)
                      </h3>
                    </div>

                    {/* ✅ PICKER SIMPLES (modal leve) */}
                    {isCompanionDatesOpen && selectedDemand && pendingCompanionInstructorId && createPortal(
                  <div className="fixed inset-0 z-[130] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-black text-slate-800 uppercase">Datas do acompanhante</p>
                          <p className="text-[11px] font-semibold text-slate-500">
                            Selecione dias avulsos (ex: 21, 23 e 25)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closeCompanionDatesModal}
                          className="px-3 py-2 rounded-xl text-[11px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                        >
                          Fechar
                        </button>
                      </div>

                      <div className="p-4 space-y-4">
                        {/* adicionar dia */}
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                              Adicionar dia
                            </label>
                            <input
                              type="date"
                              className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              value={companionDayInput}
                              min={selectedDemand.startDate.split('T')[0]}
                              max={selectedDemand.endDate.split('T')[0]}
                              onChange={(e) => setCompanionDayInput(e.target.value)}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => addCompanionDay(companionDayInput)}
                            className="px-4 py-2.5 rounded-xl text-[11px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                            disabled={!companionDayInput}
                          >
                            + Adicionar
                          </button>
                        </div>

                        {/* lista de dias */}
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          {companionSelectedDays.length === 0 ? (
                            <div className="text-[11px] font-semibold text-slate-400">
                              Nenhum dia selecionado.
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {companionSelectedDays.map(day => (
                                <div
                                  key={day}
                                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200"
                                >
                                  <span className="text-[11px] font-black text-slate-700 uppercase">
                                    {formatDateBR(day)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeCompanionDay(day)}
                                    className="text-red-600 font-black text-[12px] leading-none"
                                    title="Remover"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2">
                          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                          <p className="text-[10px] font-bold text-blue-700 leading-tight">
                            Os horários serão iguais aos horários da demanda (ou 08:00 às 18:00 se não houver).
                          </p>
                        </div>
                      </div>

                      <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                        <button
                          type="button"
                          onClick={closeCompanionDatesModal}
                          className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveCompanionDays}
                          disabled={companionSelectedDays.length === 0}
                          className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest ${
                            companionSelectedDays.length === 0
                              ? 'bg-slate-200 text-slate-400'
                              : 'bg-slate-900 text-white hover:bg-blue-600 shadow-lg'
                          }`}
                        >
                          Salvar dias
                        </button>
                      </div>
                    </div>
                  </div>
                , document.body)}
                    <div className="grid grid-cols-1 gap-3">
                      {recommendation.suggested.length > 0 ? recommendation.suggested.map((instructor) => (
                        <div key={instructor.id} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-all flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-black border border-blue-200 shadow-sm">
                              {instructor.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800">{instructor.name}</h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-black uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                                  Score: {instructor.score}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={() => handleAllocate(instructor)}
                            className="px-6 py-2 bg-slate-900 hover:bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-lg transition-all shadow-md flex items-center gap-2"
                          >
                            <UserCheck size={14} /> Alocar
                          </button>
                        </div>
                      )) : (
                        <p className="text-xs text-slate-400 italic py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">Nenhum instrutor disponível nesta região para este treinamento.</p>
                      )}
                    </div>
                  </div>

                  {/* Grupo 2: Exceções (Fora do Estado) */}
                  {recommendation.exceptions.length > 0 && (
                    <div>
                      <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center" aria-hidden="true">
                          <div className="w-full border-t border-slate-200"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-white px-4 text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 border border-slate-200 rounded-full py-1">
                            <AlertTriangle size={12} className="text-amber-500" />
                            Outros instrutores disponíveis (fora do estado)
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {recommendation.exceptions.map((instructor) => (
                          <div key={instructor.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/30 hover:border-amber-300 transition-all flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 font-black border border-amber-100 shadow-sm relative">
                                {instructor.name.charAt(0)}
                                <div className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full p-0.5 shadow-sm">
                                  <AlertTriangle size={10} />
                                </div>
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-700">{instructor.name}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] font-black uppercase bg-white text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 flex items-center gap-1">
                                    Exceção <AlertTriangle size={8} />
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                                    {instructor.regionIds.map(rid => regions.find(r => r.id === rid)?.name).join(', ')}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleAllocate(instructor)}
                              className="px-6 py-2 bg-white hover:bg-amber-50 text-amber-700 border border-amber-200 font-black text-xs uppercase tracking-widest rounded-lg transition-all shadow-sm flex items-center gap-2"
                            >
                              <UserCheck size={14} /> Alocar Exceção
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grupo 3: Já Alocados Neste Dia */}
                  {recommendation.alreadyAllocated.length > 0 && (
                    <div>
                      <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center" aria-hidden="true">
                          <div className="w-full border-t border-amber-200"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-white px-4 text-xs font-black text-amber-600 uppercase tracking-widest flex items-center gap-2 border border-amber-200 rounded-full py-1">
                            <AlertTriangle size={12} className="text-amber-500" />
                            Já alocados neste dia
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {recommendation.alreadyAllocated.map((instructor: Instructor & { score: number }) => (
                          <div key={instructor.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 hover:border-amber-400 transition-all flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-black border border-amber-200 shadow-sm relative">
                                {instructor.name.charAt(0)}
                                <div className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full p-0.5 shadow-sm">
                                  <AlertTriangle size={10} />
                                </div>
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-700">{instructor.name}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] font-black uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                                    JÁ ALOCADO NESTE DIA <AlertTriangle size={8} />
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleAllocateAnyway(instructor)}
                              className="px-6 py-2 bg-white hover:bg-amber-50 text-amber-700 border border-amber-300 font-black text-xs uppercase tracking-widest rounded-lg transition-all shadow-sm flex items-center gap-2"
                            >
                              <UserCheck size={14} /> Alocar mesmo assim
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                   {/* ✅ ACOMPANHANTES */}
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-slate-800 uppercase tracking-tight">Acompanhantes</p>
                          <p className="text-[11px] font-semibold text-slate-500">Instrutor(es) adicionais para a mesma demanda</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedDemand) return;
                            setIsCompanionPickerOpen(true);
                          }}
                          className="px-3 py-2 rounded-xl text-[11px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                          disabled={!selectedDemand}
                        >
                          + Adicionar
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {companionsForSelectedDemand.length === 0 ? (
                          <div className="text-[11px] font-semibold text-slate-400 bg-slate-50 border border-slate-100 rounded-xl p-3">
                            Nenhum acompanhante alocado.
                          </div>
                        ) : (
                          companionsForSelectedDemand.map((a: any) => {
                            const inst = instructors.find((i: any) => i.id === a.instructorId);
                            return (
                              <div
                                key={a.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
                              >
                                <div className="min-w-0">
                                  <p className="text-[12px] font-black text-amber-900 truncate" title={inst?.name}>{inst?.name ?? 'Instrutor'}</p>
                                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">ACOMPANHANTE</p>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleRemoveCompanion(a.id)}
                                  className="px-3 py-2 rounded-xl text-[11px] font-black uppercase text-red-600 border border-red-200 hover:bg-red-50"
                                >
                                  Remover
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  {/* ✅ PICKER DE ACOMPANHANTE (seleciona instrutor) */}
                  {isCompanionPickerOpen && selectedDemand && createPortal(
                    <div className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-black text-slate-800 uppercase">Selecionar acompanhante</p>
                            <p className="text-[11px] font-semibold text-slate-500">Escolha um instrutor para acompanhar</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsCompanionPickerOpen(false)}
                            className="px-3 py-2 rounded-xl text-[11px] font-black uppercase border border-slate-200 hover:bg-slate-50"
                          >
                            Fechar
                          </button>
                        </div>

                        <div className="p-4 max-h-[60vh] overflow-auto space-y-2">
                          {instructors
                            .filter((i: any) => i.status === 'ATIVO')
                            .map((i: any) => {
                              const isAlready = companionsForSelectedDemand.some((a: any) => a.instructorId === i.id);
                              const isMain = selectedDemand.instructorId === i.id;

                              return (
                                <button
                                  key={i.id}
                                  type="button"
                                  disabled={isAlready || isMain}
                                  onClick={() => {
                                    setIsCompanionPickerOpen(false);
                                    openCompanionDatesModal(i.id);
                                  }}
                                  className={`w-full text-left p-3 rounded-xl border transition ${
                                    isAlready || isMain
                                      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                                      : 'bg-white border-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-[12px] font-black truncate" title={i.name}>{i.name}</p>
                                      {isMain && (
                                        <p className="text-[10px] font-black uppercase tracking-widest">INSTRUTOR PRINCIPAL</p>
                                      )}
                                      {isAlready && (
                                        <p className="text-[10px] font-black uppercase tracking-widest">JÁ É ACOMPANHANTE</p>
                                      )}
                                    </div>
                                    <span className="text-[11px] font-black uppercase">Selecionar</span>
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  , document.body)}

                </section>
              </div>

            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-12 text-center text-slate-400">
              <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
                <Target size={32} className="opacity-20" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Selecione uma Demanda</h3>
              <p className="max-w-xs text-sm">Escolha uma demanda na lista ao lado para realizar a orquestração logística completa.</p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL ALOCAÇÃO CTM */}
      {isResourceModalOpen && selectedDemand && createPortal(
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-amber-700 uppercase tracking-tight">Alocação de Recurso</h3>
              <button onClick={() => setIsResourceModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Início</label>
                  <input 
                    type="date" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.startDate} 
                    onChange={e => setResourceForm(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Fim</label>
                  <input 
                    type="date" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.endDate} 
                    onChange={e => setResourceForm(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
              </div>

              {/* NOVO: horários do CTM (mantendo padrão visual) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Hora Início</label>
                  <input 
                    type="time" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.startTime} 
                    onChange={e => setResourceForm(prev => ({ ...prev, startTime: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Hora Fim</label>
                  <input 
                    type="time" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.endTime} 
                    onChange={e => setResourceForm(prev => ({ ...prev, endTime: e.target.value }))}
                  />
                </div>
              </div>

              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2">
                <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-blue-700 leading-tight">
                  Período da Demanda: {new Date(selectedDemand.startDate).toLocaleDateString('pt-BR')} até {new Date(selectedDemand.endDate).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button onClick={() => setIsResourceModalOpen(false)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500">Cancelar</button>
              <button onClick={handleAddResourceAllocation} className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-200">Confirmar</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal de confirmação: alocar instrutor já alocado no dia */}
      {pendingForceAlloc && selectedDemand && createPortal(
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-amber-200 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-amber-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800">Instrutor já alocado</h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="font-bold text-slate-700">{pendingForceAlloc.name}</span> já possui uma alocação neste período (
                  {new Date(selectedDemand.startDate).toLocaleDateString('pt-BR')} –{' '}
                  {new Date(selectedDemand.endDate).toLocaleDateString('pt-BR')}).
                  Deseja alocar mesmo assim?
                </p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 flex gap-3">
              <button
                onClick={() => setPendingForceAlloc(null)}
                className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmForceAlloc}
                className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-200 hover:bg-amber-700 transition"
              >
                Confirmar mesmo assim
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
};

export default Logistics;
