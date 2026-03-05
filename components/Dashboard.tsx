import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useApp } from '../App';
import {
  Filter, Calendar, Users, Briefcase, AlertCircle, CheckCircle,
  Clock, TrendingUp, AlertTriangle, Building2, MapPin,
  Truck, DollarSign, Award, Target, Zap, ShieldAlert,
  Download, MousePointer2,
  Info, Ban, ChevronDown, ChevronUp, Bell, Package, FileText, UserCheck, Hotel, Car
} from 'lucide-react';
import { Demand } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { demandIntersectsRange } from '../domain/demandDays';
import Pagination from './Pagination';
import {
  fetchLogisticAllocations,
  LogisticAllocationRow
} from '../services/logisticAllocations';

// --- Constantes Visuais ---
const COLORS = {
  CONCLUIDA: '#10B981',
  ALOCADA: '#3B82F6',
  PENDENTE: '#F59E0B',
  NOVA: '#8B5CF6',
  EM_ANDAMENTO: '#6366F1',
  CANCELADA: '#EF4444',
  CHART_PALETTE: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#6366F1', '#EC4899', '#06B6D4']
};

const STATUS_LABELS: Record<string, string> = {
  NOVA: 'Nova',
  PENDENTE: 'Pendente',
  ALOCADA: 'Alocada',
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada'
};

type TabType = 'GERAL' | 'OPERACIONAL' | 'INSTRUTORES' | 'CLIENTES' | 'CUSTOS';

type RankedItem = { name: string; value: number };

