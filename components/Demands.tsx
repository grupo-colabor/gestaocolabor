import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { Demand, DemandStatus, Modality, TransportType, RentalCompany, PaymentMethod, AccommodationType, InstructorAllocation, LogisticAllocation } from '../types';
import { 
  Search, FileText, X, Plus, Filter, RotateCcw, 
  ChevronDown, ChevronUp, MapPin, Truck, Home, UserCheck, 
  Calendar, Check, AlertCircle, Building, Building2,
  ArrowRight, Tag, Edit3, User, Info, FileSearch,
  BookOpen, Clock, Mail, MessageCircle, FileDown,
  FileText as FileWordIcon, Eraser, Trash2, Sparkles, Ban, RefreshCw, FilePlus, FileCheck,
  UserPlus, Users
} from 'lucide-react';
import { 
  HISTORICAL_MATRICULADORES, 
  CAR_CATEGORIES, PAYMENT_METHODS 
} from '../constants';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx';
import { calculateDemandStatus } from '../domain/demandStatus';
import { useAuth } from "../contexts/AuthContext";


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
    measurements, agendaItems, instructorAllocations, resourceAllocations,
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
  const [showDeleteMessage, setShowDeleteMessage] = useState(false);
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
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


  // Helper names
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';
  const getInstructorName = (id?: string) => instructors.find(i => i.id === id)?.name || 'Não Alocado';

  // --- LÓGICA DE PDF ---
  const handlePdfUpload = (field: 'classListPdf' | 'instructorReleasePdf', file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Por favor, selecione apenas arquivos PDF.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setFormDemand(prev => ({
        ...prev,
        attachments: {
          ...prev.attachments,
          [field]: { name: file.name, base64 }
        }
      }));
    };
    reader.readAsDataURL(file);
  };

  const removePdf = (field: 'classListPdf' | 'instructorReleasePdf') => {
    setFormDemand(prev => {
      const newAttachments = { ...prev.attachments };
      delete newAttachments[field];
      return { ...prev, attachments: newAttachments };
    });
  };

  const downloadPdf = (field: 'classListPdf' | 'instructorReleasePdf') => {
    const data = formDemand.attachments?.[field];
    if (!data) return;
    const link = document.createElement('a');
    link.href = data.base64;
    link.download = data.name;
    link.click();
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
  return demands.filter(d => {

    // 🔐 REGRA DE VISUALIZAÇÃO — COORDENADOR
    // Coordenador só vê demandas que tenham instrutor principal (via alocações ou campo antigo)
    if (isCoordinator && !principalInstructorByDemandId[d.id]) {
      return false;
    }


    const matchesText = 
      d.id.toLowerCase().includes(filter.toLowerCase()) ||
      getCompanyName(d.companyId).toLowerCase().includes(filter.toLowerCase()) ||
      getTrainingName(d.trainingId).toLowerCase().includes(filter.toLowerCase());

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
  }).sort((a, b) => b.id.localeCompare(a.id));
}, [demands, filter, advancedFilters, companies, trainings, isCoordinator]);

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
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const baseDate = `${day}/${month}/${year}`;
    if (dateStr.includes('T') || (dateStr.includes(':') && dateStr.length > 10)) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${baseDate} ${hours}:${minutes}`;
    }
    return baseDate;
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
    setIsModalOpen(true);
  };

 const handleOpenView = (demand: Demand) => {
  setActiveDemand(demand);
  setFormDemand({ ...demand });
  setModalMode('EDIT');

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


const handleSave = () => {
  if (!isFormValid) return;

  // Validação de datas (Início <= Fim)
  if (formDemand.startDate && formDemand.endDate) {
    const start = new Date(formDemand.startDate);
    const end = new Date(formDemand.endDate);
    if (start > end) {
      setResourceError("A data de início não pode ser maior que a data de fim.");
      setTimeout(() => setResourceError(null), 4000);
      return;
    }
  }

  // ✅ ONLINE: não pode gerar pendência de logística / local
  const sanitizedDemand: Demand = {
    ...(formDemand as Demand),
    trainingLocal: formDemand.modality === 'ONLINE' ? '' : (formDemand.trainingLocal || ''),
    regionId: formDemand.regionId || '',
    logisticsTransport: formDemand.modality === 'ONLINE' ? 'NAO_NECESSARIO' : formDemand.logisticsTransport,
    logisticsHotel: formDemand.modality === 'ONLINE' ? 'NAO_NECESSARIO' : formDemand.logisticsHotel,
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

  if (modalMode === 'CREATE') {
    addDemand(sanitizedDemand);
  } else {
    updateDemand(sanitizedDemand);
  }

  setIsModalOpen(false);
  setFormDemand(initialDemandState());
  setActiveDemand(null);
};


  const handleOpenAllocationModal = () => {
    if (!formDemand.id) return;
    setAllocationForm({
      instructorId: '',
      startDate: formDemand.startDate?.split('T')[0] || '',
      endDate: formDemand.endDate?.split('T')[0] || ''
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

    // Dados de tempo padrão para persistência no estado e agenda (08:00 às 18:00)
    const startIso = `${allocationForm.startDate}T08:00`;
    const endIso = `${allocationForm.endDate}T18:00`;

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
      startDate: formDemand.startDate?.split('T')[0] || '',
      endDate: formDemand.endDate?.split('T')[0] || ''
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

  const handleDateChange = (field: 'startDate' | 'endDate', val: string) => {
    const currentFull = formDemand[field] || '';
    const timePart = currentFull.includes('T') ? currentFull.split('T')[1] : '08:00';
    setFormDemand({ ...formDemand, [field]: `${val}T${timePart}` });
    setResourceError(null);
  };

  const handleTimeChange = (field: 'startDate' | 'endDate', val: string) => {
    const currentFull = formDemand[field] || '';
    const datePart = currentFull.includes('T') ? currentFull.split('T')[0] : '';
    if (!datePart) return;
    setFormDemand({ ...formDemand, [field]: `${datePart}T${val}` });
    setResourceError(null);
  };

  const getDateValue = (field: 'startDate' | 'endDate') => {
    const full = formDemand[field] || '';
    return full.includes('T') ? full.split('T')[0] : full;
  };

  const getTimeValue = (field: 'startDate' | 'endDate') => {
    const full = formDemand[field] || '';
    return full.includes('T') ? full.split('T')[1] : '';
  };

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
    if (t === 'Carro Alugado') {
      setFormDemand({
        ...formDemand,
        transportType: 'Carro Alugado',
        logisticsTransport: 'CONFIRMADO'
      });
    } else {
      // Limpa campos de locação para 'Carro Próprio' ou 'N/A'
      setFormDemand({
        ...formDemand,
        transportType: t === 'N/A' ? null : t,
        logisticsTransport: 'NAO_NECESSARIO',
        rentalCompany: 'Localiza',
        rentalAgencyLocation: '',
        rentalLocator: '',
        carCategory: 'Grupo CE',
        rentalCheckIn: '',
        rentalCheckOut: ''
      });
    }
  };

  const handleAccommodationClick = (type: AccommodationType) => {
    if (type === 'N/A') {
      setFormDemand({
        ...formDemand,
        accommodationType: null,
        logisticsHotel: 'NAO_NECESSARIO'
      });
    } else {
      setFormDemand({
        ...formDemand,
        accommodationType: type,
        logisticsHotel: 'CONFIRMADO'
      });
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
                <th className="p-4">ID</th>
                <th className="p-4">Empresa</th>
                <th className="p-4">Treinamento</th>
                <th className="p-4">Região</th>
                <th className="p-4">Data Início</th>
                <th className="p-4">Instrutor</th>
                <th className="p-4 text-center">Status</th>
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
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Local do Treinamento *</label><input list="localidades-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formDemand.trainingLocal || ''} onChange={(e) => setFormDemand({...formDemand, trainingLocal: e.target.value})} placeholder="Ex: Brucutu, Vitória..." /></div>
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Região</label><select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" value={formDemand.regionId} onChange={(e) => setFormDemand({...formDemand, regionId: e.target.value})}><option value="">Selecione...</option>{regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
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
                                <DataViewField label="Treinamento" value={getTrainingName(formDemand.trainingId!)} icon={BookOpen} />
                                <DataViewField label="Unidade / Local" value={formDemand.modality === 'ONLINE' ? 'N/A' : formDemand.trainingLocal} icon={MapPin} />
                                <DataViewField label="Início" value={formatDateTime(formDemand.startDate)} icon={Calendar} />
                                <DataViewField label="Fim" value={formatDateTime(formDemand.endDate)} icon={Calendar} />
                                <DataViewField label="Região" value={getRegionName(formDemand.regionId!)} icon={MapPin} />
                                <DataViewField label="Modalidade" value={formDemand.modality} icon={Info} />
                                <DataViewField label="Solicitante" value={formDemand.requester} icon={User} />
                                <div className="flex flex-col space-y-1">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status Atual</span>
                                  <span className={`w-fit px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(currentStatus)}`}>
                                    {currentStatus.replace('_', ' ')}
                                  </span>
                                </div>
                                <div className="md:col-span-3">
                                   <DataViewField label="Instrutor Principal" value={getInstructorName(formDemand.instructorId)} icon={UserCheck} />
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
                                          <Calendar size={10} /> {formatDateTime(allocation.startDate.split('T')[0])} até {formatDateTime(allocation.endDate.split('T')[0])}
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
                                          <Calendar size={10} /> {formatDateTime(allocation.startDate)} até {formatDateTime(allocation.endDate)}
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
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Matriculador</label><select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.matriculador || ''} onChange={(e) => setFormDemand({...formDemand, matriculador: e.target.value})}><option value="">Selecione...</option>{HISTORICAL_MATRICULADORES.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
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
                                <div className="flex gap-2">{(['Carro Alugado', 'Carro Próprio', 'N/A'] as TransportType[]).map(t => (
                                  <button 
                                    key={t} 
                                    onClick={() => handleTransportClick(t)} 
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all 
                                      ${(t === 'N/A' && formDemand.logisticsTransport === 'NAO_NECESSARIO' && !formDemand.transportType) || (t !== 'N/A' && formDemand.transportType === t) 
                                        ? 'bg-amber-600 text-white border-amber-600' 
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-amber-400'}`}
                                  >
                                    {t}
                                  </button>
                                ))}</div>
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
                      <button onClick={() => toggleSection('hospedagem')} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print"><div className="flex items-center gap-3"><div className="p-2 bg-green-50 rounded-lg text-green-600"><Home size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Logística — Hospedagem</h3></div>{openSections.hospedagem ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
                      {openSections.hospedagem && (
                        <div className="px-6 py-6 border-t border-slate-100 bg-white">
                          {modalSubMode === 'FORM' ? (
                            <div className="space-y-6">
                              <div><label className="block text-xs font-bold text-gray-500 uppercase mb-2">Hospedagem</label>
                                <div className="flex gap-2">{(['Hotel', 'N/A'] as AccommodationType[]).map(type => (
                                  <button 
                                    key={type} 
                                    onClick={() => handleAccommodationClick(type)} 
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all 
                                      ${(type === 'N/A' && formDemand.logisticsHotel === 'NAO_NECESSARIO' && !formDemand.accommodationType) || (type !== 'N/A' && formDemand.accommodationType === type)
                                        ? 'bg-green-600 text-white border-green-600' 
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-green-400'}`}
                                  >
                                    {type === 'N/A' ? 'N/A' : 'Precisa de Hotel'}
                                  </button>
                                ))}</div>
                              </div>
                              {formDemand.accommodationType === 'Hotel' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-green-50/50 rounded-xl border border-green-100">
                                  <div><label className="block text-xs font-bold text-green-800 uppercase mb-1">Cidade / Estado</label><input list="cidades-list" className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.hotelCity || ''} onChange={(e) => setFormDemand({...formDemand, hotelCity: e.target.value})} /></div>
                                  <div><label className="block text-xs font-bold text-green-800 uppercase mb-1">Hotel</label><input list="hoteis-list" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formDemand.hotelName || ''} onChange={(e) => setFormDemand({...formDemand, hotelName: e.target.value})} /></div>
                                  <div><label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-in</label><input type="date" className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" value={formDemand.hotelCheckIn || ''} onChange={e => setFormDemand({...formDemand, hotelCheckIn: e.target.value})} /></div>
                                  <div><label className="block text-xs font-bold text-green-800 uppercase mb-1">Check-out</label><input type="date" className="w-full border border-green-200 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-green-500" value={formDemand.hotelCheckOut || ''} onChange={e => setFormDemand({...formDemand, hotelCheckOut: e.target.value})} /></div>
                                  <div className="md:col-span-2"><label className="block text-xs font-bold text-green-800 uppercase mb-1">Pagamento</label><select className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={formDemand.hotelPayment || 'Faturado'} onChange={(e) => setFormDemand({...formDemand, hotelPayment: e.target.value as PaymentMethod})}>{PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <DataViewField label="Hospedagem" value={formDemand.accommodationType === 'Hotel' ? 'Hotel Requerido' : (formDemand.logisticsHotel === 'NAO_NECESSARIO' ? 'N/A' : 'Pendente')} icon={Home} />
                              {formDemand.accommodationType === 'Hotel' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-green-50 rounded-xl border border-green-100">
                                  <DataViewField label="Cidade / Estado" value={formDemand.hotelCity} icon={MapPin} />
                                  <DataViewField label="Hotel" value={formDemand.hotelName} icon={Building2} />
                                  <DataViewField label="Check-in" value={formDemand.hotelCheckIn ? new Date(formDemand.hotelCheckIn).toLocaleDateString() : ''} icon={Calendar} />
                                  <DataViewField label="Check-out" value={formDemand.hotelCheckOut ? new Date(formDemand.hotelCheckOut).toLocaleDateString() : ''} icon={Calendar} />
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
                                  <label className="block text-xs font-bold text-gray-500 uppercase">Lista da Turma (PDF)</label>
                                  {formDemand.attachments?.classListPdf ? (
                                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                                       <div className="flex items-center gap-2 overflow-hidden">
                                          <FileCheck size={18} className="text-blue-600 shrink-0" />
                                          <span className="text-xs font-bold text-slate-700 truncate">{formDemand.attachments.classListPdf.name}</span>
                                       </div>
                                       <button onClick={() => removePdf('classListPdf')} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                                    </div>
                                  ) : (
                                    <div className="relative group">
                                       <input type="file" accept=".pdf" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={e => e.target.files && handlePdfUpload('classListPdf', e.target.files[0])} />
                                       <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 group-hover:border-blue-400 group-hover:bg-blue-50/30 transition-all">
                                          <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                                          <span className="text-[10px] font-black uppercase text-slate-400">Anexar Lista de Presença</span>
                                       </div>
                                    </div>
                                  )}
                               </div>

                               {/* Liberação do Instrutor */}
                               <div className="space-y-3">
                                  <label className="block text-xs font-bold text-gray-500 uppercase">Liberação do Instrutor (PDF)</label>
                                  {formDemand.attachments?.instructorReleasePdf ? (
                                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                                       <div className="flex items-center gap-2 overflow-hidden">
                                          <FileCheck size={18} className="text-blue-600 shrink-0" />
                                          <span className="text-xs font-bold text-slate-700 truncate">{formDemand.attachments.instructorReleasePdf.name}</span>
                                       </div>
                                       <button onClick={() => removePdf('instructorReleasePdf')} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                                    </div>
                                  ) : (
                                    <div className="relative group">
                                       <input type="file" accept=".pdf" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={e => e.target.files && handlePdfUpload('instructorReleasePdf', e.target.files[0])} />
                                       <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 group-hover:border-blue-400 group-hover:bg-blue-50/30 transition-all">
                                          <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                                          <span className="text-[10px] font-black uppercase text-slate-400">Anexar Liberação</span>
                                       </div>
                                    </div>
                                  )}
                               </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                               <DataViewField 
                                  label="Lista da Turma" 
                                  value={formDemand.attachments?.classListPdf?.name} 
                                  isPdf={true} 
                                  onDownload={() => downloadPdf('classListPdf')} 
                               />
                               <DataViewField 
                                  label="Liberação do Instrutor" 
                                  value={formDemand.attachments?.instructorReleasePdf?.name} 
                                  isPdf={true} 
                                  onDownload={() => downloadPdf('instructorReleasePdf')} 
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
                                disabled={!isFormValid} 
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