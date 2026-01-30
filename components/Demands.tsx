import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  LogisticAllocation
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
  Users
} from 'lucide-react';

import {
  CAR_CATEGORIES,
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
import { useAuth } from '../contexts/AuthContext';

/* ===== SERVICES (SUPABASE) ===== */

import { upsertMeasurementByDemandId } from '../services/measurements';

import {
  uploadAndUpsertDemandPdf,
  getDemandDocumentSignedUrl,
  fetchDemandDocumentsByDemandId
} from '../services/demandDocuments';


import { upsertLogisticByDemandId, fetchLogisticByDemandId } from '../services/logistics';



type Action =
  | 'create_demand'
  | 'edit_demand'
  | 'delete_demand'
  | 'cancel_demand';

const ROLE_ACTIONS: Record<string, Action[]> = {
  admin: ['create_demand', 'edit_demand', 'delete_demand', 'cancel_demand'],
  analista: ['create_demand', 'edit_demand', 'delete_demand', 'cancel_demand'],
  coordenador: []
};

const canPerformAction = (
  role: string | undefined,
  action: Action
) => {
  if (!role) return false;
  return ROLE_ACTIONS[role]?.includes(action);
};

const Demands: React.FC = () => {
  const { 
    demands, companies, trainings, regions, instructors, operationalBases,
    measurements, agendaItems, instructorAllocations, resourceAllocations,companionAllocations,
    updateDemand, addDemand, deleteDemand, deallocateInstructor, recommendInstructors,
    updateMeasurement, removeAgendaItem, hasResourceConflict,
    addInstructorAllocation, removeInstructorAllocation, addResourceAllocation, removeResourceAllocation, hasScheduleConflict, setNotification
  } = useApp();
  
  const { profile } = useAuth();

  // Flags de perfil
  const isCoordinator = profile?.role === 'coordenador';
  const isAnalyst = profile?.role === 'analista';
  const isAdmin = profile?.role === 'admin';

  // Permissões
  const canEditDemand = isAdmin || isAnalyst;
  const canDeleteDemand = isAdmin || isAnalyst;

const [filter, setFilter] = useState('');
  type SortKey =
    | 'id'
    | 'company'
    | 'training'
    | 'region'
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
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

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
    endDate: ''
  });

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

  // Resource Modal State (CTM)
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [resourceForm, setResourceForm] = useState({
    startDate: '',
    endDate: ''
  });

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

  // Shared Form State
  const initialDemandState = (): Partial<Demand> => ({
    companyId: '',
    trainingId: '',
    regionId: '',
    trainingLocal: '',
    modality: 'PRESENCIAL',
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
    observations: ''
  });

  // Note: attachments is handled dynamically in formDemand
  const [formDemand, setFormDemand] = useState<Partial<Demand & { cancelledAt?: string, attachments?: { classListPdf?: { name: string; base64: string }; instructorReleasePdf?: { name: string; base64: string } }, cancelInfo?: { reason: string, note: string, date: string } }>>(initialDemandState());
  const [activeDemand, setActiveDemand] = useState<Demand | null>(null);


