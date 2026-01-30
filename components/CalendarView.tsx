import React, { useState, useMemo } from 'react';
import { useApp } from '../App';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Calendar as CalendarIcon,
  Clock,
  Trash2,
  CalendarDays,
  Info,
  Truck,
  Building,
  GraduationCap,
  Tag,
  MapPin,
  MessageSquare
} from 'lucide-react';
import { AgendaItem, AgendaType, Demand, Instructor } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { useAuth } from '../contexts/AuthContext';
import { formatDemandLabel } from '../domain/demandStatus';

// Configuração visual para cada tipo de compromisso
const AGENDA_STYLING: Record<string, { bg: string; text: string; border: string }> = {
  FOLGA: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  INDISPONIVEL: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  ESCRITORIO: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  DESCANSO: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  OUTRO: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  TREINAMENTO: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-700' },
  'MANUTENÇÃO': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'DESLOCAMENTO': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  EVENTO: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  RESERVADO: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' }
};

const AGENDA_TYPES: AgendaType[] = ['FOLGA', 'ESCRITORIO', 'INDISPONIVEL', 'DESCANSO', 'OUTRO'];
const MOBILE_AGENDA_TYPES = ['MANUTENÇÃO', 'DESLOCAMENTO', 'EVENTO', 'RESERVADO'];

interface UnifiedItem {
  id: string;
  instructorId: string;
  startDate: string;
  endDate: string;
  type: AgendaType;
  title: string;
  source: 'MANUAL' | 'DEMANDA' | 'EVENT' | 'ALLOCATION' | 'COMPANION';
  description?: string;
  calculatedStatus?: string;
  demandId?: string;
  isCompanion?: boolean;
  companionAllocationId?: string;

}

interface MobileResourceEvent {
  id: string;
  title: string;
  startDate: string; // pode ser YYYY-MM-DD ou YYYY-MM-DDTHH:mm
  endDate: string; // pode ser YYYY-MM-DD ou YYYY-MM-DDTHH:mm
  description?: string;
}

/** =========================
 *  HELPERS (FIX TIMEZONE)
 *  ========================= */

const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const getDatePart = (s: string) => {
  if (!s) return '';
  return s.includes('T') ? s.split('T')[0] : s;
};

const parseLocalDateOnly = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0); // meio-dia local
};

const parseAnyToDate = (s: string) => {
  if (!s) return new Date(NaN);
  if (isDateOnly(s)) return parseLocalDateOnly(s);
  return new Date(s);
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

const getDayBoundsForIteration = (startStr: string, endStr: string) => {
  const start = dayStart(parseAnyToDate(startStr));
  const end = dayStart(parseAnyToDate(endStr));
  return { start, end };
};

// Para exibição: se vier só data (sem hora), assume 08:00 / 18:00
const ensureDateTimeForDisplay = (s: string, kind: 'start' | 'end') => {
  if (!s) return s;

  // se vier só data
  if (isDateOnly(s)) return `${s}T${kind === 'start' ? '08:00' : '18:00'}`;

  // ✅ se vier com timezone (Z ou +00:00 / -03:00), remove pra não converter horário
  // exemplos:
  // 2026-01-28T14:00:00.000Z -> 2026-01-28T14:00
  // 2026-01-28T14:00:00-03:00 -> 2026-01-28T14:00
  const noTz = s
    .replace(/\.\d{3}Z$/, '')                 // remove .000Z
    .replace(/Z$/, '')                        // remove Z final
    .replace(/([+-]\d{2}:\d{2})$/, '');        // remove offset final

  // corta segundos se existir (opcional, mas ajuda a padronizar)
  // 2026-01-28T14:00:00 -> 2026-01-28T14:00
  const noSeconds = noTz.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/, '$1');

  return noSeconds;
};


function resolveLinkedDemand(item: UnifiedItem | null, demands: Demand[]): Demand | null {
  if (!item) return null;
  if (item.source !== 'DEMANDA' && item.source !== 'ALLOCATION' && item.source !== 'COMPANION') return null;
  return demands.find(d => d.id === (item.demandId || item.id)) || null;
}

