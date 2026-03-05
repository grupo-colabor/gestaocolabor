import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import {
  Bell, FileText, AlertTriangle, DollarSign, Ban,
  ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { calculateDemandStatus } from '../domain/demandStatus';
import {
  fetchLogisticAllocations,
  LogisticAllocationRow
} from '../services/logisticAllocations';

const Notifications: React.FC = () => {
  const { demands, companies, trainings, measurements, getEvidenceAutoStatus } = useApp();

  const normId = (v: any) => String(v ?? '').trim().replace(/^#/, '');

  const [logisticsByDemandId, setLogisticsByDemandId] = useState<Record<string, LogisticAllocationRow>>({});
  const [isLoadingPendencies, setIsLoadingPendencies] = useState(true);
  const [showCancelledList, setShowCancelledList] = useState(false);

  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';

  const normalizeModality = (raw: any) =>
    String(raw ?? '').trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

  const getDemandModality = (d: any) => {
    const t = trainings.find(t => String(t.id) === String(d.trainingId));
    return normalizeModality(t?.modality ?? d.modality);
  };

  const isOnlineDemand = (d: any) => {
    const m = getDemandModality(d);
    return m === 'ONLINE' || m === 'EAD';
  };

  const getCalculatedStatus = (d: any) =>
    calculateDemandStatus({
      startDate: d.startDate,
      endDate: d.endDate,
      instructorId: d.instructorId,
      cancelled: d.status === 'CANCELADA',
      trainingLocal: d.trainingLocal,
      modality: getDemandModality(d),
    } as any);

  const syncLogistics = useCallback(async () => {
    setIsLoadingPendencies(true);
    try {
      const rows = await fetchLogisticAllocations();
      const map: Record<string, LogisticAllocationRow> = {};
      for (const r of rows || []) {
        const key = normId(r?.demand_id);
        if (key) map[key] = r;
      }
      setLogisticsByDemandId(map);
    } catch {
      setLogisticsByDemandId({});
    } finally {
      setIsLoadingPendencies(false);
    }
  }, []);

  useEffect(() => { syncLogistics(); }, [syncLogistics]);

  useEffect(() => {
    const onFocus = () => syncLogistics();
    const onVisibility = () => { if (!document.hidden) syncLogistics(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncLogistics]);

  // --- Blocos de alertas ---
  const activeDemands = useMemo(() =>
    demands.filter(d => {
      const s = getCalculatedStatus(d);
      return s !== 'CANCELADA';
    }), [demands, trainings]);

  const pendingLogistics = useMemo(() => {
    if (isLoadingPendencies) return [];
    return activeDemands.filter(d => {
      if (isOnlineDemand(d)) return false;
      const status = getCalculatedStatus(d);
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;
      const alloc = logisticsByDemandId[normId(d.id)];
      if (!alloc) return false;
      return String(alloc.overall_status ?? 'PENDENTE').toUpperCase() !== 'CONCLUIDA';
    });
  }, [activeDemands, logisticsByDemandId, isLoadingPendencies, trainings]);

  const pendingEvidences = useMemo(() =>
    demands.filter(d => {
      if (getCalculatedStatus(d) !== 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return getEvidenceAutoStatus(d.id) !== 'COMPLETA';
    }), [demands, trainings, getEvidenceAutoStatus]);

  const noInstructorDemands = useMemo(() =>
    activeDemands.filter(d => {
      const status = getCalculatedStatus(d);
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    }), [activeDemands, trainings]);

  const noMeasurementDemands = useMemo(() =>
    demands.filter(d => {
      if (getCalculatedStatus(d) !== 'CONCLUIDA') return false;
      if (!d.instructorId) return false;
      const m = measurements.find(m => m.demandId === d.id);
      return !m || m.status === 'NAO_INICIADA';
    }), [demands, measurements, trainings]);

  const cancelledDemands = useMemo(() =>
    demands.filter(d => d.status === 'CANCELADA'),
  [demands]);

  const totalAlerts = pendingLogistics.length + pendingEvidences.length + noInstructorDemands.length + noMeasurementDemands.length;

  // --- Card de alerta padronizado ---
  const AlertCard = ({
    title,
    subtitle,
    count,
    accentColor,
    icon: Icon,
    iconBg,
    iconColor,
    badgeClass,
    items,
    renderItem,
    loading = false,
  }: {
    title: string;
    subtitle: string;
    count: number;
    accentColor: string;
    icon: React.ElementType;
    iconBg: string;
    iconColor: string;
    badgeClass: string;
    items: any[];
    renderItem: (item: any) => React.ReactNode;
    loading?: boolean;
  }) => (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-l-4 ${accentColor}`}>
      <div className="p-5 flex items-center gap-4 border-b border-slate-100">
        <div className={`p-3 ${iconBg} rounded-xl shrink-0`}>
          <Icon size={20} className={iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">{title}</h3>
          <p className="text-xs font-bold text-slate-400 mt-0.5">
            {loading
              ? 'Carregando...'
              : count > 0
                ? subtitle
                : `Nenhuma pendência no momento ✅`}
          </p>
        </div>
        {!loading && count > 0 && (
          <span className={`shrink-0 text-[11px] font-black px-3 py-1 rounded-full ${badgeClass}`}>
            {count}
          </span>
        )}
      </div>

      {!loading && items.length > 0 && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.slice(0, 6).map((item, idx) => (
            <React.Fragment key={item.id ?? idx}>{renderItem(item)}</React.Fragment>
          ))}
          {count > 6 && (
            <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center col-span-full md:col-span-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                + {count - 6} outras pendências
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const DemandRow = ({ d, badge, badgeCls }: { d: any; badge: string; badgeCls: string }) => (
    <div key={d.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="w-2 h-2 rounded-full bg-current shrink-0 opacity-60" />
        <div className="overflow-hidden">
          <p className="text-[11px] font-black text-slate-700 truncate">
            <span className="text-blue-600 font-mono mr-1">#{d.id}</span>
            {getTrainingName(d.trainingId)}
          </p>
          <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{getCompanyName(d.companyId)}</p>
        </div>
      </div>
      <span className={`shrink-0 text-[9px] font-black px-2 py-1 rounded-lg uppercase ${badgeCls}`}>{badge}</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Notificações</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Central de Alertas e Pendências Operacionais
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalAlerts > 0 && (
            <span className="bg-red-100 text-red-600 text-xs font-black px-3 py-1.5 rounded-full uppercase tracking-wide">
              {totalAlerts} pendência{totalAlerts !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={syncLogistics}
            disabled={isLoadingPendencies}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoadingPendencies ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* --- Bloco 1: Pendências Logísticas --- */}
      <AlertCard
        title="Pendências Logísticas"
        subtitle={`${pendingLogistics.length} demanda${pendingLogistics.length !== 1 ? 's' : ''} aguardando tratativa operacional`}
        count={pendingLogistics.length}
        accentColor={pendingLogistics.length > 0 ? 'border-l-amber-400' : 'border-l-emerald-400'}
        icon={Bell}
        iconBg="bg-amber-50"
        iconColor="text-amber-500"
        badgeClass="bg-amber-100 text-amber-700"
        items={pendingLogistics}
        loading={isLoadingPendencies}
        renderItem={(d) => {
          const alloc = logisticsByDemandId[normId(d.id)];
          const overall = String(alloc?.overall_status ?? 'PENDENTE').toUpperCase();
          return (
            <DemandRow d={d} badge={overall} badgeCls="bg-amber-100 text-amber-700" />
          );
        }}
      />

      {/* --- Bloco 2: Pendências de Evidência --- */}
      <AlertCard
        title="Pendências de Evidência"
        subtitle={`${pendingEvidences.length} demanda${pendingEvidences.length !== 1 ? 's' : ''} concluída${pendingEvidences.length !== 1 ? 's' : ''} com evidência pendente`}
        count={pendingEvidences.length}
        accentColor={pendingEvidences.length > 0 ? 'border-l-indigo-400' : 'border-l-emerald-400'}
        icon={FileText}
        iconBg="bg-indigo-50"
        iconColor="text-indigo-500"
        badgeClass="bg-indigo-100 text-indigo-700"
        items={pendingEvidences}
        renderItem={(d) => (
          <DemandRow d={d} badge={getEvidenceAutoStatus(d.id)} badgeCls="bg-indigo-100 text-indigo-600" />
        )}
      />

      {/* --- Bloco 3: Aguardando Alocação de Instrutor --- */}
      <AlertCard
        title="Aguardando Alocação de Instrutor"
        subtitle={`${noInstructorDemands.length} demanda${noInstructorDemands.length !== 1 ? 's' : ''} sem instrutor alocado`}
        count={noInstructorDemands.length}
        accentColor={noInstructorDemands.length > 0 ? 'border-l-orange-400' : 'border-l-emerald-400'}
        icon={AlertTriangle}
        iconBg="bg-orange-50"
        iconColor="text-orange-500"
        badgeClass="bg-orange-100 text-orange-700"
        items={noInstructorDemands}
        renderItem={(d) => (
          <DemandRow
            d={d}
            badge={new Date(d.startDate).toLocaleDateString('pt-BR')}
            badgeCls="bg-orange-100 text-orange-600"
          />
        )}
      />

      {/* --- Bloco 4: Medições Pendentes --- */}
      <AlertCard
        title="Medições Administrativas Pendentes"
        subtitle={`${noMeasurementDemands.length} demanda${noMeasurementDemands.length !== 1 ? 's' : ''} concluída${noMeasurementDemands.length !== 1 ? 's' : ''} sem medição iniciada`}
        count={noMeasurementDemands.length}
        accentColor={noMeasurementDemands.length > 0 ? 'border-l-blue-400' : 'border-l-emerald-400'}
        icon={DollarSign}
        iconBg="bg-blue-50"
        iconColor="text-blue-500"
        badgeClass="bg-blue-100 text-blue-700"
        items={noMeasurementDemands}
        renderItem={(d) => (
          <DemandRow
            d={d}
            badge={`Fim: ${new Date(d.endDate).toLocaleDateString('pt-BR')}`}
            badgeCls="bg-blue-100 text-blue-600"
          />
        )}
      />

      {/* --- Bloco 5: Demandas Canceladas --- */}
      {cancelledDemands.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-slate-300">
          <button
            onClick={() => setShowCancelledList(!showCancelledList)}
            className="w-full p-5 flex items-center gap-4 hover:bg-slate-50 transition text-left"
          >
            <div className="p-3 bg-slate-100 rounded-xl shrink-0">
              <Ban size={20} className="text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Demandas Canceladas</h3>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                {cancelledDemands.length} demanda{cancelledDemands.length !== 1 ? 's' : ''} cancelada{cancelledDemands.length !== 1 ? 's' : ''} no histórico
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {showCancelledList ? 'Ocultar' : 'Ver Lista'}
              </span>
              {showCancelledList ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </div>
          </button>

          {showCancelledList && (
            <div className="px-5 pb-5 space-y-2 max-h-64 overflow-y-auto">
              {cancelledDemands.map(d => (
                <div key={d.id} className="flex items-center justify-between text-[11px] bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded shrink-0">#{d.id}</span>
                    <span className="truncate font-bold text-slate-700">{getTrainingName(d.trainingId)}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-3">
                    <span className="text-slate-400 uppercase text-[9px] font-black">{getCompanyName(d.companyId)}</span>
                    <span className="text-[9px] font-bold text-slate-300">{new Date(d.startDate).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Notifications;