// PDFs pendentes (selecionados no FORM e enviados no SAVE)
  const [pendingPdfs, setPendingPdfs] = useState<{
    classList: File | null;
    instructorRelease: File | null;
  }>({ classList: null, instructorRelease: null });

  // Docs já salvos no banco (para VIEW)
  const [dbDocs, setDbDocs] = useState<Record<string, { name: string; path: string }>>({});



  // Helper names
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
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
  const baseFields = !!(
    formDemand.companyId &&
    formDemand.trainingId &&
    formDemand.startDate &&
    formDemand.endDate
  );
  if (!baseFields) return false;

  // ✅ Local só é obrigatório se NÃO for ONLINE
  const needsLocal = formDemand.modality !== 'ONLINE';
  if (needsLocal && !formDemand.trainingLocal) return false;

  const hasStartTime = formDemand.startDate!.includes('T');
  const hasEndTime = formDemand.endDate!.includes('T');
  return hasStartTime && hasEndTime;
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
        if (advancedFilters.instructorId === 'unallocated') {
          if (d.instructorId) return false;
        } else {
          if (d.instructorId !== advancedFilters.instructorId) return false;
        }
      }

      if (advancedFilters.startDate && d.startDate.split('T')[0] < advancedFilters.startDate) return false;
      if (advancedFilters.endDate && d.startDate.split('T')[0] > advancedFilters.endDate) return false;

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
        case 'region':
          return getRegionName(a.regionId);
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
        case 'region':
          return getRegionName(b.regionId);
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
  isCoordinator,
  sort,
  principalInstructorByDemandId,
]);


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
      const mapped: Record<string, { name: string; path: string }> = {};

      for (const d of docs) {
        mapped[d.doc_type] = { name: d.file_name || d.doc_type, path: d.file_path };
      }

      setDbDocs(mapped);
    } catch (e) {
      // silencioso (mas garante vazio)
      setDbDocs({});
    }

    // 2) Logística
    try {
      const { data, error } = await fetchLogisticByDemandId(formDemand.id);
      if (error) throw error;
      if (!data) return;

      // joga os campos do banco no formDemand (sem quebrar o que já está)
      setFormDemand(prev => ({
        ...prev,

        // ✅ status interno da logística (para VIEW não ficar "Pendente")
        logisticsTransport:
        data.transport_mode === 'CARRO_ALUGADO' || data.transport_mode === 'CARRO_PROPRIO'
          ? 'CONFIRMADO'
          : data.transport_mode === 'NAO_NECESSARIO' || data.transport_mode === 'NA'
          ? 'NAO_NECESSARIO'
          : '',

        logisticsHotel:
        data.lodging_mode === 'PRECISA_HOTEL'
          ? 'CONFIRMADO'
          : data.lodging_mode === 'NAO_NECESSARIO' || data.lodging_mode === 'NA'
          ? 'NAO_NECESSARIO'
          : '',


        // ✅ modos vindos do banco -> UI
      transportType:
        data.transport_mode === 'CARRO_ALUGADO'
          ? 'Carro Alugado'
          : data.transport_mode === 'CARRO_PROPRIO'
          ? 'Carro Próprio'
          : data.transport_mode === 'NAO_NECESSARIO' || data.transport_mode === 'NA'
          ? 'N/A'
          : null,

      accommodationType:
        data.lodging_mode === 'PRECISA_HOTEL'
          ? 'Hotel'
          : data.lodging_mode === 'NAO_NECESSARIO' || data.lodging_mode === 'NA'
          ? 'N/A'
          : null,

        // carro alugado
        rentalCompany: data.rental_company ?? prev.rentalCompany,
        rentalAgencyLocation: data.rental_agency_location ?? prev.rentalAgencyLocation,
        rentalLocator: data.rental_locator ?? prev.rentalLocator,
        carCategory: data.car_category ?? prev.carCategory,
        rentalCheckIn: data.rental_check_in ?? prev.rentalCheckIn,
        rentalCheckOut: data.rental_check_out ?? prev.rentalCheckOut,

        // hotel
        hotelCity: data.hotel_city ?? prev.hotelCity,
        hotelName: data.hotel_name ?? prev.hotelName,
        hotelCheckIn: data.hotel_check_in ?? prev.hotelCheckIn,
        hotelCheckOut: data.hotel_check_out ?? prev.hotelCheckOut,
        hotelPayment: data.hotel_payment ?? prev.hotelPayment,
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
      endDate: ''
    });
  };

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '---';

  const s = String(dateStr).trim();
  if (!s) return '---';

  // 1) Se vier só "YYYY-MM-DD" (date input)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  // 2) Se vier "YYYY-MM-DDTHH:mm..." (com ou sem Z / seconds)
  //    ✅ NÃO usar new Date() aqui (evita shift de timezone na Visualização)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const [datePart, timePartRaw] = s.split('T');
    const [y, m, d] = datePart.split('-');

    const hhmm = (timePartRaw || '').slice(0, 5); // "HH:mm"
    if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) {
      return `${d}/${m}/${y} ${hhmm}`;
    }

    // se por algum motivo não tiver HH:mm, cai só na data
    return `${d}/${m}/${y}`;
  }

  // 3) Fallback: tenta parsear com Date() (para formatos diferentes)
  const date = new Date(s);
  if (isNaN(date.getTime())) return s;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const baseDate = `${day}/${month}/${year}`;

  // Se tiver hora (string tem 'T' ou parece datetime), mostra HH:mm
  if (s.includes('T') || (s.includes(':') && s.length > 10)) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${baseDate} ${hours}:${minutes}`;
  }

  return baseDate;
};

const formatDateOnlySafe = (dateStr?: string) => {
  if (!dateStr) return '---';

  const s = String(dateStr).trim();
  if (!s) return '---';

  // pega só a parte YYYY-MM-DD se vier ISO
  const datePart = s.includes('T') ? s.split('T')[0] : s;

  // se já for YYYY-MM-DD, formata sem Date()
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-');
    return `${d}/${m}/${y}`;
  }

  // fallback
  return formatDateTime(s).split(' ')[0];
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
      cancelledAt: new Date().toISOString(),
      cancelInfo: {
        reason: selectedCancelReason,
        note: cancelTextNote,
        date: new Date().toISOString()
      }
    };
    
    updateDemand(cancelData);
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
      cancelInfo: undefined
    };
    
    updateDemand(reactivateData);
    setFormDemand(reactivateData);
    setConfirmReactivate(false);
  };

  const getDemandContentString = (isWhatsApp = false) => {
    const training = getTrainingName(formDemand.trainingId!);
    const company = getCompanyName(formDemand.companyId!);
    const start = formatDateTime(formDemand.startDate);
    const end = formatDateTime(formDemand.endDate);
    const instructor = getInstructorName(formDemand.instructorId);
    const b = (text: string) => isWhatsApp ? `*${text}*` : text;
    
    const currentStatus = calculateDemandStatus({
      startDate: formDemand.startDate!,
      endDate: formDemand.endDate!,
      instructorId: formDemand.instructorId,
      cancelled: formDemand.status === 'CANCELADA',
      trainingLocal: formDemand.trainingLocal,
      modality: formDemand.modality // ou a normalizada, se já existir
    });


    let content = `
${b('📄 DEMANDA DE TREINAMENTO')}
----------------------------------
ID: #${formDemand.id}
Empresa: ${company}
Treinamento: ${training}
Instrutor: ${instructor}

${b('📘 INFORMAÇÕES GERAIS')}
• Período: ${start} até ${end}
• Unidade/Local: ${formDemand.modality === 'ONLINE' ? 'N/A' : (formDemand.trainingLocal || 'N/A')}
• Modalidade: ${formDemand.modality}
• Região: ${getRegionName(formDemand.regionId!)}
• Corredor: ${formDemand.corredor || 'Não informado'}
• Solicitante: ${formDemand.requester || 'Não informado'}

${b('🚗 LOGÍSTICA — LOCOMOÇÃO')}
• Meio de Transporte: ${formDemand.transportType || 'N/A'}`;

    if (formDemand.transportType === 'Carro Alugado') {
      content += `
• Locadora: ${formDemand.rentalCompany}
• Localizador: ${formDemand.rentalLocator || 'A definir'}
• Local da Agência: ${formDemand.rentalAgencyLocation || 'N/A'}
• Check-in: ${formDemand.rentalCheckIn ? formatDateTime(formDemand.rentalCheckIn) : 'N/A'}
• Check-out: ${formDemand.rentalCheckOut ? formatDateTime(formDemand.rentalCheckOut) : 'N/A'}`;
    }

    content += `

${b('🏨 LOGÍSTICA — HOSPEDAGEM')}
• Hospedagem: ${formDemand.accommodationType === 'Hotel' ? 'Hotel Requerido' : 'N/A'}`;

    if (formDemand.accommodationType === 'Hotel') {
      content += `
• Hotel: ${formDemand.hotelName || 'A definir'}
• Cidade / Estado: ${formDemand.hotelCity || 'N/A'}
• Check-in: ${formDemand.hotelCheckIn ? formatDateTime(formDemand.hotelCheckIn) : 'N/A'}
• Check-out: ${formDemand.hotelCheckOut ? formatDateTime(formDemand.hotelCheckOut) : 'N/A'}
• Pagamento: ${formDemand.hotelPayment || 'N/A'}`;
    }

    content += `

${b('📌 STATUS ATUAL')}
• Status: ${currentStatus.replace('_', ' ')}

