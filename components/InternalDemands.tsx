import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useApp } from '../App';
import { useAuth } from '../contexts/AuthContext';
import { usePagination } from '../hooks/usePagination';
import Pagination from './Pagination';

import {
  Demand,
  DemandStatus,
  LogisticaHospedagem,
  LogisticaLocomocao,
  SpecificDateEntry,
  TransportType,
  AccommodationType,
} from '../types';

import {
  Search,
  Plus,
  X,
  FileText,
  FileSearch,
  Eraser,
  Trash2,
  Ban,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Building,
  Clock,
  MapPin,
  Tag,
  User,
  AlertTriangle,
} from 'lucide-react';

import { calculateDemandStatus } from '../domain/demandStatus';
import { logAction } from '../services/auditLog';
import { upsertMeasurementByDemandId } from '../services/measurements';
import {
  uploadAndUpsertDemandPdf,
  getDemandDocumentSignedUrl,
  fetchDemandDocumentsByDemandId,
  markDemandDocumentAsNA,
} from '../services/demandDocuments';
import {
  upsertLogisticByDemandId,
  fetchLogisticByDemandId,
  fetchLogisticBlocksByDemandId,
  upsertLogisticBlocks,
} from '../services/logistics';
import { fetchLocationAssociations, type LocationAssociation } from '../services/locationAssociations';

import DataViewField from './demand-form/DataViewField';
import LogisticaLocomocaoSection, { emptyLocomocaoBlock } from './demand-form/LogisticaLocomocaoSection';
import LogisticaHospedagemSection, { emptyHospedagemBlock } from './demand-form/LogisticaHospedagemSection';
import DocumentosDemandaSection, { type DbDocs, type PendingPdfs } from './demand-form/DocumentosDemandaSection';
import { formatDateTime } from './demand-form/formatters';
import type { DemandFormState } from './demand-form/types';

/**
 * DEMANDAS INTERNAS
 *
 * Demanda da própria Colabor para um instrutor: visita técnica, SIPAT, apoio
 * logístico, evento. Não tem cliente nem treinamento — a carga horária vem de
 * `horasPrevistas` e o "nome" da demanda vem de `categoriaInterna` +
 * `descricaoInterna`.
 *
 * Tudo o que é operacional (localidade em cascata, datas, logística, documentos,
 * medição) segue idêntico à demanda de cliente: as três seções de logística e
 * documentos são os MESMOS componentes que o formulário de cliente usa, e o
 * status sai do mesmo `calculateDemandStatus`.
 *
 * O que NÃO existe aqui: Empresa/Cliente, Treinamento, ID SAP e Dados Internos
 * (aprovador/analista/matriculador) — nenhum deles faz sentido sem cliente.
 */

type ModalMode = 'CREATE' | 'EDIT' | null;
type ModalSubMode = 'VIEW' | 'FORM';

const CANCEL_REASONS = [
  'Baixo quórum',
  'Falta de instrutor',
  'Reagendamento',
  'Solicitação do cliente',
  'No-Show',
  'Outro',
];

