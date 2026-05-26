import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App';
import { logAction } from '../services/auditLog';
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
  MessageSquare,
  UserPlus
} from 'lucide-react';
import { AgendaItem, AgendaType, Demand, Instructor } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { useAuth } from '../contexts/AuthContext';
import { isDemandDay, buildCardLabel } from '../domain/demandDays';
import AllocationDrawer, { type DrawerState, type AllocationPreview } from './AllocationDrawer';

// Configuração visual para cada tipo de compromisso
const AGENDA_STYLING: Record<string, { bg: string; text: string; border: string }> = {
  FOLGA: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  INDISPONIVEL: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  FERIAS: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  ESCRITORIO_ALPHAVILLE: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  ESCRITORIO_BH: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  ESCRITORIO_VITORIA: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  HOME_OFFICE: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  EXTERNO: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  DESCANSO: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  OUTRO: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  TREINAMENTO: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-700' },
  'MANUTENÇÃO': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'DESLOCAMENTO': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  EVENTO: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  RESERVADO: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  APOIO: { bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-600' }
};

const AGENDA_TYPES: AgendaType[] = [
  'FOLGA',
  'INDISPONIVEL',
  'FERIAS',
  'DESCANSO',
  'OUTRO',
  'ESCRITORIO_ALPHAVILLE',
  'ESCRITORIO_BH',
  'ESCRITORIO_VITORIA',
  'HOME_OFFICE',
  'EXTERNO',
  'APOIO'
];

const AGENDA_LABELS: Record<string, string> = {
  FOLGA: 'FOLGA',
  INDISPONIVEL: 'INDISPONÍVEL',
  FERIAS: 'FÉRIAS',
  DESCANSO: 'DESCANSO',
  OUTRO: 'OUTRO',

  ESCRITORIO: 'ESCRITÓRIO',
  ESCRITORIO_ALPHAVILLE: 'ESCRITÓRIO ALPHAVILLE',
  ESCRITORIO_BH: 'ESCRITÓRIO BH',
  ESCRITORIO_VITORIA: 'ESCRITÓRIO VITÓRIA',

  HOME_OFFICE: 'HOME OFFICE',
  EXTERNO: 'EXTERNO',
  APOIO: 'APOIO'
};

const getAgendaLabel = (t: string) => AGENDA_LABELS[t] ?? t;

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
    setNotification,
   operationalBases,
   updateInstructorCurrentLocation,
   calendarDrawerDemandId,
   setCalendarDrawerDemandId,
  } = useApp();

  const { profile } = useAuth();
  const isCoordinator = profile?.role === 'coordenador';

  const [activeMobileEvent, setActiveMobileEvent] = useState<MobileResourceEvent | null>(null);
  const [isMobileContext, setIsMobileContext] = useState(false);

  // ===== ALLOCATION DRAWER STATE =====
  const [allocationMode, setAllocationMode] = useState(false);
  const [drawerState, setDrawerState] = useState<DrawerState>('closed');
  const [drawerSelectedDemandId, setDrawerSelectedDemandId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<AllocationPreview[]>([]);
  const [drawerCompanionMode, setDrawerCompanionMode] = useState(false);

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const now = new Date();
    // Início na segunda-feira da semana atual
    const dayOfWeek = now.getDay(); // 0=dom, 1=seg, ..., 6=sab
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
    return monday;
  });

  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [showViewPicker, setShowViewPicker] = useState(false);

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

  // =========================
// FILTERS (Agenda)
// =========================
const [filterRole, setFilterRole] = useState<string>('TODOS');
const [filterTrainingId, setFilterTrainingId] = useState<string>('TODOS'); // filtra CARDS por trainingId da demanda
const [filterTrainingLocal, setFilterTrainingLocal] = useState<string>(''); // input livre (local do treinamento)
const [filterDateFrom, setFilterDateFrom] = useState<string>(''); // YYYY-MM-DD
const [filterDateTo, setFilterDateTo] = useState<string>('');   // YYYY-MM-DD

const [showAdvanced, setShowAdvanced] = useState(false);

// Avançados
const [filterName, setFilterName] = useState<string>(''); // busca por nome
const [filterRegionId, setFilterRegionId] = useState<string>('TODOS'); // filtra LINHAS por região
const [filterCoverageLocation, setFilterCoverageLocation] = useState<string>('TODOS'); // filtra LINHAS por "Atendendo"
const [filterResidenceLocation, setFilterResidenceLocation] = useState<string>('TODOS'); // filtra LINHAS por LOCAL (residência)
const [filterRecordType, setFilterRecordType] = useState<string>('TODOS'); // filtra CARDS por tipo/origem

