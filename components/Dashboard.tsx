import React, { useState, useMemo } from 'react';
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

const Dashboard: React.FC = () => {
  const { demands, companies, regions, instructors, trainings, measurements, getEvidenceAutoStatus } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('GERAL');
  const [showNoInstructorTooltip, setShowNoInstructorTooltip] = useState(false);
  const [showNoMeasurementTooltip, setShowNoMeasurementTooltip] = useState(false);
  const [showCancelledList, setShowCancelledList] = useState(false);
  const today = new Date();

  // --- Filtros Globais ---
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    regionId: '',
    status: ''
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
      const start = filters.startDate ? new Date(filters.startDate) : null;
      const end = filters.endDate ? new Date(filters.endDate) : null;
      const dStart = new Date(d.startDate);
      const currentStatus = getCalculatedStatus(d);

      if (start && dStart < start) return false;
      if (end) {
        const endDay = new Date(end);
        endDay.setHours(23, 59, 59, 999);
        if (dStart > endDay) return false;
      }

      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;

      if (filters.status && currentStatus !== filters.status) return false;

      return true;
    });
  }, [demands, filters, trainings]);

  const filteredMeasurements = useMemo(() => {
    const demandIds = new Set(filteredDemands.map(d => d.id));
    return measurements.filter(m => demandIds.has(m.demandId));
  }, [measurements, filteredDemands]);

  // --- Lógica de Pendências Logísticas ---
  const pendingLogisticsDemands = useMemo(() => {
    return filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);

      if (isOnlineDemand(d)) return false;
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;

      const isHotelPending = d.logisticsHotel === null;
      const isTransportPending = d.logisticsTransport === null;
      const isMaterialPending = d.materialReady !== true;
      const isReleasePending = !d.attachments?.instructorReleasePdf;
      const isClassListPending = !d.attachments?.classListPdf;

      return (
        isHotelPending ||
        isTransportPending ||
        isMaterialPending ||
        isReleasePending ||
        isClassListPending
      );
    });
  }, [filteredDemands, trainings]);

  // --- Pendências de Evidências (só conta após CONCLUSÃO) ---
  const pendingEvidenceDemands = useMemo(() => {
    return filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);

      // ✅ só após conclusão
      if (status !== 'CONCLUIDA') return false;

      // ✅ ONLINE/EAD não conta como pendência de evidência
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

        {/* --- CARD DE ALERTA DE PENDÊNCIAS LOGÍSTICAS --- */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-amber-400">
          <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-50 rounded-full text-amber-500">
                <Bell size={24} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Demandas com Pendência Logística</h3>
                <p className="text-xs font-bold text-slate-400">
                  {pendingLogisticsDemands.length > 0
                    ? `${pendingLogisticsDemands.length} demandas aguardando tratativa operacional`
                    : "Nenhuma pendência logística no momento ✅"
                  }
                </p>
              </div>
            </div>
          </div>

          {pendingLogisticsDemands.length > 0 && (
            <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingLogisticsDemands.slice(0, 5).map(d => {
                const pendencies = [];
                if (d.logisticsTransport === null) pendencies.push(<span key="car" title="Transporte"><Car size={14} className="text-amber-500" /></span>);
                if (d.logisticsHotel === null) pendencies.push(<span key="hotel" title="Hospedagem"><Hotel size={14} className="text-amber-500" /></span>);
                if (d.materialReady === false) pendencies.push(<span key="mat" title="Material"><Package size={14} className="text-amber-500" /></span>);
                if (!d.attachments?.classListPdf) pendencies.push(<span key="list" title="Lista"><FileText size={14} className="text-amber-500" /></span>);
                if (!d.attachments?.instructorReleasePdf) pendencies.push(<span key="rel" title="Liberação"><UserCheck size={14} className="text-amber-500" /></span>);

                return (
                  <div key={d.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0"></div>
                      <div className="overflow-hidden">
                        <p className="text-[11px] font-black text-slate-700 truncate">
                          <span className="text-blue-600 font-mono mr-1">#{d.id}</span>
                          {getTrainingName(d.trainingId)}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 truncate uppercase">{getCompanyName(d.companyId)}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0 ml-3">
                      {pendencies}
                    </div>
                  </div>
                );
              })}
              {pendingLogisticsDemands.length > 5 && (
                <div className="p-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    + {pendingLogisticsDemands.length - 5} outras pendências
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* --- CARD DE ALERTA DE PENDÊNCIAS DE EVIDÊNCIA (APÓS CONCLUSÃO) --- */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-indigo-400">
          <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-full text-indigo-500">
                <FileText size={24} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Pendências de Evidência (Pós-Conclusão)</h3>
                <p className="text-xs font-bold text-slate-400">
                  {pendingEvidenceDemands.length > 0
                    ? `${pendingEvidenceDemands.length} demanda(s) concluída(s) com evidência pendente`
                    : "Nenhuma pendência de evidência ✅"
                  }
                </p>
              </div>
            </div>
          </div>

          {pendingEvidenceDemands.length > 0 && (
            <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingEvidenceDemands.slice(0, 5).map(d => (
                <div key={d.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between group">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shrink-0"></div>
                    <div className="overflow-hidden">
                      <p className="text-[11px] font-black text-slate-700 truncate">
                        <span className="text-blue-600 font-mono mr-1">#{d.id}</span>
                        {getTrainingName(d.trainingId)}
                      </p>
                      <p className="text-[9px] font-bold text-slate-400 truncate uppercase">
                        {getCompanyName(d.companyId)} • Fim: {new Date(d.endDate).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    <span className="px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-indigo-100 text-indigo-600">
                      {getEvidenceAutoStatus(d.id)}
                    </span>
                  </div>
                </div>
              ))}
              {pendingEvidenceDemands.length > 5 && (
                <div className="p-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    + {pendingEvidenceDemands.length - 5} outras pendências
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <KPICard title="Total de Demandas" value={filteredDemands.length} icon={Briefcase} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Horas Ministradas" value={`${totalHours}h`} icon={Clock} colorClass="bg-emerald-50 text-emerald-600" subtext="Execuções Finalizadas" />
          <KPICard title="Pendência de Alocação" value={noInstructorDemands.length} icon={AlertCircle} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Treinamentos Concluídos" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA').length} icon={CheckCircle} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Demandas Canceladas" value={cancelledDemands.length} icon={Ban} colorClass="bg-slate-100 text-slate-500" subtext="Histórico Inativo" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {noInstructorDemands.length > 0 && (
            <div className="relative group/alert">
              <AlertBar
                type="warning"
                message={`${noInstructorDemands.length} demanda(s) sem instrutor alocado.`}
                onMouseEnter={() => setShowNoInstructorTooltip(true)}
                onMouseLeave={() => setShowNoInstructorTooltip(false)}
              >
                <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 rounded-lg text-[10px] font-black uppercase transition-colors cursor-help">
                  Listar Pendências <Info size={12} />
                </div>
              </AlertBar>

              {showNoInstructorTooltip && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-amber-200 shadow-2xl rounded-2xl p-4 z-[200] animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex flex-col mb-3 border-b border-amber-50 pb-2">
                    <h4 className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-1.5">
                      <AlertTriangle size={12} /> Aguardando Alocação Técnica
                    </h4>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {noInstructorDemands.map(d => (
                      <div key={d.id} className="p-2 bg-slate-50 rounded-lg border border-slate-100 flex justify-between items-center">
                        <span className="text-[10px] font-black text-blue-600 font-mono">#{d.id}</span>
                        <span className="text-[11px] font-bold text-slate-700 truncate flex-1 px-3">{getTrainingName(d.trainingId)}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(d.startDate).toLocaleDateString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {noMeasurementDemands.length > 0 && (
            <div className="relative group/alert">
              <AlertBar
                type="info"
                message={`${noMeasurementDemands.length} demanda(s) concluída(s) sem medição.`}
                onMouseEnter={() => setShowNoMeasurementTooltip(true)}
                onMouseLeave={() => setShowNoMeasurementTooltip(false)}
              >
                <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 rounded-lg text-[10px] font-black uppercase transition-colors cursor-help">
                  Ver Medições <Info size={12} />
                </div>
              </AlertBar>

              {showNoMeasurementTooltip && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-blue-200 shadow-2xl rounded-2xl p-4 z-[200] animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex flex-col mb-3 border-b border-blue-50 pb-2">
                    <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5">
                      <DollarSign size={12} /> Medições Administrativas Pendentes
                    </h4>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                    {noMeasurementDemands.map(d => (
                      <div key={d.id} className="p-2 bg-slate-50 rounded-lg border border-slate-100 flex justify-between items-center">
                        <span className="text-[10px] font-black text-blue-600 font-mono">#{d.id}</span>
                        <span className="text-[11px] font-bold text-slate-700 truncate flex-1 px-3">{getTrainingName(d.trainingId)}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Fim: {new Date(d.endDate).toLocaleDateString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bloco de Demandas Canceladas */}
        {cancelledDemands.length > 0 && (
          <div className="bg-slate-100/50 border border-slate-200 rounded-2xl p-4 transition-all">
            <button
              onClick={() => setShowCancelledList(!showCancelledList)}
              className="flex items-center justify-between w-full group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-200 rounded-lg text-slate-500">
                  <Info size={16} />
                </div>
                <div className="text-left">
                  <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Acompanhamento Gerencial</p>
                  <p className="text-[11px] font-bold text-slate-400">{cancelledDemands.length} demanda(s) cancelada(s)</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-400 group-hover:text-slate-600 transition-colors">
                <span className="text-[10px] font-black uppercase tracking-widest">{showCancelledList ? 'Ocultar' : 'Ver Lista'}</span>
                {showCancelledList ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {showCancelledList && (
              <div className="mt-4 space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1 border-t border-slate-200 pt-4 animate-fade-in">
                {cancelledDemands.map(d => (
                  <div key={d.id} className="flex items-center justify-between text-[11px] font-medium text-slate-600 bg-white/60 p-3 rounded-xl border border-slate-100 hover:border-slate-300 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">#{d.id}</span>
                      <span className="truncate font-bold text-slate-700">{getTrainingName(d.trainingId)}</span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-slate-400 uppercase text-[9px] font-black tracking-tight">{getCompanyName(d.companyId)}</span>
                      <span className="text-[9px] font-bold text-slate-300 italic">{new Date(d.startDate).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

      </div>
    );
  };

  const renderOperacional = () => {
    const inExecution = filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length;

    const modalityData = [
      { name: 'Presencial', value: filteredDemands.filter(d => getDemandModality(d) === 'PRESENCIAL').length },
      { name: 'Online', value: filteredDemands.filter(d => getDemandModality(d) === 'ONLINE').length },
      { name: 'Híbrido', value: filteredDemands.filter(d => getDemandModality(d) === 'HIBRIDO').length },
    ].filter(v => v.value > 0);

    const logisticsStats = [
      { name: 'C/ Hotel', value: filteredDemands.filter(d => d.accommodationType === 'Hotel').length },
      { name: 'S/ Hotel', value: filteredDemands.filter(d => d.accommodationType === 'N/A').length },
      { name: 'Carro Alugado', value: filteredDemands.filter(d => d.transportType === 'Carro Alugado').length },
      { name: 'Carro Próprio', value: filteredDemands.filter(d => d.transportType === 'Carro Próprio').length },
    ];

    const criticalList = filteredDemands
      .filter(d => {
        const status = getCalculatedStatus(d);
        return status !== 'CONCLUIDA' && status !== 'CANCELADA' && new Date(d.startDate) <= new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 5);

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard title="Aguardando Instrutor" value={filteredDemands.filter(d => { const status = getCalculatedStatus(d); if (status === 'CANCELADA' || status === 'CONCLUIDA') return false; if (isOnlineDemand(d)) return false; return !d.instructorId; }).length} icon={AlertCircle} colorClass="bg-orange-50 text-orange-600" />
          <KPICard title="Alocadas Futuras" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'ALOCADA').length} icon={Calendar} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Em Execução Hoje" value={inExecution} icon={Zap} colorClass="bg-emerald-50 text-emerald-600" />
          <KPICard title="Próximos 30 Dias" value={filteredDemands.filter(d => new Date(d.startDate) > today && new Date(d.startDate) <= new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)).length} icon={Clock} colorClass="bg-indigo-50 text-indigo-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 h-80 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Modalidade</h3>
            <div className="flex-1 min-h-0">
              {modalityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={modalityData} cx="50%" cy="50%" outerRadius={70} dataKey="value" stroke="none">
                      {modalityData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 h-80 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Perfil Logístico</h3>
            <div className="flex-1 min-h-0">
              {filteredDemands.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={logisticsStats} margin={{ left: 30, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                    <Bar dataKey="value" fill="#8B5CF6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem demandas registradas</div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">⚠️ Demandas Críticas (Próximas 7 dias)</h3>
            <MousePointer2 size={14} className="text-slate-300" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/30">
                <tr>
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">Data Início</th>
                  <th className="px-6 py-3">Empresa</th>
                  <th className="px-6 py-3">Treinamento</th>
                  <th className="px-6 py-3">Local</th>
                  <th className="px-6 py-3">Status Calculado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {criticalList.length > 0 ? criticalList.map(d => {
                  const cStatus = getCalculatedStatus(d);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition-colors text-xs font-medium text-slate-600">
                      <td className="px-6 py-3 font-bold text-blue-600">{d.id}</td>
                      <td className="px-6 py-3">{new Date(d.startDate).toLocaleDateString('pt-BR')}</td>
                      <td className="px-6 py-3 truncate max-w-[150px]">{companies.find(c => c.id === d.companyId)?.name}</td>
                      <td className="px-6 py-3 truncate max-w-[200px]">{trainings.find(t => t.id === d.trainingId)?.name}</td>
                      <td className="px-6 py-3 truncate max-w-[150px]">{d.trainingLocal}</td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${COLORS[cStatus as keyof typeof COLORS] ? 'bg-opacity-10' : 'bg-slate-100'}`} style={{ color: COLORS[cStatus as keyof typeof COLORS] as string }}>
                          {STATUS_LABELS[cStatus]}
                        </span>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic text-sm">Nenhuma demanda crítica identificada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderInstrutores = () => {
    const activeInstructors = instructors.filter(i => i.status === 'ATIVO');

    const instructorWorkload = activeInstructors.map(inst => {
      const hours = filteredDemands
        .filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA')
        .reduce((sum: number, d) => sum + getTrainingHours(d.trainingId), 0);
      return { name: inst.name.split(' ')[0], hours };
    }).sort((a, b) => b.hours - a.hours).slice(0, 10).filter(i => i.hours > 0);

    const dependencyRisk = trainings.filter(t => t.status === 'ATIVO').map(t => ({
      name: t.nr || t.name.substring(0, 15),
      count: instructors.filter(i => i.skills.some(s => s.trainingId === t.id && s.level >= 3)).length
    })).filter(r => r.count <= 1).sort((a, b) => a.count - b.count).slice(0, 10);

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard title="Instrutores Ativos" value={activeInstructors.length} icon={Users} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Risco Dependência" value={dependencyRisk.length} icon={ShieldAlert} colorClass="bg-red-50 text-red-600" subtext="Treinamentos c/ <= 1 Instr." />
          <KPICard title="Média Horas/Instr." value={`${(totalHours / (activeInstructors.length || 1)).toFixed(1)}h`} icon={TrendingUp} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Produtividade Global" value={`${totalHours}h`} icon={CheckCircle} colorClass="bg-emerald-50 text-emerald-600" subtext="Horas Totais Concluídas" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-between">
              <span>Top Performance (Horas Ministradas Reais)</span>
              <Award size={14} />
            </h3>
            <div className="flex-1 min-h-0">
              {instructorWorkload.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={instructorWorkload} margin={{ top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontStyle: 'normal', fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                    <Bar dataKey="hours" fill="#10B981" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem horas concluídas no período</div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Risco de Dependência (NRs críticas)</h3>
            <div className="flex-1 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar space-y-3">
              {dependencyRisk.map((risk, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 group hover:border-red-200 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-700 truncate uppercase tracking-tight">{risk.name}</p>
                    <p className="text-[9px] text-slate-400 font-bold">{risk.count === 0 ? 'NENHUM INSTRUTOR APTO' : 'APENAS 1 INSTRUTOR APTO'}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${risk.count === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                    {risk.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KPICard title="Total em Despesas" value={totalCosts} isCurrency icon={DollarSign} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Ticket Médio/Demanda" value={totalCosts / (filteredDemands.length || 1)} isCurrency icon={Zap} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Medições Pendentes" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA' && measurements.find(m => m.demandId === d.id)?.status === 'NAO_INICIADA').length} icon={Clock} colorClass="bg-orange-50 text-orange-600" />
          <div className="bg-slate-900 p-6 rounded-2xl shadow-xl flex items-center justify-between group hover:scale-[1.02] transition-transform cursor-pointer">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Exportar Fechamento</p>
              <h3 className="text-sm font-bold text-white uppercase tracking-tight">Relatório DOCX</h3>
            </div>
            <Download className="text-blue-400 group-hover:animate-bounce" />
          </div>
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
      <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-slate-200 flex flex-wrap gap-4 items-end">
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
          onClick={() => setFilters({ startDate: '', endDate: '', companyId: '', regionId: '', status: '' })}
          className="px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors"
        >
          Limpar
        </button>
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
