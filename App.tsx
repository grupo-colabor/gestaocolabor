import React, {
  useState,
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo
} from 'react';

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
  FileSearch,
  Bell,
  Shield,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

import type {
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
  LogisticAllocation,
  EvidenceData,
  CompanionAllocation,
  Segment,
  Status,
  LogisticsType,
} from './types';

import {
  MOCK_REGIONS,
  MOCK_AREAS,
  MOCK_TRAININGS,
  MOCK_INSTRUCTORS,
  MOCK_DEMANDS,
  } from './constants';

import Dashboard from './components/Dashboard';
import Registrations from './components/Registrations';
import Demands from './components/Demands';
import CalendarView from './components/CalendarView';
import Logistics from './components/Logistics';
import LogisticsControl from './components/LogisticsControl';
import MeasurementView from './components/Measurement';
import Evidences from './components/Evidences';
import Notifications from './components/Notifications';
import AuthGate from './components/AuthGate';
import AuditPage from './components/Audit';
import { fetchTrainings } from './services/trainings';
import { fetchCompanies, insertCompany, updateCompanyById, CompanyRow } from './services/companies';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { isDemandDay, getDemandDays } from './domain/demandDays';
import { isEAD } from './domain/modalityRules';
import { fetchInstructors, fetchInstructorTrainings } from './services/instructors';
import { fetchMeasurements, upsertMeasurementByDemandId } from './services/measurements';
import { fetchEvidences, upsertEvidenceByDemandId } from './services/evidences';


// ✅ Demandas (Supabase) — services/demands.ts
import {
  fetchDemands,
  insertDemand,
  updateDemandById,
  deleteDemandById,
  fetchMaxDemandNumber
} from './services/demands';

// ✅ Demandas (Supabase) — /services/agenda
import {
  fetchAgendaItems,
  insertAgendaItem,
  updateAgendaItemById,
  deleteAgendaItemById,
  mapAgendaItemFromDb
} from './services/agendaItems';

import {
  fetchResourceAllocations,
  upsertResourceAllocation,
  deleteResourceAllocationByDemandId
} from './services/resourceAllocations';

import {
  fetchInstructorAllocations,
  upsertInstructorAllocation,
  replaceInstructorAllocationsForDemand
} from './services/instructorAllocations';

import {
  fetchCompanionAllocations,
  insertCompanionAllocation,
  deleteCompanionAllocationById
} from './services/companionAllocations';

import {
  fetchLogisticAllocations,
  LogisticAllocationRow
} from './services/logisticAllocations';



// ✅ Supabase client (precisa existir em ./lib/supabase)
import { supabase } from './lib/supabase';

// ✅ Hook para sincronização em tempo real
import { useRealtimeSync } from './hooks/useRealtimeSync';

/* ======================================================
   CONTEXT
====================================================== */

type View =
  | 'dashboard'
  | 'notifications'
  | 'demands'
  | 'calendar'
  | 'registrations'
  | 'logistics'
  | 'logistics-control'
  | 'measurement'
  | 'evidences'
  | 'audit';

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
  logisticAllocations: LogisticAllocationRow[];
  operationalBases: OperationalBases;
  notification: { message: string; type: 'info' | 'success' | 'error' } | null;
  nextDemandNumber: number;
  companionAllocations: CompanionAllocation[];
  addCompanionAllocation: (a: CompanionAllocation) => void;
  removeCompanionAllocation: (id: string) => void;

  // ✅ Evidências (GLOBAL)
  evidenceStore: Record<string, EvidenceData>;
  setEvidenceStore: React.Dispatch<React.SetStateAction<Record<string, EvidenceData>>>;
  getEvidenceAutoStatus: (demandId: string) => 'COMPLETA' | 'PENDENTE';
  updateEvidence: (demandId: string, data: EvidenceData) => Promise<void>;

  setNextDemandNumber: React.Dispatch<React.SetStateAction<number>>;
  setNotification: React.Dispatch<
    React.SetStateAction<{ message: string; type: 'info' | 'success' | 'error' } | null>
  >;

  addDemand: (d: Demand) => Promise<{ id: string } | null>;
  updateDemand: (d: Demand) => void;
  deleteDemand: (id: string) => void;
  cancelDemand: (demandId: string) => void;
  addInstructor: (i: Instructor) => void;
  updateInstructor: (i: Instructor) => void;
  addCompany: (c: Company) => Promise<void>;
  updateCompany: (c: Company) => Promise<void>;
  addTraining: (t: Training) => void;
  updateTraining: (t: Training) => void;
  reloadInstructors: () => Promise<void>;

  // Measurement Actions
  updateMeasurement: (m: Measurement) => void;

  // Agenda Actions
  addAgendaItem: (item: AgendaItem) => Promise<void>;
  updateAgendaItem: (item: AgendaItem) => Promise<void>;
  removeAgendaItem: (id: string) => Promise<void>;


  // Instructor Allocation Actions
  addInstructorAllocation: (a: InstructorAllocation) => void;
  updateInstructorAllocation: (a: InstructorAllocation) => void;
  removeInstructorAllocation: (id: string) => void;

  // Resource Allocation Actions
  addResourceAllocation: (a: LogisticAllocation) => void;
  updateResourceAllocation: (a: LogisticAllocation) => void;
  removeResourceAllocation: (id: string) => void;

  // Instructor Current Location
  updateInstructorCurrentLocation: (instructorId: string, location: string) => Promise<void>;

  // Operational Bases Actions
  updateOperationalBase: (key: OperationalBaseKey, newList: string[]) => Promise<void>;


  recommendInstructors: (demand: Demand) => {
    suggested: (Instructor & { score: number })[];
    exceptions: (Instructor & { score: number })[];
    alreadyAllocated: (Instructor & { score: number })[];
  };
  allocateInstructor: (
    demandId: string,
    instructorId: string,
    startDate?: string,
    endDate?: string
  ) => boolean;
  deallocateInstructor: (demandId: string) => void;

  hasScheduleConflict: (
    instructorId: string,
    startDate: string,
    endDate: string,
    excludeDemandId?: string,
    excludeAgendaItemId?: string,
    excludeAllocationId?: string
  ) => boolean;

  hasResourceConflict: (
    startDate: string,
    endDate: string,
    excludeDemandId?: string,
    excludeAllocationId?: string
  ) => boolean;

  isCompanyFullLogistics: (companyId: string) => boolean;

  // HÍBRIDO (MVP): definir/validar período presencial (prática)
  setHybridPracticePeriod: (
    demandId: string,
    practiceStartDate: string,
    practiceEndDate: string
  ) => boolean;

  // Cross-view: navegação + drawer de alocação na agenda
  currentView: View;
  setCurrentView: (v: View) => void;
  calendarDrawerDemandId: string | null;
  setCalendarDrawerDemandId: (id: string | null) => void;

  // Navegação a partir de notificações
  notificationTarget: { demandId: string; view: View } | null;
  setNotificationTarget: (t: { demandId: string; view: View } | null) => void;
}

const getDefaultViewForRole = (role?: string | null) => {
  if (role === 'coordenador') return 'calendar';
  if (role === 'analista') return 'dashboard';
  if (role === 'admin') return 'dashboard';
  return 'calendar'; // fallback seguro
};

const AppContext = createContext<AppState | null>(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

/* ======================================================
   PROVIDER
====================================================== */

const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ✅ Auth mode (não mistura mock + supabase)
  const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE || 'mock') as 'mock' | 'supabase';

  const [notification, setNotification] = useState<{
  message: string;
  type: 'info' | 'success' | 'error';
} | null>(null);

  // Cross-view: navegação + drawer de alocação na agenda
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [calendarDrawerDemandId, setCalendarDrawerDemandId] = useState<string | null>(null);
  const [notificationTarget, setNotificationTarget] = useState<{ demandId: string; view: View } | null>(null);

  const { user, loading } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [areas] = useState<Area[]>(MOCK_AREAS);

  // ✅ Agora carrega do banco; fallback = mock caso dê erro (somente se quiser)
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>(
    AUTH_MODE === 'supabase' ? [] : MOCK_INSTRUCTORS
  );

  // ✅ Demandas: fonte da verdade é Supabase no modo supabase
  const [demands, setDemands] = useState<Demand[]>(
    AUTH_MODE === 'supabase' ? [] : MOCK_DEMANDS
  );

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>(
  AUTH_MODE === 'supabase' ? [] : []
);
  const [instructorAllocations, setInstructorAllocations] = useState<InstructorAllocation[]>([]);
  // false em modo supabase até o primeiro sync completar; evita falso conflito durante carregamento
  const [allocationsLoaded, setAllocationsLoaded] = useState(AUTH_MODE !== 'supabase');
  const [resourceAllocations, setResourceAllocations] = useState<LogisticAllocation[]>([]);
  const [logisticAllocations, setLogisticAllocations] = useState<LogisticAllocationRow[]>([]);
  const [companionAllocations, setCompanionAllocations] = useState<CompanionAllocation[]>([]);
  const addCompanionAllocation = useCallback((a: CompanionAllocation) => {
  // 1) Atualiza local (otimista)
  setCompanionAllocations(prev => [...prev, a]);

  // 2) Se não for supabase, acabou
  if (AUTH_MODE !== 'supabase') return;

  // 3) Se estiver sem sessão, não salva (mantém padrão do seu app)
  if (!user) {
    setNotification({
      message: 'Aguarde a sessão carregar para salvar o acompanhante.',
      type: 'info'
    });
    return;
  }

  // 4) Persiste no banco
  (async () => {
    try {
      const created = await insertCompanionAllocation({
        demand_id: a.demandId,
        instructor_id: a.instructorId,
        start_date: a.startDate,
        end_date: a.endDate
      });

      // 5) Garante state com ID real do banco
      const mapped: CompanionAllocation = {
        id: created.id,
        demandId: created.demand_id,
        instructorId: created.instructor_id,
        startDate: created.start_date,
        endDate: created.end_date
      };

      setCompanionAllocations(prev => {
        // remove o “placeholder” local se você tiver colocado id temporário
        const withoutLocal = prev.filter(x => x.id !== a.id);
        return [...withoutLocal, mapped];
      });

      // opcional (mais seguro): sync do banco
      // await syncCompanionAllocationsFromDb();
    } catch (e) {
      console.error('[CompanionAllocations] insert error', e);

      // rollback local (remove o que foi adicionado)
      setCompanionAllocations(prev => prev.filter(x => x.id !== a.id));

      setNotification({
        message: 'Erro ao salvar acompanhante no banco.',
        type: 'error'
      });
    }
  })();
}, [AUTH_MODE, user, setNotification]);

const removeCompanionAllocation = useCallback((id: string) => {
  // 1) Remove local
  setCompanionAllocations(prev => prev.filter(x => x.id !== id));

  // 2) Se não for supabase, acabou
  if (AUTH_MODE !== 'supabase') return;

  if (!user) {
    setNotification({
      message: 'Aguarde a sessão carregar para remover o acompanhante.',
      type: 'info'
    });
    return;
  }

  // 3) Remove do banco
  (async () => {
    try {
      await deleteCompanionAllocationById(id);

      // opcional: sync pra garantir
      // await syncCompanionAllocationsFromDb();
    } catch (e) {
      console.error('[CompanionAllocations] delete error', e);
      setNotification({
        message: 'Erro ao remover acompanhante no banco.',
        type: 'error'
      });

      // opcional: em caso de erro, você pode re-sincronizar do banco:
      // await syncCompanionAllocationsFromDb();
    }
  })();
}, [AUTH_MODE, user, setNotification]);
  
