import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Filter,
  CheckSquare,
  Square,
  Calendar,
  FileDown,
  Search
} from 'lucide-react';
// ExcelJS é importado dinamicamente em handleExportExcel para reduzir bundle inicial

import { Demand, Company, Training, Region, Instructor, InstructorAllocation } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { getDemandCompanyLabel } from '../domain/demandLabel';
import { demandIntersectsRange } from '../domain/demandDays';
import { formatDateOnlySafe } from './demand-form/formatters';
import { buildModalityOptions, buildTrainingsById, matchesModality } from '../domain/modalityOptions';
import { fetchLogisticBlocksByDemandIds, LogisticBlockRow } from '../services/logistics';

/* ========== STATUS STYLING (idêntico ao Measurement.tsx) ========== */
const STATUS_STYLING: Record<string, string> = {
  NOVA: 'bg-purple-100 text-purple-700',
  PENDENTE: 'bg-orange-100 text-orange-700',
  ALOCADA: 'bg-blue-100 text-blue-700',
  EM_ANDAMENTO: 'bg-indigo-100 text-indigo-700',
  CONCLUIDA: 'bg-green-100 text-green-700',
  CANCELADA: 'bg-red-100 text-red-700',
};

/* ========== PROPS ========== */
interface ExportDemandsModalProps {
  isOpen: boolean;
  onClose: () => void;
  demands: Demand[];
  companies: Company[];
  trainings: Training[];
  regions: Region[];
  instructors: Instructor[];
  instructorAllocations: InstructorAllocation[];
  /**
   * Qual conjunto está sendo exportado. O default mantém o caminho da tela de
   * demandas de cliente exatamente como era — todo comportamento novo está
   * atrás de `variant === 'interna'`.
   */
  variant?: 'cliente' | 'interna';
  /** Só em variant='interna': opções do filtro de categoria. */
  categoriaOptions?: string[];
  /**
   * Só em variant='interna': nomes dos participantes por demanda, já
   * resolvidos pela tela (que tem `demandParticipants` no contexto).
   *
   * Vem por prop, e não do `useApp`, porque este modal é compartilhado com a
   * tela de cliente e recebe TUDO por prop hoje — puxar contexto só aqui
   * criaria duas formas de o mesmo componente obter dado.
   */
  participantNamesByDemandId?: Record<string, string[]>;
}

