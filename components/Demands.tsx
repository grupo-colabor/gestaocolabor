import React, { useEffect, useMemo, useRef, useState } from 'react';
import { requiresLogistics } from '../domain/modalityRules';
import { buildModalityOptions, buildTrainingsById, matchesModality } from '../domain/modalityOptions';
import { createPortal } from 'react-dom';
import { usePagination } from '../hooks/usePagination';
import Pagination from './Pagination';

import { useApp } from '../App';

import {
  Demand,
  DemandStatus,
  Modality,
  TransportType,
  RentalCompany,
  PaymentMethod,
  AccommodationType,
  InstructorAllocation,
  LogisticAllocation,
  SpecificDateEntry,
  LogisticaLocomocao,
  LogisticaHospedagem
} from '../types';

import {
  Search,
  FileText,
  X,
  Plus,
  Filter,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  MapPin,
  Truck,
  Home,
  UserCheck,
  Calendar,
  Check,
  AlertCircle,
  Building,
  Building2,
  Tag,
  Edit3,
  User,
  Info,
  FileSearch,
  BookOpen,
  Clock,
  Mail,
  MessageCircle,
  FileDown,
  FileText as FileWordIcon,
  Eraser,
  Trash2,
  Ban,
  RefreshCw,
  FilePlus,
  FileCheck,
  UserPlus,
  Users,
  AlertTriangle,
  Upload,
  Paperclip
} from 'lucide-react';

import {
  PAYMENT_METHODS
} from '../constants';


import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle
} from 'docx';

import { calculateDemandStatus } from '../domain/demandStatus';
// Tabela de permissões compartilhada com o formulário de demanda interna —
// alias local para manter as chamadas existentes (canPerformAction) intactas.
import { canPerformDemandAction as canPerformAction } from '../domain/demandPermissions';
import { useAuth } from '../contexts/AuthContext';

/* ===== SERVICES (SUPABASE) ===== */

import { upsertMeasurementByDemandId } from '../services/measurements';
import { logAction } from '../services/auditLog';
import { supabase } from '../lib/supabase';

import {
  uploadAndUpsertDemandPdf,
  getDemandDocumentSignedUrl,
  fetchDemandDocumentsByDemandId,
  markDemandDocumentAsNA
} from '../services/demandDocuments';



import {
  upsertLogisticByDemandId,
  fetchLogisticByDemandId,
  fetchLogisticBlocksByDemandId,
  upsertLogisticBlocks,
  type LogisticBlockRow
} from '../services/logistics';
import { fetchLocationAssociations, type LocationAssociation } from '../services/locationAssociations';
import {
  buildDemandTextContent,
  downloadDemandWord,
  type DemandDocFields,
} from '../services/demandDocument';
import ExportDemandsModal from './ExportDemandsModal';

/* ===== SEÇÕES REUTILIZÁVEIS DO FORMULÁRIO ===== */
// Extraídas deste arquivo para components/demand-form/ — mesmo JSX, mesmas
// regras; o formulário de demanda interna consome as mesmas três seções.
import DataViewField from './demand-form/DataViewField';
import LogisticaLocomocaoSection from './demand-form/LogisticaLocomocaoSection';
import LogisticaHospedagemSection from './demand-form/LogisticaHospedagemSection';
import DocumentosDemandaSection from './demand-form/DocumentosDemandaSection';
import { formatDateTime, formatDateOnlySafe } from './demand-form/formatters';
// Conversão data+hora de início/fim da demanda: helper ÚNICO, compartilhado com
// o form de demanda interna (InternalDemands.tsx). Não reimplementar aqui.
import {
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  toDemandDateInput,
  toDemandTimeInput,
  buildDemandDateTime,
  toDemandDateTimeInput,
  isoToLocalDTL,
  isoToDateOnly,
  toIsoFromDateTimeLocalSafe,
  toIsoFromDateInputSafe,
} from '../domain/demandDateTime';
// Fluxo de alocação de CTM: hook (estado + regras) e modal (apresentação).
// Extraídos daqui para que a demanda INTERNA use o MESMO fluxo, não uma cópia.
import ResourceAllocationModal from './ResourceAllocationModal';
import PersonCountBadge from './ui/PersonCountBadge';
import { planAllocationReschedule, describeReschedule } from '../domain/allocationReschedule';
import { getDemandDays } from '../domain/demandDays';
import { updateCompanionAllocationDates } from '../services/companionAllocations';
import { updateDemandParticipantPeriod } from '../services/demandParticipants';
import { useResourceAllocation } from '../hooks/useResourceAllocation';

// UUID v4 sem crypto.randomUUID() — compatível com HTTP e browsers antigos.
// Necessário porque a coluna id da tabela logistic_blocks é do tipo uuid no PostgreSQL.
const generateId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });




const Demands: React.FC = () => {
  const {
    demands: allDemands, companies, trainings, regions, instructors, operationalBases,
    measurements, agendaItems, instructorAllocations, resourceAllocations,companionAllocations,
    demandParticipants, removeCompanionAllocation,
    updateDemand, addDemand, deleteDemand, deallocateInstructor, recommendInstructors,
    updateMeasurement, removeAgendaItem, hasResourceConflict,
    addInstructorAllocation, removeInstructorAllocation, updateInstructorAllocation, addResourceAllocation, removeResourceAllocation, hasScheduleConflict, setNotification,
    notificationTarget, setNotificationTarget,
  } = useApp();
  
  const { profile } = useAuth();

  // ⚠️ FONTE ÚNICA desta tela: demanda de cliente.
  // Demandas internas (Colabor → instrutor, sem empresa nem treinamento) têm
  // aba própria. O corte é aqui, na entrada dos dados, e não espalhado por
  // render/memo — qualquer coisa abaixo que fale `demands` já vem filtrada.
  const demands = useMemo(() => allDemands.filter(d => d.tipo !== 'interna'), [allDemands]);

  // Flags de perfil
  const isCoordinator = profile?.role === 'coordenador';
  const isAnalyst = profile?.role === 'analista';
  const isAdmin = profile?.role === 'admin';

  // Permissões
  const canEditDemand = isAdmin || isAnalyst;
  const canDeleteDemand = isAdmin || isAnalyst;
  // O botão ALOCAR CTM não tinha guard nenhum: bastava enxergar a tela.
  // Fechado aqui e no modal de interna ao mesmo tempo, pela mesma tabela.
  const canAllocateResource = canPerformAction(profile?.role, 'alocarRecurso');

const [filter, setFilter] = useState('');
const [isExportDemandsOpen, setIsExportDemandsOpen] = useState(false);

// Navegação a partir de Notificações
useEffect(() => {
  if (notificationTarget?.view === 'demands') {
    setFilter(notificationTarget.demandId);
    setNotificationTarget(null);
  }
}, [notificationTarget]);
  type SortKey =
    | 'id'
    | 'company'
    | 'training'
    | 'demandState'
    | 'trainingLocal'
    | 'startDate'
    | 'instructor'
    | 'status';

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'id',
    dir: 'desc',
  });

  const [showDeleteMessage, setShowDeleteMessage] = useState(false);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  const [confirmAllocationCase, setConfirmAllocationCase] = useState<'unqualified' | 'exception' | 'qualified' | null>(null);
  const [pendingAllocationData, setPendingAllocationData] = useState<InstructorAllocation | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDateChange, setConfirmDateChange] = useState(false);
  const bypassDateWarning = useRef(false);
  const [confirmLocalChange, setConfirmLocalChange] = useState(false);
  const bypassLocalWarning = useRef(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Location associations for cascade autocomplete
  const [locationAssociations, setLocationAssociations] = useState<LocationAssociation[]>([]);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());

  // Estados locais para motivo de cancelamento
  const [selectedCancelReason, setSelectedCancelReason] = useState<string>('');
  const [cancelTextNote, setCancelTextNote] = useState<string>('');
  
  // --- Advanced Filters State ---
  const [advancedFilters, setAdvancedFilters] = useState({
    companyId: '',
    regionId: '',
    trainingId: '',
    instructorId: '',
    status: '',
    startDate: '',
    endDate: '',
    trainingLocal: '',
    corredor: '',
    demandState: '',
    modality: ''
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Modalidade: índice + opções derivadas dos dados (fonte única em domain/modalityOptions)
  const trainingsById = useMemo(() => buildTrainingsById(trainings), [trainings]);
  const modalityOptions = useMemo(() => buildModalityOptions(demands, trainings), [demands, trainings]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'CREATE' | 'EDIT' | null>(null);
  const [modalSubMode, setModalSubMode] = useState<'VIEW' | 'FORM'>('FORM');

  // Multi-instructor Modal State
  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
  const [allocationForm, setAllocationForm] = useState({
    instructorId: '',
    startDate: '',
    endDate: ''
  });
  const [pendingConflictAllocation, setPendingConflictAllocation] = useState<InstructorAllocation | null>(null);

  // Load location associations on mount
  useEffect(() => {
    // Cascata do formulário de CLIENTE: lê só o conjunto 'cliente'. O conjunto
    // 'interna' é independente e vive no formulário de demanda interna.
    fetchLocationAssociations('cliente').then(setLocationAssociations).catch(console.error);
  }, []);

  // Reset auto-fill state when modal closes
  useEffect(() => {
    if (!isModalOpen) setAutoFilledFields(new Set());
  }, [isModalOpen]);

  // O lock de scroll do body foi para junto do hook `ctmAllocation`, mais
  // abaixo: ele depende de `ctmAllocation.isOpen`, e a lista de dependências
  // é avaliada durante o render — antes da declaração daria TDZ.

  // Accordion state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    geral: true,
    internos: false,
    locomocao: false,
    hospedagem: false,
    documentos: false
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // ── Helpers para cascade ──────────────────────────────────────────────────
  // Retorna valor único se todos os registros concordam, null se ambíguo.
  const uniqueVal = (arr: string[]): string | null =>
    arr.length > 0 && new Set(arr).size === 1 ? arr[0] : null;

  // Local → Corredor + Estado + Região  (match exato)
  const handleTrainingLocalChange = (value: string) => {
    const isNA = value === 'N/A';
    const assoc = value && !isNA
      ? locationAssociations.find(a => a.local === value)
      : null;
    const region = assoc ? regions.find(r => r.name === assoc.regiao) : null;

    const newAutoFilled = new Set<string>();

    setFormDemand(prev => {
      const updates: Partial<typeof prev> = { trainingLocal: value };
      if (isNA) {
        updates.corredor   = 'N/A';
        updates.demandState = 'N/A';
        updates.regionId   = '';
      } else if (assoc) {
        if (assoc.corredor) updates.corredor   = assoc.corredor;
        if (assoc.uf)       updates.demandState = assoc.uf;
        if (region)         updates.regionId   = region.id;
      }
      return { ...prev, ...updates };
    });

    if (isNA) {
      newAutoFilled.add('na_locked');
    } else if (assoc) {
      if (assoc.corredor) newAutoFilled.add('corredor');
      if (assoc.uf)       newAutoFilled.add('demandState');
      if (region)         newAutoFilled.add('regionId');
    }
    setAutoFilledFields(newAutoFilled);
  };

  // Corredor → Estado (se unívoco) + Região (se unívoca)
  const handleCorredorChange = (value: string) => {
    const matches = value
      ? locationAssociations.filter(a => a.corredor === value && a.local !== 'N/A')
      : [];

    const uf     = uniqueVal(matches.map(a => a.uf).filter(Boolean));
    const regiao = uniqueVal(matches.map(a => a.regiao).filter(Boolean));
    const region = regiao ? regions.find(r => r.name === regiao) : null;

    setFormDemand(prev => {
      const updates: Partial<typeof prev> = { corredor: value };
      if (uf)     updates.demandState = uf;
      if (region) updates.regionId   = region.id;
      return { ...prev, ...updates };
    });

    setAutoFilledFields(prev => {
      const s = new Set(prev);
      s.delete('corredor');                           // campo editado pelo usuário
      if (uf)     s.add('demandState'); else s.delete('demandState');
      if (region) s.add('regionId');    else s.delete('regionId');
      return s;
    });
  };

  // Estado (UF) → Região (se unívoca)
  const handleEstadoChange = (value: string) => {
    const matches = value
      ? locationAssociations.filter(a => a.uf === value && a.local !== 'N/A')
      : [];

    const regiao = uniqueVal(matches.map(a => a.regiao).filter(Boolean));
    const region = regiao ? regions.find(r => r.name === regiao) : null;

    setFormDemand(prev => {
      const updates: Partial<typeof prev> = { demandState: value };
      if (region) updates.regionId = region.id;
      return { ...prev, ...updates };
    });

    setAutoFilledFields(prev => {
      const s = new Set(prev);
      s.delete('demandState');                        // campo editado pelo usuário
      if (region) s.add('regionId'); else s.delete('regionId');
      return s;
    });
  };

  // Shared Form State
  const initialDemandState = (): Partial<Demand> => ({
    companyId: '',
    trainingId: '',
    regionId: '',
    trainingLocal: '',
    demandState: '',
    modality: 'PRESENCIAL',
    dateMode: 'CONTINUO' as const,
    specificDates: [] as SpecificDateEntry[],
    startDate: '',
    endDate: '',
    status: 'NOVA',
    transportType: null,
    rentalCompany: 'Localiza',
    carCategory: 'Grupo CE',
    accommodationType: null,
    hotelPayment: null,
    matriculador: '',
    rentalAgencyLocation: '',
    rentalLocator: '',
    logisticsHotel: null,
    logisticsTransport: null,
    observations: '',
    logisticasLocomocao: [{
      id: generateId(),
      transportType: null,
      rentalCompany: 'Localiza',
      carCategory: 'Grupo CE',
      rentalAgencyLocation: '',
      rentalLocator: '',
    }],
    logisticasHospedagem: [{
      id: generateId(),
      accommodationType: null,
      hotelPayment: null,
    }],
  });

  // Note: attachments is handled dynamically in formDemand
  const [formDemand, setFormDemand] = useState<Partial<Demand & { cancelledAt?: string, attachments?: { classListPdf?: { name: string; base64: string }; instructorReleasePdf?: { name: string; base64: string } }, cancelInfo?: { reason: string, note: string, date: string } }>>(initialDemandState());

  /**
   * Sugestões do campo Local: base operacional + locais já usados nas
   * associações (que na prática saem da mesma base, mas linhas legadas podem
   * ter divergido).
   *
   * 'N/A' só é oferecido quando a modalidade NÃO exige logística (ONLINE / EAD /
   * ONLINE_AO_VIVO). Num PRESENCIAL/HÍBRIDO/TUTORIA, 'N/A' faria a demanda
   * travar em PENDENTE pelo motor de status (demandStatus.ts) — não é opção.
   */
  const localOptions = useMemo(() => {
    const isNAValue = (v: string) => v.trim().toUpperCase() === 'N/A';
    const base = [
      ...(operationalBases.locaisTreinamento ?? []),
      ...locationAssociations.map(a => a.local),
    ]
      .map(v => (v ?? '').trim())
      .filter(v => !!v && !isNAValue(v));

    const unique = Array.from(new Set(base)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return requiresLogistics(formDemand.modality) ? unique : ['N/A', ...unique];
  }, [operationalBases.locaisTreinamento, locationAssociations, formDemand.modality]);

  const [activeDemand, setActiveDemand] = useState<Demand | null>(null);


// PDFs pendentes (selecionados no FORM e enviados no SAVE)
  const [pendingPdfs, setPendingPdfs] = useState<{
    classList: File | null;
    instructorRelease: File | null;
  }>({ classList: null, instructorRelease: null });

  // Docs já salvos no banco (para VIEW) + N/A
  const [dbDocs, setDbDocs] = useState<
    Record<string, { name: string; path: string | null; is_na?: boolean }>
  >({});




  // Helper names
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getTrainingHours = (id: string) => {
    const h = trainings.find(t => t.id === id)?.hours;
    return h != null ? `${h}h` : '—';
  };
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';
  const getInstructorName = (id?: string) => instructors.find(i => i.id === id)?.name || 'Não Alocado';

// --- LÓGICA DE PDF (SUPABASE STORAGE + demand_documents) ---
  const removePdf = (key: 'classList' | 'instructorRelease') => {
    setPendingPdfs(prev => ({ ...prev, [key]: null }));
  };

  const handlePdfSelect = (key: 'classList' | 'instructorRelease', file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Por favor, selecione apenas arquivos PDF.');
      return;
    }

    setPendingPdfs(prev => ({ ...prev, [key]: file }));
  };

  /**
   * Download do PDF já salvo no Supabase (VIEW)
   */
  const downloadSavedPdf = async (docType: 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR') => {
    const doc = dbDocs[docType];
    if (!doc?.path) return;

    try {
      const signed = await getDemandDocumentSignedUrl(doc.path, 60);
      if (signed.error) throw signed.error;

      const signedUrl = signed.data?.signedUrl;
      if (!signedUrl) throw new Error('Não foi possível gerar signedUrl.');

      window.open(signedUrl, '_blank');
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao baixar PDF: ${err?.message || err}`);
    }
  };

  // ✅ PASSO 5.3 — Marcar documento como N/A
const markDocAsNA = async (docType: 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR') => {
  if (!formDemand?.id) {
    alert('ID da demanda não encontrado.');
    return;
  }

  // Se tiver PDF pendente no form, não deixa (evita incoerência)
  if (docType === 'LISTA_TURMA' && pendingPdfs.classList) {
    alert('Remova o PDF selecionado antes de marcar como N/A.');
    return;
  }
  if (docType === 'LIBERACAO_INSTRUTOR' && pendingPdfs.instructorRelease) {
    alert('Remova o PDF selecionado antes de marcar como N/A.');
    return;
  }

  try {
    const res = await markDemandDocumentAsNA(formDemand.id, docType);
    if (res?.error) throw res.error;

    // Recarrega docs para refletir N/A na tela
  const docs = await fetchDemandDocumentsByDemandId(formDemand.id);
  const mapped: Record<string, { name: string; path: string | null; is_na?: boolean }> = {};

  for (const d of docs as any[]) {
    mapped[d.doc_type] = {
      name: d.file_name || d.doc_type,
      path: d.file_path ?? null,
      is_na: !!d.is_na
    };
  }

  setDbDocs(mapped);


    setNotification?.({
      type: 'success',
      message: `${docType === 'LISTA_TURMA' ? 'Lista da Turma' : 'Liberação do Instrutor'} marcada como N/A.`
    });
  } catch (e: any) {
    console.error(e);
    alert(e?.message || 'Erro ao marcar como N/A');
  }
};


  // --- LÓGICA DE RECOMENDAÇÃO (SOMENTE LEITURA) ---
  const recommendedInstructors = useMemo(() => {
    if (modalSubMode === 'VIEW' && formDemand.trainingId && formDemand.regionId) {
      // Chamada da função centralizada no Context
      return recommendInstructors(formDemand as Demand);
    }
    return [];
  }, [modalSubMode, formDemand, recommendInstructors]);

  const isValeSelected = useMemo(() => {
    return companies.find(c => c.id === formDemand.companyId)?.name.toUpperCase().includes('VALE') || false;
  }, [companies, formDemand.companyId]);

  const isFormValid = useMemo(() => {
  const hasCompanyAndTraining = !!(formDemand.companyId && formDemand.trainingId);
  if (!hasCompanyAndTraining) return false;

  // Validação de datas depende do modo
  const isSpecific = formDemand.dateMode === 'DIAS_ESPECIFICOS';
  if (isSpecific) {
    // Precisa de ao menos 1 dia selecionado
    if (!Array.isArray(formDemand.specificDates) || formDemand.specificDates.length === 0) return false;
  } else {
    // Modo contínuo: precisa de startDate e endDate com horário
    if (!formDemand.startDate || !formDemand.endDate) return false;
    const hasStartTime = formDemand.startDate!.includes('T');
    const hasEndTime = formDemand.endDate!.includes('T');
    if (!hasStartTime || !hasEndTime) return false;
  }

  // Local é obrigatório apenas para modalidades que requerem logística
  const needsLocal = requiresLogistics(formDemand.modality);
  if (needsLocal && !formDemand.trainingLocal) return false;
  if (!formDemand.demandState) return false;

  return true;
}, [formDemand]);


    // ✅ Instrutor principal por demanda (menor startDate nas alocações)
  const principalInstructorByDemandId = useMemo(() => {
    const earliest: Record<string, { startDate: string; instructorId: string }> = {};

    for (const a of instructorAllocations) {
      if (!a.demandId || !a.instructorId || !a.startDate) continue;

      const cur = earliest[a.demandId];
      if (!cur || a.startDate.localeCompare(cur.startDate) < 0) {
        earliest[a.demandId] = { startDate: a.startDate, instructorId: a.instructorId };
      }
    }

    const map: Record<string, string | undefined> = {};
    for (const d of demands) {
      map[d.id] = earliest[d.id]?.instructorId ?? d.instructorId;
    }

    return map;
  }, [demands, instructorAllocations]);

  /**
   * Nomes dos ACOMPANHANTES por demanda, para o indicador da listagem.
   *
   * `companion_allocations` tem UMA LINHA POR DIA: um acompanhante de 3 dias
   * são 3 linhas. A contagem é por `instructorId` distinto — senão o "+N"
   * diria dias, não pessoas.
   *
   * Deriva do estado global (carregado no bootstrap e mantido pelo realtime),
   * como o equivalente de participantes na tela de interna.
   */
  const companionNamesByDemandId = useMemo(() => {
    const porDemanda: Record<string, Set<string>> = {};
    for (const ca of companionAllocations || []) {
      if (!ca.demandId || !ca.instructorId) continue;
      (porDemanda[ca.demandId] ||= new Set<string>()).add(ca.instructorId);
    }

    const map: Record<string, string[]> = {};
    for (const [demandId, ids] of Object.entries(porDemanda)) {
      map[demandId] = [...ids]
        .map(id => getInstructorName(id))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
    return map;
  }, [companionAllocations, instructors]);

  // Todos os instrutores por demanda, deduplicados e ordenados por startDate
  const allInstructorsByDemandId = useMemo(() => {
    const map: Record<string, string[]> = {};

    for (const d of demands) {
      const allocs = instructorAllocations
        .filter(a => a.demandId === d.id && a.instructorId)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

      const seen = new Set<string>();
      const uniqueIds: string[] = [];
      for (const a of allocs) {
        if (!seen.has(a.instructorId!)) {
          seen.add(a.instructorId!);
          uniqueIds.push(a.instructorId!);
        }
      }

      if (uniqueIds.length > 0) {
        map[d.id] = uniqueIds;
      } else if (d.instructorId) {
        map[d.id] = [d.instructorId];
      } else {
        map[d.id] = [];
      }
    }

    return map;
  }, [demands, instructorAllocations]);


const filteredDemands = useMemo(() => {
  return demands
    .filter(d => {
      // 🔐 REGRA DE VISUALIZAÇÃO — COORDENADOR
      // Coordenador só vê demandas que tenham instrutor principal (via alocações ou campo antigo)
      if (isCoordinator && !principalInstructorByDemandId[d.id]) {
        return false;
      }

      const q = filter.trim().toLowerCase();

      const matchesText =
        d.id.toLowerCase().includes(q) ||
        (d.clientDemandId || '').toLowerCase().includes(q) ||
        getCompanyName(d.companyId).toLowerCase().includes(q) ||
        getTrainingName(d.trainingId).toLowerCase().includes(q);

      if (!matchesText) return false;

      const currentStatus = calculateDemandStatus({
        startDate: d.startDate,
        endDate: d.endDate,
        instructorId: d.instructorId,
        cancelled: d.status === 'CANCELADA',
        trainingLocal: d.trainingLocal,
        modality: d.modality,
      } as any);

      if (advancedFilters.companyId && d.companyId !== advancedFilters.companyId) return false;
      if (advancedFilters.regionId && d.regionId !== advancedFilters.regionId) return false;
      if (advancedFilters.trainingId && d.trainingId !== advancedFilters.trainingId) return false;

      if (advancedFilters.status) {
        if (advancedFilters.status === 'CANCELADA') {
          if (d.status !== 'CANCELADA') return false;
        } else {
          if (d.status === 'CANCELADA') return false;
          if (currentStatus !== advancedFilters.status) return false;
        }
      }
      if (advancedFilters.instructorId) {
        const principalId = principalInstructorByDemandId[d.id]; // ✅ considera alocações

        if (advancedFilters.instructorId === 'unallocated') {
          if (principalId) return false; // se tem principal, não é "sem instrutor"
        } else {
          if (principalId !== advancedFilters.instructorId) return false;
        }
      }


      if (advancedFilters.startDate && d.startDate.split('T')[0] < advancedFilters.startDate) return false;
      if (advancedFilters.endDate && d.startDate.split('T')[0] > advancedFilters.endDate) return false;

      if (advancedFilters.trainingLocal && (d.trainingLocal || '') !== advancedFilters.trainingLocal) return false;
      if (advancedFilters.corredor && (d.corredor || '') !== advancedFilters.corredor) return false;
      if (advancedFilters.demandState && (d.demandState || '') !== advancedFilters.demandState) return false;
      if (!matchesModality(d, trainingsById, advancedFilters.modality)) return false;

      return true;
    })
    .sort((a, b) => {
      // ⚠️ Precisa existir:
      // - sort: { key: SortKey; dir: 'asc' | 'desc' }
      // - principalInstructorByDemandId
      // - calculateDemandStatus
      const dir = sort.dir === 'asc' ? 1 : -1;

      const getStatus = (d: Demand) =>
        calculateDemandStatus({
          startDate: d.startDate,
          endDate: d.endDate,
          instructorId: d.instructorId,
          cancelled: d.status === 'CANCELADA',
          trainingLocal: d.trainingLocal,
          modality: d.modality,
        } as any);

      const ai = principalInstructorByDemandId[a.id];
      const bi = principalInstructorByDemandId[b.id];

// helper local para extrair número do ID (ex: DEM-12 -> 12)
// IDs inválidos ou 0 vão para o FINAL da lista
    const idNum = (id: string) => {
      const m = String(id).match(/\d+/);
      const n = m ? Number(m[0]) : NaN;

      // ❌ 0 ou inválido não são IDs válidos
      return !n || n <= 0 ? Number.MAX_SAFE_INTEGER : n;
    };

    const va = (() => {
      switch (sort.key) {
        case 'id':
          return idNum(a.id);
        case 'company':
          return getCompanyName(a.companyId);
        case 'training':
          return getTrainingName(a.trainingId);
        case 'demandState':
          return a.demandState || '';
        case 'trainingLocal':
          return a.trainingLocal || '';
        case 'startDate':
          return a.startDate || '';
        case 'instructor':
          return getInstructorName(ai);
        case 'status':
          return getStatus(a);
        default:
          return idNum(a.id);
      }
    })();

    const vb = (() => {
      switch (sort.key) {
        case 'id':
          return idNum(b.id);
        case 'company':
          return getCompanyName(b.companyId);
        case 'training':
          return getTrainingName(b.trainingId);
        case 'demandState':
          return b.demandState || '';
        case 'trainingLocal':
          return b.trainingLocal || '';
        case 'startDate':
          return b.startDate || '';
        case 'instructor':
          return getInstructorName(bi);
        case 'status':
          return getStatus(b);
        default:
          return idNum(b.id);
      }
    })();

    // ✅ comparação correta
    if (sort.key === 'id') {
      return dir * (Number(va) - Number(vb));
    }

    return dir * String(va).localeCompare(String(vb), 'pt-BR', {
      sensitivity: 'base',
    });
    });
}, [
 demands,
  filter,
  advancedFilters,
  companies,
  trainings,
  trainingsById,
  regions,
  instructors,
  isCoordinator,
  sort,
  principalInstructorByDemandId,
]);


  const {
    currentPage: demandPage,
    totalPages: demandTotalPages,
    itemsPerPage: demandItemsPerPage,
    paginatedItems: paginatedDemands,
    startIdx: demandStartIdx,
    setCurrentPage: setDemandPage,
    handleItemsPerPageChange: handleDemandItemsPerPage,
  } = usePagination<Demand>(filteredDemands, 'pagination:demands');

  // ✅ Mantém o instructorId do modal alinhado ao instrutor principal calculado
  // Só sincroniza enquanto estiver em VIEW (não atrapalha edição no FORM)
  useEffect(() => {
    if (!isModalOpen) return;
    if (modalSubMode !== 'VIEW') return;
    if (!formDemand?.id) return;

    const principalId = principalInstructorByDemandId[formDemand.id];
    if (!principalId) return;

    if (principalId === formDemand.instructorId) return;

    setFormDemand(prev => ({
      ...prev,
      instructorId: principalId
    }));
  }, [
    isModalOpen,
    modalSubMode,
    formDemand?.id,
    formDemand?.instructorId,
    principalInstructorByDemandId
  ]);

  useEffect(() => {
    if (!formDemand.trainingId) return;

    const t = trainings.find(t => t.id === formDemand.trainingId);
    if (!t?.modality) return;

    setFormDemand(prev => {
      if (prev.modality === t.modality) return prev;
      return { ...prev, modality: t.modality };
    });
  }, [formDemand.trainingId, trainings]);

// Carrega dados persistidos (logística + documentos) ao abrir VIEW/EDIT
useEffect(() => {
  const run = async () => {
    if (!isModalOpen) return;
    if (modalMode === 'CREATE') return;
    if (!formDemand.id) return;

    // ✅ SEMPRE começa vazio ao abrir (evita “herdar” docs de outra demanda)
    setDbDocs({});

    // 1) Documentos
    try {
      const docs = await fetchDemandDocumentsByDemandId(formDemand.id);
      const mapped: Record<string, { name: string; path: string | null; is_na?: boolean }> = {};

      for (const d of docs as any[]) {
        mapped[d.doc_type] = {
          name: d.file_name || d.doc_type,
          path: d.file_path ?? null,
          is_na: !!d.is_na,
        };
}
      setDbDocs(mapped);
    } catch (e) {
      // silencioso (mas garante vazio)
      setDbDocs({});
    }

    // 2) Logística (logistic_allocations + logistic_blocks)
    try {
      const { data, error } = await fetchLogisticByDemandId(formDemand.id);
      if (error) throw error;

      // Mapeia modo de transporte do banco para o tipo da UI
      const dbTransportToUI = (mode: string | null): TransportType => {
        if (mode === 'CARRO_ALUGADO') return 'Carro Alugado';
        if (mode === 'CARRO_PROPRIO') return 'Carro Próprio';
        if (mode === 'TAXI') return 'Táxi';
        if (mode === 'CARRO_APLICATIVO') return 'Carro Aplicativo';
        if (mode === 'OUTROS') return 'Outros';
        if (mode === 'NAO_NECESSARIO' || mode === 'NA') return 'N/A';
        return null;
      };

      const dbLodgingToUI = (mode: string | null): AccommodationType => {
        if (mode === 'PRECISA_HOTEL') return 'Hotel';
        if (mode === 'NAO_NECESSARIO' || mode === 'NA') return 'N/A';
        return null;
      };

      // Converte uma row de logistic_blocks para LogisticaLocomocao
      const blockToLocomocaoUI = (b: LogisticBlockRow): LogisticaLocomocao => ({
        id: b.id,
        instructorName: b.instructor_name ?? undefined,
        instructorId: b.instructor_id ?? null,
        transportType: dbTransportToUI(b.transport_mode),
        rentalCompany: (b.rental_company as RentalCompany) ?? 'Localiza',
        rentalAgencyLocation: b.rental_agency_location ?? '',
        rentalLocator: b.rental_locator ?? '',
        carCategory: b.car_category ?? 'Grupo CE',
        rentalCheckIn: isoToLocalDTL(b.rental_check_in) ?? '',
        rentalCheckOut: isoToLocalDTL(b.rental_check_out) ?? '',
        receiptUrls: Array.isArray(b.receipt_url) ? b.receipt_url : b.receipt_url ? [b.receipt_url as unknown as string] : undefined,
        otherTransportDescription: b.transport_other_description ?? '',
      });

      // Converte uma row de logistic_blocks para LogisticaHospedagem
      const blockToHospedagemUI = (b: LogisticBlockRow): LogisticaHospedagem => ({
        id: b.id,
        instructorName: b.instructor_name ?? undefined,
        instructorId: b.instructor_id ?? null,
        accommodationType: dbLodgingToUI(b.lodging_mode),
        hotelCity: b.hotel_city ?? '',
        hotelName: b.hotel_name ?? '',
        hotelCheckIn: isoToDateOnly(b.hotel_check_in) ?? '',
        hotelCheckOut: isoToDateOnly(b.hotel_check_out) ?? '',
        hotelPayment: (b.hotel_payment as PaymentMethod) ?? null,
        hotelReceiptUrls: Array.isArray(b.hotel_receipt_urls) ? b.hotel_receipt_urls : b.hotel_receipt_urls ? [b.hotel_receipt_urls as unknown as string] : undefined,
      });

      // Busca blocos específicos por instrutor (nova tabela)
      let locoBlocks: LogisticaLocomocao[] = [];
      let hospBlocks: LogisticaHospedagem[] = [];

      try {
        const rawBlocks = await fetchLogisticBlocksByDemandId(formDemand.id);
        const locoRaw = rawBlocks.filter(b => b.block_type === 'LOCOMOCAO');
        const hospRaw = rawBlocks.filter(b => b.block_type === 'HOSPEDAGEM');

        if (locoRaw.length > 0) locoBlocks = locoRaw.map(blockToLocomocaoUI);
        if (hospRaw.length > 0) hospBlocks = hospRaw.map(blockToHospedagemUI);
      } catch (_) {
        // silencioso: tabela pode não existir ainda (migration pendente)
      }

      // Se não há blocos na nova tabela, cria 1 bloco a partir dos campos legados
      if (locoBlocks.length === 0 && data) {
        locoBlocks = [{
          id: generateId(),
          transportType: dbTransportToUI(data.transport_mode),
          rentalCompany: (data.rental_company as RentalCompany) ?? 'Localiza',
          rentalAgencyLocation: data.rental_agency_location ?? '',
          rentalLocator: data.rental_locator ?? '',
          carCategory: data.car_category ?? 'Grupo CE',
          rentalCheckIn: isoToLocalDTL(data.rental_check_in) ?? '',
          rentalCheckOut: isoToLocalDTL(data.rental_check_out) ?? '',
        }];
      }

      if (hospBlocks.length === 0 && data) {
        hospBlocks = [{
          id: generateId(),
          accommodationType: dbLodgingToUI(data.lodging_mode),
          hotelCity: data.hotel_city ?? '',
          hotelName: data.hotel_name ?? '',
          hotelCheckIn: isoToDateOnly(data.hotel_check_in) ?? '',
          hotelCheckOut: isoToDateOnly(data.hotel_check_out) ?? '',
          hotelPayment: (data.hotel_payment as PaymentMethod) ?? null,
        }];
      }

      // Garante ao menos 1 bloco vazio em cada array
      if (locoBlocks.length === 0) locoBlocks = [{ id: generateId(), transportType: null, rentalCompany: 'Localiza', carCategory: 'Grupo CE', rentalAgencyLocation: '', rentalLocator: '' }];
      if (hospBlocks.length === 0) hospBlocks = [{ id: generateId(), accommodationType: null, hotelPayment: null }];

      setFormDemand(prev => ({
        ...prev,

        // Status interno (para VIEW não mostrar "Pendente" quando dado já veio do banco)
        logisticsTransport: data
          ? (data.transport_mode === 'CARRO_ALUGADO' || data.transport_mode === 'CARRO_PROPRIO' || data.transport_mode === 'TAXI' || data.transport_mode === 'CARRO_APLICATIVO'
            ? 'CONFIRMADO'
            : data.transport_mode === 'NAO_NECESSARIO' || data.transport_mode === 'NA'
            ? 'NAO_NECESSARIO'
            : '')
          : prev.logisticsTransport,

        logisticsHotel: data
          ? (data.lodging_mode === 'PRECISA_HOTEL'
            ? 'CONFIRMADO'
            : data.lodging_mode === 'NAO_NECESSARIO' || data.lodging_mode === 'NA'
            ? 'NAO_NECESSARIO'
            : '')
          : prev.logisticsHotel,

        // Novos arrays de blocos
        logisticasLocomocao: locoBlocks,
        logisticasHospedagem: hospBlocks,
      }));
    } catch (e) {
      // silencioso
    }
  };

  run();
}, [isModalOpen, modalMode, modalSubMode, formDemand.id]);

  const toggleSort = (key: SortKey) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };


  const clearFilters = () => {
    setFilter('');
    setAdvancedFilters({
      companyId: '',
      regionId: '',
      trainingId: '',
      instructorId: '',
      status: '',
      startDate: '',
      endDate: '',
      trainingLocal: '',
      corredor: '',
      demandState: '',
      modality: ''
    });
  };



  // --- HANDLER DE EXCLUSÃO (REAL COM VALIDAÇÃO) ---
        const handleDeleteDemand = () => {
      if (!formDemand?.id) {
        console.error('ID da demanda não encontrado');
        return;
      }

      if (!canPerformAction(profile?.role, 'delete_demand')) {
        setNotification({
          type: 'error',
          message: 'Você não tem permissão para excluir demandas.'
        });
        return;
      }

      const currentStatus = calculateDemandStatus({
      startDate: formDemand.startDate!,
      endDate: formDemand.endDate!,
      instructorId: formDemand.instructorId,
      cancelled: formDemand.status === 'CANCELADA',
      trainingLocal: formDemand.trainingLocal,
      modality: formDemand.modality,
    } as any);


      if (currentStatus === 'CONCLUIDA') {
        setShowDeleteBlocked(true);
        setConfirmDelete(false);
        setTimeout(() => setShowDeleteBlocked(false), 3000);
        return;
      }

      deleteDemand(formDemand.id);
      logAction({
        modulo: 'Demandas',
        acao: 'Cancelar',
        descricao: [
          `Demanda ${formDemand.id} excluída`,
          `Empresa: ${getCompanyName(formDemand.companyId!)}`,
          `Treinamento: ${getTrainingName(formDemand.trainingId!)}`,
          `Início: ${formatDateTime(formDemand.startDate)}`,
        ].join(' | '),
        dadosAntes: formDemand,
        dadosDepois: null,
      });
      // Marca todos os logs históricos dessa demanda como pertencentes a uma demanda excluída.
      //
      // ⚠️ O filtro anterior era `.like('descricao', '%DEM-63%')` — casamento por
      // substring: excluir DEM-63 marcava DEM-631, DEM-6301 e qualquer outra
      // demanda cujo ID começasse igual, sumindo com elas da trilha. Agora o LIKE
      // só pré-seleciona candidatos no banco e o ID é confirmado por limite de
      // palavra no cliente — mesma regra (\bDEM-\d+\b) que Audit.tsx usa pra
      // agrupar os logs por demanda.
      void (async (demandaId: string) => {
        try {
          const { data, error } = await supabase
            .from('audit_logs')
            .select('id, descricao')
            .like('descricao', `%${demandaId}%`)
            .lt('created_at', new Date().toISOString());

          if (error) {
            console.error('[audit] falha ao buscar logs da demanda excluída:', error);
            return;
          }

          const idExato = new RegExp(`\\b${demandaId}\\b`);
          const alvos = (data ?? [])
            .filter(l => idExato.test(l.descricao ?? ''))
            .map(l => l.id);

          if (alvos.length === 0) return;

          const { error: updateError } = await supabase
            .from('audit_logs')
            .update({ demanda_excluida: true })
            .in('id', alvos);

          if (updateError) {
            console.error('[audit] falha ao marcar logs como demanda excluída:', updateError);
          }
        } catch (e) {
          console.error('[audit] exceção ao marcar logs como demanda excluída:', e);
        }
      })(formDemand.id);
      setShowDeleteMessage(true);
      setConfirmDelete(false);
      setTimeout(() => setShowDeleteMessage(false), 3000);
      setIsModalOpen(false);
    };


  // --- HANDLER DE CANCELAMENTO ---
  const handleCancelDemand = () => {
    if (!formDemand?.id || !selectedCancelReason) return;
    
    const cancelData = {
      ...formDemand as Demand,
      status: 'CANCELADA' as DemandStatus,
      cancelReason: selectedCancelReason,
      cancelledAt: new Date().toISOString(),
      cancelInfo: {
        reason: selectedCancelReason,
        note: cancelTextNote,
        date: new Date().toISOString()
      }
    };
    
    updateDemand(cancelData);
    logAction({
      modulo: 'Demandas',
      acao: 'Cancelar',
      descricao: [
        `Demanda ${cancelData.id} cancelada`,
        `Empresa: ${getCompanyName(cancelData.companyId)}`,
        `Treinamento: ${getTrainingName(cancelData.trainingId)}`,
        `Motivo: ${cancelData.cancelReason || 'não informado'}`,
        cancelTextNote ? `Obs: ${cancelTextNote}` : null,
      ].filter(Boolean).join(' | '),
      dadosAntes: formDemand,
      dadosDepois: cancelData,
    });
    setFormDemand(cancelData);
    setConfirmCancel(false);
    setSelectedCancelReason('');
    setCancelTextNote('');
  };

  // --- HANDLER DE REATIVAÇÃO ---
  const handleReactivateDemand = () => {
    if (!formDemand?.id) return;
    
    // 1. Limpar Agenda (itens manuais vinculados)
    agendaItems
      .filter(item => item.relatedDemandId === formDemand.id)
      .forEach(item => removeAgendaItem(item.id));

    // 2. Resetar Medição
    const measurement = measurements.find(m => m.demandId === formDemand.id);
    if (measurement) {
      updateMeasurement({
        ...measurement,
        status: 'NAO_INICIADA',
        attachments: [],
        otherExpenses: [],
        updatedAt: new Date().toISOString()
      });
    }

    // 3. Atualizar Demanda
    const reactivateData = {
      ...formDemand as Demand,
      status: 'NOVA' as DemandStatus,
      instructorId: undefined,
      cancelledAt: undefined,
      cancelReason: undefined,
      cancelInfo: undefined
    };
    
    updateDemand(reactivateData);
    setFormDemand(reactivateData);
    setConfirmReactivate(false);
  };

  /**
   * Modelo de exibição do documento da demanda (Word / e-mail / WhatsApp).
   * A montagem em si vive em services/demandDocument.ts, compartilhada com a
   * demanda interna — aqui só se resolvem os nomes e os formatos.
   */
  const buildDemandDocFields = (): DemandDocFields => {
    const trainingData = trainings.find(t => t.id === formDemand.trainingId);

    const currentStatus = calculateDemandStatus({
      startDate: formDemand.startDate!,
      endDate: formDemand.endDate!,
      instructorId: formDemand.instructorId,
      cancelled: formDemand.status === 'CANCELADA',
      trainingLocal: formDemand.trainingLocal,
      modality: formDemand.modality,
    } as any);

    const diasEspecificos =
      formDemand.dateMode === 'DIAS_ESPECIFICOS' &&
      Array.isArray(formDemand.specificDates) &&
      formDemand.specificDates.length > 0
        ? [...formDemand.specificDates]
            .sort((a, b) => a.data.localeCompare(b.data))
            .map(e => `${new Date(e.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${e.horarioInicio}-${e.horarioFim}`)
            .join(', ')
        : null;

    // Fallback para os campos planos legados quando não há blocos multi-instrutor
    const locoBlocks = formDemand.logisticasLocomocao?.length
      ? formDemand.logisticasLocomocao
      : [{ id: '', transportType: formDemand.transportType, rentalCompany: formDemand.rentalCompany, rentalLocator: formDemand.rentalLocator, rentalAgencyLocation: formDemand.rentalAgencyLocation, rentalCheckIn: formDemand.rentalCheckIn, rentalCheckOut: formDemand.rentalCheckOut }];
    const hospBlocks = formDemand.logisticasHospedagem?.length
      ? formDemand.logisticasHospedagem
      : [{ id: '', accommodationType: formDemand.accommodationType, hotelName: formDemand.hotelName, hotelCity: formDemand.hotelCity, hotelCheckIn: formDemand.hotelCheckIn, hotelCheckOut: formDemand.hotelCheckOut, hotelPayment: formDemand.hotelPayment }];

    const trainingName = getTrainingName(formDemand.trainingId!);

    return {
      id: String(formDemand.id ?? ''),
      tituloDocumento: 'DEMANDA DE TREINAMENTO',
      empresaLabel: '🏢 Empresa / Cliente: ',
      empresa: getCompanyName(formDemand.companyId!),
      identificacaoTexto: [{ label: 'Treinamento', value: trainingName }],
      identificacaoWord: [
        { label: '🎓 Treinamento: ', value: trainingName },
        { label: 'Categoria: ', value: trainingData?.category || 'N/A' },
        { label: 'Carga Horária: ', value: `${trainingData?.hours || '0'}h` },
      ],
      modalidade: formDemand.modality!,
      periodo: `${formatDateTime(formDemand.startDate)} até ${formatDateTime(formDemand.endDate)}`,
      diasEspecificos,
      local: formDemand.trainingLocal || 'N/A',
      corredor: formDemand.corredor || 'Não informado',
      estado: formDemand.demandState || 'Não informado',
      regiao: getRegionName(formDemand.regionId!),
      solicitante: formDemand.requester || 'Não informado',
      instrutor: getInstructorName(formDemand.instructorId),
      status: currentStatus.replace('_', ' '),
      observacoes: formDemand.observations || 'N/A',
      loco: locoBlocks.map((b: any) => ({
        instructorName: b.instructorName,
        transportType: b.transportType,
        rentalCompany: b.rentalCompany,
        rentalLocator: b.rentalLocator,
        rentalAgencyLocation: b.rentalAgencyLocation,
        rentalCheckIn: b.rentalCheckIn ? formatDateTime(b.rentalCheckIn) : null,
        rentalCheckOut: b.rentalCheckOut ? formatDateTime(b.rentalCheckOut) : null,
      })),
      hosp: hospBlocks.map((b: any) => ({
        instructorName: b.instructorName,
        accommodationType: b.accommodationType,
        hotelName: b.hotelName,
        hotelCity: b.hotelCity,
        hotelCheckIn: b.hotelCheckIn ? formatDateTime(b.hotelCheckIn) : null,
        hotelCheckOut: b.hotelCheckOut ? formatDateTime(b.hotelCheckOut) : null,
        hotelPayment: b.hotelPayment,
      })),
    };
  };

  const getDemandContentString = (isWhatsApp = false) =>
    buildDemandTextContent(buildDemandDocFields(), isWhatsApp);

  const handleGenerateWord = async () => {
    const trainingName = getTrainingName(formDemand.trainingId!);
    const startStr = formDemand.startDate?.split('T')[0] || 'data';
    const instructorName = getInstructorName(formDemand.instructorId).split(' ')[0] || 'NaoAlocado';
    const fileName = `Demanda_${trainingName.replace(/\s+/g, '_')}_${startStr}_${instructorName}.docx`;

    await downloadDemandWord(buildDemandDocFields(), fileName);
  };


  const handleSendEmail = () => {
    const training = getTrainingName(formDemand.trainingId!);
    const start = formatDateTime(formDemand.startDate).split(' ')[0];
    const subject = encodeURIComponent(`Demanda de Treinamento – ${training} – ${start}`);
    const introText = "Olá,\n\nSeguem abaixo os dados da demanda de treinamento para sua análise e organization:\n\n";
    const body = encodeURIComponent(introText + getDemandContentString(false) + "\n\nAtenciosamente,\nEquipe de Gestão Colabor.");
    
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleSendWhatsApp = () => {
    const text = encodeURIComponent(`Olá! Seguem os dados da demanda de treinamento:\n\n${getDemandContentString(true)}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleOpenCreate = () => {
    setActiveDemand(null);
    setFormDemand(initialDemandState());
    setModalMode('CREATE');
    setModalSubMode('FORM');
    setOpenSections({ geral: true, internos: true, locomocao: true, hospedagem: true, documentos: true });
    setConfirmDelete(false);
    setConfirmCancel(false);
    setConfirmReactivate(false);
    setResourceError(null);
    setPendingPdfs({ classList: null, instructorRelease: null });
    setDbDocs({});
    setIsModalOpen(true);
    didSyncEditTimesRef.current = false;
  };

 const handleOpenView = (demand: Demand) => {
  setActiveDemand(demand);
  setFormDemand({ ...demand });
  setModalMode('EDIT');
  setPendingPdfs({ classList: null, instructorRelease: null });
  setDbDocs({});
  didSyncEditTimesRef.current = false;

  // 🔐 PASSO 3.3 — CONTROLE DE SUBMODE
  // Coordenador: sempre VIEW
  // Admin / Analista: começam em VIEW, mas podem editar
  setModalSubMode('VIEW');

  setOpenSections({
    geral: true,
    internos: true,
    locomocao: true,
    hospedagem: true,
    documentos: false
  });

  setConfirmDelete(false);
  setConfirmCancel(false);
  setConfirmReactivate(false);
  setResourceError(null);
  setIsModalOpen(true);
};



// ⚠️ A conversão de data/hora (demanda e logística) mora em
// domain/demandDateTime.ts. Não reintroduzir cópia local aqui — em especial,
// NÃO passe startDate/endDate por new Date()/toISOString().

const handleSave = async () => {
  if (!isFormValid) return;

  // ⛔ trava clique duplo
  if (isSaving) return;

  // Aviso de data alterada com instrutor alocado (apenas no EDIT)
  if (!bypassDateWarning.current && modalMode === 'EDIT') {
    const alocacoesVinculadas = instructorAllocations.filter(a => a.demandId === formDemand.id);
    const dataAlterou =
      formDemand.startDate?.slice(0, 10) !== activeDemand?.startDate?.slice(0, 10) ||
      formDemand.endDate?.slice(0, 10) !== activeDemand?.endDate?.slice(0, 10);
    if (alocacoesVinculadas.length > 0 && dataAlterou) {
      setConfirmDateChange(true);
      return;
    }
  }
  bypassDateWarning.current = false;

  // Aviso de local alterado com instrutor alocado (apenas no EDIT, e apenas se data não mudou)
  if (!bypassLocalWarning.current && modalMode === 'EDIT') {
    const alocacoesVinculadas = instructorAllocations.filter(a => a.demandId === formDemand.id);
    const dataAlterou =
      formDemand.startDate?.slice(0, 10) !== activeDemand?.startDate?.slice(0, 10) ||
      formDemand.endDate?.slice(0, 10) !== activeDemand?.endDate?.slice(0, 10);
    const localAlterou = (formDemand.trainingLocal ?? '') !== (activeDemand?.trainingLocal ?? '');
    if (alocacoesVinculadas.length > 0 && localAlterou && !dataAlterou) {
      setConfirmLocalChange(true);
      return;
    }
  }
  bypassLocalWarning.current = false;

  setIsSaving(true);


  try {
    // ✅ DIAS ESPECÍFICOS: derivar startDate/endDate como min/max antes de validar
    let derivedStart = formDemand.startDate || '';
    let derivedEnd = formDemand.endDate || '';
    const isSpecificMode = formDemand.dateMode === 'DIAS_ESPECIFICOS';

    if (isSpecificMode && Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0) {
      const sorted = [...formDemand.specificDates].sort((a, b) => a.data.localeCompare(b.data));
      derivedStart = `${sorted[0].data}T${sorted[0].horarioInicio}`;
      derivedEnd = `${sorted[sorted.length - 1].data}T${sorted[sorted.length - 1].horarioFim}`;
    }

    // ✅ Validação de datas SEM timezone (datetime-local ordena corretamente)
    if (!isSpecificMode && derivedStart && derivedEnd) {
      if (String(derivedStart) > String(derivedEnd)) {
        setResourceError('A data de início não pode ser maior que a data de fim.');
        setTimeout(() => setResourceError(null), 4000);
        return;
      }
    }

    // Deriva campos do bloco primário (index 0) para alimentar logistic_allocations (checklist)
    const primaryLoco = formDemand.logisticasLocomocao?.[0];
    const primaryHosp = formDemand.logisticasHospedagem?.[0];

    // ✅ ONLINE: não pode gerar pendência de logística / local
    const sanitizedDemand: Demand = {
      ...(formDemand as Demand),

      // ✅ dateMode e specificDates
      dateMode: formDemand.dateMode || 'CONTINUO',
      specificDates: isSpecificMode ? (formDemand.specificDates || []) : undefined,

      // ✅ startDate/endDate derivados (min/max) ou do form
      startDate: (derivedStart || '') as any,
      endDate: (derivedEnd || '') as any,

      // ✅ prática híbrida (se existir) também em ISO estável
      practiceStartDate: ((formDemand as any).practiceStartDate || null) as any,
      practiceEndDate: ((formDemand as any).practiceEndDate || null) as any,

      // O local NÃO é mais zerado nas modalidades sem logística: o online passou
      // a aceitar local real (ou 'N/A' explícito). Segue opcional na validação.
      trainingLocal: formDemand.trainingLocal || '',
      regionId: formDemand.regionId || '',

      logisticsTransport:
        !requiresLogistics(formDemand.modality)
          ? 'NAO_NECESSARIO'
          : (formDemand.logisticsTransport ?? ''),

      logisticsHotel:
        !requiresLogistics(formDemand.modality)
          ? 'NAO_NECESSARIO'
          : (formDemand.logisticsHotel ?? ''),

      // Campos planos derivados do bloco 0 (para logistic_allocations e retrocompatibilidade)
      transportType: !requiresLogistics(formDemand.modality) ? null : (primaryLoco?.transportType ?? null),
      accommodationType: !requiresLogistics(formDemand.modality) ? null : (primaryHosp?.accommodationType ?? null),

      rentalCompany: primaryLoco?.rentalCompany ?? 'Localiza',
      carCategory: primaryLoco?.carCategory ?? 'Grupo CE',
      rentalAgencyLocation: !requiresLogistics(formDemand.modality) ? '' : (primaryLoco?.rentalAgencyLocation || ''),
      rentalLocator: !requiresLogistics(formDemand.modality) ? '' : (primaryLoco?.rentalLocator || ''),
      rentalCheckIn: !requiresLogistics(formDemand.modality) ? '' : (primaryLoco?.rentalCheckIn || ''),
      rentalCheckOut: !requiresLogistics(formDemand.modality) ? '' : (primaryLoco?.rentalCheckOut || ''),

      hotelName: !requiresLogistics(formDemand.modality) ? '' : (primaryHosp?.hotelName || ''),
      hotelCity: !requiresLogistics(formDemand.modality) ? '' : (primaryHosp?.hotelCity || ''),
      hotelCheckIn: !requiresLogistics(formDemand.modality) ? '' : (primaryHosp?.hotelCheckIn || ''),
      hotelCheckOut: !requiresLogistics(formDemand.modality) ? '' : (primaryHosp?.hotelCheckOut || ''),
      hotelPayment: !requiresLogistics(formDemand.modality) ? null : (primaryHosp?.hotelPayment ?? null),
    };


    setResourceError(null);

    let demandId = (formDemand.id || sanitizedDemand.id) as string | undefined;
    // ⚠️ No CREATE com Supabase, o ID final vem do addDemand.
    // Então aqui só mantemos demandId se já existir (ex.: EDIT / mock / casos legados).

    if (modalMode === 'CREATE') {
      const created = await addDemand(sanitizedDemand);
      if (!created?.id) {
        // não prossegue pipeline se não criou a demanda
        return;
      }
      demandId = created.id;
      sanitizedDemand.id = created.id;
      // ⚠️ `await` proposital: sem ele o insert de auditoria corria em paralelo
      // com o resto do pipeline (alocações, documentos, logística) e podia ser
      // abortado pelo fechamento do modal / reload antes de completar — o
      // evento de criação sumia enquanto os demais apareciam.
      const auditoria = await logAction({
        modulo: 'Demandas',
        acao: 'Criar',
        descricao: [
          `Demanda ${sanitizedDemand.id} criada`,
          `Empresa: ${getCompanyName(sanitizedDemand.companyId)}`,
          `Treinamento: ${getTrainingName(sanitizedDemand.trainingId)}`,
          `Início: ${formatDateTime(sanitizedDemand.startDate)}`,
          sanitizedDemand.trainingLocal ? `Local: ${sanitizedDemand.trainingLocal}` : null,
        ].filter(Boolean).join(' | '),
        dadosDepois: sanitizedDemand,
      });
      // Falha de auditoria não desfaz nem bloqueia a criação: a demanda já está
      // no banco. Mas também não pode passar em branco — o usuário precisa
      // saber que a trilha ficou incompleta pra essa demanda.
      if (!auditoria.ok) {
        setNotification({
          message: `Demanda ${sanitizedDemand.id} criada, mas o registro de auditoria falhou. Avise o suporte.`,
          type: 'error',
        });
      }
    } else {
      await Promise.resolve(updateDemand(sanitizedDemand));
      demandId = demandId ?? sanitizedDemand.id;
      {
        const before = activeDemand;
        const diffParts: string[] = [];
        if (before) {
          // Compara a PAREDE ("YYYY-MM-DDTHH:mm"), não o instante: o valor vindo
          // do banco traz "+00:00" e o do form não, então new Date() acusava
          // mudança em toda edição.
          const nd = (d: any) => (d ? toDemandDateTimeInput(d) : '');

          // Informações gerais
          if (before.companyId !== sanitizedDemand.companyId)
            diffParts.push(`Empresa: ${getCompanyName(before.companyId)} → ${getCompanyName(sanitizedDemand.companyId)}`);
          if (before.trainingId !== sanitizedDemand.trainingId)
            diffParts.push(`Treinamento: ${getTrainingName(before.trainingId)} → ${getTrainingName(sanitizedDemand.trainingId)}`);
          if (before.trainingLocal !== sanitizedDemand.trainingLocal)
            diffParts.push(`Local: ${before.trainingLocal || '—'} → ${sanitizedDemand.trainingLocal || '—'}`);
          if (before.regionId !== sanitizedDemand.regionId)
            diffParts.push(`Região: ${getRegionName(before.regionId)} → ${getRegionName(sanitizedDemand.regionId)}`);
          if ((before.corredor || '') !== (sanitizedDemand.corredor || ''))
            diffParts.push(`Corredor: ${before.corredor || '—'} → ${sanitizedDemand.corredor || '—'}`);
          if ((before.demandState || '') !== (sanitizedDemand.demandState || ''))
            diffParts.push(`Estado: ${before.demandState || '—'} → ${sanitizedDemand.demandState || '—'}`);
          if (before.modality !== sanitizedDemand.modality)
            diffParts.push(`Modalidade: ${before.modality} → ${sanitizedDemand.modality}`);
          if ((before.requester || '') !== (sanitizedDemand.requester || ''))
            diffParts.push(`Solicitante: ${before.requester || '—'} → ${sanitizedDemand.requester || '—'}`);
          if (nd(before.startDate) !== nd(sanitizedDemand.startDate))
            diffParts.push(`Início: ${formatDateTime(before.startDate)} → ${formatDateTime(sanitizedDemand.startDate)}`);
          if (nd(before.endDate) !== nd(sanitizedDemand.endDate))
            diffParts.push(`Fim: ${formatDateTime(before.endDate)} → ${formatDateTime(sanitizedDemand.endDate)}`);
          if ((before.observations || '') !== (sanitizedDemand.observations || ''))
            diffParts.push(`Observações: ${before.observations || '—'} → ${sanitizedDemand.observations || '—'}`);

          // Dados internos
          if ((before.approver || '') !== (sanitizedDemand.approver || ''))
            diffParts.push(`Aprovador: ${before.approver || '—'} → ${sanitizedDemand.approver || '—'}`);
          if ((before.analyst || '') !== (sanitizedDemand.analyst || ''))
            diffParts.push(`Analista: ${before.analyst || '—'} → ${sanitizedDemand.analyst || '—'}`);
          if ((before.matriculador || '') !== (sanitizedDemand.matriculador || ''))
            diffParts.push(`Matriculador: ${before.matriculador || '—'} → ${sanitizedDemand.matriculador || '—'}`);

          // Logística
          if ((before.transportType || '') !== (sanitizedDemand.transportType || ''))
            diffParts.push(`Transporte: ${before.transportType || '—'} → ${sanitizedDemand.transportType || '—'}`);
          if ((before.accommodationType || '') !== (sanitizedDemand.accommodationType || ''))
            diffParts.push(`Hospedagem: ${before.accommodationType || '—'} → ${sanitizedDemand.accommodationType || '—'}`);

          // Instrutor / Status
          if (before.instructorId !== sanitizedDemand.instructorId)
            diffParts.push(`Instrutor: ${getInstructorName(before.instructorId)} → ${getInstructorName(sanitizedDemand.instructorId)}`);
          if (before.status !== sanitizedDemand.status)
            diffParts.push(`Status: ${before.status} → ${sanitizedDemand.status}`);
        }
        const diffDesc = diffParts.length ? ` — Alterações: ${diffParts.join(' | ')}` : '';
        logAction({
          modulo: 'Demandas',
          acao: 'Editar',
          descricao: `Demanda ${sanitizedDemand.id} editada${diffDesc}`,
          dadosAntes: before ?? undefined,
          dadosDepois: sanitizedDemand,
        });
      }

      // Sync das alocações quando o DIA da demanda muda.
      //
      // ⚠️ Era aqui que estava o estrago: este bloco REESCREVIA todas as
      // alocações da demanda para o período novo cheio. Acompanhante (uma linha
      // por dia) recebia um UPDATE em lote com o mesmo par de datas — três dias
      // viravam três cards no mesmo dia; e alocação de SPLIT era expandida para
      // o período inteiro, fazendo o rateio pagar a carga cheia a cada
      // instrutor (16h viram 32h).
      //
      // A regra agora é uma só e mora no domínio: RECORTE, NUNCA CÓPIA.
      // Ver domain/allocationReschedule.ts.
      const dataAlterou =
        sanitizedDemand.startDate?.slice(0, 10) !== activeDemand?.startDate?.slice(0, 10) ||
        sanitizedDemand.endDate?.slice(0, 10) !== activeDemand?.endDate?.slice(0, 10);

      if (dataAlterou) {
        const plano = planAllocationReschedule({
          diasAntigos: activeDemand ? getDemandDays(activeDemand as any) : [],
          diasNovos: getDemandDays(sanitizedDemand as any),
          horaInicio: (sanitizedDemand.startDate ?? '').slice(11) || '08:00',
          horaFim: (sanitizedDemand.endDate ?? '').slice(11) || '18:00',
          allocations: instructorAllocations.filter(a => a.demandId === sanitizedDemand.id),
          companions: companionAllocations.filter(ca => ca.demandId === sanitizedDemand.id),
          participants: demandParticipants.filter(pt => pt.demandId === sanitizedDemand.id),
        });

        // --- instrutor ---
        for (const a of [...plano.allocations.paraPeriodoCheio, ...plano.allocations.paraRecortar]) {
          const original = instructorAllocations.find(x => x.id === a.id);
          if (original) {
            updateInstructorAllocation({ ...original, startDate: a.startDate, endDate: a.endDate });
          }
        }
        for (const a of plano.allocations.paraRemover) removeInstructorAllocation(a.id);

        // --- acompanhante: o dia NÃO muda; sai quem não tem mais dia ---
        for (const ca of plano.companions.paraRemover) removeCompanionAllocation(ca.id);
        for (const ca of plano.companions.paraAtualizar) {
          try {
            await updateCompanionAllocationDates(ca.id, ca.startDate, ca.endDate);
          } catch (e) {
            console.error('Erro ao sincronizar horário do acompanhante:', e);
          }
        }

        // --- participante ---
        for (const pt of plano.participants.paraRecortar) {
          try {
            await updateDemandParticipantPeriod(pt.id, pt.startDate, pt.endDate);
          } catch (e) {
            console.error('Erro ao recortar período do participante:', e);
          }
        }
        for (const pt of plano.participants.paraLimparPeriodo) {
          try {
            await updateDemandParticipantPeriod(pt.id, null, null);
          } catch (e) {
            console.error('Erro ao limpar período do participante:', e);
          }
        }

        // --- aviso único, para ninguém descobrir o recorte pela agenda ---
        const avisos = describeReschedule(plano, getInstructorName);
        if (avisos.length > 0) {
          setNotification({ type: 'info', message: avisos.join(' ') });
        }
      }

      // Sync silencioso de horário quando apenas HH:mm muda (data permanece igual)
      const horarioAlterou =
        (sanitizedDemand.startDate ?? '').slice(11) !== (activeDemand?.startDate ?? '').slice(11) ||
        (sanitizedDemand.endDate ?? '').slice(11) !== (activeDemand?.endDate ?? '').slice(11);

      if (!dataAlterou && horarioAlterou) {
        const novaHoraInicio = (sanitizedDemand.startDate ?? '').slice(11);
        const novaHoraFim = (sanitizedDemand.endDate ?? '').slice(11);

        const alocacoesVinculadas = instructorAllocations.filter(
          a => a.demandId === sanitizedDemand.id
        );

        alocacoesVinculadas.forEach(alloc => {
          updateInstructorAllocation({
            ...alloc,
            startDate: `${alloc.startDate.slice(0, 10)}T${novaHoraInicio}`,
            endDate: `${alloc.endDate.slice(0, 10)}T${novaHoraFim}`,
          });
        });

        const companionsVinculados = companionAllocations.filter(
          ca => ca.demandId === sanitizedDemand.id
        );
        for (const comp of companionsVinculados) {
          try {
            await supabase
              .from('companion_allocations')
              .update({
                start_date: `${comp.startDate.slice(0, 10)}T${novaHoraInicio}`,
                end_date: `${comp.endDate.slice(0, 10)}T${novaHoraFim}`,
              })
              .eq('id', comp.id);
          } catch (e) {
            console.error('Erro ao sincronizar horário do acompanhante:', e);
          }
        }
      }
    }

    if (!demandId) {
      setIsModalOpen(false);
      setFormDemand(initialDemandState());
      setActiveDemand(null);
      return;
    }

    // ==============================
    // ✅ FIX PRINCIPAL: N/A é resposta
    // ==============================
    const isOnline = !requiresLogistics(sanitizedDemand.modality);
    const isCarRental = sanitizedDemand.transportType === 'Carro Alugado';
    const isHotel = sanitizedDemand.accommodationType === 'Hotel';

    // ✅ transport_mode / lodging_mode: N/A vira 'NA' (não null)
    const transportModeToDb = isOnline
      ? 'NAO_NECESSARIO'
      : sanitizedDemand.transportType === 'Carro Alugado'
      ? 'CARRO_ALUGADO'
      : sanitizedDemand.transportType === 'Carro Próprio'
      ? 'CARRO_PROPRIO'
      : sanitizedDemand.transportType === 'Táxi'
      ? 'TAXI'
      : sanitizedDemand.transportType === 'Carro Aplicativo'
      ? 'CARRO_APLICATIVO'
      : sanitizedDemand.transportType === 'Outros'
      ? 'OUTROS'
      : sanitizedDemand.transportType === 'N/A'
      ? 'NA'
      : null;

    const lodgingModeToDb = isOnline
      ? 'NAO_NECESSARIO'
      : sanitizedDemand.accommodationType === 'Hotel'
      ? 'PRECISA_HOTEL'
      : sanitizedDemand.accommodationType === 'N/A'
      ? 'NA'
      : null;

    // flags coerentes com a regra:
    // - tem carro/hotel se respondeu qualquer coisa (incluindo N/A)
    const hasCarFlag = isOnline ? false : transportModeToDb != null;
    const hasHotelFlag = isOnline ? false : lodgingModeToDb != null;

    // 3) Logística — salva no CREATE e no EDIT
    try {
      const hotelPaymentSafe = isHotel ? (sanitizedDemand.hotelPayment || 'Faturado') : null;
      const rentalCompanySafe = isCarRental ? (sanitizedDemand.rentalCompany || 'Localiza') : null;
      const carCategorySafe = isCarRental ? (sanitizedDemand.carCategory || 'Grupo CE') : null;

      await upsertLogisticByDemandId(demandId, {
        // datas base da demanda
       start_date: sanitizedDemand.startDate?.slice(0, 10) ?? null,
        end_date: sanitizedDemand.endDate?.slice(0, 10) ?? null,



        // ✅ modos (com N/A persistido)
        transport_mode: transportModeToDb,
        lodging_mode: lodgingModeToDb,

        // ===== DETALHES CARRO ALUGADO =====
        rental_company: isOnline ? null : rentalCompanySafe,
        rental_agency_location: !isOnline && isCarRental ? (sanitizedDemand.rentalAgencyLocation || null) : null,
        rental_locator: !isOnline && isCarRental ? (sanitizedDemand.rentalLocator || null) : null,
        car_category: isOnline ? null : carCategorySafe,
        rental_check_in: !isOnline && isCarRental ? toIsoFromDateTimeLocalSafe(sanitizedDemand.rentalCheckIn) : null,
        rental_check_out: !isOnline && isCarRental ? toIsoFromDateTimeLocalSafe(sanitizedDemand.rentalCheckOut) : null,

        // ===== DETALHES HOTEL =====
        hotel_city: !isOnline && isHotel ? (sanitizedDemand.hotelCity || null) : null,
        hotel_name: !isOnline && isHotel ? (sanitizedDemand.hotelName || null) : null,
        hotel_check_in: !isOnline && isHotel ? toIsoFromDateInputSafe(sanitizedDemand.hotelCheckIn) : null,
        hotel_check_out: !isOnline && isHotel ? toIsoFromDateInputSafe(sanitizedDemand.hotelCheckOut) : null,
        hotel_payment: isOnline ? null : hotelPaymentSafe,

        // ✅ flags (N/A conta como preenchido)
        has_car: hasCarFlag,
        has_hotel: hasHotelFlag,

        // material continua manual no controle
        overall_status: 'PENDENTE',
      });
    } catch (e) {
      console.error('Erro ao salvar logística:', e);
    }

    // 3b) Salva todos os blocos de logística na tabela logistic_blocks
    try {
      const mapTransportModeToDb = (t?: TransportType | null) => {
        if (t === 'Carro Alugado') return 'CARRO_ALUGADO';
        if (t === 'Carro Próprio') return 'CARRO_PROPRIO';
        if (t === 'Táxi') return 'TAXI';
        if (t === 'Carro Aplicativo') return 'CARRO_APLICATIVO';
        if (t === 'Outros') return 'OUTROS';
        if (t === 'N/A') return 'NA';
        return null;
      };
      const mapLodgingModeToDb = (a?: AccommodationType | null) => {
        if (a === 'Hotel') return 'PRECISA_HOTEL';
        if (a === 'N/A') return 'NA';
        return null;
      };

      const isOnlineBlocks = !requiresLogistics(sanitizedDemand.modality);

      const locoBlockRows = (formDemand.logisticasLocomocao || []).map((b, i) => {
        const tm = isOnlineBlocks ? 'NAO_NECESSARIO' : mapTransportModeToDb(b.transportType);
        const isAlugado = b.transportType === 'Carro Alugado' && !isOnlineBlocks;
        const isOutros = b.transportType === 'Outros' && !isOnlineBlocks;
        const needsReceipt = (b.transportType === 'Táxi' || b.transportType === 'Carro Aplicativo' || isOutros) && !isOnlineBlocks;
        const needsCheckInOut = isAlugado || isOutros;
        return {
          id: b.id,
          block_type: 'LOCOMOCAO',
          block_order: i,
          instructor_name: b.instructorName ?? null,
          // ⚠️ OBRIGATÓRIO carregar o instructor_id aqui. O save é delete-all +
          // insert; se a coluna não vier junto, salvar o formulário de cliente
          // APAGA a identificação que o fluxo de acompanhante gravou. Não muda
          // a semântica do upsert — só impede que ele perca uma coluna.
          instructor_id: b.instructorId ?? null,
          transport_mode: tm,
          rental_company: isAlugado ? (b.rentalCompany || 'Localiza') : null,
          rental_agency_location: isAlugado ? (b.rentalAgencyLocation || null) : null,
          rental_locator: isAlugado ? (b.rentalLocator || null) : null,
          car_category: isAlugado ? (b.carCategory || 'Grupo CE') : null,
          rental_check_in: needsCheckInOut ? toIsoFromDateTimeLocalSafe(b.rentalCheckIn) : null,
          rental_check_out: needsCheckInOut ? toIsoFromDateTimeLocalSafe(b.rentalCheckOut) : null,
          receipt_url: needsReceipt && b.receiptUrls?.length ? b.receiptUrls : null,
          transport_other_description: isOutros ? (b.otherTransportDescription || null) : null,
          lodging_mode: null,
          hotel_city: null,
          hotel_name: null,
          hotel_check_in: null,
          hotel_check_out: null,
          hotel_payment: null,
        };
      });

      const hospBlockRows = (formDemand.logisticasHospedagem || []).map((b, i) => {
        const lm = isOnlineBlocks ? 'NAO_NECESSARIO' : mapLodgingModeToDb(b.accommodationType);
        const isHotel = b.accommodationType === 'Hotel' && !isOnlineBlocks;
        return {
          id: b.id,
          block_type: 'HOSPEDAGEM',
          block_order: i,
          instructor_name: b.instructorName ?? null,
          // Ver a nota do bloco de LOCOMOÇÃO acima.
          instructor_id: b.instructorId ?? null,
          transport_mode: null,
          rental_company: null,
          rental_agency_location: null,
          rental_locator: null,
          car_category: null,
          rental_check_in: null,
          rental_check_out: null,
          lodging_mode: lm,
          hotel_city: isHotel ? (b.hotelCity || null) : null,
          hotel_name: isHotel ? (b.hotelName || null) : null,
          hotel_check_in: isHotel ? toIsoFromDateInputSafe(b.hotelCheckIn) : null,
          hotel_check_out: isHotel ? toIsoFromDateInputSafe(b.hotelCheckOut) : null,
          hotel_payment: isHotel ? (b.hotelPayment || 'Faturado') : null,
          hotel_receipt_urls: isHotel && b.hotelReceiptUrls?.length ? b.hotelReceiptUrls : null,
        };
      });

      await upsertLogisticBlocks(demandId, [...locoBlockRows, ...hospBlockRows]);
    } catch (e) {
      console.error('Erro ao salvar logistic_blocks:', e);
    }

    // 4) PDFs: enviar pendentes (CREATE e EDIT)
    try {
      const hasAnyPdf = !!pendingPdfs.classList || !!pendingPdfs.instructorRelease;

      if (hasAnyPdf) {
        setNotification({
          type: 'info',
          message: 'Enviando PDFs... aguarde.'
        });
      }

      let classUploaded = false;
      let releaseUploaded = false;

      if (pendingPdfs.classList) {
        const res = await uploadAndUpsertDemandPdf(demandId, 'LISTA_TURMA', pendingPdfs.classList);
        if (res.error) throw res.error;
        classUploaded = true;
      }

      if (pendingPdfs.instructorRelease) {
        const res = await uploadAndUpsertDemandPdf(
          demandId,
          'LIBERACAO_INSTRUTOR',
          pendingPdfs.instructorRelease
        );
        if (res.error) throw res.error;
        releaseUploaded = true;
      }

      // Recarrega docs para aparecer no VIEW
      if (classUploaded || releaseUploaded) {
        const docs = await fetchDemandDocumentsByDemandId(demandId);

        const mapped: Record<string, { name: string; path: string | null; is_na?: boolean }> = {};

        for (const d of docs as any[]) {
          mapped[d.doc_type] = {
            name: d.file_name || d.doc_type,
            path: d.file_path ?? null,
            is_na: !!d.is_na,
          };
        }

        setDbDocs(mapped);
      }

      if (hasAnyPdf) {
        setNotification({
          type: 'success',
          message: 'PDF(s) enviado(s) com sucesso.'
        });
      }
    } catch (e: any) {
      console.error('Erro ao enviar PDFs:', e);

      setNotification({
        type: 'error',
        message: `Erro ao enviar PDF. Tente novamente. (${e?.message || e})`
      });
    }


    // 5) garantir measurement (pra Medição não ficar vazia)
    try {
      await upsertMeasurementByDemandId(demandId, {});
    } catch (e) {
      console.error('Erro ao garantir medição:', e);
    }

    // 6) limpar e fechar
    setPendingPdfs({ classList: null, instructorRelease: null });
    setIsModalOpen(false);
    setFormDemand(initialDemandState());
    setActiveDemand(null);

  } finally {
    setIsSaving(false);
  }
};

  const handleOpenAllocationModal = () => {
    if (!formDemand.id) return;

    const usePractice =
      (formDemand.modality === 'HIBRIDO' || formDemand.modality === 'HÍBRIDA' || formDemand.modality === 'HÍBRIDO') &&
      !!(formDemand as any).practiceStartDate &&
      !!(formDemand as any).practiceEndDate;

    const startBase = usePractice
      ? toDemandDateInput((formDemand as any).practiceStartDate)
      : toDemandDateInput(formDemand.startDate);

    const endBase = usePractice
      ? toDemandDateInput((formDemand as any).practiceEndDate)
      : toDemandDateInput(formDemand.endDate);

    setAllocationForm({
      instructorId: '',
      startDate: startBase || '',
      endDate: endBase || ''
    });

    setIsAllocationModalOpen(true);
  };


  const handleAddAllocation = () => {
    if (!allocationForm.instructorId || !allocationForm.startDate || !allocationForm.endDate) {
      setResourceError("Preencha todos os campos da alocação.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

    // Normalização das datas para comparação de limites (considerando apenas as datas, ignorando horas específicas de execução)
    const normalizeStart = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T00:00:00');
    const normalizeEnd = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T23:59:59');

    const allocStartLimit = normalizeStart(allocationForm.startDate);
    const allocEndLimit = normalizeEnd(allocationForm.endDate);
    const demandStartLimit = normalizeStart(formDemand.startDate!);
    const demandEndLimit = normalizeEnd(formDemand.endDate!);

    // 1. Validar limites da demanda (Período inclusivo)
    if (allocStartLimit < demandStartLimit || allocEndLimit > demandEndLimit) {
      setResourceError("O período do instrutor deve estar dentro do período da demanda.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

  const usePractice =
    (formDemand.modality === 'HIBRIDO' || formDemand.modality === 'HÍBRIDA' || formDemand.modality === 'HÍBRIDO') &&
    !!(formDemand as any).practiceStartDate &&
    !!(formDemand as any).practiceEndDate;

    const getHHMMFromISO = (v?: string) => {
  if (!v) return '';
  if (!v.includes('T')) return '';
  return v.split('T')[1].slice(0, 5);
};



  // prática (se existir)
  const practiceStartRaw = (formDemand as any).practiceStartDate as string | undefined;
  const practiceEndRaw   = (formDemand as any).practiceEndDate as string | undefined;

  // datas locais (YYYY-MM-DD) da prática
  const practiceStartDateOnly = toDemandDateInput(practiceStartRaw);
  const practiceEndDateOnly   = toDemandDateInput(practiceEndRaw);

  // horários locais (HH:mm) da prática
  const practiceStartTime = getHHMMFromISO(practiceStartRaw) || '08:00';
  const practiceEndTime   = getHHMMFromISO(practiceEndRaw)   || '18:00';


  // horários locais (HH:mm) da demanda (isso é o que aparece na Visualização da Demanda)
  const demandStartTime = getHHMMFromISO(formDemand.startDate) || '08:00';
  const demandEndTime = getHHMMFromISO(formDemand.endDate) || '18:00';


  // monta datetime local (YYYY-MM-DDTHH:mm)
 const startLocal = usePractice
  ? `${allocationForm.startDate}T${practiceStartTime}`
  : `${allocationForm.startDate}T${demandStartTime}`;

const endLocal = usePractice
  ? `${allocationForm.endDate}T${practiceEndTime}`
  : `${allocationForm.endDate}T${demandEndTime}`;


 // ✅ SALVA SEM CONVERSÃO (mantém HH:mm e não aplica timezone)
  const startIso = startLocal;
  const endIso   = endLocal;





    // PERSISTÊNCIA NO ESTADO GLOBAL
    const newAllocation: InstructorAllocation = {
      id: `ALOC-${Date.now()}`,
      demandId: formDemand.id!,
      instructorId: allocationForm.instructorId,
      startDate: startIso,
      endDate: endIso
    };

    // 2. Validar conflito de agenda do instrutor — em vez de bloquear, abre modal de confirmação
    if (hasScheduleConflict(allocationForm.instructorId, startIso, endIso)) {
      setPendingConflictAllocation(newAllocation);
      return;
    }

    // Classificar qualificação e abrir diálogo de confirmação contextual
    const { suggested, exceptions } = recommendInstructors(formDemand as any);
    const suggestedIds = new Set(suggested.map((i: any) => i.id));
    const exceptionIds = new Set(exceptions.map((i: any) => i.id));
    const instrId = newAllocation.instructorId;

    const allocationCase: 'unqualified' | 'exception' | 'qualified' =
      (!suggestedIds.has(instrId) && !exceptionIds.has(instrId)) ? 'unqualified'
      : exceptionIds.has(instrId) ? 'exception'
      : 'qualified';

    setPendingAllocationData(newAllocation);
    setConfirmAllocationCase(allocationCase);
  };

  const handleExecuteAllocation = () => {
    if (!pendingAllocationData) return;
    addInstructorAllocation(pendingAllocationData);
    if (formDemand.status === 'NOVA' || formDemand.status === 'PENDENTE') {
      const updatedDemand = { ...formDemand, status: 'ALOCADA' as const };
      updateDemand(updatedDemand as any);
      setFormDemand(updatedDemand as any);
    }
    setPendingAllocationData(null);
    setConfirmAllocationCase(null);
    setAllocationForm({ instructorId: '', startDate: '', endDate: '' });
    setIsAllocationModalOpen(false);
  };

  const handleConfirmConflictAllocation = () => {
    if (!pendingConflictAllocation) return;
    addInstructorAllocation(pendingConflictAllocation);
    if (formDemand.status === 'NOVA' || formDemand.status === 'PENDENTE') {
      const updatedDemand = { ...formDemand, status: 'ALOCADA' as const };
      updateDemand(updatedDemand as any);
      setFormDemand(updatedDemand as any);
    }
    setPendingConflictAllocation(null);
    setAllocationForm({ instructorId: '', startDate: '', endDate: '' });
    setIsAllocationModalOpen(false);
  };

  /**
   * Alocação de CTM — fluxo compartilhado com o modal de demanda interna.
   * O slot de erro continua sendo o `resourceError` desta tela (compartilhado
   * com o fluxo de instrutor e com o toast global), para o comportamento aqui
   * não mudar com a extração.
   */
  const ctmAllocation = useResourceAllocation({
    demand: formDemand,
    addResourceAllocation,
    hasResourceConflict,
    error: resourceError,
    setError: setResourceError,
    canAllocate: canAllocateResource,
  });

  // Body scroll lock when any modal is open
  useEffect(() => {
    const anyOpen = isModalOpen || isAllocationModalOpen || !!pendingConflictAllocation || ctmAllocation.isOpen || confirmCancel || confirmDelete || confirmReactivate || confirmAllocationCase !== null || confirmDateChange || confirmLocalChange;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isModalOpen, isAllocationModalOpen, pendingConflictAllocation, ctmAllocation.isOpen, confirmCancel, confirmDelete, confirmReactivate, confirmAllocationCase, confirmDateChange, confirmLocalChange]);

  const statusColor = (status: string) => {
    switch(status) {
      case 'NOVA': return 'bg-purple-100 text-purple-800';
      case 'PENDENTE': return 'bg-orange-100 text-orange-800';
      case 'ALOCADA': return 'bg-blue-100 text-blue-800';
      case 'EM_ANDAMENTO': return 'bg-emerald-100 text-emerald-800';
      case 'CONCLUIDA': return 'bg-green-100 text-green-800';
      case 'CANCELADA': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

// =======================================
// ✅ Date/Time helpers (inputs estáveis)
// - Aceita ISO com Z, ISO sem Z, ou YYYY-MM-DDTHH:mm
// - Sempre retorna valores válidos p/ input date/time
// =======================================

  
  const defaultTimeFor = (field: 'startDate' | 'endDate') =>
    field === 'startDate' ? DEFAULT_START_TIME : DEFAULT_END_TIME;

  const handleDateChange = (field: 'startDate' | 'endDate', val: string) => {
    const time = toDemandTimeInput(formDemand[field] as any) || defaultTimeFor(field);
    setFormDemand(prev => ({ ...prev, [field]: buildDemandDateTime(val, time, defaultTimeFor(field)) }));
    setResourceError(null);
  };

  const handleTimeChange = (field: 'startDate' | 'endDate', val: string) => {
    const date = toDemandDateInput(formDemand[field] as any);
    if (!date) return;
    setFormDemand(prev => ({ ...prev, [field]: buildDemandDateTime(date, val, defaultTimeFor(field)) }));
    setResourceError(null);
  };

  const getDateValue = (field: 'startDate' | 'endDate') => {
    return toDemandDateInput(formDemand[field] as any);
  };

  const getTimeValue = (field: 'startDate' | 'endDate') => {
    return toDemandTimeInput(formDemand[field] as any);
  };

  // ✅ Ao entrar em "FORM" no EDIT, garante que os inputs de hora abram com o horário real salvo
  const didSyncEditTimesRef = useRef(false);

  useEffect(() => {
    // Só roda quando abrir edição e entrar no FORM
    if (!isModalOpen) return;
    if (modalMode !== 'EDIT') return;
    if (modalSubMode !== 'FORM') return;
    if (!activeDemand) return;

    // evita ficar sobrescrevendo enquanto usuário edita
    if (didSyncEditTimesRef.current) return;
    didSyncEditTimesRef.current = true;

    const startDate = toDemandDateInput(activeDemand.startDate);
    const startTime = toDemandTimeInput(activeDemand.startDate) || DEFAULT_START_TIME;

    const endDate = toDemandDateInput(activeDemand.endDate);
    const endTime = toDemandTimeInput(activeDemand.endDate) || DEFAULT_END_TIME;

    setFormDemand(prev => ({
      ...prev,
      startDate: buildDemandDateTime(startDate, startTime, DEFAULT_START_TIME),
      endDate: buildDemandDateTime(endDate, endTime, DEFAULT_END_TIME),
    }));
  }, [isModalOpen, modalMode, modalSubMode, activeDemand]);



  const DataList = ({ id, items }: { id: string, items: string[] }) => (
    <datalist id={id}>
      {items.map(item => <option key={item} value={item} />)}
    </datalist>
  );


  // Filtrar alocações para a demanda atual
  const currentAllocations = useMemo(() => {
    if (!formDemand.id) return [];
    return instructorAllocations.filter(a => a.demandId === formDemand.id);
  }, [instructorAllocations, formDemand.id]);

  const currentResourceAllocations = useMemo(() => {
    if (!formDemand.id) return [];
    return resourceAllocations.filter(a => a.demandId === formDemand.id);
  }, [resourceAllocations, formDemand.id]);

  const principalInstructorId = useMemo(() => {
    if (!formDemand.id) return undefined;
    return principalInstructorByDemandId[formDemand.id];
  }, [formDemand.id, principalInstructorByDemandId]);

  // ✅ Instrutor Principal 2 = segundo instrutor único na divisão (por ordem de início)
  const principalInstructor2Id = useMemo(() => {
  if (!formDemand.id) return undefined;

  const allocs = instructorAllocations
    .filter(a => a.demandId === formDemand.id && a.instructorId && a.startDate)
    .slice()
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

  const seen = new Set<string>();
  const orderedUnique: string[] = [];

  for (const a of allocs) {
    const id = a.instructorId;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    orderedUnique.push(id);
    if (orderedUnique.length >= 2) break;
  }

  // [0] = principal 1, [1] = principal 2
  return orderedUnique[1];
}, [formDemand.id, instructorAllocations]);

  // ✅ Acompanhante(s) da demanda atual (vem da tabela/estrutura de companionAllocations)
const companionInstructorIds = useMemo(() => {
  if (!formDemand.id) return [];

  const ids = (companionAllocations || [])
    .filter((c: any) => c.demandId === formDemand.id)
    .map((c: any) => c.instructorId)
    .filter(Boolean) as string[];

  // ✅ remove duplicados mantendo a ordem (fica 1 nome só, e 2+ só se forem diferentes)
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  return unique;
}, [formDemand.id, companionAllocations]);


  // ✅ FIX: manter formDemand sincronizado com o estado global da demanda
// (especialmente instructorId, que muda quando você remove/altera alocações)

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #printable-demand, #printable-demand * { visibility: visible !important; }
          #printable-demand {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print { display: none !important; }
          .print-header { display: block !important; }
        }
      `}</style>

      {showDeleteMessage && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-[200] font-bold animate-fade-in">
          Demanda excluída com sucesso
        </div>
      )}

      {showDeleteBlocked && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-[200] font-bold animate-fade-in">
          Demandas concluídas não podem ser excluídas
        </div>
      )}

      {resourceError && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-[300] font-bold animate-fade-in flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{resourceError}</span>
        </div>
      )}

    <DataList id="aprovadores-list" items={operationalBases.aprovadores ?? []} />
    <DataList id="analistas-list" items={operationalBases.analistas ?? []} />
    <DataList id="corredores-list" items={operationalBases.corredores ?? []} />
    <DataList id="localidades-list" items={operationalBases.localidades ?? []} />
    <DataList id="locais-treinamento-list" items={localOptions} />
    <DataList id="hoteis-list" items={operationalBases.hoteis ?? []} />
    <DataList id="agencias-list" items={operationalBases.locaisAgencia ?? []} />
    <DataList id="matriculadores-list" items={operationalBases.matriculadores ?? []} />


      <div className="flex flex-col space-y-4 no-print">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Gestão de Demandas</h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Criação, Acompanhamento e Controle de Demandas de Treinamento</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExportDemandsOpen(true)}
                className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
              >
                <FileDown size={18} /> <span className="hidden sm:inline">Exportar Demandas (Excel)</span>
              </button>
              {canPerformAction(profile?.role, 'create_demand') && (
            <button
              onClick={handleOpenCreate}
              className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
            >
              <Plus size={18} /> <span className="hidden sm:inline">Nova Demanda</span>
            </button>
          )}
            </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Filter size={14} /> Filtros
            </h3>
            <button
              onClick={clearFilters}
              className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={12} /> Limpar Filtros
            </button>
          </div>

          {/* ===== LINHA PRINCIPAL (sempre visível) ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Busca */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Buscar ID ou Palavra-Chave</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-300" size={16} />
                <input
                  type="text"
                  placeholder="ID, Cliente, NR..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>

            {/* Empresa */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Empresa / Cliente</label>
              <select
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={advancedFilters.companyId}
                onChange={(e) => setAdvancedFilters({...advancedFilters, companyId: e.target.value})}
              >
                <option value="">Todas as Empresas</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Treinamento */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Treinamento</label>
              <select
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={advancedFilters.trainingId}
                onChange={(e) => setAdvancedFilters({...advancedFilters, trainingId: e.target.value})}
              >
                <option value="">Todos os Treinamentos</option>
                {trainings.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            {/* Período */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Período (De / Até)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.startDate}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, startDate: e.target.value})}
                />
                <input
                  type="date"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.endDate}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, endDate: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* ===== TOGGLE AVANÇADOS ===== */}
          <button
            onClick={() => setShowAdvancedFilters(prev => !prev)}
            className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
          >
            {showAdvancedFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showAdvancedFilters ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}
          </button>

          {/* ===== FILTROS AVANÇADOS (ocultos por padrão) ===== */}
          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
              {/* Instrutor */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Instrutor</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.instructorId}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, instructorId: e.target.value})}
                >
                  <option value="">Qualquer Instrutor</option>
                  <option value="unallocated">Sem Instrutor Alocado</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Status da Demanda</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.status}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, status: e.target.value})}
                >
                  <option value="">Todos os Status</option>
                  <option value="NOVA">Nova</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="ALOCADA">Alocada</option>
                  <option value="EM_ANDAMENTO">Em Andamento</option>
                  <option value="CONCLUIDA">Concluída</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
              </div>

              {/* Região */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Região</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.regionId}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, regionId: e.target.value})}
                >
                  <option value="">Todas as Regiões</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {/* Estado */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Estado</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.demandState}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, demandState: e.target.value})}
                >
                  <option value="">Todos os Estados</option>
                  {Array.from(new Set(
                    demands
                      .map(d => (d.demandState || '').trim())
                      .filter(Boolean)
                  ) as Set<string>).sort().map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Unidade / Local */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Unidade / Local</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.trainingLocal}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, trainingLocal: e.target.value})}
                >
                  <option value="">Todos os Locais</option>
                  {Array.from(new Set(
                    demands
                      .map(d => (d.trainingLocal || '').trim())
                      .filter(Boolean)
                  ) as Set<string>).sort().map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Corredor */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Corredor</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.corredor}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, corredor: e.target.value})}
                >
                  <option value="">Todos os Corredores</option>
                  {(operationalBases.corredores ?? []).sort().map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Modalidade */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-tight">Modalidade</label>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={advancedFilters.modality}
                  onChange={(e) => setAdvancedFilters({...advancedFilters, modality: e.target.value})}
                >
                  <option value="">Todas as Modalidades</option>
                  {modalityOptions.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden no-print">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {filteredDemands.length} Demandas encontradas
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-black text-slate-500">
              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('id')}
              >
                ID {sort.key === 'id' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('company')}
              >
                Empresa {sort.key === 'company' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('training')}
              >
                Treinamento {sort.key === 'training' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('demandState')}
              >
                Estado {sort.key === 'demandState' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('trainingLocal')}
              >
                Unidade/Local {sort.key === 'trainingLocal' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th className="p-4 select-none">
                Corredor
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('startDate')}
              >
                Data Início {sort.key === 'startDate' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('instructor')}
              >
                Instrutor {sort.key === 'instructor' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 text-center cursor-pointer select-none"
                onClick={() => toggleSort('status')}
              >
                Status {sort.key === 'status' && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>

              <th className="p-4 text-center">Ações</th>
            </tr>

            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDemands.length > 0 ? paginatedDemands.map(demand => {
                const currentStatus = calculateDemandStatus({
                  startDate: demand.startDate,
                  endDate: demand.endDate,
                  instructorId: demand.instructorId,
                  cancelled: demand.status === 'CANCELADA',
                  trainingLocal: demand.trainingLocal,
                  modality: demand.modality,
                } as any);

                return (
                  <tr key={demand.id} className="hover:bg-slate-50/50 transition-colors text-sm text-gray-700">
                    <td className="p-4 font-bold text-blue-600">{demand.id}</td>
                    <td className="p-4 font-medium">{getCompanyName(demand.companyId)}</td>
                    <td className="p-4 max-w-xs truncate" title={getTrainingName(demand.trainingId)}>{getTrainingName(demand.trainingId)}</td>
                    <td className="p-4">{demand.demandState || '—'}</td>
                    <td className="p-4">{demand.trainingLocal || '—'}</td>
                    <td className="p-4">{demand.corredor || '—'}</td>
                    <td className="p-4 whitespace-nowrap">{formatDateTime(demand.startDate.split('T')[0])}</td>
                    <td className="p-4 font-medium text-gray-900">
                      {(() => {
                        const ids = allInstructorsByDemandId[demand.id] ?? [];
                        const acompanhantes = companionNamesByDemandId[demand.id] ?? [];
                        if (ids.length === 0 && acompanhantes.length === 0) return 'Não Alocado';
                        const shown = ids.slice(0, 2);
                        const extra = ids.length - 2;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {shown.map(id => (
                              <span key={id}>{getInstructorName(id)}</span>
                            ))}
                            {ids.length === 0 && <span className="text-slate-400">Não Alocado</span>}
                            {extra > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-600 text-white w-fit">+{extra}</span>
                            )}
                            {/* Acompanhante NÃO é instrutor alocado: não ministra,
                                e é vínculo de outra tabela. Fica fora do "+N" de
                                cima pelo mesmo motivo que participante fica na
                                interna. */}
                            <PersonCountBadge
                              count={acompanhantes.length}
                              title={`Acompanhantes: ${acompanhantes.join(', ')}`}
                            />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${statusColor(currentStatus)}`}>
                        {currentStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => handleOpenView(demand)} 
                        className="text-gray-400 hover:text-blue-600 bg-white hover:bg-blue-50 p-2 rounded-lg border border-slate-100 transition-all shadow-sm"
                        title="Ver Detalhes / Edição"
                      >
                        <FileSearch size={16} />
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={10} className="p-20 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <Eraser size={40} className="opacity-20" />
                      <p className="font-medium">Nenhuma demanda encontrada.</p>
                      <button onClick={clearFilters} className="text-blue-600 font-bold text-xs uppercase underline">Limpar filtros</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            currentPage={demandPage}
            totalPages={demandTotalPages}
            totalItems={filteredDemands.length}
            itemsPerPage={demandItemsPerPage}
            startIdx={demandStartIdx}
            entityLabel="demandas"
            onPageChange={setDemandPage}
            onItemsPerPageChange={handleDemandItemsPerPage}
          />
        </div>
      </div>

      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 no-print"
          onClick={() => {
            if (modalMode === 'CREATE') return;
            setConfirmDelete(false);
            setConfirmCancel(false);
            setConfirmReactivate(false);
            setIsModalOpen(false);
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] animate-fade-in" 
            id="printable-demand"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const currentStatus = calculateDemandStatus({
              startDate: formDemand.startDate!,
              endDate: formDemand.endDate!,
              instructorId: formDemand.instructorId,
              cancelled: formDemand.status === 'CANCELADA',
              trainingLocal: formDemand.trainingLocal,
              modality: formDemand.modality,
            } as any);

              return (
                <>
                  <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center no-print">
                    <div className="flex flex-col">
                      <h2 className="text-xl font-bold text-gray-800">
                        {modalSubMode === 'VIEW' ? 'Visualização da Demanda' : (modalMode === 'CREATE' ? 'Nova Demanda' : 'Editar Demanda')}
                      </h2>
                      {modalSubMode === 'VIEW' && (
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-slate-400 font-mono">ID: {formDemand.id}</p>
                          {/* Mesmo componente da listagem. Sem acompanhante, o
                              cabeçalho fica exatamente como era. */}
                          <PersonCountBadge
                            count={companionInstructorIds.length}
                            title={`Acompanhantes: ${companionInstructorIds
                              .map(id => getInstructorName(id))
                              .join(', ')}`}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {modalSubMode === 'VIEW' && (
                        <>
                          <div className="h-8 w-px bg-slate-200 mx-2"></div>
                          <button onClick={handleGenerateWord} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition font-bold text-xs border border-blue-200 shadow-sm" title="Word">
                            <FileWordIcon size={14} /> Word
                          </button>
                          <button onClick={handleSendEmail} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold text-xs border border-blue-700 shadow-sm" title="E-mail">
                            <Mail size={14} /> E-mail
                          </button>
                          <button onClick={handleSendWhatsApp} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-bold text-xs border border-green-200 shadow-sm" title="WhatsApp">
                            <MessageCircle size={14} /> WhatsApp
                          </button>
                          <div className="h-8 w-px bg-slate-200 mx-2"></div>
                        {currentStatus !== 'CANCELADA' && canPerformAction(profile?.role, 'edit_demand') && (
                          <button
                            onClick={() => setModalSubMode('FORM')}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition font-bold text-xs border border-slate-200"
                            title="Editar"
                          >
                            <Edit3 size={14} /> Editar
                          </button>
                        )}
                        </>
                      )}
                      <button onClick={() => {
                        setConfirmDelete(false);
                        setConfirmCancel(false);
                        setConfirmReactivate(false);
                        setIsModalOpen(false);
                      }} className="text-gray-400 hover:text-gray-600 transition p-1 hover:bg-gray-100 rounded-lg"><X size={24} /></button>
                    </div>
                  </div>
                  
                  <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50" ref={printRef}>
                    
                    {/* Alerta de Cancelamento */}
                    {currentStatus === 'CANCELADA' && (
                      <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex flex-col gap-2 text-red-700">
                        <div className="flex items-center gap-3">
                          <Ban size={20} />
                          <div>
                            <p className="font-bold text-sm uppercase">Demanda Cancelada</p>
                            {(formDemand.cancelInfo?.date || formDemand.cancelledAt) && (
                              <p className="text-xs">Cancelamento registrado em {new Date(formDemand.cancelInfo?.date || formDemand.cancelledAt || '').toLocaleString('pt-BR')}</p>
                            )}
                          </div>
                        </div>
                        {(formDemand.cancelReason || formDemand.cancelInfo) && (
                          <div className="mt-2 text-xs border-t border-red-100 pt-2">
                            <p><strong>Motivo:</strong> {formDemand.cancelReason || formDemand.cancelInfo?.reason}</p>
                            {formDemand.cancelInfo?.note && <p><strong>Observação:</strong> {formDemand.cancelInfo.note}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <button onClick={() => toggleSection('geral')} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print">
                        <div className="flex items-center gap-3"><div className="p-2 bg-blue-50 rounded-lg text-blue-600"><FileText size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Informações Gerais</h3></div>
                        {openSections.geral ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                      
                      {openSections.geral && (
                        <div className="px-6 py-6 border-t border-slate-100 bg-white">
                          {modalSubMode === 'FORM' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Empresa / Cliente *</label><select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.companyId} onChange={(e) => setFormDemand({...formDemand, companyId: e.target.value})}><option value="">Selecione...</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                              {isValeSelected && (<div className="bg-blue-50 p-3 rounded-lg border border-blue-100"><label className="block text-xs font-bold text-blue-700 mb-1">ID SAP / Pedido Cliente *</label><input type="text" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.clientDemandId || ''} onChange={(e) => setFormDemand({...formDemand, clientDemandId: e.target.value})} /></div>)}
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Treinamento *</label><select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" value={formDemand.trainingId} onChange={(e) => { const t = trainings.find(t => t.id === e.target.value); setFormDemand({...formDemand, trainingId: e.target.value, modality: t?.modality || formDemand.modality}); }}><option value="">Selecione...</option>{trainings.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                              {(() => {
                                const isHibrido = formDemand.modality === 'HIBRIDO' || formDemand.modality === 'HÍBRIDA' || formDemand.modality === 'HÍBRIDO';
                                if (!isHibrido || !formDemand.trainingId) return null;
                                const t = trainings.find(t => t.id === formDemand.trainingId);
                                if (!t || (t.practicalHours != null && t.practicalHours > 0)) return null;
                                return (
                                  <div className="md:col-span-2 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-amber-800">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                                    <p className="text-xs leading-relaxed">
                                      Este treinamento é híbrido sem horas práticas cadastradas — as horas ministradas serão calculadas pela carga total ({t.hours}h).
                                      Cadastre em <strong>Cadastros → Treinamentos</strong>.
                                    </p>
                                  </div>
                                );
                              })()}
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                  Local do Treinamento {requiresLogistics(formDemand.modality) ? '*' : ''}
                                </label>

                              {/* Editável em TODAS as modalidades. No online o campo é opcional
                                  (a validação só exige local onde requiresLogistics) e 'N/A' vem
                                  no topo do datalist — ver localOptions. */}
                              <input
                                list="locais-treinamento-list"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={formDemand.trainingLocal || ''}
                                onChange={(e) => handleTrainingLocalChange(e.target.value)}
                                placeholder={!requiresLogistics(formDemand.modality) ? 'N/A ou local de referência...' : 'Ex: Brucutu, Vitória...'}
                              />
                              {!requiresLogistics(formDemand.modality) && (
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Opcional para online — use N/A se não houver local de referência.
                                </p>
                              )}

                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Região</label>
                                <select
                                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none ${autoFilledFields.has('regionId') ? 'bg-gray-100' : ''} ${autoFilledFields.has('na_locked') ? 'bg-gray-200 cursor-not-allowed' : ''}`}
                                  value={formDemand.regionId}
                                  disabled={autoFilledFields.has('na_locked')}
                                  onChange={(e) => {
                                    setAutoFilledFields(prev => { const s = new Set(prev); s.delete('regionId'); return s; });
                                    setFormDemand({...formDemand, regionId: e.target.value});
                                  }}
                                >
                                  <option value="">Selecione...</option>
                                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Corredor</label>
                                <input
                                  list="corredores-list"
                                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${autoFilledFields.has('corredor') ? 'bg-gray-100' : ''} ${autoFilledFields.has('na_locked') ? 'bg-gray-200 cursor-not-allowed' : ''}`}
                                  value={formDemand.corredor || ''}
                                  disabled={autoFilledFields.has('na_locked')}
                                  onChange={(e) => handleCorredorChange(e.target.value)}
                                  placeholder="Selecione ou digite..."
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado *</label>
                                <select
                                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${autoFilledFields.has('demandState') ? 'bg-gray-100' : ''} ${autoFilledFields.has('na_locked') ? 'bg-gray-200 cursor-not-allowed' : ''}`}
                                  value={formDemand.demandState || ''}
                                  disabled={autoFilledFields.has('na_locked')}
                                  onChange={(e) => handleEstadoChange(e.target.value)}
                                >
                                  <option value="">Selecione...</option>
                                  {autoFilledFields.has('na_locked') && <option value="N/A">N/A</option>}
                                  {(() => {
                                    const base = [...(operationalBases.localidades ?? []), ...(operationalBases.locaisAgencia ?? [])];
                                    const unique = Array.from(new Set(base));
                                    return unique.map((opt: string) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ));
                                  })()}
                                  {formDemand.demandState && !autoFilledFields.has('na_locked') && !([...(operationalBases.localidades ?? []), ...(operationalBases.locaisAgencia ?? [])]).includes(formDemand.demandState) && (
                                    <option value={formDemand.demandState}>{formDemand.demandState}</option>
                                  )}
                                </select>
                              </div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Atendimento</label><input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-700 font-bold" value={formDemand.modality || '---'} readOnly /><p className="text-[10px] text-slate-400 mt-1">Campo automático (puxado do Treinamento).</p></div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Solicitante</label><input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formDemand.requester || ''} onChange={(e) => setFormDemand({...formDemand, requester: e.target.value})} /></div>
                              
                              {/* ── TOGGLE MODO DE DATAS ── */}
                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Modo de Datas *</label>
                                <div className="flex gap-2">
                                  <button type="button"
                                    className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${formDemand.dateMode !== 'DIAS_ESPECIFICOS' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                    onClick={() => setFormDemand({...formDemand, dateMode: 'CONTINUO' as const})}
                                  >Dias Contínuos</button>
                                  <button type="button"
                                    className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${formDemand.dateMode === 'DIAS_ESPECIFICOS' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                    onClick={() => setFormDemand({...formDemand, dateMode: 'DIAS_ESPECIFICOS' as const})}
                                  >Dias Específicos</button>
                                </div>
                              </div>

                              {formDemand.dateMode !== 'DIAS_ESPECIFICOS' ? (
                              /* ── MODO CONTÍNUO (UI original) ── */
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:col-span-2">
                                <div className="flex flex-col gap-1">
                                  <label className="block text-xs font-bold text-gray-500 uppercase">Início *</label>
                                  <div className="flex gap-2">
                                    <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={getDateValue('startDate')} onChange={(e) => handleDateChange('startDate', e.target.value)} />
                                    <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={getTimeValue('startDate')} onChange={(e) => handleTimeChange('startDate', e.target.value)} />
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="block text-xs font-bold text-gray-500 uppercase">Fim *</label>
                                  <div className="flex gap-2">
                                    <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={getDateValue('endDate')} onChange={(e) => handleDateChange('endDate', e.target.value)} />
                                    <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={getTimeValue('endDate')} onChange={(e) => handleTimeChange('endDate', e.target.value)} />
                                  </div>
                                </div>
                              </div>
                              ) : (
                              /* ── MODO DIAS ESPECÍFICOS ── */
                              <div className="md:col-span-2 space-y-3">
                                {/* Adicionar dia com horários individuais */}
                                <div className="flex gap-2 items-end flex-wrap">
                                  <div className="flex-1 min-w-[130px]">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Adicionar Dia *</label>
                                    <input
                                      type="date"
                                      id="specific-date-input"
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  </div>
                                  <div className="w-28">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Início</label>
                                    <input
                                      type="time"
                                      id="specific-start-time-input"
                                      defaultValue="08:00"
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  </div>
                                  <div className="w-28">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fim</label>
                                    <input
                                      type="time"
                                      id="specific-end-time-input"
                                      defaultValue="18:00"
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition self-end"
                                    onClick={() => {
                                      const dateInput = document.getElementById('specific-date-input') as HTMLInputElement;
                                      const startInput = document.getElementById('specific-start-time-input') as HTMLInputElement;
                                      const endInput = document.getElementById('specific-end-time-input') as HTMLInputElement;
                                      const val = dateInput?.value;
                                      if (!val) return;
                                      const horarioInicio = startInput?.value || '08:00';
                                      const horarioFim = endInput?.value || '18:00';
                                      const current = Array.isArray(formDemand.specificDates) ? formDemand.specificDates : [];
                                      if (current.some(e => e.data === val)) return; // sem duplicatas
                                      const updated = [...current, { data: val, horarioInicio, horarioFim }].sort((a, b) => a.data.localeCompare(b.data));
                                      setFormDemand({
                                        ...formDemand,
                                        specificDates: updated,
                                        startDate: `${updated[0].data}T${updated[0].horarioInicio}`,
                                        endDate: `${updated[updated.length - 1].data}T${updated[updated.length - 1].horarioFim}`,
                                      });
                                      dateInput.value = '';
                                    }}
                                  >+ Adicionar</button>
                                </div>

                                {/* Lista de dias adicionados com horários */}
                                {Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0 && (
                                  <div className="space-y-1">
                                    {[...formDemand.specificDates].sort((a, b) => String(a.data).localeCompare(String(b.data))).map((entry, i) => {
                                      const dateStr = String(entry.data ?? '').slice(0, 10);
                                      const dateObj = new Date(`${dateStr}T12:00:00`);
                                      const dateLabel = isNaN(dateObj.getTime()) ? dateStr : dateObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
                                      return (
                                      <div key={`${dateStr}-${i}`} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                                        <span className="text-xs font-bold text-blue-700 flex-1">
                                          {dateLabel}
                                        </span>
                                        <span className="text-xs text-blue-600 font-medium">{entry.horarioInicio} – {entry.horarioFim}</span>
                                        <button
                                          type="button"
                                          className="text-blue-400 hover:text-red-500 font-black text-sm leading-none ml-1"
                                          onClick={() => {
                                            const updated = formDemand.specificDates!.filter(x => x.data !== entry.data);
                                            const sorted = [...updated].sort((a, b) => a.data.localeCompare(b.data));
                                            setFormDemand({
                                              ...formDemand,
                                              specificDates: updated,
                                              startDate: sorted.length > 0 ? `${sorted[0].data}T${sorted[0].horarioInicio}` : '',
                                              endDate: sorted.length > 0 ? `${sorted[sorted.length - 1].data}T${sorted[sorted.length - 1].horarioFim}` : '',
                                            });
                                          }}
                                        >&times;</button>
                                      </div>
                                    ); })}
                                    <p className="text-[10px] text-slate-500 mt-1 font-bold">
                                      {formDemand.specificDates.length} dia(s) selecionado(s)
                                    </p>
                                  </div>
                                )}
                              </div>
                              )}

                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Observações Importantes</label>
                                <textarea 
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none shadow-sm" 
                                  value={formDemand.observations || ''} 
                                  onChange={(e) => setFormDemand({...formDemand, observations: e.target.value})}
                                  placeholder="Informações relevantes sobre a demanda..."
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-8">
                              {/* Grade de Informações Gerais */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-y-6 md:col-span-2">
                                <DataViewField label="Empresa" value={getCompanyName(formDemand.companyId!)} icon={Building} />
                                {getCompanyName(formDemand.companyId!).toUpperCase().includes('VALE') && (<DataViewField label="ID SAP / Pedido Cliente" value={formDemand.clientDemandId || '---'} icon={Tag} />)}
                                <DataViewField label="Treinamento" value={getTrainingName(formDemand.trainingId!)} icon={BookOpen} />
                                <DataViewField label="Carga Horária" value={getTrainingHours(formDemand.trainingId!)} icon={Clock} />
                                <DataViewField label="Unidade / Local" value={formDemand.trainingLocal || 'N/A'} icon={MapPin} />
                                {formDemand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0 ? (
                                  <>
                                    <div className="flex flex-col space-y-1 md:col-span-3">
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={12} /> Dias Específicos</span>
                                      <div className="flex flex-col gap-1 mt-1">
                                        {[...formDemand.specificDates].sort((a, b) => String(a.data).localeCompare(String(b.data))).map((entry, i) => {
                                          const dateStr = String(entry.data ?? '').slice(0, 10);
                                          const dateObj = new Date(`${dateStr}T12:00:00`);
                                          const dateLabel = isNaN(dateObj.getTime()) ? dateStr : dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
                                          return (
                                          <span key={`${dateStr}-${i}`} className="inline-flex items-center gap-2 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-bold border border-blue-200 w-fit">
                                            {dateLabel}
                                            <span className="text-blue-500">{entry.horarioInicio}–{entry.horarioFim}</span>
                                          </span>
                                          );
                                        })}
                                      </div>
                                      <span className="text-[10px] text-slate-500">{formDemand.specificDates.length} dia(s)</span>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <DataViewField label="Início" value={formatDateTime(formDemand.startDate)} icon={Calendar} />
                                    <DataViewField label="Fim" value={formatDateTime(formDemand.endDate)} icon={Calendar} />
                                  </>
                                )}
                                <DataViewField label="Corredor" value={formDemand.corredor} icon={MapPin} />
                                <DataViewField label="Região" value={getRegionName(formDemand.regionId!)} icon={MapPin} />
                                <DataViewField label="Estado" value={formDemand.demandState} icon={MapPin} />
                                <DataViewField label="Modalidade" value={formDemand.modality} icon={Info} />
                                <DataViewField label="Solicitante" value={formDemand.requester} icon={User} />
                                <div className="flex flex-col space-y-1">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status Atual</span>
                                  <span className={`w-fit px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(currentStatus)}`}>
                                    {currentStatus.replace('_', ' ')}
                                  </span>
                                </div>
                                <div className="md:col-span-3">
                                 <div className="md:col-span-3 space-y-3">
                                {(() => {
                                  const ids = formDemand.id ? (allInstructorsByDemandId[formDemand.id] ?? []) : [];
                                  if (ids.length === 0) {
                                    return (
                                      <DataViewField
                                        label="Instrutor Principal"
                                        value={getInstructorName(formDemand.instructorId)}
                                        icon={UserCheck}
                                      />
                                    );
                                  }
                                  return ids.map((id, i) => (
                                    <DataViewField
                                      key={id}
                                      label={i === 0 ? 'Instrutor Principal' : `Instrutor ${i + 1}`}
                                      value={getInstructorName(id)}
                                      icon={UserCheck}
                                    />
                                  ));
                                })()}

                                {companionInstructorIds.length > 0 && (
                                  <DataViewField
                                    label="Instrutor Acompanhante"
                                    value={companionInstructorIds.map(id => getInstructorName(id)).join(' • ')}
                                    icon={UserCheck}
                                  />
                                )}
                              </div>
                                </div>
                                
                                <div className="md:col-span-3 border-t border-slate-50 pt-4">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Observações Importantes</span>
                                  <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap italic">
                                    {formDemand.observations || 'Nenhuma observação informada.'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* SEÇÃO DE ALOCAÇÕES POR PERÍODO (INSTRUTORES E RECURSOS) */}
                    {modalSubMode === 'VIEW' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
                        {/* Instrutores Alocados */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                          <div className="w-full px-6 py-4 flex items-center justify-between bg-white">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Users size={20} /></div>
                              <h3 className="font-bold text-slate-800 uppercase text-sm">Instrutores</h3>
                            </div>
                            {currentStatus !== 'CANCELADA' && (
                              <button 
                                onClick={handleOpenAllocationModal}
                                className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition"
                              >
                                <UserPlus size={14} /> Adicionar
                              </button>
                            )}
                          </div>
                          <div className="px-6 py-4 border-t border-slate-100 bg-white min-h-[100px]">
                            {currentAllocations.length > 0 ? (
                              <div className="space-y-3">
                                {currentAllocations.map(allocation => (
                                  <div key={allocation.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200 group">
                                    <div className="flex items-center gap-4">
                                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs uppercase">{getInstructorName(allocation.instructorId).charAt(0)}</div>
                                      <div>
                                        <p className="text-sm font-bold text-slate-800">{getInstructorName(allocation.instructorId)}</p>
                                        <p className="text-[10px] font-medium text-slate-500 flex items-center gap-2">
                                          <Calendar size={10} /> {formatDateOnlySafe(allocation.startDate)} até {formatDateOnlySafe(allocation.endDate)}

                                        </p>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => removeInstructorAllocation(allocation.id)}
                                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic py-2">Nenhum instrutor adicional alocado.</p>
                            )}
                          </div>
                        </div>

                        {/* Recursos (CTM) Alocados */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                          <div className="w-full px-6 py-4 flex items-center justify-between bg-white">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-amber-50 rounded-lg text-amber-600"><Truck size={20} /></div>
                              <h3 className="font-bold text-slate-800 uppercase text-sm">Centro Móvel</h3>
                            </div>
                            {currentStatus !== 'CANCELADA' && canAllocateResource && (
                              <button 
                                onClick={ctmAllocation.open}
                                className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-1.5 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition"
                              >
                                <Plus size={14} /> Alocar CTM
                              </button>
                            )}
                          </div>
                          <div className="px-6 py-4 border-t border-slate-100 bg-white min-h-[100px]">
                            {currentResourceAllocations.length > 0 ? (
                              <div className="space-y-3">
                                {currentResourceAllocations.map(allocation => (
                                  <div key={allocation.id} className="flex items-center justify-between p-3 bg-amber-50/30 rounded-xl border border-amber-100 group">
                                    <div className="flex items-center gap-4">
                                      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 border border-amber-200 shadow-sm"><Truck size={14}/></div>
                                      <div>
                                        <p className="text-sm font-bold text-amber-800">Centro Móvel</p>
                                        <p className="text-[10px] font-medium text-amber-600 flex items-center gap-2">
                                          <Calendar size={10} /> {formatDateOnlySafe(allocation.startDate)} até {formatDateOnlySafe(allocation.endDate)}

                                        </p>
                                      </div>
                                    </div>
                                    <button onClick={() => removeResourceAllocation(allocation.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic py-2">Nenhum recurso logístico alocado por período.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm no-print">
                      <button onClick={() => toggleSection('internos')} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print">
                        <div className="flex items-center gap-3"><div className="p-2 bg-purple-50 rounded-lg text-purple-600"><UserCheck size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Dados Internos</h3></div>
                        {openSections.internos ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                      {openSections.internos && (
                        <div className="px-6 py-6 border-t border-slate-100 bg-white">
                          {modalSubMode === 'FORM' ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Aprovador</label><input list="aprovadores-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.approver || ''} onChange={(e) => setFormDemand({...formDemand, approver: e.target.value})} /></div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Analista</label><input list="analistas-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.analyst || ''} onChange={(e) => setFormDemand({...formDemand, analyst: e.target.value})} /></div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Matriculador</label><input list="matriculadores-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.matriculador || ''} onChange={(e) => setFormDemand({ ...formDemand, matriculador: e.target.value })} placeholder="Selecione ou digite..." /></div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <DataViewField label="Aprovador" value={formDemand.approver} icon={UserCheck} />
                              <DataViewField label="Analista" value={formDemand.analyst} icon={UserCheck} />
                              <DataViewField label="Matriculador" value={formDemand.matriculador} icon={UserCheck} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <LogisticaLocomocaoSection
                      form={formDemand}
                      setForm={setFormDemand}
                      mode={modalSubMode}
                      isOpen={!!openSections.locomocao}
                      onToggle={() => toggleSection('locomocao')}
                      operationalBases={operationalBases}
                      onNotify={setNotification}
                    />

                    <LogisticaHospedagemSection
                      form={formDemand}
                      setForm={setFormDemand}
                      mode={modalSubMode}
                      isOpen={!!openSections.hospedagem}
                      onToggle={() => toggleSection('hospedagem')}
                      onNotify={setNotification}
                    />
                    <DocumentosDemandaSection
                      mode={modalSubMode}
                      modalMode={modalMode}
                      isOpen={!!openSections.documentos}
                      onToggle={() => toggleSection('documentos')}
                      pendingPdfs={pendingPdfs}
                      dbDocs={dbDocs}
                      onPdfSelect={handlePdfSelect}
                      onRemovePendingPdf={removePdf}
                      onDownloadSavedPdf={downloadSavedPdf}
                      onMarkDocAsNA={markDocAsNA}
                    />
                  </div>
                  <div className="p-6 bg-slate-100 border-t border-slate-200 flex flex-col gap-4 no-print">
                    <div className="flex justify-between items-center">
                      <div className="flex gap-2">
                    {modalSubMode === 'VIEW' && (
                      <>
                        {canPerformAction(profile?.role, 'delete_demand') && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDelete(true);
                              setConfirmCancel(false);
                              setConfirmReactivate(false);
                            }}
                            className="flex items-center gap-2 px-4 py-2.5 border rounded-xl transition font-black text-xs uppercase tracking-widest shadow-sm bg-white text-red-600 border-red-200 hover:bg-red-50"
                          >
                            <Trash2 size={16} /> Excluir Demanda
                          </button>
                        )}

                        {currentStatus !== 'CANCELADA' &&
                          currentStatus !== 'CONCLUIDA' &&
                          canPerformAction(profile?.role, 'cancel_demand') && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmCancel(true);
                                setConfirmDelete(false);
                                setConfirmReactivate(false);
                                setSelectedCancelReason('');
                                setCancelTextNote('');
                              }}
                              className="flex items-center gap-2 px-4 py-2.5 border rounded-xl transition font-black text-xs uppercase tracking-widest shadow-sm bg-white text-orange-600 border-orange-200 hover:bg-orange-50"
                            >
                              <X size={16} /> Cancelar Demanda
                            </button>
                          )}

                        {currentStatus === 'CANCELADA' &&
                          canPerformAction(profile?.role, 'cancel_demand') && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmReactivate(true);
                                setConfirmDelete(false);
                                setConfirmCancel(false);
                              }}
                              className="flex items-center gap-2 px-4 py-2.5 border rounded-xl transition font-black text-xs uppercase tracking-widest shadow-sm bg-white text-blue-600 border-blue-200 hover:bg-blue-50"
                            >
                              <RefreshCw size={16} /> Reativar Demanda
                            </button>
                          )}
                      </>
                    )}
                      </div>
                      <div className="flex space-x-3">
                        <button 
                          type="button"
                          onClick={() => {
                            setConfirmDelete(false);
                            setConfirmCancel(false);
                            setConfirmReactivate(false);
                            setResourceError(null);
                            setIsModalOpen(false);
                          }} 
                          className="px-6 py-2.5 text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition font-black text-xs uppercase tracking-widest"
                        >
                          {modalSubMode === 'VIEW' ? 'Fechar' : 'Cancelar'}
                        </button>
                        
                            {modalSubMode === 'FORM' && canEditDemand && (
                              <button
                                type="button"
                                onClick={handleSave}
                                disabled={!isFormValid || isSaving}
                                className={`px-8 py-2.5 font-black rounded-xl transition shadow-lg text-xs uppercase tracking-widest flex items-center gap-2 
                                  ${isFormValid 
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                  }`}
                              >
                                <Check size={16} /> {modalMode === 'CREATE' ? 'Criar Demanda' : 'Salvar Alterações'}
                              </button>
                            )}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      , document.body)}

      {/* MODAL DE ALOCAÇÃO DE INSTRUTOR */}
      {isAllocationModalOpen && createPortal(
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Nova Alocação</h3>
              <button onClick={() => setIsAllocationModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Problema 3: contexto para o usuário */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                <Info size={14} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[10px] font-medium text-amber-800 leading-tight">
                  Este recurso é destinado a adicionar instrutores <strong>acompanhantes</strong> a uma demanda já alocada. Para alocação principal, use a <strong>Programação</strong> ou <strong>Alocação Inteligente</strong>.
                </p>
              </div>
              {resourceError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-red-700 leading-tight">{resourceError}</p>
                </div>
              )}
              {/* Problema 2: select agrupado por qualificação */}
              {(() => {
                const { suggested, exceptions } = recommendInstructors(formDemand as any);
                const suggestedIds = new Set(suggested.map((i: any) => i.id));
                const exceptionIds = new Set(exceptions.map((i: any) => i.id));
                const active = instructors.filter(i => i.status === 'ATIVO');
                const qualified = active.filter(i => suggestedIds.has(i.id));
                const exceptional = active.filter(i => exceptionIds.has(i.id));
                const unqualified = active.filter(i => !suggestedIds.has(i.id) && !exceptionIds.has(i.id));
                const selId = allocationForm.instructorId;
                const selIsException = selId ? exceptionIds.has(selId) : false;
                const selIsUnqualified = !!selId && !suggestedIds.has(selId) && !exceptionIds.has(selId);
                return (
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Instrutor</label>
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                      value={allocationForm.instructorId}
                      onChange={e => setAllocationForm({...allocationForm, instructorId: e.target.value})}
                    >
                      <option value="">Selecione...</option>
                      {qualified.length > 0 && (
                        <optgroup label="✓ Qualificados">
                          {qualified.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      )}
                      {exceptional.length > 0 && (
                        <optgroup label="⚠ Exceção — Fora da Região">
                          {exceptional.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      )}
                      {unqualified.length > 0 && (
                        <optgroup label="✗ Sem qualificação para este treinamento">
                          {unqualified.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {selIsException && (
                      <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                        <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[10px] font-bold text-amber-700 leading-tight">Instrutor fora da região da demanda — será registrado como <span className="uppercase">Exceção</span>.</p>
                      </div>
                    )}
                    {selIsUnqualified && (
                      <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                        <AlertCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
                        <p className="text-[10px] font-bold text-red-700 leading-tight">Instrutor sem qualificação para este treinamento. Prossiga apenas se necessário.</p>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Início</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={allocationForm.startDate}
                    onChange={e => setAllocationForm({...allocationForm, startDate: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Fim</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={allocationForm.endDate}
                    onChange={e => setAllocationForm({...allocationForm, endDate: e.target.value})}
                  />
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2">
                <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-blue-700 leading-tight">
                  O período de alocação deve estar dentro de: {formatDateTime(formDemand.startDate?.split('T')[0])} e {formatDateTime(formDemand.endDate?.split('T')[0])}
                </p>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button onClick={() => setIsAllocationModalOpen(false)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500">Cancelar</button>
              <button onClick={handleAddAllocation} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200">Confirmar</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* MODAL DE CONFIRMAÇÃO DE ALOCAÇÃO */}
      {confirmAllocationCase !== null && createPortal(
        <div className="fixed inset-0 z-[215] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl max-w-md w-full text-center space-y-4 shadow-2xl border border-slate-100">
            {confirmAllocationCase === 'qualified'
              ? <UserPlus size={44} className="mx-auto text-blue-500" />
              : <AlertTriangle size={44} className="mx-auto text-amber-500" />}
            <p className="text-sm text-slate-600 leading-relaxed">
              {confirmAllocationCase === 'unqualified'
                ? 'Atenção: o instrutor selecionado não possui qualificação para este treinamento. Este recurso é destinado a instrutores acompanhantes — não substitui a alocação principal via Programação ou Alocação Inteligente. Deseja confirmar mesmo assim?'
                : confirmAllocationCase === 'exception'
                ? 'Atenção: o instrutor selecionado é de outra região. Este recurso é destinado a instrutores acompanhantes — não substitui a alocação principal via Programação ou Alocação Inteligente. Deseja confirmar mesmo assim?'
                : 'Este recurso é destinado a instrutores acompanhantes a uma demanda já alocada. Para alocação principal, use a Programação ou Alocação Inteligente. Deseja confirmar?'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmAllocationCase(null); setPendingAllocationData(null); }}
                className="flex-1 py-2 bg-slate-100 rounded-lg font-bold text-sm"
              >Cancelar</button>
              <button
                onClick={handleExecuteAllocation}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm"
              >Sim, confirmar</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* MODAL DE CONFIRMAÇÃO DE CONFLITO DE INSTRUTOR */}
      {pendingConflictAllocation && createPortal(
        <div className="fixed inset-0 z-[220] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-amber-200 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-amber-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800">Instrutor já alocado</h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="font-bold text-slate-700">{getInstructorName(pendingConflictAllocation.instructorId)}</span> já possui uma alocação neste período. Deseja alocar mesmo assim?
                </p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 flex gap-3">
              <button
                onClick={() => setPendingConflictAllocation(null)}
                className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmConflictAllocation}
                className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-200 hover:bg-amber-700 transition"
              >
                Confirmar mesmo assim
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* MODAL DE ALOCAÇÃO DE RECURSO (CTM) — componente compartilhado com o
          modal de demanda interna (components/ResourceAllocationModal.tsx) */}
      <ResourceAllocationModal {...ctmAllocation.modalProps} />

      {/* MODAL DE MOTIVO DE CANCELAMENTO */}
      {confirmCancel && createPortal(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-6 border border-slate-100">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="p-3 bg-orange-100 rounded-full text-orange-600">
                <Ban size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Motivo do Cancelamento</h3>
              <p className="text-sm text-slate-500">Por favor, selecione o motivo real para o cancelamento desta demanda operacional.</p>
            </div>

            <div className="space-y-3">
              {[
                "Baixo quórum",
                "Falta de instrutor",
                "Reagendamento",
                "Solicitação do cliente",
                "No-Show",
                "Outro"
              ].map((reason) => (
                <label key={reason} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${selectedCancelReason === reason ? 'border-orange-500 bg-orange-50' : 'border-slate-100 hover:border-slate-200'}`}>
                  <input 
                    type="radio" 
                    name="cancelReason" 
                    className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-slate-300"
                    checked={selectedCancelReason === reason}
                    onChange={() => setSelectedCancelReason(reason)}
                  />
                  <span className={`text-sm font-bold ${selectedCancelReason === reason ? 'text-orange-900' : 'text-slate-600'}`}>{reason}</span>
                </label>
              ))}
            </div>

            {selectedCancelReason === 'Outro' && (
              <div className="animate-fade-in">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Observação Adicional</label>
                <textarea 
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none h-24 resize-none shadow-inner bg-slate-50"
                  placeholder="Explique o motivo..."
                  value={cancelTextNote}
                  onChange={(e) => setCancelTextNote(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => { setConfirmCancel(false); setSelectedCancelReason(''); setCancelTextNote(''); }} 
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition"
              >
                Voltar
              </button>
              <button 
                onClick={handleCancelDemand}
                disabled={!selectedCancelReason}
                className={`flex-1 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg
                  ${selectedCancelReason ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {confirmDelete && createPortal(
          <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-2xl max-sm text-center space-y-4">
                  <Trash2 size={48} className="mx-auto text-red-500" />
                  <h3 className="text-xl font-bold">Excluir permanentemente?</h3>
                  <p className="text-sm text-slate-500">Esta ação não pode ser desfeita. Todos os dados vinculados serão removidos.</p>
                  <div className="flex gap-2">
                      <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 bg-slate-100 rounded-lg font-bold">Não</button>
                      <button onClick={handleDeleteDemand} className="flex-1 py-2 bg-red-600 text-white rounded-lg font-bold">Sim, excluir</button>
                  </div>
              </div>
          </div>
      , document.body)}

      {confirmDateChange && createPortal(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-6 border border-slate-100">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="p-3 bg-amber-100 rounded-full text-amber-600">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Data do treinamento alterada</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Esta demanda possui um instrutor alocado na agenda. Ao alterar a data, as datas da alocação na agenda serão atualizadas automaticamente. Verifique se o instrutor ainda está disponível no novo período.
              </p>
              <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left space-y-1.5">
                <p className="text-xs font-black text-amber-800 uppercase tracking-widest mb-2">Atenção:</p>
                <p className="text-xs text-amber-700">1. As datas do instrutor na agenda serão alteradas automaticamente</p>
                <p className="text-xs text-amber-700">2. Verifique se o instrutor não tem conflito no novo período</p>
                <p className="text-xs text-amber-700">3. Caso necessário, realoque para outro instrutor disponível</p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmDateChange(false)}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setConfirmDateChange(false);
                  bypassDateWarning.current = true;
                  handleSave();
                }}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition shadow-lg"
              >
                Salvar mesmo assim
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {confirmLocalChange && createPortal(
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-6 border border-slate-100">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="p-3 bg-amber-100 rounded-full text-amber-600">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Local do Treinamento Alterado</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Esta demanda possui um instrutor alocado na agenda. O local foi alterado para: <span className="font-black text-slate-700">{formDemand.trainingLocal || '—'}</span>
                <br /><br />
                O instrutor atual pode não ser o mais indicado para esta localidade. Verifique se a alocação ainda é adequada.
              </p>
              <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left space-y-1.5">
                <p className="text-xs font-black text-amber-800 uppercase tracking-widest mb-2">Atenção:</p>
                <p className="text-xs text-amber-700">1. Verifique se o instrutor atende a nova localidade</p>
                <p className="text-xs text-amber-700">2. Caso seja de outra região, a alocação vira uma exceção</p>
                <p className="text-xs text-amber-700">3. Se necessário, realoque para um instrutor da região correta</p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmLocalChange(false)}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setConfirmLocalChange(false);
                  bypassLocalWarning.current = true;
                  handleSave();
                }}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition shadow-lg"
              >
                Salvar mesmo assim
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {confirmReactivate && createPortal(
          <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-2xl max-sm text-center space-y-4">
                  <RefreshCw size={48} className="mx-auto text-blue-500" />
                  <h3 className="text-xl font-bold">Reativar demanda?</h3>
                  <p className="text-sm text-slate-500">A demanda voltará ao status NOVA. Alocações e medições anteriores serão resetadas para este ID.</p>
                  <div className="flex gap-2">
                      <button onClick={() => setConfirmReactivate(false)} className="flex-1 py-2 bg-slate-100 rounded-lg font-bold">Cancelar</button>
                      <button onClick={handleReactivateDemand} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold">Sim, reativar</button>
                  </div>
              </div>
          </div>
      , document.body)}

      {/* ===== MODAL EXPORTAÇÃO DE DEMANDAS (Excel) ===== */}
      <ExportDemandsModal
        isOpen={isExportDemandsOpen}
        onClose={() => setIsExportDemandsOpen(false)}
        demands={demands}
        companies={companies}
        trainings={trainings}
        regions={regions}
        instructors={instructors}
        instructorAllocations={instructorAllocations}
      />
    </div>
  );
};

export default Demands;