const [operationalBases, setOperationalBases] = useState<OperationalBases>({
  aprovadores: [],
  analistas: [],
  matriculadores: [],
  corredores: [],
  localidades: [],
  locaisAgencia: [],
  locaisTreinamento: [],
  hoteis: [],
  locadoras: [],
  tiposTreinamento: [],
  funcoesAgenda: [],
  regioes: [],
  categoriasCarros: [],
});

const regions = useMemo<Region[]>(() => {
  if (AUTH_MODE === 'supabase' && operationalBases.regioes.length > 0) {
    return operationalBases.regioes.map(
      name => MOCK_REGIONS.find(r => r.name === name) ?? { id: name, name, status: 'ATIVO' as const }
    );
  }
  return MOCK_REGIONS.filter(r => r.status === 'ATIVO');
}, [operationalBases.regioes, AUTH_MODE]);

// ✅ Carregar Bases Operacionais do Supabase - aguarda sessão
useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;  // ✅ Aguarda auth terminar de carregar
  if (!user) return;    // ✅ Só carrega se tiver sessão

  console.log('[OperationalBases] iniciando fetch (user logado)');

  (async () => {
    // ✅ Retry logic para bases operacionais
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const { data, error } = await supabase
          .from('operational_bases_items')
          .select('base_key, value')
          .order('value');

        if (error) {
          console.error(`[OperationalBases] fetch attempt ${attempts} error`, error);
          if (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          return;
        }

        const rows = (data ?? []) as Array<{ base_key: OperationalBaseKey; value: string }>;

        const grouped: OperationalBases = {
          aprovadores: [],
          analistas: [],
          matriculadores: [],
          corredores: [],
          localidades: [],
          locaisAgencia: [],
          locaisTreinamento: [],
          hoteis: [],
          locadoras: [],
          tiposTreinamento: [],
          funcoesAgenda: [],
          regioes: [],
          categoriasCarros: [],
        };

        for (const row of rows) {
          if (grouped[row.base_key as OperationalBaseKey]) {
            grouped[row.base_key as OperationalBaseKey].push(row.value);
          }
        }

        console.log('[OperationalBases] carregadas com sucesso', {
          localidades: grouped.localidades.length,
          corredores: grouped.corredores.length
        });

        setOperationalBases(grouped);
        return; // sucesso, sai do loop

      } catch (e) {
        console.error(`[OperationalBases] fetch attempt ${attempts} exception`, e);
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  })();
}, [AUTH_MODE, user, loading]);


  const [nextDemandNumber, setNextDemandNumber] = useState<number>(6301);

  // ✅ Evidências (GLOBAL)
  const [evidenceStore, setEvidenceStore] = useState<Record<string, EvidenceData>>({});



 function mapMeasurementFromDb(row: any) {
  return {
    id: row.id,
    demandId: row.demand_id,
    status: row.status,
    expenses: {
      breakfast: '',
      lunch: '',
      dinner: '',
      transport: '',
      others: '',
      classHours: undefined,
      hourRate: undefined,
      ...(row.expenses ?? {})
    },
    attachments: row.attachments ?? [],
    otherExpenses: row.other_expenses ?? [],
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

function mapMeasurementToDbPatch(m: any) {
  return {
    id: m.id,
    status: m.status,
    expenses: m.expenses ?? {},
    attachments: m.attachments ?? [],
    other_expenses: m.otherExpenses ?? [],
    updated_at: new Date().toISOString(),
  };
}

function mapEvidenceFromDb(row: any): EvidenceData {
  return {
    demandId: row.demand_id,
    attendanceList: row.attendance_list ?? [],
    certificates: row.certificates ?? [],
    photos: row.photos ?? [],
    notes: row.notes ?? '' // ✅ FIX
  };
}

function mapEvidenceToDbPatch(e: EvidenceData) {
  return {
    attendance_list: e.attendanceList ?? [],
    certificates: e.certificates ?? [],
    photos: e.photos ?? [],
    notes: e.notes ?? '', // ✅ FIX
    updated_at: new Date().toISOString()
  };
}


 const syncMeasurementsFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;

  try {
    const rows = await fetchMeasurements();
    const mapped = (rows || []).map(mapMeasurementFromDb);
    setMeasurements(mapped);
  } catch (e) {
    console.error('[Measurements] sync error', e);
  }
}, [AUTH_MODE]);


// ================================
// EVIDENCES — sync DB -> store
// ================================
const syncEvidencesFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;

  try {
    const rows = await fetchEvidences();

    const record: Record<string, EvidenceData> = {};
    for (const r of rows || []) {
      const ev = mapEvidenceFromDb(r);
      record[ev.demandId] = ev;
    }

    setEvidenceStore(record);
  } catch (e) {
    console.error('[Evidences] sync error', e);
  }
}, [AUTH_MODE]);


  /**
   * ✅ Helpers de persistência (treinamentos) — ALINHADO AO SCHEMA ATUAL DO SUPABASE
   */
  const mapTrainingToDb = useCallback((t: Training) => {
    const cleanOrNull = (v?: string | null) => {
      const s = (v ?? '').trim();
      return s.length ? s : null;
    };

    return {
      name: t.name,
      nr: cleanOrNull(t.nr),
      category: cleanOrNull(t.category),
      area_id: null,
      hours: t.hours ?? 0,
      modality: cleanOrNull(t.modality),
      status: cleanOrNull(t.status),
      description_short: cleanOrNull((t as any).descriptionShort),
    };
  }, []);

  const mapTrainingFromDb = useCallback((row: any): Training => {
    return {
      id: row.id,
      name: row.name,
      nr: row.nr ?? '',
      category: row.category ?? '',
      areaId: row.area_id ?? '',
      hours: row.hours ?? 0,
      modality: row.modality ?? 'PRESENCIAL',
      status: row.status ?? 'ATIVO',
      descriptionShort: row.description_short ?? '',
      descriptionDetailed: '',
      prerequisites: '',
      targetAudience: '',
      emitsCertificate: true,
      validityMonths: null
    };
  }, []);

  const syncTrainingsFromDb = useCallback(async () => {
    try {
      const rows = await fetchTrainings();
      const mapped = rows.map(mapTrainingFromDb);
      setTrainings(mapped);
    } catch (e) {
      console.error('Erro ao sincronizar trainings:', e);
      setTrainings(MOCK_TRAININGS);
      setNotification({
        message: 'Falha ao sincronizar treinamentos do banco.',
        type: 'error'
      });
    }
  }, [mapTrainingFromDb]);

  const mapDbLevelToApp = useCallback((level: string | null | undefined): 1 | 2 | 3 | 4 => {
    const v = (level || '').toUpperCase().trim();
    if (v === 'ESPECIALISTA') return 4;
    if (v === 'AVANCADO') return 3;
    if (v === 'INTERMEDIARIO') return 2;
    if (v === 'BASICO') return 1;
    return 3;
  }, []);

  const mapInstructorFromDb = useCallback(
    (row: any, skillsRows: Array<{ training_id: string; level: string | null }>): Instructor => {
      const regionName = (row.region || '').toString().trim();
      const regionMatch = regions.find(r => r.name.toLowerCase() === regionName.toLowerCase());
      const regionIds = regionMatch ? [regionMatch.id] : [];

      return {
        id: row.id,
        name: row.full_name,
        email: row.email ?? undefined,
        status: row.is_active === true ? 'ATIVO' : 'INATIVO',
        regionIds,
        skills: (skillsRows || []).map(s => ({
          trainingId: s.training_id,
          level: mapDbLevelToApp(s.level)
        })),
        observations: '',
        residenceLocation: row.residence_location ?? '',
        currentLocation: Array.isArray(row.coverage_locations) ? (row.coverage_locations[0] || '') : (row.coverage_locations || ''),
        agendaRole: row.agenda_role || 'Instrutor',
        operationalNotes: row.operational_notes ?? '',

      };
    },
    [mapDbLevelToApp, regions]
  );

  const syncInstructorsFromDb = useCallback(async () => {
  try {
    const [instructorRows, pivotRows] = await Promise.all([
      fetchInstructors(),         
      fetchInstructorTrainings()
    ]);

    const pivotsByInstructor = new Map<
      string,
      Array<{ training_id: string; level: string | null }>
    >();

    for (const p of pivotRows) {
      const list = pivotsByInstructor.get(p.instructor_id) || [];
      list.push({ training_id: p.training_id, level: p.level });
      pivotsByInstructor.set(p.instructor_id, list);
    }

    const mapped = instructorRows.map((r: any) => {
      const inst = mapInstructorFromDb(r, pivotsByInstructor.get(r.id) || []);

      // ✅ Garante que SEMPRE exista um valor (evita quebrar UI / filtros)
      // Se vier null/undefined do banco, seta como "Instrutor"
      return {
        ...inst,
        agendaRole: (inst as any).agendaRole ?? r?.agenda_role ?? 'Instrutor'
      };
    });

    setInstructors(mapped);
  } catch (e) {
    console.error('Erro ao sincronizar instructors:', e);
    // No modo Supabase, NÃO voltar pro hardcode (pra não confundir)
    setInstructors([]);
    setNotification({
      message: 'Falha ao sincronizar instrutores do banco.',
      type: 'error'
    });
  }
}, [
  fetchInstructors,
  fetchInstructorTrainings,
  mapInstructorFromDb,
  setInstructors,
  setNotification
]);


  const mapResourceAllocationFromDb = useCallback((row: any): LogisticAllocation => {
  return {
    id: row.id,
    demandId: row.demand_id,
    resourceType: row.resource_type,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? ''
  } as LogisticAllocation;
}, []);

const syncResourceAllocationsFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;

  try {
    const rows = await fetchResourceAllocations();
    // ✅ proteção extra: se demandas ainda não carregaram, NÃO tenta limpar órfãos
    if (demands.length === 0) {
      const mapped = (rows || []).map(mapResourceAllocationFromDb);
      setResourceAllocations(mapped);
      return;
    }
    // ✅ filtra CTMs órfãos (resource_allocations sem demanda existente)
    const demandIds = new Set(demands.map(d => d.id));
    const validRows = (rows || []).filter(r => demandIds.has(r.demand_id));
    const orphanRows = (rows || []).filter(r => !demandIds.has(r.demand_id));

    if (orphanRows.length) {
      console.warn('[CTM] Encontrado(s) CTM órfão(s) no banco. Removendo:', orphanRows);

      // remove do banco para não bloquear alocações futuras
      await supabase
        .from('resource_allocations')
        .delete()
        .in('id', orphanRows.map(o => o.id));
    }

    const mapped = validRows.map(mapResourceAllocationFromDb);
    setResourceAllocations(mapped);
  } catch (e) {
    console.error('[ResourceAllocations] sync error', e);
  }
}, [AUTH_MODE, mapResourceAllocationFromDb, demands.length]);

const syncLogisticAllocationsFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;
  try {
    const rows = await fetchLogisticAllocations();
    setLogisticAllocations(rows || []);
  } catch (e) {
    console.error('[LogisticAllocations] sync error', e);
  }
}, [AUTH_MODE]);

const mapInstructorAllocationFromDb = useCallback((row: any): InstructorAllocation => {
  return {
    id: row.id,
    demandId: row.demand_id,
    instructorId: row.instructor_id,
    startDate: row.start_date,
    endDate: row.end_date
  } as InstructorAllocation;
}, []);

const syncInstructorAllocationsFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;

  try {
    const rows = await fetchInstructorAllocations();

    // ✅ Se demandas ainda não carregaram, só mapeia (sem limpar órfãos)
    if (demands.length === 0) {
      setInstructorAllocations((rows || []).map(mapInstructorAllocationFromDb));
      setAllocationsLoaded(true);
      return;
    }

    // ✅ limpa órfãos localmente (no banco já deve cascade, mas mantém seguro)
    const demandIds = new Set(demands.map(d => d.id));
    const valid = (rows || []).filter(r => demandIds.has(r.demand_id));

    setInstructorAllocations(valid.map(mapInstructorAllocationFromDb));
    setAllocationsLoaded(true);
  } catch (e) {
    console.error('[InstructorAllocations] sync error', e);
  }
}, [AUTH_MODE, demands, mapInstructorAllocationFromDb]);

  const mapCompanionAllocationFromDb = useCallback((row: any): CompanionAllocation => {
  return {
    id: row.id,
    demandId: row.demand_id,
    instructorId: row.instructor_id,
    startDate: row.start_date,
    endDate: row.end_date
  } as CompanionAllocation;
}, []);

const syncCompanionAllocationsFromDb = useCallback(async () => {
  if (AUTH_MODE !== 'supabase') return;

  try {
    const rows = await fetchCompanionAllocations();

    // ✅ se demandas ainda não carregaram, só mapeia
    if (demands.length === 0) {
      setCompanionAllocations((rows || []).map(mapCompanionAllocationFromDb));
      return;
    }

    // ✅ filtra órfãos (se existir)
    const demandIds = new Set(demands.map(d => d.id));
    const valid = (rows || []).filter(r => demandIds.has(r.demand_id));

    setCompanionAllocations(valid.map(mapCompanionAllocationFromDb));
  } catch (e) {
    console.error('[CompanionAllocations] sync error', e);
  }
}, [AUTH_MODE, demands, mapCompanionAllocationFromDb]);


  // ======================================================
  // ✅ DEMANDAS (SUPABASE) — mappers + sync
  // ======================================================

  const mapDemandFromDb = useCallback((row: any): Demand => {
    return {
      id: row.id,
      companyId: row.company_id ?? '',
      trainingId: row.training_id ?? '',
      regionId: row.region_id ?? '',
      trainingLocal: row.training_local ?? 'N/A',
      modality: row.modality ?? 'PRESENCIAL',
      dateMode: row.date_mode ?? 'CONTINUO',
      specificDates: (() => {
        const raw = row.specific_dates;
        if (!raw) return undefined;
        const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : null);
        if (!Array.isArray(arr) || arr.length === 0) return undefined;
        return arr.map((sd: any) => {
          if (typeof sd === 'string') {
            // Tenta parsear como objeto JSON (salvo em coluna text[] após migração)
            try {
              const parsed = JSON.parse(sd);
              if (parsed && typeof parsed === 'object' && parsed.data) {
                return {
                  data: String(parsed.data).slice(0, 10),
                  horarioInicio: parsed.horarioInicio ?? '08:00',
                  horarioFim: parsed.horarioFim ?? '18:00',
                };
              }
            } catch {}
            // Formato antigo: plain date string 'YYYY-MM-DD'
            return { data: sd.slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
          }
          if (sd && typeof sd === 'object') {
            return {
              data: String(sd.data ?? '').slice(0, 10),
              horarioInicio: sd.horarioInicio ?? '08:00',
              horarioFim: sd.horarioFim ?? '18:00',
            };
          }
          return { data: String(sd).slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
        });
      })(),
      status: (row.status ?? 'NOVA') as DemandStatus,
      startDate: row.start_date ?? '',
      endDate: row.end_date ?? '',
      practiceStartDate: row.practice_start_date ?? undefined,
      practiceEndDate: row.practice_end_date ?? undefined,
      instructorId: row.instructor_id ?? undefined,
      clientDemandId: row.client_demand_id ?? undefined,
      corredor: row.corredor ?? undefined,
      demandState: row.demand_state ?? undefined,
      requester: row.requester ?? undefined,
      observations: row.observations ?? undefined,
      approver: row.approver ?? undefined,
      analyst: row.analyst ?? undefined,
      matriculador: row.matriculador ?? undefined,
      confirmationStatus: (row.confirmation_status || undefined) as 'CONFIRMADO' | 'A_CONFIRMAR' | undefined,
      cancelReason: row.cancel_reason ?? undefined,
    } as Demand;
  }, []);



  const mapDemandToDb = useCallback((d: Demand, extra?: { id?: string; number?: number }) => {
  const cleanOrNull = (v?: string | null) => {
    const s = (v ?? '').toString().trim();
    return s.length ? s : null;
  };

  const payload: any = {
    company_id: cleanOrNull(d.companyId),
    training_id: cleanOrNull(d.trainingId),
    region_id: cleanOrNull(d.regionId),
    training_local: cleanOrNull(d.trainingLocal),
    modality: cleanOrNull(d.modality),
    date_mode: d.dateMode || 'CONTINUO',
    specific_dates: d.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(d.specificDates) && d.specificDates.length > 0
      ? d.specificDates
      : null,
    status: cleanOrNull(d.status),
    start_date: cleanOrNull(d.startDate),
    end_date: cleanOrNull(d.endDate),
    practice_start_date: cleanOrNull((d as any).practiceStartDate),
    practice_end_date: cleanOrNull((d as any).practiceEndDate),
    instructor_id: cleanOrNull((d as any).instructorId),
    client_demand_id: cleanOrNull((d as any).clientDemandId),
    corredor: cleanOrNull((d as any).corredor),
    demand_state: cleanOrNull((d as any).demandState),
    requester: cleanOrNull((d as any).requester),
    observations: cleanOrNull((d as any).observations),
    approver: cleanOrNull((d as any).approver),
    analyst: cleanOrNull((d as any).analyst),
    matriculador: cleanOrNull((d as any).matriculador),
    confirmation_status: cleanOrNull((d as any).confirmationStatus),
    cancel_reason: cleanOrNull((d as any).cancelReason),
  };

  if (extra?.id) payload.id = extra.id;
  if (typeof extra?.number === 'number') payload.number = extra.number;

  return payload;
}, []);



/** 🔄 Sync do Supabase -> State */
  const syncAgendaItemsFromDb = useCallback(async () => {
    if (AUTH_MODE !== 'supabase') return;

    try {
      const rows = await fetchAgendaItems();
      const mapped = rows.map(mapAgendaItemFromDb);
      setAgendaItems(mapped);
    } catch (e) {
      console.error('syncAgendaItemsFromDb error:', e);
    }
  }, [AUTH_MODE, mapAgendaItemFromDb]);

  const syncDemandsFromDb = useCallback(async () => {
    try {
      const rows = await fetchDemands();
      const mapped = (rows || []).map(mapDemandFromDb);
      setDemands(mapped);

      // Ajustar próximo número (DEM-xxxx)
      try {
        const max = await fetchMaxDemandNumber();
        const next = (typeof max === 'number' ? max : 0) + 1;
        if (next > 0) setNextDemandNumber(next);
      } catch (e) {
        // Não bloqueia a tela se falhar o max number
        console.warn('Falha ao buscar max demand number:', e);
      }
    } catch (e) {
      console.error('Erro ao sincronizar demands:', e);
      setDemands([]);
      setNotification({
        message: 'Falha ao sincronizar demandas do banco.',
        type: 'error'
      });
    }
  }, [mapDemandFromDb]);

  // ✅ Status automático de evidências (ONLINE não exige fotos)
  const getEvidenceAutoStatus = useCallback(
    (demandId: string): 'COMPLETA' | 'PENDENTE' => {
      const data = evidenceStore[demandId];
      if (!data) return 'PENDENTE';

      const demand = demands.find(d => d.id === demandId);
      const training = trainings.find(t => t.id === demand?.trainingId);

      const isOnline = isEAD(training?.modality ?? demand?.modality);

      const hasAttendance = (data.attendanceList || []).length > 0;
      const hasCertificates = (data.certificates || []).length > 0;
      const hasPhotos = (data.photos || []).length > 0;

      const isComplete = isOnline
        ? hasAttendance && hasCertificates
        : hasAttendance && hasCertificates && hasPhotos;

      return isComplete ? 'COMPLETA' : 'PENDENTE';
    },
    [evidenceStore, demands, trainings]
  );

  // ================================
// EVIDENCES — update (local + upsert)
// ================================
const updateEvidence = useCallback(
  async (demandId: string, data: EvidenceData) => {
    // ✅ garante notes mesmo que venha undefined
    const normalized: EvidenceData = {
      demandId,
      attendanceList: data.attendanceList ?? [],
      certificates: data.certificates ?? [],
      photos: data.photos ?? [],
      notes: data.notes ?? ''
    };

    // 1) atualiza estado local imediatamente
    setEvidenceStore(prev => ({
      ...prev,
      [demandId]: normalized
    }));

    // 2) mock mode não salva no banco
    if (AUTH_MODE !== 'supabase') return;

    try {
      const patch = mapEvidenceToDbPatch(normalized);
      const { data: saved, error } = await upsertEvidenceByDemandId(demandId, patch);

      if (error) {
        console.error('[Evidences] upsert error', error);
        return;
      }

      // opcional: garantir store igual ao banco
      if (saved) {
        const mapped = mapEvidenceFromDb(saved);
        setEvidenceStore(prev => ({
          ...prev,
          [demandId]: mapped
        }));
      }
    } catch (e) {
      console.error('[Evidences] update exception', e);
    }
  },
  [AUTH_MODE, mapEvidenceToDbPatch, mapEvidenceFromDb]

);

  // Auto-clear notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // ✅ Carregar empresas do Supabase
  // Mapper Company: DB → App
  const mapCompanyFromDb = useCallback((row: CompanyRow): Company => ({
    id: row.id,
    name: row.name || '',
    razaoSocial: row.razao_social || '',
    cnpj: row.cnpj || undefined,
    segment: (row.segment as Segment) || 'Outros',
    status: (row.status as Status) || 'ATIVO',
    logisticsType: (row.logistics_type as LogisticsType) || 'SIMPLIFICADA',
    address: {
      cidade: row.cidade || undefined,
      estado: row.estado || undefined,
    },
    observations: row.observations || undefined,
  }), []);

  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;

    (async () => {
      try {
        const data = await fetchCompanies();
        setCompanies(data.map(mapCompanyFromDb));
      } catch (e) {
        console.error('Erro ao carregar companies:', e);
      }
    })();
  }, [AUTH_MODE, user, loading, mapCompanyFromDb]);

  // ✅ Carregar Agenda do Supabase (fonte da verdade)
  useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;
  if (!user) return;
  syncAgendaItemsFromDb();
}, [AUTH_MODE, user, loading, syncAgendaItemsFromDb]);

useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;
  if (!user) return;

  // ✅ só sincroniza CTM depois que demandas já foram carregadas
  if (demands.length === 0) return;

  syncResourceAllocationsFromDb();
}, [AUTH_MODE, user, loading, demands.length, syncResourceAllocationsFromDb]);

useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;
  if (!user) return;
  syncLogisticAllocationsFromDb();
}, [AUTH_MODE, user, loading, syncLogisticAllocationsFromDb]);