const CalendarView: React.FC = () => {
  const {
    instructors,
    demands,
    agendaItems,
    trainings,
    instructorAllocations,
    companionAllocations,
    resourceAllocations,
    companies,
    addAgendaItem,
    updateAgendaItem,
    removeAgendaItem,
    deallocateInstructor,
    updateDemand,
    hasScheduleConflict,
    removeInstructorAllocation,
    removeCompanionAllocation,
    addInstructorAllocation,
    updateInstructorAllocation, 
    removeResourceAllocation,
    hasResourceConflict,
    setNotification
  } = useApp();

  const { profile } = useAuth();
  const isCoordinator = profile?.role === 'coordenador';

  const [mobileResourceEvents, setMobileResourceEvents] = useState<MobileResourceEvent[]>([]);
  const [activeMobileEvent, setActiveMobileEvent] = useState<MobileResourceEvent | null>(null);
  const [isMobileContext, setIsMobileContext] = useState(false);
  const [extraInfo, setExtraInfo] = useState<Record<string, { coverage: string; residence: string }>>({});

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'VIEW' | 'CREATE' | 'EDIT'>('VIEW');
  const [activeItem, setActiveItem] = useState<UnifiedItem | null>(null);
  const linked = resolveLinkedDemand(activeItem, demands);
  const [modalInstructor, setModalInstructor] = useState<Instructor | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<{ instructorId: string; date: Date } | null>(null);
  const [formType, setFormType] = useState<string>('FOLGA');
  const [formEndDate, setFormEndDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('08:00');
  const [formEndTime, setFormEndTime] = useState('18:00');
  const [formDescription, setFormDescription] = useState('');
  const [modalObs, setModalObs] = useState('');

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handlePrevMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  
  const buildDemandTitle = React.useCallback(
  (d: Demand) => {
    const training = trainings.find(t => t.id === d.trainingId);
    const company = companies.find(c => c.id === d.companyId);

    return `${d.id} • ${company?.name ?? 'Empresa'} • ${training?.nr ?? 'Treinamento'}`;
  },
  [trainings, companies]
);




  const daysInView = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysCount = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysCount }, (_, i) => new Date(year, month, i + 1));
  }, [currentDate]);

  /** =========================
   *  1) CENTRO MÓVEL (CTM)
   *  ========================= */
  const mobileAgendaByDay = useMemo(() => {
    const map: Record<
      string,
      { title: string; source: 'MIRROR' | 'LOCAL'; id: string; start: string; end: string; description?: string }
    > = {};

    // Local Maintenance/Events
    mobileResourceEvents.forEach(evt => {
      const { start, end } = getDayBoundsForIteration(evt.startDate, evt.endDate);
      const cursor = new Date(start);
      while (cursor <= end) {
        map[formatDateKey(cursor)] = {
          id: evt.id,
          title: evt.title,
          source: 'LOCAL',
          start: evt.startDate,
          end: evt.endDate,
          description: evt.description
        };
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    // Mirrored Resource Allocations (CTM por período)
    resourceAllocations
      .filter(a => a.resourceType === 'CENTRO_TREINAMENTO_MOVEL')
      .forEach(a => {
        const d = demands.find(dm => dm.id === a.demandId);
        if (!d || d.status === 'CANCELADA') return;

        const { start, end } = getDayBoundsForIteration(a.startDate, a.endDate);
        const cursor = new Date(start);
        const training = trainings.find(t => t.id === d.trainingId);
       const company = companies.find(c => c.id === d.companyId);

        const base = formatDemandLabel({
        trainingNr: training?.nr,
        companyName: company?.name,
        startDate: ensureDateTimeForDisplay(a.startDate, 'start'),
        endDate: ensureDateTimeForDisplay(a.endDate, 'end')
      });

      const formattedTitle = `${d.id} • ${base}`;


        while (cursor <= end) {
          map[formatDateKey(cursor)] = {
            id: a.id,
            title: formattedTitle,
            source: 'MIRROR',
            start: a.startDate,
            end: a.endDate,
            description: d.trainingLocal
          };
          cursor.setDate(cursor.getDate() + 1);
        }
      });

    return map;
  }, [mobileResourceEvents, resourceAllocations, demands, trainings, companies]);

  /** =========================
   *  2) AGENDA INSTRUTORES
   *  ========================= */
  const agendaByDay = useMemo(() => {
    const map: Record<string, UnifiedItem> = {};
    const demandsWithExplicitAllocations = new Set(instructorAllocations.map(a => a.demandId));
    const demandsWithCompanions = new Set(companionAllocations.map(a => a.demandId));

    agendaItems.forEach(item => {
      const { start, end } = getDayBoundsForIteration(item.startDate, item.endDate);
      const cursor = new Date(start);
      while (cursor <= end) {
        map[`${item.instructorId}-${formatDateKey(cursor)}`] = {
          id: item.id,
          instructorId: item.instructorId,
          startDate: item.startDate,
          endDate: item.endDate,
          type: item.type,
          title: item.title,
          source: 'MANUAL',
          description: item.description
        };
        cursor.setDate(cursor.getDate() + 1);
      }
    });

   // PRIORIDADE 1: InstructorAllocations
    instructorAllocations.forEach(a => {
      const d = demands.find(dm => dm.id === a.demandId);
      if (!d || d.status === 'CANCELADA') return;
      

 
    const allocStart = ensureDateTimeForDisplay(a.startDate, 'start');
    const allocEnd = ensureDateTimeForDisplay(a.endDate, 'end');

    let displayStart = allocStart;
    let displayEnd = allocEnd;

    // ✅ HÍBRIDO: agenda só mostra PRÁTICA, mas respeitando o split do allocation (interseção)
    if (d.modality === 'HIBRIDO' && d.practiceStartDate && d.practiceEndDate) {
      const practiceStart = ensureDateTimeForDisplay(d.practiceStartDate, 'start');
      const practiceEnd = ensureDateTimeForDisplay(d.practiceEndDate, 'end');

      const startDate = parseAnyToDate(displayStart);
      const endDate = parseAnyToDate(displayEnd);
      const pStartDate = parseAnyToDate(practiceStart);
      const pEndDate = parseAnyToDate(practiceEnd);

      // max(start)
      displayStart = startDate > pStartDate ? displayStart : practiceStart;
      // min(end)
      displayEnd = endDate < pEndDate ? displayEnd : practiceEnd;

      // sem sobreposição? não renderiza nada
      if (parseAnyToDate(displayStart) > parseAnyToDate(displayEnd)) return;
    }


      const { start, end } = getDayBoundsForIteration(displayStart, displayEnd);
      const cursor = new Date(start);

      const training = trainings.find(t => t.id === d.trainingId);
      const company = companies.find(c => c.id === d.companyId);

      const base = formatDemandLabel({
      trainingNr: training?.nr,
      companyName: company?.name,
      startDate: ensureDateTimeForDisplay(a.startDate, 'start'),
      endDate: ensureDateTimeForDisplay(a.endDate, 'end')
    });

    const formattedTitle = `${d.id} • ${base}`;



      const cStatus = calculateDemandStatus({ ...d, cancelled: false });

      while (cursor <= end) {
        map[`${a.instructorId}-${formatDateKey(cursor)}`] = {
          id: a.id,
          instructorId: a.instructorId,
          startDate: displayStart,  // ✅ agora reflete prática no híbrido
          endDate: displayEnd,      // ✅ agora reflete prática no híbrido
          type: 'TREINAMENTO',
          title: formattedTitle,
          source: 'ALLOCATION',
          description: d.trainingLocal,
          calculatedStatus: cStatus,
          demandId: d.id
        };
        cursor.setDate(cursor.getDate() + 1);
      }
});

// PRIORIDADE 1.5: CompanionAllocations (instrutor acompanhante)
companionAllocations.forEach(ca => {
  const d = demands.find(dm => dm.id === ca.demandId);
  if (!d || d.status === 'CANCELADA') return;

  // Período sempre baseado no companion allocation
  let displayStart = ensureDateTimeForDisplay(ca.startDate, 'start');
  let displayEnd = ensureDateTimeForDisplay(ca.endDate, 'end');

  // HÍBRIDO: mostra apenas prática, mas respeita o split do companion allocation
  if (d.modality === 'HIBRIDO' && d.practiceStartDate && d.practiceEndDate) {
    const practiceStart = ensureDateTimeForDisplay(d.practiceStartDate, 'start');
    const practiceEnd = ensureDateTimeForDisplay(d.practiceEndDate, 'end');

    const startDate = parseAnyToDate(displayStart);
    const endDate = parseAnyToDate(displayEnd);
    const pStartDate = parseAnyToDate(practiceStart);
    const pEndDate = parseAnyToDate(practiceEnd);

    displayStart = startDate > pStartDate ? displayStart : practiceStart;
    displayEnd = endDate < pEndDate ? displayEnd : practiceEnd;

    if (parseAnyToDate(displayStart) > parseAnyToDate(displayEnd)) return;
  }

  const { start, end } = getDayBoundsForIteration(displayStart, displayEnd);
  const cursor = new Date(start);

  const training = trainings.find(t => t.id === d.trainingId);
  const company = companies.find(c => c.id === d.companyId);

  const base = formatDemandLabel({
    trainingNr: training?.nr,
    companyName: company?.name,
    startDate: ensureDateTimeForDisplay(ca.startDate, 'start'),
    endDate: ensureDateTimeForDisplay(ca.endDate, 'end')
  });

  const formattedTitle = `${d.id} • ${base}`;
  const cStatus = calculateDemandStatus({ ...d, cancelled: false });

  while (cursor <= end) {
    map[`${ca.instructorId}-${formatDateKey(cursor)}`] = {
      id: ca.id, // id do companion allocation
      instructorId: ca.instructorId,
      startDate: displayStart,
      endDate: displayEnd,
      type: 'TREINAMENTO',
      title: formattedTitle,
      source: 'COMPANION',
      description: d.trainingLocal,
      calculatedStatus: cStatus,
      demandId: d.id,
      isCompanion: true,
      companionAllocationId: ca.id
    };
    cursor.setDate(cursor.getDate() + 1);
  }
});


    // PRIORIDADE 2: Demandas sem Allocation (Instrutor único / Legado)
    demands
      .filter( d => d.status !== 'CANCELADA' && !!d.instructorId && !demandsWithExplicitAllocations.has(d.id) && !demandsWithCompanions.has(d.id))
      .forEach(d => {
        // 🔥 Se for HÍBRIDO e existir prática definida, a agenda deve mostrar APENAS a prática
        const effectiveStart =
          d.modality === 'HIBRIDO' && d.practiceStartDate && d.practiceEndDate ? d.practiceStartDate : d.startDate;

        const effectiveEnd =
          d.modality === 'HIBRIDO' && d.practiceStartDate && d.practiceEndDate ? d.practiceEndDate : d.endDate;

        const start = parseAnyToDate(ensureDateTimeForDisplay(effectiveStart, 'start'));
        const end = parseAnyToDate(ensureDateTimeForDisplay(effectiveEnd, 'end'));

        const cursor = new Date(start);

        const formattedTitle = buildDemandTitle(d);


        const cStatus = calculateDemandStatus({ ...d, cancelled: false });

        while (cursor <= end) {
          map[`${d.instructorId}-${formatDateKey(cursor)}`] = {
            id: d.id,
            instructorId: d.instructorId!,
            startDate: effectiveStart,
            endDate: effectiveEnd,
            type: 'TREINAMENTO',
            title: formattedTitle,
            source: 'DEMANDA',
            description: d.trainingLocal,
            calculatedStatus: cStatus,
            demandId: d.id
          };
          cursor.setDate(cursor.getDate() + 1);
        }
      });

    return map;
  }, [agendaItems, instructorAllocations, companionAllocations, demands, trainings, companies, buildDemandTitle]);

  const hasCompanionForDemand = (demandId?: string) => {
  if (!demandId) return false;
  return companionAllocations.some(ca => ca.demandId === demandId);
};


  const handleDragStart = (e: React.DragEvent, item: UnifiedItem) => {
    if (isCoordinator) {
      e.preventDefault();
      return;
    }
    if (item.source !== 'DEMANDA' && item.source !== 'ALLOCATION') return;
    e.dataTransfer.setData('source', item.source);
    e.dataTransfer.setData('itemId', item.id);
  };

  const handleDrop = (e: React.DragEvent, targetInstructorId: string) => {
    e.preventDefault();
    if (isCoordinator) return;

    const source = e.dataTransfer.getData('source');
    const itemId = e.dataTransfer.getData('itemId');
    if (!itemId) return;

    if (source === 'DEMANDA') {
      const demand = demands.find(d => d.id === itemId);
      if (!demand) {
        setNotification({ message: 'Demanda não encontrada ou foi alterada por outro usuário.', type: 'error' });
        return;
      }
      if (demand.instructorId === targetInstructorId) return;

      if (hasScheduleConflict(targetInstructorId, demand.startDate, demand.endDate, demand.id)) {
        setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
        return;
      }

      updateDemand({ ...demand, instructorId: targetInstructorId });
    } else if (source === 'ALLOCATION') {
      const allocation = instructorAllocations.find(a => a.id === itemId);
      if (!allocation) return;
      if (allocation.instructorId === targetInstructorId) return;

      // ✅ ALTERAÇÃO (bugfix): não remover + recriar (isso derruba status da demanda)
      // usamos update mantendo o mesmo id
      const demand = demands.find(d => d.id === allocation.demandId);

      const effectiveStart =
        demand?.modality === 'HIBRIDO' && demand.practiceStartDate && demand.practiceEndDate
          ? demand.practiceStartDate
          : allocation.startDate;

      const effectiveEnd =
        demand?.modality === 'HIBRIDO' && demand.practiceStartDate && demand.practiceEndDate
          ? demand.practiceEndDate
          : allocation.endDate;

      if (hasScheduleConflict(targetInstructorId, effectiveStart, effectiveEnd, demand?.id, undefined, allocation.id)) {
        setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
        return;
      }

      updateInstructorAllocation({ ...allocation, instructorId: targetInstructorId });
    }
  };

  const handleCellClick = (instructor: Instructor, date: Date) => {
    if (profile?.role === 'coordenador') return;

    const key = `${instructor.id}-${formatDateKey(date)}`;
    const existing = agendaByDay[key];

    setModalInstructor(instructor);
    setIsMobileContext(false);

    if (existing) {
      const linkedDemand =
        existing.source === 'DEMANDA' || existing.source === 'ALLOCATION'
          ? demands.find(d => d.id === (existing.demandId || existing.id))
          : null;

      setActiveItem(existing);
      setModalObs(linkedDemand?.observations || existing.description || '');
      setModalMode('VIEW');
      setIsModalOpen(true);
    } else {
      setSelectedSlot({ instructorId: instructor.id, date });
      setFormType('FOLGA');
      setFormEndDate(formatDateKey(date));
      setFormStartTime('08:00');
      setFormEndTime('18:00');
      setFormDescription('');
      setModalObs('');
      setModalMode('CREATE');
      setIsModalOpen(true);
    }
  };

  const handleMobileCellClick = (date: Date) => {
    if (isCoordinator) return;

    const key = formatDateKey(date);
    const item = mobileAgendaByDay[key];

    if (item) {
      if (item.source === 'MIRROR') {
        const allocation = resourceAllocations.find(a => a.id === item.id);
        if (allocation) {
          const demand = demands.find(d => d.id === allocation.demandId);
          if (demand) {
            const instructor = instructors.find(i => i.id === demand.instructorId);

            setModalInstructor(instructor || null);
            setActiveItem({
              id: allocation.id,
              instructorId: demand.instructorId || '',
              startDate: ensureDateTimeForDisplay(allocation.startDate, 'start'),
              endDate: ensureDateTimeForDisplay(allocation.endDate, 'end'),
              type: 'TREINAMENTO',
              title: item.title,
              source: 'ALLOCATION',
              description: demand.trainingLocal,
              calculatedStatus: calculateDemandStatus({ ...demand, cancelled: false }),
              demandId: demand.id
            });

            setModalObs(demand.observations || '');
            setModalMode('VIEW');
            setIsMobileContext(true);
            setIsModalOpen(true);
          }
        }
      } else {
        setActiveMobileEvent({
          id: item.id,
          title: item.title,
          startDate: item.start,
          endDate: item.end,
          description: item.description
        });
      }
    } else {
      setSelectedSlot({ instructorId: 'MOBILE_RESOURCE', date });
      setFormType('MANUTENÇÃO');
      setFormEndDate(formatDateKey(date));
      setFormStartTime('08:00');
      setFormEndTime('18:00');
      setFormDescription('');
      setModalObs('');
      setModalMode('CREATE');
      setIsMobileContext(true);
      setIsModalOpen(true);
    }
  };

  const handleSaveManual = () => {
    if (!selectedSlot) return;

    const startDateStr = `${formatDateKey(selectedSlot.date)}T${formStartTime}`;
    const endDateStr = `${formEndDate}T${formEndTime}`;

    if (hasScheduleConflict(selectedSlot.instructorId, startDateStr, endDateStr)) {
      setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
      return;
    }

    const item: AgendaItem = {
      id: `AG-${Date.now()}`,
      instructorId: selectedSlot.instructorId,
      startDate: startDateStr,
      endDate: endDateStr,
      type: formType as AgendaType,
      title: formType,
      source: 'MANUAL',
      description: formDescription
    };

    addAgendaItem(item);
    setIsModalOpen(false);
  };

  const handleSaveMobile = () => {
    if (!selectedSlot || !formEndDate || !formDescription.trim()) return;

    const startDateTime = `${formatDateKey(selectedSlot.date)}T${formStartTime}`;
    const endDateTime = `${formEndDate}T${formEndTime}`;

    // Mantém o conflito do CTM por período (dia) como já era
    const startDay = getDatePart(startDateTime);
    const endDay = getDatePart(endDateTime);

    if (hasResourceConflict(startDay, endDay)) {
      setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
      return;
    }

    // Conflito com eventos locais (por dia) como já era
    const hasLocalConflict = mobileResourceEvents.some(evt => {
      const evtStart = getDatePart(evt.startDate);
      const evtEnd = getDatePart(evt.endDate);
      return startDay <= evtEnd && endDay >= evtStart;
    });

    if (hasLocalConflict) {
      setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
      return;
    }

    const newEvent: MobileResourceEvent = {
      id: `MOBILE-${Date.now()}`,
      title: formType,
      startDate: startDateTime,
      endDate: endDateTime,
      description: formDescription
    };

    setMobileResourceEvents(prev => [...prev, newEvent]);
    setIsModalOpen(false);
  };

  const handleUpdateObservation = () => {
    if (!activeItem) return;

    if (activeItem.source === 'MANUAL') {
      const original = agendaItems.find(i => i.id === activeItem.id);
      if (original) updateAgendaItem({ ...original, description: modalObs });
    } else {
      const dId = activeItem.demandId || activeItem.id;
      const demand = demands.find(d => d.id === dId);
      if (demand) updateDemand({ ...demand, observations: modalObs });
    }

    setNotification({ message: 'Observação atualizada com sucesso.', type: 'success' });
    setIsModalOpen(false);
  };

  const removeCTMForDemandIfAny = (demandId: string) => {
  const ctmAllocs = resourceAllocations.filter(
    a => a.resourceType === 'CENTRO_TREINAMENTO_MOVEL' && a.demandId === demandId
  );

  ctmAllocs.forEach(a => removeResourceAllocation(a.id));
};
 
const removeCompanionsForDemandIfAny = (demandId: string) => {
  const comps = companionAllocations.filter(ca => ca.demandId === demandId);
  comps.forEach(ca => removeCompanionAllocation(ca.id));
};

  const handleRemoveAction = () => {
  if (!activeItem) return;

  // ✅ Se for uma demanda (ou allocation) e existir CTM / acompanhantes ligados, remove junto
  if (activeItem.source === 'DEMANDA' || activeItem.source === 'ALLOCATION') {
    const demandId = activeItem.demandId || activeItem.id; // DEMANDA usa id, ALLOCATION usa demandId
    removeCTMForDemandIfAny(demandId);
    removeCompanionsForDemandIfAny(demandId);
  }


  // fluxo atual (sem inventar nada novo)
  if (isMobileContext) {
    removeResourceAllocation(activeItem.id);
  } else if (activeItem.source === 'DEMANDA') {
    deallocateInstructor(activeItem.id);
  } else if (activeItem.source === 'ALLOCATION') {
    removeInstructorAllocation(activeItem.id);
  } else {
    removeAgendaItem(activeItem.id); // MANUAL (ou qualquer outro que caia aqui)
  }

  setIsModalOpen(false);
};



  const handleRemoveMobileEvent = () => {
    if (activeMobileEvent) setMobileResourceEvents(prev => prev.filter(e => e.id !== activeMobileEvent.id));
    setActiveMobileEvent(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Agenda de Instrutores</h1>
          <p className="text-sm text-gray-500">Suporte a múltiplos instrutores e controle de alocação por períodos.</p>
        </div>
        <div className="flex items-center space-x-1 bg-white rounded-xl p-1 border border-gray-200 shadow-sm">
          <button onClick={handlePrevMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition">
            <ChevronLeft size={18} />
          </button>
          <div className="px-6 py-2 text-sm font-bold text-gray-800 capitalize min-w-[150px] text-center">
            {currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </div>
          <button onClick={handleNextMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-max w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200">
                <th className="p-4 border-r border-gray-200 text-left min-w-[200px] font-black text-[10px] uppercase tracking-widest text-slate-400 sticky left-0 z-30 bg-slate-50">
                  Instrutor
                </th>
                <th className="px-2 py-4 border-r border-gray-200 text-left w-[85px] min-w-[85px] font-black text-[8px] uppercase tracking-tighter text-slate-400 bg-slate-50 leading-tight">
                  Localidade
                </th>
                <th className="px-2 py-4 border-r border-gray-200 text-left w-[85px] min-w-[85px] font-black text-[8px] uppercase tracking-tighter text-slate-400 bg-slate-50 leading-tight">
                  Local (Residência)
                </th>
                {daysInView.map((day, idx) => (
                  <th
                    key={idx}
                    className={`p-2 border-r border-gray-100 min-w-[75px] text-center ${day.getDay() % 6 === 0 ? 'bg-slate-100/40' : ''}`}
                  >
                    <div className="text-[9px] font-black text-slate-400 uppercase leading-none mb-1">
                      {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
                    </div>
                    <div className="text-sm font-bold text-slate-800">{day.getDate()}</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {instructors
                .filter(i => i.status === 'ATIVO')
                .map(instructor => (
                <tr
                  key={instructor.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-slate-50/10 transition-colors"
                >
                  {/* COLUNA INSTRUTOR (ajustada p/ auto-height) */}
                  <td className="p-3 border-r border-gray-100 font-bold text-slate-700 bg-white sticky left-0 z-20 shadow-sm align-top">
                    <div className="h-full flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-black text-[10px] border border-blue-100">
                        {instructor.name.charAt(0)}
                      </div>
                      <span className="truncate max-w-[140px] font-bold text-slate-600">{instructor.name}</span>
                    </div>
                  </td>

                  <td className="px-1 py-2 border-r border-gray-100 bg-white align-top">
                    <input
                      type="text"
                      placeholder="Atende..."
                      className="w-full text-[9px] font-bold p-0.5 border border-transparent rounded bg-transparent outline-none focus:border-blue-300"
                      value={extraInfo[instructor.id]?.coverage || ''}
                      onChange={e =>
                        setExtraInfo({
                          ...extraInfo,
                          [instructor.id]: { ...extraInfo[instructor.id], coverage: e.target.value }
                        })
                      }
                    />
                  </td>

                  <td className="px-1 py-2 border-r border-gray-100 bg-white align-top">
                    <input
                      type="text"
                      placeholder="Reside..."
                      className="w-full text-[9px] font-bold p-0.5 border border-transparent rounded bg-transparent outline-none focus:border-blue-300"
                      value={extraInfo[instructor.id]?.residence || ''}
                      onChange={e =>
                        setExtraInfo({
                          ...extraInfo,
                          [instructor.id]: { ...extraInfo[instructor.id], residence: e.target.value }
                        })
                      }
                    />
                  </td>
                    {daysInView.map(day => {
                      const dateKey = `${instructor.id}-${formatDateKey(day)}`;
                      const item = agendaByDay[dateKey];
                      const cellItem = item ? { type: 'INSTRUCTOR_EVENT', data: item } : null;

                      return (
                    <td
                      key={dateKey}
                      onClick={() => handleCellClick(instructor, day)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDrop(e, instructor.id)}
                      className={`p-1 border-r border-gray-100 h-16 cursor-pointer transition-all ${
                      day.getDay() % 6 === 0 ? 'bg-slate-50/50' : ''
                    }`}

                    >
                  {cellItem && (
                    <div
                      draggable={
                        !isCoordinator &&
                        (cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION')
                      }
                      onDragStart={!isCoordinator ? e => handleDragStart(e, cellItem.data) : undefined}
                      className={(() => {
                        const anyData = cellItem.data as any;

                        const isCompanion =
                          !!anyData?.isCompanion ||
                          anyData?.role === 'COMPANION' ||
                          anyData?.kind === 'COMPANION' ||
                          anyData?.allocationType === 'COMPANION' ||
                          anyData?.source === 'COMPANION';

                        const baseBg = AGENDA_STYLING[cellItem.data.type]?.bg || 'bg-gray-100';
                        const baseText = AGENDA_STYLING[cellItem.data.type]?.text || 'text-gray-600';
                        const baseBorder = AGENDA_STYLING[cellItem.data.type]?.border || 'border-gray-200';

                        // ✅ Companion: força VERDE
                        const companionBg = 'bg-emerald-600';
                        const companionText = 'text-white';
                        const companionBorder = 'border-emerald-700';

                        return `w-full h-full rounded-lg border shadow-sm p-1 flex flex-col items-center justify-center text-center overflow-hidden transition-all active:scale-95 relative ${
                          isCompanion ? companionBg : baseBg
                        } ${isCompanion ? companionText : baseText} ${
                          isCompanion ? companionBorder : baseBorder
                        }`;
                      })()}
                    >
                      {/* ✅ BOTÃO REMOVER (somente acompanhante) */}
                      {(() => {
                        const anyData = cellItem.data as any;

                        const isCompanion =
                          !!anyData?.isCompanion ||
                          anyData?.role === 'COMPANION' ||
                          anyData?.kind === 'COMPANION' ||
                          anyData?.allocationType === 'COMPANION' ||
                          anyData?.source === 'COMPANION';

                        if (!isCompanion) return null;

                        // precisa ser o ID da companionAllocation
                        const companionAllocationId = anyData?.id || anyData?.allocationId;
                        if (!companionAllocationId) return null;

                        return (
                          <button
                            type="button"
                            title="Remover acompanhante"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              removeCompanionAllocation(companionAllocationId);
                              setNotification?.({ type: 'success', message: 'Acompanhante removido da agenda.' });
                            }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/20 hover:bg-black/35 text-white flex items-center justify-center text-[12px] font-black leading-none"
                          >
                            ×
                          </button>
                        );
                      })()}

                      {(() => {
                        const anyData = cellItem.data as any;

                        const isCompanion =
                          !!anyData?.isCompanion ||
                          anyData?.role === 'COMPANION' ||
                          anyData?.kind === 'COMPANION' ||
                          anyData?.allocationType === 'COMPANION' ||
                          anyData?.source === 'COMPANION';

                        if (!isCompanion) return null;

                        return (
                          <div className="w-full mb-1 flex justify-center">
                            <span className="px-2 py-[2px] rounded-md text-[8px] font-black uppercase tracking-widest bg-white/20 text-white border border-white/25">
                              ACOMPANHANTE
                            </span>
                          </div>
                        );
                      })()}

                      {/* Linha principal */}
                      <span className="text-[9px] font-black uppercase tracking-tighter w-full leading-tight line-clamp-2">
                        {cellItem.data.title}
                      </span>

                      {/* Linha secundária: ID SAP / Pedido Cliente */}
                      {(() => {
                        const demandId =
                          cellItem.data.source === 'ALLOCATION'
                            ? cellItem.data.demandId
                            : cellItem.data.demandId || cellItem.data.id;

                        const demand = demands.find(d => d.id === demandId);
                        if (!demand?.clientDemandId) return null;

                        return (
                          <span className="text-[9px] font-semibold text-white/85 tracking-tight mt-0.5">
                            {demand.clientDemandId}
                          </span>
                        );
                      })()}

                      {/* ACOMPANHANTE (badge no card principal) */}
                      {(cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION') &&
                        (() => {
                          const demandId =
                            cellItem.data.source === 'ALLOCATION'
                              ? cellItem.data.demandId
                              : cellItem.data.demandId || cellItem.data.id;

                          const hasCompanion = hasCompanionForDemand(demandId);
                          if (!hasCompanion) return null;

                          return (
                            <span className="flex items-center justify-center opacity-80 leading-none">
                              <span className="text-[7px] font-black uppercase tracking-tight">
                                C/ ACOMPANHANTE
                              </span>
                            </span>
                          );
                        })()}

                      {/* CTM */}
                      {(cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION') &&
                        (() => {
                          const demandId =
                            cellItem.data.source === 'ALLOCATION'
                              ? cellItem.data.demandId
                              : cellItem.data.demandId || cellItem.data.id;

                          const hasCTM =
                            !!demandId &&
                            resourceAllocations.some(
                              a => a.resourceType === 'CENTRO_TREINAMENTO_MOVEL' && a.demandId === demandId
                            );

                          if (!hasCTM) return null;

                          return (
                            <span className="mt-0.5 flex items-center justify-center gap-1 opacity-80 pt-[1px]">
                              <Truck size={10} strokeWidth={2.75} />
                              <span className="text-[7px] font-black uppercase tracking-tight">CTM</span>
                            </span>
                          );
                        })()}
                    </div>
                  )}


                    </td>

                      );
                    })}
                  </tr>
                ))}
              {/* Linha Centro Móvel */}
              <tr className="bg-slate-50 border-t-2 border-slate-200 border-b border-gray-100">
               <td className="p-4 border-r border-gray-100 font-black text-[11px] text-amber-700 bg-[#fffbeb] sticky left-0 z-20 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 border border-amber-200 shadow-sm">
                  <Truck size={18} />
                </div>
                <span className="uppercase tracking-tight leading-tight">
                  Centro Móvel
                </span>
              </div>
            </td>
                <td className="p-4 border-r border-gray-100 bg-white"></td>
                <td className="p-4 border-r border-gray-100 bg-white"></td>

                {daysInView.map(day => {
                  const key = formatDateKey(day);
                  const item = mobileAgendaByDay[key];
                  const cellItem = item ? { type: item.source, data: item } : null;

                  if (!cellItem)
                    return (
                      <td
                    key={`mobile-${key}`}
                    onClick={() => handleMobileCellClick(day)}
                    className={`p-1 border-r border-gray-100 relative cursor-pointer overflow-hidden transition-all align-top ${
                      day.getDay() % 6 === 0 ? 'bg-slate-50/50' : ''
                    }`}
                      />
                    );

                  const isStart = getDatePart(cellItem.data.start) === key;

                  return (
                  <td
                    key={`mobile-${key}`}
                    onClick={() => handleMobileCellClick(day)}
                    className={`p-1 border-r border-gray-100 relative cursor-pointer overflow-hidden transition-all align-top ${
                      day.getDay() % 6 === 0 ? 'bg-slate-50/50' : ''
                    }`}
                    >
                      <div
                        className={`w-full min-h-[72px] rounded-lg border-2 p-1 flex flex-col items-center justify-center text-center overflow-hidden transition-all active:scale-95 leading-tight ${
                          cellItem.type === 'MIRROR'
                            ? 'border-dashed border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-solid border-slate-300 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {isStart ? (
                          <div className="w-full max-h-full overflow-hidden flex flex-col items-center">
                            <span className="text-[7px] font-black opacity-60 uppercase mb-0.5 tracking-tighter truncate w-full">
                              {cellItem.type === 'MIRROR' ? 'ALOCADO' : 'MANUTENÇÃO'}
                            </span>
                            <p className="text-[8px] font-bold uppercase truncate w-full px-0.5 leading-none">{cellItem.data.title}</p>
                          </div>
                        ) : (
                          <div className={`w-1.5 h-1.5 rounded-full ${cellItem.type === 'MIRROR' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL EVENTO LOCAL CTM */}
      {activeMobileEvent && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in no-print">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-[720px] max-h-[85vh] overflow-hidden flex flex-col animate-scale-up">
            <div className="p-6 pb-4 flex justify-between items-start border-b border-slate-100">
              <div>
                <h2 className="text-xl font-black text-amber-700 uppercase tracking-tight flex items-center gap-2">
                  <Truck size={20} /> EVENTO LOCAL
                </h2>
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-1">CENTRO DE TREINAMENTO MÓVEL</p>
              </div>
              <button onClick={() => setActiveMobileEvent(null)} className="text-slate-300 hover:text-slate-500 transition-colors">
                <X size={24} strokeWidth={2.5} />
              </button>
            </div>

            <div className="px-6 py-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
                <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">TÍTULO DO REGISTRO</label>
                <p className="text-sm font-black text-slate-700 uppercase">{activeMobileEvent.title}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
                <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">PERÍODO</label>
                <p className="text-xs font-bold text-slate-600">
                  {parseAnyToDate(ensureDateTimeForDisplay(activeMobileEvent.startDate, 'start')).toLocaleDateString('pt-BR')} até{' '}
                  {parseAnyToDate(ensureDateTimeForDisplay(activeMobileEvent.endDate, 'end')).toLocaleDateString('pt-BR')}
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
                <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">HORÁRIO</label>
                <p className="text-xs font-bold text-slate-600">
                  {parseAnyToDate(ensureDateTimeForDisplay(activeMobileEvent.startDate, 'start')).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}{' '}
                  às{' '}
                  {parseAnyToDate(ensureDateTimeForDisplay(activeMobileEvent.endDate, 'end')).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              {activeMobileEvent.description && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 min-h-[120px] shadow-sm">
                  <label className="block text-[8px] font-black text-slate-400 uppercase mb-2 tracking-widest">DETALHES E OBSERVAÇÕES</label>
                  <p className="text-xs font-medium text-slate-500 uppercase leading-relaxed">{activeMobileEvent.description}</p>
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleRemoveMobileEvent}
                className="flex-1 py-3.5 bg-red-50 text-red-600 rounded-2xl font-black text-[10px] uppercase border border-red-100 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} /> REMOVER REGISTRO
              </button>
              <button
                onClick={() => setActiveMobileEvent(null)}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all"
              >
                FECHAR VISUALIZAÇÃO
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PRINCIPAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in no-print">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col animate-scale-up">
            <div className="p-7 pb-4 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-black text-[#1e293b] uppercase tracking-tight">
                  {isMobileContext ? 'DETALHES DO RECURSO' : 'DETALHES DO REGISTRO'}
                </h2>
                <p className="text-xs font-bold text-slate-600 uppercase mt-0.5">
                  {isMobileContext ? 'Centro de Treinamento Móvel' : modalInstructor?.name}
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-300 hover:text-slate-600">
                <X size={24} strokeWidth={2.5} />
              </button>
            </div>

            <div className="p-7 pt-0 flex flex-col gap-3 border-t bg-white overflow-y-auto flex-1">
              {modalMode === 'VIEW' && activeItem ? (
                <>
              {(() => {
                const linkedDemand =
                  activeItem.source === 'DEMANDA' || activeItem.source === 'ALLOCATION'
                    ? demands.find(d => d.id === (activeItem.demandId || activeItem.id))
                    : null;

                if (!linkedDemand) return null;

                const company = companies.find(c => c.id === linkedDemand.companyId);
                const training = trainings.find(t => t.id === linkedDemand.trainingId);

                return (
                  <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Tag size={14} className="text-blue-500" />
                      <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                        DEMANDA: #{linkedDemand.id}
                      </span>
                    </div>

                    {/* ✅ ID do Cliente (SAP / Pedido / ID interno) */}
                    {linkedDemand.clientDemandId && (
                      <div className="flex items-center gap-2">
                        <Tag size={14} className="text-blue-400" />
                        <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">
                          ID: {linkedDemand.clientDemandId}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Building size={14} className="text-blue-400" />
                      <span className="text-xs font-bold text-slate-700">{company?.name || '---'}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <GraduationCap size={14} className="text-blue-400" />
                      <span className="text-xs font-medium text-slate-600">{training?.name || '---'}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info size={12} className="text-slate-400" />
                    <label className="text-[8px] font-black text-slate-400 uppercase">ORIGEM</label>
                  </div>

                  <span className="text-xs font-black text-slate-700">
                    {activeItem.source === 'ALLOCATION' ? 'ALOCAÇÃO' : activeItem.source}
                  </span>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CalendarDays size={12} className="text-slate-400" />
                    <label className="text-[8px] font-black text-slate-400 uppercase">TIPO</label>
                  </div>

                  <span className="text-xs font-black text-blue-600 uppercase">{activeItem.type}</span>
                </div>
              </div>


                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <CalendarIcon size={12} className="text-slate-400" />
                      <label className="text-[8px] font-black text-slate-400 uppercase">PERÍODO</label>
                    </div>
                    <p className="text-xs font-bold text-slate-700">
                      {parseAnyToDate(activeItem.startDate).toLocaleDateString('pt-BR')} até{' '}
                      {parseAnyToDate(activeItem.endDate).toLocaleDateString('pt-BR')}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock size={12} className="text-slate-400" />
                      <label className="text-[8px] font-black text-slate-400 uppercase">HORÁRIO</label>
                    </div>
                    <p className="text-xs font-bold text-slate-700">
                      {parseAnyToDate(activeItem.startDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às{' '}
                      {parseAnyToDate(activeItem.endDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MapPin size={12} className="text-slate-400" />
                      <label className="text-[8px] font-black text-slate-400 uppercase">LOCAL DO TREINAMENTO</label>
                    </div>
                    <p className="text-xs font-bold text-slate-700">{linked?.trainingLocal || 'Não informado'}</p>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 min-h-[90px]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <MessageSquare size={12} className="text-slate-400" />
                      <label className="text-[8px] font-black text-slate-400 uppercase">OBSERVAÇÃO</label>
                    </div>
                    <textarea
                      className="w-full bg-transparent text-xs font-medium text-slate-500 uppercase leading-relaxed outline-none border-none resize-none h-20"
                      value={modalObs}
                      onChange={e => setModalObs(e.target.value)}
                      placeholder="Sem observação..."
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-1.5">
                    {(isMobileContext ? MOBILE_AGENDA_TYPES : AGENDA_TYPES).map(type => (
                      <button
                        key={type}
                        onClick={() => setFormType(type)}
                        className={`py-2 text-[9px] font-black rounded-xl border-2 uppercase transition-all ${
                          formType === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-400 border-slate-100'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  {/* Data de início (só exibição) + Data fim */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">INÍCIO</label>
                      <input
                        type="date"
                        className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                        value={selectedSlot ? formatDateKey(selectedSlot.date) : ''}
                        disabled
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">FIM</label>
                      <input
                        type="date"
                        className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                        value={formEndDate}
                        onChange={e => setFormEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Hora início / Hora fim */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">HORA INÍCIO</label>
                      <input
                        type="time"
                        className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                        value={formStartTime}
                        onChange={e => setFormStartTime(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-black text-slate-400 uppercase mb-1 tracking-widest">HORA FIM</label>
                      <input
                        type="time"
                        className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                        value={formEndTime}
                        onChange={e => setFormEndTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <textarea
                    className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-medium h-20 resize-none"
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    placeholder={isMobileContext ? 'Obrigatório: Detalhes da manutenção ou evento...' : 'Notas extras...'}
                  />
                </div>
              )}
            </div>

            <div className="p-7 pt-0 flex flex-col gap-3">
              {modalMode === 'VIEW' ? (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleUpdateObservation}
                    className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                  >
                    SALVAR OBSERVAÇÃO
                  </button>
                  <button
                    onClick={handleRemoveAction}
                    className="flex items-center justify-center gap-2 text-red-500 font-black text-[10px] uppercase tracking-widest py-2 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} /> REMOVER REGISTRO
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                    CANCELAR
                  </button>
                  <button
                    onClick={isMobileContext ? handleSaveMobile : handleSaveManual}
                    disabled={!formEndDate || !formStartTime || !formEndTime || (isMobileContext && !formDescription.trim())}
                    className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest ${
                      !formEndDate || !formStartTime || !formEndTime || (isMobileContext && !formDescription.trim())
                        ? 'bg-slate-200 text-slate-400'
                        : 'bg-blue-600 text-white shadow-lg shadow-blue-100 active:scale-95'
                    }`}
                  >
                    CRIAR
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
