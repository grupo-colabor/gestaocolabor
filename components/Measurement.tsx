
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../App';
import { Measurement, Demand, MeasurementStatus, ExpenseCategory, Attachment, OtherExpenseItem } from '../types';
import {
  getDemandTitle,
  getDemandCompanyLabel as getDemandCompanyLabelDomain,
  isInternalDemand,
} from '../domain/demandLabel';
import {
  computeMeasurementTotals,
  normalizeMeasurementBlocks,
  blockExpenseBreakdown,
} from '../domain/measurementTotals';
import { blockPanelHours, blockHoraAula } from '../domain/measurementTotals';
import { resolveDemandInstructors } from '../domain/demandInstructors';
import { usePagination } from '../hooks/usePagination';
import Pagination from './Pagination';
import { 
  Search, FileText, X, Filter, BarChart3, 
  ChevronDown, ChevronUp, MapPin, Truck, Home, 
  Calendar, Check, AlertCircle, Building, 
  Tag, Info, BookOpen, Clock, Mail, MessageCircle, 
  FileDown, Upload, ExternalLink, User, Plus, Paperclip, DollarSign, Wallet, CheckSquare, Square, RotateCcw,
  FileSpreadsheet, Moon
} from 'lucide-react';
import MedicaoExportModal from './MedicaoExportModal';
// Linha do item de despesa: UMA para as seis categorias. O layout dela não pode
// depender da largura da coluna que a hospeda — ver o comentário no arquivo.
import ExpenseItemRow from './measurement/ExpenseItemRow';
import { ExpenseSummaryCard } from './ui/ExpenseSummaryCard';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink } from 'docx';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
import { calculateDemandStatus } from '../domain/demandStatus';
import { isHybridModality } from '../domain/modalityRules';
import { demandIntersectsRange, isNightDemand, getDemandDays } from '../domain/demandDays';
import { companionDaysFromRows, companionDefaultHours } from '../domain/measurementOverrides';
import { supabase } from '../lib/supabase';
import { logAction } from '../services/auditLog';

const STAGE_LABELS: Record<MeasurementStatus, string> = {
  NAO_INICIADA: 'Não iniciada',
  LANCAMENTO: 'Em lançamento de despesas',
  CONFERENCIA: 'Em conferência',
  PRONTA_FATURAMENTO: 'Pronta para faturamento',
  FATURADA: 'Faturada'
};

const STAGE_OPTIONS = (Object.keys(STAGE_LABELS) as MeasurementStatus[]);

const STATUS_STYLING: Record<string, string> = {
  NOVA: 'bg-purple-100 text-purple-700',
  PENDENTE: 'bg-orange-100 text-orange-700',
  ALOCADA: 'bg-blue-100 text-blue-700',
  EM_ANDAMENTO: 'bg-indigo-100 text-indigo-700',
  CONCLUIDA: 'bg-green-100 text-green-700',
  CANCELADA: 'bg-red-100 text-red-700'
};

/**
 * Hora noturna vale mais e tem tarifa própria no Excel — o indicador deixa isso
 * visível na listagem e no cabeçalho do Painel de Medição (quem preenche o valor
 * manual precisa ver a condição sem voltar à listagem).
 * Regra única em domain/demandDays: fim >= 19:00 ou vira o dia.
 */
const NightBadge: React.FC<{ demand?: Demand | null }> = ({ demand }) => {
  if (!demand || !isNightDemand(demand)) return null;
  return (
    <span
      className="flex items-center gap-0.5 bg-indigo-950 text-indigo-100 border border-indigo-800 text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest shrink-0"
      title="Demanda noturna (término >= 19:00) — tarifa própria na aba Tarifas"
    >
      <Moon size={9} strokeWidth={2.5} /> N
    </span>
  );
};