// ✅ Carregar Evidências do Supabase (fonte da verdade)
useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;
  if (!user) return;
  syncEvidencesFromDb();
}, [AUTH_MODE, user, loading, syncEvidencesFromDb]);

  // ✅ Carregar treinamentos do Supabase (fonte da verdade)
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;
    syncTrainingsFromDb();
  }, [AUTH_MODE, user, loading, syncTrainingsFromDb]);


  // ✅ Carregar Instrutores do Supabase (fonte da verdade)
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;
    syncInstructorsFromDb();
  }, [AUTH_MODE, user, loading, syncInstructorsFromDb]);

  const reloadInstructors = useCallback(async () => {
  await syncInstructorsFromDb();
}, [syncInstructorsFromDb]);


  // ✅ Carregar Demandas do Supabase (fonte da verdade)
  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;
    syncDemandsFromDb();
  }, [AUTH_MODE, user, loading, syncDemandsFromDb]);

  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;

    // Carrega em paralelo com demands; syncInstructorAllocationsFromDb já trata demands vazio
    syncInstructorAllocationsFromDb();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUTH_MODE, user, loading]);

  useEffect(() => {
    if (AUTH_MODE !== 'supabase') return;
    if (loading) return;
    if (!user) return;

    if (demands.length === 0) return;

    syncCompanionAllocationsFromDb();
  }, [AUTH_MODE, user, loading, demands.length, syncCompanionAllocationsFromDb]);

  // ✅ Carregar Medições do Supabase (fonte da verdade)
  useEffect(() => {
  if (AUTH_MODE !== 'supabase') return;
  if (loading) return;
  if (!user) return;
  syncMeasurementsFromDb();
}, [AUTH_MODE, user, loading, syncMeasurementsFromDb]);

  // Inicializar medições para mock legados
  useEffect(() => {
    if (AUTH_MODE !== 'supabase' && measurements.length === 0 && demands.length > 0) {
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
    // eslint-disable-next-line react-hooks-exhaustive-deps
  }, []);

  /* =========================
     ✅ REALTIME SYNC - Atualização automática entre usuários
     Monitora mudanças nas tabelas principais e sincroniza
  ========================= */
  const realtimeEnabled = AUTH_MODE === 'supabase' && !loading && !!user;

  // Sync atômico: quando alocações mudam, recarrega demands + allocations juntos
  // para eliminar a janela de inconsistência entre os dois debounces independentes
  const syncDemandsAndAllocations = useCallback(async () => {
    await Promise.all([syncDemandsFromDb(), syncInstructorAllocationsFromDb()]);
  }, [syncDemandsFromDb, syncInstructorAllocationsFromDb]);

  // Demandas - tabela principal
  useRealtimeSync({
    table: 'demands',
    onSync: syncDemandsFromDb,
    enabled: realtimeEnabled,
    debounceMs: 500
  });

  // Agenda Items - calendário/agenda
  useRealtimeSync({
    table: 'agenda_items',
    onSync: syncAgendaItemsFromDb,
    enabled: realtimeEnabled,
    debounceMs: 500
  });

  // Alocações de instrutores: sincroniza demands+allocations juntos (Fix 2)
  // Subscription sempre ativa enquanto autenticado, sem depender de demands.length (Fix 3)
  useRealtimeSync({
    table: 'instructor_allocations',
    onSync: syncDemandsAndAllocations,
    enabled: realtimeEnabled,
    debounceMs: 500
  });

  // Alocações de recursos (CTM)
  useRealtimeSync({
    table: 'resource_allocations',
    onSync: syncResourceAllocationsFromDb,
    enabled: realtimeEnabled && demands.length > 0,
    debounceMs: 500
  });

  // Acompanhantes
  useRealtimeSync({
    table: 'companion_allocations',
    onSync: syncCompanionAllocationsFromDb,
    enabled: realtimeEnabled && demands.length > 0,
    debounceMs: 500
  });

  // Controle logístico (logistic_allocations)
  useRealtimeSync({
    table: 'logistic_allocations',
    onSync: syncLogisticAllocationsFromDb,
    enabled: realtimeEnabled,
    debounceMs: 500
  });

  const normalizeDate = useCallback((dateStr?: string) => {
    if (!dateStr) return null;
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
      if (isDateOnly(s)) {
        return `${s}T${kind === 'start' ? '08:00' : '18:00'}`;
      }
      return s;
    },
    [isDateOnly]
  );

  const getEffectiveDemandRange = useCallback(
    (d: Demand) => {
      if (d.modality === 'HIBRIDO' && (d as any).practiceStartDate && (d as any).practiceEndDate) {
        return {
          start: ensureDateTime((d as any).practiceStartDate, 'start'),
          end: ensureDateTime((d as any).practiceEndDate, 'end')
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
      if (d.modality !== 'HIBRIDO') {
        const { practiceStartDate, practiceEndDate, ...rest } = d as any;
        return rest as Demand;
      }

      const totalStart = normalizeDate(d.startDate);
      const totalEnd = normalizeDate(d.endDate);
      const pStart = normalizeDate((d as any).practiceStartDate);
      const pEnd = normalizeDate((d as any).practiceEndDate);

      const totalValid = !!totalStart && !!totalEnd && totalStart <= totalEnd;
      const practiceComplete = !!pStart && !!pEnd;

      if (!totalValid || !practiceComplete) {
        return { ...d, practiceStartDate: undefined, practiceEndDate: undefined } as any;
      }

      const withinRange = pStart! >= totalStart! && pEnd! <= totalEnd! && pStart! <= pEnd!;
      if (!withinRange) {
        return { ...d, practiceStartDate: undefined, practiceEndDate: undefined } as any;
      }

      return d;
    },
    [normalizeDate]
  );

  /* -------------------------
     CRUD (Functional Updates)
  -------------------------- */

const addDemand = useCallback(
  async (d: Demand): Promise<{ id: string } | null> => {
    // ✅ MOCK MODE
    if (AUTH_MODE !== 'supabase') {
      // Usa o valor atual do estado diretamente (evita race condition)
      const seq = nextDemandNumber;
      // Incrementa para a próxima demanda
      setNextDemandNumber(prev => prev + 1);

      const nextId = `DEM-${seq}`;

      const newDemand = sanitizeHybridPracticePeriod({
        ...d,
        id: nextId,
        status: 'NOVA' as DemandStatus
      });

      setDemands(prev => [...prev, newDemand]);

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

      setMeasurements(prev => [...prev, newMeasurement]);

      setEvidenceStore(prev => ({
        ...prev,
        [nextId]:
          prev[nextId] ??
          {
            demandId: nextId,
            attendanceList: [],
            certificates: [],
            photos: [],
            notes: ''
          }
      }));

      setNotification({ message: 'Demanda criada (mock).', type: 'success' });
      return { id: nextId };
    }

    // ✅ SUPABASE MODE
    if (!user) {
    setNotification({
        message: 'Aguarde a sessão carregar para salvar a demanda.',
        type: 'info'
      });
      return null;
    }

    try {
      // Usa o valor atual do estado diretamente (evita race condition)
      const seq = nextDemandNumber;
      // Incrementa para a próxima demanda
      setNextDemandNumber(prev => prev + 1);

      const nextId = `DEM-${seq}`;

      const newDemand = sanitizeHybridPracticePeriod({
        ...d,
        id: nextId,
        status: 'NOVA' as DemandStatus
      });

      const payload = mapDemandToDb(newDemand, { id: nextId, number: seq });

      const { data, error } = await insertDemand(payload);

      if (error || !data) {
        console.error('Erro insert demand:', error);
        setNotification({
          message: `Erro ao criar demanda: ${error?.message ?? 'ver console'}`,
          type: 'error'
        });
        return null;
      }

      await syncDemandsFromDb();

      // MVP: cria measurement local (enquanto não persistir medição no Supabase)
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

      setMeasurements(prev =>
        prev.some(m => m.demandId === nextId) ? prev : [...prev, newMeasurement]
      );

      setEvidenceStore(prev => ({
        ...prev,
        [nextId]:
          prev[nextId] ??
          {
            demandId: nextId,
            attendanceList: [],
            certificates: [],
            photos: [],
            notes: ''
          }
      }));

      setNotification({ message: 'Demanda criada com sucesso.', type: 'success' });

      // ✅ Retorna o ID final
      return { id: (data as any).id ?? nextId };
    } catch (e) {
      console.error('Erro ao criar demanda:', e);
      setNotification({ message: 'Erro ao criar demanda.', type: 'error' });
      return null;
    }
  },
  [
    AUTH_MODE,
    loading,
    user,
    nextDemandNumber,
    sanitizeHybridPracticePeriod,
    mapDemandToDb,
    syncDemandsFromDb,
    setNextDemandNumber,
    setDemands,
    setMeasurements,
    setEvidenceStore,
    setNotification
  ]
);



  const updateDemand = useCallback(
    (d: Demand) => {
      // ✅ MOCK MODE
      if (AUTH_MODE !== 'supabase') {
        setDemands(prev =>
          prev.map(item => {
            if (item.id !== d.id) return item;
            const merged = { ...item, ...d } as Demand;
            return sanitizeHybridPracticePeriod(merged);
          })
        );
        return;
      }

      // ✅ SUPABASE MODE
      if (!user) {
        setNotification({
          message: 'Aguarde a sessão carregar para salvar a demanda.',
          type: 'info'
        });
        return;
      }

      (async () => {
        try {
          const merged = sanitizeHybridPracticePeriod(d);

          // ✅ Atualiza state local imediatamente para refletir na UI sem aguardar o banco
          setDemands(prev => prev.map(item => item.id !== merged.id ? item : merged));

          const payload = mapDemandToDb(merged);

          const { error } = await updateDemandById(merged.id, payload);
          if (error) {
            console.error('Erro update demand:', error);
            // Reverte o state local em caso de erro no banco
            setDemands(prev => prev.map(item => item.id !== merged.id ? item : d));
            setNotification({
              message: `Erro ao atualizar demanda: ${error.message}`,
              type: 'error'
            });
            return;
          }

          setNotification({ message: 'Demanda atualizada com sucesso.', type: 'success' });
        } catch (e) {
          console.error('Erro ao atualizar demanda:', e);
          setNotification({ message: 'Erro ao atualizar demanda.', type: 'error' });
        }
      })();
    },
    [AUTH_MODE, loading, user, sanitizeHybridPracticePeriod, mapDemandToDb, syncDemandsFromDb]
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
        setNotification({
          message: 'Selecione datas válidas para o período de prática.',
          type: 'error'
        });
        return false;
      }
      if (pStart > pEnd) {
        setNotification({
          message: 'A data de início da prática não pode ser maior que a data de fim.',
          type: 'error'
        });
        return false;
      }
      if (pStart < totalStart || pEnd > totalEnd) {
        setNotification({
          message: 'O período de prática deve estar dentro do período total da demanda.',
          type: 'error'
        });
        return false;
      }

      updateDemand({ ...(demand as any), practiceStartDate, practiceEndDate } as Demand);

      setNotification({ message: 'Período de prática salvo com sucesso.', type: 'success' });
      return true;
    },
    [demands, normalizeDate, updateDemand]
  );

  const deleteDemand = useCallback(
  (id: string) => {
    // ✅ MOCK MODE
    if (AUTH_MODE !== 'supabase') {
      setDemands(prev => prev.filter(d => d.id !== id));
      setMeasurements(prev => prev.filter(m => m.demandId !== id));
      setAgendaItems(prev => prev.filter(item => item.relatedDemandId !== id));
      setInstructorAllocations(prev => prev.filter(a => a.demandId !== id));
      setResourceAllocations(prev => prev.filter(a => a.demandId !== id));

      setEvidenceStore(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    // ✅ SUPABASE MODE
    if (!user) {
      setNotification({
        message: 'Aguarde a sessão carregar para remover a demanda.',
        type: 'info'
      });
      return;
    }

    // ✅ Optimistic update: remove já no app (fica mais responsivo)
    let prevDemandsSnapshot: Demand[] | null = null;

    setDemands(prev => {
      prevDemandsSnapshot = prev;
      return prev.filter(d => d.id !== id);
    });

    // também limpa “dependências” localmente já
    setMeasurements(prev => prev.filter(m => m.demandId !== id));
    setAgendaItems(prev => prev.filter(item => item.relatedDemandId !== id));
    setInstructorAllocations(prev => prev.filter(a => a.demandId !== id));
    setResourceAllocations(prev => prev.filter(a => a.demandId !== id));
    setEvidenceStore(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    (async () => {
      try {
        // 🔥 Limpa arquivos de evidências do Storage (bucket: evidences)
        try {
          const { data: evidenceFiles } = await supabase.storage.from('evidences').list(`demands/${id}`, { limit: 500 });
          if (evidenceFiles && evidenceFiles.length > 0) {
            // lista subpastas (attendance, certificate, photos)
            for (const item of evidenceFiles) {
              if (item.id === null || item.name === '.emptyFolderPlaceholder') continue;
              const { data: subFiles } = await supabase.storage.from('evidences').list(`demands/${id}/${item.name}`, { limit: 500 });
              if (subFiles && subFiles.length > 0) {
                const paths = subFiles.map(f => `demands/${id}/${item.name}/${f.name}`);
                await supabase.storage.from('evidences').remove(paths);
              }
            }
          }
        } catch (e) { console.error('[deleteDemand] erro ao limpar evidências do storage:', e); }

        // 🔥 Limpa arquivos de medição do Storage (bucket: measurement-attachments)
        try {
          const { data: measFiles } = await supabase.storage.from('measurement-attachments').list(`measurements/${id}`, { limit: 500 });
          if (measFiles && measFiles.length > 0) {
            const paths = measFiles.map(f => `measurements/${id}/${f.name}`);
            await supabase.storage.from('measurement-attachments').remove(paths);
          }
        } catch (e) { console.error('[deleteDemand] erro ao limpar medições do storage:', e); }

        const { data, error } = await deleteDemandById(id);

        if (error) {
          console.error('Erro delete demand:', error);

          // rollback
          if (prevDemandsSnapshot) setDemands(prevDemandsSnapshot);

          setNotification({
            message: `Erro ao excluir demanda: ${error.message}`,
            type: 'error'
          });
          return;
        }

        // ✅ garante que realmente deletou
        if (!data || data.length === 0) {
          console.error('Delete não removeu nenhuma linha. ID:', id);

          // rollback
          if (prevDemandsSnapshot) setDemands(prevDemandsSnapshot);

          setNotification({
            message: 'Não foi possível excluir a demanda (nenhuma linha foi removida).',
            type: 'error'
          });
          return;
        }

        // ✅ sincroniza com banco para garantir consistência
        await syncDemandsFromDb();

        setNotification({ message: 'Demanda excluída com sucesso.', type: 'success' });
      } catch (e) {
        console.error('Erro ao excluir demanda:', e);

        // rollback
        if (prevDemandsSnapshot) setDemands(prevDemandsSnapshot);

        setNotification({ message: 'Erro ao excluir demanda.', type: 'error' });
      }
    })();
  },
  [AUTH_MODE, user, syncDemandsFromDb, setNotification]
);


  const cancelDemand = useCallback(
    (demandId: string) => {
      // ✅ MOCK MODE
      if (AUTH_MODE !== 'supabase') {
        setDemands(prev => prev.map(d => (d.id === demandId ? { ...d, status: 'CANCELADA' } : d)));
        return;
      }

      // ✅ SUPABASE MODE
      if (!user) {
        setNotification({
          message: 'Aguarde a sessão carregar para cancelar a demanda.',
          type: 'info'
        });
        return;
      }

      (async () => {
        try {
          const payload = { status: 'CANCELADA' };
          const { error } = await updateDemandById(demandId, payload);
          if (error) {
            console.error('Erro cancel demand:', error);
            setNotification({
              message: `Erro ao cancelar demanda: ${error.message}`,
              type: 'error'
            });
            return;
          }

          await syncDemandsFromDb();
          setNotification({ message: 'Demanda cancelada.', type: 'success' });
        } catch (e) {
          console.error('Erro ao cancelar demanda:', e);
          setNotification({ message: 'Erro ao cancelar demanda.', type: 'error' });
        }
      })();
    },
    [AUTH_MODE, loading, user, syncDemandsFromDb]
  );

  const updateMeasurement = useCallback((m: Measurement) => {
  // MOCK
  if (AUTH_MODE !== 'supabase') {
    setMeasurements(prev =>
      prev.map(item => (item.id === m.id ? { ...m, updatedAt: new Date().toISOString() } : item))
    );
    return;
  }

  // SUPABASE
  (async () => {
    try {
      const patch = mapMeasurementToDbPatch(m);
      const { data, error } = await upsertMeasurementByDemandId(m.demandId, patch);

      if (error || !data) {
        console.error('[Measurements] upsert error', error);
        return;
      }

      const updated = mapMeasurementFromDb(data);

      setMeasurements(prev => {
        const exists = prev.some(x => x.demandId === updated.demandId);
        if (!exists) return [updated, ...prev];
        return prev.map(x => (x.demandId === updated.demandId ? updated : x));
      });
    } catch (e) {
      console.error('[Measurements] update exception', e);
    }
  })();
}, [AUTH_MODE, upsertMeasurementByDemandId, mapMeasurementFromDb, mapMeasurementToDbPatch]);


  const addInstructor = useCallback((i: Instructor) => {
    setInstructors(prev => [...prev, i]);
  }, []);

  const updateInstructor = useCallback((i: Instructor) => {
    setInstructors(prev => prev.map(item => (item.id === i.id ? i : item)));
  }, []);

  const updateInstructorCurrentLocation = useCallback(async (instructorId: string, location: string) => {
    // Optimistic update
    setInstructors(prev => prev.map(inst =>
      inst.id === instructorId ? { ...inst, currentLocation: location || '' } : inst
    ));

    if (AUTH_MODE !== 'supabase') return;

    try {
      const { error } = await supabase
        .from('instructors')
        .update({ coverage_locations: location ? [location] : [] })
        .eq('id', instructorId);

      if (error) throw error;
    } catch (e: any) {
      console.error('[Instructor] updateCurrentLocation error', e);
      // Rollback: re-sync from DB
      await syncInstructorsFromDb();
      setNotification({ message: 'Erro ao atualizar localidade do instrutor.', type: 'error' });
    }
  }, [syncInstructorsFromDb, setNotification]);

  const addCompany = useCallback(async (c: Company) => {
    if (AUTH_MODE !== 'supabase') {
      setCompanies(prev => [...prev, { ...c, id: `COMP-${Date.now()}` }]);
      return;
    }

    try {
      const payload = {
        name: c.name,
        razao_social: c.razaoSocial || null,
        cnpj: c.cnpj || null,
        segment: c.segment || 'Outros',
        status: c.status || 'ATIVO',
        logistics_type: c.logisticsType || 'SIMPLIFICADA',
        cidade: c.address?.cidade || null,
        estado: c.address?.estado || null,
        observations: c.observations || null,
      };

      const saved = await insertCompany(payload);
      setCompanies(prev => [...prev, mapCompanyFromDb(saved)]);
      setNotification({ message: 'Empresa criada com sucesso!', type: 'success' });
    } catch (e: any) {
      console.error('[Company] insert error', e);
      setNotification({ message: `Erro ao criar empresa: ${e?.message || 'ver console'}`, type: 'error' });
    }
  }, [AUTH_MODE, mapCompanyFromDb, setNotification]);

  const updateCompany = useCallback(async (c: Company) => {
    // Optimistic update
    setCompanies(prev => prev.map(item => (item.id === c.id ? c : item)));

    if (AUTH_MODE !== 'supabase') return;

    try {
      const payload = {
        name: c.name,
        razao_social: c.razaoSocial || null,
        cnpj: c.cnpj || null,
        segment: c.segment || 'Outros',
        status: c.status || 'ATIVO',
        logistics_type: c.logisticsType || 'SIMPLIFICADA',
        cidade: c.address?.cidade || null,
        estado: c.address?.estado || null,
        observations: c.observations || null,
      };

      await updateCompanyById(c.id, payload);
      setNotification({ message: 'Empresa atualizada com sucesso!', type: 'success' });
    } catch (e: any) {
      console.error('[Company] update error', e);
      // Rollback optimistic update re-syncing from DB
      try {
        const fresh = await fetchCompanies();
        setCompanies(fresh.map(mapCompanyFromDb));
      } catch {}
      setNotification({ message: `Erro ao atualizar empresa: ${e?.message || 'ver console'}`, type: 'error' });
    }
  }, [AUTH_MODE, mapCompanyFromDb, setNotification]);

  // ✅ Treinamentos (mock vs supabase)
  const addTraining = useCallback(
    (t: Training) => {
      if (AUTH_MODE !== 'supabase') {
        setTrainings(prev => [...prev, t]);
        return;
      }

      if (!user) {
        setNotification({
          message: 'Aguarde a sessão carregar para salvar o treinamento.',
          type: 'info'
        });
        return;
      }

      (async () => {
        try {
          // ✅ NÃO manda id (uuid é gerado no banco)
          const payload = mapTrainingToDb(t);

          const { error } = await supabase.from('trainings').insert(payload);

          if (error) {
            console.error('Erro insert trainings:', error);
            setNotification({
              message: `Erro ao criar treinamento: ${error.message}`,
              type: 'error'
            });
            return;
          }

          await syncTrainingsFromDb();
          setNotification({ message: 'Treinamento criado com sucesso.', type: 'success' });
        } catch (e) {
          console.error('Erro ao criar treinamento:', e);
          setNotification({ message: 'Erro ao criar treinamento.', type: 'error' });
        }
      })();
    },
    [AUTH_MODE, loading, user, mapTrainingToDb, syncTrainingsFromDb]
  );

  const updateTraining = useCallback(
    (t: Training) => {
      if (AUTH_MODE !== 'supabase') {
        setTrainings(prev => prev.map(item => (item.id === t.id ? t : item)));
        return;
      }

      if (!user) {
        setNotification({
          message: 'Aguarde a sessão carregar para salvar o treinamento.',
          type: 'info'
        });
        return;
      }

      (async () => {
        try {
          // ✅ NÃO tenta atualizar o id
          const payload = mapTrainingToDb(t);

          const { error } = await supabase.from('trainings').update(payload).eq('id', t.id);

          if (error) {
            console.error('Erro update trainings:', error);
            setNotification({
              message: `Erro ao atualizar treinamento: ${error.message}`,
              type: 'error'
            });
            return;
          }

          await syncTrainingsFromDb();
          setNotification({ message: 'Treinamento atualizado com sucesso.', type: 'success' });
        } catch (e) {
          console.error('Erro ao atualizar treinamento:', e);
          setNotification({ message: 'Erro ao atualizar treinamento.', type: 'error' });
        }
      })();
    },
    [AUTH_MODE, loading, user, mapTrainingToDb, syncTrainingsFromDb]
  );


/** ✅ CREATE */
const addAgendaItem = useCallback(
  async (item: AgendaItem) => {
    // MOCK
    if (AUTH_MODE !== 'supabase') {
      setAgendaItems(prev => [...prev, item]);
      return;
    }

    try {
    const { data, error } = await insertAgendaItem(item); // passa AgendaItem direto
    if (error) throw error;
    await syncAgendaItemsFromDb();

      setNotification({ message: 'Registro salvo com sucesso.', type: 'success' });
    } catch (e) {
      console.error('addAgendaItem error:', e);
      setNotification({ message: 'Erro ao salvar registro na agenda.', type: 'error' });
      throw e;
    }
  },
  [AUTH_MODE, syncAgendaItemsFromDb, setNotification]
);

/** ✅ UPDATE */
const updateAgendaItem = useCallback(
  async (item: AgendaItem) => {
    // MOCK
    if (AUTH_MODE !== 'supabase') {
      setAgendaItems(prev => prev.map(i => (i.id === item.id ? item : i)));
      return;
    }

    try {
    const { data, error } = await updateAgendaItemById(item.id, item); // passa patch do app
    if (error) throw error;
    await syncAgendaItemsFromDb();


      setNotification({ message: 'Registro atualizado com sucesso.', type: 'success' });
    } catch (e) {
      console.error('updateAgendaItem error:', e);
      setNotification({ message: 'Erro ao atualizar registro da agenda.', type: 'error' });
    }
  },
  [AUTH_MODE, syncAgendaItemsFromDb, setNotification]
);

/** ✅ DELETE */
const removeAgendaItem = useCallback(
  async (id: string) => {
    // MOCK
    if (AUTH_MODE !== 'supabase') {
      setAgendaItems(prev => prev.filter(i => i.id !== id));
      return;
    }

    try {
      const { error } = await deleteAgendaItemById(id);
      if (error) throw error;

      // ✅ remove local + garante que ficou igual ao banco
      setAgendaItems(prev => prev.filter(i => i.id !== id));

      // ✅ garante consistência com o banco (importante)
      await syncAgendaItemsFromDb();

      setNotification({ message: 'Registro removido com sucesso.', type: 'success' });
    } catch (e) {
      console.error('removeAgendaItem error:', e);
      setNotification({ message: 'Erro ao excluir registro da agenda.', type: 'error' });
    }
  },
  [AUTH_MODE, setNotification, syncAgendaItemsFromDb]
);

  const persistInstructorAllocationsForDemand = useCallback(
    async (demandId: string, allocationsForDemand: InstructorAllocation[]) => {
      if (AUTH_MODE !== 'supabase') return;

      try {
        const rows = allocationsForDemand.map(a => ({
          id: a.id,
          demand_id: a.demandId,
          instructor_id: a.instructorId,
          start_date: a.startDate,
          end_date: a.endDate
        }));

        await replaceInstructorAllocationsForDemand(demandId, rows);

        // garante consistência
        await syncInstructorAllocationsFromDb();
      } catch (e) {
        console.error('[InstructorAllocations] persist error', e);
        setNotification({
          message: 'Erro ao salvar alocações de instrutor no banco.',
          type: 'error'
        });
      }
    },
    [AUTH_MODE, syncInstructorAllocationsFromDb]
  );
  /**
   * ADD INSTRUCTOR ALLOCATION WITH AUTOMATIC SPLIT
   *
   * Regra de negócio: cada DIA só pode pertencer a UM instrutor dentro da mesma demanda.
   * Ao adicionar uma nova alocação, os dias que se sobrepõem são removidos de qualquer
   * instrutor que os possuía anteriormente e passam para o novo instrutor.
   */
  const addInstructorAllocation = useCallback(
    (newAlloc: InstructorAllocation) => {
      setInstructorAllocations(prev => {
        const fmt = (d: Date) => {
          const z = (n: number) => n.toString().padStart(2, '0');
          return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(
            d.getHours()
          )}:${z(d.getMinutes())}`;
        };

        // ✅ Normaliza para comparação por DIA (ignora horas)
        const toDateOnly = (dateStr: string) => {
          const d = new Date(dateStr);
          return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        };

        const nStartDay = toDateOnly(newAlloc.startDate);
        const nEndDay = toDateOnly(newAlloc.endDate);

        const adjusted: InstructorAllocation[] = [];

        prev.forEach(old => {
          // Mantém alocações de outras demandas
          if (old.demandId !== newAlloc.demandId) {
            adjusted.push(old);
            return;
          }

          const oStartDay = toDateOnly(old.startDate);
          const oEndDay = toDateOnly(old.endDate);

          // ✅ CASO 1: Nova alocação cobre completamente a antiga (remove a antiga)
          // Ex: old = 09-10, new = 09-13 → remove old completamente
          if (nStartDay <= oStartDay && nEndDay >= oEndDay) {
            // Remove completamente - não adiciona ao adjusted
            return;
          }

          // ✅ CASO 2: Nova alocação está no MEIO da antiga (split em duas partes)
          // Ex: old = 09-13, new = 11-12 → old vira 09-10 + 13-13
          if (nStartDay > oStartDay && nEndDay < oEndDay) {
            // Parte 1: do início da antiga até o dia ANTES da nova
            const p1End = new Date(newAlloc.startDate);
            p1End.setDate(p1End.getDate() - 1);
            p1End.setHours(18, 0, 0, 0);

            adjusted.push({
              ...old,
              id: `${old.id}-1`,
              endDate: fmt(p1End)
            });

            // Parte 2: do dia DEPOIS da nova até o fim da antiga
            const p2Start = new Date(newAlloc.endDate);
            p2Start.setDate(p2Start.getDate() + 1);
            p2Start.setHours(8, 0, 0, 0);

            adjusted.push({
              ...old,
              id: `${old.id}-2`,
              startDate: fmt(p2Start)
            });
            return;
          }

          // ✅ CASO 3: Nova alocação sobrepõe o FINAL da antiga
          // Ex: old = 09-12, new = 11-14 → old vira 09-10
          if (nStartDay > oStartDay && nStartDay <= oEndDay) {
            const trimmedEnd = new Date(newAlloc.startDate);
            trimmedEnd.setDate(trimmedEnd.getDate() - 1);
            trimmedEnd.setHours(18, 0, 0, 0);

            // Só adiciona se restar pelo menos 1 dia
            if (toDateOnly(fmt(trimmedEnd)) >= oStartDay) {
              adjusted.push({
                ...old,
                endDate: fmt(trimmedEnd)
              });
            }
            return;
          }

          // ✅ CASO 4: Nova alocação sobrepõe o INÍCIO da antiga
          // Ex: old = 09-12, new = 07-10 → old vira 11-12
          if (nEndDay >= oStartDay && nEndDay < oEndDay) {
            const trimmedStart = new Date(newAlloc.endDate);
            trimmedStart.setDate(trimmedStart.getDate() + 1);
            trimmedStart.setHours(8, 0, 0, 0);

            // Só adiciona se restar pelo menos 1 dia
            if (toDateOnly(fmt(trimmedStart)) <= oEndDay) {
              adjusted.push({
                ...old,
                startDate: fmt(trimmedStart)
              });
            }
            return;
          }

          // ✅ CASO 5: Sem sobreposição - mantém a alocação
          adjusted.push(old);
        });

        const next = [...adjusted, newAlloc];

        // ✅ persist: replace todas alocações dessa demanda
        if (AUTH_MODE === 'supabase') {
          const demandId = newAlloc.demandId;
          const forDemand = next.filter(a => a.demandId === demandId);

          // fire-and-forget controlado
          (async () => {
            await persistInstructorAllocationsForDemand(demandId, forDemand);
          })();
        }

        return next;
      });
    },
    [AUTH_MODE, persistInstructorAllocationsForDemand]
  );


  const updateInstructorAllocation = useCallback((updated: InstructorAllocation) => {
    if (AUTH_MODE !== 'supabase') {
      setInstructorAllocations(prev => prev.map(a => (a.id === updated.id ? updated : a)));
      return;
    }

    // Snapshot para rollback
    setInstructorAllocations(prev => {
      const snapshot = prev;
      const next = prev.map(a => (a.id === updated.id ? updated : a));

      // Persiste no Supabase de forma assíncrona
      (async () => {
        try {
          await upsertInstructorAllocation({
            id: updated.id,
            demand_id: updated.demandId,
            instructor_id: updated.instructorId,
            start_date: updated.startDate,
            end_date: updated.endDate
          });
        } catch (e) {
          console.error('[updateInstructorAllocation] Erro ao persistir no banco:', e);
          // Reverte para o estado anterior
          setInstructorAllocations(snapshot);
          setNotification({ message: 'Erro ao atualizar alocação de instrutor.', type: 'error' });
        }
      })();

      return next;
    });
  }, [AUTH_MODE, setNotification]);

  const removeInstructorAllocation = useCallback(
  (id: string) => {
    setInstructorAllocations(prev => {
      const toRemove = prev.find(a => a.id === id);
      if (!toRemove) return prev;

      const demandId = toRemove.demandId;
      const demand = demands.find(d => d.id === demandId);

      // Se não achou demanda, remove local e ainda assim tenta persistir o que sobrou no banco
      if (!demand) {
        const next = prev.filter(a => a.id !== id);

        if (AUTH_MODE === 'supabase') {
          const forDemand = next.filter(a => a.demandId === demandId);
          (async () => {
            await persistInstructorAllocationsForDemand(demandId, forDemand);
          })();
        }

        return next;
      }

      const otherAllocations = prev.filter(a => a.demandId !== demandId);
      const remainingForDemand = prev.filter(a => a.demandId === demandId && a.id !== id);

      const effective = getEffectiveDemandRange(demand);

      const isValidRange = (startStr: string, endStr: string) => {
        const s = new Date(startStr).getTime();
        const e = new Date(endStr).getTime();
        return !isNaN(s) && !isNaN(e) && s <= e;
      };

      // ✅ CASO 1: removeu tudo -> volta para programação (e persiste no Supabase)
      if (remainingForDemand.length === 0) {
        // IMPORTANTE: usar updateDemand (persiste no Supabase)
        updateDemand({ ...demand, instructorId: undefined, status: 'PENDENTE' });

        if (AUTH_MODE === 'supabase') {
          (async () => {
            await persistInstructorAllocationsForDemand(demandId, []);
          })();
        }

        return otherAllocations;
      }

      // ✅ CASO 2: sobrou 1 instrutor -> merge para cobrir o período inteiro
      const uniqueInstructorIds: string[] = Array.from(
        new Set(
          remainingForDemand
            .map(a => a.instructorId)
            .filter((x): x is string => typeof x === 'string' && x.length > 0)
        )
      );

      if (uniqueInstructorIds.length === 1) {
        const remainingInstructorId = uniqueInstructorIds[0];

        const merged: InstructorAllocation = {
          id: `ALOC-MERGED-${Date.now()}`, // mantém como você estava fazendo
          demandId,
          instructorId: remainingInstructorId,
          startDate: effective.start,
          endDate: effective.end
        };

        const next = [...otherAllocations, merged];

        if (AUTH_MODE === 'supabase') {
          const forDemand = next.filter(a => a.demandId === demandId);
          (async () => {
            await persistInstructorAllocationsForDemand(demandId, forDemand);
          })();
        }

        setNotification({
          message:
            'O período removido foi automaticamente reassumido pelo instrutor restante para manter a demanda completa.',
          type: 'info'
        });

        return next;
      }

      // ✅ CASO 3: sobrou mais de 1 -> recalcula limites (sua lógica original)
      const z = (n: number) => n.toString().padStart(2, '0');
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(
          d.getMinutes()
        )}`;

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

      const cleaned = rebuilt.filter(a => isValidRange(a.startDate, a.endDate));
      const next = [...otherAllocations, ...cleaned];

      if (AUTH_MODE === 'supabase') {
        const forDemand = next.filter(a => a.demandId === demandId);
        (async () => {
          await persistInstructorAllocationsForDemand(demandId, forDemand);
        })();
      }

      setNotification({
        message:
          'O período removido foi automaticamente reassumido por outro instrutor para manter a demanda completa.',
        type: 'info'
      });

      return next;
    });
  },
  [
    AUTH_MODE,
    demands,
    getEffectiveDemandRange,
    persistInstructorAllocationsForDemand,
    setNotification,
    updateDemand
  ]
);


  const addResourceAllocation = useCallback((a: LogisticAllocation) => {
  // estado local
  setResourceAllocations(prev => {
  const exists = prev.some(x => x.demandId === a.demandId);
  if (exists) return prev.map(x => (x.demandId === a.demandId ? a : x));
  return [...prev, a];
});


  // supabase
  if (AUTH_MODE !== 'supabase') return;

  (async () => {
    try {
      await upsertResourceAllocation({
        demand_id: a.demandId,
        resource_type: 'CENTRO_TREINAMENTO_MOVEL',
        start_date: a.startDate,
        end_date: a.endDate
      });

      await syncResourceAllocationsFromDb();
    } catch (e) {
      console.error('[ResourceAllocations] add error', e);
    }
  })();
}, [AUTH_MODE, syncResourceAllocationsFromDb]);


  const updateResourceAllocation = useCallback((a: LogisticAllocation) => {
  setResourceAllocations(prev =>
  prev.map(item => (item.demandId === a.demandId ? { ...item, ...a } : item))
);


  if (AUTH_MODE !== 'supabase') return;

  (async () => {
    try {
      await upsertResourceAllocation({
        demand_id: a.demandId,
        resource_type: 'CENTRO_TREINAMENTO_MOVEL',
        start_date: a.startDate,
        end_date: a.endDate
      });

      await syncResourceAllocationsFromDb();
    } catch (e) {
      console.error('[ResourceAllocations] update error', e);
    }
  })();
}, [AUTH_MODE, syncResourceAllocationsFromDb]);


  const removeResourceAllocation = useCallback((id: string) => {
  let found: LogisticAllocation | undefined;

  setResourceAllocations(prev => {
    found = prev.find(a => a.id === id);
    if (!found) return prev;

    // ✅ remove pelo demandId (chave real)
    return prev.filter(a => a.demandId !== found!.demandId);
  });


  if (AUTH_MODE !== 'supabase') return;

  (async () => {
    try {
      if (found?.demandId) {
        await deleteResourceAllocationByDemandId(found.demandId);
      } else {
        // fallback: apaga direto pelo id
        await supabase.from('resource_allocations').delete().eq('id', id);
      }

      await syncResourceAllocationsFromDb();
    } catch (e) {
      console.error('[ResourceAllocations] remove error', e);
    }
  })();
}, [AUTH_MODE, syncResourceAllocationsFromDb]);


 const updateOperationalBase = useCallback(
  async (key: OperationalBaseKey, newList: string[]) => {
    // Se quiser bloquear no modo mock (opcional, mas recomendado)
    if (AUTH_MODE !== 'supabase') {
      setOperationalBases(prev => ({ ...prev, [key]: newList }));
      return;
    }

    try {
      // 1) apaga tudo da base (daquela key)
      const { error: delError } = await supabase
        .from('operational_bases_items')
        .delete()
        .eq('base_key', key);

      if (delError) throw delError;

      // 2) recria a lista
      const payload = (newList || [])
        .map(v => (v ?? '').trim())
        .filter(Boolean)
        .map(value => ({
          base_key: key,
          value
        }));

      if (payload.length) {
        const { error: insError } = await supabase
          .from('operational_bases_items')
          .insert(payload);

        if (insError) throw insError;
      }

      // 3) atualiza estado local
      setOperationalBases(prev => ({ ...prev, [key]: newList }));

      setNotification({ message: 'Base operacional atualizada com sucesso.', type: 'success' });
    } catch (e: any) {
      console.error('[OperationalBases] update error', e);
      setNotification({
        message: `Erro ao atualizar base operacional: ${e?.message ?? 'ver console'}`,
        type: 'error'
      });
    }
  },
  [AUTH_MODE, setNotification]
);

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
    // Aguarda o primeiro sync de alocações para evitar falso conflito durante carregamento
    if (!allocationsLoaded) return false;

    // --- Helpers locais (evita bug de UTC com "YYYY-MM-DD") ---
    const toDateOnly = (v?: string) => {
      if (!v) return '';
      return v.includes('T') ? v.split('T')[0] : v;
    };

    const toDayStart = (v?: string) => {
      const d = toDateOnly(v);
      if (!d) return null;
      return new Date(`${d}T00:00:00`);
    };

    const toDayEnd = (v?: string) => {
      const d = toDateOnly(v);
      if (!d) return null;
      return new Date(`${d}T23:59:59`);
    };

    const overlapsByDay = (aStart?: string, aEnd?: string, bStart?: string, bEnd?: string) => {
      const as = toDayStart(aStart);
      const ae = toDayEnd(aEnd);
      const bs = toDayStart(bStart);
      const be = toDayEnd(bEnd);

      if (!as || !ae || !bs || !be) return false;

      // Sobreposição por dia (inclusivo)
      return as <= be && ae >= bs;
    };

    // Normaliza o período que está tentando alocar para "dia completo"
    const reqStart = toDateOnly(startDate);
    const reqEnd = toDateOnly(endDate);

    // 1) Conflito com DEMANDAS do instrutor (sem alocação explícita)
    const demandConflict = demands.some(d => {
      if (excludeDemandId && d.id === excludeDemandId) return false;
      if (d.instructorId !== instructorId) return false;
      // Apenas demandas ativas bloqueiam via instructorId direto; CONCLUIDA/CANCELADA/etc. não
      if (d.status !== 'PENDENTE' && d.status !== 'ALOCADA') return false;

      const hasExplicitAllocation = instructorAllocations.some(a => a.demandId === d.id);
      if (hasExplicitAllocation) return false;

      // ✅ DIAS ESPECÍFICOS: verificar conflito dia-a-dia
      if (d.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(d.specificDates) && d.specificDates.length > 0) {
        // Gera os dias do request e verifica interseção
        const reqDays = new Set<string>();
        const c = toDayStart(reqStart);
        const e = toDayStart(reqEnd);
        if (c && e) {
          while (c <= e) {
            reqDays.add(toDateOnly(c.toISOString()));
            c.setDate(c.getDate() + 1);
          }
        }
        return d.specificDates.some(sd => reqDays.has(sd.data));
      }

      const eff = getEffectiveDemandRange(d);
      return overlapsByDay(reqStart, reqEnd, eff.start, eff.end);
    });

    if (demandConflict) return true;

    // 2) Conflito com ALOCAÇÕES explícitas do instrutor
    const allocationConflict = instructorAllocations.some(a => {
      if (excludeAllocationId && a.id === excludeAllocationId) return false;
      if (a.instructorId !== instructorId) return false;

      // ✅ DIAS ESPECÍFICOS: verificar conflito apenas nos dias reais da demanda
      const allocDemand = demands.find(dm => dm.id === a.demandId);
      if (allocDemand && allocDemand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(allocDemand.specificDates) && allocDemand.specificDates.length > 0) {
        const reqDays = new Set<string>();
        const c = toDayStart(reqStart);
        const e = toDayStart(reqEnd);
        if (c && e) {
          while (c <= e) {
            reqDays.add(toDateOnly(c.toISOString()));
            c.setDate(c.getDate() + 1);
          }
        }
        return allocDemand.specificDates.some(sd => reqDays.has(sd.data));
      }

      // ✅ conflito por DIA (CONTÍNUO)
      return overlapsByDay(reqStart, reqEnd, a.startDate, a.endDate);
    });

    if (allocationConflict) return true;

    // 3) Conflito com itens de AGENDA do instrutor
    const agendaConflict = agendaItems.some(item => {
      if (excludeAgendaItemId && item.id === excludeAgendaItemId) return false;
      if (item.instructorId !== instructorId) return false;

      // ✅ conflito por DIA
      return overlapsByDay(reqStart, reqEnd, item.startDate, item.endDate);
    });

    return agendaConflict;
  },
  [demands, instructorAllocations, agendaItems, getEffectiveDemandRange, allocationsLoaded]
);


  const hasResourceConflict = useCallback(
    (
      startDate: string,
      endDate: string,
      excludeDemandId?: string,
      excludeAllocationId?: string
    ): boolean => {
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
      const effective = getEffectiveDemandRange(demand);

      // Helper local: normaliza para 'YYYY-MM-DD'
      const toDateOnly = (v?: string) => {
        if (!v) return '';
        return v.includes('T') ? v.split('T')[0] : v;
      };
      const toDayStart = (v?: string) => {
        const d = toDateOnly(v);
        if (!d) return null;
        return new Date(`${d}T00:00:00`);
      };
      const toDayEnd = (v?: string) => {
        const d = toDateOnly(v);
        if (!d) return null;
        return new Date(`${d}T23:59:59`);
      };
      const overlapsByDay = (aStart?: string, aEnd?: string, bStart?: string, bEnd?: string) => {
        const as = toDayStart(aStart);
        const ae = toDayEnd(aEnd);
        const bs = toDayStart(bStart);
        const be = toDayEnd(bEnd);
        if (!as || !ae || !bs || !be) return false;
        return as <= be && ae >= bs;
      };

      const reqStart = toDateOnly(effective.start);
      const reqEnd = toDateOnly(effective.end);

      // Verifica conflito de ALOCAÇÃO (demandas + instructorAllocations), sem agenda
      const hasAllocationConflict = (instructorId: string): boolean => {
        // Constrói o set de dias reais da demanda de entrada
        const isDiasEspecificos = demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0;
        const reqDays = new Set<string>();
        if (isDiasEspecificos) {
          demand.specificDates!.forEach((e) => reqDays.add(e.data));
        } else {
          const c = toDayStart(reqStart);
          const e = toDayStart(reqEnd);
          if (c && e) {
            while (c <= e) { reqDays.add(toDateOnly(c.toISOString())); c.setDate(c.getDate() + 1); }
          }
        }

        const dayInRange = (day: string, start?: string, end?: string) => {
          const d = toDayStart(day);
          const s = toDayStart(start);
          const e = toDayEnd(end);
          return !!(d && s && e && d >= s && d <= e);
        };

        // 1) Conflito com demandas
        const demandConflict = demands.some((d: Demand) => {
          if (d.id === demand.id) return false;
          if (d.instructorId !== instructorId) return false;
          // Apenas demandas ativas bloqueiam via instructorId direto; CONCLUIDA/CANCELADA/etc. não
          if (d.status !== 'PENDENTE' && d.status !== 'ALOCADA') return false;
          const hasExplicit = instructorAllocations.some((a: InstructorAllocation) => a.demandId === d.id);
          if (hasExplicit) return false;
          if (d.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(d.specificDates) && d.specificDates.length > 0) {
            return d.specificDates.some((sd) => reqDays.has(sd.data));
          }
          const eff = getEffectiveDemandRange(d);
          if (isDiasEspecificos) {
            return [...reqDays].some(day => dayInRange(day, eff.start, eff.end));
          }
          return overlapsByDay(reqStart, reqEnd, eff.start, eff.end);
        });
        if (demandConflict) return true;
        // 2) Conflito com alocações explícitas
        return instructorAllocations.some((a: InstructorAllocation) => {
          if (a.instructorId !== instructorId) return false;
          const allocDemand = demands.find((dm: Demand) => dm.id === a.demandId);
          if (allocDemand?.id === demand.id) return false;
          if (allocDemand && allocDemand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(allocDemand.specificDates) && allocDemand.specificDates.length > 0) {
            return allocDemand.specificDates.some((sd) => reqDays.has(sd.data));
          }
          if (isDiasEspecificos) {
            return [...reqDays].some(day => dayInRange(day, a.startDate, a.endDate));
          }
          return overlapsByDay(reqStart, reqEnd, a.startDate, a.endDate);
        });
      };

      // Verifica conflito de agenda respeitando dias específicos da demanda de entrada
      const hasScheduleConflictForDemand = (instructorId: string): boolean => {
        if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0) {
          return demand.specificDates!.some(entry => hasScheduleConflict(instructorId, entry.data, entry.data, demand.id));
        }
        return hasScheduleConflict(instructorId, effective.start, effective.end, demand.id);
      };

      const activeCapableInstructors = instructors
        .filter(
          i =>
            i.status === 'ATIVO' &&
            i.skills?.some(s => s.trainingId === demand.trainingId) &&
            !hasScheduleConflictForDemand(i.id)
        )
        .map(i => {
          const skill = i.skills?.find(s => s.trainingId === demand.trainingId);
          return { ...i, score: skill?.level ?? 0 };
        })
        .sort((a, b) => b.score - a.score);

      // Instrutores com conflito de alocação (mas não de agenda) — terceira seção
      const alreadyAllocated = instructors
        .filter(
          i =>
            i.status === 'ATIVO' &&
            i.skills?.some(s => s.trainingId === demand.trainingId) &&
            hasScheduleConflictForDemand(i.id) &&
            hasAllocationConflict(i.id)
        )
        .map(i => {
          const skill = i.skills?.find(s => s.trainingId === demand.trainingId);
          return { ...i, score: skill?.level ?? 0 };
        })
        .sort((a, b) => b.score - a.score);

      const demandState = (demand.demandState || '').trim().toUpperCase();
      const isSameState = (i: { residenceLocation?: string }) =>
        !!demandState && (i.residenceLocation || '').trim().toUpperCase() === demandState;

      return {
        suggested: activeCapableInstructors.filter(
          i =>
            !demandState ||
            demand.trainingLocal === 'N/A' ||
            isSameState(i)
        ),
        exceptions: activeCapableInstructors.filter(
          i =>
            !!demandState &&
            demand.trainingLocal !== 'N/A' &&
            !isSameState(i)
        ),
        alreadyAllocated,
      };
    },
    [instructors, hasScheduleConflict, getEffectiveDemandRange, demands, instructorAllocations]
  );

  const allocateInstructor = useCallback(
    (demandId: string, instructorId: string, startDate?: string, endDate?: string): boolean => {
      const demand = demands.find(d => d.id === demandId);
      if (!demand) return false;

      if (demand.modality === 'HIBRIDO') {
        const hasPractice = !!(demand as any).practiceStartDate && !!(demand as any).practiceEndDate;
        if (!hasPractice) {
          setNotification({
            message:
              'Para demandas HÍBRIDAS, defina primeiro o período presencial (prática) antes de alocar o instrutor.',
            type: 'error'
          });
          return false;
        }
      }

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
    [demands, updateDemand, addInstructorAllocation, getEffectiveDemandRange, ensureDateTime]
  );

  const deallocateInstructor = useCallback((demandId: string) => {
  // 1) volta demanda para programação
  setDemands(prev =>
    prev.map(d =>
      d.id === demandId ? { ...d, instructorId: undefined, status: 'PENDENTE' } : d
    )
  );

  // 2) remove alocações de instrutor
  setInstructorAllocations(prev => prev.filter(a => a.demandId !== demandId));

  // 3) remove CTM local
  setResourceAllocations(prev => prev.filter(a => a.demandId !== demandId));

  // 4) remove CTM no Supabase
  if (AUTH_MODE !== 'supabase') return;

  (async () => {
    try {
      await deleteResourceAllocationByDemandId(demandId);
      await syncResourceAllocationsFromDb();
    } catch (e) {
      console.error('[ResourceAllocations] deallocate -> delete CTM error', e);
    }
  })();
}, [AUTH_MODE, syncResourceAllocationsFromDb]);


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
      logisticAllocations,
      operationalBases,
      notification,
      nextDemandNumber,
      setNextDemandNumber,
      addCompanionAllocation,
      removeCompanionAllocation,
      setNotification,
      setHybridPracticePeriod,
      companionAllocations,
      evidenceStore,
      setEvidenceStore,
      getEvidenceAutoStatus,
      updateEvidence,
      reloadInstructors,
      addDemand,
      updateDemand,
      deleteDemand,
      cancelDemand,
      addInstructor,
      updateInstructor,
      updateInstructorCurrentLocation,
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
      currentView,
      setCurrentView,
      calendarDrawerDemandId,
      setCalendarDrawerDemandId,
      notificationTarget,
      setNotificationTarget,
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
      logisticAllocations,
      operationalBases,
      notification,
      nextDemandNumber,
      evidenceStore,
      getEvidenceAutoStatus,
      reloadInstructors,
      addDemand,
      updateDemand,
      deleteDemand,
      cancelDemand,
      addInstructor,
      updateInstructor,
      updateInstructorCurrentLocation,
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
      setHybridPracticePeriod,
      updateEvidence,
      companionAllocations,
      operationalBases,
      setOperationalBases,
      currentView,
      calendarDrawerDemandId,
      notificationTarget,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
};

/* ======================================================
   APP LAYOUT
====================================================== */

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
  admin: [
    'dashboard',
    'notifications',
    'demands',
    'calendar',
    'registrations',
    'logistics',
    'logistics-control',
    'measurement',
    'evidences',
    'audit'
  ],
  analista: [
    'dashboard',
    'notifications',
    'demands',
    'calendar',
    'registrations',
    'logistics',
    'logistics-control',
    'evidences',
  ],
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
  ],
  coordenador: []
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      localStorage.setItem('sidebarCollapsed', String(!prev));
      return !prev;
    });
  };
  const { notification, setNotification, currentView, setCurrentView } = useApp();
  const { user, profile, initializing, loading, signOut } = useAuth();


  useEffect(() => {
  if (!profile?.role) return;

  // se a view atual não é permitida, joga pra default do papel
  if (!canAccessView(profile.role, currentView)) {
    setCurrentView(getDefaultViewForRole(profile.role));
  }
}, [profile?.role, currentView]);

