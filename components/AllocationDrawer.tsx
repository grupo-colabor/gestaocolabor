import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App';
import InstructorCard from './InstructorCard';
import CompanionPicker from './CompanionPicker';
import { useAuth } from '../contexts/AuthContext';
import { getDemandDays, isNightDemand } from '../domain/demandDays';
import { requiresInstructor, requiresLogistics } from '../domain/modalityRules';
import type { Demand, Instructor } from '../types';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Search,
  MapPin,
  Calendar as CalendarIcon,
  UserCheck,
  Eye,
  AlertTriangle,
  Building,
  GraduationCap,
  Users,
  Info,
  Check,
  Minimize2,
  Maximize2,
  Globe,
  Moon
} from 'lucide-react';

/* ======================================================
   TYPES
====================================================== */

export type DrawerState = 'closed' | 'collapsed' | 'expanded';

export interface AllocationPreview {
  id: string;
  demandId: string;
  instructorId: string;
  instructorName: string;
  days: string[];
  hasConflict: boolean;
  conflictDetails: string[];
  isException: boolean;
  isCompanion: boolean;
}

interface AllocationDrawerProps {
  drawerState: DrawerState;
  setDrawerState: (s: DrawerState) => void;
  selectedDemandId: string | null;
  setSelectedDemandId: (id: string | null) => void;
  previewItems: AllocationPreview[];
  setPreviewItems: React.Dispatch<React.SetStateAction<AllocationPreview[]>>;
  onNavigateToDate: (demand: Demand) => void;
  onScrollToInstructor: (instructorId: string) => void;
  companionMode: boolean;
  setCompanionMode: (v: boolean) => void;
}

/* ======================================================
   COMPONENT
====================================================== */

