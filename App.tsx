import React, { useState, createContext, useContext, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  Briefcase,
  Calendar,
  Settings,
  Menu,
  X,
  Truck,
  BarChart3,
  ClipboardCheck,
  Info,
  CheckCircle2,
  AlertCircle,
  FileSearch
} from 'lucide-react';

import {
  Company,
  Region,
  Area,
  Training,
  Instructor,
  Demand,
  DemandStatus,
  AgendaItem,
  OperationalBases,
  OperationalBaseKey,
  Measurement,
  InstructorAllocation,
  LogisticAllocation
} from './types';

import {
  MOCK_COMPANIES,
  MOCK_REGIONS,
  MOCK_AREAS,
  MOCK_TRAININGS,
  MOCK_INSTRUCTORS,
  MOCK_DEMANDS,
  INITIAL_OPERATIONAL_BASES
} from './constants';

import Dashboard from './components/Dashboard';
import Registrations from './components/Registrations';
import Demands from './components/Demands';
import CalendarView from './components/CalendarView';
import Logistics from './components/Logistics';
import LogisticsControl from './components/LogisticsControl';
import MeasurementView from './components/Measurement';
import Evidences from './components/Evidences';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import type { EvidenceData } from './types';

/* ======================================================
   CONTEXT
====================================================== */

interface AppState {
  companies: Company[];
  regions: Region[];
  areas: Area[];
  trainings: Training[];
  instructors: Instructor[];
  demands: Demand[];
  measurements: Measurement[];
  agendaItems: AgendaItem[];
  instructorAllocations: InstructorAllocation[];
  resourceAllocations: LogisticAllocation[];
  operationalBases: OperationalBases;
  notification: { message: string; type: 'info' | 'success' | 'error' } | null;
  nextDemandNumber: number;

  // ✅ Evidências (GLOBAL)
  evidenceStore: Record<string, EvidenceData>;
  setEvidenceStore: React.Dispatch<React.SetStateAction<Record<string, EvidenceData>>>;
  getEvidenceAutoStatus: (demandId: string) => 'COMPLETA' | 'PENDENTE';

  setNextDemandNumber: React.Dispatch<React.SetStateAction<number>>;
  setNotification: React.Dispatch<React.SetStateAction<{ message: string; type: 'info' | 'success' | 'error' } | null>>;
  addDemand: (d: Demand) => void;
  updateDemand: (d: Demand) => void;
  deleteDemand: (id: string) => void;
  cancelDemand: (demandId: string) => void;
  addInstructor: (i: Instructor) => void;
  updateInstructor: (i: Instructor) => void;
  addCompany: (c: Company) => void;
  updateCompany: (c: Company) => void;
  addTraining: (t: Training) => void;
  updateTraining: (t: Training) => void;

  // Measurement Actions
  updateMeasurement: (m: Measurement) => void;

  // Agenda Actions
  addAgendaItem: (item: AgendaItem) => void;
  updateAgendaItem: (item: AgendaItem) => void;
  removeAgendaItem: (id: string) => void;

  // Instructor Allocation Actions
  addInstructorAllocation: (a: InstructorAllocation) => void;
  // ✅ NOVO (necessário para o drag & drop não "desalocar" a demanda)
  updateInstructorAllocation: (a: InstructorAllocation) => void;
  removeInstructorAllocation: (id: string) => void;

  // Resource Allocation Actions
  addResourceAllocation: (a: LogisticAllocation) => void;
  updateResourceAllocation: (a: LogisticAllocation) => void;
  removeResourceAllocation: (id: string) => void;

  // Operational Bases Actions
  updateOperationalBase: (key: OperationalBaseKey, newList: string[]) => void;

  recommendInstructors: (demand: Demand) => {
    suggested: (Instructor & { score: number })[];
    exceptions: (Instructor & { score: number })[];
  };
  allocateInstructor: (demandId: string, instructorId: string, startDate?: string, endDate?: string) => boolean;
  deallocateInstructor: (demandId: string) => void;
  hasScheduleConflict: (
    instructorId: string,
    startDate: string,
    endDate: string,
    excludeDemandId?: string,
    excludeAgendaItemId?: string,
    excludeAllocationId?: string
  ) => boolean;
  hasResourceConflict: (startDate: string, endDate: string, excludeDemandId?: string, excludeAllocationId?: string) => boolean;
  isCompanyFullLogistics: (companyId: string) => boolean;

  // HÍBRIDO (MVP): definir/validar período presencial (prática)
  setHybridPracticePeriod: (demandId: string, practiceStartDate: string, practiceEndDate: string) => boolean;
}

