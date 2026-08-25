import React, { useState, useMemo } from 'react';
import { useApp } from '../App';
import {
  Bell, FileText, AlertTriangle, DollarSign, Ban,
  ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react';
import { calculateDemandStatus } from '../domain/demandStatus';
import { getDemandTitle, getDemandCompanyLabel, isInternalDemand } from '../domain/demandLabel';
import {
  hasPendingLogistics,
  hasPendingEvidence,
  isAwaitingInstructor,
  hasPendingMeasurement,
  demandListView,
  type DemandAlertContext,
} from '../domain/notificationAlerts';

const PREVIEW_COUNT = 6;

// Definido FORA de Notifications para que o React não remonte o componente
// a cada re-render do pai (o que causava scroll para o topo ao expandir/recolher).
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
  isExpanded,
  onToggle,
  customFooter,
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
  isExpanded: boolean;
  onToggle: () => void;
  customFooter?: React.ReactNode;
}) => {
  const visibleItems = isExpanded ? items : items.slice(0, PREVIEW_COUNT);
  const hiddenCount = items.length - PREVIEW_COUNT;

  return (
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
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleItems.map((item, idx) => (
              <React.Fragment key={item.id ?? idx}>{renderItem(item)}</React.Fragment>
            ))}
          </div>

          {customFooter ?? (
            <>
              {hiddenCount > 0 && !isExpanded && (
                <button
                  type="button"
                  onClick={onToggle}
                  className="mt-3 w-full p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center gap-2 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                >
                  <ChevronDown size={13} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-blue-500">
                    + {hiddenCount} outra{hiddenCount !== 1 ? 's' : ''} pendência{hiddenCount !== 1 ? 's' : ''}
                  </span>
                </button>
              )}
              {isExpanded && items.length > PREVIEW_COUNT && (
                <button
                  type="button"
                  onClick={onToggle}
                  className="mt-3 w-full p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors group"
                >
                  <ChevronUp size={13} className="text-slate-400 group-hover:text-slate-600" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600">
                    Recolher
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Badge INTERNA — mesmo estilo de Logística, Controle Logístico, Agenda e da
 * listagem de Medição.
 *
 * Fica colado no nome da empresa, e não no ID, pelo mesmo motivo que levou o
 * badge para lá na Medição: uma interna PODE ter empresa vinculada (acontece no
 * cliente), e aí a linha exibe "Vale S.A." igualzinho a uma demanda de cliente.
 * Sem o badge, as duas ficam indistinguíveis exatamente no caso ambíguo.
 */
const InternaBadge: React.FC<{ demand?: any }> = ({ demand }) => {
  if (!isInternalDemand(demand)) return null;
  return (
    <span className="bg-violet-100 text-violet-700 border border-violet-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest shrink-0">
      Interna
    </span>
  );
};

const Notifications: React.FC = () => {
  const {
    demands, companies, trainings, measurements, getEvidenceAutoStatus,
    setCurrentView, setNotificationTarget, logisticAllocations,
  } = useApp();

  const normId = (v: any) => String(v ?? '').trim().replace(/^#/, '');

  const [showCancelledList, setShowCancelledList] = useState(false);

  // Estado de expansão por bloco
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
  const toggleBlock = (key: string) =>
    setExpandedBlocks(prev => ({ ...prev, [key]: !prev[key] }));

  // Mesmos builders de Logística, Controle Logístico, Medição e Agenda. Numa
  // demanda interna o "treinamento" é `categoria — descrição` e a empresa vira
  // "Colabor (Interna)" quando não há empresa vinculada. Enquanto esta tela
  // resolvia os dois inline (`trainings.find(...)?.name || 'N/A'`), TODA linha
  // de alerta de interna saía como "N/A" em cima e "N/A" embaixo.
  const demandTitleOf = (d: any) => getDemandTitle(d, trainings, 'N/A');
  const demandCompanyOf = (d: any) => getDemandCompanyLabel(d, companies, 'N/A');

  const fmtDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const formatPeriod = (startDate: string, endDate: string) =>
    `${fmtDate(startDate)} → ${fmtDate(endDate)}`;

  const normalizeModality = (raw: any) =>
    String(raw ?? '').trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

  const getDemandModality = (d: any) => {
    const t = trainings.find(t => String(t.id) === String(d.trainingId));
    return normalizeModality(t?.modality ?? d.modality);
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

  // --- Blocos de alertas ---
  // Ordena: vencidas (mais antigas primeiro) → próximas (mais próximas primeiro)
  const sortByUrgency = (a: any, b: any) => {
    const now = new Date();
    const dateA = new Date(a.startDate);
    const dateB = new Date(b.startDate);
    const aOverdue = dateA < now;
    const bOverdue = dateB < now;
    if (aOverdue && bOverdue) return dateA.getTime() - dateB.getTime();
    if (!aOverdue && !bOverdue) return dateA.getTime() - dateB.getTime();
    return aOverdue ? -1 : 1;
  };

  const logisticsByDemandId = useMemo(() => {
    const map: Record<string, typeof logisticAllocations[number]> = {};
    for (const r of logisticAllocations) {
      const key = normId(r?.demand_id);
      if (key) map[key] = r;
    }
    return map;
  }, [logisticAllocations]);

  const measurementByDemandId = useMemo(() => {
    const map: Record<string, typeof measurements[number]> = {};
    for (const m of measurements) {
      const key = normId(m?.demandId);
      if (key) map[key] = m;
    }
    return map;
  }, [measurements]);

  /**
   * Contexto de alerta de cada demanda, resolvido UMA vez por render e
   * reaproveitado pelos 4 blocos. Antes cada bloco recalculava status e
   * modalidade por conta própria; o de medição ainda varria `measurements`
   * com um `find` por demanda.
   *
   * As REGRAS de cada bloco não moram mais aqui — estão em
   * domain/notificationAlerts, onde são verificáveis por execução
   * (npm run smoke:notificacoes).
   */
  const alertContexts = useMemo<DemandAlertContext[]>(() =>
    demands.map(d => ({
      demand: d,
      status: getCalculatedStatus(d),
      modality: getDemandModality(d),
      // Distingue "sem linha de logística" (null, não é pendência) de "linha
      // sem status preenchido" (PENDENTE, é pendência).
      logisticsStatus: (() => {
        const alloc = logisticsByDemandId[normId(d.id)];
        return alloc ? String(alloc.overall_status ?? 'PENDENTE') : null;
      })(),
      evidenceStatus: getEvidenceAutoStatus(d.id),
      // null = nenhuma linha de medição; string = o status que veio do banco.
      measurementStatus: (() => {
        const m = measurementByDemandId[normId(d.id)];
        return m ? String(m.status ?? '') : null;
      })(),
    })),
  [demands, trainings, logisticsByDemandId, measurementByDemandId, getEvidenceAutoStatus]);

  /** Aplica um predicado de domain/notificationAlerts e devolve as demandas. */
  const demandsMatching = (predicate: (ctx: DemandAlertContext) => boolean) =>
    alertContexts.filter(predicate).map(ctx => ctx.demand as any).sort(sortByUrgency);

  const pendingLogistics = useMemo(
    () => demandsMatching(hasPendingLogistics), [alertContexts]);

  // Janela de 3 semanas: semana passada → próxima semana
  const { inicioSemanaPassada, fimProximaSemana } = useMemo(() => {
    const hoje = new Date();
    const dayOfWeek = hoje.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const currentMonday = new Date(hoje);
    currentMonday.setDate(hoje.getDate() - daysFromMonday);
    currentMonday.setHours(0, 0, 0, 0);
    const inicioSemanaPassada = new Date(currentMonday);
    inicioSemanaPassada.setDate(currentMonday.getDate() - 7);
    const fimProximaSemana = new Date(currentMonday);
    fimProximaSemana.setDate(currentMonday.getDate() + 13);
    fimProximaSemana.setHours(23, 59, 59, 999);
    return { inicioSemanaPassada, fimProximaSemana };
  }, []);

  const pendingLogisticsWindow = useMemo(() => {
    return pendingLogistics.filter(d => {
      const inicio = new Date(d.startDate.slice(0, 10) + 'T00:00:00');
      const naJanela = inicio >= inicioSemanaPassada && inicio <= fimProximaSemana;
      const atrasada = inicio < inicioSemanaPassada && !d.instructorId;
      return naJanela || atrasada;
    });
  }, [pendingLogistics, inicioSemanaPassada, fimProximaSemana]);

  // Interna NÃO entra aqui — a regra e o porquê estão em notificationAlerts.
  const pendingEvidences = useMemo(
    () => demandsMatching(hasPendingEvidence), [alertContexts]);

  const noInstructorDemands = useMemo(
    () => demandsMatching(isAwaitingInstructor), [alertContexts]);

  const noMeasurementDemands = useMemo(
    () => demandsMatching(hasPendingMeasurement), [alertContexts]);

  const cancelledDemands = useMemo(() =>
    demands.filter(d => d.status === 'CANCELADA').sort(sortByUrgency),
  [demands]);

  const totalAlerts = pendingLogistics.length + pendingEvidences.length + noInstructorDemands.length + noMeasurementDemands.length;

  // --- Navegação ao clicar numa demanda ---
  type TargetView = 'logistics-control' | 'evidences' | 'demands' | 'internal-demands' | 'measurement';

  const handleDemandClick = (demandId: string, view: TargetView) => {
    setNotificationTarget({ demandId, view });
    setCurrentView(view);
  };

  // --- DemandRow clicável ---
  const DemandRow = ({
    d, badge, badgeCls, targetView,
  }: { d: any; badge: string; badgeCls: string; targetView: TargetView }) => (
    <button
      onClick={() => handleDemandClick(d.id, targetView)}
      className="w-full p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2 hover:bg-blue-50 hover:border-blue-200 transition-colors group text-left"
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="w-2 h-2 rounded-full bg-current shrink-0 opacity-60" />
        <div className="overflow-hidden">
          <p className="text-[11px] font-black text-slate-700 truncate group-hover:text-blue-700">
            <span className="text-blue-600 font-mono mr-1">#{d.id}</span>
            {demandTitleOf(d)}
          </p>
          <div className="flex items-center gap-1.5 overflow-hidden">
            <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{demandCompanyOf(d)}</p>
            <InternaBadge demand={d} />
          </div>
          {d.corredor && d.corredor !== 'N/A' && (
            <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{d.corredor}</p>
          )}
          <p className="text-[9px] font-bold text-slate-400 tabular-nums">{formatPeriod(d.startDate, d.endDate)}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${badgeCls}`}>{badge}</span>
        <ExternalLink size={10} className="text-slate-300 group-hover:text-blue-400 transition-colors" />
      </div>
    </button>
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
        </div>
      </div>

      {/* --- Bloco 1: Pendências Logísticas --- */}
      {(() => {
        const seeAll = expandedBlocks['logistics'] ?? false;
        const logisticItems = seeAll ? pendingLogistics : pendingLogisticsWindow;
        const hiddenTotal = pendingLogistics.length - pendingLogisticsWindow.length;
        return (
          <AlertCard
            title="Pendências Logísticas"
            subtitle={`${pendingLogistics.length} demanda${pendingLogistics.length !== 1 ? 's' : ''} aguardando tratativa operacional`}
            count={pendingLogistics.length}
            accentColor={pendingLogistics.length > 0 ? 'border-l-amber-400' : 'border-l-emerald-400'}
            icon={Bell}
            iconBg="bg-amber-50"
            iconColor="text-amber-500"
            badgeClass="bg-amber-100 text-amber-700"
            items={logisticItems}
            isExpanded={true}
            onToggle={() => {}}
            renderItem={(d) => {
              const alloc = logisticsByDemandId[normId(d.id)];
              const overall = String(alloc?.overall_status ?? 'PENDENTE').toUpperCase();
              return (
                <DemandRow d={d} badge={overall} badgeCls="bg-amber-100 text-amber-700" targetView="logistics-control" />
              );
            }}
            customFooter={
              !seeAll && hiddenTotal > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleBlock('logistics')}
                  className="mt-3 w-full p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center gap-2 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                >
                  <ChevronDown size={13} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-blue-500">
                    ↓ Ver todas as {pendingLogistics.length} pendências logísticas
                  </span>
                </button>
              ) : seeAll ? (
                <button
                  type="button"
                  onClick={() => toggleBlock('logistics')}
                  className="mt-3 w-full p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors group"
                >
                  <ChevronUp size={13} className="text-slate-400 group-hover:text-slate-600" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600">
                    Recolher
                  </span>
                </button>
              ) : null
            }
          />
        );
      })()}

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
        isExpanded={expandedBlocks['evidences'] ?? false}
        onToggle={() => toggleBlock('evidences')}
        renderItem={(d) => (
          <DemandRow d={d} badge={getEvidenceAutoStatus(d.id)} badgeCls="bg-indigo-100 text-indigo-600" targetView="evidences" />
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
        isExpanded={expandedBlocks['no-instructor'] ?? false}
        onToggle={() => toggleBlock('no-instructor')}
        renderItem={(d) => (
          <DemandRow
            d={d}
            badge="PENDENTE"
            badgeCls="bg-orange-100 text-orange-600"
            targetView={demandListView(d)}
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
        isExpanded={expandedBlocks['measurement'] ?? false}
        onToggle={() => toggleBlock('measurement')}
        renderItem={(d) => (
          <DemandRow
            d={d}
            badge="PENDENTE"
            badgeCls="bg-blue-100 text-blue-600"
            targetView="measurement"
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
                <button
                  key={d.id}
                  onClick={() => handleDemandClick(d.id, demandListView(d))}
                  className="w-full flex items-center justify-between text-[11px] bg-slate-50 p-3 rounded-xl border border-slate-100 hover:bg-blue-50 hover:border-blue-200 transition-colors group text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded shrink-0">#{d.id}</span>
                    <span className="truncate font-bold text-slate-700 group-hover:text-blue-700">{demandTitleOf(d)}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 ml-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 uppercase text-[9px] font-black">{demandCompanyOf(d)}</span>
                      <InternaBadge demand={d} />
                    </div>
                    <span className="text-[9px] font-bold text-slate-300">{new Date(d.startDate).toLocaleDateString('pt-BR')}</span>
                    <ExternalLink size={10} className="text-slate-300 group-hover:text-blue-400" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Notifications;