const AllocationDrawer: React.FC<AllocationDrawerProps> = ({
  drawerState,
  setDrawerState,
  selectedDemandId,
  setSelectedDemandId,
  previewItems,
  setPreviewItems,
  onNavigateToDate,
  onScrollToInstructor,
  companionMode,
  setCompanionMode,
}) => {
  const {
    demands,
    companies,
    trainings,
    regions,
    instructors,
    agendaItems,
    instructorAllocations,
    operationalBases,
    recommendInstructors,
    allocateInstructor,
    hasScheduleConflict,
    ensureLogisticBlocksForPerson,
    addCompanionAllocation,
    setNotification,
    companionAllocations,
    updateDemand,
    setHybridPracticePeriod,
  } = useApp();

  const { profile } = useAuth();

  // Panel state: minimized (small bar) or full
  const [minimized, setMinimized] = useState(false);
  // Current step: 'demands' or 'instructors'
  const [step, setStep] = useState<'demands' | 'instructors'>('demands');

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterCompanyId, setFilterCompanyId] = useState('TODOS');
  const [filterTrainingId, setFilterTrainingId] = useState('TODOS');
  const [filterEstado, setFilterEstado] = useState('TODOS');
  const [filterCorredor, setFilterCorredor] = useState('TODOS');

  // Companion day picker
  const [companionDayInput, setCompanionDayInput] = useState('');
  const [companionSelectedDays, setCompanionSelectedDays] = useState<string[]>([]);
  const [pendingCompanionInstructorId, setPendingCompanionInstructorId] = useState<string | null>(null);
  const [isCompanionPickerOpen, setIsCompanionPickerOpen] = useState(false);

  // Hybrid practice form
  const [hybridForm, setHybridForm] = useState({ practiceStartDate: '', practiceEndDate: '' });

  // Modal de confirmação para alocar instrutor já alocado no dia
  const [pendingForceAlloc, setPendingForceAlloc] = useState<(Instructor & { score: number }) | null>(null);

  // Drag-to-move state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const currentX = position?.x ?? window.innerWidth - 420;
    const currentY = position?.y ?? 56;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: currentX, originY: currentY };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 410, dragRef.current.originX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 80, dragRef.current.originY + dy));
      setPosition({ x: newX, y: newY });
    };

    const onMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [position]);

  // Helpers
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';
  const normalize = (s: string) =>
    (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const formatDateBR = (value?: string) => {
    if (!value) return '';
    const d = value.split('T')[0];
    if (!d) return '';
    return new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');
  };

  const isUrgent = (dateStr: string) => {
    const today = new Date();
    const start = new Date(dateStr);
    return Math.ceil((start.getTime() - today.getTime()) / 86400000) <= 7;
  };

  // ============ DATA ============

  const drawerDemands = useMemo(() => {
    return demands
      .filter(d =>
        d.status !== 'CANCELADA' &&
        !d.instructorId &&
        requiresInstructor(d.modality) &&
        (!requiresLogistics(d.modality) || d.trainingLocal !== 'N/A')
      )
      .filter(d => {
        if (filterCompanyId !== 'TODOS' && d.companyId !== filterCompanyId) return false;
        if (filterTrainingId !== 'TODOS' && d.trainingId !== filterTrainingId) return false;
        if (filterEstado !== 'TODOS' && d.demandState !== filterEstado) return false;
        if (filterCorredor !== 'TODOS' && d.corredor !== filterCorredor) return false;
        if (filterText) {
          const text = normalize(filterText);
          return normalize(getCompanyName(d.companyId)).includes(text) ||
                 normalize(getTrainingName(d.trainingId)).includes(text) ||
                 d.id.toLowerCase().includes(text);
        }
        return true;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [demands, filterCompanyId, filterTrainingId, filterEstado, filterCorredor, filterText, companies, trainings]);

  const selectedDemand = useMemo(
    () => demands.find(d => d.id === selectedDemandId) || null,
    [demands, selectedDemandId]
  );

  const recommendation = useMemo(() => {
    if (!selectedDemand) return { suggested: [], exceptions: [], alreadyAllocated: [] };
    return recommendInstructors(selectedDemand);
  }, [selectedDemand, recommendInstructors]);

  const companionsForDemand = useMemo(() => {
    if (!selectedDemandId) return [];
    return companionAllocations.filter(a => a.demandId === selectedDemandId);
  }, [companionAllocations, selectedDemandId]);

  /**
   * Grava o acompanhante nos dias escolhidos no picker.
   *
   * ⚠️ A CONVENÇÃO DE GRAVAÇÃO NÃO MUDOU: uma linha por dia em
   * companion_allocations, com T08:00/T18:00 literais — exatamente o que o
   * seletor antigo fazia. O que mudou foi só COMO os dias são escolhidos.
   *
   * O bloco de logística sai UMA VEZ por pessoa, fora do laço (regra da F1):
   * N dias geram N linhas de acompanhante e 2 blocos, não 2N.
   */
  const handleConfirmCompanion = useCallback((instructorId: string, dias: string[]) => {
    if (!selectedDemand || dias.length === 0) return;

    dias.forEach(day => {
      addCompanionAllocation({
        id: `CA-${Date.now()}-${day}`,
        demandId: selectedDemand.id,
        instructorId,
        startDate: `${day}T08:00`,
        endDate: `${day}T18:00`,
      });
    });

    void ensureLogisticBlocksForPerson(selectedDemand.id, instructorId);

    const nome = instructors.find(i => i.id === instructorId)?.name || instructorId;
    setIsCompanionPickerOpen(false);
    setNotification({
      type: 'success',
      message: `Acompanhante ${nome} alocado em ${dias.length} dia(s).`,
    });
  }, [selectedDemand, addCompanionAllocation, ensureLogisticBlocksForPerson, instructors, setNotification]);

  const filterOptions = useMemo(() => {
    const pending = demands.filter(d =>
      d.status !== 'CANCELADA' && !d.instructorId &&
      requiresInstructor(d.modality) &&
      (!requiresLogistics(d.modality) || d.trainingLocal !== 'N/A')
    );
    return {
      companies: companies.filter(c => pending.some(d => d.companyId === c.id)),
      trainings: trainings.filter(t => pending.some(d => d.trainingId === t.id)),
    };
  }, [demands, companies, trainings]);

  // ============ CONFLICT DETAILS ============

  const getConflictDetails = useCallback((instructorId: string, demand: Demand): string[] => {
    const days = getDemandDays(demand);
    const details: string[] = [];

    for (const day of days) {
      // Check agenda items (FOLGA, FERIAS, etc.)
      const agendaConflicts = agendaItems.filter(ai =>
        ai.instructorId === instructorId &&
        ai.startDate.split('T')[0] <= day &&
        ai.endDate.split('T')[0] >= day
      );
      for (const ai of agendaConflicts) {
        details.push(`${formatDateBR(day)}: ${ai.type}${ai.title ? ` - ${ai.title}` : ''}`);
      }

      // Check existing allocations
      const allocConflicts = instructorAllocations.filter(al =>
        al.instructorId === instructorId &&
        al.demandId !== demand.id &&
        al.startDate.split('T')[0] <= day &&
        al.endDate.split('T')[0] >= day
      );
      for (const al of allocConflicts) {
        const otherDemand = demands.find(d => d.id === al.demandId);
        const label = otherDemand ? getTrainingName(otherDemand.trainingId) : al.demandId;
        details.push(`${formatDateBR(day)}: Alocado em ${label}`);
      }
    }

    return [...new Set(details)].slice(0, 5); // max 5 details
  }, [agendaItems, instructorAllocations, demands, trainings]);

  // ============ ACTIONS ============

  const handleSelectDemand = useCallback((demand: Demand) => {
    setSelectedDemandId(demand.id);
    setCompanionMode(false);
    setPendingCompanionInstructorId(null);
    setCompanionSelectedDays([]);
    setStep('instructors');
    setMinimized(false);

    // Sync hybrid form
    setHybridForm({
      practiceStartDate: demand.practiceStartDate?.split('T')[0] || '',
      practiceEndDate: demand.practiceEndDate?.split('T')[0] || '',
    });

    onNavigateToDate(demand);
  }, [onNavigateToDate, setSelectedDemandId, setCompanionMode]);

  const handleAddPreview = useCallback((
    instructor: Instructor & { score: number },
    demand: Demand,
    isException: boolean
  ) => {
    if (previewItems.length >= 3) {
      setNotification({ type: 'error', message: 'Máximo de 3 previews simultâneos.' });
      return;
    }
    if (previewItems.some(p => p.instructorId === instructor.id && p.demandId === demand.id && p.isCompanion === companionMode)) return;

    const days = getDemandDays(demand);
    const hasConflict = hasScheduleConflict(instructor.id, demand.startDate, demand.endDate, demand.id);
    const conflictDetails = hasConflict ? getConflictDetails(instructor.id, demand) : [];

    setPreviewItems(prev => [...prev, {
      id: `preview-${Date.now()}-${instructor.id}`,
      demandId: demand.id,
      instructorId: instructor.id,
      instructorName: instructor.name,
      days,
      hasConflict,
      conflictDetails,
      isException,
      isCompanion: companionMode,
    }]);

    // Auto-scroll to instructor row + minimize panel
    onScrollToInstructor(instructor.id);
    setMinimized(true);

    if (hasConflict) {
      setNotification({ type: 'error', message: `CONFLITO: ${instructor.name} tem compromissos nos dias da demanda.` });
    }
  }, [previewItems, companionMode, hasScheduleConflict, getConflictDetails, setNotification, setPreviewItems, onScrollToInstructor]);

  const handleRemovePreview = useCallback((previewId: string) => {
    setPreviewItems(prev => prev.filter(p => p.id !== previewId));
  }, [setPreviewItems]);

  const handleAllocateDirect = useCallback((instructor: Instructor & { score: number }) => {
    if (!selectedDemand) return;

    // Hybrid check
    if (selectedDemand.modality === 'HIBRIDO' && !selectedDemand.practiceStartDate) {
      setNotification({ type: 'error', message: 'Defina o período presencial (prática) antes de alocar o instrutor.' });
      return;
    }

    // O "modo acompanhante" da lista principal deixou de existir: a seleção
    // inteira (instrutor + dias) passou para o CompanionPicker, que grava por
    // handleConfirmCompanion. Este botão volta a ser só alocação de titular.
    const success = allocateInstructor(selectedDemand.id, instructor.id);
    if (success) {
      setNotification({ type: 'success', message: `Instrutor ${instructor.name} alocado com sucesso.` });
      setPreviewItems(prev => prev.filter(p => p.demandId !== selectedDemand.id));
    }
  }, [selectedDemand, allocateInstructor, setNotification, setPreviewItems]);

  const handleAllocateAnyway = useCallback((instructor: Instructor & { score: number }) => {
    setPendingForceAlloc(instructor);
  }, []);

  const handleConfirmForceAlloc = useCallback(() => {
    if (!pendingForceAlloc) return;
    handleAllocateDirect(pendingForceAlloc);
    setPendingForceAlloc(null);
  }, [pendingForceAlloc, handleAllocateDirect]);

  const handleConfirmPreview = useCallback((preview: AllocationPreview) => {
    if (preview.isCompanion) {
      preview.days.forEach(day => {
        addCompanionAllocation({
          id: `CA-${Date.now()}-${day}`,
          demandId: preview.demandId,
          instructorId: preview.instructorId,
          startDate: `${day}T08:00`,
          endDate: `${day}T18:00`,
        });
      });
      setNotification({ type: 'success', message: `Acompanhante ${preview.instructorName} confirmado.` });
    } else {
      // Hybrid check
      const demand = demands.find(d => d.id === preview.demandId);
      if (demand?.modality === 'HIBRIDO' && !demand.practiceStartDate) {
        setNotification({ type: 'error', message: 'Defina o período presencial antes de confirmar.' });
        return;
      }
      const success = allocateInstructor(preview.demandId, preview.instructorId);
      if (!success) return;
      setNotification({ type: 'success', message: `Instrutor ${preview.instructorName} alocado com sucesso.` });
    }
    setPreviewItems(prev => prev.filter(p => p.id !== preview.id));
  }, [demands, allocateInstructor, addCompanionAllocation, setNotification, setPreviewItems]);

  // Hybrid practice period
  const handleSaveHybridPractice = () => {
    if (!selectedDemand || selectedDemand.modality !== 'HIBRIDO') return;
    if (!hybridForm.practiceStartDate || !hybridForm.practiceEndDate) return;

    const ok = setHybridPracticePeriod(
      selectedDemand.id,
      `${hybridForm.practiceStartDate}T08:00`,
      `${hybridForm.practiceEndDate}T18:00`
    );
    if (ok) {
      updateDemand({
        ...selectedDemand,
        practiceStartDate: `${hybridForm.practiceStartDate}T08:00`,
        practiceEndDate: `${hybridForm.practiceEndDate}T18:00`,
      });
      setNotification({ type: 'success', message: 'Período presencial salvo.' });
    }
  };

  // Companion day picker
  // O seletor de um-dia-por-vez (addCompanionDay / removeCompanionDay /
  // handleSaveCompanionDays) saiu daqui: a escolha de dias virou lista de
  // marcacao no CompanionPicker, com "todos os dias" e intervalo. A gravacao
  // continua em handleConfirmCompanion, com a mesma convencao de uma linha
  // por dia.

  const handleClose = () => {
    setDrawerState('closed');
    setPreviewItems([]);
    setSelectedDemandId(null);
    setCompanionMode(false);
    setStep('demands');
    setMinimized(false);
  };

  // Don't render
  if (profile?.role === 'coordenador') return null;
  if (drawerState === 'closed') return null;

  // ============ RENDER ============

  // MINIMIZED: just a small floating bar
  if (minimized) {
    const drawerJSX = (
      <div
        className="fixed z-[200] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 w-[320px] animate-fade-in"
        style={position ? { top: position.y, left: position.x } : { top: 64, right: 16 }}
      >
        <div
          className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleDragStart}
          title="Arraste para mover"
        >
          <h4 className="text-[10px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
            <UserCheck size={14} className="text-blue-600" />
            {companionMode ? 'ACOMPANHANTE' : 'ALOCAÇÃO'}
          </h4>
          <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
            <button onClick={() => setMinimized(false)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400" title="Expandir">
              <Maximize2 size={14} />
            </button>
            <button onClick={handleClose} className="p-1 hover:bg-red-50 rounded-lg transition text-slate-400 hover:text-red-500">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Active previews */}
        {previewItems.length > 0 && (
          <div className="space-y-1.5">
            {previewItems.map(p => (
              <div key={p.id} className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold ${
                p.hasConflict ? 'bg-red-50 border-red-200 text-red-700'
                : p.isException ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    p.hasConflict ? 'bg-red-500' : p.isException ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <span className="truncate" title={p.instructorName}>{p.instructorName}</span>
                  {p.hasConflict && <AlertTriangle size={10} />}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { onScrollToInstructor(p.instructorId); }} className="p-0.5 hover:bg-white/50 rounded" title="Ver na agenda">
                    <Eye size={11} />
                  </button>
                  <button onClick={() => handleConfirmPreview(p)} className="p-0.5 hover:bg-white/50 rounded" title="Confirmar">
                    <Check size={11} />
                  </button>
                  <button onClick={() => handleRemovePreview(p.id)} className="p-0.5 hover:bg-white/50 rounded" title="Remover">
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {previewItems.length === 0 && selectedDemand && (
          <p className="text-[10px] text-slate-400 font-bold">Selecione instrutores no painel para ver preview na agenda.</p>
        )}
      </div>
    );
    return createPortal(drawerJSX, document.body);
  }

  // FULL PANEL: floating on the right side
  const panelJSX = (
    <div
      className="fixed z-[200] w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-fade-in"
      style={position
        ? { top: position.y, left: position.x, bottom: 'auto', height: 'calc(100vh - ' + position.y + 'px - 16px)' }
        : { top: 56, right: 16, bottom: 16 }
      }
    >

      {/* ===== HEADER ===== */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/80 shrink-0 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDragStart}
        title="Arraste para mover"
      >
        <div className="flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
          {step === 'instructors' && (
            <button onClick={() => { setStep('demands'); setSelectedDemandId(null); }} className="p-1 hover:bg-slate-200 rounded-lg transition text-slate-500">
              <ChevronLeft size={16} />
            </button>
          )}
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
            <UserCheck size={14} className="text-blue-600" />
            {step === 'demands' ? 'DEMANDAS PENDENTES' : companionMode ? 'ACOMPANHANTE' : 'INSTRUTORES'}
          </h3>
          <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg border border-blue-200">
            {drawerDemands.length}
          </span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
          <button onClick={() => setMinimized(true)} className="p-1.5 hover:bg-slate-100 rounded-lg transition text-slate-400" title="Minimizar">
            <Minimize2 size={14} />
          </button>
          <button onClick={handleClose} className="p-1.5 hover:bg-red-50 rounded-lg transition text-slate-400 hover:text-red-500">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ===== ACTIVE PREVIEWS BAR ===== */}
      {previewItems.length > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 space-y-1 shrink-0">
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Previews ativos:</span>
          {previewItems.map(p => (
            <div key={p.id} className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg border text-[10px] font-bold ${
              p.hasConflict ? 'bg-red-50 border-red-200 text-red-700'
              : p.isException ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.hasConflict ? 'bg-red-500' : p.isException ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="truncate font-black" title={p.instructorName}>{p.instructorName}</span>
                {p.hasConflict && <span className="text-[8px] opacity-70">(CONFLITO)</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onScrollToInstructor(p.instructorId)} className="p-0.5 hover:bg-white/50 rounded" title="Ver na agenda"><Eye size={11} /></button>
                <button onClick={() => handleConfirmPreview(p)} className="p-0.5 hover:bg-white/50 rounded text-current" title="Confirmar"><Check size={11} /></button>
                <button onClick={() => handleRemovePreview(p.id)} className="p-0.5 hover:bg-white/50 rounded" title="Remover"><X size={11} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== BODY ===== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* STEP 1: DEMANDS LIST */}
        {step === 'demands' && (
          <div className="flex flex-col h-full">
            {/* Filters */}
            <div className="p-3 border-b border-slate-100 space-y-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text" placeholder="Buscar demanda..."
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterText} onChange={e => setFilterText(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filterCompanyId} onChange={e => setFilterCompanyId(e.target.value)}>
                  <option value="TODOS">Empresa</option>
                  {filterOptions.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filterTrainingId} onChange={e => setFilterTrainingId(e.target.value)}>
                  <option value="TODOS">Treinamento</option>
                  {filterOptions.trainings.map(t => <option key={t.id} value={t.id}>{t.nr || t.name}</option>)}
                </select>
                <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
                  <option value="TODOS">Estado</option>
                  {operationalBases.localidades.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
                <select className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filterCorredor} onChange={e => setFilterCorredor(e.target.value)}>
                  <option value="TODOS">Corredor</option>
                  {operationalBases.corredores.map(cor => <option key={cor} value={cor}>{cor}</option>)}
                </select>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {drawerDemands.length > 0 ? drawerDemands.map(demand => (
                <button
                  key={demand.id}
                  onClick={() => handleSelectDemand(demand)}
                  className={`w-full text-left p-3 rounded-xl transition-all border-2 flex items-start gap-3 ${
                    selectedDemandId === demand.id
                      ? 'bg-blue-50 border-blue-500 shadow-sm'
                      : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
                  }`}
                >
                  <div className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${isUrgent(demand.startDate) ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <h4 className="font-bold text-slate-800 truncate text-xs" title={getCompanyName(demand.companyId)}>{getCompanyName(demand.companyId)}</h4>
                      <span className="text-[9px] font-bold text-slate-400 font-mono shrink-0">#{demand.id}</span>
                    </div>
                    <p className="text-[10px] font-semibold text-blue-600 truncate" title={getTrainingName(demand.trainingId)}>{getTrainingName(demand.trainingId)}</p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-500 font-bold">
                      <span className="flex items-center gap-0.5"><CalendarIcon size={10} /> {formatDateBR(demand.startDate)} — {formatDateBR(demand.endDate)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="flex items-center gap-0.5 text-[9px] text-slate-500 font-bold"><MapPin size={10} /> {getRegionName(demand.regionId)}</span>
                      {demand.trainingLocal && demand.trainingLocal !== 'N/A' && <><span className="text-slate-300 text-[9px]">·</span><span className="text-[9px] text-slate-500 font-bold">{demand.trainingLocal}</span></>}
                      {demand.corredor && <><span className="text-slate-300 text-[9px]">·</span><span className="text-[9px] text-slate-500 font-bold">{demand.corredor}</span></>}
                      {demand.demandState && <><span className="text-slate-300 text-[9px]">·</span><span className="text-[9px] text-slate-500 font-bold">{demand.demandState}</span></>}
                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                        demand.modality === 'HIBRIDO' ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : demand.modality === 'PRESENCIAL' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}>{demand.modality}</span>
                      {isNightDemand(demand) && (
                        <span className="flex items-center gap-0.5 bg-indigo-950 text-indigo-100 border border-indigo-800 text-[8px] font-black uppercase px-1.5 py-0.5 rounded">
                          <Moon size={8} strokeWidth={2.5} /> NOTURNO
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )) : (
                <div className="flex flex-col items-center justify-center h-full p-6 text-center text-slate-400">
                  <p className="text-xs font-bold">Nenhuma demanda pendente.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: INSTRUCTOR RECOMMENDATIONS */}
        {step === 'instructors' && selectedDemand && (
          <div className="flex flex-col">
            {/* Demand info header */}
            <div className="p-4 border-b border-slate-100 bg-white shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-slate-900 text-white text-[9px] font-bold px-2 py-0.5 rounded">{selectedDemand.id}</span>
                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-lg border ${
                  selectedDemand.modality === 'HIBRIDO' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>{selectedDemand.modality}</span>
              </div>
              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Building size={12} className="text-slate-400" /> {getCompanyName(selectedDemand.companyId)}
              </p>
              <p className="text-[10px] font-semibold text-blue-600 flex items-center gap-1.5 mt-0.5">
                <GraduationCap size={12} className="text-blue-400" /> {getTrainingName(selectedDemand.trainingId)}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] font-bold text-slate-500">
                <span><CalendarIcon size={10} className="inline mr-0.5" />{formatDateBR(selectedDemand.startDate)} — {formatDateBR(selectedDemand.endDate)}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <MapPin size={10} className="inline mr-0.5" />{getRegionName(selectedDemand.regionId)}
                  {selectedDemand.trainingLocal && selectedDemand.trainingLocal !== 'N/A' && <><span className="text-slate-300">·</span><span>{selectedDemand.trainingLocal}</span></>}
                  {selectedDemand.corredor && <><span className="text-slate-300">·</span><span>{selectedDemand.corredor}</span></>}
                  {selectedDemand.demandState && <><span className="text-slate-300">·</span><span>{selectedDemand.demandState}</span></>}
                </span>
              </div>

              {/* HYBRID: practice period */}
              {selectedDemand.modality === 'HIBRIDO' && (
                <div className="mt-3 p-3 bg-purple-50 rounded-xl border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black text-purple-800 uppercase flex items-center gap-1">
                      <Globe size={12} /> Período Presencial (Prática)
                    </p>
                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                      selectedDemand.practiceStartDate ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-500 border-slate-200'
                    }`}>{selectedDemand.practiceStartDate ? 'DEFINIDO' : 'PENDENTE'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      value={hybridForm.practiceStartDate}
                      min={selectedDemand.startDate.split('T')[0]}
                      max={selectedDemand.endDate.split('T')[0]}
                      onChange={e => setHybridForm(prev => ({ ...prev, practiceStartDate: e.target.value }))}
                    />
                    <input type="date" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                      value={hybridForm.practiceEndDate}
                      min={selectedDemand.startDate.split('T')[0]}
                      max={selectedDemand.endDate.split('T')[0]}
                      onChange={e => setHybridForm(prev => ({ ...prev, practiceEndDate: e.target.value }))}
                    />
                  </div>
                  <button onClick={handleSaveHybridPractice}
                    disabled={!hybridForm.practiceStartDate || !hybridForm.practiceEndDate}
                    className={`w-full mt-2 py-2 rounded-lg font-black text-[9px] uppercase tracking-widest transition ${
                      hybridForm.practiceStartDate && hybridForm.practiceEndDate
                        ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-sm'
                        : 'bg-slate-200 text-slate-400'
                    }`}>
                    Salvar período prática
                  </button>
                </div>
              )}

              {/* Companion toggle (only when already allocated) */}
              {selectedDemand.instructorId && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => setIsCompanionPickerOpen(true)}
                    className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition bg-white text-slate-500 border-slate-200 hover:bg-slate-50">
                    <Users size={10} className="inline mr-1" />
                    ADD ACOMPANHANTE
                  </button>
                  {companionsForDemand.length > 0 && (
                    <span className="text-[9px] font-bold text-emerald-600">{companionsForDemand.length} acomp.</span>
                  )}
                </div>
              )}
            </div>

            {/* A seleção de acompanhante (instrutor + dias) mora no
                CompanionPicker, compartilhado com a tela de Logística. */}
            {selectedDemand && (
              <CompanionPicker
                open={isCompanionPickerOpen}
                demand={selectedDemand}
                instructors={instructors}
                alreadyCompanionIds={companionsForDemand.map((a: any) => a.instructorId)}
                hasScheduleConflict={hasScheduleConflict}
                getConflictDetails={id => getConflictDetails(id, selectedDemand)}
                onCancel={() => setIsCompanionPickerOpen(false)}
                onConfirm={handleConfirmCompanion}
              />
            )}

            {/* Instructor list */}
            <div className="p-3 space-y-1.5">
              {/* Suggested */}
              {recommendation.suggested.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                    <MapPin size={10} className="text-blue-500" /> SUGERIDOS ({recommendation.suggested.length})
                  </p>
                  {recommendation.suggested.map(inst => (
                    <InstructorCard key={inst.id} instructor={inst} isException={false}
                      selectedDemand={selectedDemand} companionMode={companionMode} previewItems={previewItems}
                      onPreview={() => handleAddPreview(inst, selectedDemand, false)}
                      onAllocate={() => handleAllocateDirect(inst)}
                      onCompanionDays={() => { setPendingCompanionInstructorId(inst.id); setCompanionSelectedDays([]); }}
                      hasScheduleConflict={hasScheduleConflict}
                    />
                  ))}
                </div>
              )}

              {/* Exceptions */}
              {recommendation.exceptions.length > 0 && (
                <div className="mt-2">
                  <div className="relative mb-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-2 text-[9px] font-black text-slate-400 uppercase flex items-center gap-1">
                        <AlertTriangle size={9} className="text-amber-500" /> Exceções ({recommendation.exceptions.length})
                      </span>
                    </div>
                  </div>
                  {recommendation.exceptions.map(inst => (
                    <InstructorCard key={inst.id} instructor={inst} isException={true}
                      selectedDemand={selectedDemand} companionMode={companionMode} previewItems={previewItems}
                      onPreview={() => handleAddPreview(inst, selectedDemand, true)}
                      onAllocate={() => handleAllocateDirect(inst)}
                      onCompanionDays={() => { setPendingCompanionInstructorId(inst.id); setCompanionSelectedDays([]); }}
                      hasScheduleConflict={hasScheduleConflict}
                    />
                  ))}
                </div>
              )}

              {/* Já alocados neste dia */}
              {recommendation.alreadyAllocated.length > 0 && (
                <div className="mt-2">
                  <div className="relative mb-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-amber-200" /></div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-2 text-[9px] font-black text-amber-600 uppercase flex items-center gap-1">
                        <AlertTriangle size={9} className="text-amber-500" /> Já alocados neste dia ({recommendation.alreadyAllocated.length})
                      </span>
                    </div>
                  </div>
                  {recommendation.alreadyAllocated.map((inst: Instructor & { score: number }) => (
                    <InstructorCard key={inst.id} instructor={inst} isException={false} isAlreadyAllocated={true}
                      selectedDemand={selectedDemand} companionMode={companionMode} previewItems={previewItems}
                      onPreview={() => {}}
                      onAllocate={() => handleAllocateAnyway(inst)}
                      onCompanionDays={() => { setPendingCompanionInstructorId(inst.id); setCompanionSelectedDays([]); }}
                      hasScheduleConflict={hasScheduleConflict}
                    />
                  ))}
                </div>
              )}

              {recommendation.suggested.length === 0 && recommendation.exceptions.length === 0 && recommendation.alreadyAllocated.length === 0 && (
                <div className="flex flex-col items-center p-6 text-center text-slate-400">
                  <Info size={28} className="mb-2 opacity-30" />
                  <p className="text-xs font-bold">Nenhum instrutor disponível.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const modalJSX = pendingForceAlloc && selectedDemand ? (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-4 w-full">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />
          <p className="text-sm text-slate-700 leading-relaxed">
            <span className="font-bold">{pendingForceAlloc.name}</span> já possui um
            treinamento alocado no período de{' '}
            <span className="font-bold">{formatDateBR(selectedDemand.startDate)}</span>
            {selectedDemand.startDate.split('T')[0] !== selectedDemand.endDate.split('T')[0] && (
              <> a <span className="font-bold">{formatDateBR(selectedDemand.endDate)}</span></>
            )}.
            {' '}Deseja realmente alocar mais um treinamento para ele?
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setPendingForceAlloc(null)}
            className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition">
            Cancelar
          </button>
          <button onClick={handleConfirmForceAlloc}
            className="px-4 py-2 text-xs font-bold text-amber-700 border border-amber-400 rounded-lg hover:bg-amber-50 transition">
            Confirmar mesmo assim
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {createPortal(panelJSX, document.body)}
      {modalJSX && createPortal(modalJSX, document.body)}
    </>
  );
};

export default AllocationDrawer;