/* ========== COMPONENT ========== */
const ExportDemandsModal: React.FC<ExportDemandsModalProps> = ({
  isOpen,
  onClose,
  demands,
  companies,
  trainings,
  regions,
  instructors,
  instructorAllocations,
  variant = 'cliente',
  participantNamesByDemandId = {},
  categoriaOptions = [],
}) => {
  const isInterna = variant === 'interna';
  /* ---------- helpers ---------- */
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || companies.find(c => c.id === id)?.razaoSocial || 'N/A';
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getTrainingHours = (id: string) => {
    const h = trainings.find(t => t.id === id)?.hours;
    return h != null ? `${h}h` : '—';
  };
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || 'N/A';

  // Retorna os nomes de TODOS os instrutores alocados à demanda (principal + adicionais),
  // na ordem de início de cada alocação, sem repetição.
  const getAllInstructorNames = (demand: Demand): string[] => {
    const allocs = instructorAllocations.filter(a => a.demandId === demand.id && a.instructorId);
    const sorted = [...allocs].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    const seen = new Set<string>();
    const names: string[] = [];
    sorted.forEach(a => {
      if (seen.has(a.instructorId)) return;
      seen.add(a.instructorId);
      const inst = instructors.find(i => i.id === a.instructorId);
      if (inst) names.push(inst.name);
    });

    // Fallback para instructorId direto quando não há alocações
    if (names.length === 0 && demand.instructorId) {
      const inst = instructors.find(i => i.id === demand.instructorId);
      if (inst) names.push(inst.name);
    }

    return names;
  };

  const getInstructorName = (demand: Demand) => {
    const names = getAllInstructorNames(demand);
    return names.length > 0 ? names[0] : 'Não Alocado';
  };

  const getCalculatedStatus = (d: Demand) => calculateDemandStatus({
    startDate: d.startDate,
    endDate: d.endDate,
    instructorId: d.instructorId,
    cancelled: d.status === 'CANCELADA',
  });

  // Parede pura: start_date/end_date guardam o horário que o usuário digitou.
  // new Date().toLocaleDateString() reinterpretava o "+00:00" como instante e
  // voltava um dia na borda de meia-noite.
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return formatDateOnlySafe(dateStr);
  };

  /* ---------- state ---------- */
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    trainingId: '',
    categoria: '',
    instructorId: '',
    regionId: '',
    status: '',
    search: '',
    trainingLocal: '',
    corredor: '',
    modality: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modalidade: índice + opções derivadas dos dados (fonte única em domain/modalityOptions)
  const trainingsById = useMemo(() => buildTrainingsById(trainings), [trainings]);
  const modalityOptions = useMemo(() => buildModalityOptions(demands, trainings), [demands, trainings]);

  /* ---------- filtered list ---------- */
  const filteredDemands = useMemo(() => {
    const normalize = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return demands.filter(d => {
      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.trainingId && d.trainingId !== filters.trainingId) return false;
      if (filters.categoria && (d.categoriaInterna || '') !== filters.categoria) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;
      if (filters.trainingLocal && (d.trainingLocal || '') !== filters.trainingLocal) return false;
      if (filters.corredor && (d.corredor || '') !== filters.corredor) return false;
      if (!matchesModality(d, trainingsById, filters.modality)) return false;

      if (filters.instructorId) {
        const allocs = instructorAllocations.filter(a => a.demandId === d.id);
        const hasInstructor = allocs.some(a => a.instructorId === filters.instructorId) || d.instructorId === filters.instructorId;
        if (!hasInstructor) return false;
      }

      if (filters.status) {
        const calcStatus = getCalculatedStatus(d);
        if (calcStatus !== filters.status) return false;
      }

      // ✅ Filtro por período: suporta dias específicos
      if (filters.startDate || filters.endDate) {
        if (!demandIntersectsRange(d, filters.startDate || undefined, filters.endDate || undefined)) return false;
      }

      if (filters.search) {
        const term = normalize(filters.search);
        const haystack = [
          d.id,
          d.clientDemandId || '',
          getCompanyName(d.companyId),
          isInterna ? (d.categoriaInterna || '') : getTrainingName(d.trainingId),
          isInterna ? (d.descricaoInterna || '') : '',
        ].map(normalize).join(' ');
        if (!haystack.includes(term)) return false;
      }

      return true;
    }).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }, [demands, filters, instructorAllocations, trainingsById]);

  /* ---------- selection helpers ---------- */
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDemands.length && filteredDemands.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDemands.map(d => d.id)));
    }
  };

  const resetFilters = () => {
    setFilters({ startDate: '', endDate: '', companyId: '', trainingId: '', categoria: '', instructorId: '', regionId: '', status: '', search: '', trainingLocal: '', corredor: '', modality: '' });
    setSelectedIds(new Set());
  };

  /* ---------- EXPORT EXCEL ---------- */
  const handleExportExcel = async () => {
    const toExport = selectedIds.size > 0
      ? filteredDemands.filter(d => selectedIds.has(d.id))
      : filteredDemands;

    if (toExport.length === 0) return;

    // Import dinâmico: carregado somente ao exportar (bundle menor)
    const ExcelJSModule = await import('exceljs');
    const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Demandas');

    // Extrai HH:MM do datetime ISO (ex: "2026-02-12T18:30" → "18:30")
    const getHorario = (dateStr?: string): string => {
      if (!dateStr || !dateStr.includes('T')) return '—';
      return dateStr.split('T')[1]?.slice(0, 5) || '—';
    };

    // Demanda noturna = horário de início a partir das 18:00
    const isNocturnal = (dateStr?: string): boolean => {
      if (!dateStr || !dateStr.includes('T')) return false;
      const hour = parseInt((dateStr.split('T')[1] || '').split(':')[0], 10);
      return !isNaN(hour) && hour >= 18;
    };

    // Bloco primário (block_order 0) de LOCOMOÇÃO de cada demanda exportada (1 query em lote)
    let locomocaoPorDemanda = new Map<string, LogisticBlockRow>();
    try {
      const blocks = await fetchLogisticBlocksByDemandIds(toExport.map(d => d.id));
      blocks
        .filter(b => b.block_type === 'LOCOMOCAO' && b.block_order === 0)
        .forEach(b => locomocaoPorDemanda.set(b.demand_id, b));
    } catch (err) {
      console.error('Erro ao buscar locomoção para export:', err);
    }

    const dbTransportToLabel = (mode?: string | null): string => {
      if (mode === 'CARRO_ALUGADO') return 'Carro Alugado';
      if (mode === 'CARRO_PROPRIO') return 'Carro Próprio';
      if (mode === 'TAXI') return 'Táxi';
      if (mode === 'CARRO_APLICATIVO') return 'Carro Aplicativo';
      if (mode === 'OUTROS') return 'Outros';
      if (mode === 'NAO_NECESSARIO' || mode === 'NA') return 'N/A';
      return '—';
    };

    const getLocomocaoMeio = (block?: LogisticBlockRow): string => {
      if (!block) return '—';
      const label = dbTransportToLabel(block.transport_mode);
      if (block.transport_mode === 'OUTROS' && block.transport_other_description) {
        return `Outros — ${block.transport_other_description}`;
      }
      return label;
    };

    // Converte timestamptz (UTC) para "DD/MM/AAAA HH:mm" no fuso local do navegador
    // (mesma conversão usada em isoToLocalDTL/toIsoFromDateTimeLocalSafe no Demands.tsx)
    const formatCheckInOut = (iso?: string | null): string => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    const getNotaFiscalIndicacao = (block?: LogisticBlockRow): string => {
      const urls = block?.receipt_url;
      if (!urls?.length) return '—';
      return urls.map(u => u.split('/').pop()?.replace(/^\d+_/, '') || 'nota fiscal').join(', ');
    };

    // Definição das colunas
    // Nova ordem: ID | ID Cliente | Empresa | Treinamento | Local do Treinamento | Região | Data Início | Horário | Data Fim | ...
    worksheet.columns = [
      { header: 'ID',                   key: 'id',               width: 14 },
      { header: 'ID Cliente',            key: 'clientDemandId',   width: 16 },
      { header: 'Empresa',               key: 'empresa',          width: 30 },
      // Interna não tem treinamento nem carga horária de treinamento: as duas
      // colunas dão lugar a Categoria + Descrição, que é o que identifica a
      // demanda. Empresa fica nas duas variantes — desde que a empresa virou
      // opcional na interna, a coluna carrega dado real (e "Colabor (Interna)"
      // quando não há vínculo).
      ...(isInterna
        ? [
            { header: 'Categoria',       key: 'categoria',        width: 22 },
            { header: 'Descrição',       key: 'descricao',        width: 45 },
            { header: 'Horas Previstas', key: 'horasPrevistas',   width: 16 },
          ]
        : [
            { header: 'Treinamento',     key: 'treinamento',      width: 35 },
            { header: 'Carga Horária',   key: 'cargaHoraria',     width: 14 },
          ]),
      { header: 'Local do Treinamento',  key: 'trainingLocal',    width: 28 },
      { header: 'Região',                key: 'regiao',           width: 18 },
      { header: 'Estado',                key: 'estado',           width: 12 },
      { header: 'Data Início',           key: 'dataInicio',       width: 14 },
      { header: 'Horário Início',          key: 'horarioInicio',    width: 10 },
      { header: 'Horário Fim',            key: 'horarioFim',       width: 10 },
      { header: 'Data Fim',              key: 'dataFim',          width: 14 },
      { header: 'Modo Datas',            key: 'modoDatas',        width: 18 },
      { header: 'Dias Específicos',      key: 'diasEspecificos',  width: 40 },
      { header: 'Instrutor Principal',   key: 'instrutor',        width: 25 },
      // Coluna NOVA em vez de espremer os participantes na de instrutor: as
      // duas listas vêm de tabelas diferentes e misturá-las faria a planilha
      // dizer que o participante é instrutor alocado, que é justamente o que
      // ele não é. Entra só na interna — o export de cliente sai com a mesma
      // contagem de colunas de antes.
      ...(isInterna
        ? [{ header: 'Participantes', key: 'participantes', width: 40 }]
        : []),
      { header: 'Status',                key: 'status',           width: 16 },
      { header: 'Modalidade',            key: 'modalidade',       width: 16 },
      { header: 'Corredor',              key: 'corredor',         width: 18 },
      { header: 'Meio de Transporte (Locomoção)', key: 'locomocaoMeio',     width: 28 },
      { header: 'Check-in Locomoção',    key: 'locomocaoCheckIn',  width: 18 },
      { header: 'Check-out Locomoção',   key: 'locomocaoCheckOut', width: 18 },
      { header: 'Nota Fiscal Locomoção', key: 'locomocaoNotaFiscal', width: 30 },
      { header: 'Aprovador',             key: 'aprovador',              width: 20 },
      { header: 'Analista',              key: 'analista',               width: 18 },
      { header: 'Motivo do Cancelamento', key: 'motivoCancelamento',    width: 26 },
      { header: 'Observações Importantes', key: 'observacoes',           width: 50 },
    ];

    // Estiliza o cabeçalho (linha 1): fundo escuro + texto branco + negrito
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    });

    // Adiciona as linhas de dados
    toExport.forEach(d => {
      const locomocaoBlock = locomocaoPorDemanda.get(d.id);
      const row = worksheet.addRow({
        id:              d.id || '',
        clientDemandId:  d.clientDemandId || '',
        empresa:         isInterna ? getDemandCompanyLabel(d, companies) : getCompanyName(d.companyId),
        ...(isInterna
          ? {
              categoria:      d.categoriaInterna || '',
              descricao:      d.descricaoInterna || '',
              horasPrevistas: d.horasPrevistas != null ? `${d.horasPrevistas}h` : '',
            }
          : {
              treinamento:  getTrainingName(d.trainingId),
              cargaHoraria: getTrainingHours(d.trainingId),
            }),
        trainingLocal:   d.trainingLocal || '',
        regiao:          getRegionName(d.regionId),
        estado:          d.demandState || '',
        dataInicio:      formatDate(d.startDate),
        horarioInicio:   getHorario(d.startDate),
        horarioFim:      getHorario(d.endDate),
        dataFim:         formatDate(d.endDate),
        modoDatas:       d.dateMode === 'DIAS_ESPECIFICOS' ? 'Dias Específicos' : 'Contínuo',
        diasEspecificos: d.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(d.specificDates)
                           ? d.specificDates.sort((a, b) => a.data.localeCompare(b.data)).map(e => `${e.data} ${e.horarioInicio}-${e.horarioFim}`).join(', ')
                           : '',
        instrutor:       getAllInstructorNames(d).join('\n') || 'Não Alocado',
        ...(isInterna
          ? { participantes: (participantNamesByDemandId[d.id] ?? []).join(', ') }
          : {}),
        status:          getCalculatedStatus(d).replace('_', ' '),
        modalidade:      d.modality || '',
        corredor:        d.corredor || '',
        locomocaoMeio:        getLocomocaoMeio(locomocaoBlock),
        locomocaoCheckIn:     formatCheckInOut(locomocaoBlock?.rental_check_in),
        locomocaoCheckOut:    formatCheckInOut(locomocaoBlock?.rental_check_out),
        locomocaoNotaFiscal:  getNotaFiscalIndicacao(locomocaoBlock),
        aprovador:            d.approver || '',
        analista:             d.analyst || '',
        motivoCancelamento:   d.status === 'CANCELADA' ? (d.cancelReason || '—') : '',
        observacoes:          d.observations || '',
      });

      // Quebra de linha visível quando há mais de um instrutor na célula
      const instrutorNames = getAllInstructorNames(d);
      if (instrutorNames.length > 1) {
        row.getCell('instrutor').alignment = { wrapText: true, vertical: 'top' };
        row.height = Math.max(row.height || 15, instrutorNames.length * 15);
      }

      // Demandas noturnas (≥ 18:00): negrito + fundo laranja-claro em toda a linha
      if (isNocturnal(d.startDate)) {
        row.eachCell({ includeEmpty: true }, (cell: any) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
        });
      }
    });

    // AutoFilter cobrindo todas as colunas (26) e todas as linhas com dados
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: toExport.length + 1, column: 26 },
    };

    // Gera o arquivo e faz o download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${isInterna ? 'demandas_internas' : 'demandas'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /* ---------- dropdown options (derivadas dos dados) ---------- */
  const companyOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.companyId))) as string[];
    return ids.map(id => ({ id, name: getCompanyName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, companies]);

  const trainingOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.trainingId))) as string[];
    return ids.map(id => ({ id, name: getTrainingName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, trainings]);

  const regionOptions = useMemo(() => {
    const ids = Array.from(new Set(demands.map(d => d.regionId))) as string[];
    return ids.map(id => ({ id, name: getRegionName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, regions]);

  const instructorOptions = useMemo(() => {
    const ids = new Set<string>();
    demands.forEach(d => {
      if (d.instructorId) ids.add(d.instructorId);
      instructorAllocations.filter(a => a.demandId === d.id).forEach(a => ids.add(a.instructorId));
    });
    return [...ids].map(id => {
      const inst = instructors.find(i => i.id === id);
      return { id, name: inst?.name || 'N/A' };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [demands, instructors, instructorAllocations]);

  const trainingLocalOptions = useMemo(() =>
    [...new Set(demands.map((d: Demand) => d.trainingLocal).filter((v: string | undefined): v is string => !!v && v !== 'N/A'))].sort(),
  [demands]);

  const corredorOptions = useMemo(() =>
    [...new Set(demands.map((d: Demand) => d.corredor).filter((v: string | undefined): v is string => !!v))].sort(),
  [demands]);

  /* ---------- render ---------- */
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const exportCount = selectedIds.size > 0 ? selectedIds.size : filteredDemands.length;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh] border border-white/20">

        {/* ===== HEADER ===== */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">{isInterna ? 'Exportação de Demandas Internas' : 'Exportação de Demandas'}</h2>
            <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">Selecione as demandas para exportar em Excel (.xlsx)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-white rounded-2xl transition shadow-sm"><X size={28} /></button>
        </div>

        {/* ===== BODY ===== */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

          {/* ----- FILTROS (esquerda) ----- */}
          <div className="w-full lg:w-80 p-8 border-r border-slate-100 space-y-6 overflow-y-auto bg-slate-50/30">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Filter size={14} /> Filtros de Refinamento
            </h3>

            <div className="space-y-4">
              {/* Período */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Período</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} />
                  <input type="date" className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} />
                </div>
              </div>

              {/* Empresa / Cliente */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Cliente</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.companyId} onChange={e => setFilters({ ...filters, companyId: e.target.value })}>
                  <option value="">Todos</option>
                  {companyOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Treinamento (cliente) / Categoria (interna) */}
              {isInterna ? (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Categoria</label>
                  <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.categoria} onChange={e => setFilters({ ...filters, categoria: e.target.value })}>
                    <option value="">Todas</option>
                    {categoriaOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Treinamento</label>
                  <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingId} onChange={e => setFilters({ ...filters, trainingId: e.target.value })}>
                    <option value="">Todos</option>
                    {trainingOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              {/* Instrutor */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Instrutor</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.instructorId} onChange={e => setFilters({ ...filters, instructorId: e.target.value })}>
                  <option value="">Todos</option>
                  {instructorOptions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              {/* Região */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Região</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.regionId} onChange={e => setFilters({ ...filters, regionId: e.target.value })}>
                  <option value="">Todas</option>
                  {regionOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {/* Local de Treinamento */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Local de Treinamento</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingLocal} onChange={e => setFilters({ ...filters, trainingLocal: e.target.value })}>
                  <option value="">Todos</option>
                  {trainingLocalOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Corredor */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Corredor</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.corredor} onChange={e => setFilters({ ...filters, corredor: e.target.value })}>
                  <option value="">Todos</option>
                  {corredorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              {/* Modalidade */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Modalidade</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.modality} onChange={e => setFilters({ ...filters, modality: e.target.value })}>
                  <option value="">Todas</option>
                  {modalityOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Status</label>
                <select className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="NOVA">Nova</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="ALOCADA">Alocada</option>
                  <option value="EM_ANDAMENTO">Em Andamento</option>
                  <option value="CONCLUIDA">Concluída</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
              </div>

              {/* Busca por ID / Palavra-chave */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase mb-1.5">Buscar ID / Palavra-chave</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input
                    type="text"
                    placeholder="DEM-xx, empresa, treinamento..."
                    className="w-full border border-slate-200 rounded-xl p-2.5 pl-9 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white"
                    value={filters.search}
                    onChange={e => setFilters({ ...filters, search: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Resetar */}
            <div className="pt-4 border-t border-slate-100">
              <button
                onClick={resetFilters}
                className="w-full py-2.5 text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition tracking-widest"
              >
                Resetar Filtros
              </button>
            </div>
          </div>

          {/* ----- LISTA (direita) ----- */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* Topo: selecionar todas */}
            <div className="p-4 border-b border-slate-50 flex items-center justify-between">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 px-4 py-2 rounded-xl transition"
              >
                {selectedIds.size === filteredDemands.length && filteredDemands.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                Selecionar Todas ({filteredDemands.length})
              </button>
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                {selectedIds.size} de {filteredDemands.length} marcadas
              </span>
            </div>

            {/* Lista scrollável */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredDemands.length === 0 && (
                <div className="text-center py-16 text-slate-300 text-sm font-bold">Nenhuma demanda encontrada com os filtros aplicados.</div>
              )}
              {filteredDemands.map(d => {
                const isSelected = selectedIds.has(d.id);
                const calcStatus = getCalculatedStatus(d);

                return (
                  <div
                    key={d.id}
                    onClick={() => toggleSelection(d.id)}
                    className={`p-4 rounded-[1.5rem] border-2 transition-all cursor-pointer group flex items-center gap-4
                      ${isSelected ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-slate-50 hover:border-slate-100'}`}
                  >
                    {/* Checkbox */}
                    <div className={`transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-200 group-hover:text-slate-300'}`}>
                      {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                    </div>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                      {/* Título + ID + Empresa + Status */}
                      <div className="md:col-span-5">
                        <h4 className="text-sm font-black text-slate-800 truncate" title={getTrainingName(d.trainingId)}>{getTrainingName(d.trainingId)}</h4>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[10px] font-bold text-blue-600 font-mono tracking-tighter">#{d.id}</span>
                          {d.clientDemandId && <span className="text-[10px] font-bold text-slate-400 font-mono">({d.clientDemandId})</span>}
                          <span className="text-[10px] font-bold text-slate-400 uppercase truncate" title={getCompanyName(d.companyId)}>{getCompanyName(d.companyId)}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded shadow-sm ${STATUS_STYLING[calcStatus] || 'bg-slate-200'}`}>
                            {calcStatus.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Data */}
                      <div className="md:col-span-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                          <Calendar size={12} /> {formatDate(d.startDate)}
                        </div>
                      </div>

                      {/* Região + Instrutor */}
                      <div className="md:col-span-4 flex flex-col items-end gap-1">
                        <span className="text-[10px] font-bold text-slate-400">{getRegionName(d.regionId)}</span>
                        <span className="text-[10px] font-bold text-slate-500">{getInstructorName(d)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="p-8 bg-slate-900 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Selecionadas</span>
              <span className="text-xl font-black text-white">{selectedIds.size > 0 ? selectedIds.size : filteredDemands.length} Demandas</span>
            </div>
            <div className="h-8 w-px bg-white/10 hidden md:block"></div>
            {selectedIds.size === 0 && filteredDemands.length > 0 && (
              <span className="text-[10px] font-bold text-slate-500 uppercase">Exportará todas as {filteredDemands.length} filtradas</span>
            )}
          </div>

          <div className="flex items-center gap-8 w-full md:w-auto">
            <button
              onClick={handleExportExcel}
              disabled={filteredDemands.length === 0}
              className={`px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-3 transition-all active:scale-95 shadow-2xl
                ${filteredDemands.length > 0 ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              <FileDown size={20} /> Baixar Excel
            </button>
          </div>
        </div>

      </div>
    </div>
  , document.body);
};

export default ExportDemandsModal;