/** Lista ranqueada com barras inline e expansão do grupo "Outros" */
const RankedListChart: React.FC<{
  items: RankedItem[];
  othersDetail: RankedItem[];
  barColor: string;
  emptyLabel?: string;
}> = ({ items, othersDetail, barColor, emptyLabel = 'Sem dados' }) => {
  const [expanded, setExpanded] = useState(false);

  const allItems = expanded
    ? [...items, ...othersDetail]
    : othersDetail.length > 0
      ? [...items, { name: `Outros (${othersDetail.length} locais)`, value: othersDetail.reduce((s, i) => s + i.value, 0), isOthers: true } as any]
      : items;

  const max = Math.max(...[...items, ...othersDetail].map(i => i.value), 1);

  if (items.length === 0 && othersDetail.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-0.5">
      {allItems.map((item: any, idx: number) => {
        const isOthersRow = item.isOthers;
        return (
          <div key={item.name + idx}>
            <div
              className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${isOthersRow ? 'cursor-pointer hover:bg-slate-50 group' : ''}`}
              onClick={isOthersRow ? () => setExpanded(true) : undefined}
              title={isOthersRow ? 'Clique para ver todos os locais' : item.name}
            >
              <span className="text-[9px] font-black text-slate-300 w-3.5 text-right shrink-0">
                {isOthersRow ? '…' : idx + 1}
              </span>
              <span
                className={`text-[10px] font-bold truncate shrink-0 w-28 ${isOthersRow ? 'text-blue-500 group-hover:underline' : 'text-slate-600'}`}
              >
                {item.name}
              </span>
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isOthersRow ? 'bg-slate-300' : barColor}`}
                  style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                />
              </div>
              <span className={`text-[10px] font-black w-5 text-right shrink-0 ${isOthersRow ? 'text-slate-400' : 'text-slate-700'}`}>
                {item.value}
              </span>
            </div>
          </div>
        );
      })}
      {expanded && othersDetail.length > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors text-center"
        >
          ▲ Recolher
        </button>
      )}
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { demands, companies, regions, instructors, trainings, measurements, getEvidenceAutoStatus } = useApp();

  // ✅ NORMALIZADOR (1 vez só)
  const normId = (v: any) => String(v ?? '').trim().replace(/^#/, '');

  const [activeTab, setActiveTab] = useState<TabType>('GERAL');
  const [showNoInstructorTooltip, setShowNoInstructorTooltip] = useState(false);
  const [showNoMeasurementTooltip, setShowNoMeasurementTooltip] = useState(false);
  const noInstructorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const noMeasurementTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [showCancelledList, setShowCancelledList] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const today = new Date();

  // ✅ Supabase (controle logístico): demand_id -> logistic_allocations
  const [logisticsByDemandId, setLogisticsByDemandId] = useState<Record<string, LogisticAllocationRow>>({});
  // ✅ evita "piscar" (pendente vs ok) enquanto carrega do Supabase
  const [isLoadingPendencies, setIsLoadingPendencies] = useState(true);
  const [agenda7Page, setAgenda7Page] = useState(1);
  const AGENDA7_PER_PAGE = 15;

  const syncLogisticsControlFromDb = useCallback(async () => {
    setIsLoadingPendencies(true);
    try {
      const rows = await fetchLogisticAllocations();
      const map: Record<string, LogisticAllocationRow> = {};
      for (const r of rows || []) {
        const key = normId(r?.demand_id);
        if (key) map[key] = r;
      }
      setLogisticsByDemandId(map);
    } catch (e) {
      console.error('[Dashboard] sync logistic_allocations error:', e);
      setLogisticsByDemandId({});
    } finally {
      setIsLoadingPendencies(false);
    }
  }, []);


  useEffect(() => {
    syncLogisticsControlFromDb();
  }, [syncLogisticsControlFromDb]);

  useEffect(() => {
    const onFocus = () => syncLogisticsControlFromDb();
    const onVisibility = () => {
      if (!document.hidden) syncLogisticsControlFromDb();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncLogisticsControlFromDb]);

  // --- Filtros Globais ---
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    regionId: '',
    status: '',
    trainingLocal: '',
    corredor: '',
    demandState: ''
  });

  // --- Lógica de Mês/Ano ---
  const availableMonths = useMemo(() => {
    const unique = new Map<string, string>();
    demands.forEach(d => {
      if (!d.startDate) return;
      const date = new Date(d.startDate);
      if (isNaN(date.getTime())) return;

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      unique.set(key, label);
    });
    return Array.from(unique.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [demands]);

  // --- Opções dinâmicas para filtros avançados ---
  const availableTrainingLocals = useMemo(() =>
    [...new Set(demands.map(d => d.trainingLocal).filter((v): v is string => !!v && v !== 'N/A'))].sort(),
  [demands]);

  const availableCorredores = useMemo(() =>
    [...new Set(demands.map(d => d.corredor).filter((v): v is string => !!v))].sort(),
  [demands]);

  const availableStates = useMemo(() =>
    [...new Set(demands.map(d => d.demandState).filter((v): v is string => !!v))].sort(),
  [demands]);

  const handleMonthFilterChange = (val: string) => {
    if (!val) {
      setFilters(prev => ({ ...prev, startDate: '', endDate: '' }));
      return;
    }
    const [year, month] = val.split('-').map(Number);
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDayDate = new Date(year, month, 0);
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
    setFilters(prev => ({ ...prev, startDate: firstDay, endDate: lastDay }));
  };

  const getMonthSelectorValue = () => {
    if (!filters.startDate || !filters.endDate) return "";
    const [sY, sM, sD] = filters.startDate.split('-');
    const [eY, eM, eD] = filters.endDate.split('-');

    if (sY === eY && sM === eM && sD === '01') {
      const lastDay = new Date(Number(eY), Number(eM), 0).getDate();
      if (Number(eD) === lastDay) return `${sY}-${sM}`;
    }
    return "";
  };

  // --- Modalidade ---
  const normalizeModality = (raw: any) =>
    String(raw ?? '')
      .trim()
      .toUpperCase()
      .replaceAll('-', '')
      .replaceAll(' ', '');

  const getDemandModality = (d: Demand) => {
    const t = trainings.find(t => String(t.id) === String(d.trainingId));
    const raw = t?.modality ?? d.modality;
    return normalizeModality(raw);
  };

  const isOnlineDemand = (d: Demand) => {
    const m = getDemandModality(d);
    return m === 'ONLINE' || m === 'EAD';
  };

  // Helper de status calculado
  const getCalculatedStatus = (d: Demand) =>
    calculateDemandStatus({
      startDate: d.startDate,
      endDate: d.endDate,
      instructorId: d.instructorId,
      cancelled: d.status === 'CANCELADA',
      trainingLocal: d.trainingLocal,
      modality: getDemandModality(d),
    } as any);

  // --- Processamento de Dados Base ---
  const filteredDemands = useMemo(() => {
    return demands.filter(d => {
      const currentStatus = getCalculatedStatus(d);

      // ✅ Filtro por período: usa demandIntersectsRange para suportar dias específicos
      if (filters.startDate || filters.endDate) {
        if (!demandIntersectsRange(d, filters.startDate || undefined, filters.endDate || undefined)) return false;
      }

      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;
      if (filters.status && currentStatus !== filters.status) return false;
      if (filters.trainingLocal && (d.trainingLocal ?? '') !== filters.trainingLocal) return false;
      if (filters.corredor && (d.corredor ?? '') !== filters.corredor) return false;
      if (filters.demandState && (d.demandState ?? '') !== filters.demandState) return false;

      return true;
    });
  }, [demands, filters, trainings]);

  const filteredMeasurements = useMemo(() => {
    const demandIds = new Set(filteredDemands.map(d => d.id));
    return measurements.filter(m => demandIds.has(m.demandId));
  }, [measurements, filteredDemands]);

  // ✅ Helpers: lê status do Supabase logistic_allocations
  const isCarOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    const mode = String(alloc.transport_mode ?? '').toUpperCase();
    if (mode === 'NAO_NECESSARIO') return true;
    return alloc.has_car === true;
  };

  const isHotelOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    const mode = String(alloc.lodging_mode ?? '').toUpperCase();
    if (mode === 'NAO_NECESSARIO') return true;
    return alloc.has_hotel === true;
  };

  // ✅ ALTERAÇÃO: PDFs SEM alloc = pendente (false)
  const isReleaseOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return false;
    return alloc.has_release_pdf === true;
  };

  const isListOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return false;
    return alloc.has_class_list_pdf === true;
  };

  const isMaterialOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    return alloc.has_material === true;
  };

  // --- Lógica de Pendências Logísticas (SOMENTE STATUS DO CONTROLE) ---