const CategoryBlock = ({ 
  category, 
  label, 
  icon: Icon,
  colorClass,
  otherId,
  ownerId,
  obs,
  onObsChange,
  attachments,
  onUploadFile,
  onUpdateValue,
  onRemoveAttachment,
  onAddManualValue,
  showReembolsavel,
  onToggleReembolsavel
}: { 
  category: ExpenseCategory, 
  label: string, 
  icon: any,
  colorClass: string,
  otherId?: string,
  /**
   * Dono dos itens LANCADOS nesta instancia do bloco (medicao multi-pessoa).
   *
   * ⚠️ Nao e criterio de FILTRO: a lista ja chega particionada em `attachments`,
   * pela particao do dominio (normalizeMeasurementBlocks). Refiltrar aqui seria
   * uma segunda copia da regra de "item sem dono e do titular", e as duas
   * divergiriam. Ausente = painel de uma pessoa so, exatamente como hoje.
   */
  ownerId?: string,
  obs?: string,
  onObsChange?: (val: string) => void,
  attachments: Attachment[],
  onUploadFile: (cat: ExpenseCategory, oid?: string, instructorId?: string) => void,
  onUpdateValue: (id: string, val: string) => void,
  onRemoveAttachment: (id: string) => void,
  onAddManualValue: (cat: ExpenseCategory, oid?: string, instructorId?: string) => void,
  /**
   * Interna nao mostra o toggle: TODA despesa de interna e custo Colabor por
   * natureza, entao marcar item a item criaria um conceito duplicado. O custo
   * dela e capturado inteiro pelo card "Custo das Demandas Internas".
   */
  showReembolsavel?: boolean,
  onToggleReembolsavel?: (id: string) => void
}) => {
  const relevantAttachments = attachments.filter(a => 
    a.category === category && (otherId ? a.otherId === otherId : !a.otherId)
  ) || [];
  
  const formatCurrency = (val: number | string) => {
    const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
    if (isNaN(num)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  };

  const catTotal = relevantAttachments.reduce((acc, curr) => acc + (Number(typeof curr.value === 'string' ? curr.value.replace(',', '.') : curr.value) || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Icon size={14} className={colorClass} /> {label}
        </h3>
        <span className={`text-xs font-bold ${catTotal > 0 ? 'text-green-600' : 'text-slate-400'}`}>
          Total: {formatCurrency(catTotal)}
        </span>
      </div>

      {onObsChange && (
        <textarea 
          className="w-full border border-gray-100 rounded-lg px-3 py-2 text-[11px] focus:ring-2 focus:ring-blue-500 resize-none h-12 bg-slate-50/50" 
          placeholder={`Observações sobre ${label.toLowerCase()}...`}
          value={obs}
          onChange={e => onObsChange(e.target.value)}
        />
      )}

      <div className="space-y-2">
        {relevantAttachments.map(a => (
          <ExpenseItemRow
            key={a.id}
            attachment={a}
            onUpdateValue={onUpdateValue}
            onRemove={onRemoveAttachment}
            showReembolsavel={showReembolsavel}
            onToggleReembolsavel={onToggleReembolsavel}
          />
        ))}
        
        <div className="flex gap-2 mt-2">
          <button 
            onClick={() => onUploadFile(category, otherId, ownerId)}
            className="flex-1 py-2 border-2 border-dashed border-slate-100 rounded-xl flex items-center justify-center gap-2 text-slate-400 hover:text-blue-500 hover:border-blue-200 transition-all text-[9px] font-black uppercase tracking-widest"
          >
            <Upload size={14} /> Anexar Notinha
          </button>
          <button 
            onClick={() => onAddManualValue(category, otherId, ownerId)}
            className="px-4 py-2 border-2 border-dashed border-slate-100 rounded-xl flex items-center justify-center gap-2 text-slate-400 hover:text-emerald-500 hover:border-emerald-200 transition-all text-[9px] font-black uppercase tracking-widest"
            title="Adicionar valor sem arquivo"
          >
            <Plus size={14} /> Valor Avulso
          </button>
        </div>
      </div>
    </div>
  );
};

const MeasurementView: React.FC = () => {
  const {
    measurements, demands, companies, trainings, regions, instructors,
    updateMeasurement, updateDemand,
    demandParticipants, instructorAllocations, companionAllocations,
    notificationTarget, setNotificationTarget,
  } = useApp();

  const [filter, setFilter] = useState('');

  // Navegação a partir de Notificações
  useEffect(() => {
    if (notificationTarget?.view === 'measurement') {
      setFilter(notificationTarget.demandId);
      setNotificationTarget(null);
    }
  }, [notificationTarget]);
  const [advancedFilters, setAdvancedFilters] = useState({
    companyId: '',
    status: '',
    startDate: '',
    endDate: '',
    corredor: '',
    localidade: ''
  });

  const getCalculatedDemandStatus = (d: Demand) => calculateDemandStatus({
    startDate: d.startDate,
    endDate: d.endDate,
    instructorId: d.instructorId,
    cancelled: d.status === 'CANCELADA'
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMeasurement, setSelectedMeasurement] = useState<Measurement | null>(null);

  const [isExportSelectionOpen, setIsExportSelectionOpen] = useState(false);
  const [isMedicaoExportOpen, setIsMedicaoExportOpen] = useState(false);

  // Body scroll lock when any modal is open
  useEffect(() => {
    document.body.style.overflow = (isModalOpen || isExportSelectionOpen || isMedicaoExportOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isModalOpen, isExportSelectionOpen, isMedicaoExportOpen]);
  const [exportFilters, setExportFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    trainingId: '',
    instructorId: '',
    regionId: '',
    status: '' 
  });
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';

  // ⚠️ Demanda interna aparece SIM na medição (é trabalho pago ao instrutor
  // igual a qualquer outro) — o que ela não tem é treinamento, e a empresa é
  // opcional. As duas colunas são resolvidas a partir da demanda inteira, não
  // do id solto, senão as duas mostrariam 'N/A'.
  //
  // A regra vive em domain/demandLabel (as mesmas strings aparecem em
  // Logística, Controle Logístico e Agenda). Aqui ficam só os wrappers que
  // fecham sobre companies/trainings.
  const isInterna = (d?: Demand) => isInternalDemand(d);

  const getDemandCompanyLabel = (d?: Demand) => getDemandCompanyLabelDomain(d, companies, 'N/A');
  const getDemandTrainingLabel = (d?: Demand) => getDemandTitle(d, trainings, 'N/A');

  /**
   * Carga horária padrão da demanda para o campo Hora/Aula.
   * Cliente: horas do treinamento. Interna: horasPrevistas — é a única carga
   * que ela tem (mesma prioridade de `effectiveDemandHours` em instructorHours).
   */
  const getDemandDefaultHours = (d?: Demand): number => {
    if (isInterna(d)) {
      const previstas = Number(d?.horasPrevistas);
      return Number.isFinite(previstas) && previstas > 0 ? previstas : 0;
    }
    const t = d ? trainings.find(tr => tr.id === d.trainingId) : null;
    return typeof t?.hours === 'number' ? t.hours : Number((t as any)?.hours) || 0;
  };

  /**
   * Demanda HÍBRIDA: o default de horas vira PERGUNTA explícita.
   *
   * `training.hours` é a carga TOTAL (ex.: 40h), mas o split presencial/online
   * varia por demanda (8+32, 16+24...) e só quem mede sabe as horas presenciais
   * realizadas. Um campo aberto com "40h — Puxado do Treinamento" tem cara de
   * oficial, e quem esquece de corrigir paga a carga cheia (DEM-1556). Em
   * híbrida, portanto: campo vazio, carga total só como texto informativo, e o
   * hora/aula vale zero até alguém digitar. PRESENCIAL e ONLINE: zero mudança.
   *
   * A modalidade do TREINAMENTO prevalece sobre a da demanda, como no rateio.
   */
  const isHibrida = (d?: Demand): boolean => {
    if (!d || isInterna(d)) return false;
    const t = trainings.find(tr => tr.id === d.trainingId);
    return isHybridModality(t?.modality ?? d.modality);
  };
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';
  const getInstructorName = (id?: string) => instructors.find(i => i.id === id)?.name || 'Não Alocado';

  const formatCurrency = (val: number | string) => {
    const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
    if (isNaN(num)) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '---';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('pt-BR');
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr || !dateStr.includes('T')) return '---';
    return dateStr.split('T')[1]?.substring(0, 5) || '---';
  };

  const filteredMeasurements = useMemo(() => {
    return measurements.filter(m => {
      const d = demands.find(demand => demand.id === m.demandId);
      // FILTRO: Ignorar se a demanda não existe ou se está CANCELADA (exceto No-Show, que aparece na medição)
      if (!d) return false;
      if (d.status === 'CANCELADA' && d.cancelReason !== 'No-Show') return false;

      const matchesText =
        d.id.toLowerCase().includes(filter.toLowerCase()) ||
        (d.clientDemandId || '').toLowerCase().includes(filter.toLowerCase()) ||
        getDemandCompanyLabel(d).toLowerCase().includes(filter.toLowerCase()) ||
        getDemandTrainingLabel(d).toLowerCase().includes(filter.toLowerCase());

      if (!matchesText) return false;
      if (advancedFilters.companyId && d.companyId !== advancedFilters.companyId) return false;
      if (advancedFilters.status && m.status !== advancedFilters.status) return false;
      if (advancedFilters.corredor && (d.corredor ?? '') !== advancedFilters.corredor) return false;
      if (advancedFilters.localidade && (d.trainingLocal ?? '') !== advancedFilters.localidade) return false;
      // ✅ Filtro por período: suporta dias específicos
      if (advancedFilters.startDate || advancedFilters.endDate) {
        if (!demandIntersectsRange(d, advancedFilters.startDate || undefined, advancedFilters.endDate || undefined)) return false;
      }
      return true;
    }).sort((a, b) => {
        const d1 = demands.find(dm => dm.id === a.demandId);
        const d2 = demands.find(dm => dm.id === b.demandId);
        return (d2?.startDate || '').localeCompare(d1?.startDate || '');
    });
  }, [measurements, demands, filter, advancedFilters, companies, trainings]);

  const availableCorredores = useMemo(() =>
    [...new Set(
      measurements
        .map(m => demands.find(d => d.id === m.demandId))
        .filter((d): d is Demand => !!d && (d.status !== 'CANCELADA' || d.cancelReason === 'No-Show'))
        .map(d => d.corredor)
        .filter((v): v is string => !!v)
    )].sort(),
  [measurements, demands]);

  const availableLocalidades = useMemo(() =>
    [...new Set(
      measurements
        .map(m => demands.find(d => d.id === m.demandId))
        .filter((d): d is Demand => !!d && (d.status !== 'CANCELADA' || d.cancelReason === 'No-Show'))
        .map(d => d.trainingLocal)
        .filter((v): v is string => !!v && v !== 'N/A')
    )].sort(),
  [measurements, demands]);

  const {
    currentPage: measPage,
    totalPages: measTotalPages,
    itemsPerPage: measItemsPerPage,
    paginatedItems: paginatedMeasurements,
    startIdx: measStartIdx,
    setCurrentPage: setMeasPage,
    handleItemsPerPageChange: handleMeasItemsPerPage,
  } = usePagination<Measurement>(filteredMeasurements, 'pagination:measurement');

  const exportableList = useMemo(() => {
    return measurements.filter(m => {
      const d = demands.find(demand => demand.id === m.demandId);
      // FILTRO: Ignorar se a demanda não existe ou se está CANCELADA (exceto No-Show, que aparece na medição)
      if (!d) return false;
      if (d.status === 'CANCELADA' && d.cancelReason !== 'No-Show') return false;

      const currentDemandStatus = getCalculatedDemandStatus(d);

      if (exportFilters.companyId && d.companyId !== exportFilters.companyId) return false;
      if (exportFilters.trainingId && d.trainingId !== exportFilters.trainingId) return false;
      if (exportFilters.instructorId && d.instructorId !== exportFilters.instructorId) return false;
      if (exportFilters.regionId && d.regionId !== exportFilters.regionId) return false;
      
      if (exportFilters.status && currentDemandStatus !== exportFilters.status) return false;
      
      // ✅ Filtro por período (export): suporta dias específicos
      if (exportFilters.startDate || exportFilters.endDate) {
        if (!demandIntersectsRange(d, exportFilters.startDate || undefined, exportFilters.endDate || undefined)) return false;
      }

      return true;
    }).sort((a, b) => {
      const d1 = demands.find(dm => dm.id === a.demandId);
      const d2 = demands.find(dm => dm.id === b.demandId);
      return (d2?.startDate || '').localeCompare(d1?.startDate || '');
    });
  }, [measurements, demands, exportFilters, companies, trainings, instructors, regions]);

  // Delegado para domain/measurementTotals.ts: o card "Custo das Demandas
  // Internas" e o de "Despesas Nao Reembolsaveis" (Dashboard) precisam da mesma
  // conta. A forma de retorno segue igual para os consumidores locais.
  const getMeasurementTotals = (m: Measurement) => computeMeasurementTotals(m as any);

const totals = useMemo(() => {
  if (!selectedMeasurement) {
    return {
      hospedagem: 0,
      locomocao: 0,
      cafe: 0,
      almoco: 0,
      jantar: 0,
      outros: 0,
      hourClass: 0,
      total: 0
    };
  }

  // totais normais (despesas)
  const baseTotals = getMeasurementTotals(selectedMeasurement);

  // Hora/Aula
  //
  // Com blocos por pessoa a parcela é a SOMA dos blocos — por construção, já
  // que os blocos particionam os mesmos itens e cada um tem seu par
  // horas × valorHH. Sem blocos, é o classHours × hourRate de sempre.
  const blocosDaMedicao = (selectedMeasurement.expenses as any)?.participantes ?? [];
  const classHours =
    Number((selectedMeasurement.expenses as any)?.classHours ?? 0) || 0;

  const hourRate =
    Number((selectedMeasurement.expenses as any)?.hourRate ?? 0) || 0;

  // ⚠️ O total do topo tem de resolver o ausente do MESMO jeito que as seções,
  // senão a soma das pessoas não fecha com o TOTAL GERAL logo acima delas.
  //
  // A soma crua de `horas × valorHH` sobre o JSON (o que estava aqui) dava zero
  // para o titular, porque as horas dele NUNCA são gravadas enquanto não forem
  // editadas — e não ser gravado é o que protege o Excel do split por dias. Quem
  // sabe converter ausente em número é o domínio, por papel.
  const demandaDaMedicao = demands.find(d => d.id === selectedMeasurement.demandId);
  const cargaPadrao = classHours || getDemandDefaultHours(demandaDaMedicao);
  // Híbrida: ninguém herda a carga total; ausente vale zero até digitar.
  const ctxPainel = { demandDefaultHours: cargaPadrao, hibrida: isHibrida(demandaDaMedicao) };

  const hourClass = blocosDaMedicao.length
    ? normalizeMeasurementBlocks(selectedMeasurement as any, demandaDaMedicao?.instructorId).reduce(
        (acc: number, b) => acc + blockHoraAula(b, ctxPainel),
        0
      )
    : classHours * hourRate;

  return {
    ...baseTotals,
    hourClass,
    total: baseTotals.total + hourClass
  };
}, [selectedMeasurement, demands, trainings]);

  // ✅ Valores para a UI do bloco Hora/Aula (não dão erro de escopo)
  const classHours = Number((selectedMeasurement?.expenses as any)?.classHours ?? 0) || 0;
  const hourRate = Number((selectedMeasurement?.expenses as any)?.hourRate ?? 0) || 0;
  const hourClassTotal = classHours * hourRate;

  // Horas padrão da demanda selecionada (para reset e comparação).
  // Numa interna o "padrão" vem de horasPrevistas, não de um treinamento que
  // ela não tem — senão o botão de restaurar zeraria o campo.
  const _selDemand = demands.find(d => d.id === selectedMeasurement?.demandId);
  const _selIsInterna = isInterna(_selDemand);
  const _selIsHibrida = isHibrida(_selDemand);
  const trainingDefaultHours = getDemandDefaultHours(_selDemand);
  // Híbrida não tem "padrão" para comparar nem para restaurar: o campo vazio
  // é o estado esperado, e o botão de restaurar traria a carga cheia de volta.
  const isClassHoursEdited = !!selectedMeasurement && !_selIsHibrida && classHours !== trainingDefaultHours;

  /* ───────────────── MEDICAO POR PESSOA (F2 interna, F3 cliente) ─────────
   *
   * A lista de pessoas vem do CADASTRO, nunca do JSON da medicao — senao
   * alguem adicionado depois do primeiro save nunca apareceria:
   *
   *   • interna  → titular + participantes (`demand_participants`);
   *   • cliente  → titulares (resolveDemandInstructors, que pode devolver mais
   *                de um quando a demanda foi dividida por dias) + os
   *                acompanhantes distintos de `companion_allocations`.
   *
   * ⚠️ ITEM 7 DO ESCOPO: a lista sai VAZIA quando nao ha uma SEGUNDA CATEGORIA
   * de pessoa — interna sem participante, cliente sem acompanhante. Tudo o que
   * e novo na tela esta atras de `temBlocosPorPessoa`, entao esses casos
   * renderizam exatamente o que renderizavam antes.
   *
   * O corte e por acompanhante/participante, e nao por `length > 1`, de
   * proposito: demanda de cliente dividida entre dois titulares JA EXISTE aos
   * montes e continua abrindo o painel de sempre. Trocar o painel dela seria
   * mudar medicao de cliente sem acompanhante — exatamente o que o item 7
   * proibe.
   */
  const pessoasDaMedicao = useMemo(() => {
    if (!_selDemand) return [];

    const titulares = resolveDemandInstructors(
      _selDemand.id,
      _selDemand.instructorId,
      instructorAllocations
    )
      .map(t => t.instructorId)
      .filter(Boolean);

    if (isInterna(_selDemand)) {
      const participantes = demandParticipants.filter(p => p.demandId === _selDemand.id);
      if (participantes.length === 0) return [];

      // Interna continua com UM titular: ela nao tem split de dias.
      const titularId = _selDemand.instructorId || titulares[0];

      const lista: { instructorId: string; papel: 'TITULAR' | 'PARTICIPANTE' | 'ACOMPANHANTE' }[] = [];
      if (titularId) lista.push({ instructorId: titularId, papel: 'TITULAR' });
      for (const p of participantes) {
        // Guarda contra dado torto: participante que coincide com o titular nao
        // pode virar duas secoes (e dois pagamentos).
        if (p.instructorId && p.instructorId !== titularId) {
          lista.push({ instructorId: p.instructorId, papel: 'PARTICIPANTE' });
        }
      }
      return lista;
    }

    // --- cliente (F3) ---
    // Uma linha POR DIA em companion_allocations: a lista e de pessoas
    // distintas, senao um acompanhante de 3 dias viraria 3 secoes.
    const acompanhantes: string[] = [];
    const vistos = new Set<string>(titulares);
    for (const ca of companionAllocations || []) {
      if (ca.demandId !== _selDemand.id || !ca.instructorId) continue;
      // Quem ja e titular na demanda nao vira uma segunda secao (e um segundo
      // pagamento) por tambem ter linha de acompanhante.
      if (vistos.has(ca.instructorId)) continue;
      vistos.add(ca.instructorId);
      acompanhantes.push(ca.instructorId);
    }
    if (acompanhantes.length === 0) return [];

    const lista: { instructorId: string; papel: 'TITULAR' | 'PARTICIPANTE' | 'ACOMPANHANTE' }[] = [];
    for (const id of titulares) lista.push({ instructorId: id, papel: 'TITULAR' });
    for (const id of acompanhantes) lista.push({ instructorId: id, papel: 'ACOMPANHANTE' });
    return lista;
  }, [_selDemand, demandParticipants, instructorAllocations, companionAllocations]);

  /**
   * O default de horas de CADA pessoa — o placeholder do campo, nunca gravado.
   *
   * Titular e participante: a carga da demanda, como sempre. Acompanhante:
   * proporcional aos dias que ele acompanha, pela regra pura de
   * domain/measurementOverrides — a MESMA que o Excel aplica. Se as duas
   * divergirem, o número que o painel mostra deixa de ser o que a planilha paga.
   *
   * A carga usada como base segue a precedência do rateio (`effectiveDemandHours`):
   * `classHours` da medição quando informado, senão o padrão da demanda. A
   * divergência conhecida continua sendo a de sempre — em demanda HÍBRIDA o
   * `classHours` aberto com as horas cheias do treinamento passa na frente das
   * horas práticas; é anterior à F3 e vale para o titular do mesmo jeito.
   */
  const horasPadraoDaPessoa = (instructorId: string, papel: string): number => {
    const cargaDaDemanda = classHours || trainingDefaultHours;
    if (papel !== 'ACOMPANHANTE' || !_selDemand) return trainingDefaultHours;
    const diasDaDemanda = getDemandDays(_selDemand as any);
    const dias = companionDaysFromRows(
      (companionAllocations || [])
        .filter(ca => ca.demandId === _selDemand.id && ca.instructorId === instructorId)
        .map(ca => ({ demandId: ca.demandId, instructorId: ca.instructorId, startDate: ca.startDate })),
      diasDaDemanda
    );
    return companionDefaultHours(cargaDaDemanda, diasDaDemanda.length, dias.length);
  };

  /** Gate unico do que e novo na tela. Falso => painel identico ao de hoje. */
  const temBlocosPorPessoa = pessoasDaMedicao.length > 1;

  /**
   * As secoes renderizadas: a lista de PESSOAS cruzada com os blocos do JSON.
   *
   * A particao dos attachments vem de `normalizeMeasurementBlocks` (dominio),
   * e nao de um filtro reescrito aqui — e o que garante que a soma das secoes
   * feche com o total do topo, inclusive para item sem dono ou com dono que
   * saiu da demanda (os dois caem no titular).
   */
  const secoesPorPessoa = useMemo(() => {
    if (!selectedMeasurement || !temBlocosPorPessoa) return [];

    const titularId = pessoasDaMedicao.find(p => p.papel === 'TITULAR')?.instructorId;

    // Base para a particao: o que ja esta gravado, completado com as pessoas
    // que ainda nao tem bloco (participante recem-adicionado).
    const gravados = selectedMeasurement.expenses?.participantes ?? [];
    const paraNormalizar = {
      ...selectedMeasurement,
      expenses: {
        ...selectedMeasurement.expenses,
        participantes: pessoasDaMedicao.map(p => {
          const gravado = gravados.find(g => g.instructorId === p.instructorId);
          return gravado ?? { instructorId: p.instructorId, papel: p.papel };
        }),
      },
    };

    const blocos = normalizeMeasurementBlocks(paraNormalizar as any, titularId);

    return blocos.map((b, i) => {
      const papel = pessoasDaMedicao[i]?.papel ?? b.papel;
      // O papel da LISTA manda (o JSON pode ter sido gravado antes de a pessoa
      // mudar de papel), então a resolução de horas usa o bloco já corrigido.
      const comPapel = { ...b, papel };
      return {
        ...comPapel,
        nome: getInstructorName(b.instructorId),
        despesas: blockExpenseBreakdown(paraNormalizar as any, b),
        // Sugestão DESTA pessoa: acompanhante tem a proporcional aos dias.
        // Em híbrida é só a carga TOTAL informativa da legenda, nunca placeholder.
        horasPadrao: horasPadraoDaPessoa(b.instructorId, papel),
        // Híbrida: titular e participante NÃO herdam default (ver isHibrida).
        hibrida: _selIsHibrida,
        // O que o painel CONTA: titular e participante valem o padrão da
        // demanda sem ninguém digitar; acompanhante vale 0 até digitarem —
        // e em híbrida TODO papel vale 0 até digitarem.
        horasContadas: blockPanelHours(comPapel, {
          demandDefaultHours: classHours || trainingDefaultHours,
          hibrida: _selIsHibrida,
        }),
      };
    });
  }, [selectedMeasurement, temBlocosPorPessoa, pessoasDaMedicao, instructors, companionAllocations, trainingDefaultHours, classHours, _selIsHibrida]);

  /**
   * Grava um campo do bloco de UMA pessoa no estado local.
   *
   * ⚠️ `horas` so chega aqui quando o usuario DIGITA — o default aparece como
   * placeholder e nunca e gravado. Se fosse, toda interna com bloco trocaria o
   * rateio por horas-por-pessoa, e uma demanda de 16h dividida entre dois
   * instrutores passaria a pagar 32h. Ver domain/measurementOverrides.ts.
   */
  const setCampoDoBloco = (
    instructorId: string,
    campo: 'horas' | 'valorHH',
    valor: number | undefined
  ) => {
    setSelectedMeasurement(prev => {
      if (!prev) return prev;
      const atuais = prev.expenses?.participantes ?? [];
      const base = pessoasDaMedicao.map(p => {
        const g = atuais.find(x => x.instructorId === p.instructorId);
        return g ?? { instructorId: p.instructorId, papel: p.papel };
      });
      return {
        ...prev,
        expenses: {
          ...prev.expenses,
          participantes: base.map(b =>
            b.instructorId === instructorId
              ? // `undefined` APAGA a chave (campo limpo volta a "nao informado"),
                // em vez de virar 0.
                (() => {
                  const novo: any = { ...b };
                  if (valor === undefined) delete novo[campo];
                  else novo[campo] = valor;
                  return novo;
                })()
              : b
          ),
        },
      } as Measurement;
    });
  };


  const exportSummary = useMemo(() => {
    const selectedMeasurements = measurements.filter(m => selectedForExport.has(m.id));
    return selectedMeasurements.reduce((acc, m) => {
      const mTotals = getMeasurementTotals(m);
      return {
        count: acc.count + 1,
        hospedagem: acc.hospedagem + mTotals.hospedagem,
        locomocao: acc.locomocao + mTotals.locomocao,
        alimentacao: acc.alimentacao + (mTotals.cafe + mTotals.almoco + mTotals.jantar),
        total: acc.total + mTotals.total
      };
    }, { count: 0, hospedagem: 0, locomocao: 0, alimentacao: 0, total: 0 });
  }, [measurements, selectedForExport]);

  const handleOpenDetail = (m: Measurement) => {
  const d = demands.find(dm => dm.id === m.demandId);

  // Cliente: horas do treinamento. Interna: horasPrevistas — sem isso o campo
  // Hora/Aula abria vazio e o recibo saía zerado.
  // `|| undefined` (e não `?? `) de propósito: 0 precisa cair no undefined pra
  // não travar o campo em zero, igual ao comportamento anterior.
  const trainingHours = getDemandDefaultHours(d) || undefined;

  // Híbrida: NÃO pré-preenche. A carga total do treinamento não é o que foi
  // ministrado presencialmente; ela vira texto informativo ao lado do campo, e
  // o campo abre VAZIO até alguém digitar as horas presenciais realizadas.
  const horasIniciais = isHibrida(d) ? undefined : trainingHours;

  const next: Measurement = {
  ...m,
  expenses: {
    // ⚠️ ESTE SPREAD É A CORREÇÃO DO "VALOR HH NÃO SALVA".
    //
    // Este objeto era uma LISTA BRANCA: só os campos citados abaixo sobreviviam
    // à reabertura. `participantes` (horas e valorHH de cada pessoa) ficava de
    // fora e sumia do estado — o painel reabria com todo mundo zerado, e o save
    // seguinte reconstruía os blocos a partir de uma lista vazia e APAGAVA no
    // banco o que estava gravado certo. O dado nunca deixou de ser escrito; ele
    // era descartado na volta.
    //
    // Lista branca não escala: todo campo novo do jsonb nasce quebrado aqui. O
    // spread inverte o default — o que existe sobrevive, e as linhas abaixo
    // continuam garantindo os obrigatórios.
    ...(m.expenses ?? {}),

    // ✅ garante os campos obrigatórios SEMPRE
    breakfast: m.expenses?.breakfast ?? '',
    lunch: m.expenses?.lunch ?? '',
    dinner: m.expenses?.dinner ?? '',
    transport: m.expenses?.transport ?? '',
    others: m.expenses?.others ?? '',

    // ✅ novos campos
    classHours: m.expenses?.classHours ?? horasIniciais,
    hourRate: m.expenses?.hourRate ?? undefined
  }
};
  setSelectedMeasurement(next);
  setIsModalOpen(true);
};


  const handleSaveMeasurement = () => {
    if (selectedMeasurement) {
      /**
       * HÍBRIDA: valor hora/aula preenchido e horas presenciais em branco é
       * quase sempre esquecimento — e aqui não existe default que disfarce: o
       * hora/aula da pessoa fica ZERADO. Pergunta ANTES de gravar, mas não
       * bloqueia ("ainda não sei as horas" é um estado legítimo de conferência).
       * Acompanhante já é manual e tem o aviso próprio logo abaixo.
       */
      if (_selIsHibrida) {
        const semHorasPresenciais = temBlocosPorPessoa
          ? secoesPorPessoa
              .filter(x => x.papel !== 'ACOMPANHANTE' && !x.horasInformadas && x.valorHH > 0)
              .map(x => x.nome)
          : hourRate > 0 && !classHours
            ? [getInstructorName(_selDemand?.instructorId)]
            : [];

        if (semHorasPresenciais.length > 0) {
          const continuar = window.confirm(
            `Horas presenciais não informadas (${semHorasPresenciais.join(', ')}) — ` +
            `o hora/aula desta pessoa ficará zerado. Continuar?`
          );
          if (!continuar) return;
        }
      }

      /**
       * Blocos por pessoa: gravados APENAS quando a demanda tem mais de uma
       * pessoa. Numa medicao de cliente ou de interna sem participante a chave
       * nem aparece no JSON — e o que mantem o dado gravado hoje byte a byte
       * igual ao de antes da F2.
       *
       * ⚠️ `horas` sai daqui como veio do estado: presente so se o usuario
       * digitou (setCampoDoBloco APAGA a chave quando o campo e limpo). Gravar
       * o default faria toda interna com bloco trocar o rateio por
       * horas-por-pessoa — uma demanda de 16h dividida entre dois instrutores
       * passaria a pagar 32h.
       */
      const participantesParaGravar = (() => {
        if (!temBlocosPorPessoa) return undefined;
        const atuais = selectedMeasurement.expenses?.participantes ?? [];
        return pessoasDaMedicao.map(p => {
          const g = atuais.find(x => x.instructorId === p.instructorId);
          const bloco: any = { instructorId: p.instructorId, papel: p.papel };
          if (g && g.horas !== undefined && g.horas !== null) bloco.horas = Number(g.horas);
          if (g && g.valorHH !== undefined && g.valorHH !== null) bloco.valorHH = Number(g.valorHH);
          return bloco;
        });
      })();

      const cleaned = {
        ...selectedMeasurement,
        expenses: {
          ...selectedMeasurement.expenses,
          ...(participantesParaGravar ? { participantes: participantesParaGravar } : {}),
        },
        attachments: selectedMeasurement.attachments.map(a => ({
          ...a,
          value: typeof a.value === 'string' ? (parseFloat(a.value.replace(',', '.')) || 0) : a.value
        }))
      };
      const _beforeMeasurement = measurements.find(m => m.id === selectedMeasurement.id);
      updateMeasurement(cleaned);
      {
        const _dem = demands.find(d => d.id === selectedMeasurement.demandId);
        const _totalsAfter = getMeasurementTotals(cleaned);
        const _totalsBefore = _beforeMeasurement ? getMeasurementTotals(_beforeMeasurement) : null;
        const _expB = (_beforeMeasurement?.expenses as any) ?? {};
        const _expA = (cleaned.expenses as any) ?? {};
        const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

        const _diffParts: string[] = [];
        if ((_expB.classHours ?? '') !== (_expA.classHours ?? ''))
          _diffParts.push(`Horas: ${_expB.classHours ?? '—'} → ${_expA.classHours ?? '—'}h`);
        if ((_expB.hourRate ?? '') !== (_expA.hourRate ?? ''))
          _diffParts.push(`Valor hora/aula: ${_expB.hourRate ?? '—'} → ${_expA.hourRate ?? '—'}`);

        // Diff POR PESSOA. Sem isto o log ficaria cego justamente na medição
        // multi-pessoa: classHours/hourRate não mudam quando o que foi editado
        // é o bloco de alguém. Em medição de uma pessoa só os dois lados são
        // vazios e nada é acrescentado — o log sai idêntico ao de hoje.
        {
          const _blocosB: any[] = _expB.participantes ?? [];
          const _blocosA: any[] = _expA.participantes ?? [];
          const _ids = [...new Set([..._blocosB, ..._blocosA].map(b => b?.instructorId).filter(Boolean))];
          for (const _id of _ids) {
            const _b = _blocosB.find(x => x?.instructorId === _id);
            const _a = _blocosA.find(x => x?.instructorId === _id);
            const _nome = getInstructorName(_id);
            if (!_b && _a) { _diffParts.push(`Bloco adicionado: ${_nome}`); continue; }
            if (_b && !_a) { _diffParts.push(`Bloco removido: ${_nome}`); continue; }
            // '—' e não 0 para o ausente: "não informado" não é "zero horas".
            const _h = (v: any) => (v === undefined || v === null ? '—' : String(v));
            if (_h(_b?.horas) !== _h(_a?.horas))
              _diffParts.push(`${_nome} — horas: ${_h(_b?.horas)} → ${_h(_a?.horas)}`);
            if (_h(_b?.valorHH) !== _h(_a?.valorHH))
              _diffParts.push(`${_nome} — valor hora/aula: ${_h(_b?.valorHH)} → ${_h(_a?.valorHH)}`);
          }
        }
        if (_totalsBefore && _totalsBefore.hospedagem !== _totalsAfter.hospedagem)
          _diffParts.push(`Hospedagem: ${fmt(_totalsBefore.hospedagem)} → ${fmt(_totalsAfter.hospedagem)}`);
        if (_totalsBefore && _totalsBefore.locomocao !== _totalsAfter.locomocao)
          _diffParts.push(`Locomoção: ${fmt(_totalsBefore.locomocao)} → ${fmt(_totalsAfter.locomocao)}`);
        if (_totalsBefore && _totalsBefore.cafe !== _totalsAfter.cafe)
          _diffParts.push(`Café da manhã: ${fmt(_totalsBefore.cafe)} → ${fmt(_totalsAfter.cafe)}`);
        if (_totalsBefore && _totalsBefore.almoco !== _totalsAfter.almoco)
          _diffParts.push(`Almoço: ${fmt(_totalsBefore.almoco)} → ${fmt(_totalsAfter.almoco)}`);
        if (_totalsBefore && _totalsBefore.jantar !== _totalsAfter.jantar)
          _diffParts.push(`Jantar: ${fmt(_totalsBefore.jantar)} → ${fmt(_totalsAfter.jantar)}`);
        if (_totalsBefore && _totalsBefore.outros !== _totalsAfter.outros)
          _diffParts.push(`Outras despesas: ${fmt(_totalsBefore.outros)} → ${fmt(_totalsAfter.outros)}`);
        if (_totalsBefore && _totalsBefore.total !== _totalsAfter.total)
          _diffParts.push(`Subtotal: ${fmt(_totalsBefore.total)} → ${fmt(_totalsAfter.total)}`);
        if (_beforeMeasurement?.status !== cleaned.status)
          _diffParts.push(`Etapa: ${_beforeMeasurement?.status ?? '—'} → ${cleaned.status}`);

        const _hourClassTotal = (_expA.classHours ?? 0) * (_expA.hourRate ?? 0);

        logAction({
          modulo: 'Medição',
          acao: 'Registrar',
          descricao: [
            `Medição registrada`,
            _dem ? `Empresa: ${getDemandCompanyLabel(_dem)}` : null,
            _dem ? `Treinamento: ${getDemandTrainingLabel(_dem)}` : `Demanda ID ${selectedMeasurement.demandId}`,
            _expA.classHours != null ? `Horas: ${_expA.classHours}h` : null,
            _expA.hourRate != null ? `Valor hora/aula: ${_expA.hourRate}` : null,
            _hourClassTotal ? `Total hora/aula: ${fmt(_hourClassTotal)}` : null,
            `Subtotal: ${fmt(_totalsAfter.total)}`,
            _diffParts.length ? `Alterações: ${_diffParts.join(' | ')}` : null,
          ].filter(Boolean).join(' | '),
          dadosAntes: _beforeMeasurement ?? undefined,
          dadosDepois: cleaned,
        });
      }

      const demand = demands.find(d => d.id === selectedMeasurement.demandId);
      if (demand) {
        // A regra de negócio aqui permanece: salvando a medição, a demanda é considerada concluída
        updateDemand({ ...demand, status: 'CONCLUIDA' });
      }

      /**
       * AVISAR, NÃO BLOQUEAR — o padrão da casa.
       *
       * Acompanhante com valor hora/aula preenchido e horas em branco é quase
       * sempre esquecimento: alguém digitou quanto vale a hora dele e não disse
       * quantas foram. Como o Excel se recusa a inventar horas, essa pessoa
       * simplesmente não sai na planilha — sem nenhum sinal, se não for este.
       *
       * Não bloqueia porque "ainda não sei as horas" é um estado legítimo de
       * uma medição em conferência. O save já aconteceu quando este aviso
       * aparece.
       */
      const acompanhantesSemHoras = temBlocosPorPessoa
        ? secoesPorPessoa.filter(
            x => x.papel === 'ACOMPANHANTE' && !x.horasInformadas && x.valorHH > 0
          )
        : [];

      if (acompanhantesSemHoras.length > 0) {
        const nomes = acompanhantesSemHoras.map(x => x.nome).join(', ');
        alert(
          `Medição salva.\n\nAtenção: ${nomes} ${acompanhantesSemHoras.length > 1 ? 'estão' : 'está'} ` +
          `como acompanhante com valor hora/aula preenchido, mas sem horas informadas — ` +
          `e acompanhante sem horas NÃO entra na planilha de pagamento.\n\n` +
          `Se for para pagar, reabra a medição e informe as horas.`
        );
      }

      setIsModalOpen(false);
    }
  };

  const BUCKET = 'measurement-attachments';

const sanitizeFileName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_');

const handleUploadFile = (category: ExpenseCategory, otherId?: string, instructorId?: string) => {
  if (!selectedMeasurement) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.multiple = true;

  input.onchange = async (e: any) => {
    const files: FileList | null = e.target.files;
    if (!files || !selectedMeasurement) return;

    const demandId = selectedMeasurement.demandId;

    for (const f of Array.from(files)) {
      try {
        // id estável pro anexo
        const attachmentId = `FILE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const safeName = sanitizeFileName(f.name);

        // path organizado por demanda
        const path = `measurements/${demandId}/${attachmentId}-${safeName}`;

        // ✅ upload no Storage
        const { error: uploadError } = await supabase
          .storage
          .from(BUCKET)
          .upload(path, f, {
            contentType: f.type,
            upsert: false
          });

        if (uploadError) {
          console.error('[Storage] upload error:', uploadError);
          alert(`Falha ao subir arquivo: ${uploadError.message}`);
          continue;
        }

        // ✅ URL para preview (escolha uma das opções abaixo)

        // OPÇÃO 1: bucket PUBLIC
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const fileUrl = pub?.publicUrl || '#';

        // OPÇÃO 2: bucket PRIVATE (use signed URL)
        // const { data: signed, error: signedError } = await supabase
        //   .storage
        //   .from(BUCKET)
        //   .createSignedUrl(path, 60 * 60); // 1h
        // const fileUrl = signedError ? '#' : (signed?.signedUrl || '#');

        const newAttachment: Attachment = {
          id: attachmentId,
          name: f.name,
          url: fileUrl,

          // 🚫 NÃO guardar base64:
          // data: ...

          type: f.type,
          date: new Date().toISOString(),
          category,
          value: '',
          otherId,
          // Dono do item. `undefined` no painel de uma pessoa so (v1) — e o que
          // mantem o JSON de cliente e de interna sem participante byte a byte
          // igual ao de hoje.
          ...(instructorId ? { instructorId } : {}),

          // ✅ campos novos (você pode manter em jsonb sem mexer no schema)
          bucket: BUCKET as any,
          path: path as any,
          size: (f as any).size
        };

        setSelectedMeasurement(prev =>
          prev
            ? { ...prev, attachments: [...prev.attachments, newAttachment] }
            : null
        );
      } catch (err) {
        console.error('[Storage] upload exception:', err);
        alert('Erro inesperado ao subir arquivo.');
      }
    }
  };

  input.click();
};


  const handleAddManualValue = (category: ExpenseCategory, otherId?: string, instructorId?: string) => {
    if (!selectedMeasurement) return;
    const newAttachment: Attachment = {
      id: `VAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: 'Lançamento Avulso',
      url: '#',
      type: 'text/plain',
      date: new Date().toISOString(),
      category,
      value: '',
      otherId,
      // Ver a nota em handleUploadFile: ausente no caminho de uma pessoa so.
      ...(instructorId ? { instructorId } : {}),
    };
    setSelectedMeasurement(prev => prev ? {
      ...prev,
      attachments: [...prev.attachments, newAttachment]
    } : null);
  };

  /**
   * Alterna "o cliente reembolsa este item?". So altera o item; o valor
   * continua contando no total e na categoria — nao reembolsavel e recorte,
   * nao subtracao. Persiste junto com o resto no Salvar (jsonb attachments).
   */
  const handleToggleReembolsavel = (id: string) => {
    if (!selectedMeasurement) return;
    setSelectedMeasurement({
      ...selectedMeasurement,
      attachments: selectedMeasurement.attachments.map(a =>
        a.id === id ? { ...a, reembolsavel: a.reembolsavel === false } : a
      ),
    });
  };

  const handleUpdateAttachmentValue = (id: string, value: string) => {
    if (!selectedMeasurement) return;
    setSelectedMeasurement({
      ...selectedMeasurement,
      attachments: selectedMeasurement.attachments.map(a => a.id === id ? { ...a, value: value } : a)
    });
  };

  const handleRemoveAttachment = async (id: string) => {
    if (!selectedMeasurement) return;

    const attachment = selectedMeasurement.attachments.find(a => a.id === id);
    if (!attachment) return;

    // 🔥 1. Se veio do Storage, remove o arquivo físico
    if (attachment.path && attachment.bucket) {
      const { error } = await supabase
        .storage
        .from(attachment.bucket)
        .remove([attachment.path]);

      if (error) {
        console.error('[Storage] erro ao deletar arquivo:', error);
        alert('Erro ao excluir arquivo do Storage.');
        return; // ❗ não remove do state se falhar
      }
    }

    // 🧠 2. Remove do state (UI)
    setSelectedMeasurement(prev =>
      prev
        ? {
            ...prev,
            attachments: prev.attachments.filter(a => a.id !== id)
          }
        : prev
    );
  };


  const handleAddOtherExpense = () => {
    if (!selectedMeasurement) return;
    const newItem: OtherExpenseItem = {
      id: `OTH-${Date.now()}`,
      description: '',
      value: '0'
    };
    setSelectedMeasurement({
      ...selectedMeasurement,
      otherExpenses: [...selectedMeasurement.otherExpenses, newItem]
    });
  };

  const handleRemoveOtherExpense = async (id: string) => {
    if (!selectedMeasurement) return;

    // 🔥 Remove arquivos do storage antes de limpar do state
    const attachmentsToRemove = selectedMeasurement.attachments.filter(a => a.otherId === id);
    for (const att of attachmentsToRemove) {
      if (att.path && att.bucket) {
        const { error } = await supabase.storage.from(att.bucket).remove([att.path]);
        if (error) console.error('[Storage] erro ao deletar arquivo de despesa extra:', error);
      }
    }

    setSelectedMeasurement({
      ...selectedMeasurement,
      otherExpenses: selectedMeasurement.otherExpenses.filter(o => o.id !== id),
      attachments: selectedMeasurement.attachments.filter(a => a.otherId !== id)
    });
  };

  const handleUpdateOtherExpense = (id: string, field: 'description' | 'value', value: string) => {
    if (!selectedMeasurement) return;
    setSelectedMeasurement({
      ...selectedMeasurement,
      otherExpenses: selectedMeasurement.otherExpenses.map(o => o.id === id ? { ...o, [field]: value } : o)
    });
  };


  const base64ToUint8Array = (base64String: string) => {
    const base64Content = base64String.split(',')[1];
    const binaryString = window.atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const urlToUint8Array = async (url: string) => {
  const safeUrl = encodeURI(url);
  const res = await fetch(safeUrl);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
};

  const pdfToImageBytes = async (url: string): Promise<{ bytes: Uint8Array; width: number; height: number }[]> => {
    const safeUrl = encodeURI(url);
    const pdf = await pdfjsLib.getDocument(safeUrl).promise;
    const pages: { bytes: Uint8Array; width: number; height: number }[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx as any, viewport, canvas } as any).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
      pages.push({ bytes, width: Math.round(viewport.width), height: Math.round(viewport.height) });
    }
    return pages;
  };


  const createDemandDocSection = async (m: Measurement) => {
  const d = demands.find(demand => demand.id === m.demandId);
  if (!d) return [];

  const demandTotals = getMeasurementTotals(m);

  // ✅ Hora/Aula (vem de expenses)
  const classHours = Number((m.expenses as any)?.classHours ?? 0) || 0;
  const hourRate = Number((m.expenses as any)?.hourRate ?? 0) || 0;
  const hourClassTotal = classHours * hourRate;

  // ✅ total geral considerando Hora/Aula
  //
  // Com blocos por pessoa a parcela é a soma deles (mesma conta do painel);
  // sem blocos, o classHours × hourRate de sempre.
  const _blocosParaTotal = (m.expenses as any)?.participantes ?? [];
  // Mesma resolução do painel — este documento é o recibo que a pessoa assina,
  // e ele não pode dizer R$ 0,00 onde a tela disse outra coisa.
  const cargaDoDoc = classHours || getDemandDefaultHours(d);
  // Híbrida: sem default — o recibo diz "não informado", nunca a carga total.
  const hibridaDoc = isHibrida(d);
  const ctxDoc = { demandDefaultHours: cargaDoDoc, hibrida: hibridaDoc };
  const horaAulaDoDoc = _blocosParaTotal.length
    ? normalizeMeasurementBlocks(m as any, d.instructorId).reduce(
        (acc: number, b) => acc + blockHoraAula(b, ctxDoc),
        0
      )
    : hourClassTotal;
  const totalWithHourClass = demandTotals.total + horaAulaDoDoc;

  // Interna: no título entra o nome da empresa quando houver, senão 'Colabor'.
  // (O rótulo da listagem usa 'Colabor (Interna)'; no cabeçalho do Word o
  // sufixo é redundante, já que a linha de baixo diz Categoria.)
  const isInternaDoc = isInterna(d);
  const companyName = isInternaDoc
    ? (companies.find(c => c.id === d.companyId)?.name || 'Colabor')
    : getCompanyName(d.companyId);
  const trainingName = getDemandTrainingLabel(d);
  const instructorName = getInstructorName(d.instructorId);

  const children: any[] = [
    new Paragraph({
      text: `DEMANDA: ${d.id} - ${companyName}`,
      heading: HeadingLevel.HEADING_2,
      border: { bottom: { color: "e2e8f0", space: 1, style: BorderStyle.SINGLE, size: 6 } },
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: isInternaDoc ? '🏷️ Categoria: ' : '🎓 Treinamento: ', bold: true }),
        new TextRun(trainingName),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: "📅 Período: ", bold: true }), new TextRun(`${formatDateTime(d.startDate)} até ${formatDateTime(d.endDate)}`)] }),
    new Paragraph({ children: [new TextRun({ text: "📍 Localidade: ", bold: true }), new TextRun(d.trainingLocal || 'N/A')] }),
    new Paragraph({ children: [new TextRun({ text: "👨‍🏫 Instrutor: ", bold: true }), new TextRun(instructorName)] }),
    new Paragraph({ spacing: { after: 200 } }),
  ];

  const categories: { key: ExpenseCategory; label: string; details?: string }[] = [
    { key: 'HOSPEDAGEM', label: '🏨 HOSPEDAGEM', details: d.accommodationType === 'N/A' ? 'Sem hospedagem registrada' : `${d.hotelName} (${d.hotelCity})` },
    { key: 'LOCOMOCAO', label: '🚗 LOCOMOÇÃO', details: d.transportType === 'N/A' ? 'Sem locomoção registrada' : `${d.transportType} (${d.rentalCompany})` },
    { key: 'CAFE', label: '☕ CAFÉ DA MANHÃ' },
    { key: 'ALMOCO', label: '🍛 ALMOÇO' },
    { key: 'JANTAR', label: '🍽️ JANTAR' },
  ];

  for (const cat of categories) {
    const attachments = m.attachments.filter(a => a.category === cat.key && !a.otherId);
    const totalCat = attachments.reduce((acc, curr) => acc + (Number(typeof curr.value === 'string' ? curr.value.replace(',', '.') : curr.value) || 0), 0);

    children.push(new Paragraph({ text: cat.label, heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }));
    if (cat.details) {
      children.push(new Paragraph({ children: [new TextRun({ text: "Info: ", italics: true }), new TextRun(cat.details)] }));
    }

    if (attachments.length > 0) {
      for (const a of attachments) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `• ${a.name}: `, bold: true }),
              new TextRun(formatCurrency(a.value)),
            ],
          })
        );

        // ✅ IMAGEM via URL (Storage)
        if (a.type?.startsWith('image/')) {
          try {
            // prioridade: url (Storage). fallback: base64 antigo (se existir)
            if (a.url && a.url !== '#') {
              const bytes = await urlToUint8Array(a.url);
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      data: bytes,
                      transformation: { width: 400, height: 300 },
                    } as any),
                  ],
                  spacing: { before: 100, after: 100 },
                })
              );
            } else if ((a as any).data) {
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      data: base64ToUint8Array((a as any).data),
                      transformation: { width: 400, height: 300 },
                    } as any),
                  ],
                  spacing: { before: 100, after: 100 },
                })
              );
            } else {
              children.push(new Paragraph({ children: [new TextRun({ text: "(Imagem sem URL disponível)", italics: true, color: "64748b" })] }));
            }
          } catch (err) {
            children.push(new Paragraph({ children: [new TextRun({ text: "[Erro ao carregar imagem do Storage]", italics: true, color: "FF0000" })] }));
          }
        } else if (a.type === 'application/pdf' && a.url && a.url !== '#') {
          try {
            const pages = await pdfToImageBytes(a.url);
            for (const pg of pages) {
              const maxW = 480;
              const ratio = maxW / pg.width;
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({ data: pg.bytes, transformation: { width: maxW, height: Math.round(pg.height * ratio) } } as any)],
                  spacing: { before: 100, after: 60 },
                })
              );
            }
          } catch {
            // fallback: só link
          }
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ExternalHyperlink({ children: [new TextRun({ text: `Ver PDF original: ${a.name}`, style: 'Hyperlink' })], link: a.url })],
              spacing: { after: 100 },
            })
          );
        }
      }

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `TOTAL ${cat.label.split(' ')[1]}: `, bold: true }),
            new TextRun(formatCurrency(totalCat)),
          ],
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Nenhuma despesa ou comprovante registrado nesta categoria.",
              italics: true,
              color: "94a3b8",
            }),
          ],
        })
      );
    }
  }

  // ✅ Bloco Hora/Aula no Word (aparece no relatório)
  //
  // Com blocos por pessoa vira UMA SEÇÃO POR PESSOA — é o recibo que cada uma
  // assina, e um total agregado não serve para isso. Sem blocos, sai
  // exatamente o parágrafo de sempre.
  const blocosDoDoc = (m.expenses as any)?.participantes ?? [];

  if (blocosDoDoc.length > 0) {
    const blocos = normalizeMeasurementBlocks(m as any, d.instructorId);

    children.push(
      new Paragraph({ text: "💰 PAGAMENTO POR PESSOA", heading: HeadingLevel.HEADING_3, spacing: { before: 200 } })
    );

    for (const b of blocos) {
      const nomePessoa = getInstructorName(b.instructorId);
      const papel = b.papel === 'TITULAR' ? 'Titular' : b.papel === 'ACOMPANHANTE' ? 'Acompanhante' : 'Participante';
      const horasDaPessoa = blockPanelHours(b, ctxDoc);
      const horaAulaPessoa = horasDaPessoa * b.valorHH;
      const despesasPessoa = blockExpenseBreakdown(m as any, b);

      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${nomePessoa} — ${papel}`, bold: true, size: 24 })],
          spacing: { before: 200, after: 60 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Horas: ", bold: true }),
            // Ausente NÃO é zero — mas resolve diferente por papel. Titular e
            // participante valem o padrão da demanda (e o recibo diz de onde
            // veio); acompanhante é manual, e aí "não informado" é a verdade:
            // ele não entra na planilha de pagamento até alguém preencher.
            new TextRun(
              b.horasInformadas
                ? String(b.horas)
                : b.papel === 'ACOMPANHANTE' || hibridaDoc
                  // Híbrida idem: a carga total do treinamento NUNCA sai como
                  // horas realizadas de ninguém.
                  ? 'não informado'
                  : `${horasDaPessoa} (padrão da demanda)`
            ),
          ],
        }),
        new Paragraph({ children: [new TextRun({ text: "Valor Hora/Aula: ", bold: true }), new TextRun(formatCurrency(b.valorHH))] }),
        new Paragraph({ children: [new TextRun({ text: "Total Hora/Aula: ", bold: true }), new TextRun(formatCurrency(horaAulaPessoa))] }),
        new Paragraph({
          children: [
            new TextRun({ text: "Despesas: ", bold: true }),
            new TextRun(
              `Hospedagem ${formatCurrency(despesasPessoa.hospedagem)} | ` +
              `Locomoção ${formatCurrency(despesasPessoa.locomocao)} | ` +
              `Alimentação ${formatCurrency(despesasPessoa.alimentacao)} | ` +
              `Outros ${formatCurrency(despesasPessoa.outros)}`
            ),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "TOTAL DA PESSOA: ", bold: true }),
            new TextRun(formatCurrency(horaAulaPessoa + despesasPessoa.total)),
          ],
          spacing: { after: 120 },
        })
      );
    }

    children.push(new Paragraph({ spacing: { after: 200 } }));
  } else {
    children.push(
      new Paragraph({ text: "💰 HORA/AULA", heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }),
      new Paragraph({
        children: [
          new TextRun({ text: isInternaDoc ? 'Horas da Demanda: ' : hibridaDoc ? 'Horas presenciais: ' : 'Horas do Treinamento: ', bold: true }),
          // Híbrida sem horas digitadas: "não informado", nunca a carga total.
          new TextRun(hibridaDoc && !classHours ? 'não informado' : String(classHours)),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: "Valor Hora/Aula: ", bold: true }), new TextRun(formatCurrency(hourRate))] }),
      new Paragraph({ children: [new TextRun({ text: "TOTAL HORA/AULA: ", bold: true }), new TextRun(formatCurrency(hourClassTotal))] }),
      new Paragraph({ spacing: { after: 200 } })
    );
  }

  if (m.otherExpenses.length > 0) {
    children.push(new Paragraph({ text: "➕ OUTRAS DESPESAS", heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }));

    for (const o of m.otherExpenses) {
      const atts = m.attachments.filter(a => a.otherId === o.id);
      const totalOth = atts.reduce((acc, curr) => acc + (Number(typeof curr.value === 'string' ? curr.value.replace(',', '.') : curr.value) || 0), 0);

      children.push(new Paragraph({ children: [new TextRun({ text: `${o.description || 'Despesa Extra'}: `, bold: true }), new TextRun(formatCurrency(totalOth))] }));

      for (const a of atts) {
        if (a.type?.startsWith('image/')) {
          try {
            if (a.url && a.url !== '#') {
              const bytes = await urlToUint8Array(a.url);
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({ data: bytes, transformation: { width: 400, height: 300 } } as any),
                  ],
                })
              );
            } else if ((a as any).data) {
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({ data: base64ToUint8Array((a as any).data), transformation: { width: 400, height: 300 } } as any),
                  ],
                })
              );
            }
          } catch (err) {
            children.push(new Paragraph({ children: [new TextRun({ text: "[Erro ao carregar imagem do Storage]", italics: true, color: "FF0000" })] }));
          }
        } else if (a.type === 'application/pdf' && a.url && a.url !== '#') {
          try {
            const pages = await pdfToImageBytes(a.url);
            for (const pg of pages) {
              const maxW = 480;
              const ratio = maxW / pg.width;
              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({ data: pg.bytes, transformation: { width: maxW, height: Math.round(pg.height * ratio) } } as any)],
                  spacing: { before: 100, after: 60 },
                })
              );
            }
          } catch {
            // fallback: só link
          }
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ExternalHyperlink({ children: [new TextRun({ text: `Ver PDF original: ${a.name}`, style: 'Hyperlink' })], link: a.url })],
              spacing: { after: 100 },
            })
          );
        }
      }
    }

    children.push(new Paragraph({ children: [new TextRun({ text: "TOTAL OUTROS: ", bold: true }), new TextRun(formatCurrency(demandTotals.outros))] }));
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 300, after: 300 },
      children: [
        new TextRun({
          // ✅ total final com Hora/Aula
          text: `TOTAL GERAL DEMANDA ${d.id}: ${formatCurrency(totalWithHourClass)}`,
          bold: true,
        }),
      ],
    })
  );

  return children;
};


  const handleConfirmExport = async () => {
  if (selectedForExport.size === 0) {
    alert('Selecione pelo menos uma demanda para exportar.');
    return;
  }

  const selectedMeasurements = measurements.filter(m =>
    selectedForExport.has(m.id)
  );

  // 🔹 Como createDemandDocSection agora é async,
  // precisamos resolver tudo antes de montar o DOC
  const sectionsArr = await Promise.all(
    selectedMeasurements.map(m => createDemandDocSection(m))
  );

  const allChildren = sectionsArr.flat();

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: "📊 RELATÓRIO CONSOLIDADO DE MEDIÇÕES",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `Gerado em: ${new Date().toLocaleString('pt-BR')} | Total de demandas exportadas: ${selectedMeasurements.length}`,
                italics: true,
                color: "64748b",
                size: 20,
              }),
            ],
            spacing: { after: 600 },
          }),

          // ✅ aqui entram TODAS as seções com imagens já resolvidas
          ...allChildren,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `Relatorio_Medicao_Consolidado_${new Date()
    .toISOString()
    .split('T')[0]}.docx`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setIsExportSelectionOpen(false);
};


  const toggleExportSelection = (id: string) => {
    const next = new Set(selectedForExport);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedForExport(next);
  };

  const toggleSelectAllExport = () => {
    if (selectedForExport.size === exportableList.length) {
      setSelectedForExport(new Set());
    } else {
      setSelectedForExport(new Set(exportableList.map(m => m.id)));
    }
  };

  const handleGenerateWord = async () => {
  if (!selectedMeasurement) return;
  const d = demands.find(dm => dm.id === selectedMeasurement.demandId);

  const sectionChildren = await createDemandDocSection(selectedMeasurement);

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: `RELATÓRIO DE MEDIÇÃO: DEMANDA #${d?.id}`,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        ...sectionChildren
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Medicao_${d?.id}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};


  const handleSendWhatsApp = () => {
    if (!selectedMeasurement) return;
    const d = demands.find(dm => dm.id === selectedMeasurement.demandId);
    // Uma linha por pessoa com o total dela, quando ha blocos. Sem blocos a
    // mensagem sai exatamente como sempre saiu — nem uma quebra de linha a mais.
    // Híbrida sem horas digitadas: diz "horas: não informado" — nunca a carga
    // total do treinamento. PRESENCIAL/ONLINE: mensagem byte a byte igual.
    const hibridaMsg = isHibrida(d);
    const linhaPessoa = (x: (typeof secoesPorPessoa)[number]) => {
      const semHoras = hibridaMsg && x.papel !== 'ACOMPANHANTE' && !x.horasInformadas;
      return `👤 ${x.nome}: ${formatCurrency(x.despesas.total + x.horasContadas * x.valorHH)}` +
        (semHoras ? ' (horas: não informado)' : '');
    };
    const porPessoa = temBlocosPorPessoa
      ? secoesPorPessoa.map(linhaPessoa).join('\n') + '\n'
      : '';
    const horasHibridaV1 = !temBlocosPorPessoa && hibridaMsg && !classHours
      ? '⏱️ Horas presenciais: não informado\n'
      : '';

    const text = encodeURIComponent(`Olá! Segue resumo da medição #${d?.id}:
    
🏨 Hospedagem: ${formatCurrency(totals.hospedagem)}
🚗 Locomoção: ${formatCurrency(totals.locomocao)}
🍽️ Alimentação: ${formatCurrency(totals.cafe + totals.almoco + totals.jantar)}
➕ Outros: ${formatCurrency(totals.outros)}
${horasHibridaV1}${porPessoa}
*TOTAL GERAL: ${formatCurrency(totals.total)}*

Segue resumo da medição. O documento Word com comprovantes pode ser anexado.`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const statusColor = (status: MeasurementStatus) => {
    switch(status) {
      case 'NAO_INICIADA': return 'bg-slate-100 text-slate-600';
      case 'LANCAMENTO': return 'bg-orange-100 text-orange-800';
      case 'CONFERENCIA': return 'bg-blue-100 text-blue-800';
      case 'PRONTA_FATURAMENTO': return 'bg-green-100 text-green-800';
      case 'FATURADA': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Medição e Faturamento</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de Comprovantes e Valores de Treinamentos Realizados</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            onClick={() => setIsMedicaoExportOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center space-x-2 shadow-md"
          >
            <FileSpreadsheet size={18} /> <span>Exportar Medição</span>
          </button>
          <button
            onClick={() => setIsExportSelectionOpen(true)}
            className="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center space-x-2 shadow-md"
          >
            <FileDown size={18} /> <span>Exportar DOCX (Selecionar Demandas)</span>
          </button>
        </div>
      </div>

      <MedicaoExportModal
        isOpen={isMedicaoExportOpen}
        onClose={() => setIsMedicaoExportOpen(false)}
      />

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="relative col-span-1 md:col-span-4">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por ID, ID SAP ou Cliente..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="col-span-1 md:col-span-2">
          <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={advancedFilters.companyId} onChange={e => setAdvancedFilters({...advancedFilters, companyId: e.target.value})}>
            <option value="">Todas Empresas</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="col-span-1 md:col-span-2">
          <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={advancedFilters.status} onChange={e => setAdvancedFilters({...advancedFilters, status: e.target.value})}>
            <option value="">Todas as Etapas</option>
            {STAGE_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{STAGE_LABELS[opt]}</option>
            ))}
          </select>
        </div>
        <div className="col-span-1 md:col-span-4 flex gap-1">
          <input type="date" className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs" value={advancedFilters.startDate} onChange={e => setAdvancedFilters({...advancedFilters, startDate: e.target.value})} />
          <input type="date" className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs" value={advancedFilters.endDate} onChange={e => setAdvancedFilters({...advancedFilters, endDate: e.target.value})} />
        </div>
        <div className="col-span-1 md:col-span-3">
          <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={advancedFilters.corredor} onChange={e => setAdvancedFilters({...advancedFilters, corredor: e.target.value})}>
            <option value="">Todos Corredores</option>
            {availableCorredores.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-1 md:col-span-3">
          <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={advancedFilters.localidade} onChange={e => setAdvancedFilters({...advancedFilters, localidade: e.target.value})}>
            <option value="">Todas Localidades</option>
            {availableLocalidades.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-wider font-black text-slate-500">
                <th className="p-4">Demanda</th>
                <th className="p-4">ID SAP / Pedido Cliente</th>
                <th className="p-4">Empresa</th>
                <th className="p-4">Treinamento</th>
                <th className="p-4">Instrutor</th>
                <th className="p-4">Corredor</th>
                <th className="p-4">Localidade</th>
                <th className="p-4">Início</th>
                <th className="p-4">Horário Início</th>
                <th className="p-4">Horário Fim</th>
                <th className="p-4 text-center">Etapa Medição</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedMeasurements.map(m => {
                const d = demands.find(demand => demand.id === m.demandId);
                const isNoShow = d?.status === 'CANCELADA' && d?.cancelReason === 'No-Show';
                return (
                  <tr key={m.id} className={`transition-colors text-sm text-gray-700 ${isNoShow ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}>
                    <td className="p-4 font-bold text-blue-600">
                      <div className="flex items-center gap-2">
                        {d?.id}
                        <NightBadge demand={d} />
                        {isNoShow && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-red-600 text-white tracking-widest">No-Show</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-xs text-gray-500">{d?.clientDemandId || '—'}</td>
                    <td className="p-4 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{getDemandCompanyLabel(d)}</span>
                        {/* Mesmo badge da Logística: com empresa vinculada, o nome
                            da empresa sozinho nao distingue interna de cliente. */}
                        {isInterna(d) && (
                          <span className="bg-violet-100 text-violet-700 border border-violet-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-widest shrink-0">
                            Interna
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">{getDemandTrainingLabel(d)}</td>
                    <td className="p-4 text-xs">{getInstructorName(d?.instructorId)}</td>
                    <td className="p-4 text-xs">{d?.corredor || '—'}</td>
                    <td className="p-4 text-xs">{d?.trainingLocal || '—'}</td>
                    <td className="p-4 font-mono text-xs">{formatDateTime(d?.startDate)}</td>
                    <td className="p-4 font-mono text-xs">{formatTime(d?.startDate)}</td>
                    <td className="p-4 font-mono text-xs">{formatTime(d?.endDate)}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(m.status)}`}>
                        {STAGE_LABELS[m.status]}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleOpenDetail(m)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-slate-100 transition shadow-sm">
                        <ExternalLink size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            currentPage={measPage}
            totalPages={measTotalPages}
            totalItems={filteredMeasurements.length}
            itemsPerPage={measItemsPerPage}
            startIdx={measStartIdx}
            entityLabel="medições"
            onPageChange={setMeasPage}
            onItemsPerPageChange={handleMeasItemsPerPage}
          />
        </div>
      </div>

      {isExportSelectionOpen && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh] border border-white/20">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Exportação de Medições</h2>
                <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Selecione as demandas para o fechamento .docx</p>
              </div>
              <button onClick={() => setIsExportSelectionOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-2xl transition shadow-sm"><X size={28} /></button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
              <div className="w-full lg:w-80 p-8 border-r border-slate-100 space-y-6 overflow-y-auto bg-slate-50/30">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Filter size={14} /> Filtros de Refinamento
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Período</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={exportFilters.startDate} onChange={e => setExportFilters({...exportFilters, startDate: e.target.value})} />
                      <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={exportFilters.endDate} onChange={e => setExportFilters({...exportFilters, endDate: e.target.value})} />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Cliente</label>
                    <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={exportFilters.companyId} onChange={e => setExportFilters({...exportFilters, companyId: e.target.value})}>
                      <option value="">Todos</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Status da Demanda (Real)</label>
                    <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={exportFilters.status} onChange={e => setExportFilters({...exportFilters, status: e.target.value})}>
                      <option value="">Todos</option>
                      <option value="NOVA">Nova</option>
                      <option value="PENDENTE">Pendente</option>
                      <option value="ALOCADA">Alocada</option>
                      <option value="EM_ANDAMENTO">Em Andamento</option>
                      <option value="CONCLUIDA">Concluída</option>
                      <option value="CANCELADA">Cancelada</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <button 
                    onClick={() => setExportFilters({ startDate: '', endDate: '', companyId: '', trainingId: '', instructorId: '', regionId: '', status: '' })}
                    className="w-full py-2.5 text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition tracking-widest"
                  >
                    Resetar Filtros
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0 bg-white">
                <div className="p-4 border-b border-slate-50 flex items-center justify-between">
                  <button 
                    onClick={toggleSelectAllExport}
                    className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 px-4 py-2 rounded-xl transition"
                  >
                    {selectedForExport.size === exportableList.length && exportableList.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                    Selecionar Todas ({exportableList.length})
                  </button>
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                    {selectedForExport.size} de {exportableList.length} marcadas
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {exportableList.map(m => {
                    const d = demands.find(demand => demand.id === m.demandId);
                    const isSelected = selectedForExport.has(m.id);
                    const mTotals = getMeasurementTotals(m);
                    const cDemandStatus = d ? getCalculatedDemandStatus(d) : 'N/A';
                    const isNoShow = d?.status === 'CANCELADA' && d?.cancelReason === 'No-Show';

                    return (
                      <div
                        key={m.id}
                        onClick={() => toggleExportSelection(m.id)}
                        className={`p-4 rounded-[1.5rem] border-2 transition-all cursor-pointer group flex items-center gap-4
                          ${isSelected ? 'bg-blue-50/50 border-blue-200' : isNoShow ? 'bg-red-50/50 border-red-100 hover:border-red-200' : 'bg-white border-slate-50 hover:border-slate-100'}`}
                      >
                        <div className={`transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-200 group-hover:text-slate-300'}`}>
                          {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                        </div>

                        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                          <div className="md:col-span-5">
                            <h4 className="text-sm font-black text-slate-800 truncate" title={getDemandTrainingLabel(d)}>{getDemandTrainingLabel(d)}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] font-bold text-blue-600 font-mono tracking-tighter">#{d?.id}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase truncate" title={getDemandCompanyLabel(d)}>{getDemandCompanyLabel(d)}</span>
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded shadow-sm ${STATUS_STYLING[cDemandStatus] || 'bg-slate-200'}`}>
                                {cDemandStatus.replace('_', ' ')}
                              </span>
                              {isNoShow && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-red-600 text-white tracking-widest">No-Show</span>
                              )}
                            </div>
                          </div>

                          <div className="md:col-span-3">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                               <Calendar size={12} /> {formatDateTime(d?.startDate)}
                            </div>
                          </div>

                          <div className="md:col-span-4 flex items-center justify-end gap-2">
                             {[
                               { label: 'Hotel', present: d?.accommodationType === 'Hotel', icon: Home },
                               { label: 'Carro', present: d?.transportType !== 'N/A', icon: Truck },
                               { label: 'Comida', present: mTotals.cafe + mTotals.almoco + mTotals.jantar > 0, icon: Tag },
                               { label: 'Anexos', present: m.attachments.length > 0, icon: Paperclip }
                             ].map((indicator, idx) => (
                               <div key={idx} className={`p-2 rounded-xl flex flex-col items-center justify-center min-w-[44px] transition-all border ${indicator.present ? 'bg-white border-slate-100 shadow-sm' : 'opacity-20 grayscale border-transparent'}`}>
                                  <indicator.icon size={12} className={indicator.present ? 'text-blue-500' : 'text-slate-400'} />
                               </div>
                             ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-8 bg-slate-900 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
               <div className="flex flex-wrap items-center gap-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Selecionadas</span>
                    <span className="text-xl font-black text-white">{exportSummary.count} Demandas</span>
                  </div>
                  <div className="h-8 w-px bg-white/10 hidden md:block"></div>
               </div>
               
               <div className="flex items-center gap-8 w-full md:w-auto">
                 <div className="flex flex-col text-right">
                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Total Consolidado</span>
                    <span className="text-2xl font-black text-white leading-none">{formatCurrency(exportSummary.total)}</span>
                 </div>
                 <button 
                  onClick={handleConfirmExport}
                  disabled={selectedForExport.size === 0}
                  className={`px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-3 transition-all active:scale-95 shadow-2xl
                    ${selectedForExport.size > 0 ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                 >
                   <FileText size={20} /> Gerar DOCX Único
                 </button>
               </div>
            </div>
          </div>
        </div>
      , document.body)}

      {isModalOpen && selectedMeasurement && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-50 rounded-[2rem] shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] border border-white">
            <div className="px-7 pt-6 pb-5 border-b border-slate-200 bg-white space-y-3">
              {/* Linha 1: Título + Ações */}
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight leading-none">Painel de Medição</h2>
                <div className="flex items-center gap-2">
                  <button onClick={handleGenerateWord} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 transition font-black text-[10px] uppercase tracking-wider border border-blue-200 shadow-sm whitespace-nowrap">
                    <FileText size={14} /> Exportar Word
                  </button>
                  <button onClick={handleSendWhatsApp} className="flex items-center gap-1.5 px-3.5 py-2 bg-green-50 text-green-700 rounded-xl hover:bg-green-100 transition font-black text-[10px] uppercase tracking-wider border border-green-200 shadow-sm whitespace-nowrap">
                    <MessageCircle size={14} /> WhatsApp
                  </button>
                  <div className="w-px h-5 bg-slate-200 mx-1"></div>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-xl transition"><X size={20} /></button>
                </div>
              </div>
              {/* Linha 2: Metadados */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11px] text-slate-500 font-semibold bg-slate-100 px-2.5 py-1 rounded-lg">
                  REF: <span className="font-black text-slate-700">{selectedMeasurement.demandId}</span>
                </span>
                <NightBadge demand={demands.find(dm => dm.id === selectedMeasurement.demandId)} />
                <div className="h-4 w-px bg-slate-200"></div>
                {(() => {
                  const d = demands.find(dm => dm.id === selectedMeasurement.demandId);
                  const cStatus = d ? getCalculatedDemandStatus(d) : 'N/A';
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status:</span>
                      <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg shadow-sm ${STATUS_STYLING[cStatus] || 'bg-slate-200'}`}>
                        {cStatus.replace('_', ' ')}
                      </span>
                    </div>
                  );
                })()}
                <div className="h-4 w-px bg-slate-200"></div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Etapa:</span>
                  <select
                    className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border-0 focus:ring-2 focus:ring-blue-400 outline-none transition-all cursor-pointer ${statusColor(selectedMeasurement.status)}`}
                    value={selectedMeasurement.status}
                    onChange={e => setSelectedMeasurement({...selectedMeasurement, status: e.target.value as MeasurementStatus})}
                  >
                    {STAGE_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{STAGE_LABELS[opt]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="p-7 overflow-y-auto flex-1 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                 {[
                   { label: 'Hospedagem', val: totals.hospedagem, color: 'text-green-600', icon: Home },
                   { label: 'Locomoção', val: totals.locomocao, color: 'text-amber-600', icon: Truck },
                   { label: 'Alimentação', val: totals.cafe + totals.almoco + totals.jantar, color: 'text-blue-600', icon: Tag },
                   { label: 'Outros', val: totals.outros, color: 'text-purple-600', icon: Plus },
                   {
                     label: temBlocosPorPessoa ? `TOTAL GERAL (${secoesPorPessoa.length} pessoas)` : 'TOTAL GERAL',
                     val: totals.total,
                     color: 'text-slate-900 bg-slate-200/50',
                     icon: Wallet,
                     span: 'col-span-2',
                   }
                 ].map((item, idx) => (
                   /* Casca em components/ui/ExpenseSummaryCard — a mesma que o
                      card "Custo das Demandas Internas" do Dashboard usa. */
                   <ExpenseSummaryCard
                     key={idx}
                     label={item.label}
                     value={formatCurrency(item.val)}
                     icon={item.icon}
                     colorClass={item.color}
                     className={item.span || ''}
                   />
                 ))}
              </div>

              {/* ─────────── SEÇÕES POR PESSOA (medição multi-pessoa) ───────────
                  Só renderiza quando a interna tem participante. Demanda de
                  cliente e interna de uma pessoa só caem no bloco de baixo,
                  idêntico ao de sempre. */}
              {temBlocosPorPessoa && secoesPorPessoa.map(secao => (
                <div key={secao.instructorId} className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs uppercase shrink-0">
                        {secao.nome.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">{secao.nome}</p>
                        <span className={`text-[9px] font-black uppercase tracking-widest ${
                          secao.papel === 'TITULAR'
                            ? 'text-blue-600'
                            : secao.papel === 'ACOMPANHANTE'
                              ? 'text-teal-600'
                              : 'text-emerald-600'
                        }`}>
                          {secao.papel === 'TITULAR'
                            ? 'Titular'
                            : secao.papel === 'ACOMPANHANTE'
                              ? 'Acompanhante'
                              : 'Participante'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Total da pessoa</span>
                      <span className="text-sm font-black text-slate-900">
                        {formatCurrency(secao.despesas.total + secao.horasContadas * secao.valorHH)}
                      </span>
                    </div>
                  </div>

                  <div className="p-5 space-y-5">
                    {/* Hora/Aula da pessoa */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Horas</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                            value={secao.horasInformadas ? String(secao.horas ?? '') : ''}
                            // Acompanhante abre VAZIO de propósito: a sugestão
                            // fica na legenda, como texto, para ninguém salvar
                            // um número proporcional sem ter olhado.
                            // Híbrida idem, para TODO papel: a carga total do
                            // treinamento não é o que foi ministrado presencialmente.
                            placeholder={secao.papel === 'ACOMPANHANTE' || secao.hibrida ? '' : String(secao.horasPadrao)}
                            onChange={e => {
                              const raw = e.target.value;
                              // Campo limpo volta a "não informado" — NÃO vira 0.
                              setCampoDoBloco(secao.instructorId, 'horas', raw === '' ? undefined : Number(raw));
                            }}
                          />
                          {secao.horasInformadas && (
                            <button
                              type="button"
                              title={secao.hibrida ? 'Limpar horas' : 'Voltar ao padrão da demanda'}
                              onClick={() => setCampoDoBloco(secao.instructorId, 'horas', undefined)}
                              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] mt-1">
                          {secao.horasInformadas
                            ? <span className="text-amber-500 font-bold">Editado manualmente</span>
                            : secao.hibrida && secao.papel !== 'ACOMPANHANTE'
                              // Híbrida: sem default. A carga total é só informação
                              // — o que conta é o que for digitado.
                              ? <span className="text-amber-600 font-bold">
                                  Demanda híbrida: informe as horas presenciais realizadas
                                  {secao.horasPadrao > 0 ? ` (carga total do treinamento: ${secao.horasPadrao}h)` : ''}
                                </span>
                            : secao.papel === 'ACOMPANHANTE'
                              // Acompanhante é MANUAL: ninguém sabe quantas horas
                              // ele fez, só quantos dias acompanhou. A proporção
                              // é sugestão para quem vai digitar, não conta.
                              ? <span className="text-amber-600 font-bold">
                                  {secao.horasPadrao > 0
                                    ? 'Informe as horas (sugestão: ' + secao.horasPadrao + 'h, proporcional aos dias acompanhados)'
                                    : 'Informe as horas'}
                                </span>
                              : <span className="text-slate-400">Padrão da demanda ({secao.horasPadrao}h)</span>}
                        </p>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Valor Hora/Aula (manual)</label>
                        {/* `value={secao.valorHH || 0}` renderizava um "0"
                            literal no campo vazio: digitar 100 em cima dele
                            mostrava "0100" na tela. O número gravado até estava
                            certo (Number('0100') === 100), mas quem digita não
                            confia num campo que responde assim — e com razão.
                            Campo sem valor agora fica VAZIO. */}
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0,00"
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                          value={secao.valorHH ? String(secao.valorHH) : ''}
                          onChange={e => {
                            const raw = e.target.value;
                            setCampoDoBloco(secao.instructorId, 'valorHH', raw === '' ? undefined : Number(raw));
                          }}
                        />
                      </div>

                      <div className="text-right">
                        <span className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1.5">Total Hora/Aula</span>
                        <span className="text-2xl font-black text-slate-900">
                          {formatCurrency(secao.horasContadas * secao.valorHH)}
                        </span>
                        {/* "Não informadas" só faz sentido para quem é manual.
                            Titular sem horas digitadas vale o padrão da demanda
                            — é o equivalente ao classHours × hourRate da v1, e
                            dizer "R$ 0,00 / não informadas" ali era a v1
                            quebrada. */}
                        {!secao.horasInformadas && secao.papel === 'ACOMPANHANTE' && (
                          <p className="text-[10px] text-amber-600 font-bold mt-1">Horas não informadas</p>
                        )}
                      </div>
                    </div>

                    {/* As 4 categorias da pessoa. `attachments` já vem
                        PARTICIONADO pelo domínio; `ownerId` só marca o dono dos
                        itens novos. */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <CategoryBlock
                        category="HOSPEDAGEM" label="Hospedagem" icon={Home} colorClass="text-green-500"
                        attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}
                        onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                        onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                        showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                      />
                      <CategoryBlock
                        category="LOCOMOCAO" label="Locomoção" icon={Truck} colorClass="text-amber-500"
                        attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}
                        onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                        onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                        showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <CategoryBlock
                        category="CAFE" label="Café da Manhã" icon={Tag} colorClass="text-blue-400"
                        attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}
                        onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                        onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                        showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                      />
                      <CategoryBlock
                        category="ALMOCO" label="Almoço" icon={Tag} colorClass="text-blue-500"
                        attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}
                        onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                        onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                        showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                      />
                      <CategoryBlock
                        category="JANTAR" label="Jantar" icon={Tag} colorClass="text-blue-600"
                        attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}
                        onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                        onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                        showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {/* Bloco de UMA PESSOA — o painel de sempre. Fica escondido
                  quando há seções por pessoa, para não existirem dois lugares
                  editando a mesma coisa. */}
              {!temBlocosPorPessoa && (
              <>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <DollarSign size={14} className="text-emerald-500" /> Hora/Aula
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Horas do Treinamento (da Demanda, quando interna) */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">
                    {_selIsInterna ? 'Horas da Demanda' : 'Horas do Treinamento'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                      // Campo vazio começa VAZIO. `classHours` é number, então
                      // um 0 renderizava "0" literal e digitar 8 em cima virava
                      // "08" na tela. Mesma correção do bloco por pessoa.
                      // Híbrida: sem placeholder de carga total — o campo é uma
                      // pergunta, e a carga vai como texto na legenda abaixo.
                      placeholder={_selIsHibrida ? '' : String(trainingDefaultHours || 0)}
                      value={classHours || ''}
                      onChange={(e) => {
                        const val = Number(e.target.value || 0);
                        setSelectedMeasurement({
                          ...selectedMeasurement!,
                          expenses: {
                            ...selectedMeasurement!.expenses,
                            classHours: val,
                          } as any,
                        });
                      }}
                    />
                    {isClassHoursEdited && (
                      <button
                        type="button"
                        title={_selIsInterna ? 'Restaurar horas previstas da demanda' : 'Restaurar valor do treinamento'}
                        onClick={() => setSelectedMeasurement({
                          ...selectedMeasurement!,
                          expenses: {
                            ...selectedMeasurement!.expenses,
                            classHours: trainingDefaultHours,
                          } as any,
                        })}
                        className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] mt-1">
                    {_selIsHibrida
                      // Híbrida: nunca "Puxado do Treinamento" — a carga total é
                      // informativa; o que conta é o que for digitado.
                      ? (classHours
                          ? <span className="text-amber-500 font-bold">Horas presenciais informadas manualmente</span>
                          : <span className="text-amber-600 font-bold">
                              Demanda híbrida: informe as horas presenciais realizadas
                              {trainingDefaultHours > 0 ? ` (carga total do treinamento: ${trainingDefaultHours}h)` : ''}
                            </span>)
                      : isClassHoursEdited
                        ? <span className="text-amber-500 font-bold">Editado manualmente</span>
                        : <span className="text-slate-400">{_selIsInterna ? 'Puxado da Demanda' : 'Puxado do Treinamento'}</span>
                    }
                  </p>
                </div>

                {/* Valor Hora/Aula */}
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">
                    Valor Hora/Aula (manual)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                    // Idem: sem valor, campo vazio — nada de "0100" ao digitar
                    // 100 por cima de um zero renderizado.
                    placeholder="0,00"
                    value={hourRate || ''}
                    onChange={(e) => {
                      const val = Number(e.target.value || 0);
                      setSelectedMeasurement({
                        ...selectedMeasurement,
                        expenses: {
                          ...selectedMeasurement.expenses,
                          hourRate: val,
                        } as any,
                      });
                    }}
                  />
                </div>

                {/* Total Hora/Aula */}
                <div className="text-right">
                  <span className="block text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1.5">
                    Total Hora/Aula
                  </span>
                  <span className="text-2xl font-black text-slate-900">
                    {formatCurrency(hourClassTotal)}
                  </span>
                </div>
              </div>
            </div>
   
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryBlock 
                  category="HOSPEDAGEM" label="Hospedagem" icon={Home} colorClass="text-green-500" 
                  attachments={selectedMeasurement.attachments}
                  onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                  onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                />
                <CategoryBlock 
                  category="LOCOMOCAO" label="Locomoção" icon={Truck} colorClass="text-amber-500" 
                  attachments={selectedMeasurement.attachments}
                  onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                  onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <CategoryBlock 
                  category="CAFE" label="Café da Manhã" icon={Tag} colorClass="text-blue-400" 
                  obs={selectedMeasurement.expenses.breakfast}
                  onObsChange={val => setSelectedMeasurement({...selectedMeasurement, expenses: {...selectedMeasurement.expenses, breakfast: val}})}
                  attachments={selectedMeasurement.attachments}
                  onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                  onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                />
                <CategoryBlock 
                  category="ALMOCO" label="Almoço" icon={Tag} colorClass="text-blue-500" 
                  obs={selectedMeasurement.expenses.lunch}
                  onObsChange={val => setSelectedMeasurement({...selectedMeasurement, expenses: {...selectedMeasurement.expenses, lunch: val}})}
                  attachments={selectedMeasurement.attachments}
                  onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                  onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                />
                <CategoryBlock 
                  category="JANTAR" label="Jantar" icon={Tag} colorClass="text-blue-600" 
                  obs={selectedMeasurement.expenses.dinner}
                  onObsChange={val => setSelectedMeasurement({...selectedMeasurement, expenses: {...selectedMeasurement.expenses, dinner: val}})}
                  attachments={selectedMeasurement.attachments}
                  onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                  onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                />
              </div>
              </>
              )}

              <div className="bg-white rounded-[2rem] border border-slate-200 p-7 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Plus size={14} className="text-purple-500" /> Outras Despesas Adicionais
                  </h3>
                  <button onClick={handleAddOtherExpense} className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl transition font-black text-[10px] uppercase border border-purple-100 shadow-sm">
                    <Plus size={14} /> Novo Item
                  </button>
                </div>

                <div className="space-y-4">
                  {selectedMeasurement.otherExpenses.map((o) => (
                    <div key={o.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col md:flex-row gap-6 relative group animate-fade-in">
                      <button onClick={() => handleRemoveOtherExpense(o.id)} className="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                        <X size={18} />
                      </button>
                      <div className="flex-1 space-y-3">
                         <div>
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Descrição da Despesa</label>
                            <input className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-purple-500" value={o.description} onChange={e => handleUpdateOtherExpense(o.id, 'description', e.target.value)} placeholder="Ex: Estacionamento Aeroporto, Uber, etc" />
                         </div>
                      </div>
                      <div className="w-full md:w-80 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                        <CategoryBlock 
                          category="OUTROS" label="Comprovante / Valor" icon={Paperclip} colorClass="text-purple-400" otherId={o.id} 
                          attachments={selectedMeasurement.attachments}
                          onUploadFile={handleUploadFile} onUpdateValue={handleUpdateAttachmentValue}
                          onRemoveAttachment={handleRemoveAttachment} onAddManualValue={handleAddManualValue}
                  showReembolsavel={!_selIsInterna} onToggleReembolsavel={handleToggleReembolsavel}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-7 bg-white border-t border-slate-200 flex justify-end items-center gap-6">
              {!_selIsInterna && totals.naoReembolsavel > 0 && (
                <div className="flex flex-col text-right">
                  <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Nao reembolsavel</span>
                  <span className="text-lg font-black text-amber-600 leading-tight">{formatCurrency(totals.naoReembolsavel)}</span>
                </div>
              )}
              <div className="flex flex-col text-right">
                <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Subtotal Final</span>
                <span className="text-2xl font-black text-slate-900 leading-tight">{formatCurrency(totals.total)}</span>
              </div>
              <button onClick={handleSaveMeasurement} className="px-10 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-xl text-xs uppercase tracking-widest flex items-center gap-3 transition-all active:scale-95">
                <Check size={20} /> Salvar e Finalizar
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
};

export default MeasurementView;