${b('📝 OBSERVAÇÕES')}
${formDemand.observations || 'N/A'}
    `.trim();

    return content;
  };

  const handleGenerateWord = async () => {
    const trainingName = getTrainingName(formDemand.trainingId!);
    const startStr = formDemand.startDate?.split('T')[0] || 'data';
    const instructorName = getInstructorName(formDemand.instructorId).split(' ')[0] || 'NaoAlocado';
    const fileName = `Demanda_${trainingName.replace(/\s+/g, '_')}_${startStr}_${instructorName}.docx`;

    const trainingData = trainings.find(t => t.id === formDemand.trainingId);
   
    const currentStatus = calculateDemandStatus({
    startDate: formDemand.startDate!,
    endDate: formDemand.endDate!,
    instructorId: formDemand.instructorId,
    cancelled: formDemand.status === 'CANCELADA',
    trainingLocal: formDemand.trainingLocal,
    modality: formDemand.modality,
  } as any);


    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: "📄 DEMANDA DE TREINAMENTO",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "📌 Documento oficial para alinhamento com instrutor",
                italics: true,
                color: "64748b",
                size: 20,
              }),
            ],
            spacing: { after: 100 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Identificador: #${formDemand.id}`,
                bold: true,
                size: 20,
              }),
            ],
            spacing: { after: 400 },
          }),

          new Paragraph({
            text: "📘 INFORMAÇÕES GERAIS",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 200, after: 200 },
          }),
          new Paragraph({ children: [new TextRun({ text: "🏢 Empresa / Cliente: ", bold: true }), new TextRun(getCompanyName(formDemand.companyId!))] }),
          new Paragraph({ children: [new TextRun({ text: "🎓 Treinamento: ", bold: true }), new TextRun(trainingName)] }),
          new Paragraph({ children: [new TextRun({ text: "Categoria: ", bold: true }), new TextRun(trainingData?.category || 'N/A')] }),
          new Paragraph({ children: [new TextRun({ text: "Carga Horária: ", bold: true }), new TextRun(`${trainingData?.hours || '0'}h`)] }),
          new Paragraph({ children: [new TextRun({ text: "🌐 Modalidade: ", bold: true }), new TextRun(formDemand.modality!)] }),
          new Paragraph({ children: [new TextRun({ text: "📅 Período: ", bold: true }), new TextRun(`${formatDateTime(formDemand.startDate)} até ${formatDateTime(formDemand.endDate)}`)] }),
          new Paragraph({ children: [new TextRun({ text: "📍 Local / Unidade: ", bold: true }), new TextRun(formDemand.modality === 'ONLINE' ? 'N/A' : (formDemand.trainingLocal || 'N/A'))] }),
          new Paragraph({ children: [new TextRun({ text: "🏢 Corredor: ", bold: true }), new TextRun(formDemand.corredor || 'Não informado')] }),
          new Paragraph({ children: [new TextRun({ text: "🌎 Região: ", bold: true }), new TextRun(getRegionName(formDemand.regionId!))] }),
          new Paragraph({ children: [new TextRun({ text: "🧑‍💼 Solicitante: ", bold: true }), new TextRun(formDemand.requester || 'Não informado')] }),

          new Paragraph({
            text: "👨‍🏫 INSTRUTOR",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({ children: [new TextRun({ text: "👤 Instrutor alocado: ", bold: true }), new TextRun(getInstructorName(formDemand.instructorId))] }),

          new Paragraph({
            text: "🚗 LOGÍSTICA — LOCOMOÇÃO",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({ children: [new TextRun({ text: "Meio de Transporte: ", bold: true }), new TextRun(formDemand.transportType || 'N/A')] }),
          ...(formDemand.transportType === 'Carro Alugado' ? [
            new Paragraph({ children: [new TextRun({ text: "Locadora: ", bold: true }), new TextRun(formDemand.rentalCompany || 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Localizador: ", bold: true }), new TextRun(formDemand.rentalLocator || 'A definir')] }),
            new Paragraph({ children: [new TextRun({ text: "Local da Agência: ", bold: true }), new TextRun(formDemand.rentalAgencyLocation || 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Check-in: ", bold: true }), new TextRun(formDemand.rentalCheckIn ? formatDateTime(formDemand.rentalCheckIn) : 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Check-out: ", bold: true }), new TextRun(formDemand.rentalCheckOut ? formatDateTime(formDemand.rentalCheckOut) : 'N/A')] }),
          ] : []),

          new Paragraph({
            text: "🏨 LOGÍSTICA — HOSPEDAGEM",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({ children: [new TextRun({ text: "Hospedagem: ", bold: true }), new TextRun(formDemand.accommodationType === 'Hotel' ? 'Hotel Requerido' : 'N/A')] }),
          ...(formDemand.accommodationType === 'Hotel' ? [
            new Paragraph({ children: [new TextRun({ text: "Hotel: ", bold: true }), new TextRun(formDemand.hotelName || 'A definir')] }),
            new Paragraph({ children: [new TextRun({ text: "Cidade / Estado: ", bold: true }), new TextRun(formDemand.hotelCity || 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Check-in: ", bold: true }), new TextRun(formDemand.hotelCheckIn ? formatDateTime(formDemand.hotelCheckIn) : 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Check-out: ", bold: true }), new TextRun(formDemand.hotelCheckOut ? formatDateTime(formDemand.hotelCheckOut) : 'N/A')] }),
            new Paragraph({ children: [new TextRun({ text: "Pagamento: ", bold: true }), new TextRun(formDemand.hotelPayment || 'N/A')] }),
          ] : []),
          
          new Paragraph({
            text: "📌 STATUS DA DEMANDA",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({ children: [new TextRun({ text: "Status Atual: ", bold: true }), new TextRun(currentStatus.replace('_', ' '))] }),

          new Paragraph({
            text: "📝 OBSERVAÇÕES",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: formDemand.observations || "N/A",
                italics: true,
              }),
            ],
            spacing: { before: 100 },
          }),

          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `\nGerado automaticamente via Colabor Training Manager em ${new Date().toLocaleString('pt-BR')}`,
                size: 16,
                color: "94a3b8",
              }),
            ],
            spacing: { before: 1000 },
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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


const mapTransportMode = (t: TransportType | null | undefined) => {
  if (t === 'Carro Alugado') return 'CARRO_ALUGADO';
  if (t === 'Carro Próprio') return 'CARRO_PROPRIO';
  return null;
};



const mapLodgingMode = (a: AccommodationType | null | undefined) => {
  if (a === 'Hotel') return 'PRECISA_HOTEL';
  return null;
};


// ===============================
// ✅ Helpers ÚNICOS (não duplicar)
// - Usados no handleSave e na logística
// - IMPORTANTE: NÃO use toISOString() para startDate/endDate da demanda
// ===============================

const toIsoFromAnyDateSafe = (v?: string | null) => {
  const s = (v ?? '').trim();
  if (!s) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
};

// datetime-local ("YYYY-MM-DDTHH:mm") -> ISO (para campos de logística que são timestamptz)
const toIsoFromDateTimeLocalSafe = (dt?: string | null) => {
  const s = (dt ?? '').trim();
  if (!s) return null;

  // aceita yyyy-mm-ddThh:mm
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
};

// date ("YYYY-MM-DD") -> ISO 00:00:00 (para hotelCheckIn/out se forem timestamptz/date no banco)
const toIsoFromDateInputSafe = (dateStr?: string | null) => {
  const s = (dateStr ?? '').trim();
  if (!s) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
};

const handleSave = async () => {
  if (!isFormValid) return;

  // ⛔ trava clique duplo
  if (isSaving) return;
  setIsSaving(true);


  try {
    // Validação de datas (Início <= Fim) — segura
    if (formDemand.startDate && formDemand.endDate) {
      const sIso = toIsoFromAnyDateSafe(formDemand.startDate);
      const eIso = toIsoFromAnyDateSafe(formDemand.endDate);
      if (sIso && eIso) {
        const start = new Date(sIso);
        const end = new Date(eIso);
        if (start > end) {
          setResourceError('A data de início não pode ser maior que a data de fim.');
          setTimeout(() => setResourceError(null), 4000);
          return;
        }
      }
    }

    // ✅ ONLINE: não pode gerar pendência de logística / local
    const sanitizedDemand: Demand = {
      ...(formDemand as Demand),

      // ✅ FIX: salvar datas sempre como ISO (timestamptz estável)
      // (evita sumir hora / input quebrar quando volta do Supabase)
      startDate: (formDemand.startDate || '') as any,
      endDate: (formDemand.endDate || '') as any,

      // ✅ prática híbrida (se existir) também em ISO estável
      practiceStartDate: ((formDemand as any).practiceStartDate || null) as any,
      practiceEndDate: ((formDemand as any).practiceEndDate || null) as any,

      trainingLocal: formDemand.modality === 'ONLINE' ? '' : (formDemand.trainingLocal || ''),
      regionId: formDemand.regionId || '',

      logisticsTransport:
        formDemand.modality === 'ONLINE'
          ? 'NAO_NECESSARIO'
          : (formDemand.logisticsTransport ?? ''),

      logisticsHotel:
        formDemand.modality === 'ONLINE'
          ? 'NAO_NECESSARIO'
          : (formDemand.logisticsHotel ?? ''),

      transportType: formDemand.modality === 'ONLINE' ? null : formDemand.transportType,
      accommodationType: formDemand.modality === 'ONLINE' ? null : formDemand.accommodationType,

      rentalAgencyLocation: formDemand.modality === 'ONLINE' ? '' : (formDemand.rentalAgencyLocation || ''),
      rentalLocator: formDemand.modality === 'ONLINE' ? '' : (formDemand.rentalLocator || ''),
      rentalCheckIn: formDemand.modality === 'ONLINE' ? '' : (formDemand.rentalCheckIn || ''),
      rentalCheckOut: formDemand.modality === 'ONLINE' ? '' : (formDemand.rentalCheckOut || ''),

      hotelName: formDemand.modality === 'ONLINE' ? '' : (formDemand.hotelName || ''),
      hotelCity: formDemand.modality === 'ONLINE' ? '' : (formDemand.hotelCity || ''),
      hotelCheckIn: formDemand.modality === 'ONLINE' ? '' : (formDemand.hotelCheckIn || ''),
      hotelCheckOut: formDemand.modality === 'ONLINE' ? '' : (formDemand.hotelCheckOut || ''),
      hotelPayment: formDemand.modality === 'ONLINE' ? null : formDemand.hotelPayment,
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
    } else {
      await Promise.resolve(updateDemand(sanitizedDemand));
      demandId = demandId ?? sanitizedDemand.id;
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
    const isOnline = sanitizedDemand.modality === 'ONLINE';
    const isCarRental = sanitizedDemand.transportType === 'Carro Alugado';
    const isHotel = sanitizedDemand.accommodationType === 'Hotel';

    // ✅ transport_mode / lodging_mode: N/A vira 'NA' (não null)
    const transportModeToDb = isOnline
      ? 'NAO_NECESSARIO'
      : sanitizedDemand.transportType === 'Carro Alugado'
      ? 'CARRO_ALUGADO'
      : sanitizedDemand.transportType === 'Carro Próprio'
      ? 'CARRO_PROPRIO'
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
        has_material: false,

        overall_status: 'PENDENTE',
      });
    } catch (e) {
      console.error('Erro ao salvar logística:', e);
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

      // Atualiza flags na logística (se subiu algum)
      if (classUploaded || releaseUploaded) {
        await upsertLogisticByDemandId(demandId, {
          has_class_list_pdf: classUploaded ? true : undefined,
          has_release_pdf: releaseUploaded ? true : undefined
        });
      }

      // Recarrega docs para aparecer no VIEW
      if (classUploaded || releaseUploaded) {
        const docs = await fetchDemandDocumentsByDemandId(demandId);
        const mapped: Record<string, { name: string; path: string }> = {};
        for (const d of docs) {
          mapped[d.doc_type] = { name: d.file_name || d.doc_type, path: d.file_path };
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
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const toLocalDateInputFromAny = (v?: string) => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return (v.includes('T') ? v.split('T')[0] : v);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };


  const handleOpenAllocationModal = () => {
    if (!formDemand.id) return;

    const usePractice =
      (formDemand.modality === 'HIBRIDO' || formDemand.modality === 'HÍBRIDA' || formDemand.modality === 'HÍBRIDO') &&
      !!(formDemand as any).practiceStartDate &&
      !!(formDemand as any).practiceEndDate;

    const startBase = usePractice
      ? toLocalDateInputFromAny((formDemand as any).practiceStartDate)
      : toLocalDateInputFromAny(formDemand.startDate);

    const endBase = usePractice
      ? toLocalDateInputFromAny((formDemand as any).practiceEndDate)
      : toLocalDateInputFromAny(formDemand.endDate);

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
  const practiceStartDateOnly = toLocalDateInputFromAny(practiceStartRaw);
  const practiceEndDateOnly   = toLocalDateInputFromAny(practiceEndRaw);

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





    // 2. Validar conflito de agenda do instrutor (usa comparação exata de data/hora)
    if (hasScheduleConflict(allocationForm.instructorId, startIso, endIso)) {
      setResourceError("O instrutor selecionado já possui um compromisso neste período.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

    // PERSISTÊNCIA NO ESTADO GLOBAL
    const newAllocation: InstructorAllocation = {
      id: `ALOC-${Date.now()}`,
      demandId: formDemand.id!,
      instructorId: allocationForm.instructorId,
      startDate: startIso,
      endDate: endIso
    };

    addInstructorAllocation(newAllocation);
    
    // LIMPEZA E FECHAMENTO
    setAllocationForm({ instructorId: '', startDate: '', endDate: '' });
    setIsAllocationModalOpen(false);
  };

  const handleOpenResourceModal = () => {
    if (!formDemand.id) return;
    setResourceError(null);
    setResourceForm({
      startDate: toLocalDateInputFromAny(formDemand.startDate) || '',
      endDate: toLocalDateInputFromAny(formDemand.endDate) || ''

    });
    setIsResourceModalOpen(true);
  };

  const handleAddResourceAllocation = () => {
    setResourceError(null);
    if (!resourceForm.startDate || !resourceForm.endDate) {
      setResourceError("Preencha as datas de alocação do CTM.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

    const normalizeStart = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T00:00:00');
    const normalizeEnd = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T23:59:59');

    const allocStartLimit = normalizeStart(resourceForm.startDate);
    const allocEndLimit = normalizeEnd(resourceForm.endDate);
    const demandStartLimit = normalizeStart(formDemand.startDate!);
    const demandEndLimit = normalizeEnd(formDemand.endDate!);

    // 1. Validar limites da demanda
    if (allocStartLimit < demandStartLimit || allocEndLimit > demandEndLimit) {
      setResourceError("O período do CTM deve estar dentro do período da demanda.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

    // 2. Validar conflito do CTM
    if (hasResourceConflict(resourceForm.startDate, resourceForm.endDate, formDemand.id)) {
      setResourceError("O Centro de Treinamento Móvel já possui um compromisso neste período.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }

    const newAllocation: LogisticAllocation = {
      id: `RES-${Date.now()}`,
      demandId: formDemand.id!,
      resourceType: 'CENTRO_TREINAMENTO_MOVEL',
      startDate: resourceForm.startDate,
      endDate: resourceForm.endDate
    };

    addResourceAllocation(newAllocation);
    setIsResourceModalOpen(false);
  };

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

  
  const toLocalDateInput = (v?: string | null) => {
    const s = (v ?? '').trim();
    if (!s) return '';

    // Se vier só yyyy-mm-dd, já serve
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      // fallback: tenta cortar "YYYY-MM-DD" se existir
      if (s.includes('T')) return s.split('T')[0];
      return '';
    }

    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const toLocalTimeInput = (v?: string | null) => {
    const s = (v ?? '').trim();
    if (!s) return '';

    // Se já veio como YYYY-MM-DDTHH:mm (sem seconds/Z), pega HH:mm
    const m1 = s.match(/T(\d{2}:\d{2})/);
    if (m1?.[1]) return m1[1];

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';

    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${hh}:${mm}`;
  };

  const buildLocalDateTime = (date: string, time: string) => {
    const d = (date ?? '').trim();
    const t = (time ?? '').trim();
    if (!d) return '';
    const safeTime = t || '08:00';
    // datetime-local padrão: YYYY-MM-DDTHH:mm
    return `${d}T${safeTime}`;
  };

  const handleDateChange = (field: 'startDate' | 'endDate', val: string) => {
    const time = toLocalTimeInput(formDemand[field] as any) || '08:00';
    setFormDemand(prev => ({ ...prev, [field]: buildLocalDateTime(val, time) }));
    setResourceError(null);
  };

  const handleTimeChange = (field: 'startDate' | 'endDate', val: string) => {
    const date = toLocalDateInput(formDemand[field] as any);
    if (!date) return;
    setFormDemand(prev => ({ ...prev, [field]: buildLocalDateTime(date, val) }));
    setResourceError(null);
  };

  const getDateValue = (field: 'startDate' | 'endDate') => {
    return toLocalDateInput(formDemand[field] as any);
  };

  const getTimeValue = (field: 'startDate' | 'endDate') => {
    return toLocalTimeInput(formDemand[field] as any);
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

    const startDate = toLocalDateInput(activeDemand.startDate);
    const startTime = toLocalTimeInput(activeDemand.startDate) || '08:00';

    const endDate = toLocalDateInput(activeDemand.endDate);
    const endTime = toLocalTimeInput(activeDemand.endDate) || '18:00';

    setFormDemand(prev => ({
      ...prev,
      startDate: buildLocalDateTime(startDate, startTime),
      endDate: buildLocalDateTime(endDate, endTime),
    }));
  }, [isModalOpen, modalMode, modalSubMode, activeDemand]);


  const DataViewField = ({ label, value, icon: Icon, isPdf = false, onDownload }: { label: string, value: string | number | undefined, icon?: any, isPdf?: boolean, onDownload?: () => void }) => (
    <div className="flex flex-col space-y-1">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-slate-400" />}
        {isPdf && value ? (
          <button onClick={onDownload} className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1.5">
            <FileCheck size={14} /> {value}
          </button>
        ) : (
          <span className="text-sm font-bold text-slate-700">{value || '---'}</span>
        )}
      </div>
    </div>
  );

  const DataList = ({ id, items }: { id: string, items: string[] }) => (
    <datalist id={id}>
      {items.map(item => <option key={item} value={item} />)}
    </datalist>
  );

  const handleTransportClick = (t: TransportType) => {
  setFormDemand(prev => {
    if (t === 'Carro Alugado') {
      return {
        ...prev,
        transportType: 'Carro Alugado',
        logisticsTransport: 'CONFIRMADO'
      };
    }

    // Carro Próprio ou N/A
    return {
      ...prev,
      transportType: t,                 // <- mantém 'N/A' como valor (não null)
      logisticsTransport: 'NAO_NECESSARIO',

      // se não for carro alugado, limpa campos de locação
      rentalAgencyLocation: '',
      rentalLocator: '',
      rentalCheckIn: '',
      rentalCheckOut: '',
      // (se você quiser manter defaults, ok, mas não é obrigatório)
    };
  });
};



 const handleAccommodationClick = (type: AccommodationType) => {
  if (type === 'N/A') {
    setFormDemand(prev => ({
      ...prev,
      accommodationType: 'N/A',

      // 🔥 limpa tudo de hotel
      hotelCity: '',
      hotelName: '',
      hotelCheckIn: '',
      hotelCheckOut: '',
      hotelPayment: null,

      logisticsHotel: 'NAO_NECESSARIO',
    }));
  } else {
    setFormDemand(prev => ({
      ...prev,
      accommodationType: 'Hotel',
      logisticsHotel: 'CONFIRMADO',
    }));
  }
};

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

      <DataList id="aprovadores-list" items={operationalBases.aprovadores} />
      <DataList id="analistas-list" items={operationalBases.analistas} />
      <DataList id="corredores-list" items={operationalBases.corredores} />
      <DataList id="localidades-list" items={operationalBases.localidades} />
      <DataList id="hoteis-list" items={operationalBases.hoteis} />
      <DataList id="agencias-list" items={operationalBases.localidades} />
      <DataList id="matriculadores-list" items={operationalBases.matriculadores} />

      <div className="flex flex-col space-y-4 no-print">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800">Gestão de Demandas</h1>
            {canPerformAction(profile?.role, 'create_demand') && (
          <button
            onClick={handleOpenCreate}
            className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
          >
            <Plus size={18} /> <span className="hidden sm:inline">Nova Demanda</span>
          </button>
        )}
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Filter size={14} /> Filtros de Pesquisa Avançada
            </h3>
            <button 
              onClick={clearFilters}
              className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={12} /> Limpar Filtros
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
          </div>
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
                ID {sort.key === 'id' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('company')}
              >
                Empresa {sort.key === 'company' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('training')}
              >
                Treinamento {sort.key === 'training' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('region')}
              >
                Região {sort.key === 'region' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('startDate')}
              >
                Data Início {sort.key === 'startDate' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 cursor-pointer select-none"
                onClick={() => toggleSort('instructor')}
              >
                Instrutor {sort.key === 'instructor' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th
                className="p-4 text-center cursor-pointer select-none"
                onClick={() => toggleSort('status')}
              >
                Status {sort.key === 'status' && (sort.direction === 'asc' ? '↑' : '↓')}
              </th>

              <th className="p-4 text-center">Ações</th>
            </tr>

            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDemands.length > 0 ? filteredDemands.map(demand => {
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
                    <td className="p-4 max-w-xs truncate">{getTrainingName(demand.trainingId)}</td>
                    <td className="p-4">{getRegionName(demand.regionId)}</td>
                    <td className="p-4 whitespace-nowrap">{formatDateTime(demand.startDate.split('T')[0])}</td>
                    <td className="p-4 font-medium text-gray-900">{getInstructorName(principalInstructorByDemandId[demand.id])}</td>
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
                  <td colSpan={8} className="p-20 text-center text-slate-400">
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
        </div>
      </div>

      {isModalOpen && (
        <div 
          className="fixed inset-0 z-[100] bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4 no-print"
          onClick={() => {
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
                      {modalSubMode === 'VIEW' && <p className="text-xs text-slate-400 font-mono mt-1">ID: {formDemand.id}</p>}
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
                    {currentStatus === 'CANCELADA' && (formDemand.cancelledAt || formDemand.cancelInfo) && (
                      <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex flex-col gap-2 text-red-700">
                        <div className="flex items-center gap-3">
                          <Ban size={20} />
                          <div>
                            <p className="font-bold text-sm uppercase">Demanda Cancelada</p>
                            <p className="text-xs">Cancelamento registrado em {new Date(formDemand.cancelInfo?.date || formDemand.cancelledAt || '').toLocaleString('pt-BR')}</p>
                          </div>
                        </div>
                        {formDemand.cancelInfo && (
                          <div className="mt-2 text-xs border-t border-red-100 pt-2">
                            <p><strong>Motivo:</strong> {formDemand.cancelInfo.reason}</p>
                            {formDemand.cancelInfo.note && <p><strong>Observação:</strong> {formDemand.cancelInfo.note}</p>}
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
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                  Local do Treinamento {formDemand.modality === 'ONLINE' ? '' : '*'}
                                </label>

                                <input
                                  list="localidades-list"
                                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none ${
                                    formDemand.modality === 'ONLINE' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''
                                  }`}
                                  value={formDemand.modality === 'ONLINE' ? '' : (formDemand.trainingLocal || '')}
                                  onChange={(e) => setFormDemand({ ...formDemand, trainingLocal: e.target.value })}
                                  placeholder={formDemand.modality === 'ONLINE' ? 'N/A (ONLINE)' : 'Ex: Brucutu, Vitória...'}
                                  disabled={formDemand.modality === 'ONLINE'}
                                />
                              </div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Região</label><select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" value={formDemand.regionId} onChange={(e) => setFormDemand({...formDemand, regionId: e.target.value})}><option value="">Selecione...</option>{regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                              <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Corredor</label>
                              <input
                                list="corredores-list"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                value={formDemand.corredor || ''}
                                onChange={(e) => setFormDemand({ ...formDemand, corredor: e.target.value })}
                                placeholder="Selecione ou digite..."
                              />
                            </div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Atendimento</label><input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-700 font-bold" value={formDemand.modality || '---'} readOnly /><p className="text-[10px] text-slate-400 mt-1">Campo automático (puxado do Treinamento).</p></div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Solicitante</label><input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formDemand.requester || ''} onChange={(e) => setFormDemand({...formDemand, requester: e.target.value})} /></div>
                              
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
                                <DataViewField label="Unidade / Local" value={formDemand.modality === 'ONLINE' ? 'N/A' : formDemand.trainingLocal} icon={MapPin} />
                                <DataViewField label="Início" value={formatDateTime(formDemand.startDate)} icon={Calendar} />
                                <DataViewField label="Fim" value={formatDateTime(formDemand.endDate)} icon={Calendar} />
                                <DataViewField label="Região" value={getRegionName(formDemand.regionId!)} icon={MapPin} />
                                <DataViewField label="Corredor" value={formDemand.corredor} icon={MapPin} />
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
                                <DataViewField
                                  label="Instrutor Principal"
                                  value={getInstructorName(formDemand.instructorId)}
                                  icon={UserCheck}
                                />

                                {principalInstructor2Id && (
                                  <DataViewField
                                    label="Instrutor Principal 2"
                                    value={getInstructorName(principalInstructor2Id)}
                                    icon={UserCheck}
                                  />
                                )}

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
                            {currentStatus !== 'CANCELADA' && (
                              <button 
                                onClick={handleOpenResourceModal}
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

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <button onClick={() => toggleSection('locomocao')} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"><div className="flex items-center gap-3"><div className="p-2 bg-amber-50 rounded-lg text-amber-600"><Truck size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Logística — Locomoção</h3></div>{openSections.locomocao ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
                      {openSections.locomocao && (
                        <div className="px-6 py-6 border-t border-slate-100 bg-white">
                          {modalSubMode === 'FORM' ? (
                            <div className="space-y-6">
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-2">Meio de Transporte</label>
                             <div className="flex gap-2">
                                {(['Carro Alugado', 'Carro Próprio', 'N/A'] as TransportType[]).map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => handleTransportClick(t)}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all
                                      ${
                                        formDemand.transportType === t
                                          ? 'bg-amber-600 text-white border-amber-600'
                                          : 'bg-white text-slate-500 border-slate-200 hover:border-amber-400'
                                      }`}
                                  >
                                    {t}
                                  </button>
                                ))}
                              </div>
                              </div>
                              {formDemand.transportType === 'Carro Alugado' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 bg-amber-50/50 rounded-xl border border-amber-100">
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-2">Empresa de Locação</label>
                                    <select className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={formDemand.rentalCompany || 'Localiza'} onChange={(e) => setFormDemand({...formDemand, rentalCompany: e.target.value as RentalCompany})}>{operationalBases.locadoras.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                  </div>
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-1">Local da Agência</label><input list="agencias-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formDemand.rentalAgencyLocation || ''} onChange={(e) => setFormDemand({...formDemand, rentalAgencyLocation: e.target.value})} placeholder="Onde retira o carro?" /></div>
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-1 flex items-center gap-1"><Tag size={12} /> Localizador</label><input type="text" className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none" value={formDemand.rentalLocator || ''} onChange={(e) => setFormDemand({...formDemand, rentalLocator: e.target.value})} /></div>
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-1">Categoria</label><select className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={formDemand.carCategory || 'Grupo CE'} onChange={(e) => setFormDemand({...formDemand, carCategory: e.target.value})}>{CAR_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}</select></div>
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-in</label><input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={formDemand.rentalCheckIn || ''} onChange={e => setFormDemand({...formDemand, rentalCheckIn: e.target.value})} /></div>
                                  <div><label className="block text-xs font-bold text-amber-800 uppercase mb-1">Check-out</label><input type="datetime-local" className="w-full border border-amber-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" value={formDemand.rentalCheckOut || ''} onChange={e => setFormDemand({...formDemand, rentalCheckOut: e.target.value})} /></div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <DataViewField label="Meio de Transporte" value={formDemand.transportType || (formDemand.logisticsTransport === 'NAO_NECESSARIO' ? 'N/A' : 'Pendente')} icon={Truck} />
                              {formDemand.transportType === 'Carro Alugado' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-amber-50 rounded-xl border border-amber-100">
                                  <DataViewField label="Locadora" value={formDemand.rentalCompany} icon={Building2} />
                                  <DataViewField label="Local da Agência" value={formDemand.rentalAgencyLocation} icon={MapPin} />
                                  <DataViewField label="Localizador" value={formDemand.rentalLocator} icon={Tag} />
                                  <DataViewField label="Categoria" value={formDemand.carCategory} icon={Tag} />
                                  <DataViewField label="Check-in" value={formDemand.rentalCheckIn ? new Date(formDemand.rentalCheckIn).toLocaleString() : ''} icon={Clock} />
                                  <DataViewField label="Check-out" value={formDemand.rentalCheckOut ? new Date(formDemand.rentalCheckOut).toLocaleString() : ''} icon={Clock} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => toggleSection('hospedagem')}
            className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg text-green-600">
                <Home size={20} />
              </div>
              <h3 className="font-bold text-slate-800 uppercase text-sm">Logística — Hospedagem</h3>
            </div>
            {openSections.hospedagem ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>

          {openSections.hospedagem && (
            <div className="px-6 py-6 border-t border-slate-100 bg-white">
              {modalSubMode === 'FORM' ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Hospedagem</label>

                    <div className="flex gap-2">
                      {(['Hotel', 'N/A'] as AccommodationType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleAccommodationClick(type)}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all
                            ${
                              formDemand.accommodationType === type
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-green-400'
                            }`}
                        >
                          {type === 'N/A' ? 'N/A' : 'Precisa de Hotel'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {formDemand.accommodationType === 'Hotel' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-green-50/50 rounded-xl border border-green-100">
                      <div>
                        <label className="block text-xs font-bold text-green-800 uppercase mb-1">Cidade / Estado</label>
                        <input
                          list="cidades-list"
                          className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={formDemand.hotelCity || ''}
                          onChange={(e) => setFormDemand({ ...formDemand, hotelCity: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-green-800 uppercase mb-1">Hotel</label>
                        <input
                          list="hoteis-list"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          value={formDemand.hotelName || ''}
                          onChange={(e) => setFormDemand({ ...formDemand, hotelName: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-in</label>
                        <input
                          type="date"
                          className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                          value={formDemand.hotelCheckIn || ''}
                          onChange={(e) => setFormDemand({ ...formDemand, hotelCheckIn: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-out</label>
                        <input
                          type="date"
                          className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
                          value={formDemand.hotelCheckOut || ''}
                          onChange={(e) => setFormDemand({ ...formDemand, hotelCheckOut: e.target.value })}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-green-800 uppercase mb-1">Pagamento</label>
                        <select
                          className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          value={formDemand.hotelPayment || 'Faturado'}
                          onChange={(e) =>
                            setFormDemand({ ...formDemand, hotelPayment: e.target.value as PaymentMethod })
                          }
                        >
                          {PAYMENT_METHODS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <DataViewField
                    label="Hospedagem"
                    value={
                      formDemand.accommodationType === 'Hotel'
                        ? 'Hotel Requerido'
                        : formDemand.logisticsHotel === 'NAO_NECESSARIO'
                        ? 'N/A'
                        : 'Pendente'
                    }
                    icon={Home}
                  />

                  {formDemand.accommodationType === 'Hotel' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-green-50 rounded-xl border border-green-100">
                      <DataViewField label="Cidade / Estado" value={formDemand.hotelCity} icon={MapPin} />
                      <DataViewField label="Hotel" value={formDemand.hotelName} icon={Building2} />
                      <DataViewField
                        label="Check-in"
                        value={formDemand.hotelCheckIn ? new Date(formDemand.hotelCheckIn).toLocaleDateString() : ''}
                        icon={Calendar}
                      />
                      <DataViewField
                        label="Check-out"
                        value={formDemand.hotelCheckOut ? new Date(formDemand.hotelCheckOut).toLocaleDateString() : ''}
                        icon={Calendar}
                      />
                      <DataViewField label="Pagamento" value={formDemand.hotelPayment} icon={Tag} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <button onClick={() => toggleSection('documentos')} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print">
                        <div className="flex items-center gap-3"><div className="p-2 bg-rose-50 rounded-lg text-rose-600"><FileDown size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Documentos da Demanda</h3></div>
                        {openSections.documentos ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                      {openSections.documentos && (
                        <div className="px-6 py-6 border-t border-slate-100 bg-white">
                          {modalSubMode === 'FORM' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                               
                               {/* Lista da Turma */}
                                <div className="space-y-3">
                                  <label className="block text-xs font-bold text-gray-500 uppercase">
                                    Lista da Turma (PDF)
                                  </label>

                                  {pendingPdfs.classList ? (
                                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                                      <div className="flex items-center gap-2 overflow-hidden">
                                        <FileCheck size={18} className="text-blue-600 shrink-0" />
                                        <span className="text-xs font-bold text-slate-700 truncate">
                                          {pendingPdfs.classList.name}
                                        </span>
                                      </div>

                                      <button
                                        onClick={() => removePdf('classList')}
                                        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                        title="Remover PDF"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="relative group">
                                      <input
                                        type="file"
                                        accept="application/pdf"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) handlePdfSelect('classList', f);

                                          // 🔧 permite selecionar o MESMO arquivo novamente
                                          e.currentTarget.value = '';
                                        }}
                                        disabled={false}
                                      />

                                      <div
                                        className={`p-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-all
                                          border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50/30
                                        `}
                                      >
                                        <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                                        <span className="text-[10px] font-black uppercase text-slate-400">
                                          {modalMode === 'CREATE'
                                            ? 'Selecionar PDF (será enviado ao criar)'
                                            : 'Anexar Lista de Presença'}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>


                              {/* Liberação do Instrutor */}
                              <div className="space-y-3">
                                <label className="block text-xs font-bold text-gray-500 uppercase">Liberação do Instrutor (PDF)</label>

                                {pendingPdfs.instructorRelease ? (
                                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                      <FileCheck size={18} className="text-blue-600 shrink-0" />
                                      <span className="text-xs font-bold text-slate-700 truncate">{pendingPdfs.instructorRelease.name}</span>
                                    </div>
                                    <button onClick={() => removePdf('instructorRelease')} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="relative group">
                                    <input
                                      type="file"
                                      accept=".pdf"
                                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                      onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) handlePdfSelect('instructorRelease', f);
                                      e.currentTarget.value = '';
                                    }}
                                    />
                                    <div className={`p-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-all
                                      ${'border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50/30'}
                                    `}>
                                      <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                                      <span className="text-[10px] font-black uppercase text-slate-400">
                                        {modalMode === 'CREATE' ? 'Selecionar PDF (será enviado ao criar)' : 'Anexar Liberação'}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                               <DataViewField
                                label="Lista da Turma"
                                value={dbDocs['LISTA_TURMA']?.name}
                                isPdf={true}
                                onDownload={() => downloadSavedPdf('LISTA_TURMA')}
                              />

                              <DataViewField
                                label="Liberação do Instrutor"
                                value={dbDocs['LIBERACAO_INSTRUTOR']?.name}
                                isPdf={true}
                                onDownload={() => downloadSavedPdf('LIBERACAO_INSTRUTOR')}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
      )}

      {/* MODAL DE ALOCAÇÃO DE INSTRUTOR */}
      {isAllocationModalOpen && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Nova Alocação</h3>
              <button onClick={() => setIsAllocationModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-6 space-y-4">
              {resourceError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in mb-2">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-red-700 leading-tight">
                    {resourceError}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Instrutor</label>
                <select 
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  value={allocationForm.instructorId}
                  onChange={e => setAllocationForm({...allocationForm, instructorId: e.target.value})}
                >
                  <option value="">Selecione...</option>
                  {instructors.filter(i => i.status === 'ATIVO').map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
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
      )}

      {/* MODAL DE ALOCAÇÃO DE RECURSO (CTM) */}
      {isResourceModalOpen && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-amber-700 uppercase tracking-tight">Alocar Centro Móvel</h3>
              <button onClick={() => setIsResourceModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
            </div>
            <div className="p-6 space-y-4">
              {resourceError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in mb-2">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-red-700 leading-tight">
                    {resourceError}
                  </p>
                </div>
              )}
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-4">
                <div className="p-3 bg-white rounded-xl text-amber-600 shadow-sm border border-amber-100"><Truck size={24}/></div>
                <div>
                   <p className="text-sm font-black text-amber-900 uppercase">Recurso Logístico</p>
                   <p className="text-xs font-bold text-amber-600">Centro de Treinamento Móvel</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Início</label>
                  <input 
                    type="date" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.startDate} 
                    onChange={e => { setResourceForm({...resourceForm, startDate: e.target.value}); setResourceError(null); }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Data Fim</label>
                  <input 
                    type="date" 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    value={resourceForm.endDate} 
                    onChange={e => { setResourceForm({...resourceForm, endDate: e.target.value}); setResourceError(null); }}
                  />
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2">
                <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-blue-700 leading-tight">
                  O CTM deve estar dentro do período: {formatDateTime(formDemand.startDate?.split('T')[0])} e {formatDateTime(formDemand.endDate?.split('T')[0])}
                </p>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button onClick={() => setIsResourceModalOpen(false)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest text-slate-500">Cancelar</button>
              <button onClick={handleAddResourceAllocation} className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-amber-200">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE MOTIVO DE CANCELAMENTO */}
      {confirmCancel && (
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
      )}

      {confirmDelete && (
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
      )}

      {confirmReactivate && (
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
      )}
    </div>
  );
};

export default Demands;