const normalize = (s: string) =>
  (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const intersectsRange = (startStr: string, endStr: string, from?: string, to?: string) => {
  if (!from && !to) return true;

  const aStart = dayStart(parseAnyToDate(startStr));
  const aEnd = dayStart(parseAnyToDate(endStr));

  const rStart = from ? dayStart(parseAnyToDate(from)) : null;
  const rEnd = to ? dayStart(parseAnyToDate(to)) : null;

  if (rStart && aEnd < rStart) return false;
  if (rEnd && aStart > rEnd) return false;
  return true;
};

// pega a Demand associada ao card quando for DEMANDA/ALLOCATION/COMPANION
const getDemandFromItem = (item: any): Demand | null => {
  if (!item) return null;

  const demandId =
    item.source === 'ALLOCATION' || item.source === 'COMPANION'
      ? item.demandId
      : item.demandId || item.id;

  if (!demandId) return null;
  return demands.find(d => d.id === demandId) || null;
};

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handlePrev = () => setCurrentDate(prev => {
    if (viewMode === 'month') return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
    const d = new Date(prev); d.setDate(d.getDate() - 7); return d;
  });
  const handleNext = () => setCurrentDate(prev => {
    if (viewMode === 'month') return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
    const d = new Date(prev); d.setDate(d.getDate() + 7); return d;
  });
  
  const daysInView = useMemo(() => {
  // Se tiver range (De/Até), renderiza exatamente o range (inclusive)
  if (filterDateFrom && filterDateTo) {
    const start = dayStart(parseAnyToDate(filterDateFrom));
    const end = dayStart(parseAnyToDate(filterDateTo));

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

    const dir = start <= end ? 1 : -1;
    const days: Date[] = [];
    const cursor = new Date(start);

    while ((dir === 1 && cursor <= end) || (dir === -1 && cursor >= end)) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + dir);
    }
    return days;
  }

  // Default: semana ou mês conforme viewMode
  if (viewMode === 'month') {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysCount = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysCount }, (_, i) => new Date(year, month, i + 1));
  }
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() + i);
    return d;
  });
}, [currentDate, filterDateFrom, filterDateTo, viewMode]);


  /** =========================
   *  1) CENTRO MÓVEL (CTM)
   *  ========================= */
  const mobileAgendaByDay = useMemo(() => {
    const map: Record<
      string,
      { title: string; source: 'MIRROR' | 'LOCAL'; id: string; start: string; end: string; description?: string }
    > = {};

    // Manual CTM events (persisted in agenda_items with instructorId = 'MOBILE_RESOURCE')
    agendaItems
      .filter(item => item.instructorId === 'MOBILE_RESOURCE')
      .forEach(item => {
        const { start, end } = getDayBoundsForIteration(item.startDate, item.endDate);
        const cursor = new Date(start);
        while (cursor <= end) {
          map[formatDateKey(cursor)] = {
            id: item.id,
            title: item.title,
            source: 'LOCAL',
            start: item.startDate,
            end: item.endDate,
            description: item.description
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

        const { start, end } = getDayBoundsForIteration(
          ensureDateTimeForDisplay(a.startDate, 'start'),
          ensureDateTimeForDisplay(a.endDate,   'end')
        );
        const cursor = new Date(start);
        const training = trainings.find(t => t.id === d.trainingId);
        const company = companies.find(c => c.id === d.companyId);

        while (cursor <= end) {
          const dayKey = formatDateKey(cursor);
          map[dayKey] = {
            id: a.id,
            title: buildCardLabel(d, dayKey, { companyName: company?.name, trainingNr: training?.nr }),
            source: 'MIRROR',
            start: a.startDate,
            end: a.endDate,
            description: d.trainingLocal
          };
          cursor.setDate(cursor.getDate() + 1);
        }
      });

    return map;
  }, [agendaItems, resourceAllocations, demands, trainings, companies]);

  /** =========================
   *  2) AGENDA INSTRUTORES
   *  ========================= */
  const { agendaByDay, allocByDayMulti } = useMemo(() => {
    const map: Record<string, UnifiedItem> = {};
    // Coleta TODAS as alocações por dia (suporte a múltiplos treinos no mesmo dia)
    const allocMulti: Record<string, UnifiedItem[]> = {};
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
      const cStatus = calculateDemandStatus({ ...d, cancelled: false });

      while (cursor <= end) {
        // ✅ DIAS ESPECÍFICOS: pula dias que não fazem parte da demanda
        if (isDemandDay(d, cursor)) {
          const dayKey = formatDateKey(cursor);
          const allocKey = `${a.instructorId}-${dayKey}`;
          const allocItem: UnifiedItem = {
            id: a.id,
            instructorId: a.instructorId,
            startDate: displayStart,
            endDate: displayEnd,
            type: 'TREINAMENTO',
            title: buildCardLabel(d, dayKey, { companyName: company?.name, trainingNr: training?.nr }),
            source: 'ALLOCATION',
            description: d.trainingLocal,
            calculatedStatus: cStatus,
            demandId: d.id
          };
          map[allocKey] = allocItem;
          // Coleta múltiplas alocações para o mesmo dia (suporte a dois treinos no mesmo dia)
          if (!allocMulti[allocKey]) allocMulti[allocKey] = [];
          if (!allocMulti[allocKey].some(x => x.id === allocItem.id)) {
            allocMulti[allocKey].push(allocItem);
          }
        }
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
  const cStatus = calculateDemandStatus({ ...d, cancelled: false });

  while (cursor <= end) {
    // ✅ DIAS ESPECÍFICOS: pula dias que não fazem parte da demanda
    if (isDemandDay(d, cursor)) {
      const dayKey = formatDateKey(cursor);
      map[`${ca.instructorId}-${dayKey}`] = {
        id: ca.id,
        instructorId: ca.instructorId,
        startDate: displayStart,
        endDate: displayEnd,
        type: 'TREINAMENTO',
        title: buildCardLabel(d, dayKey, { companyName: company?.name, trainingNr: training?.nr }),
        source: 'COMPANION',
        description: d.trainingLocal,
        calculatedStatus: cStatus,
        demandId: d.id,
        isCompanion: true,
        companionAllocationId: ca.id
      };
    }
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

        const training = trainings.find(t => t.id === d.trainingId);
        const company = companies.find(c => c.id === d.companyId);
        const cStatus = calculateDemandStatus({ ...d, cancelled: false });

        while (cursor <= end) {
          // ✅ DIAS ESPECÍFICOS: pula dias que não fazem parte da demanda
          if (isDemandDay(d, cursor)) {
            const dayKey = formatDateKey(cursor);
            map[`${d.instructorId}-${dayKey}`] = {
              id: d.id,
              instructorId: d.instructorId!,
              startDate: effectiveStart,
              endDate: effectiveEnd,
              type: 'TREINAMENTO',
              title: buildCardLabel(d, dayKey, { companyName: company?.name, trainingNr: training?.nr }),
              source: 'DEMANDA',
              description: d.trainingLocal,
              calculatedStatus: cStatus,
              demandId: d.id
            };
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      });

    return { agendaByDay: map, allocByDayMulti: allocMulti };
  }, [agendaItems, instructorAllocations, companionAllocations, demands, trainings, companies]);

  const trainingCountInRange = useMemo(() => {
    // conta DEMANDAS únicas no range, respeitando filtroTrainingId/local
    const ids = new Set<string>();

    // percorre todos os items do agendaByDay (que é por dia), mas evita duplicar por demandId
    Object.values(agendaByDay).forEach((item: any) => {
      if (!item) return;

      // só treinamento
      if (item.type !== 'TREINAMENTO') return;

      // range
      if (!intersectsRange(item.startDate, item.endDate, filterDateFrom || undefined, filterDateTo || undefined)) return;

      const demand = getDemandFromItem(item);
      if (!demand) return;

      // filtros
      if (filterTrainingId !== 'TODOS' && demand.trainingId !== filterTrainingId) return;
      if (filterTrainingLocal) {
        const local = normalize(demand.trainingLocal || '');
        const selected = normalize(filterTrainingLocal);
        if (local !== selected) return;
      }


      ids.add(demand.id);
    });

    return ids.size;
  }, [agendaByDay, filterDateFrom, filterDateTo, filterTrainingId, filterTrainingLocal]);

  const trainingLocations = useMemo(() => {
  const baseList = (operationalBases?.locaisTreinamento || []).filter(Boolean);

  // fallback opcional (eu recomendo)
  const fromDemands = demands
    .map(d => (d.trainingLocal || '').trim())
    .filter(Boolean);

  // une + remove duplicados (normalizado)
  const map = new Map<string, string>();
  [...baseList, ...fromDemands].forEach(loc => {
    const key = normalize(loc);
    if (!map.has(key)) map.set(key, loc);
  });

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}, [operationalBases?.locaisTreinamento, demands]);


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

  const handleDrop = async (e: React.DragEvent, targetInstructorId: string) => {
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

      // Remove agenda_items do instrutor anterior vinculados a esta demanda antes de mover
      const staleAgendaItems = agendaItems.filter(
        item => item.relatedDemandId === demand.id && item.instructorId === demand.instructorId
      );
      for (const item of staleAgendaItems) {
        await removeAgendaItem(item.id);
      }

      updateDemand({ ...demand, instructorId: targetInstructorId });
    } else if (source === 'ALLOCATION') {
      const allocation = instructorAllocations.find(a => a.id === itemId);
      if (!allocation) return;
      if (allocation.instructorId === targetInstructorId) return;

      // usamos update mantendo o mesmo id para não derrubar o status da demanda
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

      // Remove agenda_items do instrutor anterior vinculados a esta demanda antes de mover
      const staleAgendaItems = agendaItems.filter(
        item => item.relatedDemandId === allocation.demandId && item.instructorId === allocation.instructorId
      );
      for (const item of staleAgendaItems) {
        await removeAgendaItem(item.id);
      }

      updateInstructorAllocation({ ...allocation, instructorId: targetInstructorId });

      // Mantém demands.instructor_id sincronizado com a nova alocação
      if (demand) {
        updateDemand({ ...demand, instructorId: targetInstructorId });
      }
    }
  };

  // Abre modal VIEW para um item específico de uma célula (usado por cards individuais)
  const handleItemCardClick = (instructor: Instructor, item: UnifiedItem) => {
    if (profile?.role === 'coordenador') return;
    const linkedDemand =
      item.source === 'DEMANDA' || item.source === 'ALLOCATION'
        ? demands.find((d: Demand) => d.id === (item.demandId || item.id))
        : null;
    setModalInstructor(instructor);
    setIsMobileContext(false);
    setActiveItem(item);
    setModalObs(linkedDemand?.observations || item.description || '');
    setModalMode('VIEW');
    setIsModalOpen(true);
  };

  const handleCellClick = (instructor: Instructor, date: Date) => {
    if (profile?.role === 'coordenador') return;

    const key = `${instructor.id}-${formatDateKey(date)}`;
    const existing = agendaByDay[key];
    // Se há múltiplas alocações neste dia, os cards individuais tratam o clique
    const multiItems = allocByDayMulti[key] || [];
    if (multiItems.length >= 2) return;

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

  // ===== AUTO-NAVEGAÇÃO PARA DEMANDA (Drawer) =====
  const handleNavigateToDemandDates = useCallback((demand: Demand) => {
    const startKey = demand.startDate.split('T')[0];
    const demandStart = parseLocalDateOnly(startKey);
    const dayOfWeek = demandStart.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(demandStart);
    monday.setDate(demandStart.getDate() + diffToMonday);
    setCurrentDate(monday);
    setFilterDateFrom('');
    setFilterDateTo('');
    setViewMode('week');
  }, []);

  // ===== EFEITO CROSS-VIEW (vindo do Logistics) =====
  useEffect(() => {
    if (calendarDrawerDemandId) {
      const demand = demands.find(d => d.id === calendarDrawerDemandId);
      if (demand) {
        setAllocationMode(true);
        setDrawerSelectedDemandId(demand.id);
        setDrawerState('collapsed');
        handleNavigateToDemandDates(demand);
      }
      setCalendarDrawerDemandId(null);
    }
  }, [calendarDrawerDemandId, demands, setCalendarDrawerDemandId, handleNavigateToDemandDates]);

  // Função para entrar/sair do modo alocação
  const toggleAllocationMode = useCallback(() => {
    if (allocationMode) {
      // Saindo: fecha drawer, limpa previews
      setAllocationMode(false);
      setDrawerState('closed');
      setPreviewItems([]);
      setDrawerSelectedDemandId(null);
      setDrawerCompanionMode(false);
    } else {
      // Entrando: ativa fullscreen + abre drawer
      setAllocationMode(true);
      setDrawerState('expanded');
    }
  }, [allocationMode]);

const handleSaveManual = async () => {
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
    title: getAgendaLabel(formType),
    source: 'MANUAL',
    description: formDescription
  };

  try {
    await addAgendaItem(item); // ✅ aqui é a diferença
    const instructorName = instructors.find(i => i.id === selectedSlot.instructorId)?.name || selectedSlot.instructorId;
    logAction({
      modulo: 'Agendamento',
      acao: 'Criar',
      descricao: `Agenda criada: ${item.title} — Instrutor: ${instructorName} | ${item.startDate?.slice(0, 10) ?? ''} a ${item.endDate?.slice(0, 10) ?? ''}`,
      dadosDepois: item,
    });
    setIsModalOpen(false);
  } catch (e) {
    setNotification({ type: 'error', message: 'Falha ao salvar registro manual (agenda_items). Veja o console/erros do Supabase.' });
  }
};


  const handleSaveMobile = async () => {
    if (!selectedSlot || !formEndDate || !formDescription.trim()) return;

    const startDateTime = `${formatDateKey(selectedSlot.date)}T${formStartTime}`;
    const endDateTime = `${formEndDate}T${formEndTime}`;
    const startDay = getDatePart(startDateTime);
    const endDay = getDatePart(endDateTime);

    // Conflito com alocações de demanda (resource_allocations)
    if (hasResourceConflict(startDay, endDay)) {
      setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
      return;
    }

    // Conflito com outros eventos manuais do CTM (agenda_items)
    if (hasScheduleConflict('MOBILE_RESOURCE', startDateTime, endDateTime)) {
      setNotification({ message: 'Não é possível registrar este período, pois já existe outro registro cadastrado.', type: 'error' });
      return;
    }

    const item: AgendaItem = {
      id: `AG-${Date.now()}`,
      instructorId: 'MOBILE_RESOURCE',
      startDate: startDateTime,
      endDate: endDateTime,
      type: formType as AgendaType,
      title: getAgendaLabel(formType),
      source: 'MANUAL',
      description: formDescription
    };

    try {
      await addAgendaItem(item);
      logAction({
        modulo: 'Agendamento',
        acao: 'Criar',
        descricao: `CTM criado: ${item.title} | ${item.startDate.slice(0, 10)} a ${item.endDate.slice(0, 10)}${formDescription ? ` | Obs: ${formDescription}` : ''}`,
        dadosDepois: item,
      });
      setIsModalOpen(false);
    } catch (e) {
      setNotification({ type: 'error', message: 'Falha ao salvar registro do CTM. Verifique o console.' });
    }
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

    {
      const instructorName = (() => {
        const iId = (activeItem as any).instructorId;
        return iId ? (instructors.find((i: any) => i.id === iId)?.name || iId) : null;
      })();
      const nd = (d: any) => d ? String(d).slice(0, 10) : null;
      logAction({
        modulo: 'Agendamento',
        acao: 'Editar',
        descricao: [
          `Observação editada: ${activeItem.title || activeItem.id}`,
          instructorName ? `Instrutor: ${instructorName}` : null,
          nd(activeItem.startDate) ? `Data: ${nd(activeItem.startDate)}` : null,
          `De: "${activeItem.description || '—'}" Para: "${modalObs}"`,
        ].filter(Boolean).join(' | '),
        dadosAntes: { description: activeItem.description },
        dadosDepois: { description: modalObs },
      });
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

  logAction({
    modulo: 'Agendamento',
    acao: 'Cancelar',
    descricao: `Agenda removida: ${activeItem.title || activeItem.id} | ${(activeItem.startDate ?? '').slice(0, 10)} a ${(activeItem.endDate ?? '').slice(0, 10)}`,
    dadosAntes: activeItem,
  });
  setIsModalOpen(false);
};



  const handleRemoveMobileEvent = () => {
    if (activeMobileEvent) removeAgendaItem(activeMobileEvent.id);
    setActiveMobileEvent(null);
  };

  return (
    <div className={`${
      allocationMode
        ? 'fixed inset-0 z-[95] bg-[#F8FAFC] flex flex-col overflow-hidden'
        : 'space-y-6'
    }`}>
      {/* ===== HEADER BAR ===== */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 no-print ${
        allocationMode ? 'px-4 pt-3 pb-2 bg-white border-b border-slate-200 shadow-sm shrink-0' : ''
      }`}>
        <div className="flex items-center gap-4">
          {allocationMode && (
            <button
              onClick={toggleAllocationMode}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition"
              title="Voltar à agenda normal"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <div>
            <h1 className={`font-black text-slate-800 uppercase tracking-tight ${allocationMode ? 'text-lg' : 'text-2xl'}`}>
              {allocationMode ? 'Alocação Inteligente' : 'Agenda de Instrutores'}
            </h1>
            {!allocationMode && (
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Programação e Alocação de Instrutores por Período</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Botão Alocar Instrutor */}
          {!isCoordinator && (
            <button
              onClick={toggleAllocationMode}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm flex items-center gap-1.5 ${
                allocationMode
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-slate-900 text-white hover:bg-blue-600'
              }`}
            >
              {allocationMode ? (
                <><X size={14} /> SAIR DA ALOCAÇÃO</>
              ) : (
                <><UserPlus size={14} /> ALOCAR INSTRUTOR</>
              )}
            </button>
          )}

          {/* Navegação de semanas */}
          <div className="flex items-center space-x-1 bg-white rounded-xl p-1 border border-gray-200 shadow-sm relative">
          <button onClick={handlePrev} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition">
            <ChevronLeft size={18} />
          </button>
          <div
            onClick={() => setShowViewPicker(prev => !prev)}
            className="px-6 py-2 text-sm font-bold text-gray-800 capitalize min-w-[220px] text-center cursor-pointer hover:bg-gray-50 rounded-lg transition select-none"
            title="Clique para alternar Semana / Mês"
          >
            {viewMode === 'week' ? (
              <>
                {currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                {' — '}
                {(() => { const sun = new Date(currentDate); sun.setDate(sun.getDate() + 6); return sun.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); })()}
              </>
            ) : (
              currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
            )}
          </div>
          <button onClick={handleNext} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition">
            <ChevronRight size={18} />
          </button>

          {/* Picker Semana / Mês */}
          {showViewPicker && (
            <div className="absolute top-full mt-1 right-0 bg-white rounded-xl shadow-lg border border-gray-200 z-[80] overflow-hidden">
              <button
                onClick={() => {
                  if (viewMode !== 'week') {
                    const now = new Date();
                    const dow = now.getDay();
                    const diff = dow === 0 ? -6 : 1 - dow;
                    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff));
                  }
                  setViewMode('week');
                  setShowViewPicker(false);
                }}
                className={`w-full px-5 py-2.5 text-xs font-bold text-left transition ${viewMode === 'week' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Semana
              </button>
              <button
                onClick={() => {
                  if (viewMode !== 'month') {
                    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
                  }
                  setViewMode('month');
                  setShowViewPicker(false);
                }}
                className={`w-full px-5 py-2.5 text-xs font-bold text-left transition ${viewMode === 'month' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Mês
              </button>
            </div>
          )}
        </div>
        </div>{/* fecha flex items-center gap-3 */}
      </div>

    {/* =========================
    FILTER BAR (oculto em modo alocação)
   ========================= */}
{!allocationMode && (
<div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 no-print">
  <div className="flex flex-col gap-3">

    {/* Linha principal */}
    <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
      {/* Função */}
      <div className="w-full lg:w-56">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
          Função
        </label>
        <select
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
        >
          <option value="TODOS">Todos</option>
          {operationalBases?.funcoesAgenda?.map((r: string) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Treinamento (filtra CARDS por demanda.trainingId) */}
      <div className="w-full lg:w-72">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
          Treinamento (registros)
        </label>
        <select
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
          value={filterTrainingId}
          onChange={(e) => setFilterTrainingId(e.target.value)}
        >
          <option value="TODOS">Todos</option>
          {trainings
            .filter(t => t.status === 'ATIVO')
            .map(t => (
              <option key={t.id} value={t.id}>
                {t.nr ? `${t.nr} — ` : ''}{t.name}
              </option>
            ))}
        </select>
      </div>

      {/* Local do treinamento */}
      <div className="w-full lg:flex-1">
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
        Local do treinamento (registros)
      </label>

      <select
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
        value={filterTrainingLocal}
        onChange={(e) => setFilterTrainingLocal(e.target.value)}
      >
        <option value="">Todos</option>
        {trainingLocations.map(loc => (
          <option key={loc} value={loc}>{loc}</option>
        ))}
      </select>
    </div>


      {/* Período */}
      <div className="w-full lg:w-[320px]">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
          Período (De/Até)
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />
        </div>
      </div>
    </div>

    {/* Avançados */}
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-800"
      >
        {showAdvanced ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}
      </button>
    <div className="text-[11px] font-bold text-slate-500">
      Treinamentos no período (após filtros): <span className="text-slate-800">{trainingCountInRange}</span>
    </div>

      <button
        type="button"
        onClick={() => {
          setFilterRole('TODOS');
          setFilterTrainingId('TODOS');
          setFilterTrainingLocal('');
          setFilterDateFrom('');
          setFilterDateTo('');
          setFilterName('');
          setFilterRegionId('TODOS');
          setFilterCoverageLocation('TODOS');
          setFilterRecordType('TODOS');
        }}
        className="text-[11px] font-black uppercase tracking-widest text-red-500 hover:text-red-700"
      >
        Limpar filtros
      </button>
    </div>

    {showAdvanced && (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
        {/* Nome */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            Buscar pessoa
          </label>
          <input
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Nome..."
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
        </div>

        

        {/* LOCAL (residência) */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            Local (UF/Região)
          </label>
          <select
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            value={filterResidenceLocation}
            onChange={(e) => setFilterResidenceLocation(e.target.value)}
          >
            <option value="TODOS">Todos</option>
            {Array.from(new Set(
              instructors
                .filter(i => i.status === 'ATIVO' && i.residenceLocation)
                .map(i => i.residenceLocation!.trim())
                .filter(Boolean)
            )).sort().map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>

        {/* Atendendo */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            Localidade (Estado)
          </label>
          <select
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            value={filterCoverageLocation}
            onChange={(e) => setFilterCoverageLocation(e.target.value)}
          >
            <option value="TODOS">Todas</option>
            {(operationalBases?.localidades || []).map((loc: string) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>

        {/* Tipo de registro */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            Tipo de registro (cards)
          </label>
          <select
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            value={filterRecordType}
            onChange={(e) => setFilterRecordType(e.target.value)}
          >
            <option value="TODOS">Todos</option>
            <option value="TREINAMENTO">Treinamentos</option>
            <option value="MANUAL">Registros manuais</option>
            <option value="ACOMPANHANTE">Acompanhantes</option>
          </select>
        </div>
      </div>
    )}
  </div>
</div>
)}

      <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden ${
        allocationMode ? 'flex-1 min-h-0' : ''
      }`}>
        {/* Container com scroll horizontal E vertical - max-height para ativar sticky */}
        <div className={`overflow-auto transition-all duration-300 ${
          allocationMode
            ? 'max-h-[calc(100vh-60px)]'
            : 'max-h-[calc(100vh-280px)]'
        }`}>
          <table className="min-w-max w-full text-sm border-separate border-spacing-0">
            {/* ✅ STICKY HEADER - fica fixo no topo durante scroll vertical */}
            <thead className="sticky top-0 z-[60]">
              <tr className="bg-slate-50 border-b border-gray-200 shadow-[0_2px_4px_rgba(0,0,0,0.06)]">
                <th
              className="
                p-4 text-left w-[200px] min-w-[200px]
                font-black text-[10px] uppercase tracking-widest text-slate-400
                sticky left-0 z-[70] bg-slate-50
                relative overflow-hidden
                after:content-[''] after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
              "
            >
              Instrutor
            </th>
            <th
              className="
                px-2 py-4 text-center
                w-[90px] min-w-[90px] max-w-[90px] box-border
                font-black text-[8px] uppercase tracking-tighter text-slate-400 leading-tight
                sticky left-[200px] z-[70] bg-slate-50
                relative overflow-hidden
                after:content-[''] after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
                before:content-[''] before:absolute before:left-0 before:bottom-0 before:w-full before:h-px before:bg-gray-200
              "
            >
              Local
            </th>

                {daysInView.map((day, idx) => (
                  <th
                    key={idx}
                    className={`p-2 border-r border-gray-100 min-w-[75px] text-center ${day.getDay() % 6 === 0 ? 'bg-slate-100' : 'bg-slate-50'}`}
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
              .filter(i => {
                // Função (linha)
                const role = (i as any).agendaRole || 'INSTRUTOR';
                if (filterRole !== 'TODOS' && role !== filterRole) return false;

                // Buscar nome
                if (filterName && !normalize(i.name).includes(normalize(filterName))) return false;

                // LOCAL (residenceLocation)
                if (filterResidenceLocation !== 'TODOS') {
                  if ((i.residenceLocation || '').trim() !== filterResidenceLocation) return false;
                }

                // Localidade (Estado da Demanda)
                if (filterCoverageLocation !== 'TODOS') {
                  const hasDemandInState = demands.some(d =>
                    (d.instructorId === i.id || instructorAllocations.some(a => a.demandId === d.id && a.instructorId === i.id)) &&
                    d.status !== 'CANCELADA' &&
                    (d.demandState || '').trim() === filterCoverageLocation
                  );
                  if (!hasDemandInState) return false;
                }

                return true;
              })
              .map(instructor => (

                <tr
                  key={instructor.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-slate-50/10 transition-colors"
                >

                 {/* COLUNA INSTRUTOR (ajustada p/ auto-height) */}
                <td
                className="
                  p-3 font-bold text-slate-700 bg-white
                  sticky left-0 z-50
                  w-[200px] min-w-[200px] max-w-[200px] box-border
                  align-middle
                  relative overflow-hidden
                  after:content-[''] after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
                  before:content-[''] before:absolute before:left-0 before:bottom-0 before:w-full before:h-px before:bg-gray-100
                "
              >
                <div className="h-full flex items-center">
                  <div className="min-w-0 flex flex-col leading-tight">
                    <span className="truncate max-w-[180px] font-bold text-slate-600" title={instructor.name}>
                      {instructor.name}
                    </span>

                    {instructor.agendaRole && (
                      <span className="mt-0.5 inline-flex w-fit px-2 py-[2px] rounded-md text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200">
                        {instructor.agendaRole}
                      </span>
                    )}
                  </div>
                </div>
              </td>

                {/* 1) LOCAL (RESIDÊNCIA) - primeiro */}
               <td
                className="
                  px-2 py-2 bg-white align-middle text-center
                  sticky left-[200px] z-40
                  w-[90px] min-w-[90px] max-w-[90px] box-border
                  relative overflow-hidden
                  after:content-[''] after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
                  before:content-[''] before:absolute before:left-0 before:bottom-0 before:w-full before:h-px before:bg-gray-100
                "
              >
                <div
                  className="w-full text-[14px] font-bold text-slate-600"
                  title={instructor.residenceLocation || ''}
                >
                  {instructor.residenceLocation ? instructor.residenceLocation : '—'}
                </div>
              </td>

                  {daysInView.map(day => {
                      const dateKey = `${instructor.id}-${formatDateKey(day)}`;
                      const item = agendaByDay[dateKey];
                      // ======== CARD FILTERS ========
                      let shouldHideCard = false;

                      if (item) {
                        // 1) Período (range) -> filtra cards por interseção com De/Até
                        if (filterDateFrom || filterDateTo) {
                          if (!intersectsRange(item.startDate, item.endDate, filterDateFrom || undefined, filterDateTo || undefined)) {
                            shouldHideCard = true;
                          }
                        }

                        // 2) Tipo de registro (avançado)
                        if (!shouldHideCard && filterRecordType !== 'TODOS') {
                          if (filterRecordType === 'MANUAL' && item.source !== 'MANUAL') shouldHideCard = true;
                          if (filterRecordType === 'ACOMPANHANTE' && item.source !== 'COMPANION') shouldHideCard = true;
                          if (filterRecordType === 'TREINAMENTO' && (item.type !== 'TREINAMENTO')) shouldHideCard = true;
                        }

                        // 3) Treinamento / Local do Treinamento (filtram só registros de demanda/alocação/companion)
                        if (!shouldHideCard && (filterTrainingId !== 'TODOS' || filterTrainingLocal.trim())) {
                          const demand = getDemandFromItem(item);

                          // se não for card de demanda/alocação, some quando o user está filtrando treinamento/local
                          if (!demand) {
                            shouldHideCard = true;
                          } else {
                            if (filterTrainingId !== 'TODOS' && demand.trainingId !== filterTrainingId) {
                              shouldHideCard = true;
                            }

                          if (!shouldHideCard && filterTrainingLocal) {
                            const local = normalize(demand.trainingLocal || '');
                            const selected = normalize(filterTrainingLocal);
                            if (local !== selected) shouldHideCard = true;
                          }
                          }
                        }
                      }
                      // ===== MULTI-ALLOC: filtra e decide modo de renderização =====
                      const rawAllocItems = allocByDayMulti[dateKey] || [];
                      const filteredAllocItems = rawAllocItems.filter((ai: UnifiedItem) => {
                        if (filterDateFrom || filterDateTo) {
                          if (!intersectsRange(ai.startDate, ai.endDate, filterDateFrom || undefined, filterDateTo || undefined)) return false;
                        }
                        if (filterRecordType !== 'TODOS' && filterRecordType !== 'TREINAMENTO') return false;
                        if (filterTrainingId !== 'TODOS' || filterTrainingLocal.trim()) {
                          const aiDemand = getDemandFromItem(ai);
                          if (!aiDemand) return false;
                          if (filterTrainingId !== 'TODOS' && aiDemand.trainingId !== filterTrainingId) return false;
                          if (filterTrainingLocal) {
                            if (normalize(aiDemand.trainingLocal || '') !== normalize(filterTrainingLocal)) return false;
                          }
                        }
                        return true;
                      });
                      const useMultiCard = filteredAllocItems.length >= 2;
                      const cellItem = !useMultiCard && item && !shouldHideCard ? { type: 'INSTRUCTOR_EVENT', data: item } : null;

                      // ===== PREVIEW CHECK =====
                      const cellPreviews = previewItems.filter(p =>
                        p.instructorId === instructor.id &&
                        p.days.includes(formatDateKey(day))
                      );

                      return (
                    <td
                      key={dateKey}
                      onClick={() => handleCellClick(instructor, day)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDrop(e, instructor.id)}
                    className={`p-1 border-r border-b border-gray-100 h-16 cursor-pointer transition-all relative ${
                      day.getDay() % 6 === 0 ? 'bg-slate-50/50' : ''
                    }`}
                    >
                  {/* ===== MODO MULTI-CARD: dois treinos no mesmo dia ===== */}
                  {useMultiCard && (
                    <div className="w-full h-full flex flex-col gap-0.5 overflow-hidden">
                      {filteredAllocItems.map((allocItem: UnifiedItem) => {
                        const aLinkedDemandId = allocItem.demandId || allocItem.id;
                        const aLinkedDemand = demands.find((d: any) => d.id === aLinkedDemandId);
                        const aIsAConfirmar = allocItem.type === 'TREINAMENTO' && aLinkedDemand?.confirmationStatus === 'A_CONFIRMAR';
                        let aBg = AGENDA_STYLING[allocItem.type]?.bg || 'bg-gray-100';
                        let aText = AGENDA_STYLING[allocItem.type]?.text || 'text-gray-600';
                        let aBorder = AGENDA_STYLING[allocItem.type]?.border || 'border-gray-200';
                        if (aIsAConfirmar) { aBg = 'bg-amber-400'; aText = 'text-amber-900'; aBorder = 'border-amber-500'; }
                        return (
                          <div
                            key={allocItem.id}
                            draggable={!isCoordinator}
                            onDragStart={!isCoordinator ? (e: React.DragEvent) => handleDragStart(e, allocItem) : undefined}
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleItemCardClick(instructor, allocItem); }}
                            className={`flex-1 min-h-0 w-full rounded-md border shadow-sm px-1 flex items-center justify-center text-center overflow-hidden transition-all active:scale-95 cursor-pointer ${aBg} ${aText} ${aBorder}`}
                          >
                            <span className="text-[10px] font-black uppercase tracking-tighter w-full leading-tight line-clamp-1" title={allocItem.title}>
                              {allocItem.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ===== MODO SINGLE-CARD: comportamento original ===== */}
                  {cellItem && (
                    <div
                      draggable={
                        !isCoordinator &&
                        (cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION')
                      }
                      onDragStart={!isCoordinator ? (e: React.DragEvent) => handleDragStart(e, cellItem.data) : undefined}
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleItemCardClick(instructor, cellItem.data); }}
                      className={(() => {
                        const anyData = cellItem.data as any;

                        const isCompanion =
                          !!anyData?.isCompanion ||
                          anyData?.role === 'COMPANION' ||
                          anyData?.kind === 'COMPANION' ||
                          anyData?.allocationType === 'COMPANION' ||
                          anyData?.source === 'COMPANION';

                        // ✅ Verifica confirmationStatus da demanda vinculada
                        const linkedDemandId = anyData?.demandId || anyData?.id;
                        const linkedDemand = linkedDemandId ? demands.find((d: any) => d.id === linkedDemandId) : null;
                        const isAConfirmar =
                          !isCompanion &&
                          cellItem.data.type === 'TREINAMENTO' &&
                          linkedDemand?.confirmationStatus === 'A_CONFIRMAR';

                        let baseBg = AGENDA_STYLING[cellItem.data.type]?.bg || 'bg-gray-100';
                        let baseText = AGENDA_STYLING[cellItem.data.type]?.text || 'text-gray-600';
                        let baseBorder = AGENDA_STYLING[cellItem.data.type]?.border || 'border-gray-200';

                        // 🟡 A Confirmar: sobrescreve para amarelo
                        if (isAConfirmar) {
                          baseBg = 'bg-amber-400';
                          baseText = 'text-amber-900';
                          baseBorder = 'border-amber-500';
                        }

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
                            <span className="px-2 py-[2px] rounded-md text-[10px] font-black uppercase tracking-widest bg-white/20 text-white border border-white/25">
                              ACOMPANHANTE
                            </span>
                          </div>
                        );
                      })()}

                      {/* Card content: structured for DEMANDA/ALLOCATION, fallback for others */}
                      {(cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION') ? (() => {
                        const demandId =
                          cellItem.data.source === 'ALLOCATION'
                            ? cellItem.data.demandId
                            : cellItem.data.demandId || cellItem.data.id;
                        const demand = demands.find(d => d.id === demandId);
                        const company = companies.find(c => c.id === demand?.companyId);
                        const training = trainings.find(t => t.id === demand?.trainingId);
                        const hasCompanion = hasCompanionForDemand(demandId);
                        const hasCTM = !!demandId && resourceAllocations.some(
                          a => a.resourceType === 'CENTRO_TREINAMENTO_MOVEL' && a.demandId === demandId
                        );
                        const trainingLabel = demand
                          ? buildCardLabel(demand, formatDateKey(day), { companyName: company?.name, trainingNr: training?.nr ?? training?.name })
                          : [cellItem.data.id, company?.name, training?.nr ?? training?.name].filter(Boolean).join(' • ');
                        return (
                          <>
                            {/* Linha 1: DEM-505 • VALE • SINAL - REC (N) */}
                            <span className="text-[11px] font-black uppercase tracking-tighter w-full text-center leading-tight line-clamp-2" title={trainingLabel}>
                              {trainingLabel}
                            </span>
                            {/* Linha 2: Local do Treinamento (sem emoji, fonte levemente maior) */}
                            {demand?.trainingLocal && demand.trainingLocal !== 'N/A' && (
                              <span className="text-[12px] font-semibold text-white/90 w-full text-center leading-tight">
                                {demand.trainingLocal}
                              </span>
                            )}
                            {/* Linha 3: ID SAP / Pedido Cliente */}
                            {demand?.clientDemandId && (
                              <span className="text-[10px] font-semibold text-white/85 w-full text-center leading-tight">
                                {demand.clientDemandId}
                              </span>
                            )}
                            {/* Linha 4: Badges na mesma linha */}
                            {(hasCompanion || hasCTM) && (
                              <span className="flex items-center justify-center gap-1.5 mt-0.5 opacity-80 w-full">
                                {hasCompanion && (
                                  <span className="text-[9px] font-black uppercase tracking-tight">C/ ACOMP.</span>
                                )}
                                {hasCompanion && hasCTM && <span className="text-[7px] opacity-50">|</span>}
                                {hasCTM && (
                                  <span className="flex items-center gap-0.5">
                                    <Truck size={9} strokeWidth={2.75} />
                                    <span className="text-[9px] font-black uppercase tracking-tight">CTM</span>
                                  </span>
                                )}
                              </span>
                            )}
                          </>
                        );
                      })() : (
                        <span className="text-[9px] font-black uppercase tracking-tighter w-full leading-tight line-clamp-2" title={cellItem.data.title}>
                          {cellItem.data.title}
                        </span>
                      )}
                    </div>
                  )}

                  {/* ===== PREVIEW OVERLAY ===== */}
                  {cellPreviews.length > 0 && (
                    <div className={`absolute inset-0 p-0.5 flex flex-col gap-0.5 z-10 ${cellItem ? '' : ''}`}>
                      {cellPreviews.map(preview => (
                        <div
                          key={preview.id}
                          className={`w-full flex-1 rounded-lg border-2 border-dashed p-0.5 flex flex-col items-center justify-center text-center overflow-hidden transition-all ${
                            preview.hasConflict
                              ? 'bg-red-500/25 border-red-400 text-red-800'
                              : preview.isException
                              ? 'bg-amber-500/25 border-amber-400 text-amber-800'
                              : 'bg-emerald-500/25 border-emerald-400 text-emerald-800'
                          }`}
                          onClick={e => e.stopPropagation()}
                        >
                          <span className="text-[8px] font-black uppercase tracking-tighter line-clamp-1 leading-none" title={preview.instructorName}>
                            {preview.instructorName.split(' ')[0]}
                          </span>
                          <span className="text-[6px] font-bold uppercase opacity-70 leading-none mt-0.5">
                            {preview.isCompanion ? 'ACOMP.' : 'PREVIEW'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewItems(prev => prev.filter(p => p.id !== preview.id));
                            }}
                            className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center text-[8px] font-black leading-none"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                    </td>

                      );
                    })}
                  </tr>
                ))}
              {/* Linha Centro Móvel */}
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              {/* COLUNA "INSTRUTOR" DO CTM */}
              <td className="p-4 border-r border-b border-gray-200 font-black text-[11px] text-amber-700 bg-[#fffbeb] sticky left-0 z-30 w-[200px] min-w-[200px] align-middle">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 border border-amber-200 shadow-sm">
                    <Truck size={18} />
                  </div>
                  <span className="uppercase tracking-tight leading-tight">Centro Móvel</span>
                </div>
              </td>

              {/* COLUNA LOCAL (CTM) */}
              <td className="p-4 border-r border-b border-gray-200 bg-[#fffbeb] sticky left-[200px] z-20 w-[90px] min-w-[90px]">
                {/* vazio */}
              </td>
                {daysInView.map(day => {
                  const key = formatDateKey(day);
                  const item = mobileAgendaByDay[key];
                  const cellItem = item ? { type: item.source, data: item } : null;

                  if (!cellItem)
                    return (
                      <td
                    key={`mobile-${key}`}
                    onClick={() => handleMobileCellClick(day)}
                    className={`p-1 border-r border-b border-gray-100 relative cursor-pointer overflow-hidden transition-all align-top ${
                    day.getDay() % 6 === 0 ? 'bg-slate-50/50' : ''
                  }`}
                      />
                    );

                  const isStart = getDatePart(cellItem.data.start) === key;

                  return (
                  <td
                    key={`mobile-${key}`}
                    onClick={() => handleMobileCellClick(day)}
                   className={`p-1 border-r border-b border-gray-100 relative cursor-pointer overflow-hidden transition-all align-top ${
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
                            {cellItem.type === 'MIRROR' && (
                              <span className="text-[7px] font-black opacity-60 uppercase mb-0.5 tracking-tighter truncate w-full">
                                ALOCADO
                              </span>
                            )}
                            <p className="text-[8px] font-bold uppercase truncate w-full px-0.5 leading-none" title={cellItem.data.title}>{cellItem.data.title}</p>
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

      {/* ===== ALLOCATION DRAWER ===== */}
      <AllocationDrawer
        drawerState={drawerState}
        setDrawerState={setDrawerState}
        selectedDemandId={drawerSelectedDemandId}
        setSelectedDemandId={setDrawerSelectedDemandId}
        previewItems={previewItems}
        setPreviewItems={setPreviewItems}
        onNavigateToDate={handleNavigateToDemandDates}
        companionMode={drawerCompanionMode}
        setCompanionMode={setDrawerCompanionMode}
      />

      {/* MODAL EVENTO LOCAL CTM */}
      {activeMobileEvent && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in no-print">
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
      , document.body)}

      {/* MODAL PRINCIPAL */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in no-print">
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

                const confirmStatus = linkedDemand.confirmationStatus ?? 'CONFIRMADO';

                return (
                  <div className="space-y-2 mb-2">
                    {/* Bloco azul com info da demanda */}
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-2">
                      <div className="flex items-center gap-2">
                        <Tag size={14} className="text-blue-500" />
                        <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                          DEMANDA: #{linkedDemand.id}
                        </span>
                      </div>

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

                    {/* ✅ SELETOR DE STATUS DE CONFIRMAÇÃO */}
                    <div className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-4 pt-2.5 pb-1.5 bg-slate-50 border-b border-slate-100">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                          STATUS DA DEMANDA
                        </label>
                      </div>
                      <div className="flex">
                        <button
                          onClick={() => updateDemand({ ...linkedDemand, confirmationStatus: 'A_CONFIRMAR' })}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all border-r ${
                            confirmStatus === 'A_CONFIRMAR'
                              ? 'bg-amber-400 text-amber-900 border-amber-500'
                              : 'bg-white text-slate-400 border-slate-100 hover:bg-amber-50 hover:text-amber-700'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          A Confirmar
                        </button>
                        <button
                          onClick={() => updateDemand({ ...linkedDemand, confirmationStatus: 'CONFIRMADO' })}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all ${
                            confirmStatus === 'CONFIRMADO'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-slate-400 hover:bg-blue-50 hover:text-blue-700'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                          Confirmado
                        </button>
                      </div>
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

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MapPin size={12} className="text-slate-400" />
                        <label className="text-[8px] font-black text-slate-400 uppercase">ESTADO</label>
                      </div>
                      <p className="text-xs font-bold text-slate-700">{linked?.demandState || 'Não informado'}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MapPin size={12} className="text-slate-400" />
                        <label className="text-[8px] font-black text-slate-400 uppercase">CORREDOR</label>
                      </div>
                      <p className="text-xs font-bold text-slate-700">{linked?.corredor || 'Não informado'}</p>
                    </div>
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
                        {getAgendaLabel(type)}
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
      , document.body)}
    </div>
  );
};

export default CalendarView;
