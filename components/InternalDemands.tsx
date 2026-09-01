import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Info,
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
  Mail,
  MessageCircle,
  FileText as FileWordIcon,
  Edit3,
  Check,
  FileDown,
  Users,
  Truck,
  Calendar,
} from 'lucide-react';

import { calculateDemandStatus } from '../domain/demandStatus';
import { canPerformDemandAction } from '../domain/demandPermissions';
import { resolveDemandInstructors, resolveDemandInstructorIds } from '../domain/demandInstructors';
import { getDemandCompanyLabel } from '../domain/demandLabel';
import {
  buildDemandTextContent,
  downloadDemandWord,
  type DemandDocFields,
} from '../services/demandDocument';
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
import { formatDateTime, formatDateOnlySafe } from './demand-form/formatters';
// Conversão data+hora de início/fim da demanda: helper ÚNICO, compartilhado com
// o form de cliente (Demands.tsx). Não reimplementar aqui — foi a cópia local
// (isoToLocalDTL sobre start_date) que deslocava -3h ao reabrir a interna.
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
// Alocação de CTM: MESMO hook e MESMO modal do formulário de cliente.
import ResourceAllocationModal from './ResourceAllocationModal';
import ParticipantSelectionModal from './ParticipantSelectionModal';
import { useResourceAllocation } from '../hooks/useResourceAllocation';
import {
  FilterPanelShell,
  FilterGrid,
  FilterField,
  FilterSearchField,
  FilterDateRangeField,
  FILTER_INPUT_CLASS,
} from './demand-form/FilterPanel';
import ExportDemandsModal from './ExportDemandsModal';
import PersonCountBadge from './ui/PersonCountBadge';
import { planAllocationReschedule, describeReschedule } from '../domain/allocationReschedule';
import { updateDemandParticipantPeriod } from '../services/demandParticipants';
import { getDemandDays } from '../domain/demandDays';
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
  // Empresa é opcional (o form deixa escolher); treinamento nunca existe numa
  // interna. O mapDemandToDb transforma '' em null, que é o que o CHECK
  // demands_cliente_requires_refs espera — ele só cobra as refs de tipo='cliente'.
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
    companies,
    regions,
    instructors,
    operationalBases,
    instructorAllocations,
    resourceAllocations,
    addResourceAllocation,
    removeResourceAllocation,
    hasResourceConflict,
    hasScheduleConflict,
    demandParticipants,
    addDemandParticipant,
    removeDemandParticipant,
    ensureLogisticBlocksForPerson,
    notificationTarget,
    setNotificationTarget,
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
  // Mesmo nome e mesma definição do modal de cliente (Demands.tsx), para os dois
  // modais responderem igual a uma mudança de permissão.
  const canEditDemand = isAdmin || isAnalyst;
  // Alocar CTM: mesma tabela de permissão do modal de cliente (admin e analista;
  // coordenador não). Fonte única em domain/demandPermissions.ts.
  const canAllocateResource = canPerformDemandAction(profile?.role, 'alocarRecurso');

  // ⚠️ FONTE ÚNICA desta tela.
  const internalDemands = useMemo(
    () => allDemands.filter(d => d.tipo === 'interna'),
    [allDemands]
  );

  const [filter, setFilter] = useState('');
  // Mesmo formato do advancedFilters da tela de cliente: um objeto só, para
  // limpar e comparar sem espalhar useState.
  const initialFilters = {
    categoria: '',
    companyId: '',
    startDate: '',
    endDate: '',
    instructorId: '',
    status: '',
    regionId: '',
    demandState: '',
    trainingLocal: '',
    corredor: '',
  };
  const [advancedFilters, setAdvancedFilters] = useState(initialFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [isExportOpen, setIsExportOpen] = useState(false);
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

  // Navegação vinda da Central de Notificações — mesmo contrato de Demands.tsx
  // e Evidences.tsx. Os alertas de alocação e de cancelamento mandam a interna
  // para cá (demandListView); sem consumir o alvo, o clique trocava de tela mas
  // caía na lista inteira, sem filtro, e o usuário tinha que procurar o ID.
  useEffect(() => {
    if (notificationTarget?.view === 'internal-demands') {
      setFilter(notificationTarget.demandId);
      setNotificationTarget(null);
    }
  }, [notificationTarget]);

  useEffect(() => {
    const anyOpen = isModalOpen || isExportOpen || confirmCancel || confirmDelete || confirmReactivate;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isModalOpen, isExportOpen, confirmCancel, confirmDelete, confirmReactivate]);

  /* ───────────────────────── Helpers de exibição ───────────────────────── */

  const getInstructorName = (id?: string) =>
    instructors.find(i => i.id === id)?.name || 'Não Alocado';

  /**
   * Instrutores por demanda, com o fallback para `demands.instructor_id`.
   * A regra saiu daqui para `domain/demandInstructors.ts` porque o bloco
   * INSTRUTORES do modal precisa da MESMA leitura (só que com os períodos
   * junto) — duas cópias divergiriam no primeiro ajuste.
   */
  const allInstructorsByDemandId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const d of internalDemands) {
      map[d.id] = resolveDemandInstructorIds(d.id, d.instructorId, instructorAllocations);
    }
    return map;
  }, [internalDemands, instructorAllocations]);

  /**
   * Nomes dos participantes por demanda, para o indicador da listagem.
   *
   * Deriva do `demandParticipants` que já está no estado global (carregado
   * uma vez no bootstrap e mantido pelo realtime) — nenhuma busca nova por
   * linha da tabela. Ordenado por nome para o tooltip sair estável.
   */
  const participantNamesByDemandId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const pt of demandParticipants) {
      (map[pt.demandId] ||= []).push(getInstructorName(pt.instructorId));
    }
    for (const id of Object.keys(map)) map[id].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return map;
  }, [demandParticipants, instructors]);

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

  /**
   * Ordenação da tabela — mesmo mecanismo da tela de demandas de cliente.
   * `null` = ordem padrão (mais recente primeiro por data de início).
   */
  type SortKey = 'id';
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort(prev => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const filteredDemands = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const result = internalDemands.filter(d => {
      if (q) {
        const haystack = [
          d.id,
          d.categoriaInterna ?? '',
          d.descricaoInterna ?? '',
          d.trainingLocal ?? '',
          d.requester ?? '',
          getDemandCompanyLabel(d, companies),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (advancedFilters.categoria && (d.categoriaInterna || '') !== advancedFilters.categoria) return false;

      // 'SEM_EMPRESA' é opção real do select, não ausência de filtro.
      if (advancedFilters.companyId === 'SEM_EMPRESA') {
        if ((d.companyId || '').trim()) return false;
      } else if (advancedFilters.companyId && d.companyId !== advancedFilters.companyId) {
        return false;
      }

      // Período pela data de início, mesma semântica do filtro de cliente.
      const inicio = (d.startDate || '').slice(0, 10);
      if (advancedFilters.startDate && inicio < advancedFilters.startDate) return false;
      if (advancedFilters.endDate && inicio > advancedFilters.endDate) return false;

      if (advancedFilters.instructorId) {
        const ids = allInstructorsByDemandId[d.id] ?? [];
        if (advancedFilters.instructorId === 'unallocated') {
          if (ids.length > 0) return false;
        } else if (!ids.includes(advancedFilters.instructorId)) {
          return false;
        }
      }

      if (advancedFilters.status && getStatusOf(d) !== advancedFilters.status) return false;
      if (advancedFilters.regionId && d.regionId !== advancedFilters.regionId) return false;
      if (advancedFilters.demandState && (d.demandState || '') !== advancedFilters.demandState) return false;
      if (advancedFilters.trainingLocal && (d.trainingLocal || '') !== advancedFilters.trainingLocal) return false;
      if (advancedFilters.corredor && (d.corredor || '') !== advancedFilters.corredor) return false;

      return true;
    });

    if (sort?.key === 'id') {
      const dir = sort.dir === 'asc' ? 1 : -1;
      return [...result].sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }) * dir);
    }
    return [...result].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }, [internalDemands, filter, advancedFilters, allInstructorsByDemandId, companies, sort]);

  /** Opções derivadas dos próprios dados, como no painel de cliente. */
  const estadoOptions = useMemo(
    () => [...new Set(internalDemands.map(d => (d.demandState || '').trim()).filter(Boolean))].sort(),
    [internalDemands]
  );
  const localOptions = useMemo(
    () => [...new Set(internalDemands.map(d => (d.trainingLocal || '').trim()).filter(Boolean))].sort(),
    [internalDemands]
  );

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
    setAdvancedFilters(initialFilters);
    setSort(null);
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
    const fallback = field === 'startDate' ? DEFAULT_START_TIME : DEFAULT_END_TIME;
    const time = toDemandTimeInput(formDemand[field] as any) || fallback;
    setFormDemand(prev => ({ ...prev, [field]: buildDemandDateTime(val, time, fallback) }));
    setFormError(null);
  };

  const handleTimeChange = (field: 'startDate' | 'endDate', val: string) => {
    const date = toDemandDateInput(formDemand[field] as any);
    if (!date) return;
    setFormDemand(prev => ({ ...prev, [field]: buildDemandDateTime(date, val, field === 'startDate' ? DEFAULT_START_TIME : DEFAULT_END_TIME) }));
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
            instructorId: b.instructor_id ?? null,
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
            instructorId: b.instructor_id ?? null,
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
      // Parede pura: nada de new Date() aqui. isoToLocalDTL reinterpretava o
      // "+00:00" que o PostgREST devolve como instante e devolvia -3h.
      startDate: toDemandDateTimeInput(demand.startDate, DEFAULT_START_TIME) || demand.startDate,
      endDate: toDemandDateTimeInput(demand.endDate, DEFAULT_END_TIME) || demand.endDate,
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
        // Empresa é OPCIONAL na interna: o CHECK demands_cliente_requires_refs
        // só exige as refs quando tipo='cliente'. '' vira null no mapDemandToDb.
        companyId: (formDemand.companyId || '').trim(),
        // Treinamento continua SEMPRE nulo — interna não tem treinamento, e é
        // disso que a medição depende para usar horasPrevistas.
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
          // Parede, não instante — ver nota equivalente no Demands.tsx.
          if (toDemandDateTimeInput(before.startDate) !== toDemandDateTimeInput(sanitized.startDate))
            diff.push(`Início: ${formatDateTime(before.startDate)} → ${formatDateTime(sanitized.startDate)}`);
          if (toDemandDateTimeInput(before.endDate) !== toDemandDateTimeInput(sanitized.endDate))
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

        // O MESMO recorte da tela de cliente (domain/allocationReschedule).
        //
        // A interna não tem o bloco que reescrevia alocações — ela nunca teve
        // sync de datas — mas TEM participantes com período próprio, e mudar o
        // período da demanda deixava esse período apontando para fora dela.
        // Acompanhante e alocação entram vazios aqui de propósito: o que a
        // interna tem é participante; se um dia ela ganhar os outros dois, a
        // regra já está aplicada.
        const diaDaData = (v?: string | null) => (v ?? '').slice(0, 10);
        if (
          before &&
          (diaDaData(before.startDate) !== diaDaData(sanitized.startDate) ||
            diaDaData(before.endDate) !== diaDaData(sanitized.endDate))
        ) {
          const plano = planAllocationReschedule({
            diasAntigos: getDemandDays(before as any),
            diasNovos: getDemandDays(sanitized as any),
            horaInicio: (sanitized.startDate ?? '').slice(11) || '08:00',
            horaFim: (sanitized.endDate ?? '').slice(11) || '18:00',
            allocations: [],
            companions: [],
            participants: demandParticipants.filter(pt => pt.demandId === sanitized.id),
          });

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

          const avisos = describeReschedule(plano, getInstructorName);
          if (avisos.length > 0) setNotification({ type: 'info', message: avisos.join(' ') });
        }
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
            instructor_id: b.instructorId ?? null,
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
            instructor_id: b.instructorId ?? null,
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

  /* ─────────────── Documento: Word / E-mail / WhatsApp ─────────────── */

  /**
   * Modelo de exibição do documento — mesmo contrato do formulário de cliente
   * (services/demandDocument.ts). As diferenças da interna são só as linhas de
   * identificação: não existe treinamento, então entram categoria, descrição e
   * as horas previstas (a carga que a medição usa).
   */
  const buildInternalDocFields = (): DemandDocFields => {
    const categoria = (formDemand.categoriaInterna || '').trim() || 'N/A';
    const descricao = (formDemand.descricaoInterna || '').trim() || 'N/A';
    const horas = formDemand.horasPrevistas != null && String(formDemand.horasPrevistas) !== ''
      ? `${formDemand.horasPrevistas}h`
      : 'N/A';

    const diasEspecificos =
      formDemand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(formDemand.specificDates) && formDemand.specificDates.length > 0
        ? [...formDemand.specificDates]
            .sort((a, b) => a.data.localeCompare(b.data))
            .map(e => `${new Date(e.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${e.horarioInicio}-${e.horarioFim}`)
            .join(', ')
        : null;

    const locoBlocks = formDemand.logisticasLocomocao?.length
      ? formDemand.logisticasLocomocao
      : [emptyLocomocaoBlock()];
    const hospBlocks = formDemand.logisticasHospedagem?.length
      ? formDemand.logisticasHospedagem
      : [emptyHospedagemBlock()];

    const instrutorIds = allInstructorsByDemandId[String(formDemand.id ?? '')] ?? [];
    const instrutor = instrutorIds.length > 0
      ? instrutorIds.map(getInstructorName).join(', ')
      : getInstructorName(formDemand.instructorId);

    return {
      id: String(formDemand.id ?? ''),
      tituloDocumento: 'DEMANDA INTERNA',
      // Sem "/ Cliente": numa interna a empresa é onde o trabalho acontece,
      // não quem contratou.
      empresaLabel: '🏢 Empresa: ',
      empresa: getDemandCompanyLabel(formDemand as Demand, companies),
      identificacaoTexto: [
        { label: 'Categoria', value: categoria },
        { label: 'Descrição', value: descricao },
      ],
      identificacaoWord: [
        { label: '🏷️ Categoria: ', value: categoria },
        { label: '📋 Descrição: ', value: descricao },
        { label: 'Carga Horária: ', value: horas },
      ],
      modalidade: formDemand.modality || 'PRESENCIAL',
      periodo: `${formatDateTime(formDemand.startDate)} até ${formatDateTime(formDemand.endDate)}`,
      diasEspecificos,
      local: formDemand.trainingLocal || 'N/A',
      corredor: formDemand.corredor || 'Não informado',
      estado: formDemand.demandState || 'Não informado',
      regiao: regions.find(r => r.id === formDemand.regionId)?.name || 'N/A',
      solicitante: formDemand.requester || 'Não informado',
      instrutor,
      status: getStatusOf(formDemand as Demand).replace('_', ' '),
      observacoes: formDemand.observations || 'N/A',
      loco: locoBlocks.map(b => ({
        instructorName: b.instructorName,
        transportType: b.transportType,
        rentalCompany: b.rentalCompany,
        rentalLocator: b.rentalLocator,
        rentalAgencyLocation: b.rentalAgencyLocation,
        rentalCheckIn: b.rentalCheckIn ? formatDateTime(b.rentalCheckIn) : null,
        rentalCheckOut: b.rentalCheckOut ? formatDateTime(b.rentalCheckOut) : null,
      })),
      hosp: hospBlocks.map(b => ({
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

  const handleGenerateWord = async () => {
    const categoria = (formDemand.categoriaInterna || 'Interna').replace(/\s+/g, '_');
    const startStr = formDemand.startDate?.split('T')[0] || 'data';
    const primeiroNome = getInstructorName(formDemand.instructorId).split(' ')[0] || 'NaoAlocado';
    await downloadDemandWord(
      buildInternalDocFields(),
      `DemandaInterna_${categoria}_${startStr}_${primeiroNome}.docx`
    );
  };

  const handleSendEmail = () => {
    const categoria = (formDemand.categoriaInterna || 'Interna').trim();
    const start = formatDateTime(formDemand.startDate).split(' ')[0];
    const subject = encodeURIComponent(`Demanda Interna – ${categoria} – ${start}`);
    const introText = 'Olá,\n\nSeguem abaixo os dados da demanda interna para sua análise e organização:\n\n';
    const body = encodeURIComponent(
      introText + buildDemandTextContent(buildInternalDocFields(), false) +
      '\n\nAtenciosamente,\nEquipe de Gestão Colabor.'
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleSendWhatsApp = () => {
    const text = encodeURIComponent(
      `Olá! Seguem os dados da demanda interna:\n\n${buildDemandTextContent(buildInternalDocFields(), true)}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };


  /* ──────────────────── Cancelar / Excluir / Reativar ──────────────────── */

  const currentStatus = formDemand.startDate
    ? getStatusOf(formDemand as Demand)
    : ('NOVA' as DemandStatus);

  /* ───────── Blocos INSTRUTORES (leitura) e CENTRO MÓVEL (funcional) ─────────
   *
   * Mesmo par de cards do modal de cliente, com UMA diferença de escopo:
   * o bloco de instrutores aqui é SOMENTE LEITURA. Nada nesta tela escreve em
   * `instructor_allocations` — decisão registrada: o botão do cliente faz
   * split destrutivo de período (substitui a alocação anterior), e portar esse
   * comportamento para a interna ficou para depois.
   */

  /** Alocações de instrutor da demanda, com fallback para o principal. Leitura pura. */
  const currentInstructorEntries = useMemo(() => {
    if (!formDemand.id) return [];
    return resolveDemandInstructors(formDemand.id, formDemand.instructorId, instructorAllocations);
  }, [formDemand.id, formDemand.instructorId, instructorAllocations]);

  const currentResourceAllocations = useMemo(() => {
    if (!formDemand.id) return [];
    return resourceAllocations.filter(a => a.demandId === formDemand.id);
  }, [resourceAllocations, formDemand.id]);

  // Slot de erro próprio do modal de CTM desta tela. No modal de cliente ele é
  // compartilhado com o fluxo de instrutor; aqui não existe fluxo de instrutor,
  // então o estado é local.
  const [resourceError, setResourceError] = useState<string | null>(null);

  const ctmAllocation = useResourceAllocation({
    demand: formDemand,
    addResourceAllocation,
    hasResourceConflict,
    error: resourceError,
    setError: setResourceError,
    canAllocate: canAllocateResource,
  });

  /* ─────────────────────── PARTICIPANTES (F1) ────────────────────────────
   *
   * Card irmão do de Instrutores, e não uma substituição dele: o titular
   * continua vindo de `demands.instructor_id`/`instructor_allocations`, e
   * aquele bloco segue somente leitura. Aqui é a lista de titulares PLENOS
   * adicionais, que moram em `demand_participants`.
   *
   * ⚠️ Nada neste fluxo toca `instructor_allocations` — é o que impede o
   * split destrutivo de apagar um participante ao adicionar o próximo, e o
   * rateio de horas de multiplicar a carga. `smoke:participantes` prende isso
   * com guarda de fonte.
   */
  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);

  const currentParticipants = useMemo(() => {
    if (!formDemand.id) return [];
    return demandParticipants
      .filter(pt => pt.demandId === formDemand.id)
      .sort((a, b) =>
        getInstructorName(a.instructorId).localeCompare(getInstructorName(b.instructorId), 'pt-BR')
      );
  }, [demandParticipants, formDemand.id, instructors]);

  /**
   * Candidatos do modal: ativos, menos quem já é participante e menos o
   * instrutor principal da demanda (que já aparece no card de Instrutores —
   * listá-lo aqui convidaria a contar a mesma pessoa duas vezes na medição).
   */
  const participantCandidates = useMemo(() => {
    const jaParticipa = new Set(currentParticipants.map(pt => pt.instructorId));
    return instructors.filter(
      i => i.status === 'ATIVO' && !jaParticipa.has(i.id) && i.id !== formDemand.instructorId
    );
  }, [instructors, currentParticipants, formDemand.instructorId]);

  /**
   * Aviso de conflito no modal. Consulta o período INTEIRO da demanda e
   * exclui a própria demanda — sem isso, quem já tem qualquer vínculo com ela
   * apareceria marcado em vermelho por conflito consigo mesmo.
   */
  const participantHasConflict = useCallback(
    (instructorId: string) => {
      if (!formDemand.startDate || !formDemand.endDate) return false;
      return hasScheduleConflict(instructorId, formDemand.startDate, formDemand.endDate, formDemand.id);
    },
    [hasScheduleConflict, formDemand.startDate, formDemand.endDate, formDemand.id]
  );

  /**
   * Adiciona o participante e prepara a logistica por pessoa.
   *
   * A criacao dos dois blocos (e a identificacao do bloco anonimo do titular)
   * NAO mora mais aqui: e a mesma rotina do App que o fluxo de ACOMPANHANTE de
   * cliente usa, em domain/logisticBlockOwnership.ts + ensureLogisticBlocksForPerson.
   * A regra e uma so para os dois tipos de demanda; duas copias divergiriam no
   * primeiro ajuste.
   *
   * ⚠️ POR QUE PERSISTIR AQUI, e nao deixar para o save do formulario — este
   * foi o bug encontrado no teste manual da F1:
   *
   * O card de Participantes so existe em modalSubMode === VIEW, e a VIEW nao
   * tem botao de salvar (ele e FORM && canEditDemand). O participante era
   * gravado — o insert vai direto ao banco — mas os dois blocos ficavam so no
   * estado do formulario e morriam ao fechar o modal. Pior: reabrir chama
   * loadLogisticsFor, que sobrescreve os blocos com o que esta no banco.
   *
   * Depois de gravar, o estado do formulario e RECARREGADO do banco em vez de
   * ser remendado na mao: e a leitura que ja existe (loadLogisticsFor), e ela
   * traz junto o bloco do titular que acabou de ser identificado. Seguro
   * porque o card so aparece em VIEW, onde as secoes de logistica sao somente
   * leitura — nao existe edicao pendente para ser descartada.
   */
  const handleAddParticipant = useCallback(
    async (payload: { instructorId: string; startDate: string | null; endDate: string | null }) => {
      if (!formDemand.id) return;

      const ok = await addDemandParticipant({
        demandId: formDemand.id,
        instructorId: payload.instructorId,
        startDate: payload.startDate,
        endDate: payload.endDate,
      });

      // Falhou (unique / FK / CHECK / RLS): a notificacao ja saiu do App e o
      // modal continua aberto para o usuario corrigir. Nada de bloco orfao.
      if (!ok) return;

      const nome = getInstructorName(payload.instructorId);

      // Cria os 2 blocos do participante (idempotente) e identifica o bloco
      // anonimo do titular, que deixa de ser "o unico" agora que ha 2 pessoas.
      await ensureLogisticBlocksForPerson(formDemand.id, payload.instructorId);

      const logistics = await loadLogisticsFor(formDemand.id);
      setFormDemand(prev => ({
        ...prev,
        logisticasLocomocao: logistics.locoBlocks,
        logisticasHospedagem: logistics.hospBlocks,
      }));

      setIsParticipantModalOpen(false);
      setNotification({ message: `${nome} adicionado como participante.`, type: 'success' });
    },
    [formDemand.id, addDemandParticipant, ensureLogisticBlocksForPerson, instructors, setNotification]
  );

  /**
   * Remove o participante e os blocos de logística que pertenciam a ele.
   *
   * Só remove bloco AINDA VAZIO. Um bloco já preenchido (locadora, localizador,
   * hotel, nota fiscal anexada) é trabalho de alguém — deixá-lo para trás,
   * órfão de participante, é menos ruim do que apagar dado sem perguntar. Ele
   * fica visível na seção de logística e pode ser removido à mão.
   *
   * Quem apaga os blocos no BANCO é o `removeDemandParticipant` do App —
   * assim a regra vale igual pelo card do formulário e pelo card da agenda,
   * em vez de existir aqui e faltar lá (foi o que deixou o botão REMOVER
   * REGISTRO da agenda cair no delete de agenda_items). Aqui só recarregamos
   * o estado da tela a partir do banco, o mesmo caminho de leitura do
   * `handleAddParticipant`.
   */
  const handleRemoveParticipant = useCallback(
    async (participantId: string, _instructorId: string) => {
      if (!formDemand.id) return;

      setRemovingParticipantId(participantId);
      const ok = await removeDemandParticipant(participantId);
      setRemovingParticipantId(null);
      if (!ok) return;

      const logistics = await loadLogisticsFor(formDemand.id);
      setFormDemand(prev => ({
        ...prev,
        logisticasLocomocao: logistics.locoBlocks,
        logisticasHospedagem: logistics.hospBlocks,
      }));

      setNotification({ message: 'Participante removido.', type: 'success' });
    },
    [formDemand.id, removeDemandParticipant, setNotification]
  );

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
      {/* Sugestoes do campo Local: base propria da demanda interna. A cascata
          (local -> corredor/estado/regiao) continua nas location_associations. */}
      <DataList id="locais-internos-list" items={operationalBases.locaisDemandasInternas ?? []} />
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExportOpen(true)}
              className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
            >
              <FileDown size={18} /> <span className="hidden sm:inline">Exportar Demandas (Excel)</span>
            </button>
            <button
              onClick={handleOpenCreate}
              className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center space-x-2 whitespace-nowrap shadow-md"
            >
              <Plus size={18} /> <span className="hidden sm:inline">Nova Demanda Interna</span>
            </button>
          </div>
        </div>

        {/* Painel de filtros — mesma casca e mesmas classes do painel da tela de
            demandas de cliente (components/demand-form/FilterPanel.tsx).
            Campos adaptados: Categoria no lugar de Treinamento, e sem
            Modalidade (interna é sempre PRESENCIAL). */}
        <div className="no-print">
          <FilterPanelShell
            onClear={clearFilters}
            showAdvanced={showAdvancedFilters}
            onToggleAdvanced={() => setShowAdvancedFilters(prev => !prev)}
            advanced={
              <>
                <FilterField label="Instrutor">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.instructorId}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, instructorId: e.target.value })}
                  >
                    <option value="">Qualquer Instrutor</option>
                    <option value="unallocated">Sem Instrutor Alocado</option>
                    {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Status da Demanda">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.status}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, status: e.target.value })}
                  >
                    <option value="">Todos os Status</option>
                    <option value="NOVA">Nova</option>
                    <option value="PENDENTE">Pendente</option>
                    <option value="ALOCADA">Alocada</option>
                    <option value="EM_ANDAMENTO">Em Andamento</option>
                    <option value="CONCLUIDA">Concluída</option>
                    <option value="CANCELADA">Cancelada</option>
                  </select>
                </FilterField>

                <FilterField label="Região">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.regionId}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, regionId: e.target.value })}
                  >
                    <option value="">Todas as Regiões</option>
                    {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Estado">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.demandState}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, demandState: e.target.value })}
                  >
                    <option value="">Todos os Estados</option>
                    {estadoOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Unidade / Local">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.trainingLocal}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, trainingLocal: e.target.value })}
                  >
                    <option value="">Todos os Locais</option>
                    {localOptions.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                  </select>
                </FilterField>

                <FilterField label="Corredor">
                  <select
                    className={FILTER_INPUT_CLASS}
                    value={advancedFilters.corredor}
                    onChange={e => setAdvancedFilters({ ...advancedFilters, corredor: e.target.value })}
                  >
                    <option value="">Todos os Corredores</option>
                    {(operationalBases.corredores ?? []).sort().map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FilterField>
              </>
            }
          >
            <FilterGrid>
              <FilterSearchField
                label="Buscar ID ou Palavra-Chave"
                placeholder="ID, Categoria, Descrição..."
                value={filter}
                onChange={setFilter}
              />

              <FilterField label="Categoria">
                <select
                  className={FILTER_INPUT_CLASS}
                  value={advancedFilters.categoria}
                  onChange={e => setAdvancedFilters({ ...advancedFilters, categoria: e.target.value })}
                >
                  <option value="">Todas as Categorias</option>
                  {categoriaOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FilterField>

              <FilterField label="Empresa">
                <select
                  className={FILTER_INPUT_CLASS}
                  value={advancedFilters.companyId}
                  onChange={e => setAdvancedFilters({ ...advancedFilters, companyId: e.target.value })}
                >
                  <option value="">Todas as Empresas</option>
                  <option value="SEM_EMPRESA">Sem empresa / Colabor</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FilterField>

              <FilterDateRangeField
                label="Período (De / Até)"
                from={advancedFilters.startDate}
                to={advancedFilters.endDate}
                onFromChange={v => setAdvancedFilters({ ...advancedFilters, startDate: v })}
                onToChange={v => setAdvancedFilters({ ...advancedFilters, endDate: v })}
              />
            </FilterGrid>
          </FilterPanelShell>
        </div>

        {/* Listagem — mesma casca, contador e cabeçalho da tela de cliente */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden no-print">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {filteredDemands.length} Demandas internas encontradas
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-black text-slate-500">
                  <th className="p-4 cursor-pointer select-none" onClick={() => toggleSort('id')}>
                    ID {sort?.key === 'id' && (sort.dir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="p-4">Categoria</th>
                  <th className="p-4">Descrição</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Local</th>
                  <th className="p-4">Data Início</th>
                  <th className="p-4">Instrutor</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDemands.length > 0 ? paginatedItems.map(demand => {
                  const status = getStatusOf(demand);
                  const ids = allInstructorsByDemandId[demand.id] ?? [];
                  const participantesDaLinha = participantNamesByDemandId[demand.id] ?? [];
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
                      <td className="p-4 max-w-[14rem] truncate" title={getDemandCompanyLabel(demand, companies)}>
                        {getDemandCompanyLabel(demand, companies)}
                      </td>
                      <td className="p-4">{demand.demandState || '—'}</td>
                      <td className="p-4">{demand.trainingLocal || '—'}</td>
                      <td className="p-4 whitespace-nowrap">{formatDateTime((demand.startDate || '').split('T')[0])}</td>
                      <td className="p-4 font-medium text-gray-900">
                        {ids.length === 0 && participantesDaLinha.length === 0 ? 'Não Alocado' : (
                          <div className="flex flex-col gap-0.5">
                            {ids.slice(0, 2).map(id => <span key={id}>{getInstructorName(id)}</span>)}
                            {ids.length > 2 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-600 text-white w-fit">
                                +{ids.length - 2}
                              </span>
                            )}
                            {ids.length === 0 && <span className="text-slate-400">Não Alocado</span>}
                            {/* Participantes NÃO entram na contagem de instrutores:
                                são vínculo de outra tabela. O que separa os dois
                                "+N" da mesma célula é o tooltip — e o badge de
                                instrutores é sólido, este é claro. */}
                            <PersonCountBadge
                              count={participantesDaLinha.length}
                              title={`Participantes: ${participantesDaLinha.join(', ')}`}
                            />
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
                    <td colSpan={10} className="p-20 text-center text-slate-400">
                      <div className="flex flex-col items-center gap-3">
                        <Eraser size={40} className="opacity-20" />
                        <p className="font-medium">Nenhuma demanda interna encontrada.</p>
                        {(filter || Object.values(advancedFilters).some(Boolean)) && (
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

      {/* Export — mesmo modal da tela de cliente, na variante de internas.
          Recebe as demandas JÁ filtradas por tipo; o modal tem os filtros dele. */}
      <ExportDemandsModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        demands={internalDemands}
        companies={companies}
        trainings={[]}
        regions={regions}
        participantNamesByDemandId={participantNamesByDemandId}
        instructors={instructors}
        instructorAllocations={instructorAllocations}
        variant="interna"
        categoriaOptions={categoriaOptions}
      />

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
            {/* Header — mesmas classes do modal de demanda de cliente */}
            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center no-print">
              <div className="flex flex-col">
                <h2 className="text-xl font-bold text-gray-800">
                  {modalSubMode === 'VIEW'
                    ? 'Visualização da Demanda Interna'
                    : (modalMode === 'CREATE' ? 'Nova Demanda Interna' : 'Editar Demanda Interna')}
                </h2>
                {modalSubMode === 'VIEW' && (
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-slate-400 font-mono">ID: {formDemand.id}</p>
                    {/* Mesmo componente da listagem. Só aparece quando há
                        participantes — em demanda sem eles, o cabeçalho fica
                        exatamente como era. */}
                    <PersonCountBadge
                      count={currentParticipants.length}
                      title={`Participantes: ${currentParticipants
                        .map(pt => getInstructorName(pt.instructorId))
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
                    {currentStatus !== 'CANCELADA' && canPerformDemandAction(profile?.role, 'edit_demand') && (
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
                <button
                  onClick={() => {
                    setConfirmDelete(false);
                    setConfirmCancel(false);
                    setConfirmReactivate(false);
                    setIsModalOpen(false);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition p-1 hover:bg-gray-100 rounded-lg"
                >
                  <X size={24} />
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

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Empresa (opcional)</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={formDemand.companyId || ''}
                            onChange={(e) => setFormDemand({ ...formDemand, companyId: e.target.value })}
                          >
                            <option value="">Nenhuma / Colabor</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <p className="text-[10px] text-slate-400 mt-1">
                            Use quando a demanda interna acontece no cliente. Não gera treinamento nem medição de cliente.
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
                            list="locais-internos-list"
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
                                <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toDemandDateInput(formDemand.startDate)} onChange={(e) => handleDateChange('startDate', e.target.value)} />
                                <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toDemandTimeInput(formDemand.startDate)} onChange={(e) => handleTimeChange('startDate', e.target.value)} />
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="block text-xs font-bold text-gray-500 uppercase">Fim *</label>
                              <div className="flex gap-2">
                                <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toDemandDateInput(formDemand.endDate)} onChange={(e) => handleDateChange('endDate', e.target.value)} />
                                <input type="time" className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={toDemandTimeInput(formDemand.endDate)} onChange={(e) => handleTimeChange('endDate', e.target.value)} />
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
                        <DataViewField
                          label="Empresa"
                          value={getDemandCompanyLabel(formDemand as Demand, companies)}
                          icon={Building}
                        />
                        <DataViewField label="Solicitante" value={formDemand.requester} icon={User} />
                        <div className="flex flex-col space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status Atual</span>
                          <span className={`w-fit px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(currentStatus)}`}>
                            {currentStatus.replace('_', ' ')}
                          </span>
                        </div>
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

              {/* SEÇÃO DE ALOCAÇÕES POR PERÍODO (INSTRUTORES E RECURSOS)
                  Mesmo par de cards do modal de cliente (Demands.tsx). */}
              {modalSubMode === 'VIEW' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
                  {/* Instrutores — SOMENTE LEITURA.
                      Sem botão de adicionar e sem nenhum caminho de escrita em
                      instructor_allocations: alocar instrutor em demanda interna
                      fica para depois (o fluxo do cliente substitui a alocação
                      anterior por split de período, fora de escopo aqui).
                      As linhas exibidas podem ter vindo da agenda. */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="w-full px-6 py-4 flex items-center justify-between bg-white">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Users size={20} /></div>
                        <h3 className="font-bold text-slate-800 uppercase text-sm">Instrutores</h3>
                      </div>
                    </div>
                    <div className="px-6 py-4 border-t border-slate-100 bg-white min-h-[100px]">
                      {currentInstructorEntries.length > 0 ? (
                        <div className="space-y-3">
                          {currentInstructorEntries.map((entry, idx) => (
                            <div
                              key={entry.allocationId || `${entry.instructorId}-${idx}`}
                              className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200"
                            >
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs uppercase">
                                {getInstructorName(entry.instructorId).charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-800">{getInstructorName(entry.instructorId)}</p>
                                {entry.startDate ? (
                                  <p className="text-[10px] font-medium text-slate-500 flex items-center gap-2">
                                    <Calendar size={10} /> {formatDateOnlySafe(entry.startDate)} até {formatDateOnlySafe(entry.endDate)}
                                  </p>
                                ) : (
                                  <p className="text-[10px] font-medium text-slate-400">Instrutor principal da demanda</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic py-2">Nenhum instrutor alocado.</p>
                      )}
                    </div>
                  </div>

                  {/* Centro Móvel — funcional, idêntico ao cliente:
                      mesmo hook, mesmo modal, mesma escrita em resource_allocations
                      e mesma checagem de conflito bloqueante (neutra quanto a tipo:
                      uma interna bloqueia uma de cliente e vice-versa). */}
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
                              {canAllocateResource && (
                                <button
                                  onClick={() => removeResourceAllocation(allocation.id)}
                                  className="p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic py-2">Nenhum recurso logístico alocado por período.</p>
                      )}
                    </div>
                  </div>

                  {/* PARTICIPANTES — card irmão do de Instrutores, este SIM
                      com escrita. Grava em `demand_participants` (tabela
                      própria, migration 016), nunca em instructor_allocations.
                      Ocupa a linha inteira do grid porque a lista cresce com o
                      tamanho da equipe, ao contrário dos dois de cima. */}
                  <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="w-full px-6 py-4 flex items-center justify-between bg-white">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><Users size={20} /></div>
                        <div>
                          <h3 className="font-bold text-slate-800 uppercase text-sm">Participantes</h3>
                          <p className="text-[10px] font-medium text-slate-400">
                            Titulares plenos, no mesmo nível do instrutor principal
                          </p>
                        </div>
                      </div>
                      {currentStatus !== 'CANCELADA' && canEditDemand && !!formDemand.id && (
                        <button
                          onClick={() => setIsParticipantModalOpen(true)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-black text-[10px] uppercase tracking-wider shadow-sm"
                        >
                          <Plus size={14} /> Adicionar
                        </button>
                      )}
                    </div>

                    <div className="px-6 py-4 border-t border-slate-100 bg-white">
                      {currentParticipants.length > 0 ? (
                        <div className="space-y-3">
                          {currentParticipants.map(pt => (
                            <div
                              key={pt.id}
                              className="flex items-center justify-between gap-4 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 group"
                            >
                              <div className="flex items-center gap-4 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs uppercase shrink-0">
                                  {getInstructorName(pt.instructorId).charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-800 truncate">
                                    {getInstructorName(pt.instructorId)}
                                  </p>
                                  {pt.startDate && pt.endDate ? (
                                    <p className="text-[10px] font-medium text-slate-500 flex items-center gap-2">
                                      <Calendar size={10} /> {formatDateOnlySafe(pt.startDate)} até {formatDateOnlySafe(pt.endDate)}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] font-medium text-slate-400">
                                      Todo o período da demanda
                                    </p>
                                  )}
                                </div>
                              </div>
                              {currentStatus !== 'CANCELADA' && canEditDemand && (
                                <button
                                  onClick={() => handleRemoveParticipant(pt.id, pt.instructorId)}
                                  disabled={removingParticipantId === pt.id}
                                  className="p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                                  title="Remover participante"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic py-2">
                          {formDemand.id
                            ? 'Nenhum participante adicionado.'
                            : 'Salve a demanda para poder adicionar participantes.'}
                        </p>
                      )}

                      {/* A F1 entrega vínculo, agenda e conflito — pagamento é
                          a F2. Sem este aviso a tela parece completa e não é:
                          alguém adicionaria três participantes e esperaria vê-los
                          na medição do mês. */}
                      <div className="mt-4 flex items-start gap-2 text-[10px] text-slate-400 leading-snug">
                        <Info size={12} className="shrink-0 mt-0.5" />
                        <span>
                          Participantes já aparecem na agenda e entram na checagem de conflito.
                          <strong className="text-slate-500"> Ainda não geram pagamento na medição</strong> (em desenvolvimento).
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

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

              {/* Direita — mesmas classes do rodapé do modal de cliente.
                  Editar vive só no cabeçalho, como lá. */}
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setConfirmCancel(false);
                    setConfirmReactivate(false);
                    setFormError(null);
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
                      ${isFormValid && !isSaving
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                  >
                    <Check size={16} /> {isSaving ? 'Salvando...' : (modalMode === 'CREATE' ? 'Criar Demanda' : 'Salvar Alterações')}
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

      {/* MODAL DE ALOCAÇÃO DE RECURSO (CTM) — o MESMO componente e o MESMO
          fluxo do modal de cliente (components/ResourceAllocationModal.tsx +
          hooks/useResourceAllocation.ts). */}
      <ResourceAllocationModal {...ctmAllocation.modalProps} />

      {/* Seleção de participante. Fecha só quando a gravação dá certo — ver
          handleAddParticipant. */}
      <ParticipantSelectionModal
        open={isParticipantModalOpen}
        instructors={participantCandidates}
        demandStartDate={formDemand.startDate || ''}
        demandEndDate={formDemand.endDate || ''}
        hasConflict={participantHasConflict}
        onCancel={() => setIsParticipantModalOpen(false)}
        onConfirm={handleAddParticipant}
      />
    </>
  );
};

export default InternalDemands;
