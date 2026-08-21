import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../App';
import { Demand } from '../types';
import { requiresLogistics } from '../domain/modalityRules';
import { getDemandTitle, getDemandCompanyLabel, isInternalDemand } from '../domain/demandLabel';
import {
  Search,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  GraduationCap,
  Hotel,
  Car,
  Package,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  RotateCcw
} from 'lucide-react';
import { calculateDemandStatus } from '../domain/demandStatus';
import { demandIntersectsRange } from '../domain/demandDays';

// ✅ Supabase (controle logístico)
import {
  fetchLogisticAllocations,
  updateLogisticAllocationByDemandId,
  LogisticAllocationRow
} from '../services/logisticAllocations';

// ✅ Supabase client (para buscar demand_documents em lote)
import { supabase } from '../lib/supabase';

import type { DemandDocType } from '../services/demandDocuments';

type ViewMode = 'WEEK' | 'MONTH';



type DemandDocumentRowMini = {
  demand_id: string;
  doc_type: DemandDocType;
  file_path: string | null;
  is_na: boolean | null;
};



type DemandDocument = {
  demand_id: string;
  doc_type: DemandDocType;
  file_path?: string;
  is_na?: boolean;
};

const LogisticsControl: React.FC = () => {
  const { demands, companies, trainings, instructors, operationalBases, updateDemand, notificationTarget, setNotificationTarget } = useApp();

  const getInstructorName = (id?: string) => instructors.find(i => i.id === id)?.name;

  const [filterText, setFilterText] = useState('');
  const [filterLocal, setFilterLocal] = useState('');
  const [filterCorredor, setFilterCorredor] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('WEEK');
  const [referenceDate, setReferenceDate] = useState<Date>(new Date());

  // Navegação a partir de Notificações
  useEffect(() => {
    if (notificationTarget?.view === 'logistics-control') {
      setFilterText(notificationTarget.demandId);
      setNotificationTarget(null);
    }
  }, [notificationTarget]);

  // ✅ normalizador (evita mismatch de id tipo "#DEM-1" vs "DEM-1")
  const normId = (v: any) => String(v ?? '').trim().replace(/^#/, '');

  // ✅ mapa Supabase: demand_id -> logistic_allocations row
  const [logisticsByDemandId, setLogisticsByDemandId] = useState<Record<string, LogisticAllocationRow>>({});
  // ✅ mapa docs: demand_id -> flags de PDFs
  const [docsByDemandId, setDocsByDemandId] = useState<
  Record<string, { has_class_list_pdf: boolean; has_release_pdf: boolean }>
  >({});


  const [isSyncing, setIsSyncing] = useState(false);

  // Helpers de Nomes — resolvidos pela DEMANDA, não pelo id solto: interna não
  // tem treinamento e pode não ter empresa (domain/demandLabel).
  const demandTitleOf = (d?: Demand) => getDemandTitle(d, trainings, 'N/A');
  const demandCompanyOf = (d?: Demand) => getDemandCompanyLabel(d, companies, 'N/A');

  // Lógica de Período (Segunda a Domingo)
  const periodBounds = useMemo(() => {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);

    if (viewMode === 'WEEK') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);

      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }

    return { start, end };
  }, [viewMode, referenceDate]);

  // Texto de exibição do período
  const periodLabel = useMemo(() => {
    const monthName = referenceDate.toLocaleDateString('pt-BR', { month: 'long' });
    const year = referenceDate.getFullYear();

    if (viewMode === 'WEEK') {
      const firstDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
      const pastDaysOfMonth =
        (periodBounds.start.getDate() + (firstDayOfMonth.getDay() === 0 ? 6 : firstDayOfMonth.getDay() - 1)) / 7;
      const weekNum = Math.ceil(pastDaysOfMonth + 0.1);

      const startStr = periodBounds.start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const endStr = periodBounds.end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

      return (
        <span className="flex items-center gap-2">
          <span className="text-blue-600">Semana {weekNum}</span>
          <span className="text-slate-300">•</span>
          <span className="capitalize">{monthName}</span>
          <span className="text-slate-300">•</span>
          <span>{year}</span>
          <span className="ml-2 text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-500 font-mono">
            ({startStr} – {endStr})
          </span>
        </span>
      );
    }

    return (
      <span className="flex items-center gap-2">
        <span className="capitalize">{monthName}</span>
        <span className="text-slate-300">•</span>
        <span>{year}</span>
      </span>
    );
  }, [viewMode, referenceDate, periodBounds]);

  // Navegação
  const handlePrev = () => {
    const next = new Date(referenceDate);
    if (viewMode === 'WEEK') next.setDate(next.getDate() - 7);
    else next.setMonth(next.getMonth() - 1);
    setReferenceDate(next);
  };

  const handleNext = () => {
    const next = new Date(referenceDate);
    if (viewMode === 'WEEK') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    setReferenceDate(next);
  };

  const handleToday = () => setReferenceDate(new Date());

  // ✅ Helpers de “OK” usando Supabase (alloc)
  const isCarOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;

    if (alloc.has_car === true) return true;

    const m = (alloc.transport_mode || '').toUpperCase();
    if (m === 'NAO_NECESSARIO') return true;
    if (m === 'CARRO_ALUGADO') return true;
    if (m === 'CARRO_PROPRIO') return true;

    return false;
  };

  const isHotelOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;

    if (alloc.has_hotel === true) return true;

    const m = (alloc.lodging_mode || '').toUpperCase();
    if (m === 'NAO_NECESSARIO') return true;
    if (m === 'PRECISA_HOTEL') return true;

    return false;
  };

  const isMaterialOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    return alloc.has_material === true;
  };

  // ✅ PDFs: prioridade é demand_documents (docsByDemandId)
  const isReleaseOkFromDocs = (demandId: string) => {
    const id = normId(demandId);
    return docsByDemandId?.[id]?.has_release_pdf === true;
  };

  const isListOkFromDocs = (demandId: string) => {
    const id = normId(demandId);
    return docsByDemandId?.[id]?.has_class_list_pdf === true;
  };

  // ✅ cálculo oficial do overall (alloc + docs)
  const computeOverallStatusFromAllocAndDocs = (
    alloc?: LogisticAllocationRow,
    docs?: { has_class_list_pdf: boolean; has_release_pdf: boolean }
  ) => {
    if (!alloc) return { overall: 'PENDENTE', has_release_pdf: false, has_class_list_pdf: false };

    const carOk = isCarOkFromAlloc(alloc) === true;
    const hotelOk = isHotelOkFromAlloc(alloc) === true;
    const materialOk = isMaterialOkFromAlloc(alloc) === true;

    const releaseOk = docs?.has_release_pdf === true;
    const listOk = docs?.has_class_list_pdf === true;

    const allReady = carOk && hotelOk && materialOk && releaseOk && listOk;

    return {
      overall: allReady ? 'CONCLUIDA' : 'PENDENTE',
      has_release_pdf: releaseOk,
      has_class_list_pdf: listOk,
    };
  };

  // ✅ Sync: logistic_allocations + demand_documents (FIX: sem piscar / sem status falso)
  const syncLogisticsControlFromDb = useCallback(async () => {
    setIsSyncing(true);
    try {
      // 1) logistic_allocations
      const rows = await fetchLogisticAllocations();
      const allocMap: Record<string, LogisticAllocationRow> = {};
      for (const r of rows || []) {
        const id = normId(r?.demand_id);
        if (id) allocMap[id] = r;
      }

      // 2) demand_documents (PDFs)
      const { data: docsData, error: docsErr } = await supabase
        .from('demand_documents')
        .select('demand_id, doc_type, file_path, is_na');


    const docsMap: Record<
      string,
      {
        has_class_list_pdf: boolean;
        has_release_pdf: boolean;
      }
    > = {};

    if (docsErr) {
      console.error('[LogisticsControl] demand_documents error:', docsErr);
    } else {
      for (const row of (docsData as DemandDocumentRowMini[]) || []) {
        const demandId = normId(row?.demand_id);
        if (!demandId) continue;

        if (!docsMap[demandId]) {
          docsMap[demandId] = {
            has_class_list_pdf: false,
            has_release_pdf: false,
          };
        }

        // ✅ concluído se tem PDF OU está marcado como N/A
        const isCompleted = !!row.file_path || row.is_na === true;

        if (row.doc_type === 'LISTA_TURMA' && isCompleted) {
          docsMap[demandId].has_class_list_pdf = true;
        }

        if (row.doc_type === 'LIBERACAO_INSTRUTOR' && isCompleted) {
          docsMap[demandId].has_release_pdf = true;
        }
      }
    }


      // 3) Atualiza logistic_allocations somente após docsMap estar pronto
      const updates: Promise<any>[] = [];

      for (const demandId of Object.keys(allocMap)) {
        const alloc = allocMap[demandId];
        const docs = docsMap[demandId]; // pode ser undefined

        const computed = computeOverallStatusFromAllocAndDocs(alloc, docs);

        const nextOverall = String(computed.overall).toUpperCase();
        const currentOverall = String(alloc?.overall_status ?? 'PENDENTE').toUpperCase();

        const currentRelease = alloc?.has_release_pdf === true;
        const currentList = alloc?.has_class_list_pdf === true;

        const patch: any = {};

        if (currentRelease !== computed.has_release_pdf) patch.has_release_pdf = computed.has_release_pdf;
        if (currentList !== computed.has_class_list_pdf) patch.has_class_list_pdf = computed.has_class_list_pdf;
        if (currentOverall !== nextOverall) patch.overall_status = nextOverall;

        if (Object.keys(patch).length > 0) {
          updates.push(updateLogisticAllocationByDemandId(demandId, patch));
        }
      }

      // 4) Se atualizou algo, refetch pra garantir estado consistente
      if (updates.length > 0) {
        await Promise.all(updates);

        const rows2 = await fetchLogisticAllocations();
        const allocMap2: Record<string, LogisticAllocationRow> = {};
        for (const r of rows2 || []) {
          const id = normId(r?.demand_id);
          if (id) allocMap2[id] = r;
        }
        setLogisticsByDemandId(allocMap2);
      } else {
        setLogisticsByDemandId(allocMap);
      }

      // 5) docs sempre atualiza (mesmo se der erro, pode ficar vazio)
      setDocsByDemandId(docsMap);
    } catch (e) {
      console.error('[LogisticsControl] sync error', e);
      setLogisticsByDemandId({});
      setDocsByDemandId({});
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    syncLogisticsControlFromDb();
  }, [syncLogisticsControlFromDb]);

  // Opções únicas de local extraídas de todas as demandas
  const localOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const d of demands) {
      if (d.trainingLocal) seen.add(d.trainingLocal);
    }
    return Array.from(seen).sort();
  }, [demands]);

  // Filtragem das demandas ativas com base no período calculado
  const filteredDemands = useMemo(() => {
    return demands
      .filter(d => {
        // ❌ Demandas canceladas não entram
        if (d.status === 'CANCELADA') return false;

        // Apenas modalidades que requerem logística entram no controle
        if (!requiresLogistics(d.modality)) return false;

        // 🔎 Filtro de texto
        const company = demandCompanyOf(d).toLowerCase();
        const training = demandTitleOf(d).toLowerCase();

        const matchesSearch =
          !filterText ||
          company.includes(filterText.toLowerCase()) ||
          training.includes(filterText.toLowerCase()) ||
          d.id.toLowerCase().includes(filterText.toLowerCase());

        if (!matchesSearch) return false;

        // 📍 Filtro de local
        if (filterLocal && d.trainingLocal !== filterLocal) return false;

        // 🛣️ Filtro de corredor
        if (filterCorredor && d.corredor !== filterCorredor) return false;

        // 📅 Filtro de período — ignorado quando há busca de texto ativa
        if (filterText) return true;
        const fromStr = periodBounds.start.toISOString().slice(0, 10);
        const toStr = periodBounds.end.toISOString().slice(0, 10);
        return demandIntersectsRange(d, fromStr, toStr);
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [demands, filterText, filterLocal, filterCorredor, periodBounds, companies, trainings]);

  // ✅ Handler para marcação manual de material (Supabase)
  const toggleMaterial = async (demand: Demand) => {
    const alloc = logisticsByDemandId?.[normId(demand.id)];
    const current = alloc?.has_material === true;
    const nextValue = !current;

    try {
      await updateLogisticAllocationByDemandId(normId(demand.id), { has_material: nextValue } as any);
      await syncLogisticsControlFromDb();
    } catch (e) {
      console.error('[LogisticsControl] toggleMaterial error:', e);
    }
  };

  // (fallback antigo) — mantém pra não quebrar nada enquanto migra tudo
  const toggleMaterialLegacy = (demand: Demand) => {
    updateDemand({
      ...demand,
      materialReady: !demand.materialReady
    });
  };

  const StatusIcon = ({ ok }: { ok?: boolean }) => {
    if (ok) return <CheckCircle2 size={18} className="text-emerald-500" />;
    return <AlertCircle size={18} className="text-slate-200" />;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Controle Logístico</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Checklist de Prontidão para Treinamentos
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* ✅ Sync button mantendo seu estilo */}
          <button
            onClick={syncLogisticsControlFromDb}
            className="px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 shadow-sm flex items-center gap-2"
            title="Atualizar checks do banco"
          >
            <RotateCcw size={14} className={isSyncing ? 'animate-spin' : ''} />
            Atualizar
          </button>

          <div className="flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={() => setViewMode('WEEK')}
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                viewMode === 'WEEK' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Semana
            </button>
            <button
              onClick={() => setViewMode('MONTH')}
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                viewMode === 'MONTH' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              Mês
            </button>
          </div>
        </div>
      </div>

      {/* Navegação de Período */}
      <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 transition-colors border border-slate-100 shadow-sm"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={handleToday}
            className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 rounded-xl transition-colors border border-slate-100 shadow-sm"
          >
            Hoje
          </button>
          <button
            onClick={handleNext}
            className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 transition-colors border border-slate-100 shadow-sm"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="text-sm font-black text-slate-700 uppercase tracking-tight">{periodLabel}</div>

        <div className="flex items-center gap-3">
          <select
            value={filterLocal}
            onChange={e => setFilterLocal(e.target.value)}
            className="w-44 h-9 px-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
          >
            <option value="">Local — Todos</option>
            {localOptions.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <select
            value={filterCorredor}
            onChange={e => setFilterCorredor(e.target.value)}
            className="w-44 h-9 px-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner text-slate-600"
          >
            <option value="">Corredor — Todos</option>
            {(operationalBases.corredores ?? []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Buscar ID, Empresa ou Treinamento..."
              className="w-full h-9 pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tabela de Controle */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider font-black text-slate-500">
                <th className="p-5">ID / Empresa</th>
                <th className="p-5">Treinamento</th>
                <th className="p-5">Instrutor</th>
                <th className="p-5 text-center">Período</th>
                <th className="p-5 text-center">
                  <span className="flex flex-col items-center gap-1">
                    <Hotel size={14} /> Hotel
                  </span>
                </th>
                <th className="p-5 text-center">
                  <span className="flex flex-col items-center gap-1">
                    <Car size={14} /> Carro
                  </span>
                </th>
                <th className="p-5 text-center">
                  <span className="flex flex-col items-center gap-1">
                    <Package size={14} /> Material
                  </span>
                </th>
                <th className="p-5 text-center">
                  <span className="flex flex-col items-center gap-1">
                    <FileCheck size={14} /> Liberação
                  </span>
                </th>
                <th className="p-5 text-center">
                  <span className="flex flex-col items-center gap-1">
                    <FileCheck size={14} /> Lista
                  </span>
                </th>
                <th className="p-5 text-center">Status Geral</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredDemands.filter(d => requiresLogistics(d.modality)).length > 0 ? (
                filteredDemands
                  .filter(d => requiresLogistics(d.modality))
                  .map(d => {
                    const demandId = normId(d.id);
                    const alloc = logisticsByDemandId?.[demandId];

                    // ✅ Preferência: Supabase. Fallback: campos antigos.
                    const carOkFromDb = isCarOkFromAlloc(alloc);
                    const hotelOkFromDb = isHotelOkFromAlloc(alloc);
                    const materialOkFromDb = isMaterialOkFromAlloc(alloc);

                    // PDFs: prioridade = demand_documents
                    const releaseOkFromDocs = isReleaseOkFromDocs(demandId);
                    const listOkFromDocs = isListOkFromDocs(demandId);

                    // legacy fallback (só pra não quebrar nada)
                    const isHotelOkLegacy =
                      d.logisticsHotel === 'CONFIRMADO' || d.logisticsHotel === 'NAO_NECESSARIO';
                    const isCarOkLegacy =
                      d.logisticsTransport === 'CONFIRMADO' || d.logisticsTransport === 'NAO_NECESSARIO';
                    const isMaterialOkLegacy = d.materialReady === true;

                    const isHotelOk = hotelOkFromDb ?? isHotelOkLegacy;
                    const isCarOk = carOkFromDb ?? isCarOkLegacy;
                    const isMaterialOk = materialOkFromDb ?? isMaterialOkLegacy;

                    // ✅ PDFs finais
                    const isReleaseOk = releaseOkFromDocs;
                    const isListOk = listOkFromDocs;

                    const statusLegacy = calculateDemandStatus(
                      {
                        startDate: d.startDate,
                        endDate: d.endDate,
                        instructorId: d.instructorId,
                        cancelled: d.status === 'CANCELADA',
                        trainingLocal: d.trainingLocal,
                        modality: d.modality
                      } as any
                    );

                    const allReady = isHotelOk && isCarOk && isMaterialOk && isReleaseOk && isListOk;

                    // ✅ Corrige “PRONTO em cima e PENDENTE embaixo”
                    const statusLabel = allReady ? 'CONCLUÍDO' : 'PENDÊNCIA LOGÍSTICA';
                    const statusBadge = allReady ? 'Pronto' : 'Pendente';

                    return (
                      <tr
                        key={d.id}
                        className="hover:bg-slate-50/30 transition-colors text-xs font-medium text-slate-600"
                      >
                        {/* ID / EMPRESA */}
                        <td className="p-5">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-blue-600 font-bold">#{d.id}</span>
                              {isInternalDemand(d) && (
                                <span className="bg-violet-100 text-violet-700 border border-violet-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest">
                                  Interna
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-black uppercase text-slate-400 mt-1 truncate max-w-[150px]" title={demandCompanyOf(d)}>
                              {demandCompanyOf(d)}
                            </span>
                          </div>
                        </td>

                        {/* TREINAMENTO */}
                        <td className="p-5 max-w-[200px]">
                          <div className="flex items-center gap-2">
                            <GraduationCap size={14} className="text-slate-300 shrink-0" />
                            <span className="truncate font-bold text-slate-700" title={demandTitleOf(d)}>{demandTitleOf(d)}</span>
                          </div>
                        </td>

                        {/* INSTRUTOR */}
                        <td className="p-5 max-w-[160px]">
                          <span className="truncate font-medium text-slate-700 block" title={getInstructorName(d.instructorId) ?? undefined}>
                            {getInstructorName(d.instructorId) ?? '—'}
                          </span>
                        </td>

                        {/* PERÍODO */}
                        <td className="p-5 text-center">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-slate-700">
                              {new Date(d.startDate).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit'
                              })}
                            </span>
                            <span className="text-[8px] text-slate-300 font-bold uppercase">Início</span>
                          </div>
                        </td>

                        {/* HOTEL */}
                        <td className="p-5 text-center">
                          <div className="flex justify-center">
                            <StatusIcon ok={isHotelOk} />
                          </div>
                        </td>

                        {/* CARRO */}
                        <td className="p-5 text-center">
                          <div className="flex justify-center">
                            <StatusIcon ok={isCarOk} />
                          </div>
                        </td>

                        {/* MATERIAL (manual) */}
                        <td className="p-5 text-center">
                          <div className="flex justify-center">
                            <button
                              onClick={() => {
                                // Se já tem row do Supabase, toggle lá. Se não tiver, mantém legacy por enquanto.
                                if (alloc) toggleMaterial(d);
                                else toggleMaterialLegacy(d);
                              }}
                              className={`p-1 rounded-md transition-all hover:bg-slate-100 ${
                                isMaterialOk ? 'text-emerald-500' : 'text-slate-300'
                              }`}
                              title={alloc ? 'Marcar Material (Supabase)' : 'Marcar Material (legacy)'}
                            >
                              <Package
                                size={20}
                                fill={isMaterialOk ? 'currentColor' : 'none'}
                                strokeWidth={isMaterialOk ? 1.5 : 2}
                              />
                            </button>
                          </div>
                        </td>

                        {/* LIBERAÇÃO */}
                        <td className="p-5 text-center">
                          <div className="flex justify-center">
                            <StatusIcon ok={isReleaseOk} />
                          </div>
                        </td>

                        {/* LISTA */}
                        <td className="p-5 text-center">
                          <div className="flex justify-center">
                            <StatusIcon ok={isListOk} />
                          </div>
                        </td>

                        {/* STATUS GERAL */}
                        <td className="p-5 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                allReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {statusBadge}
                            </span>

                            {/* ✅ aqui agora não contradiz o badge */}
                            <span className="text-[8px] text-slate-300 font-bold uppercase">
                              {statusLabel}
                            </span>

                            {/* debug opcional:
                            <span className="text-[8px] text-slate-200 font-bold uppercase">
                              {String(statusLegacy).replace('_', ' ')}
                            </span>
                            */}
                          </div>
                        </td>
                      </tr>
                    );
                  })
              ) : (
                <tr>
                  <td colSpan={9} className="p-20 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-4">
                      <CalendarDays size={48} className="opacity-10" />
                      <p className="font-bold text-sm italic">Nenhuma demanda ativa encontrada neste período.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LogisticsControl;