// --- Lógica de Pendências Logísticas (SOMENTE STATUS DO CONTROLE) ---
const pendingLogisticsDemands = useMemo(() => {
  // enquanto carrega, não calcula (evita piscar)
  if (isLoadingPendencies) return [];

  return filteredDemands.filter(d => {
    // regras gerais (mantém)
    if (isOnlineDemand(d)) return false;

    const status = getCalculatedStatus(d);
    if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;

    // ✅ fonte da verdade: Controle Logístico
    const alloc = logisticsByDemandId?.[normId(d.id)];

    // se não existe controle logístico ainda, NÃO entra como pendência
    // (senão vai piscar / dar falso positivo)
    if (!alloc) return false;

    const overall = String(alloc.overall_status ?? 'PENDENTE').toUpperCase();
    return overall !== 'CONCLUIDA';
  });
}, [filteredDemands, logisticsByDemandId, isLoadingPendencies]);




  // --- Pendências de Evidências (só conta após CONCLUSÃO) ---
  const pendingEvidenceDemands = useMemo(() => {
    return filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);

      // só após conclusão
      if (status !== 'CONCLUIDA') return false;

      // ONLINE/EAD não conta
      if (isOnlineDemand(d)) return false;

      const evStatus = getEvidenceAutoStatus(d.id);
      return evStatus !== 'COMPLETA';
    });
  }, [filteredDemands, trainings, getEvidenceAutoStatus]);

  // --- Helpers de Cálculo ---
  const getTrainingHours = (trainingId: string) => trainings.find(t => t.id === trainingId)?.hours || 0;
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';

  const totalHours = useMemo(() => {
    return filteredDemands
      .filter(d => getCalculatedStatus(d) === 'CONCLUIDA')
      .reduce((acc: number, d) => acc + getTrainingHours(d.trainingId), 0);
  }, [filteredDemands, trainings]);

  const totalCosts = useMemo(() => {
    return filteredMeasurements.reduce((acc: number, m) => {
      return acc + m.attachments.reduce((sum: number, att) => {
        const val = typeof att.value === 'string' ? parseFloat(att.value.replace(',', '.')) : Number(att.value);
        return sum + (Number(val) || 0);
      }, 0);
    }, 0);
  }, [filteredMeasurements]);

  // --- Componentes de UI ---
  const KPICard = ({ title, value, subtext, icon: Icon, colorClass, isCurrency = false, isTrend = false }: any) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">{title}</p>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-black text-slate-800">
            {isCurrency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)) : value}
          </h3>
          {isTrend && <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-0.5"><TrendingUp size={10} /> +12%</span>}
        </div>
        {subtext && <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase flex items-center gap-1">{subtext}</p>}
      </div>
      <div className={`p-3 rounded-xl ${colorClass} group-hover:scale-110 transition-transform`}>
        <Icon size={20} />
      </div>
    </div>
  );

  const AlertBar = ({ message, type = 'warning', children, onMouseEnter, onMouseLeave }: { message: string, type?: 'warning' | 'error' | 'info', children?: React.ReactNode, onMouseEnter?: () => void, onMouseLeave?: () => void }) => {
    const styles = {
      warning: 'bg-amber-50 text-amber-700 border-amber-200',
      error: 'bg-red-50 text-red-700 border-red-200',
      info: 'bg-blue-50 text-blue-700 border-blue-200'
    };
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-bold ${styles[type]} transition-all hover:shadow-sm relative`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="flex items-center gap-3">
          {type === 'error' ? <ShieldAlert size={16} /> : (type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />)}
          <span>{message}</span>
        </div>
        {children}
      </div>
    );
  };

  const renderGeral = () => {
    const statusData = Object.keys(STATUS_LABELS).map(key => ({
      name: STATUS_LABELS[key],
      value: filteredDemands.filter(d => getCalculatedStatus(d) === key).length,
      color: (COLORS[key as keyof typeof COLORS] as string) || '#CBD5E1'
    })).filter(d => d.value > 0);

    const regionalData = regions.map(r => ({
      name: r.name,
      value: filteredDemands.filter(d => d.regionId === r.id).length
    })).sort((a, b) => b.value - a.value);

    // --- Dados para insights Local/Corredor/UF ---
    const buildTop = (extract: (d: Demand) => string, limit = 10) => {
      const counts: Record<string, number> = {};
      filteredDemands.forEach(d => {
        const v = (extract(d) ?? '').trim();
        if (!v) return;
        counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const items = sorted.slice(0, limit).map(([name, value]) => ({ name, value }));
      const othersDetail = sorted.slice(limit).map(([name, value]) => ({ name, value }));
      return { items, othersDetail };
    };

    const localData = buildTop(d => d.trainingLocal ?? '');
    const corredorData = buildTop(d => d.corredor ?? '');
    const ufData = buildTop(d => d.demandState ?? '');

    // REGRAS DE ALERTA OPERACIONAIS
    const noInstructorDemands = filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    });

    const noMeasurementDemands = filteredDemands.filter(d => {
      const isConcluido = getCalculatedStatus(d) === 'CONCLUIDA';
      const hasInstructor = !!d.instructorId;
      const measurement = measurements.find(m => m.demandId === d.id);
      const noMeasurement = !measurement || measurement.status === 'NAO_INICIADA';
      return isConcluido && hasInstructor && noMeasurement;
    });

    // DEMANDAS CANCELADAS
    const cancelledDemands = filteredDemands.filter(d => d.status === 'CANCELADA');

    return (
      <div className="space-y-6 animate-fade-in">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <KPICard title="Total de Demandas" value={filteredDemands.length} icon={Briefcase} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Horas Ministradas" value={`${totalHours}h`} icon={Clock} colorClass="bg-emerald-50 text-emerald-600" subtext="Execuções Finalizadas" />
          <KPICard title="Pendência de Alocação" value={noInstructorDemands.length} icon={AlertCircle} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Treinamentos Concluídos" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA').length} icon={CheckCircle} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Demandas Canceladas" value={cancelledDemands.length} icon={Ban} colorClass="bg-slate-100 text-slate-500" subtext="Histórico Inativo" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-between">
              <span>Distribuição de Status (Real)</span>
              <Target size={14} />
            </h3>
            <div className="flex-1 min-h-0">
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                      {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados de demandas</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-between">
              <span>Volume por Região</span>
              <MapPin size={14} />
            </h3>
            <div className="flex-1 min-h-0">
              {filteredDemands.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionalData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados regionais</div>
              )}
            </div>
          </div>
        </div>

        {/* --- INSIGHTS: Local / Corredor / UF --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Volume por Local do Treinamento */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Local</span>
              <div className="flex items-center gap-1.5">
                {localData.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded-md">
                    +{localData.othersDetail.length} ocultos
                  </span>
                )}
                <MapPin size={13} />
              </div>
            </h3>
            <RankedListChart
              items={localData.items}
              othersDetail={localData.othersDetail}
              barColor="bg-blue-500"
            />
          </div>

          {/* Volume por Corredor */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Corredor</span>
              <div className="flex items-center gap-1.5">
                {corredorData.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-emerald-50 text-emerald-400 px-1.5 py-0.5 rounded-md">
                    +{corredorData.othersDetail.length} ocultos
                  </span>
                )}
                <Truck size={13} />
              </div>
            </h3>
            <RankedListChart
              items={corredorData.items}
              othersDetail={corredorData.othersDetail}
              barColor="bg-emerald-500"
            />
          </div>

          {/* Volume por UF */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Estado (UF)</span>
              <div className="flex items-center gap-1.5">
                {ufData.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-amber-50 text-amber-400 px-1.5 py-0.5 rounded-md">
                    +{ufData.othersDetail.length} ocultos
                  </span>
                )}
                <Target size={13} />
              </div>
            </h3>
            <RankedListChart
              items={ufData.items}
              othersDetail={ufData.othersDetail}
              barColor="bg-amber-500"
            />
          </div>
        </div>

      </div>
    );
  };

  const renderOperacional = () => {
    const next7  = new Date(today.getTime() + 7  * 24 * 60 * 60 * 1000);
    const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const concluded  = filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA');
    const activeDmds = filteredDemands.filter(d => getCalculatedStatus(d) !== 'CANCELADA');
    const execRate   = activeDmds.length > 0 ? Math.round((concluded.length / activeDmds.length) * 100) : 0;
    const execColor  = execRate >= 70 ? '#10B981' : execRate >= 40 ? '#F59E0B' : '#EF4444';

    const noInstructor = filteredDemands.filter(d => {
      const s = getCalculatedStatus(d);
      if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    }).length;

    // Agenda 7 dias: em andamento OU com início nos próximos 7 dias (não canceladas/concluídas)
    const agenda7 = filteredDemands
      .filter(d => {
        const s = getCalculatedStatus(d);
        if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        const start = new Date(d.startDate);
        const end   = new Date(d.endDate);
        return start <= next7 && end >= today;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Top treinamentos no período
    const tCounts: Record<string, number> = {};
    filteredDemands.forEach(d => {
      const name = trainings.find(t => t.id === d.trainingId)?.name;
      if (name) tCounts[name] = (tCounts[name] || 0) + 1;
    });
    const tSorted = Object.entries(tCounts).sort((a, b) => b[1] - a[1]);
    const topTrainings    = tSorted.slice(0, 8).map(([name, value]) => ({ name, value }));
    const othersTrainings = tSorted.slice(8).map(([name, value]) => ({ name, value }));

    // Ranking instrutores por demandas no período
    const iCounts: Record<string, number> = {};
    filteredDemands.filter(d => d.instructorId).forEach(d => {
      iCounts[d.instructorId!] = (iCounts[d.instructorId!] || 0) + 1;
    });
    const topInstructors = Object.entries(iCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, value]) => ({
        name: instructors.find(i => i.id === id)?.name || id,
        value
      }));

    // Modalidade
    const modalTotal = filteredDemands.length || 1;
    const modalities = [
      { label: 'Presencial', value: filteredDemands.filter(d => getDemandModality(d) === 'PRESENCIAL').length, color: 'bg-blue-500' },
      { label: 'Online / EAD', value: filteredDemands.filter(d => ['ONLINE','EAD'].includes(getDemandModality(d))).length, color: 'bg-emerald-500' },
      { label: 'Híbrido', value: filteredDemands.filter(d => getDemandModality(d) === 'HIBRIDO').length, color: 'bg-violet-500' },
    ].filter(m => m.value > 0);

    const STATUS_BADGE: Record<string, string> = {
      NOVA:        'bg-violet-100 text-violet-700',
      PENDENTE:    'bg-amber-100 text-amber-700',
      ALOCADA:     'bg-blue-100 text-blue-700',
      EM_ANDAMENTO:'bg-emerald-100 text-emerald-700',
      CONCLUIDA:   'bg-slate-100 text-slate-500',
      CANCELADA:   'bg-red-100 text-red-500',
    };

    return (
      <div className="space-y-6 animate-fade-in">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title="Aguardando Instrutor" value={noInstructor} icon={AlertCircle} colorClass="bg-orange-50 text-orange-600" />
          <KPICard title="Alocadas" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'ALOCADA').length} icon={Calendar} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Em Execução Hoje" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length} icon={Zap} colorClass="bg-emerald-50 text-emerald-600" />
          <KPICard title="Próximos 30 Dias" value={filteredDemands.filter(d => { const s = new Date(d.startDate); return s > today && s <= next30; }).length} icon={Clock} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Taxa de Execução" value={`${execRate}%`} icon={TrendingUp} colorClass="bg-teal-50 text-teal-600" subtext={`${concluded.length} de ${activeDmds.length} concluídas`} />
        </div>

        {/* Top Treinamentos + Demandas por Instrutor + Perfil do Período */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Top Treinamentos */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Top Treinamentos</span>
              <Package size={13} className="text-slate-300" />
            </h3>
            <RankedListChart items={topTrainings} othersDetail={othersTrainings} barColor="bg-violet-500" emptyLabel="Sem treinamentos no período" />
          </div>

          {/* Demandas por Instrutor */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Demandas por Instrutor</span>
              <UserCheck size={13} className="text-slate-300" />
            </h3>
            <RankedListChart items={topInstructors} othersDetail={[]} barColor="bg-blue-500" emptyLabel="Sem instrutores alocados" />
          </div>

          {/* Perfil do Período */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-5" style={{ minHeight: '22rem' }}>

            {/* Modalidade */}
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                <span>Modalidade</span>
                <MousePointer2 size={13} className="text-slate-300" />
              </h3>
              {modalities.length > 0 ? (
                <div className="space-y-2.5">
                  {modalities.map(m => (
                    <div key={m.label} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 w-24 shrink-0">{m.label}</span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${m.color}`} style={{ width: `${Math.round((m.value / modalTotal) * 100)}%` }} />
                      </div>
                      <span className="text-[10px] font-black text-slate-700 w-6 text-right shrink-0">{m.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-300 italic">Sem dados no período</p>
              )}
            </div>

            {/* Taxa de Execução — donut */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Taxa de Execução</h3>
              <div className="flex items-center gap-4">
                <div className="relative w-[72px] h-[72px] shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F1F5F9" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={execColor} strokeWidth="3.5"
                      strokeDasharray={`${execRate} ${100 - execRate}`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[13px] font-black text-slate-800">{execRate}%</span>
                  </div>
                </div>
                <div className="space-y-1.5 flex-1">
                  {[
                    { label: 'Concluídas', count: concluded.length, dot: 'bg-emerald-500' },
                    { label: 'Em andamento', count: filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length, dot: 'bg-blue-400' },
                    { label: 'Pendentes', count: filteredDemands.filter(d => ['NOVA','PENDENTE','ALOCADA'].includes(getCalculatedStatus(d))).length, dot: 'bg-amber-400' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.dot}`} />
                      <span className="text-[10px] font-bold text-slate-400">{row.label}</span>
                      <span className="text-[10px] font-black text-slate-700 ml-auto">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agenda dos Próximos 7 Dias */}
        {(() => {
          const totalPages7 = Math.max(1, Math.ceil(agenda7.length / AGENDA7_PER_PAGE));
          const safePage7   = Math.min(agenda7Page, totalPages7);
          const startIdx7   = (safePage7 - 1) * AGENDA7_PER_PAGE;
          const pageItems7  = agenda7.slice(startIdx7, startIdx7 + AGENDA7_PER_PAGE);
          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Agenda dos Próximos 7 Dias</h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                    {agenda7.length} demanda{agenda7.length !== 1 ? 's' : ''} em execução ou com início previsto
                  </p>
                </div>
                <Calendar size={14} className="text-slate-300" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                      <th className="px-4 py-3 whitespace-nowrap">ID</th>
                      <th className="px-4 py-3 whitespace-nowrap">Início</th>
                      <th className="px-4 py-3 whitespace-nowrap">Empresa</th>
                      <th className="px-4 py-3 whitespace-nowrap">Treinamento</th>
                      <th className="px-4 py-3 whitespace-nowrap">Instrutor</th>
                      <th className="px-4 py-3 whitespace-nowrap">Local</th>
                      <th className="px-4 py-3 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pageItems7.length > 0 ? pageItems7.map(d => {
                      const cStatus    = getCalculatedStatus(d);
                      const instructor = instructors.find(i => i.id === d.instructorId);
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 text-[11px] font-black text-blue-600 font-mono whitespace-nowrap">{d.id}</td>
                          <td className="px-4 py-3 text-[11px] font-bold text-slate-600 whitespace-nowrap">
                            {new Date(d.startDate).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-4 py-3 text-[11px] font-bold text-slate-700 max-w-[140px] truncate" title={companies.find(c => c.id === d.companyId)?.name}>
                            {companies.find(c => c.id === d.companyId)?.name || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 max-w-[200px] truncate" title={trainings.find(t => t.id === d.trainingId)?.name}>
                            {trainings.find(t => t.id === d.trainingId)?.name || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 whitespace-nowrap">
                            {instructor
                              ? instructor.name.split(' ').slice(0, 2).join(' ')
                              : <span className="text-amber-500 font-bold text-[10px] uppercase">Sem instrutor</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{d.trainingLocal || '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${STATUS_BADGE[cStatus] || 'bg-slate-100 text-slate-500'}`}>
                              {STATUS_LABELS[cStatus] || cStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-slate-300 italic text-xs uppercase font-bold">
                          Nenhuma demanda prevista nos próximos 7 dias.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={safePage7}
                totalPages={totalPages7}
                totalItems={agenda7.length}
                itemsPerPage={AGENDA7_PER_PAGE}
                startIdx={startIdx7}
                entityLabel="demandas"
                onPageChange={setAgenda7Page}
                onItemsPerPageChange={() => {}}
                hideSizeSelector
              />
            </div>
          );
        })()}

      </div>
    );
  };

  const renderInstrutores = () => {
    const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const activeInstructors = instructors.filter(i => i.status === 'ATIVO');

    // --- Workload (horas concluídas no período filtrado) ---
    const instructorWorkload = activeInstructors.map(inst => {
      const hours = filteredDemands
        .filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA')
        .reduce((sum: number, d) => sum + getTrainingHours(d.trainingId), 0);
      return { name: inst.name.split(' ')[0], hours };
    }).sort((a, b) => b.hours - a.hours).slice(0, 10).filter(i => i.hours > 0);

    // --- Risco de dependência ---
    const dependencyRisk = trainings.filter(t => t.status === 'ATIVO').map(t => ({
      name: t.nr || t.name.substring(0, 20),
      fullName: t.name,
      count: instructors.filter(i => i.skills.some(s => s.trainingId === t.id && s.level >= 3)).length,
    })).filter(r => r.count <= 1).sort((a, b) => a.count - b.count).slice(0, 10);

    // --- Disponibilidade nos próximos 30 dias ---
    const busyNext30Ids = new Set(
      demands.filter(d => {
        const s = getCalculatedStatus(d);
        if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        if (!d.instructorId) return false;
        const start = new Date(d.startDate);
        const end   = new Date(d.endDate);
        return end >= today && start <= next30;
      }).map(d => d.instructorId!)
    );
    const availableNext30 = activeInstructors.filter(i => !busyNext30Ids.has(i.id));

    // --- Sem demanda no período filtrado ---
    const instructorsWithDemandIds = new Set(
      filteredDemands.filter(d => d.instructorId).map(d => d.instructorId!)
    );
    const noDemandsInPeriod = activeInstructors.filter(i => !instructorsWithDemandIds.has(i.id));

    // --- Taxa de reaproveitamento (múltiplos treinamentos distintos concluídos) ---
    const reuseStats = activeInstructors.map(inst => {
      const distinct = new Set(
        demands
          .filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA')
          .map(d => d.trainingId)
      );
      return { inst, count: distinct.size };
    }).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const reuseRate = activeInstructors.length > 0
      ? Math.round((reuseStats.filter(x => x.count >= 2).length / activeInstructors.length) * 100)
      : 0;
    const topReuseItems    = reuseStats.slice(0, 8).map(x => ({ name: x.inst.name.split(' ').slice(0, 2).join(' '), value: x.count }));
    const othersReuseItems = reuseStats.slice(8).map(x => ({ name: x.inst.name.split(' ').slice(0, 2).join(' '), value: x.count }));

    // --- Distribuição geográfica: instrutores habilitados vs demandas por região ---
    const geoData = regions.map(r => ({
      region: r.name,
      instructors: activeInstructors.filter(i => i.regionIds?.includes(r.id)).length,
      demands: filteredDemands.filter(d => d.regionId === r.id).length,
    })).filter(g => g.instructors > 0 || g.demands > 0).sort((a, b) => b.demands - a.demands);
    const geoMaxDemands = Math.max(...geoData.map(x => x.demands), 1);
    const geoMaxInstr   = Math.max(...geoData.map(x => x.instructors), 1);

    // --- Cobertura de competências por categoria ---
    const trainingCategories = [...new Set(trainings.filter(t => t.status === 'ATIVO').map(t => t.category))];
    const competenceCoverage = trainingCategories.map(cat => {
      const catTrainings = trainings.filter(t => t.category === cat && t.status === 'ATIVO');
      const aptCount     = activeInstructors.filter(i =>
        catTrainings.some(t => i.skills.some(s => s.trainingId === t.id && s.level >= 3))
      ).length;
      const demandCount  = filteredDemands.filter(d => catTrainings.some(t => t.id === d.trainingId)).length;
      const ratio        = demandCount > 0 ? aptCount / demandCount : aptCount > 0 ? 99 : 0;
      const barPct       = Math.min(100, Math.round(Math.min(ratio, 1) * 100));
      const shortCat     = String(cat)
        .replace('Segurança do Trabalho', 'Seg. Trabalho')
        .replace('Manutenção Industrial', 'Manut. Industrial')
        .replace('Operação de Equipamentos', 'Op. Equipamentos')
        .replace('Operação Ferroviária', 'Op. Ferroviária')
        .replace('Treinamentos Comportamentais', 'Comportamental');
      return { category: shortCat, aptCount, demandCount, ratio, barPct };
    }).sort((a, b) => b.demandCount - a.demandCount).filter(c => c.demandCount > 0 || c.aptCount > 0);

    return (
      <div className="space-y-6 animate-fade-in">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KPICard title="Ativos" value={activeInstructors.length} icon={Users} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Disponíveis (30d)" value={availableNext30.length} icon={Calendar} colorClass="bg-emerald-50 text-emerald-600" subtext="Sem alocação prevista" />
          <KPICard title="Sem Demanda" value={noDemandsInPeriod.length} icon={AlertCircle} colorClass="bg-amber-50 text-amber-600" subtext="No período filtrado" />
          <KPICard title="Reaproveitamento" value={`${reuseRate}%`} icon={TrendingUp} colorClass="bg-violet-50 text-violet-600" subtext="Com ≥ 2 tipos concluídos" />
          <KPICard title="Risco Dependência" value={dependencyRisk.length} icon={ShieldAlert} colorClass="bg-red-50 text-red-600" subtext="Treinamentos c/ ≤ 1 instr." />
          <KPICard title="Produtividade Global" value={`${totalHours}h`} icon={Award} colorClass="bg-indigo-50 text-indigo-600" subtext="Horas concluídas" />
        </div>

        {/* Top Performance + Risco Dependência */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between shrink-0">
              <span>Top Performance — Horas Ministradas</span>
              <Award size={13} className="text-slate-300" />
            </h3>
            <div className="flex-1 min-h-0">
              {instructorWorkload.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={instructorWorkload} margin={{ top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} formatter={(v: number) => [`${v}h`, 'Horas']} />
                    <Bar dataKey="hours" fill="#10B981" radius={[4, 4, 0, 0]} barSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem horas concluídas no período</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 shrink-0">Risco de Dependência</h3>
            {dependencyRisk.length === 0
              ? <p className="text-[11px] text-slate-300 italic mt-2">Nenhum risco crítico identificado ✅</p>
              : (
                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                  {dependencyRisk.map((risk, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-red-200 transition-colors">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-700 truncate uppercase tracking-tight" title={risk.fullName}>{risk.name}</p>
                        <p className="text-[9px] text-slate-400 font-bold">{risk.count === 0 ? 'NENHUM INSTRUTOR APTO' : 'APENAS 1 INSTRUTOR APTO'}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black ${risk.count === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                        {risk.count}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>

        {/* Disponibilidade + Sem Demanda no Período */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Disponíveis nos Próximos 30 Dias</h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                  {availableNext30.length} instrutor{availableNext30.length !== 1 ? 'es' : ''} sem alocação prevista
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-black ${availableNext30.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                {availableNext30.length}
              </span>
            </div>
            {availableNext30.length > 0 ? (
              <div className="p-4 max-h-52 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {availableNext30.map(i => (
                    <div key={i.id} className="flex items-center gap-2 p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{i.name.split(' ').slice(0, 2).join(' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">Todos os instrutores possuem alocação prevista.</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Sem Demanda no Período</h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                  {noDemandsInPeriod.length} instrutor{noDemandsInPeriod.length !== 1 ? 'es' : ''} sem participação no filtro ativo
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-black ${noDemandsInPeriod.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {noDemandsInPeriod.length}
              </span>
            </div>
            {noDemandsInPeriod.length > 0 ? (
              <div className="p-4 max-h-52 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {noDemandsInPeriod.map(i => (
                    <div key={i.id} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{i.name.split(' ').slice(0, 2).join(' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[11px] text-emerald-500 font-bold">Todos os instrutores ativos participaram do período ✅</p>
            )}
          </div>
        </div>

        {/* Reaproveitamento + Distribuição Geográfica */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between shrink-0">
              <span>Reaproveitamento de Instrutores</span>
              <TrendingUp size={13} className="text-slate-300" />
            </h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-3 shrink-0">Nº de treinamentos distintos ministrados (histórico completo)</p>
            <RankedListChart items={topReuseItems} othersDetail={othersReuseItems} barColor="bg-violet-500" emptyLabel="Sem histórico de execuções" />
          </div>

          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between shrink-0">
              <span>Distribuição Geográfica</span>
              <MapPin size={13} className="text-slate-300" />
            </h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-4 shrink-0">Instrutores habilitados vs demandas por região (período filtrado)</p>
            {geoData.length > 0 ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {geoData.map((g, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-700 truncate max-w-[200px]" title={g.region}>{g.region}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] text-blue-600 font-black">{g.instructors} instr.</span>
                        <span className="text-[10px] text-emerald-600 font-black">{g.demands} dem.</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((g.instructors / geoMaxInstr) * 100)}%` }} />
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round((g.demands / geoMaxDemands) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-1.5 rounded-full bg-blue-400" /><span className="text-[9px] font-bold text-slate-400 uppercase">Instrutores</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-1.5 rounded-full bg-emerald-400" /><span className="text-[9px] font-bold text-slate-400 uppercase">Demandas</span></div>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-300 italic">Sem dados regionais disponíveis.</p>
            )}
          </div>
        </div>

        {/* Cobertura de Competências por Categoria */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Cobertura de Competências por Categoria</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                Instrutores aptos (nível ≥ 3) vs volume de demandas por categoria no período
              </p>
            </div>
            <Target size={14} className="text-slate-300" />
          </div>
          {competenceCoverage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                    <th className="px-5 py-3 whitespace-nowrap">Categoria</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Instrutores Aptos</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Demandas no Período</th>
                    <th className="px-5 py-3 whitespace-nowrap">Cobertura</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {competenceCoverage.map((row, idx) => {
                    const statusCls   = row.ratio === 0 ? 'bg-red-100 text-red-600' : row.ratio < 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
                    const statusLabel = row.ratio === 0 ? 'Crítico' : row.ratio < 0.5 ? 'Alerta' : 'OK';
                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 text-[11px] font-black text-slate-700 whitespace-nowrap">{row.category}</td>
                        <td className="px-5 py-3 text-[11px] font-bold text-blue-600 text-right whitespace-nowrap">{row.aptCount}</td>
                        <td className="px-5 py-3 text-[11px] font-bold text-slate-600 text-right whitespace-nowrap">{row.demandCount}</td>
                        <td className="px-5 py-3 min-w-[160px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${row.ratio >= 0.5 ? 'bg-emerald-400' : row.ratio > 0 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${row.barPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-black text-slate-500 shrink-0 w-8 text-right">{row.barPct}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${statusCls}`}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">Sem dados de competência disponíveis.</p>
          )}
        </div>

      </div>
    );
  };

  const renderClientes = () => {
    const clientData = companies.map(c => ({
      name: c.name,
      volume: filteredDemands.filter(d => d.companyId === c.id).length
    })).sort((a, b) => b.volume - a.volume).slice(0, 8).filter(c => c.volume > 0);

    const trainingCategoryData: { name: string; value: number }[] = Object.entries(
      trainings.reduce((acc, t) => {
        const count = filteredDemands.filter(d => d.trainingId === t.id).length;
        acc[t.category] = (acc[t.category] || 0) + count;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, value]) => ({
      name: String(name),
      value: value as number
    })).sort((a, b) => b.value - a.value).filter(v => v.value > 0);

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Clientes mais Ativos (Volume)</h3>
            <div className="flex-1 min-h-0">
              {clientData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientData} layout="vertical" margin={{ left: 40, right: 40 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <Tooltip />
                    <Bar dataKey="volume" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem demandas ativas</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Treinamentos por Categoria</h3>
            <div className="flex-1 min-h-0">
              {trainingCategoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={trainingCategoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" stroke="none">
                      {trainingCategoryData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i % COLORS.CHART_PALETTE.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const renderCustos = () => {
    const sumAttachments = (ms: any[], category: any): number => {
      return ms.reduce((acc: number, m) => {
        const filtered = m.attachments.filter((a: any) => {
          return Array.isArray(category) ? category.includes(a.category) : a.category === category;
        });

        return acc + filtered.reduce((s: number, a: any) => {
          const val = typeof a.value === 'string' ? parseFloat(a.value.replace(',', '.')) : Number(a.value);
          return s + (val || 0);
        }, 0);
      }, 0);
    };

    const expenseData: { name: string; value: number }[] = [
      { name: 'Hospedagem', value: sumAttachments(filteredMeasurements, 'HOSPEDAGEM') },
      { name: 'Locomoção', value: sumAttachments(filteredMeasurements, 'LOCOMOCAO') },
      { name: 'Alimentação', value: sumAttachments(filteredMeasurements, ['CAFE', 'ALMOCO', 'JANTAR']) },
      { name: 'Outros', value: sumAttachments(filteredMeasurements, 'OUTROS') },
    ].filter(e => e.value > 0);

    const clientCosts = companies.map((c): { name: string; cost: number } => {
      const mIds = new Set(filteredDemands.filter(d => d.companyId === c.id).map(d => d.id));
      const relevantMeasurements = measurements.filter(m => mIds.has(m.demandId));

      const cost: number = relevantMeasurements.reduce((acc: number, m) => {
        return acc + m.attachments.reduce((sum: number, a: any) => {
          const val = typeof a.value === 'string' ? parseFloat(a.value.replace(',', '.')) : Number(a.value);
          return sum + (val || 0);
        }, 0);
      }, 0);

      return { name: c.name, cost };
    })
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)
      .filter(c => c.cost > 0);

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPICard title="Total em Despesas" value={totalCosts} isCurrency icon={DollarSign} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Ticket Médio/Demanda" value={totalCosts / (filteredDemands.length || 1)} isCurrency icon={Zap} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Medições Pendentes" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA' && measurements.find(m => m.demandId === d.id)?.status === 'NAO_INICIADA').length} icon={Clock} colorClass="bg-orange-50 text-orange-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-80 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Mix de Despesas</h3>
            <div className="flex-1 min-h-0">
              {expenseData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" stroke="none">
                      {expenseData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i]} />)}
                    </Pie>
                    <Tooltip formatter={(val: number) => formatCurrency(val)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem custos registrados</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-80 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Faturamento Bruto por Cliente</h3>
            <div className="flex-1 min-h-0">
              {clientCosts.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientCosts}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(val: number) => formatCurrency(val)} />
                    <Bar dataKey="cost" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Dashboard Gerencial</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">BI & Inteligência Operacional Colabor</p>
        </div>

        <div className="flex flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
          {[
            { id: 'GERAL', label: 'Visão Geral', icon: Target },
            { id: 'OPERACIONAL', label: 'Operacional', icon: Truck },
            { id: 'INSTRUTORES', label: 'Instrutores', icon: Award },
            { id: 'CLIENTES', label: 'Clientes', icon: Building2 },
            { id: 'CUSTOS', label: 'Custos', icon: DollarSign }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 ${activeTab === tab.id
                ? 'bg-slate-900 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros Globais */}
      <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-slate-200">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[160px]">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Calendar size={10} /> Período (Mês/Ano)</label>
            <select
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white capitalize"
              value={getMonthSelectorValue()}
              onChange={(e) => handleMonthFilterChange(e.target.value)}
            >
              <option value="">Todos</option>
              {availableMonths.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Calendar size={10} /> Intervalo Customizado</label>
            <div className="flex gap-2">
              <input type="date" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner bg-slate-50/50" value={filters.startDate} onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))} />
              <input type="date" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner bg-slate-50/50" value={filters.endDate} onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))} />
            </div>
          </div>

          <div className="min-w-[160px]">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Building2 size={10} /> Empresa</label>
            <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.companyId} onChange={e => setFilters(prev => ({ ...prev, companyId: e.target.value }))}>
              <option value="">Todas</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="min-w-[160px]">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin size={10} /> Região</label>
            <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.regionId} onChange={e => setFilters(prev => ({ ...prev, regionId: e.target.value }))}>
              <option value="">Todas</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div className="min-w-[160px]">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Filter size={10} /> Status (Real)</label>
            <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setFilters({ startDate: '', endDate: '', companyId: '', regionId: '', status: '', trainingLocal: '', corredor: '', demandState: '' })}
            className="px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors"
          >
            Limpar
          </button>
        </div>

        {/* Toggle Filtros Avançados */}
        <button
          onClick={() => setShowAdvancedFilters(prev => !prev)}
          className="mt-3 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors flex items-center gap-1"
        >
          {showAdvancedFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showAdvancedFilters ? 'Ocultar Filtros Avançados' : 'Mostrar Filtros Avançados'}
          {(filters.trainingLocal || filters.corredor || filters.demandState) && (
            <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[8px]">Ativo</span>
          )}
        </button>

        {showAdvancedFilters && (
          <div className="flex flex-wrap gap-4 items-end mt-3 pt-3 border-t border-slate-100">
            <div className="min-w-[160px]">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin size={10} /> Local do Treinamento</label>
              <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingLocal} onChange={e => setFilters(prev => ({ ...prev, trainingLocal: e.target.value }))}>
                <option value="">Todos</option>
                {availableTrainingLocals.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div className="min-w-[160px]">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Truck size={10} /> Corredor</label>
              <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.corredor} onChange={e => setFilters(prev => ({ ...prev, corredor: e.target.value }))}>
                <option value="">Todos</option>
                {availableCorredores.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div className="min-w-[160px]">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Target size={10} /> Estado (UF)</label>
              <select className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.demandState} onChange={e => setFilters(prev => ({ ...prev, demandState: e.target.value }))}>
                <option value="">Todos</option>
                {availableStates.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-[500px]">
        {activeTab === 'GERAL' && renderGeral()}
        {activeTab === 'OPERACIONAL' && renderOperacional()}
        {activeTab === 'INSTRUTORES' && renderInstrutores()}
        {activeTab === 'CLIENTES' && renderClientes()}
        {activeTab === 'CUSTOS' && renderCustos()}
      </div>
    </div>
  );
};

export default Dashboard;