const statusColor = (status: string) => {
  switch (status) {
    case 'NOVA': return 'bg-purple-100 text-purple-800';
    case 'PENDENTE': return 'bg-orange-100 text-orange-800';
    case 'ALOCADA': return 'bg-blue-100 text-blue-800';
    case 'EM_ANDAMENTO': return 'bg-emerald-100 text-emerald-800';
    case 'CONCLUIDA': return 'bg-green-100 text-green-800';
    case 'CANCELADA': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const toLocalDateInput = (v?: string | null) => {
  const s = (v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.includes('T') ? s.split('T')[0] : '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const toLocalTimeInput = (v?: string | null) => {
  const s = (v ?? '').trim();
  if (!s) return '';
  const m1 = s.match(/T(\d{2}:\d{2})/);
  if (m1?.[1]) return m1[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const buildLocalDateTime = (date: string, time: string) => {
  const d = (date ?? '').trim();
  if (!d) return '';
  return `${d}T${(time ?? '').trim() || '08:00'}`;
};

const isoToLocalDTL = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const isoToDateOnly = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.includes('T') ? s.split('T')[0] : '';
};

const toIsoFromDateTimeLocalSafe = (dt?: string | null) => {
  const s = (dt ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const toIsoFromDateInputSafe = (dateStr?: string | null) => {
  const s = (dateStr ?? '').trim();
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const dbTransportToUI = (v?: string | null): TransportType => {
  switch (v) {
    case 'CARRO_ALUGADO': return 'Carro Alugado';
    case 'CARRO_PROPRIO': return 'Carro Próprio';
    case 'TAXI': return 'Táxi';
    case 'CARRO_APLICATIVO': return 'Carro Aplicativo';
    case 'OUTROS': return 'Outros';
    case 'NA': return 'N/A';
    default: return null;
  }
};

const uiTransportToDb = (t?: TransportType | null) => {
  switch (t) {
    case 'Carro Alugado': return 'CARRO_ALUGADO';
    case 'Carro Próprio': return 'CARRO_PROPRIO';
    case 'Táxi': return 'TAXI';
    case 'Carro Aplicativo': return 'CARRO_APLICATIVO';
    case 'Outros': return 'OUTROS';
    case 'N/A': return 'NA';
    default: return null;
  }
};

const dbLodgingToUI = (v?: string | null): AccommodationType => {
  switch (v) {
    case 'PRECISA_HOTEL': return 'Hotel';
    case 'NA': return 'N/A';
    default: return null;
  }
};

const uiLodgingToDb = (a?: AccommodationType | null) => {
  switch (a) {
    case 'Hotel': return 'PRECISA_HOTEL';
    case 'N/A': return 'NA';
    default: return null;
  }
};

const initialInternalDemandState = (): DemandFormState => ({
  tipo: 'interna',
  categoriaInterna: '',
  descricaoInterna: '',
  horasPrevistas: null,
  // Sem cliente nem treinamento: o mapDemandToDb transforma '' em null, o que é
  // exatamente o que o CHECK demands_cliente_requires_refs espera de uma interna.
  companyId: '',
  trainingId: '',
  // `demands.modality` é NOT NULL sem default no banco; interna é sempre
  // presencial (alguém se desloca), e é o que faz o motor de status e as regras
  // de logística tratarem a interna como uma demanda de campo normal.
  modality: 'PRESENCIAL',
  regionId: '',
  trainingLocal: '',
  demandState: '',
  corredor: '',
  dateMode: 'CONTINUO',
  specificDates: [],
  startDate: '',
  endDate: '',
  status: 'NOVA',
  requester: '',
  observations: '',
  logisticasLocomocao: [emptyLocomocaoBlock()],
  logisticasHospedagem: [emptyHospedagemBlock()],
});

const InternalDemands: React.FC = () => {
  const {
    demands: allDemands,
    regions,
    instructors,
    operationalBases,
    instructorAllocations,
    addDemand,
    updateDemand,
    deleteDemand,
    setNotification,
  } = useApp();

  const { profile } = useAuth();

  // Permissões: decisão fechada — todos os perfis veem e criam demanda interna.
  // Excluir e cancelar continuam restritos, como na demanda de cliente.
  const isAdmin = profile?.role === 'admin';
  const isAnalyst = profile?.role === 'analista';
  const canDelete = isAdmin || isAnalyst;
  const canCancel = isAdmin || isAnalyst;

  // ⚠️ FONTE ÚNICA desta tela.
  const internalDemands = useMemo(
    () => allDemands.filter(d => d.tipo === 'interna'),
    [allDemands]
  );

  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoriaFilter, setCategoriaFilter] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [modalSubMode, setModalSubMode] = useState<ModalSubMode>('FORM');
  const [formDemand, setFormDemand] = useState<DemandFormState>(initialInternalDemandState());
  const [activeDemand, setActiveDemand] = useState<Demand | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState('');
  const [cancelTextNote, setCancelTextNote] = useState('');

  const [pendingPdfs, setPendingPdfs] = useState<PendingPdfs>({ classList: null, instructorRelease: null });
  const [dbDocs, setDbDocs] = useState<DbDocs>({});

  const [locationAssociations, setLocationAssociations] = useState<LocationAssociation[]>([]);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    geral: true,
    locomocao: false,
    hospedagem: false,
    documentos: false,
  });
  const toggleSection = (section: string) =>
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

  useEffect(() => {
    // Cascata da demanda INTERNA: conjunto próprio, separado do de cliente
    // (migration 014). Nasceu como cópia integral, mas diverge daí em diante.
    fetchLocationAssociations('interna').then(setLocationAssociations).catch(console.error);
  }, []);

  useEffect(() => {
    if (!isModalOpen) setAutoFilledFields(new Set());
  }, [isModalOpen]);

  useEffect(() => {
    const anyOpen = isModalOpen || confirmCancel || confirmDelete || confirmReactivate;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isModalOpen, confirmCancel, confirmDelete, confirmReactivate]);

  /* ───────────────────────── Helpers de exibição ───────────────────────── */

  const getInstructorName = (id?: string) =>
    instructors.find(i => i.id === id)?.name || 'Não Alocado';

  const allInstructorsByDemandId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const d of internalDemands) {
      const allocs = instructorAllocations
        .filter(a => a.demandId === d.id && a.instructorId)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
      const ids = [...new Set(allocs.map(a => a.instructorId))];
      map[d.id] = ids.length > 0 ? ids : (d.instructorId ? [d.instructorId] : []);
    }
    return map;
  }, [internalDemands, instructorAllocations]);

  const getStatusOf = (d: Pick<Demand, 'startDate' | 'endDate' | 'instructorId' | 'status' | 'trainingLocal' | 'modality'>) =>
    calculateDemandStatus({
      startDate: d.startDate,
      endDate: d.endDate,
      instructorId: d.instructorId,
      cancelled: d.status === 'CANCELADA',
      trainingLocal: d.trainingLocal,
      modality: d.modality,
    } as any);

  const categoriaOptions = useMemo(
    () => (operationalBases.categoriasInternas ?? []).filter(Boolean).sort(),
    [operationalBases.categoriasInternas]
  );

  /* ───────────────────────────── Listagem ──────────────────────────────── */

  const filteredDemands = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return internalDemands
      .filter(d => {
        if (q) {
          const haystack = [
            d.id,
            d.categoriaInterna ?? '',
            d.descricaoInterna ?? '',
            d.trainingLocal ?? '',
            d.requester ?? '',
          ].join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (categoriaFilter && (d.categoriaInterna || '') !== categoriaFilter) return false;
        if (statusFilter && getStatusOf(d) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }, [internalDemands, filter, categoriaFilter, statusFilter]);

  const {
    currentPage,
    totalPages,
    itemsPerPage,
    paginatedItems,
    startIdx,
    setCurrentPage,
    handleItemsPerPageChange,
  } = usePagination<Demand>(filteredDemands, 'pagination:internal-demands');

  const clearFilters = () => {
    setFilter('');
    setStatusFilter('');
    setCategoriaFilter('');
  };

  /* ─────────────────────── Cascata de localidade ───────────────────────── */
  // Mesmas regras do formulário de cliente: Local → Corredor/Estado/Região,
  // Corredor → Estado/Região (quando unívoco), Estado → Região (quando unívoca).

  const uniqueVal = (arr: string[]): string | null =>
    arr.length > 0 && new Set(arr).size === 1 ? arr[0] : null;

  const handleTrainingLocalChange = (value: string) => {
    const isNA = value === 'N/A';
    const assoc = value && !isNA ? locationAssociations.find(a => a.local === value) : null;
    const region = assoc ? regions.find(r => r.name === assoc.regiao) : null;

    const newAutoFilled = new Set<string>();

    setFormDemand(prev => {
      const updates: DemandFormState = { trainingLocal: value };
      if (isNA) {
        updates.corredor = 'N/A';
        updates.demandState = 'N/A';
        updates.regionId = '';
      } else if (assoc) {
        if (assoc.corredor) updates.corredor = assoc.corredor;
        if (assoc.uf) updates.demandState = assoc.uf;
        if (region) updates.regionId = region.id;
      }
      return { ...prev, ...updates };
    });

    if (isNA) {
      newAutoFilled.add('na_locked');
    } else if (assoc) {
      if (assoc.corredor) newAutoFilled.add('corredor');
      if (assoc.uf) newAutoFilled.add('demandState');
      if (region) newAutoFilled.add('regionId');
    }
    setAutoFilledFields(newAutoFilled);
  };

  const handleCorredorChange = (value: string) => {
    const matches = value
      ? locationAssociations.filter(a => a.corredor === value && a.local !== 'N/A')
      : [];
    const uf = uniqueVal(matches.map(a => a.uf).filter(Boolean));
    const regiao = uniqueVal(matches.map(a => a.regiao).filter(Boolean));
    const region = regiao ? regions.find(r => r.name === regiao) : null;

    setFormDemand(prev => {
      const updates: DemandFormState = { corredor: value };
      if (uf) updates.demandState = uf;
      if (region) updates.regionId = region.id;
      return { ...prev, ...updates };
    });

    setAutoFilledFields(prev => {
      const s = new Set(prev);
      s.delete('corredor');
      if (uf) s.add('demandState'); else s.delete('demandState');
      if (region) s.add('regionId'); else s.delete('regionId');
      return s;
    });
  };

  const handleEstadoChange = (value: string) => {
    const matches = value
      ? locationAssociations.filter(a => a.uf === value && a.local !== 'N/A')
      : [];
    const regiao = uniqueVal(matches.map(a => a.regiao).filter(Boolean));
    const region = regiao ? regions.find(r => r.name === regiao) : null;

    setFormDemand(prev => {
      const updates: DemandFormState = { demandState: value };
      if (region) updates.regionId = region.id;
      return { ...prev, ...updates };
    });

    setAutoFilledFields(prev => {
      const s = new Set(prev);
      s.delete('demandState');
      if (region) s.add('regionId'); else s.delete('regionId');
      return s;
    });
  };

  /* ───────────────────────────── Datas ─────────────────────────────────── */

  const handleDateChange = (field: 'startDate' | 'endDate', val: string) => {
    const time = toLocalTimeInput(formDemand[field] as any) || '08:00';
    setFormDemand(prev => ({ ...prev, [field]: buildLocalDateTime(val, time) }));
    setFormError(null);
  };

  const handleTimeChange = (field: 'startDate' | 'endDate', val: string) => {
    const date = toLocalDateInput(formDemand[field] as any);
    if (!date) return;
    setFormDemand(prev => ({ ...prev, [field]: buildLocalDateTime(date, val) }));
    setFormError(null);
  };

  /* ─────────────────────────── Abrir modal ─────────────────────────────── */

  const loadLogisticsFor = async (demandId: string) => {
    let locoBlocks: LogisticaLocomocao[] = [];
    let hospBlocks: LogisticaHospedagem[] = [];
    let flat: any = null;

    try {
      // devolve o array direto (lança em caso de erro), diferente do
      // fetchLogisticByDemandId logo abaixo, que devolve { data, error }
      const rows = await fetchLogisticBlocksByDemandId(demandId);
      for (const b of rows as any[]) {
        if (b.block_type === 'LOCOMOCAO') {
          locoBlocks.push({
            id: b.id,
            instructorName: b.instructor_name ?? '',
            transportType: dbTransportToUI(b.transport_mode),
            rentalCompany: b.rental_company ?? 'Localiza',
            rentalAgencyLocation: b.rental_agency_location ?? '',
            rentalLocator: b.rental_locator ?? '',
            carCategory: b.car_category ?? 'Grupo CE',
            rentalCheckIn: isoToLocalDTL(b.rental_check_in),
            rentalCheckOut: isoToLocalDTL(b.rental_check_out),
            receiptUrls: b.receipt_url ?? null,
            otherTransportDescription: b.transport_other_description ?? '',
          });
        } else if (b.block_type === 'HOSPEDAGEM') {
          hospBlocks.push({
            id: b.id,
            instructorName: b.instructor_name ?? '',
            accommodationType: dbLodgingToUI(b.lodging_mode),
            hotelCity: b.hotel_city ?? '',
            hotelName: b.hotel_name ?? '',
            hotelCheckIn: isoToDateOnly(b.hotel_check_in),
            hotelCheckOut: isoToDateOnly(b.hotel_check_out),
            hotelPayment: b.hotel_payment ?? null,
            hotelReceiptUrls: b.hotel_receipt_urls ?? null,
          });
        }
      }
    } catch {
      // silencioso: mesma postura do form de cliente (tabela pode não existir)
    }

    try {
      const { data } = await fetchLogisticByDemandId(demandId);
      flat = data ?? null;
    } catch {
      // idem
    }

    if (locoBlocks.length === 0) locoBlocks = [emptyLocomocaoBlock()];
    if (hospBlocks.length === 0) hospBlocks = [emptyHospedagemBlock()];

    return {
      locoBlocks,
      hospBlocks,
      logisticsTransport: (flat?.transport_mode ? 'CONFIRMADO' : null) as any,
      logisticsHotel: (flat?.lodging_mode ? 'CONFIRMADO' : null) as any,
    };
  };

  const loadDocsFor = async (demandId: string) => {
    try {
      const docs = await fetchDemandDocumentsByDemandId(demandId);
      const mapped: DbDocs = {};
      for (const d of docs as any[]) {
        mapped[d.doc_type] = {
          name: d.file_name || d.doc_type,
          path: d.file_path ?? null,
          is_na: !!d.is_na,
        };
      }
      setDbDocs(mapped);
    } catch (e) {
      console.error('[InternalDemands] erro ao carregar documentos:', e);
      setDbDocs({});
    }
  };

  const handleOpenCreate = () => {
    setModalMode('CREATE');
    setModalSubMode('FORM');
    setFormDemand(initialInternalDemandState());
    setActiveDemand(null);
    setPendingPdfs({ classList: null, instructorRelease: null });
    setDbDocs({});
    setFormError(null);
    setOpenSections({ geral: true, locomocao: false, hospedagem: false, documentos: false });
    setIsModalOpen(true);
  };

  const handleOpenView = async (demand: Demand) => {
    setModalMode('EDIT');
    setModalSubMode('VIEW');
    setActiveDemand(demand);
    setPendingPdfs({ classList: null, instructorRelease: null });
    setFormError(null);
    setOpenSections({ geral: true, locomocao: false, hospedagem: false, documentos: false });

    setFormDemand({
      ...demand,
      startDate: isoToLocalDTL(demand.startDate) || demand.startDate,
      endDate: isoToLocalDTL(demand.endDate) || demand.endDate,
      logisticasLocomocao: [emptyLocomocaoBlock()],
      logisticasHospedagem: [emptyHospedagemBlock()],
    });
    setIsModalOpen(true);

    const [logistics] = await Promise.all([loadLogisticsFor(demand.id), loadDocsFor(demand.id)]);
    setFormDemand(prev => ({
      ...prev,
      logisticasLocomocao: logistics.locoBlocks,
      logisticasHospedagem: logistics.hospBlocks,
      logisticsTransport: prev.logisticsTransport ?? logistics.logisticsTransport,
      logisticsHotel: prev.logisticsHotel ?? logistics.logisticsHotel,
    }));
  };

  /* ─────────────────────────── Validação ───────────────────────────────── */

  const horasPrevistasNum = (() => {
    const raw = formDemand.horasPrevistas;
    const n = Number(String(raw ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  })();

  const isSpecificMode = formDemand.dateMode === 'DIAS_ESPECIFICOS';

  const isFormValid = (() => {
    if (!(formDemand.categoriaInterna || '').trim()) return false;
    if (!(formDemand.descricaoInterna || '').trim()) return false;
    if (!(horasPrevistasNum > 0)) return false;
    if (!(formDemand.trainingLocal || '').trim()) return false;
    if (!(formDemand.demandState || '').trim()) return false;
    if (isSpecificMode) {
      return Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0;
    }
    return !!formDemand.startDate && !!formDemand.endDate;
  })();

  /* ────────────────────────────── Save ─────────────────────────────────── */

  const handleSave = async () => {
    if (!isFormValid || isSaving) return;
    setIsSaving(true);

    try {
      let derivedStart = formDemand.startDate || '';
      let derivedEnd = formDemand.endDate || '';

      if (isSpecificMode && Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0) {
        const sorted = [...formDemand.specificDates].sort((a, b) => a.data.localeCompare(b.data));
        derivedStart = `${sorted[0].data}T${sorted[0].horarioInicio}`;
        derivedEnd = `${sorted[sorted.length - 1].data}T${sorted[sorted.length - 1].horarioFim}`;
      }

      if (!isSpecificMode && derivedStart && derivedEnd && String(derivedStart) > String(derivedEnd)) {
        setFormError('A data de início não pode ser maior que a data de fim.');
        setTimeout(() => setFormError(null), 4000);
        return;
      }

      const primaryLoco = formDemand.logisticasLocomocao?.[0];
      const primaryHosp = formDemand.logisticasHospedagem?.[0];

      const sanitized: Demand = {
        ...(formDemand as Demand),

        // Invariantes da interna — repetidos aqui e não só no estado inicial
        // porque é este objeto que vai pro banco. O CHECK
        // demands_interna_requires_fields recusa a linha se algum escapar.
        tipo: 'interna',
        modality: 'PRESENCIAL',
        companyId: '',
        trainingId: '',
        categoriaInterna: (formDemand.categoriaInterna || '').trim(),
        descricaoInterna: (formDemand.descricaoInterna || '').trim(),
        horasPrevistas: horasPrevistasNum,

        dateMode: formDemand.dateMode || 'CONTINUO',
        specificDates: isSpecificMode ? (formDemand.specificDates || []) : undefined,
        startDate: derivedStart as any,
        endDate: derivedEnd as any,
        practiceStartDate: null as any,
        practiceEndDate: null as any,

        trainingLocal: formDemand.trainingLocal || '',
        regionId: formDemand.regionId || '',

        logisticsTransport: formDemand.logisticsTransport ?? null,
        logisticsHotel: formDemand.logisticsHotel ?? null,

        // Campos planos derivados do bloco 0 (logistic_allocations / legado)
        transportType: primaryLoco?.transportType ?? null,
        accommodationType: primaryHosp?.accommodationType ?? null,
        rentalCompany: primaryLoco?.rentalCompany ?? 'Localiza',
        carCategory: primaryLoco?.carCategory ?? 'Grupo CE',
        rentalAgencyLocation: primaryLoco?.rentalAgencyLocation || '',
        rentalLocator: primaryLoco?.rentalLocator || '',
        rentalCheckIn: primaryLoco?.rentalCheckIn || '',
        rentalCheckOut: primaryLoco?.rentalCheckOut || '',
        hotelName: primaryHosp?.hotelName || '',
        hotelCity: primaryHosp?.hotelCity || '',
        hotelCheckIn: primaryHosp?.hotelCheckIn || '',
        hotelCheckOut: primaryHosp?.hotelCheckOut || '',
        hotelPayment: primaryHosp?.hotelPayment ?? null,
      };

      let demandId = formDemand.id;

      if (modalMode === 'CREATE') {
        const created = await addDemand(sanitized);
        if (!created?.id) return; // addDemand já notificou o erro
        demandId = created.id;
        sanitized.id = created.id;

        const auditoria = await logAction({
          modulo: 'Demandas',
          acao: 'Criar',
          descricao: [
            `Demanda interna ${sanitized.id} criada`,
            `Categoria: ${sanitized.categoriaInterna}`,
            `Descrição: ${sanitized.descricaoInterna}`,
            `Horas previstas: ${sanitized.horasPrevistas}`,
            `Início: ${formatDateTime(sanitized.startDate)}`,
            sanitized.trainingLocal ? `Local: ${sanitized.trainingLocal}` : null,
          ].filter(Boolean).join(' | '),
          dadosDepois: sanitized,
        });
        if (!auditoria.ok) {
          setNotification({
            message: `Demanda ${sanitized.id} criada, mas o registro de auditoria falhou. Avise o suporte.`,
            type: 'error',
          });
        }
      } else {
        await Promise.resolve(updateDemand(sanitized));
        demandId = demandId ?? sanitized.id;

        const before = activeDemand;
        const diff: string[] = [];
        if (before) {
          if ((before.categoriaInterna || '') !== (sanitized.categoriaInterna || ''))
            diff.push(`Categoria: ${before.categoriaInterna || '—'} → ${sanitized.categoriaInterna || '—'}`);
          if ((before.descricaoInterna || '') !== (sanitized.descricaoInterna || ''))
            diff.push(`Descrição: ${before.descricaoInterna || '—'} → ${sanitized.descricaoInterna || '—'}`);
          if (Number(before.horasPrevistas) !== Number(sanitized.horasPrevistas))
            diff.push(`Horas previstas: ${before.horasPrevistas ?? '—'} → ${sanitized.horasPrevistas ?? '—'}`);
          if ((before.trainingLocal || '') !== (sanitized.trainingLocal || ''))
            diff.push(`Local: ${before.trainingLocal || '—'} → ${sanitized.trainingLocal || '—'}`);
          if ((before.corredor || '') !== (sanitized.corredor || ''))
            diff.push(`Corredor: ${before.corredor || '—'} → ${sanitized.corredor || '—'}`);
          if ((before.demandState || '') !== (sanitized.demandState || ''))
            diff.push(`Estado: ${before.demandState || '—'} → ${sanitized.demandState || '—'}`);
          if ((before.requester || '') !== (sanitized.requester || ''))
            diff.push(`Solicitante: ${before.requester || '—'} → ${sanitized.requester || '—'}`);
          if (new Date(before.startDate).toISOString() !== new Date(sanitized.startDate).toISOString())
            diff.push(`Início: ${formatDateTime(before.startDate)} → ${formatDateTime(sanitized.startDate)}`);
          if (new Date(before.endDate).toISOString() !== new Date(sanitized.endDate).toISOString())
            diff.push(`Fim: ${formatDateTime(before.endDate)} → ${formatDateTime(sanitized.endDate)}`);
          if ((before.observations || '') !== (sanitized.observations || ''))
            diff.push(`Observações: ${before.observations || '—'} → ${sanitized.observations || '—'}`);
        }
        logAction({
          modulo: 'Demandas',
          acao: 'Editar',
          descricao: `Demanda interna ${sanitized.id} editada${diff.length ? ` — Alterações: ${diff.join(' | ')}` : ''}`,
          dadosAntes: before ?? undefined,
          dadosDepois: sanitized,
        });
      }

      if (!demandId) {
        setIsModalOpen(false);
        setFormDemand(initialInternalDemandState());
        setActiveDemand(null);
        return;
      }

      // Logística achatada (checklist operacional). Interna é sempre presencial,
      // então nunca entra na branch "online / não necessário".
      try {
        const isCarRental = sanitized.transportType === 'Carro Alugado';
        const isHotel = sanitized.accommodationType === 'Hotel';
        const transportModeToDb = uiTransportToDb(sanitized.transportType);
        const lodgingModeToDb = uiLodgingToDb(sanitized.accommodationType);

        await upsertLogisticByDemandId(demandId, {
          start_date: sanitized.startDate?.slice(0, 10) ?? null,
          end_date: sanitized.endDate?.slice(0, 10) ?? null,
          transport_mode: transportModeToDb,
          lodging_mode: lodgingModeToDb,
          rental_company: isCarRental ? (sanitized.rentalCompany || 'Localiza') : null,
          rental_agency_location: isCarRental ? (sanitized.rentalAgencyLocation || null) : null,
          rental_locator: isCarRental ? (sanitized.rentalLocator || null) : null,
          car_category: isCarRental ? (sanitized.carCategory || 'Grupo CE') : null,
          rental_check_in: isCarRental ? toIsoFromDateTimeLocalSafe(sanitized.rentalCheckIn) : null,
          rental_check_out: isCarRental ? toIsoFromDateTimeLocalSafe(sanitized.rentalCheckOut) : null,
          hotel_city: isHotel ? (sanitized.hotelCity || null) : null,
          hotel_name: isHotel ? (sanitized.hotelName || null) : null,
          hotel_check_in: isHotel ? toIsoFromDateInputSafe(sanitized.hotelCheckIn) : null,
          hotel_check_out: isHotel ? toIsoFromDateInputSafe(sanitized.hotelCheckOut) : null,
          hotel_payment: isHotel ? (sanitized.hotelPayment || 'Faturado') : null,
          has_car: transportModeToDb != null,
          has_hotel: lodgingModeToDb != null,
          overall_status: 'PENDENTE',
        });
      } catch (e) {
        console.error('[InternalDemands] erro ao salvar logística:', e);
      }

      // Blocos multi-instrutor
      try {
        const locoRows = (formDemand.logisticasLocomocao || []).map((b, i) => {
          const isAlugado = b.transportType === 'Carro Alugado';
          const isOutros = b.transportType === 'Outros';
          const needsReceipt = b.transportType === 'Táxi' || b.transportType === 'Carro Aplicativo' || isOutros;
          const needsCheckInOut = isAlugado || isOutros;
          return {
            id: b.id,
            block_type: 'LOCOMOCAO',
            block_order: i,
            instructor_name: b.instructorName ?? null,
            transport_mode: uiTransportToDb(b.transportType),
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

        const hospRows = (formDemand.logisticasHospedagem || []).map((b, i) => {
          const isHotel = b.accommodationType === 'Hotel';
          return {
            id: b.id,
            block_type: 'HOSPEDAGEM',
            block_order: i,
            instructor_name: b.instructorName ?? null,
            transport_mode: null,
            rental_company: null,
            rental_agency_location: null,
            rental_locator: null,
            car_category: null,
            rental_check_in: null,
            rental_check_out: null,
            lodging_mode: uiLodgingToDb(b.accommodationType),
            hotel_city: isHotel ? (b.hotelCity || null) : null,
            hotel_name: isHotel ? (b.hotelName || null) : null,
            hotel_check_in: isHotel ? toIsoFromDateInputSafe(b.hotelCheckIn) : null,
            hotel_check_out: isHotel ? toIsoFromDateInputSafe(b.hotelCheckOut) : null,
            hotel_payment: isHotel ? (b.hotelPayment || 'Faturado') : null,
            hotel_receipt_urls: isHotel && b.hotelReceiptUrls?.length ? b.hotelReceiptUrls : null,
          };
        });

        await upsertLogisticBlocks(demandId, [...locoRows, ...hospRows] as any);
      } catch (e) {
        console.error('[InternalDemands] erro ao salvar logistic_blocks:', e);
      }

      // Documentos pendentes
      try {
        const hasAnyPdf = !!pendingPdfs.classList || !!pendingPdfs.instructorRelease;
        if (hasAnyPdf) setNotification({ type: 'info', message: 'Enviando PDFs... aguarde.' });

        if (pendingPdfs.classList) {
          const res = await uploadAndUpsertDemandPdf(demandId, 'LISTA_TURMA', pendingPdfs.classList);
          if (res.error) throw res.error;
        }
        if (pendingPdfs.instructorRelease) {
          const res = await uploadAndUpsertDemandPdf(demandId, 'LIBERACAO_INSTRUTOR', pendingPdfs.instructorRelease);
          if (res.error) throw res.error;
        }

        if (hasAnyPdf) {
          await loadDocsFor(demandId);
          setNotification({ type: 'success', message: 'PDF(s) enviado(s) com sucesso.' });
        }
      } catch (e: any) {
        console.error('[InternalDemands] erro ao enviar PDFs:', e);
        setNotification({ type: 'error', message: `Erro ao enviar PDF. Tente novamente. (${e?.message || e})` });
      }

      // Garante a medição — sem ela a interna não aparece no painel de pagamento.
      try {
        await upsertMeasurementByDemandId(demandId, {});
      } catch (e) {
        console.error('[InternalDemands] erro ao garantir medição:', e);
      }

      setPendingPdfs({ classList: null, instructorRelease: null });
      setIsModalOpen(false);
      setFormDemand(initialInternalDemandState());
      setActiveDemand(null);
    } finally {
      setIsSaving(false);
    }
  };

  /* ──────────────────── Cancelar / Excluir / Reativar ──────────────────── */

  const currentStatus = formDemand.startDate
    ? getStatusOf(formDemand as Demand)
    : ('NOVA' as DemandStatus);

  const handleCancelDemand = () => {
    if (!formDemand?.id || !selectedCancelReason) return;

    const cancelData = {
      ...(formDemand as Demand),
      status: 'CANCELADA' as DemandStatus,
      cancelReason: selectedCancelReason,
      cancelledAt: new Date().toISOString(),
      cancelInfo: { reason: selectedCancelReason, note: cancelTextNote, date: new Date().toISOString() },
    };

    updateDemand(cancelData);
    logAction({
      modulo: 'Demandas',
      acao: 'Cancelar',
      descricao: [
        `Demanda interna ${cancelData.id} cancelada`,
        `Categoria: ${cancelData.categoriaInterna || '—'}`,
        `Descrição: ${cancelData.descricaoInterna || '—'}`,
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

  const handleReactivateDemand = () => {
    if (!formDemand?.id) return;
    const reactivated = {
      ...(formDemand as Demand),
      status: 'NOVA' as DemandStatus,
      instructorId: undefined,
      cancelledAt: undefined,
      cancelReason: undefined,
      cancelInfo: undefined,
    };
    updateDemand(reactivated);
    setFormDemand(reactivated);
    setConfirmReactivate(false);
  };

  const handleDeleteDemand = () => {
    if (!formDemand?.id) return;
    if (!canDelete) {
      setNotification({ type: 'error', message: 'Você não tem permissão para excluir demandas.' });
      return;
    }
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
        `Demanda interna ${formDemand.id} excluída`,
        `Categoria: ${formDemand.categoriaInterna || '—'}`,
        `Descrição: ${formDemand.descricaoInterna || '—'}`,
      ].join(' | '),
      dadosAntes: formDemand,
    });

    setConfirmDelete(false);
    setIsModalOpen(false);
    setFormDemand(initialInternalDemandState());
    setActiveDemand(null);
  };

  /* ───────────────────────────── Render ────────────────────────────────── */

  const DataList = ({ id, items }: { id: string; items: string[] }) => (
    <datalist id={id}>
      {items.map(item => <option key={item} value={item} />)}
    </datalist>
  );

  return (
    <>
      {/* Datalists consumidos pelo form e pelas seções extraídas */}
      <DataList id="corredores-list" items={operationalBases.corredores ?? []} />
      <DataList id="localidades-list" items={operationalBases.localidades ?? []} />
      <DataList id="locais-treinamento-list" items={operationalBases.locaisTreinamento ?? []} />
      <DataList id="hoteis-list" items={operationalBases.hoteis ?? []} />
      <DataList id="cidades-list" items={operationalBases.localidades ?? []} />
      <DataList id="agencias-list" items={operationalBases.locaisAgencia ?? []} />

      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 no-print">
          <div>
            <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Demandas Internas</h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
              Visitas, SIPAT, Apoio Logístico e Eventos da Colabor
            </p>
          </div>
          <button
            onClick={handleOpenCreate}
            className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
          >
            <Plus size={18} /> <span className="hidden sm:inline">Nova Demanda Interna</span>
          </button>
        </div>

        {/* Filtros */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm no-print">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input
                type="text"
                placeholder="Buscar por referência, categoria, descrição, local..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <select
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={categoriaFilter}
              onChange={(e) => setCategoriaFilter(e.target.value)}
            >
              <option value="">Todas as Categorias</option>
              {categoriaOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos os Status</option>
              {['NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Listagem */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <tr>
                  <th className="p-4">Ref</th>
                  <th className="p-4">Categoria</th>
                  <th className="p-4">Descrição</th>
                  <th className="p-4">Local</th>
                  <th className="p-4">Datas</th>
                  <th className="p-4">Instrutor</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDemands.length > 0 ? paginatedItems.map(demand => {
                  const status = getStatusOf(demand);
                  const ids = allInstructorsByDemandId[demand.id] ?? [];
                  return (
                    <tr key={demand.id} className="hover:bg-slate-50/50 transition-colors text-sm text-gray-700">
                      <td className="p-4 font-bold text-blue-600 whitespace-nowrap">{demand.id}</td>
                      <td className="p-4">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 font-bold">
                          {demand.categoriaInterna || '—'}
                        </span>
                      </td>
                      <td className="p-4 max-w-xs truncate" title={demand.descricaoInterna || ''}>
                        {demand.descricaoInterna || '—'}
                      </td>
                      <td className="p-4">{demand.trainingLocal || '—'}</td>
                      <td className="p-4 whitespace-nowrap font-mono text-xs">
                        {formatDateTime((demand.startDate || '').split('T')[0])}
                        {(demand.endDate || '').split('T')[0] !== (demand.startDate || '').split('T')[0] && (
                          <> — {formatDateTime((demand.endDate || '').split('T')[0])}</>
                        )}
                      </td>
                      <td className="p-4 font-medium text-gray-900">
                        {ids.length === 0 ? 'Não Alocado' : (
                          <div className="flex flex-col gap-0.5">
                            {ids.slice(0, 2).map(id => <span key={id}>{getInstructorName(id)}</span>)}
                            {ids.length > 2 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-600 text-white w-fit">
                                +{ids.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${statusColor(status)}`}>
                          {status.replace('_', ' ')}
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
                        <p className="font-medium">Nenhuma demanda interna encontrada.</p>
                        {(filter || statusFilter || categoriaFilter) && (
                          <button onClick={clearFilters} className="text-blue-600 font-bold text-xs uppercase underline">
                            Limpar filtros
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredDemands.length}
            itemsPerPage={itemsPerPage}
            startIdx={startIdx}
            entityLabel="demandas internas"
            onPageChange={setCurrentPage}
            onItemsPerPageChange={handleItemsPerPageChange}
          />
        </div>
      </div>

      {/* ─────────────────────────── MODAL ─────────────────────────── */}
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
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">
                  {modalSubMode === 'VIEW'
                    ? 'Visualização da Demanda Interna'
                    : (modalMode === 'CREATE' ? 'Nova Demanda Interna' : 'Editar Demanda Interna')}
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                  {formDemand.id ? `${formDemand.id} · ` : ''}Colabor (Interna)
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${statusColor(currentStatus)}`}>
                  {currentStatus.replace('_', ' ')}
                </span>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-300 hover:text-slate-600 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-4">
              {formDemand.status === 'CANCELADA' && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
                  <p className="text-xs font-black uppercase tracking-widest mb-1">Demanda Cancelada</p>
                  {(formDemand.cancelReason || formDemand.cancelInfo) && (
                    <p className="text-xs">
                      <strong>Motivo:</strong> {formDemand.cancelReason || formDemand.cancelInfo?.reason}
                      {formDemand.cancelInfo?.note ? ` — ${formDemand.cancelInfo.note}` : ''}
                    </p>
                  )}
                </div>
              )}

              {formError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-amber-800">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                  <p className="text-xs leading-relaxed">{formError}</p>
                </div>
              )}

              {showDeleteBlocked && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-800">
                  <Ban size={16} className="shrink-0 mt-0.5 text-red-500" />
                  <p className="text-xs leading-relaxed">Demanda concluída não pode ser excluída.</p>
                </div>
              )}

              {/* Informações Gerais */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <button
                  onClick={() => toggleSection('geral')}
                  className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><FileText size={20} /></div>
                    <h3 className="font-bold text-slate-800 uppercase text-sm">Informações Gerais</h3>
                  </div>
                  {openSections.geral ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {openSections.geral && (
                  <div className="px-6 py-6 border-t border-slate-100 bg-white">
                    {modalSubMode === 'FORM' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria *</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={formDemand.categoriaInterna || ''}
                            onChange={(e) => setFormDemand({ ...formDemand, categoriaInterna: e.target.value })}
                          >
                            <option value="">Selecione...</option>
                            {categoriaOptions.map(c => <option key={c} value={c}>{c}</option>)}
                            {/* Preserva categoria já salva que tenha saído da base */}
                            {formDemand.categoriaInterna && !categoriaOptions.includes(formDemand.categoriaInterna) && (
                              <option value={formDemand.categoriaInterna}>{formDemand.categoriaInterna}</option>
                            )}
                          </select>
                          {categoriaOptions.length === 0 && (
                            <p className="text-[10px] text-amber-600 mt-1 font-bold">
                              Nenhuma categoria cadastrada — adicione em Cadastros → Bases Operacionais.
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Horas Previstas *</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={formDemand.horasPrevistas ?? ''}
                            onChange={(e) => {
                              // Texto (e não type=number) pra aceitar vírgula decimal
                              // enquanto digita; a conversão acontece no save.
                              const v = e.target.value.replace(/[^\d.,]/g, '');
                              setFormDemand({ ...formDemand, horasPrevistas: v as any });
                            }}
                            placeholder="Ex.: 8 ou 4,5"
                          />
                          <p className="text-[10px] text-slate-400 mt-1">
                            É a carga que a medição vai usar no lugar das horas do treinamento.
                          </p>
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição da Demanda *</label>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={formDemand.descricaoInterna || ''}
                            onChange={(e) => setFormDemand({ ...formDemand, descricaoInterna: e.target.value })}
                            placeholder="Ex.: Organizar van para Brucutu"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Local *</label>
                          <input
                            list="locais-treinamento-list"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={formDemand.trainingLocal || ''}
                            onChange={(e) => handleTrainingLocalChange(e.target.value)}
                            placeholder="Ex: Brucutu, Vitória..."
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Região</label>
                          <select
                            className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none ${autoFilledFields.has('regionId') ? 'bg-gray-100' : ''} ${autoFilledFields.has('na_locked') ? 'bg-gray-200 cursor-not-allowed' : ''}`}
                            value={formDemand.regionId || ''}
                            disabled={autoFilledFields.has('na_locked')}
                            onChange={(e) => {
                              setAutoFilledFields(prev => { const s = new Set(prev); s.delete('regionId'); return s; });
                              setFormDemand({ ...formDemand, regionId: e.target.value });
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
                              return Array.from(new Set(base)).map((opt: string) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ));
                            })()}
                            {formDemand.demandState && !autoFilledFields.has('na_locked') &&
                              !([...(operationalBases.localidades ?? []), ...(operationalBases.locaisAgencia ?? [])]).includes(formDemand.demandState) && (
                                <option value={formDemand.demandState}>{formDemand.demandState}</option>
                              )}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Solicitante</label>
                          <input
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={formDemand.requester || ''}
                            onChange={(e) => setFormDemand({ ...formDemand, requester: e.target.value })}
                          />
                        </div>

                        {/* ── TOGGLE MODO DE DATAS ── */}
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Modo de Datas *</label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${!isSpecificMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                              onClick={() => setFormDemand({ ...formDemand, dateMode: 'CONTINUO' })}
                            >Dias Contínuos</button>
                            <button
                              type="button"
                              className={`px-4 py-2 rounded-lg text-xs font-bold border transition ${isSpecificMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                              onClick={() => setFormDemand({ ...formDemand, dateMode: 'DIAS_ESPECIFICOS' })}
                            >Dias Específicos</button>
                          </div>
                        </div>

                        {!isSpecificMode ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:col-span-2">
                            <div className="flex flex-col gap-1">
                              <label className="block text-xs font-bold text-gray-500 uppercase">Início *</label>
                              <div className="flex gap-2">
                                <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toLocalDateInput(formDemand.startDate)} onChange={(e) => handleDateChange('startDate', e.target.value)} />
                                <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toLocalTimeInput(formDemand.startDate)} onChange={(e) => handleTimeChange('startDate', e.target.value)} />
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="block text-xs font-bold text-gray-500 uppercase">Fim *</label>
                              <div className="flex gap-2">
                                <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toLocalDateInput(formDemand.endDate)} onChange={(e) => handleDateChange('endDate', e.target.value)} />
                                <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toLocalTimeInput(formDemand.endDate)} onChange={(e) => handleTimeChange('endDate', e.target.value)} />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="md:col-span-2 space-y-3">
                            <div className="flex gap-2 items-end flex-wrap">
                              <div className="flex-1 min-w-[130px]">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Adicionar Dia *</label>
                                <input type="date" id="internal-specific-date-input" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                              </div>
                              <div className="w-28">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Início</label>
                                <input type="time" id="internal-specific-start-input" defaultValue="08:00" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                              </div>
                              <div className="w-28">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fim</label>
                                <input type="time" id="internal-specific-end-input" defaultValue="18:00" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                              </div>
                              <button
                                type="button"
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition self-end"
                                onClick={() => {
                                  const dateInput = document.getElementById('internal-specific-date-input') as HTMLInputElement;
                                  const startInput = document.getElementById('internal-specific-start-input') as HTMLInputElement;
                                  const endInput = document.getElementById('internal-specific-end-input') as HTMLInputElement;
                                  const val = dateInput?.value;
                                  if (!val) return;
                                  const horarioInicio = startInput?.value || '08:00';
                                  const horarioFim = endInput?.value || '18:00';
                                  const current: SpecificDateEntry[] = Array.isArray(formDemand.specificDates) ? formDemand.specificDates : [];
                                  if (current.some(e => e.data === val)) return;
                                  const updated = [...current, { data: val, horarioInicio, horarioFim }]
                                    .sort((a, b) => a.data.localeCompare(b.data));
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

                            {Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0 && (
                              <div className="space-y-1">
                                {[...formDemand.specificDates]
                                  .sort((a, b) => String(a.data).localeCompare(String(b.data)))
                                  .map((entry, i) => {
                                    const dateStr = String(entry.data ?? '').slice(0, 10);
                                    const dateObj = new Date(`${dateStr}T12:00:00`);
                                    const dateLabel = isNaN(dateObj.getTime())
                                      ? dateStr
                                      : dateObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
                                    return (
                                      <div key={`${dateStr}-${i}`} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                                        <span className="text-xs font-bold text-blue-700 flex-1">{dateLabel}</span>
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
                                    );
                                  })}
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
                            onChange={(e) => setFormDemand({ ...formDemand, observations: e.target.value })}
                            placeholder="Informações relevantes sobre a demanda..."
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <DataViewField label="Categoria" value={formDemand.categoriaInterna || '---'} icon={Tag} />
                        <DataViewField label="Horas Previstas" value={formDemand.horasPrevistas != null ? `${formDemand.horasPrevistas}h` : '---'} icon={Clock} />
                        <DataViewField label="Solicitante" value={formDemand.requester} icon={User} />
                        <div className="md:col-span-3">
                          <DataViewField label="Descrição" value={formDemand.descricaoInterna || '---'} icon={Building} />
                        </div>
                        <DataViewField label="Local" value={formDemand.trainingLocal} icon={MapPin} />
                        <DataViewField label="Corredor" value={formDemand.corredor} icon={MapPin} />
                        <DataViewField label="Estado" value={formDemand.demandState} icon={MapPin} />
                        <DataViewField label="Início" value={formatDateTime(formDemand.startDate)} icon={Clock} />
                        <DataViewField label="Fim" value={formatDateTime(formDemand.endDate)} icon={Clock} />
                        <DataViewField
                          label="Região"
                          value={regions.find(r => r.id === formDemand.regionId)?.name || '---'}
                          icon={MapPin}
                        />
                        {Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0 && (
                          <div className="md:col-span-3">
                            <DataViewField
                              label="Dias Específicos"
                              value={[...formDemand.specificDates]
                                .sort((a, b) => a.data.localeCompare(b.data))
                                .map(e => `${new Date(`${e.data}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${e.horarioInicio}-${e.horarioFim}`)
                                .join(', ')}
                            />
                          </div>
                        )}
                        {formDemand.observations && (
                          <div className="md:col-span-3">
                            <DataViewField label="Observações" value={formDemand.observations} />
                          </div>
                        )}
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
                labelListaTurma="Documento de Apoio (PDF)"
                onPdfSelect={(key, file) => {
                  if (file.type !== 'application/pdf') {
                    alert('Por favor, selecione apenas arquivos PDF.');
                    return;
                  }
                  setPendingPdfs(prev => ({ ...prev, [key]: file }));
                }}
                onRemovePendingPdf={(key) => setPendingPdfs(prev => ({ ...prev, [key]: null }))}
                onDownloadSavedPdf={async (docType) => {
                  const doc = dbDocs[docType];
                  if (!doc?.path) return;
                  try {
                    const signed = await getDemandDocumentSignedUrl(doc.path, 60);
                    if (signed.error) throw signed.error;
                    const url = signed.data?.signedUrl;
                    if (!url) throw new Error('Não foi possível gerar signedUrl.');
                    window.open(url, '_blank');
                  } catch (err: any) {
                    console.error(err);
                    alert(`Erro ao baixar PDF: ${err?.message || err}`);
                  }
                }}
                onMarkDocAsNA={async (docType) => {
                  if (!formDemand?.id) {
                    alert('ID da demanda não encontrado.');
                    return;
                  }
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
                    await loadDocsFor(formDemand.id);
                  } catch (err: any) {
                    console.error(err);
                    alert(`Erro ao marcar como N/A: ${err?.message || err}`);
                  }
                }}
              />
            </div>

            {/* Footer */}
            <div className="p-6 bg-slate-100 border-t border-slate-200 flex flex-wrap justify-between items-center gap-3 no-print">
              <div className="flex gap-2">
                {modalSubMode === 'VIEW' && (
                  <>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => { setConfirmDelete(true); setConfirmCancel(false); setConfirmReactivate(false); }}
                        className="flex items-center gap-2 px-4 py-2.5 border rounded-xl transition font-black text-xs uppercase tracking-widest shadow-sm bg-white text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 size={16} /> Excluir Demanda
                      </button>
                    )}
                    {currentStatus !== 'CANCELADA' && currentStatus !== 'CONCLUIDA' && canCancel && (
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
                    {currentStatus === 'CANCELADA' && canCancel && (
                      <button
                        type="button"
                        onClick={() => { setConfirmReactivate(true); setConfirmDelete(false); setConfirmCancel(false); }}
                        className="flex items-center gap-2 px-4 py-2.5 border rounded-xl transition font-black text-xs uppercase tracking-widest shadow-sm bg-white text-blue-600 border-blue-200 hover:bg-blue-50"
                      >
                        <RefreshCw size={16} /> Reativar Demanda
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition"
                >
                  Fechar
                </button>

                {modalSubMode === 'VIEW' ? (
                  <button
                    type="button"
                    onClick={() => setModalSubMode('FORM')}
                    className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-black text-xs uppercase tracking-widest transition shadow-md"
                  >
                    Editar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!isFormValid || isSaving}
                    className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition shadow-md
                      ${isFormValid && !isSaving
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {isSaving ? 'Salvando...' : (modalMode === 'CREATE' ? 'Criar Demanda' : 'Salvar Alterações')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmação: excluir */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Excluir demanda interna?</h3>
            <p className="text-sm text-slate-500">
              Esta ação remove a demanda <strong>{formDemand.id}</strong> e seus documentos. Não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition">
                Voltar
              </button>
              <button onClick={handleDeleteDemand} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest transition">
                Excluir
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmação: reativar */}
      {confirmReactivate && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Reativar demanda?</h3>
            <p className="text-sm text-slate-500">
              A demanda <strong>{formDemand.id}</strong> volta para o status NOVA e perde a alocação de instrutor.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setConfirmReactivate(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition">
                Voltar
              </button>
              <button onClick={handleReactivateDemand} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest transition">
                Reativar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmação: cancelar */}
      {confirmCancel && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Cancelar demanda interna</h3>
            <p className="text-sm text-slate-500">Selecione o motivo do cancelamento de <strong>{formDemand.id}</strong>.</p>

            <div className="space-y-3 max-h-64 overflow-y-auto">
              {CANCEL_REASONS.map((reason) => (
                <label
                  key={reason}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${selectedCancelReason === reason ? 'border-orange-500 bg-orange-50' : 'border-slate-100 hover:border-slate-200'}`}
                >
                  <input
                    type="radio"
                    name="internalCancelReason"
                    value={reason}
                    checked={selectedCancelReason === reason}
                    onChange={(e) => setSelectedCancelReason(e.target.value)}
                  />
                  <span className={`text-sm font-bold ${selectedCancelReason === reason ? 'text-orange-900' : 'text-slate-600'}`}>{reason}</span>
                </label>
              ))}
            </div>

            {selectedCancelReason === 'Outro' && (
              <textarea
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500 h-20 resize-none"
                placeholder="Descreva o motivo..."
                value={cancelTextNote}
                onChange={(e) => setCancelTextNote(e.target.value)}
              />
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setConfirmCancel(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition">
                Voltar
              </button>
              <button
                onClick={handleCancelDemand}
                disabled={!selectedCancelReason}
                className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition
                  ${selectedCancelReason ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                Cancelar Demanda
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default InternalDemands;