// ✅ BLOQUEIA SÓ A INICIALIZAÇÃO DO AUTH
if (initializing) {
  return (
    <div className="p-6">
      <p>Carregando sessão...</p>
    </div>
  );
}

// ✅ Só espera perfil se EXISTE sessão
if (user && !profile) {
  return (
    <div className="p-6">
      <p>Carregando perfil...</p>
    </div>
  );
}

// ✅ FAILSAFE: user existe, mas profile não carregou (e não está mais carregando)
if (user && !profile && !loading) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-red-600">Não foi possível carregar seu perfil</h2>
      <p className="mt-2">Clique para sair e entrar novamente.</p>
      <button
        className="mt-4 rounded bg-slate-900 px-4 py-2 text-white"
        onClick={() => signOut()}
      >
        Sair
      </button>
    </div>
  );
}


const renderContent = () => {
    if (!canAccessView(profile?.role, currentView)) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-red-600">Acesso não autorizado</h2>
      <p>Você não tem permissão para acessar esta área.</p>

      <button
        className="mt-4 rounded bg-slate-900 px-4 py-2 text-white"
        onClick={() => setCurrentView(getDefaultViewForRole(profile?.role))}
      >
        Voltar para minha área
      </button>
    </div>
  );
}


    switch (currentView) {
      case 'notifications':
        return <Notifications />;
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
      case 'audit':
        return <AuditPage />;
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
              <p className="text-xs font-black uppercase tracking-widest opacity-60 mb-0.5">
                Notificação do Sistema
              </p>
              <p className="text-sm font-bold leading-tight">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex-shrink-0 bg-gray-900 shadow-xl transform transition-all duration-300 lg:static lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isSidebarCollapsed ? 'w-16' : 'w-64'}`}
      >
        <div className={`flex items-center border-b border-gray-800 transition-all duration-300 ${isSidebarCollapsed ? 'justify-center p-4' : 'justify-between p-6'}`}>
          {!isSidebarCollapsed && <span className="text-xl font-bold text-white">COLABOR</span>}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSidebar}
              className="hidden lg:flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 p-1.5 rounded-lg transition-colors"
              title={isSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-gray-400">
              <X size={24} />
            </button>
          </div>
        </div>

        <nav className="mt-6 space-y-1">
          {canAccessView(profile?.role, 'dashboard') && (
            <SidebarButton
              icon={LayoutDashboard}
              label="Dashboard"
              active={currentView === 'dashboard'}
              onClick={() => setCurrentView('dashboard')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'notifications') && (
            <SidebarButton
              icon={Bell}
              label="Notificações"
              active={currentView === 'notifications'}
              onClick={() => setCurrentView('notifications')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'demands') && (
            <SidebarButton
              icon={Briefcase}
              label="Demandas"
              active={currentView === 'demands'}
              onClick={() => setCurrentView('demands')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'logistics') && (
            <SidebarButton
              icon={Truck}
              label="Programação"
              active={currentView === 'logistics'}
              onClick={() => setCurrentView('logistics')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'logistics-control') && (
            <SidebarButton
              icon={ClipboardCheck}
              label="Controle Logístico"
              active={currentView === 'logistics-control'}
              onClick={() => setCurrentView('logistics-control')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'measurement') && (
            <SidebarButton
              icon={BarChart3}
              label="Medição"
              active={currentView === 'measurement'}
              onClick={() => setCurrentView('measurement')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'evidences') && (
            <SidebarButton
              icon={FileSearch}
              label="Evidências"
              active={currentView === 'evidences'}
              onClick={() => setCurrentView('evidences')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'calendar') && (
            <SidebarButton
              icon={Calendar}
              label="Agenda"
              active={currentView === 'calendar'}
              onClick={() => setCurrentView('calendar')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'registrations') && (
            <SidebarButton
              icon={Settings}
              label="Cadastros"
              active={currentView === 'registrations'}
              onClick={() => setCurrentView('registrations')}
              collapsed={isSidebarCollapsed}
            />
          )}

          {canAccessView(profile?.role, 'audit') && (
            <SidebarButton
              icon={Shield}
              label="Auditoria"
              active={currentView === 'audit'}
              onClick={() => setCurrentView('audit')}
              collapsed={isSidebarCollapsed}
            />
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
  onClick,
  collapsed = false,
}: {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
  collapsed?: boolean;
}) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center transition-all duration-300 py-3 ${
      collapsed ? 'justify-center px-0' : 'space-x-3 px-6'
    } ${
      active ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    }`}
  >
    <Icon size={20} />
    {!collapsed && <span className="font-medium">{label}</span>}
  </button>
);

export default () => (
  <AuthProvider>
    <AppProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AppProvider>
  </AuthProvider>
);