const AppContext = createContext<AppState | null>(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

/* ======================================================
   PROVIDER
====================================================== */

const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [companies, setCompanies] = useState<Company[]>(MOCK_COMPANIES);
  const [regions] = useState<Region[]>(MOCK_REGIONS);
  const [areas] = useState<Area[]>(MOCK_AREAS);
  const [trainings, setTrainings] = useState<Training[]>(MOCK_TRAININGS);
  const [instructors, setInstructors] = useState<Instructor[]>(MOCK_INSTRUCTORS);
  const [demands, setDemands] = useState<Demand[]>(MOCK_DEMANDS);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [instructorAllocations, setInstructorAllocations] = useState<InstructorAllocation[]>([]);
  const [resourceAllocations, setResourceAllocations] = useState<LogisticAllocation[]>([]);
  const [operationalBases, setOperationalBases] = useState<OperationalBases>(INITIAL_OPERATIONAL_BASES);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [nextDemandNumber, setNextDemandNumber] = useState<number>(6301);

  // ✅ Evidências (GLOBAL)
  const [evidenceStore, setEvidenceStore] = useState<Record<string, EvidenceData>>({});

  // ✅ Status automático de evidências (ONLINE não exige fotos)
  const getEvidenceAutoStatus = useCallback(
    (demandId: string): 'COMPLETA' | 'PENDENTE' => {
      const data = evidenceStore[demandId];
      if (!data) return 'PENDENTE';

      const demand = demands.find(d => d.id === demandId);
      const training = trainings.find(t => t.id === demand?.trainingId);

      const isOnline = training?.modality === 'ONLINE';

      const hasAttendance = (data.attendanceList || []).length > 0;
      const hasCertificates = (data.certificates || []).length > 0;
      const hasPhotos = (data.photos || []).length > 0;

      const isComplete = isOnline ? hasAttendance && hasCertificates : hasAttendance && hasCertificates && hasPhotos;

      return isComplete ? 'COMPLETA' : 'PENDENTE';
    },
    [evidenceStore, demands, trainings]
  );

  // Auto-clear notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Inicializar medições para mock legados
  useEffect(() => {
    if (measurements.length === 0 && demands.length > 0) {
      const initialMeasurements = demands.map(d => ({
        id: `MEA-${d.id}`,
        demandId: d.id,
        status: 'NAO_INICIADA' as any,
        expenses: { breakfast: '', lunch: '', dinner: '', transport: '', others: '' },
        attachments: [],
        otherExpenses: [],
        updatedAt: new Date().toISOString()
      }));
      setMeasurements(initialMeasurements);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizeDate = useCallback((dateStr?: string) => {
    if (!dateStr) return null;
    // Aceita "YYYY-MM-DD" ou ISO completo; sempre compara no início do dia
    const base = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const d = new Date(base + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }, []);

  const isDateOnly = useCallback((s?: string) => {
    if (!s) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }, []);

  const ensureDateTime = useCallback(
    (s: string, kind: 'start' | 'end') => {
      // Se vier "YYYY-MM-DD", injeta 08:00 / 18:00 para evitar bugs e manter padrão
      if (isDateOnly(s)) {
        return `${s}T${kind === 'start' ? '08:00' : '18:00'}`;
      }
      return s;
    },
    [isDateOnly]
  );

  const getEffectiveDemandRange = useCallback(
    (d: Demand) => {
      // 🔑 Regra master: HÍBRIDO usa apenas o período de prática (se definido)
      if (d.modality === 'HIBRIDO' && d.practiceStartDate && d.practiceEndDate) {
        return {
          start: ensureDateTime(d.practiceStartDate, 'start'),
          end: ensureDateTime(d.practiceEndDate, 'end')
        };
      }
      return {
        start: ensureDateTime(d.startDate, 'start'),
        end: ensureDateTime(d.endDate, 'end')
      };
    },
    [ensureDateTime]
  );

  const sanitizeHybridPracticePeriod = useCallback(
    (d: Demand): Demand => {
      // Se não for híbrido, nunca mantém período de prática
      if (d.modality !== 'HIBRIDO') {
        const { practiceStartDate, practiceEndDate, ...rest } = d;
        return rest as Demand;
      }

      // Se for híbrido, mantém somente se estiver completo e dentro do range
      const totalStart = normalizeDate(d.startDate);
      const totalEnd = normalizeDate(d.endDate);
      const pStart = normalizeDate(d.practiceStartDate);
      const pEnd = normalizeDate(d.practiceEndDate);

      const totalValid = !!totalStart && !!totalEnd && totalStart <= totalEnd;
      const practiceComplete = !!pStart && !!pEnd;

      if (!totalValid || !practiceComplete) {
        return { ...d, practiceStartDate: undefined, practiceEndDate: undefined };
      }

      const withinRange = pStart! >= totalStart! && pEnd! <= totalEnd! && pStart! <= pEnd!;
      if (!withinRange) {
        return { ...d, practiceStartDate: undefined, practiceEndDate: undefined };
      }

      return d;
    },
    [normalizeDate]
  );

  /* -------------------------
     CRUD (Functional Updates)
  -------------------------- */
  const addDemand = useCallback(
    (d: Demand) => {
      let seq = 0;

      // Captura o número atual de forma atômica (sem risco de ID duplicado)
      setNextDemandNumber(prev => {
        seq = prev;
        return prev + 1;
      });

      const nextId = `DEM-${seq}`;

      const newDemand = sanitizeHybridPracticePeriod({
        ...d,
        id: nextId,
        status: 'NOVA' as DemandStatus
      });

      const newMeasurement: Measurement = {
        id: `MEA-${nextId}`,
        demandId: nextId,
        status: 'NAO_INICIADA',
        expenses: {
          breakfast: '',
          lunch: '',
          dinner: '',
          transport: '',
          others: ''
        },
        attachments: [],
        otherExpenses: [],
        updatedAt: new Date().toISOString()
      };

      setDemands(prev => [...prev, newDemand]);
      setMeasurements(prev => [...prev, newMeasurement]);

      // (Opcional) já inicia o store de evidências vazio, se você já faz isso hoje
      setEvidenceStore(prev => ({
        ...prev,
        [nextId]:
          prev[nextId] ??
          {
            demandId: nextId,
            attendanceList: [],
            certificates: [],
            photos: []
          }
      }));
    },
    [sanitizeHybridPracticePeriod]
  );

  const updateDemand = useCallback(
    (d: Demand) => {
      setDemands(prev =>
        prev.map(item => {
          if (item.id !== d.id) return item;
          const merged = { ...item, ...d } as Demand;
          return sanitizeHybridPracticePeriod(merged);
        })
      );
    },
    [sanitizeHybridPracticePeriod]
  );

  const setHybridPracticePeriod = useCallback(
    (demandId: string, practiceStartDate: string, practiceEndDate: string) => {
      const demand = demands.find(d => d.id === demandId);
      if (!demand) return false;
      if (demand.modality !== 'HIBRIDO') return false;

      const totalStart = normalizeDate(demand.startDate);
      const totalEnd = normalizeDate(demand.endDate);
      const pStart = normalizeDate(practiceStartDate);
      const pEnd = normalizeDate(practiceEndDate);

      if (!totalStart || !totalEnd || totalStart > totalEnd) {
        setNotification({ message: 'Período total da demanda inválido.', type: 'error' });
        return false;
      }
      if (!pStart || !pEnd) {
        setNotification({ message: 'Selecione datas válidas para o período de prática.', type: 'error' });
        return false;
      }
      if (pStart > pEnd) {
        setNotification({ message: 'A data de início da prática não pode ser maior que a data de fim.', type: 'error' });
        return false;
      }
      if (pStart < totalStart || pEnd > totalEnd) {
        setNotification({ message: 'O período de prática deve estar dentro do período total da demanda.', type: 'error' });
        return false;
      }

      updateDemand({ ...demand, practiceStartDate, practiceEndDate } as Demand);

      setNotification({ message: 'Período de prática salvo com sucesso.', type: 'success' });
      return true;
    },
    [demands, normalizeDate, setNotification, updateDemand]
  );

  const deleteDemand = useCallback((id: string) => {
    setDemands(prev => prev.filter(d => d.id !== id));
    setMeasurements(prev => prev.filter(m => m.demandId !== id));
    setAgendaItems(prev => prev.filter(item => item.relatedDemandId !== id));
    setInstructorAllocations(prev => prev.filter(a => a.demandId !== id));
    setResourceAllocations(prev => prev.filter(a => a.demandId !== id));

    // ✅ Remove evidências da demanda deletada
    setEvidenceStore(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const cancelDemand = useCallback((demandId: string) => {
    setDemands(prev => prev.map(d => (d.id === demandId ? { ...d, status: 'CANCELADA' } : d)));
  }, []);

  const updateMeasurement = useCallback((m: Measurement) => {
    setMeasurements(prev => prev.map(item => (item.id === m.id ? { ...m, updatedAt: new Date().toISOString() } : item)));
  }, []);

  const addInstructor = useCallback((i: Instructor) => {
    setInstructors(prev => [...prev, i]);
  }, []);

  const updateInstructor = useCallback((i: Instructor) => {
    setInstructors(prev => prev.map(item => (item.id === i.id ? i : item)));
  }, []);

  const addCompany = useCallback((c: Company) => {
    setCompanies(prev => [...prev, c]);
  }, []);

  const updateCompany = useCallback((c: Company) => {
    setCompanies(prev => prev.map(item => (item.id === c.id ? c : item)));
  }, []);

  const addTraining = useCallback((t: Training) => {
    setTrainings(prev => [...prev, t]);
  }, []);

  const updateTraining = useCallback((t: Training) => {
    setTrainings(prev => prev.map(item => (item.id === t.id ? t : item)));
  }, []);

  const addAgendaItem = useCallback((item: AgendaItem) => {
    setAgendaItems(prev => [...prev, item]);
  }, []);

  const updateAgendaItem = useCallback((item: AgendaItem) => {
    setAgendaItems(prev => prev.map(i => (i.id === item.id ? item : i)));
  }, []);

  const removeAgendaItem = useCallback((id: string) => {
    setAgendaItems(prev => prev.filter(i => i.id !== id));
  }, []);

  /**
   * ADD INSTRUCTOR ALLOCATION WITH AUTOMATIC SPLIT
   */
  const addInstructorAllocation = useCallback((newAlloc: InstructorAllocation) => {
    setInstructorAllocations(prev => {
      const fmt = (d: Date) => {
        const z = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
      };

      const nStart = new Date(newAlloc.startDate);
      const nEnd = new Date(newAlloc.endDate);
      const nStartTime = nStart.getTime();
      const nEndTime = nEnd.getTime();

      const adjusted: InstructorAllocation[] = [];

      prev.forEach(old => {
        if (old.demandId !== newAlloc.demandId) {
          adjusted.push(old);
          return;
        }

        const oStart = new Date(old.startDate);
        const oEnd = new Date(old.endDate);
        const oStartTime = oStart.getTime();
        const oEndTime = oEnd.getTime();

        if (nStartTime <= oStartTime && nEndTime >= oEndTime) return;

        if (nStartTime > oStartTime && nEndTime < oEndTime) {
          const p1End = new Date(nStart);
          p1End.setDate(p1End.getDate() - 1);
          p1End.setHours(18, 0, 0, 0);

          adjusted.push({
            ...old,
            id: `${old.id}-1`,
            endDate: fmt(p1End)
          });

          const p2Start = new Date(nEnd);
          p2Start.setDate(p2Start.getDate() + 1);
          p2Start.setHours(8, 0, 0, 0);

          adjusted.push({
            ...old,
            id: `${old.id}-2`,
            startDate: fmt(p2Start)
          });
          return;
        }

        if (nStartTime > oStartTime && nStartTime <= oEndTime) {
          const trimmedEnd = new Date(nStart);
          trimmedEnd.setDate(trimmedEnd.getDate() - 1);
          trimmedEnd.setHours(18, 0, 0, 0);

          adjusted.push({
            ...old,
            endDate: fmt(trimmedEnd)
          });
          return;
        }

        if (nEndTime >= oStartTime && nEndTime < oEndTime) {
          const trimmedStart = new Date(nEnd);
          trimmedStart.setDate(trimmedStart.getDate() + 1);
          trimmedStart.setHours(8, 0, 0, 0);

          adjusted.push({
            ...old,
            startDate: fmt(trimmedStart)
          });
          return;
        }

        adjusted.push(old);
      });

      return [...adjusted, newAlloc];
    });
  }, []);

  // ✅ NOVO: update (necessário para o drag & drop manter status e não "desalocar")
  const updateInstructorAllocation = useCallback((updated: InstructorAllocation) => {
    setInstructorAllocations(prev => prev.map(a => (a.id === updated.id ? updated : a)));
  }, []);

  /**
   * REMOVE INSTRUCTOR ALLOCATION
   * ✅ Corrigido: HÍBRIDO expande/reconstrói SOMENTE no período da prática
   * ✅ Corrigido: remove ranges inválidos (ex.: 18/01 até 17/01)
   * ✅ Corrigido: TS (unknown -> string) via type guard
   */
  const removeInstructorAllocation = useCallback(
    (id: string) => {
      setInstructorAllocations(prev => {
        const toRemove = prev.find(a => a.id === id);
        if (!toRemove) return prev;

        const demandId = toRemove.demandId;
        const demand = demands.find(d => d.id === demandId);
        if (!demand) return prev.filter(a => a.id !== id);

        const otherAllocations = prev.filter(a => a.demandId !== demandId);

        // allocations restantes do MESMO demand (já removendo o id)
        const remainingForDemand = prev.filter(a => a.demandId === demandId && a.id !== id);

        // 🔑 range efetivo (HIBRIDO => prática definida; senão total)
        const effective = getEffectiveDemandRange(demand);

        const isValidRange = (startStr: string, endStr: string) => {
          const s = new Date(startStr).getTime();
          const e = new Date(endStr).getTime();
          return !isNaN(s) && !isNaN(e) && s <= e;
        };

        // Se não sobrou ninguém, limpa demanda
        if (remainingForDemand.length === 0) {
          setDemands(dPrev => dPrev.map(d => (d.id === demandId ? { ...d, instructorId: undefined, status: 'PENDENTE' } : d)));
          return otherAllocations;
        }

        // ✅ Se só sobrou 1 instrutor único, MERGE tudo em um único allocation
        const uniqueInstructorIds: string[] = Array.from(
          new Set<string>(remainingForDemand.map(a => a.instructorId).filter((x): x is string => typeof x === 'string' && x.length > 0))
        );
        if (uniqueInstructorIds.length === 1) {
          const remainingInstructorId = uniqueInstructorIds[0];
          const instName = instructors.find(i => i.id === remainingInstructorId)?.name || 'outro instrutor';

          const merged: InstructorAllocation = {
            id: `ALOC-MERGED-${Date.now()}`,
            demandId,
            instructorId: remainingInstructorId,
            startDate: effective.start,
            endDate: effective.end
          };

          setNotification({
            message: `O período removido foi automaticamente reassumido pelo instrutor ${instName} para manter a demanda completa.`,
            type: 'info'
          });

          return [...otherAllocations, merged];
        }

        // Caso existam múltiplos instrutores, reconstrói mantendo o período completo (efetivo)
        const z = (n: number) => n.toString().padStart(2, '0');
        const fmt = (d: Date) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;

        const sorted = [...remainingForDemand].sort((a, b) => a.startDate.localeCompare(b.startDate));

        const rebuilt = sorted.map((alloc, idx) => {
          let s = alloc.startDate;
          let e = alloc.endDate;

          if (idx === 0) s = effective.start;
          if (idx === sorted.length - 1) e = effective.end;

          if (idx < sorted.length - 1) {
            const nextStart = new Date(sorted[idx + 1].startDate);
            const currentEnd = new Date(nextStart);
            currentEnd.setDate(currentEnd.getDate() - 1);
            currentEnd.setHours(18, 0, 0, 0);
            e = fmt(currentEnd);
          }

          return { ...alloc, startDate: s, endDate: e };
        });

        // ✅ elimina qualquer allocation inválido (ex.: 18/01 até 17/01)
        const cleaned = rebuilt.filter(a => isValidRange(a.startDate, a.endDate));

        setNotification({
          message: `O período removido foi automaticamente reassumido por outro instrutor para manter a demanda completa.`,
          type: 'info'
        });

        return [...otherAllocations, ...cleaned];
      });
    },
    [setDemands, demands, instructors, getEffectiveDemandRange, setNotification]
  );

  const addResourceAllocation = useCallback((a: LogisticAllocation) => {
    setResourceAllocations(prev => [...prev, a]);
  }, []);

  const updateResourceAllocation = useCallback((a: LogisticAllocation) => {
    setResourceAllocations(prev => prev.map(item => (item.id === a.id ? a : item)));
  }, []);

  const removeResourceAllocation = useCallback((id: string) => {
    setResourceAllocations(prev => prev.filter(a => a.id !== id));
  }, []);

  const updateOperationalBase = useCallback((key: OperationalBaseKey, newList: string[]) => {
    setOperationalBases(prev => ({ ...prev, [key]: newList }));
  }, []);

  /* -------------------------
     Business rules
  -------------------------- */
  const isCompanyFullLogistics = useCallback(
    (companyId: string): boolean => {
      return companies.find(c => c.id === companyId)?.logisticsType === 'COMPLETA' || false;
    },
    [companies]
  );

  const hasScheduleConflict = useCallback(
    (
      instructorId: string,
      startDate: string,
      endDate: string,
      excludeDemandId?: string,
      excludeAgendaItemId?: string,
      excludeAllocationId?: string
    ): boolean => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // =====================================================
      // 1) DEMANDAS (APENAS COMO FALLBACK – SEM ALOCAÇÃO)
      //    ✅ HÍBRIDO: bloqueia SOMENTE período efetivo (prática) se existir
      // =====================================================
      const demandConflict = demands.some(d => {
        if (excludeDemandId && d.id === excludeDemandId) return false;
        if (d.instructorId !== instructorId) return false;
        if (d.status === 'CANCELADA') return false;

        // 🔑 REGRA PRINCIPAL:
        // Se a demanda já possui alocação de instrutor,
        // ela NÃO pode bloquear o período inteiro
        const hasExplicitAllocation = instructorAllocations.some(a => a.demandId === d.id);
        if (hasExplicitAllocation) return false;

        const eff = getEffectiveDemandRange(d);
        const dStart = new Date(eff.start);
        const dEnd = new Date(eff.end);
        return start <= dEnd && end >= dStart;
      });

      if (demandConflict) return true;

      // =====================================================
      // 2) ALOCAÇÕES REAIS DE INSTRUTOR (REGRA PRINCIPAL)
      // =====================================================
      const allocationConflict = instructorAllocations.some(a => {
        if (excludeAllocationId && a.id === excludeAllocationId) return false;
        if (a.instructorId !== instructorId) return false;

        const aStart = new Date(a.startDate);
        const aEnd = new Date(a.endDate);
        return start <= aEnd && end >= aStart;
      });

      if (allocationConflict) return true;

      // =====================================================
      // 3) COMPROMISSOS MANUAIS DA AGENDA
      // =====================================================
      const agendaConflict = agendaItems.some(item => {
        if (excludeAgendaItemId && item.id === excludeAgendaItemId) return false;
        if (item.instructorId !== instructorId) return false;

        const iStart = new Date(item.startDate);
        const iEnd = new Date(item.endDate);
        return start <= iEnd && end >= iStart;
      });

      return agendaConflict;
    },
    [demands, instructorAllocations, agendaItems, getEffectiveDemandRange]
  );

  const hasResourceConflict = useCallback(
    (startDate: string, endDate: string, excludeDemandId?: string, excludeAllocationId?: string): boolean => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      return resourceAllocations.some(a => {
        if (excludeAllocationId && a.id === excludeAllocationId) return false;

        const d = demands.find(dm => dm.id === a.demandId);
        if (d) {
          if (excludeDemandId && d.id === excludeDemandId) return false;
          if (d.status === 'CANCELADA') return false;
        }

        const aStart = new Date(a.startDate);
        const aEnd = new Date(a.endDate);
        return start <= aEnd && end >= aStart;
      });
    },
    [resourceAllocations, demands]
  );

  const recommendInstructors = useCallback(
    (demand: Demand) => {
      // ✅ Sempre usa período efetivo (HIBRIDO => prática definida; senão total)
      const effective = getEffectiveDemandRange(demand);

      const activeCapableInstructors = instructors
        .filter(
          i =>
            i.status === 'ATIVO' &&
            i.skills?.some(s => s.trainingId === demand.trainingId) &&
            !hasScheduleConflict(i.id, effective.start, effective.end, demand.id)
        )
        .map(i => {
          const skill = i.skills?.find(s => s.trainingId === demand.trainingId);
          return { ...i, score: skill?.level ?? 0 };
        })
        .sort((a, b) => b.score - a.score);

      return {
        suggested: activeCapableInstructors.filter(
          i => !demand.regionId || demand.trainingLocal === 'N/A' || i.regionIds?.includes(demand.regionId)
        ),
        exceptions: activeCapableInstructors.filter(i => demand.regionId && demand.trainingLocal !== 'N/A' && !i.regionIds?.includes(demand.regionId))
      };
    },
    [instructors, hasScheduleConflict, getEffectiveDemandRange]
  );

  const allocateInstructor = useCallback(
    (demandId: string, instructorId: string, startDate?: string, endDate?: string): boolean => {
      const demand = demands.find(d => d.id === demandId);
      if (!demand) return false;

      // ✅ Regra master: HÍBRIDO exige prática definida para alocação (tela de demanda/exceções)
      if (demand.modality === 'HIBRIDO') {
        const hasPractice = !!demand.practiceStartDate && !!demand.practiceEndDate;
        if (!hasPractice) {
          setNotification({
            message: 'Para demandas HÍBRIDAS, defina primeiro o período presencial (prática) antes de alocar o instrutor.',
            type: 'error'
          });
          return false;
        }
      }

      // Se for híbrido, range efetivo é a prática; senão é o total
      const effective = getEffectiveDemandRange(demand);

      const finalStart = ensureDateTime(startDate || effective.start, 'start');
      const finalEnd = ensureDateTime(endDate || effective.end, 'end');

      if (!finalStart || !finalEnd) return false;

      updateDemand({
        ...demand,
        instructorId,
        status: 'ALOCADA'
      });

      addInstructorAllocation({
        id: `ALOC-${Date.now()}`,
        demandId: demandId,
        instructorId: instructorId,
        startDate: finalStart,
        endDate: finalEnd
      });

      return true;
    },
    [demands, updateDemand, addInstructorAllocation, setNotification, getEffectiveDemandRange, ensureDateTime]
  );

  const deallocateInstructor = useCallback(
    (demandId: string) => {
      setDemands(prev => prev.map(d => (d.id === demandId ? { ...d, instructorId: undefined, status: 'PENDENTE' } : d)));
      setInstructorAllocations(prev => prev.filter(a => a.demandId !== demandId));
    },
    [setDemands, setInstructorAllocations]
  );

  const contextValue = useMemo(
    () => ({
      companies,
      regions,
      areas,
      trainings,
      instructors,
      demands,
      measurements,
      agendaItems,
      instructorAllocations,
      resourceAllocations,
      operationalBases,
      notification,
      nextDemandNumber,
      setNextDemandNumber,
      setNotification,
      setHybridPracticePeriod,

      // ✅ Evidências (GLOBAL)
      evidenceStore,
      setEvidenceStore,
      getEvidenceAutoStatus,

      addDemand,
      updateDemand,
      deleteDemand,
      cancelDemand,
      addInstructor,
      updateInstructor,
      addCompany,
      updateCompany,
      addTraining,
      updateTraining,
      updateMeasurement,
      addAgendaItem,
      updateAgendaItem,
      removeAgendaItem,
      addInstructorAllocation,
      // ✅ NOVO
      updateInstructorAllocation,
      removeInstructorAllocation,
      addResourceAllocation,
      updateResourceAllocation,
      removeResourceAllocation,
      updateOperationalBase,
      recommendInstructors,
      allocateInstructor,
      deallocateInstructor,
      hasScheduleConflict,
      hasResourceConflict,
      isCompanyFullLogistics
    }),
    [
      companies,
      regions,
      areas,
      trainings,
      instructors,
      demands,
      measurements,
      agendaItems,
      instructorAllocations,
      resourceAllocations,
      operationalBases,
      notification,
      nextDemandNumber,

      evidenceStore,
      getEvidenceAutoStatus,

      addDemand,
      updateDemand,
      deleteDemand,
      cancelDemand,
      addInstructor,
      updateInstructor,
      addCompany,
      updateCompany,
      addTraining,
      updateTraining,
      updateMeasurement,
      addAgendaItem,
      updateAgendaItem,
      removeAgendaItem,
      addInstructorAllocation,
      updateInstructorAllocation,
      removeInstructorAllocation,
      addResourceAllocation,
      updateResourceAllocation,
      removeResourceAllocation,
      updateOperationalBase,
      recommendInstructors,
      allocateInstructor,
      deallocateInstructor,
      hasScheduleConflict,
      hasResourceConflict,
      isCompanyFullLogistics,
      setHybridPracticePeriod
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/* ======================================================
   APP LAYOUT
====================================================== */

type View = 'dashboard' | 'demands' | 'calendar' | 'registrations' | 'logistics' | 'logistics-control' | 'measurement' | 'evidences';

type Action =
  | 'create_demand'
  | 'update_demand'
  | 'delete_demand'
  | 'cancel_demand'
  | 'allocate_instructor'
  | 'edit_agenda'
  | 'create_agenda'
  | 'delete_agenda'
  | 'manage_registrations'
  | 'manage_logistics'
  | 'manage_measurement';

const ROLE_PERMISSIONS: Record<string, View[]> = {
  admin: ['dashboard', 'demands', 'calendar', 'registrations', 'logistics', 'logistics-control', 'measurement', 'evidences'],
  analista: ['dashboard', 'demands', 'calendar', 'registrations', 'logistics', 'logistics-control', 'evidences'],
  coordenador: ['calendar'] // apenas visualização
};

const ROLE_ACTIONS: Record<string, Action[]> = {
  admin: [
    'create_demand',
    'update_demand',
    'delete_demand',
    'cancel_demand',
    'allocate_instructor',
    'edit_agenda',
    'create_agenda',
    'delete_agenda',
    'manage_registrations',
    'manage_logistics',
    'manage_measurement'
  ],
  analista: [
    'create_demand',
    'update_demand',
    'delete_demand',
    'cancel_demand',
    'allocate_instructor',
    'edit_agenda',
    'create_agenda',
    'delete_agenda',
    'manage_registrations',
    'manage_logistics'
    // ⚠️ sem manage_measurement (pois não entra em medição)
  ],
  coordenador: [
    // somente visualização → nenhuma ação
  ]
};

const canPerformAction = (role: string | undefined, action: Action): boolean => {
  if (!role) return false;
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
};

const canAccessView = (role: string | undefined, view: View) => {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(view);
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { notification, setNotification } = useApp();
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile?.role) return;

    if (profile.role === 'coordenador') {
      setCurrentView('calendar');
    }

    if (profile.role === 'analista') {
      setCurrentView('dashboard');
    }

    if (profile.role === 'admin') {
      setCurrentView('dashboard');
    }
  }, [profile?.role]);

  const renderContent = () => {
    if (!canAccessView(profile?.role, currentView)) {
      return (
        <div className="p-6">
          <h2 className="text-lg font-semibold text-red-600">Acesso não autorizado</h2>
          <p>Você não tem permissão para acessar esta área.</p>
        </div>
      );
    }
    switch (currentView) {
      case 'demands':
        return <Demands />;
      case 'calendar':
        return <CalendarView />;
      case 'registrations':
        return <Registrations />;
      case 'logistics':
        return <Logistics />;
      case 'logistics-control':
        return <LogisticsControl />;
      case 'measurement':
        return <MeasurementView />;
      case 'evidences':
        return <Evidences />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden relative">
      {/* GLOBAL NOTIFICATION SYSTEM */}
      {notification && (
        <div className="fixed top-6 right-6 z-[999] animate-fade-in">
          <div
            className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border min-w-[320px] max-w-md ${
              notification.type === 'error'
                ? 'bg-red-600 border-red-500 text-white'
                : notification.type === 'success'
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-blue-600 border-blue-500 text-white'
            }`}
          >
            <div className="shrink-0">
              {notification.type === 'error' ? (
                <AlertCircle size={24} />
              ) : notification.type === 'success' ? (
                <CheckCircle2 size={24} />
              ) : (
                <Info size={24} />
              )}
            </div>
            <div className="flex-1">
              <p className="text-xs font-black uppercase tracking-widest opacity-60 mb-0.5">Notificação do Sistema</p>
              <p className="text-sm font-bold leading-tight">{notification.message}</p>
            </div>
            <button onClick={() => setNotification(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex-shrink-0 bg-gray-900 shadow-xl transform transition-transform duration-300 lg:static lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <span className="text-xl font-bold text-white">COLABOR</span>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-gray-400">
            <X size={24} />
          </button>
        </div>

        <nav className="mt-6 space-y-1">
          {canAccessView(profile?.role, 'dashboard') && (
            <SidebarButton icon={LayoutDashboard} label="Dashboard" active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} />
          )}

          {canAccessView(profile?.role, 'demands') && (
            <SidebarButton icon={Briefcase} label="Demandas" active={currentView === 'demands'} onClick={() => setCurrentView('demands')} />
          )}

          {canAccessView(profile?.role, 'logistics') && (
            <SidebarButton icon={Truck} label="Programação" active={currentView === 'logistics'} onClick={() => setCurrentView('logistics')} />
          )}

          {canAccessView(profile?.role, 'logistics-control') && (
            <SidebarButton
              icon={ClipboardCheck}
              label="Controle Logístico"
              active={currentView === 'logistics-control'}
              onClick={() => setCurrentView('logistics-control')}
            />
          )}

          {canAccessView(profile?.role, 'measurement') && (
            <SidebarButton icon={BarChart3} label="Medição" active={currentView === 'measurement'} onClick={() => setCurrentView('measurement')} />
          )}

          {canAccessView(profile?.role, 'evidences') && (
            <SidebarButton icon={FileSearch} label="Evidências" active={currentView === 'evidences'} onClick={() => setCurrentView('evidences')} />
          )}

          {canAccessView(profile?.role, 'calendar') && (
            <SidebarButton icon={Calendar} label="Agenda" active={currentView === 'calendar'} onClick={() => setCurrentView('calendar')} />
          )}

          {canAccessView(profile?.role, 'registrations') && (
            <SidebarButton icon={Settings} label="Cadastros" active={currentView === 'registrations'} onClick={() => setCurrentView('registrations')} />
          )}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex justify-between p-4 bg-white shadow">
          <span className="font-bold">COLABOR</span>
          <button onClick={() => setIsMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
        </header>

        <main className="flex-1 p-6 overflow-y-auto bg-[#F8FAFC]">{renderContent()}</main>
      </div>
    </div>
  );
};

const SidebarButton = ({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-6 py-3 transition ${
      active ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

import AuthGate from './components/AuthGate';

export default () => (
  <AuthProvider>
    <AppProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AppProvider>
  </AuthProvider>
);
