import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useApp } from '../App';
import {
  Filter, Calendar, Users, Briefcase, AlertCircle, CheckCircle,
  Clock, TrendingUp, TrendingDown, AlertTriangle, Building2, MapPin,
  Truck, DollarSign, Award, Target, Zap, ShieldAlert,
  Download, MousePointer2,
  Info, Ban, Bell, Package, FileText, UserCheck, Hotel, Car,
  HelpCircle, X, ArrowLeftRight, Monitor, Home,
  Link2, Tag
} from 'lucide-react';
import { Demand, type Instructor } from '../types';
import { calculateDemandStatus } from '../domain/demandStatus';
import { demandIntersectsRange } from '../domain/demandDays';
import { aggregateMeasurements } from '../domain/measurementTotals';
import {
  getAvailableInstructors,
  defaultAvailabilityWindow,
  computeIdleCoverage,
} from '../domain/instructorAvailability';
import { computeInstructorHours, InstructorHoursEntry } from '../domain/instructorHours';
import { buildModalityOptions, buildTrainingsById, matchesModality } from '../domain/modalityOptions';
import Pagination from './Pagination';
import ReportModal from './ReportModal';
import type { ReportInput } from '../utils/reportTypes';
import {
  fetchLogisticAllocations,
  LogisticAllocationRow
} from '../services/logisticAllocations';

// --- Constantes Visuais ---
const COLORS = {
  CONCLUIDA: '#10B981',
  ALOCADA: '#3B82F6',
  PENDENTE: '#F59E0B',
  NOVA: '#8B5CF6',
  EM_ANDAMENTO: '#6366F1',
  CANCELADA: '#EF4444',
  CHART_PALETTE: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#6366F1', '#EC4899', '#06B6D4']
};

const STATUS_LABELS: Record<string, string> = {
  NOVA: 'Nova',
  PENDENTE: 'Pendente',
  ALOCADA: 'Alocada',
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada'
};

type TabType = 'GERAL' | 'OPERACIONAL' | 'INSTRUTORES' | 'CLIENTES' | 'CUSTOS' | 'INTERNAS';

const PERIOD_COLORS = ['#378ADD', '#1D9E75', '#EF9F27', '#D85A30', '#7F77DD', '#D4537E'] as const;

interface ExtraPeriod {
  id: string;
  startDate: string;
  endDate: string;
}

type RankedItem = { name: string; value: number };

/** Lista ranqueada com barras inline e expansão do grupo "Outros". Suporta modo de comparação com items2. */
const RankedListChart: React.FC<{
  items: RankedItem[];
  othersDetail: RankedItem[];
  barColor: string;
  emptyLabel?: string;
  valueFormatter?: (v: number) => string;
  items2?: RankedItem[];
}> = ({ items, othersDetail, barColor, emptyLabel = 'Sem dados', valueFormatter, items2 }) => {
  const [expanded, setExpanded] = useState(false);
  const isCompare = items2 !== undefined;

  const allItems = expanded
    ? [...items, ...othersDetail]
    : othersDetail.length > 0
      ? [...items, { name: `Outros (${othersDetail.length} locais)`, value: othersDetail.reduce((s, i) => s + i.value, 0), isOthers: true } as any]
      : items;

  const map2 = new Map((items2 ?? []).map(i => [i.name, i.value]));
  const max = Math.max(...[...items, ...othersDetail].map(i => i.value), ...(items2 ?? []).map(i => i.value), 1);

  if (items.length === 0 && othersDetail.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-h-0 pr-0.5">
      {allItems.map((item: any, idx: number) => {
        const isOthersRow = item.isOthers;
        const val2 = isCompare && !isOthersRow ? (map2.get(item.name) ?? 0) : undefined;
        return (
          <div key={item.name + idx}>
            <div
              className={`flex items-center gap-2 py-1 px-1.5 rounded-lg transition-colors ${isOthersRow ? 'cursor-pointer hover:bg-slate-50 group' : ''}`}
              onClick={isOthersRow ? () => setExpanded(true) : undefined}
              title={isOthersRow ? 'Clique para ver todos os locais' : item.name}
            >
              <span className="text-[9px] font-black text-slate-300 w-3.5 text-right shrink-0">
                {isOthersRow ? '…' : idx + 1}
              </span>
              <span
                className={`text-[10px] font-bold truncate shrink-0 w-28 ${isOthersRow ? 'text-blue-500 group-hover:underline' : 'text-slate-600'}`}
              >
                {item.name}
              </span>
              <div className="flex-1 flex flex-col gap-0.5">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isOthersRow ? 'bg-slate-300' : barColor}`}
                    style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                  />
                </div>
                {isCompare && !isOthersRow && (
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-emerald-400"
                      style={{ width: `${Math.round(((Number(val2) || 0) / max) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className={`shrink-0 text-right ${valueFormatter ? 'w-20' : 'w-5'}`}>
                <div className={`text-[10px] font-black ${isOthersRow ? 'text-slate-400' : 'text-slate-700'}`}>
                  {valueFormatter ? valueFormatter(item.value) : item.value}
                </div>
                {isCompare && !isOthersRow && (
                  <div className="text-[9px] font-bold text-emerald-600">
                    {valueFormatter ? valueFormatter(val2 ?? 0) : (val2 ?? 0)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {expanded && othersDetail.length > 0 && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors text-center"
        >
          ▲ Recolher
        </button>
      )}
    </div>
  );
};

/** Cor do chip de status. Módulo (não local do render) porque Operacional e Internas usam. */
const STATUS_BADGE: Record<string, string> = {
  NOVA:        'bg-violet-100 text-violet-700',
  PENDENTE:    'bg-amber-100 text-amber-700',
  ALOCADA:     'bg-blue-100 text-blue-700',
  EM_ANDAMENTO:'bg-emerald-100 text-emerald-700',
  CONCLUIDA:   'bg-slate-100 text-slate-500',
  CANCELADA:   'bg-red-100 text-red-500',
};

// ─── Glossário de ajuda por aba ─────────────────────────────────────────────

const TAB_LABELS: Record<string, string> = {
  GERAL: 'Visão Geral',
  OPERACIONAL: 'Operacional',
  INSTRUTORES: 'Instrutores',
  CLIENTES: 'Clientes',
  CUSTOS: 'Custos',
  INTERNAS: 'Internas',
};

type HelpItem    = { term: string; desc: string };
type HelpSection = { section: string; items: HelpItem[] };

const HELP_CONTENT: Record<string, HelpSection[]> = {
  GERAL: [
    {
      section: 'Cards de Indicadores',
      items: [
        { term: 'Total de Demandas', desc: 'Quantidade de demandas dentro do período e filtros selecionados.' },
        { term: 'Total de Horas', desc: 'Soma das horas de todas as demandas no período filtrado, independente do status.' },
        { term: 'Horas Concluídas', desc: 'Soma das horas dos treinamentos com status CONCLUÍDA no período filtrado.' },
        { term: 'Taxa de Cancelamento', desc: 'Proporção de demandas canceladas sobre o total de demandas ativas (concluídas + canceladas).' },
        { term: 'Treinamentos Concluídos', desc: 'Número de demandas que atingiram o status CONCLUÍDA no período.' },
      ],
    },
    {
      section: 'Gráficos',
      items: [
        { term: 'Volume por Status', desc: 'Distribuição de todas as demandas pelos seus status calculados: Nova, Pendente, Alocada, Em Andamento, Concluída, Cancelada.' },
        { term: 'Volume por Região', desc: 'Quantidade de demandas agrupadas pela região configurada em cada demanda.' },
        { term: 'Volume por Local', desc: 'Demandas agrupadas pelo campo "Local de Treinamento". Itens com menor volume formam o grupo "Outros" — clique na linha para expandir e ver todos.' },
        { term: 'Volume por Corredor', desc: 'Demandas agrupadas pelo campo "Corredor" — localidade ou rota logística da operação.' },
        { term: 'Volume por UF', desc: 'Demandas agrupadas pela Unidade Federativa (estado) registrada no campo "Estado da Demanda".' },
      ],
    },
  ],
  OPERACIONAL: [
    {
      section: 'Cards de Indicadores',
      items: [
        { term: 'Aguardando Instrutor', desc: 'Demandas ativas, presenciais e sem instrutor alocado. Demandas Online/EAD são excluídas desse contador.' },
        { term: 'Alocadas', desc: 'Demandas com status calculado ALOCADA no período filtrado.' },
        { term: 'Em Execução Hoje', desc: 'Demandas com status EM_ANDAMENTO cujo intervalo de datas abrange hoje.' },
        { term: 'Próximos 30 Dias', desc: 'Demandas com data de início entre hoje e 30 dias à frente.' },
        { term: 'Taxa de Execução', desc: 'Percentual de demandas concluídas sobre o total ativo (excluindo canceladas). Verde ≥ 70%, Amarelo ≥ 40%, Vermelho < 40%.' },
      ],
    },
    {
      section: 'Gráficos e Blocos',
      items: [
        { term: 'Top Treinamentos', desc: 'Ranking dos treinamentos com maior número de demandas no período. Clique em "Outros" para expandir e ver todos.' },
        { term: 'Demandas por Instrutor', desc: 'Ranking dos instrutores com mais demandas alocadas no período. Mostra os 8 primeiros.' },
        { term: 'Modalidade', desc: 'Proporção das demandas por tipo: Presencial, Online/EAD e Híbrido.' },
        { term: 'Taxa de Execução (donut)', desc: 'Gráfico circular mostrando o percentual de conclusão com legenda de concluídas, em andamento e pendentes.' },
        { term: 'Agenda dos Próximos 7 Dias', desc: 'Demandas em execução ou com início previsto nos próximos 7 dias, ordenadas por data de início. A paginação exibe 15 linhas por vez.' },
      ],
    },
  ],
  INSTRUTORES: [
    {
      section: 'Cards de Indicadores',
      items: [
        { term: 'Ativos', desc: 'Total de instrutores com status ATIVO no cadastro.' },
        { term: 'Disponíveis (30d)', desc: 'Instrutores ativos sem nenhuma demanda ativa (não cancelada/concluída) sobreposta aos próximos 30 dias.' },
        { term: 'Sem Demanda', desc: 'Instrutores que não aparecem em nenhuma demanda dentro do período e filtros ativos.' },
        { term: 'Reaproveitamento %', desc: 'Percentual de instrutores ativos que já ministrou pelo menos 2 tipos de treinamentos distintos em todo o histórico.' },
        { term: 'Risco Dependência', desc: 'Quantidade de treinamentos ativos com ≤ 1 instrutor apto (nível ≥ 3 — Avançado ou Especialista).' },
        { term: 'Produtividade Global', desc: 'Soma total de horas de treinamentos concluídos no período filtrado.' },
      ],
    },
    {
      section: 'Gráficos e Blocos',
      items: [
        { term: 'Horas Ministradas por Instrutor', desc: 'Todos os instrutores com horas > 0 em demandas concluídas no período, ordenados por horas (rolagem vertical). Horas calculadas por instructor_allocations — proporcionais aos dias que cada um efetivamente ministrou, não à carga cheia do treinamento. O toggle no cabeçalho troca o recorte: "Treinamentos" (padrão) mostra só demanda de cliente, "Internas" mostra só demanda interna. Os dois NÃO se somam — são leituras separadas. "N div." indica demandas divididas com outro instrutor.' },
        { term: 'Risco de Dependência (lista)', desc: 'NRs e treinamentos onde apenas 1 ou nenhum instrutor tem nível ≥ 3. Risco: se esse instrutor ficar indisponível, a execução pode ser comprometida.' },
        { term: 'Disponíveis nos Próximos 30 Dias', desc: 'Lista nominal de instrutores sem alocação ativa prevista — candidatos para absorver novas demandas.' },
        { term: 'Sem Demanda no Período', desc: 'Instrutores sem nenhuma participação no filtro ativo. Pode indicar ociosidade ou escopo fora da região selecionada.' },
        { term: 'Reaproveitamento de Instrutores', desc: 'Ranking pelo número de tipos distintos de treinamento ministrados no histórico completo. Quanto maior, mais versátil o instrutor.' },
        { term: 'Distribuição Geográfica', desc: 'Por região: barra azul = instrutores habilitados, barra verde = demandas no período. Identifica desequilíbrio entre oferta de instrutores e concentração de demandas.' },
        { term: 'Cobertura de Competências', desc: 'Por categoria de treinamento: instrutores aptos (nível ≥ 3) vs volume de demandas. Status OK (cobertura ≥ 50%), Alerta (< 50%) e Crítico (0 instrutores aptos).' },
      ],
    },
  ],
  CLIENTES: [
    {
      section: 'Gráficos',
      items: [
        { term: 'Clientes mais Ativos', desc: 'Empresas com maior volume de demandas no período filtrado. Exibe os 8 com mais demandas.' },
        { term: 'Treinamentos por Categoria', desc: 'Distribuição das demandas pelas categorias de treinamento (Segurança do Trabalho, Manutenção, Operações, etc.).' },
      ],
    },
  ],
  CUSTOS: [
    {
      section: 'Cards de Indicadores',
      items: [
        { term: 'Total em Despesas', desc: 'Soma de todos os valores de anexos (notas e comprovantes) registrados nas medições do período filtrado.' },
        { term: 'Despesas Não Reembolsáveis', desc: 'Recorte do Total em Despesas: itens marcados na Medição como não reembolsáveis pelo cliente (ex.: Uber até a locadora, almoço acima do teto). A Colabor absorve. Continuam somados no total e na categoria — é um recorte, não uma subtração.' },
        { term: 'Escopo desta aba', desc: 'Só demandas de CLIENTE. O custo de demanda interna não é reembolsável por natureza e aparece na aba Internas, em "Custo das Demandas Internas".' },
        { term: 'Ticket Médio/Medição', desc: 'Média de despesas por medição registrada no período.' },
        { term: 'Não Iniciadas', desc: 'Demandas concluídas no período sem medição em andamento — status NAO_INICIADA ou sem registro.' },
        { term: 'Pronta Faturamento', desc: 'Medições conferidas e aguardando emissão de nota fiscal.' },
        { term: 'Faturadas', desc: 'Medições com ciclo financeiro encerrado.' },
      ],
    },
    {
      section: 'Gráficos e Blocos',
      items: [
        { term: 'Mix de Despesas', desc: 'Gráfico de rosca com a proporção de cada categoria: Hospedagem, Locomoção, Café da Manhã, Almoço, Jantar e Outros.' },
        { term: 'Média por Categoria', desc: 'Para cada categoria: total gasto, número de medições com esse tipo (×), média por medição e percentual sobre o total.' },
        { term: 'Status das Medições', desc: 'Funil de progresso: Não Iniciada → Em Lançamento → Em Conferência → Pronta Faturamento → Faturada. Percentuais calculados sobre o total de demandas concluídas.' },
        { term: 'Top Instrutores por Custo', desc: 'Ranking dos instrutores cujas demandas geraram o maior volume de despesas no período filtrado.' },
        { term: 'Evolução Mensal de Custos', desc: 'Histórico dos últimos 6 meses de despesas registradas. Não é restrito pelo filtro de período — exibe o histórico completo para comparação de tendências.' },
      ],
    },
  ],
  INTERNAS: [
    {
      section: 'Cards de Indicadores',
      items: [
        { term: 'Demandas Internas', desc: 'Quantidade de demandas internas (visita, SIPAT, apoio logístico, eventos da Colabor) no período e filtros selecionados, com a quebra por status calculado.' },
        { term: 'Horas Previstas', desc: 'Soma de horas_previstas das demandas do recorte. É a carga PLANEJADA e existe em qualquer status — responde "quanto de interna tem no período".' },
        { term: 'Horas Já Ministradas', desc: 'Linha menor do card de horas. Mede outra coisa: só demandas CONCLUÍDAS e COM alocação em instructor_allocations, rateadas por dia. É a mesma conta do card de instrutor e da medição. Interna cujo instrutor foi definido só no cadastro da demanda NÃO entra aqui — o vínculo tem que existir na agenda.' },
        { term: 'Vínculo', desc: 'Demandas com empresa vinculada (company_id preenchido) versus demandas da própria Colabor. Interna pode ou não ter empresa: uma visita técnica na Vale tem, uma SIPAT interna não.' },
        { term: 'Categorias', desc: 'Quantas categorias distintas aparecem no recorte, e qual delas concentra mais horas previstas.' },
        { term: 'Custo das Demandas Internas', desc: 'Soma das medições das demandas internas do recorte: Hora/Aula (horas lançadas × valor/hora) + Despesas (notas e valores avulsos). Interna não é reembolsada pelo cliente — este número é o custo que a Colabor absorve por inteiro, e por isso vive aqui e não na aba Custos.' },
      ],
    },
    {
      section: 'Gráficos e Blocos',
      items: [
        { term: 'Distribuição por Categoria', desc: 'Horas previstas e número de demandas por categoria interna, ordenado por horas. Demanda sem categoria cadastrada aparece agrupada em "Sem categoria".' },
        { term: 'Top Instrutores em Horas Internas', desc: 'Ranking por horas internas MINISTRADAS (não previstas) — mesma fonte do card "Horas Ministradas por Instrutor" no toggle Internas. Top 8.' },
        { term: 'Aviso de concluída sem alocação', desc: 'Aparece quando existe demanda interna concluída sem nenhuma alocação de instrutor. Essas demandas contam em "Demandas Internas" e em "Horas Previstas", mas ficam fora de "Horas Já Ministradas" e do ranking, porque a fonte de horas é instructor_allocations e não o instrutor do cadastro. É a explicação para ver demanda concluída e 0h ministradas ao mesmo tempo.' },
      ],
    },
    {
      section: 'Filtros',
      items: [
        { term: 'Filtros aplicáveis', desc: 'Período/mês, região, estado, local, corredor e status funcionam igual às demais abas. Empresa também: como company_id é opcional na interna, filtrar por uma empresa esconde as internas da Colabor — o que é o correto, elas não são daquela empresa.' },
        { term: 'Modalidade não se aplica', desc: 'Demanda interna é sempre presencial por construção (o formulário nem oferece o campo) e não tem treinamento de onde herdar modalidade. O filtro de modalidade é ignorado nesta aba de propósito: aplicá-lo zeraria o painel inteiro sem significar nada.' },
      ],
    },
  ],
};

// ─── Painel de ajuda (drawer lateral) ───────────────────────────────────────

const HelpDrawer: React.FC<{ tab: string; onClose: () => void }> = ({ tab, onClose }) => {
  const sections = HELP_CONTENT[tab] || [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[400px] max-w-[95vw] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <HelpCircle size={16} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-800 uppercase tracking-tight">Legenda</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{TAB_LABELS[tab]}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-200 transition-colors text-slate-400 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7 custom-scrollbar">
          {sections.length === 0 && (
            <p className="text-[11px] text-slate-300 italic">Nenhuma legenda disponível para esta aba.</p>
          )}
          {sections.map((sec, i) => (
            <div key={i}>
              <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest pb-2 mb-3 border-b border-slate-100">
                {sec.section}
              </h3>
              <div className="space-y-4">
                {sec.items.map((item, j) => (
                  <div key={j} className="flex gap-3">
                    <div className="w-0.5 rounded-full bg-blue-200 shrink-0 mt-0.5" style={{ minHeight: '100%' }} />
                    <div>
                      <p className="text-[11px] font-black text-slate-700 leading-snug">{item.term}</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
          >
            Fechar Legenda
          </button>
        </div>
      </div>
    </>
  );
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const { demands: allDemands, companies, regions, instructors, trainings, measurements, instructorAllocations, getEvidenceAutoStatus } = useApp();

  // ⚠️ FONTE ÚNICA do Dashboard: demanda de cliente.
  // Todo KPI, total de horas e ranking daqui pra baixo mede entrega a cliente —
  // demanda interna (sem empresa, sem treinamento, horas próprias) distorceria
  // cada um deles de um jeito diferente. O corte é aqui, na entrada, uma vez só,
  // e não gráfico a gráfico.
  const demands = useMemo(() => allDemands.filter(d => d.tipo !== 'interna'), [allDemands]);

  // Exceção deliberada ao corte acima, e a ÚNICA: métrica sobre INSTRUTOR
  // ("quanto ele trabalhou") soma cliente + interna — o instrutor que passou a
  // semana numa SIPAT trabalhou, e o ranking que o mostrava com menos horas que
  // o colega estava errado sobre ele. Métrica sobre CLIENTE/TREINAMENTO
  // (receita, volume por empresa, ranking de treinamento) continua saindo só de
  // `demands`. Esta lista NÃO entra em nenhum outro KPI.
  const internaDemands = useMemo(() => allDemands.filter(d => d.tipo === 'interna'), [allDemands]);

  // ✅ NORMALIZADOR (1 vez só)
  const normId = (v: any) => String(v ?? '').trim().replace(/^#/, '');

  const [activeTab, setActiveTab] = useState<TabType>('GERAL');
  /** Toggle do card "Horas Ministradas por Instrutor": troca o dataset, não soma. */
  const [instructorRanking, setInstructorRanking] = useState<'TREINAMENTOS' | 'INTERNAS'>('TREINAMENTOS');
  const [showHelp, setShowHelp] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showNoInstructorTooltip, setShowNoInstructorTooltip] = useState(false);
  const [showNoMeasurementTooltip, setShowNoMeasurementTooltip] = useState(false);
  const noInstructorTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const noMeasurementTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [showCancelledList, setShowCancelledList] = useState(false);
  const today = new Date();

  // ✅ Supabase (controle logístico): demand_id -> logistic_allocations
  const [logisticsByDemandId, setLogisticsByDemandId] = useState<Record<string, LogisticAllocationRow>>({});
  // ✅ evita "piscar" (pendente vs ok) enquanto carrega do Supabase
  const [isLoadingPendencies, setIsLoadingPendencies] = useState(true);
  const [agenda7Page, setAgenda7Page] = useState(1);
  const AGENDA7_PER_PAGE = 15;

  const syncLogisticsControlFromDb = useCallback(async () => {
    setIsLoadingPendencies(true);
    try {
      const rows = await fetchLogisticAllocations();
      const map: Record<string, LogisticAllocationRow> = {};
      for (const r of rows || []) {
        const key = normId(r?.demand_id);
        if (key) map[key] = r;
      }
      setLogisticsByDemandId(map);
    } catch (e) {
      console.error('[Dashboard] sync logistic_allocations error:', e);
      setLogisticsByDemandId({});
    } finally {
      setIsLoadingPendencies(false);
    }
  }, []);


  useEffect(() => {
    syncLogisticsControlFromDb();
  }, [syncLogisticsControlFromDb]);

  useEffect(() => {
    const onFocus = () => syncLogisticsControlFromDb();
    const onVisibility = () => {
      if (!document.hidden) syncLogisticsControlFromDb();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncLogisticsControlFromDb]);

  // --- Filtros Globais ---
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    companyId: '',
    regionId: '',
    status: '',
    trainingLocal: '',
    corredor: '',
    demandState: '',
    modality: ''
  });

  // --- Lógica de Mês/Ano ---
  const availableMonths = useMemo(() => {
    const unique = new Map<string, string>();
    demands.forEach(d => {
      if (!d.startDate) return;
      const date = new Date(d.startDate);
      if (isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      unique.set(key, label);
    });
    return Array.from(unique.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [demands]);

  // --- Opções dinâmicas para filtros avançados ---
  const availableTrainingLocals = useMemo(() =>
    [...new Set(demands.map(d => d.trainingLocal).filter((v): v is string => !!v && v !== 'N/A'))].sort(),
  [demands]);

  const availableCorredores = useMemo(() =>
    [...new Set(demands.map(d => d.corredor).filter((v): v is string => !!v))].sort(),
  [demands]);

  const availableStates = useMemo(() =>
    [...new Set(demands.map(d => d.demandState).filter((v): v is string => !!v))].sort(),
  [demands]);

  // Modalidade: índice + opções derivadas dos dados (fonte única em domain/modalityOptions)
  const trainingsById = useMemo(() => buildTrainingsById(trainings), [trainings]);
  const availableModalities = useMemo(() => buildModalityOptions(demands, trainings), [demands, trainings]);

  const handleMonthFilterChange = (val: string) => {
    if (!val) {
      setFilters(prev => ({ ...prev, startDate: '', endDate: '' }));
      return;
    }
    const [year, month] = val.split('-').map(Number);
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDayDate = new Date(year, month, 0);
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
    setFilters(prev => ({ ...prev, startDate: firstDay, endDate: lastDay }));
  };

  const getMonthSelectorValue = () => {
    if (!filters.startDate || !filters.endDate) return "";
    const [sY, sM, sD] = filters.startDate.split('-');
    const [eY, eM, eD] = filters.endDate.split('-');

    if (sY === eY && sM === eM && sD === '01') {
      const lastDay = new Date(Number(eY), Number(eM), 0).getDate();
      if (Number(eD) === lastDay) return `${sY}-${sM}`;
    }
    return "";
  };

  // --- Comparação de N Períodos ---
  const [extraPeriods, setExtraPeriods] = useState<ExtraPeriod[]>([]);
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  // --- Toggle gráfico Treinamentos por Categoria ---
  const [categoryChartMode, setCategoryChartMode] = useState<'qty' | 'hours'>('qty');
  const toggleSeries = (key: string) => setHiddenSeries(prev => ({ ...prev, [key]: !prev[key] }));

  // --- Geração de Relatório ---
  const [showReportModal, setShowReportModal] = useState(false);

  // --- Toggle de visualização nos rankings de Local/Corredor/UF ---
  const [localView, setLocalView] = useState<'count' | 'hours'>('count');
  const [corredorView, setCorredorView] = useState<'count' | 'hours'>('count');
  const [ufView, setUfView] = useState<'count' | 'hours'>('count');
  /** Refs para captura de gráficos via html2canvas (um por aba) */
  const chartRefsMap = useRef<Record<string, HTMLDivElement | null>>({});

  // Backward compat — usados pelos gráficos existentes, não alterar
  const compareMode    = extraPeriods.length > 0;
  const compareFilters = extraPeriods[0] ?? { startDate: '', endDate: '' };

  const addExtraPeriod = () => {
    if (extraPeriods.length >= 5) return;
    setExtraPeriods(prev => [
      ...prev,
      { id: Math.random().toString(36).slice(2), startDate: '', endDate: '' }
    ]);
  };

  const removeExtraPeriod = (id: string) =>
    setExtraPeriods(prev => prev.filter(p => p.id !== id));

  const updateExtraPeriod = (id: string, patch: Partial<Pick<ExtraPeriod, 'startDate' | 'endDate'>>) =>
    setExtraPeriods(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));

  const handleExtraMonthChange = (id: string, val: string) => {
    if (!val) { updateExtraPeriod(id, { startDate: '', endDate: '' }); return; }
    const [year, month] = val.split('-').map(Number);
    const firstDay  = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDayDate = new Date(year, month, 0);
    const lastDay   = `${year}-${String(month).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
    updateExtraPeriod(id, { startDate: firstDay, endDate: lastDay });
  };

  const getExtraMonthValue = (p: ExtraPeriod) => {
    if (!p.startDate || !p.endDate) return '';
    const [sY, sM, sD] = p.startDate.split('-');
    const [eY, eM, eD] = p.endDate.split('-');
    if (sY === eY && sM === eM && sD === '01') {
      const lastDay = new Date(Number(eY), Number(eM), 0).getDate();
      if (Number(eD) === lastDay) return `${sY}-${sM}`;
    }
    return '';
  };

  const getPeriodLabel = (start: string, end: string) => {
    if (!start && !end) return 'Todo o período';
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' });
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    return start ? `A partir de ${fmt(start)}` : `Até ${fmt(end)}`;
  };

  // --- Modalidade ---
  // ⚠️ TODO: este normalizador NÃO remove acentos ("HÍBRIDO"/"HÍBRIDA") e os
  // buckets que dependem dele (gráfico "Modalidade" e a seção equivalente do
  // export XLSX) só contemplam Presencial, Online/EAD e Híbrido — TUTORIA fica
  // de fora. Auditoria da base em 12/08/2026 (SQL, modalidade efetiva com a
  // regra treinamento > demanda): PRESENCIAL 1010, ONLINE 26, ONLINE_AO_VIVO 15,
  // HIBRIDO 10, zero acentuados e zero TUTORIA — ou seja, hoje as contagens
  // fecham com o total. Se algum desses valores passar a existir na base, essas
  // demandas somem de todos os buckets: alinhar com canonicalModality /
  // resolveDemandModality de domain/modalityOptions.ts, que é a fonte única já
  // usada pelos filtros de Modalidade (Demandas, Exportação e Dashboard).
  const normalizeModality = (raw: any) =>
    String(raw ?? '')
      .trim()
      .toUpperCase()
      .replaceAll('-', '')
      .replaceAll(' ', '');

  const getDemandModality = (d: Demand) => {
    const t = trainings.find(t => String(t.id) === String(d.trainingId));
    const raw = t?.modality ?? d.modality;
    return normalizeModality(raw);
  };

  const isOnlineDemand = (d: Demand) => {
    const m = getDemandModality(d);
    return ['ONLINE', 'EAD', 'ONLINE_AO_VIVO'].includes(m);
  };

  // Helper de status calculado
  const getCalculatedStatus = (d: Demand) =>
    calculateDemandStatus({
      startDate: d.startDate,
      endDate: d.endDate,
      instructorId: d.instructorId,
      cancelled: d.status === 'CANCELADA',
      trainingLocal: d.trainingLocal,
      modality: getDemandModality(d),
    } as any);

  // --- Processamento de Dados Base ---
  const filteredDemands = useMemo(() => {
    return demands.filter(d => {
      const currentStatus = getCalculatedStatus(d);

      // ✅ Filtro por período: usa demandIntersectsRange para suportar dias específicos
      if (filters.startDate || filters.endDate) {
        if (!demandIntersectsRange(d, filters.startDate || undefined, filters.endDate || undefined)) return false;
      }

      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;
      if (filters.status && currentStatus !== filters.status) return false;
      if (filters.trainingLocal && (d.trainingLocal ?? '') !== filters.trainingLocal) return false;
      if (filters.corredor && (d.corredor ?? '') !== filters.corredor) return false;
      if (filters.demandState && (d.demandState ?? '') !== filters.demandState) return false;
      if (!matchesModality(d, trainingsById, filters.modality)) return false;

      return true;
    });
  }, [demands, filters, trainings, trainingsById]);

  const filteredMeasurements = useMemo(() => {
    const demandIds = new Set(filteredDemands.map(d => d.id));
    return measurements.filter(m => demandIds.has(m.demandId));
  }, [measurements, filteredDemands]);

  // --- Período de Comparação (P2 = extraPeriods[0]) ---
  const filteredDemands2 = useMemo(() => {
    if (extraPeriods.length === 0) return [];
    const p = extraPeriods[0];
    return demands.filter(d => {
      const currentStatus = getCalculatedStatus(d);
      if (p.startDate || p.endDate) {
        if (!demandIntersectsRange(d, p.startDate || undefined, p.endDate || undefined)) return false;
      }
      if (filters.companyId && d.companyId !== filters.companyId) return false;
      if (filters.regionId && d.regionId !== filters.regionId) return false;
      if (filters.status && currentStatus !== filters.status) return false;
      if (filters.trainingLocal && (d.trainingLocal ?? '') !== filters.trainingLocal) return false;
      if (filters.corredor && (d.corredor ?? '') !== filters.corredor) return false;
      if (filters.demandState && (d.demandState ?? '') !== filters.demandState) return false;
      if (!matchesModality(d, trainingsById, filters.modality)) return false;
      return true;
    });
  }, [demands, extraPeriods, filters.companyId, filters.status, filters.regionId, filters.trainingLocal, filters.corredor, filters.demandState, filters.modality, trainings, trainingsById]);

  const filteredMeasurements2 = useMemo(() => {
    if (extraPeriods.length === 0) return [];
    const demandIds = new Set(filteredDemands2.map(d => d.id));
    return measurements.filter(m => demandIds.has(m.demandId));
  }, [measurements, filteredDemands2, extraPeriods.length]);

  // ✅ Helpers: lê status do Supabase logistic_allocations
  const isCarOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    const mode = String(alloc.transport_mode ?? '').toUpperCase();
    if (mode === 'NAO_NECESSARIO') return true;
    return alloc.has_car === true;
  };

  const isHotelOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    const mode = String(alloc.lodging_mode ?? '').toUpperCase();
    if (mode === 'NAO_NECESSARIO') return true;
    return alloc.has_hotel === true;
  };

  // ✅ ALTERAÇÃO: PDFs SEM alloc = pendente (false)
  const isReleaseOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return false;
    return alloc.has_release_pdf === true;
  };

  const isListOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return false;
    return alloc.has_class_list_pdf === true;
  };

  const isMaterialOkFromAlloc = (alloc?: LogisticAllocationRow) => {
    if (!alloc) return null;
    return alloc.has_material === true;
  };

  // --- Lógica de Pendências Logísticas (SOMENTE STATUS DO CONTROLE) ---
// --- Lógica de Pendências Logísticas (SOMENTE STATUS DO CONTROLE) ---
const pendingLogisticsDemands = useMemo(() => {
  // enquanto carrega, não calcula (evita piscar)
  if (isLoadingPendencies) return [];

  return filteredDemands.filter(d => {
    // regras gerais (mantém)
    if (isOnlineDemand(d)) return false;

    const status = getCalculatedStatus(d);
    if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;

    // ✅ fonte da verdade: Controle Logístico
    const alloc = logisticsByDemandId?.[normId(d.id)];

    // se não existe controle logístico ainda, NÃO entra como pendência
    // (senão vai piscar / dar falso positivo)
    if (!alloc) return false;

    const overall = String(alloc.overall_status ?? 'PENDENTE').toUpperCase();
    return overall !== 'CONCLUIDA';
  });
}, [filteredDemands, logisticsByDemandId, isLoadingPendencies]);




  // --- Pendências de Evidências (só conta após CONCLUSÃO) ---
  const pendingEvidenceDemands = useMemo(() => {
    return filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);

      // só após conclusão
      if (status !== 'CONCLUIDA') return false;

      // ONLINE/EAD não conta
      if (isOnlineDemand(d)) return false;

      const evStatus = getEvidenceAutoStatus(d.id);
      return evStatus !== 'COMPLETA';
    });
  }, [filteredDemands, trainings, getEvidenceAutoStatus]);

  // --- Helpers de Cálculo ---
  const getTrainingHours = (trainingId: string) => trainings.find(t => t.id === trainingId)?.hours || 0;
  const getTrainingName = (id: string) => trainings.find(t => t.id === id)?.name || 'N/A';
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || 'N/A';

  /** Formata horas com fração só quando necessário (ex.: 75.5, mas 88 em vez de 88.0). */
  const formatHoursValue = (v: number) => {
    const r = Math.round((v + Number.EPSILON) * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  const totalAllHours = useMemo(() => {
    return filteredDemands.reduce((acc: number, d) => acc + getTrainingHours(d.trainingId), 0);
  }, [filteredDemands, trainings]);

  /**
   * ⚠️ Guarda de dados — demandas híbridas (não canceladas) cujo treinamento
   * não tem `practicalHours` cadastrado. Nessas, "Horas Concluídas" cai no
   * fallback (carga total do treinamento) em vez das horas práticas —
   * ver domain/instructorHours.ts. Hoje nasce vazio (os 4 híbridos
   * conhecidos já têm o campo seedado); serve de alerta para treinamentos
   * híbridos novos cadastrados sem essa informação.
   */
  const hibridSemPracticalHours = useMemo(() => {
    return filteredDemands.filter(d => {
      if (d.status === 'CANCELADA') return false;
      if (getDemandModality(d) !== 'HIBRIDO') return false;
      const training = trainings.find(t => t.id === d.trainingId);
      return !(training?.practicalHours != null && training.practicalHours > 0);
    });
  }, [filteredDemands, trainings]);

  const totalCosts = useMemo(() => {
    return filteredMeasurements.reduce((acc: number, m) => {
      return acc + m.attachments.reduce((sum: number, att) => {
        const val = typeof att.value === 'string' ? parseFloat(att.value.replace(',', '.')) : Number(att.value);
        return sum + (Number(val) || 0);
      }, 0);
    }, 0);
  }, [filteredMeasurements]);

  const totalAllHours2 = useMemo(() => {
    if (extraPeriods.length === 0) return 0;
    return filteredDemands2.reduce((acc: number, d) => acc + getTrainingHours(d.trainingId), 0);
  }, [filteredDemands2, trainings, extraPeriods.length]);

  const totalCosts2 = useMemo(() => {
    if (extraPeriods.length === 0) return 0;
    return filteredMeasurements2.reduce((acc: number, m) => {
      return acc + m.attachments.reduce((sum: number, att) => {
        const val = typeof att.value === 'string' ? parseFloat(att.value.replace(',', '.')) : Number(att.value);
        return sum + (Number(val) || 0);
      }, 0);
    }, 0);
  }, [filteredMeasurements2, extraPeriods.length]);

  // --- Todos os períodos (P1…PN) para KPICards multi-período ---
  const allFilteredDemandsList = useMemo(() => {
    if (extraPeriods.length === 0) return [filteredDemands];
    return [filteredDemands, filteredDemands2, ...extraPeriods.slice(1).map(p =>
      demands.filter(d => {
        const currentStatus = getCalculatedStatus(d);
        if (p.startDate || p.endDate) {
          if (!demandIntersectsRange(d, p.startDate || undefined, p.endDate || undefined)) return false;
        }
        if (filters.companyId && d.companyId !== filters.companyId) return false;
        if (filters.regionId && d.regionId !== filters.regionId) return false;
        if (filters.status && currentStatus !== filters.status) return false;
        if (filters.trainingLocal && (d.trainingLocal ?? '') !== filters.trainingLocal) return false;
        if (filters.corredor && (d.corredor ?? '') !== filters.corredor) return false;
        if (filters.demandState && (d.demandState ?? '') !== filters.demandState) return false;
        if (!matchesModality(d, trainingsById, filters.modality)) return false;
        return true;
      })
    )];
  }, [filteredDemands, filteredDemands2, demands, extraPeriods, filters.companyId, filters.status, filters.regionId, filters.trainingLocal, filters.corredor, filters.demandState, filters.modality, trainings, trainingsById]);

  const allFilteredMeasurementsList = useMemo(() => {
    return allFilteredDemandsList.map(dList => {
      const ids = new Set(dList.map((d: any) => d.id));
      return measurements.filter((m: any) => ids.has(m.demandId));
    });
  }, [allFilteredDemandsList, measurements]);

  // --- Bordas de cada período (P1 = filtro principal, P2..PN = extraPeriods) ---
  const getPeriodBounds = (i: number): { start?: string; end?: string } => {
    if (i === 0) return { start: filters.startDate || undefined, end: filters.endDate || undefined };
    const p = extraPeriods[i - 1];
    return { start: p?.startDate || undefined, end: p?.endDate || undefined };
  };

  /**
   * ✅ FONTE ÚNICA — Horas por Instrutor
   * Substitui o cálculo antigo (demands.instructor_id × carga nominal do treinamento).
   * Fonte do vínculo é SEMPRE instructor_allocations; horas são proporcionais aos
   * dias reais de cada instrutor dentro da demanda. Um Map por período filtrado
   * (P1..PN), para alimentar KPIs, ranking, gráfico e export XLSX sem duplicar lógica.
   */
  const instructorHoursMapsByPeriod = useMemo(() => {
    return allFilteredDemandsList.map((dList, i) => {
      const { start, end } = getPeriodBounds(i);
      return computeInstructorHours({
        demands: dList,
        instructorAllocations,
        trainings,
        measurements,
        periodStart: start,
        periodEnd: end,
      });
    });
  }, [allFilteredDemandsList, instructorAllocations, trainings, measurements, filters.startDate, filters.endDate, extraPeriods]);

  /**
   * Internas recortadas pelos filtros do Dashboard, um array por período.
   * Fonte única da aba INTERNAS e do toggle "Internas" do card de horas.
   *
   * FILTROS QUE SE APLICAM (mesma semântica da demanda de cliente):
   *   • período/mês — via demandIntersectsRange, igual ao cliente
   *   • região      — interna tem region_id
   *   • estado      — demand_state
   *   • local       — training_local
   *   • corredor    — corredor
   *   • status      — calculado por data, igual ao cliente
   *   • empresa     — company_id é OPCIONAL na interna; filtrar por empresa
   *                   esconde as internas da Colabor, que é o correto (elas
   *                   não são daquela empresa)
   *
   * FILTRO QUE NÃO SE APLICA:
   *   • modalidade  — interna é sempre PRESENCIAL por construção (o form nem
   *                   oferece o campo) e não tem treinamento de onde herdar
   *                   modalidade. Filtrar por ONLINE/HÍBRIDO zeraria a aba
   *                   inteira sem que isso significasse nada. Fica de fora
   *                   de propósito.
   */
  const filteredInternasByPeriod = useMemo(() => {
    return allFilteredDemandsList.map((_dList, i) => {
      const { start, end } = getPeriodBounds(i);
      return internaDemands.filter(d => {
        if (start || end) {
          if (!demandIntersectsRange(d, start, end)) return false;
        }
        if (filters.companyId && d.companyId !== filters.companyId) return false;
        if (filters.regionId && d.regionId !== filters.regionId) return false;
        if (filters.status && getCalculatedStatus(d) !== filters.status) return false;
        if (filters.trainingLocal && (d.trainingLocal ?? '') !== filters.trainingLocal) return false;
        if (filters.corredor && (d.corredor ?? '') !== filters.corredor) return false;
        if (filters.demandState && (d.demandState ?? '') !== filters.demandState) return false;
        return true;
      });
    });
  }, [allFilteredDemandsList, internaDemands, filters, extraPeriods]);

  /**
   * Horas de demanda INTERNA por instrutor, um Map por período — espelho do
   * mapa acima, alimentado pela outra metade do dataset.
   *
   * Deliberadamente SEPARADO em vez de jogar as internas dentro de
   * `instructorHoursMapsByPeriod`: aquele mapa alimenta "Horas Ministradas",
   * "Produtividade Global" e o export XLSX, que são leitura de entrega a
   * CLIENTE. Com dois mapas, nada soma os dois — o card de horas por instrutor
   * TROCA de mapa pelo toggle, e todo o resto do Dashboard fica intacto.
   */
  const internaHoursMapsByPeriod = useMemo(() => {
    return filteredInternasByPeriod.map((internasDoPeriodo, i) => {
      const { start, end } = getPeriodBounds(i);
      return computeInstructorHours({
        demands: internasDoPeriodo,
        instructorAllocations,
        trainings,
        measurements,
        periodStart: start,
        periodEnd: end,
      });
    });
  }, [filteredInternasByPeriod, instructorAllocations, trainings, measurements, filters.startDate, filters.endDate, extraPeriods]);

  /**
   * Agregados da aba INTERNAS. Duas fontes de hora, de propósito:
   *  - `horasPrevistas` da demanda: carga PLANEJADA, existe em qualquer status.
   *    Responde "quanto de interna tem no período".
   *  - `computeInstructorHours`: horas MINISTRADAS, só de demanda concluída e
   *    COM linha em instructor_allocations, rateadas por dia. Mesma função do
   *    card de instrutor e da medição — se divergirem, um dos dois está errado.
   * Somar as duas daria um número que não significa nada.
   */
  const internaKpis = useMemo(() => {
    const lista = filteredInternasByPeriod[0] ?? [];
    const mapa = internaHoursMapsByPeriod[0] ?? new Map<string, InstructorHoursEntry>();

    const porStatus = new Map<string, number>();
    for (const d of lista) {
      const s = getCalculatedStatus(d);
      porStatus.set(s, (porStatus.get(s) ?? 0) + 1);
    }

    const horasDe = (d: Demand) => {
      const h = Number(d.horasPrevistas);
      return Number.isFinite(h) && h > 0 ? h : 0;
    };

    const porCategoria = new Map<string, { n: number; horas: number }>();
    for (const d of lista) {
      const cat = (d.categoriaInterna || '').trim() || 'Sem categoria';
      const cur = porCategoria.get(cat) ?? { n: 0, horas: 0 };
      cur.n += 1;
      cur.horas += horasDe(d);
      porCategoria.set(cat, cur);
    }

    const instrutoresPorNome = new Map(instructors.map(i => [i.id, i.name]));
    const topInstrutores = [...mapa.entries()]
      .map(([id, e]) => ({ id, nome: instrutoresPorNome.get(id) ?? id, horas: e.horas, nDemandas: e.nDemandas }))
      .filter(r => r.horas > 0)
      .sort((a, b) => b.horas - a.horas)
      .slice(0, 8);

    const comEmpresa = lista.filter(d => String(d.companyId ?? '').trim()).length;

    return {
      totalDemandas: lista.length,
      porStatus: [...porStatus.entries()].sort((a, b) => b[1] - a[1]),
      horasPrevistas: lista.reduce((acc, d) => acc + horasDe(d), 0),
      horasMinistradas: [...mapa.values()].reduce((acc, e) => acc + e.horas, 0),
      categorias: [...porCategoria.entries()]
        .map(([nome, v]) => ({ nome, ...v }))
        .sort((a, b) => b.horas - a.horas || b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR')),
      topInstrutores,
      comEmpresa,
      semEmpresa: lista.length - comEmpresa,
      /** Concluídas sem alocação: explicam "0h ministradas" com demanda concluída. */
      concluidasSemAlocacao: lista.filter(d =>
        getCalculatedStatus(d) === 'CONCLUIDA' &&
        !instructorAllocations.some(a => a.demandId === d.id && a.instructorId)
      ).length,
    };
  }, [filteredInternasByPeriod, internaHoursMapsByPeriod, instructors, instructorAllocations, trainings]);

  const sumInstructorHours = (map: Map<string, InstructorHoursEntry>) => {
    let sum = 0;
    for (const entry of map.values()) sum += entry.horas;
    return sum;
  };

  const totalHours = useMemo(() => {
    return sumInstructorHours(instructorHoursMapsByPeriod[0] ?? new Map());
  }, [instructorHoursMapsByPeriod]);

  const totalHours2 = useMemo(() => {
    if (extraPeriods.length === 0) return 0;
    return sumInstructorHours(instructorHoursMapsByPeriod[1] ?? new Map());
  }, [instructorHoursMapsByPeriod, extraPeriods.length]);

  /** periods[] pronto para o KPICard "Horas Concluídas" / "Produtividade Global" (P1..PN). */
  const hoursConcluidasPeriods = useMemo(() => {
    if (!compareMode) return undefined;
    return allFilteredDemandsList.map((_, i) => ({
      value: `${formatHoursValue(sumInstructorHours(instructorHoursMapsByPeriod[i] ?? new Map()))}h`,
      color: PERIOD_COLORS[i % PERIOD_COLORS.length],
      label: `P${i + 1}`,
    }));
  }, [compareMode, allFilteredDemandsList, instructorHoursMapsByPeriod]);

  /** Cria o array `periods` para KPICard; retorna undefined quando não há comparação */
  const mkPeriods = (getValue: (dList: any[], mList: any[]) => any) =>
    compareMode
      ? allFilteredDemandsList.map((dList, i) => ({
          value: getValue(dList, allFilteredMeasurementsList[i] ?? []),
          color: PERIOD_COLORS[i % PERIOD_COLORS.length],
          label: `P${i + 1}`,
        }))
      : undefined;

  /** Dados consolidados para geração de relatório (recalculado apenas quando os períodos mudam) */
  const reportInput = useMemo((): ReportInput => {
    const pv = (fn: (d: any[], m: any[]) => any) =>
      allFilteredDemandsList.map((d, i) => fn(d, allFilteredMeasurementsList[i] ?? []));

    const noInstructor = (d: any[]) =>
      d.filter((x: any) => {
        const s = getCalculatedStatus(x);
        if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        if (isOnlineDemand(x)) return false;
        return !x.instructorId;
      }).length;

    const calcCosts = (_d: any[], m: any[]) =>
      m.reduce((acc: number, x: any) =>
        acc + x.attachments.reduce((s: number, a: any) => {
          const v = typeof a.value === 'string' ? parseFloat(a.value.replace(',', '.')) : Number(a.value);
          return s + (Number(v) || 0);
        }, 0), 0);

    return {
      title: '',
      generatedAt: new Date(),
      periods: allFilteredDemandsList.map((_, i) => ({
        label:     `P${i + 1}`,
        color:     PERIOD_COLORS[i % PERIOD_COLORS.length],
        startDate: i === 0 ? (filters.startDate || '') : (extraPeriods[i - 1]?.startDate || ''),
        endDate:   i === 0 ? (filters.endDate   || '') : (extraPeriods[i - 1]?.endDate   || ''),
      })),
      activeFilters: [
        ...(filters.companyId    ? [{ label: 'Empresa',   value: companies.find(c => c.id === filters.companyId)?.name || '' }] : []),
        ...(filters.regionId     ? [{ label: 'Região',    value: regions.find(r => r.id === filters.regionId)?.name   || '' }] : []),
        ...(filters.status       ? [{ label: 'Status',    value: STATUS_LABELS[filters.status] || filters.status }] : []),
        ...(filters.trainingLocal? [{ label: 'Local',     value: filters.trainingLocal }] : []),
        ...(filters.corredor     ? [{ label: 'Corredor',  value: filters.corredor }] : []),
        ...(filters.demandState  ? [{ label: 'UF',        value: filters.demandState }] : []),
      ],
      chartElements: chartRefsMap.current,
      tabs: [
        {
          id: 'GERAL', label: 'Geral',
          kpis: [
            { title: 'Total de Demandas',      values: pv(d => d.length) },
            { title: 'Horas Ministradas',      values: instructorHoursMapsByPeriod.map(map => sumInstructorHours(map)) },
            { title: 'Pendência de Alocação',  values: pv(noInstructor), positiveIsGood: false },
            { title: 'Treinamentos Concluídos',values: pv(d => d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA').length) },
            { title: 'Demandas Canceladas',    values: pv(d => d.filter((x: any) => x.status === 'CANCELADA').length), positiveIsGood: false },
          ],
          rankings: [{
            title: 'Volume por Região',
            rows: regions.map(r => ({
              name:   r.name,
              values: allFilteredDemandsList.map(d => d.filter((x: any) => x.regionId === r.id).length),
            })).filter(r => r.values.some(v => v > 0)).sort((a, b) => b.values[0] - a.values[0]),
          }],
        },
        {
          id: 'OPERACIONAL', label: 'Operacional',
          kpis: [
            { title: 'Aguardando Instrutor', values: pv(noInstructor), positiveIsGood: false },
            { title: 'Alocadas',             values: pv(d => d.filter((x: any) => getCalculatedStatus(x) === 'ALOCADA').length) },
            { title: 'Concluídas',           values: pv(d => d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA').length) },
            { title: 'Taxa de Execução',     values: pv(d => { const c = d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA'); const a = d.filter((x: any) => getCalculatedStatus(x) !== 'CANCELADA'); return a.length > 0 ? `${Math.round((c.length / a.length) * 100)}%` : '0%'; }) },
          ],
        },
        {
          id: 'INSTRUTORES', label: 'Instrutores',
          kpis: [
            { title: 'Horas Concluídas',     values: instructorHoursMapsByPeriod.map(map => sumInstructorHours(map)) },
            { title: 'Sem Demanda no Período', values: pv(d => { const w = new Set(d.filter((x: any) => x.instructorId).map((x: any) => x.instructorId)); return instructors.filter((i: any) => i.status === 'ATIVO' && !w.has(i.id)).length; }), positiveIsGood: false },
          ],
          rankings: [{
            title: 'Carga Horária por Instrutor',
            rows: instructors.filter((i: any) => i.status === 'ATIVO').map((inst: any) => ({
              name:   inst.name,
              values: instructorHoursMapsByPeriod.map(map => map.get(inst.id)?.horas ?? 0),
            })).filter(r => r.values.some((v: number) => v > 0)).sort((a, b) => b.values[0] - a.values[0]).slice(0, 10),
          }],
        },
        {
          id: 'CLIENTES', label: 'Clientes',
          kpis: [
            { title: 'Total de Demandas', values: pv(d => d.length) },
          ],
          rankings: [{
            title: 'Volume por Cliente',
            rows: companies.map(c => ({
              name:   c.name,
              values: allFilteredDemandsList.map(d => d.filter((x: any) => x.companyId === c.id).length),
            })).filter(r => r.values.some(v => v > 0)).sort((a, b) => b.values[0] - a.values[0]).slice(0, 10),
          }],
        },
        {
          id: 'CUSTOS', label: 'Custos',
          kpis: [
            { title: 'Total em Despesas',   values: pv(calcCosts), isCurrency: true },
            { title: 'Pronta Faturamento', values: pv((_d, m) => m.filter((x: any) => x.status === 'PRONTA_FATURAMENTO').length) },
            { title: 'Faturadas',          values: pv((_d, m) => m.filter((x: any) => x.status === 'FATURADA').length) },
            { title: 'Ticket Médio',       values: pv((d, m) => { const cost = calcCosts(d, m); return m.length > 0 ? cost / m.length : 0; }), isCurrency: true },
          ],
        },
      ],
    };
  }, [allFilteredDemandsList, allFilteredMeasurementsList, filters, companies, regions, instructors, trainings, extraPeriods, instructorHoursMapsByPeriod]);

  // --- Componentes de UI ---
  const KPICard = ({ title, value, subtext, icon: Icon, colorClass, isCurrency = false, isTrend = false, compareValue, positiveIsGood = true, periods }: any) => {
    const fmt = (v: any) => isCurrency
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v))
      : v;

    const toNum = (v: any): number => {
      if (typeof v === 'string') {
        const clean = v.replace('%', '').replace('h', '').replace(/[R$\s.]/g, '').replace(',', '.');
        return parseFloat(clean) || 0;
      }
      return Number(v) || 0;
    };

    // --- Multi-período (2+ períodos) ---
    if (periods && periods.length >= 2) {
      const first = periods[0];
      return (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 group-hover:text-slate-600 transition-colors">{title}</p>
            <div className="space-y-1">
              {periods.map((p: any, i: number) => {
                const delta = i > 0 ? toNum(p.value) - toNum(first.value) : null;
                const pct = delta !== null && toNum(first.value) !== 0
                  ? Math.round((delta / toNum(first.value)) * 100)
                  : null;
                const isGood = delta !== null && (positiveIsGood ? delta >= 0 : delta <= 0);
                return (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: p.color }}>{p.label}</span>
                    <span className={`font-black text-slate-800 leading-none ${i === 0 ? 'text-xl' : 'text-base text-slate-600'}`}>{fmt(p.value)}</span>
                    {delta !== null && (
                      <span className={`text-[9px] font-black flex items-center gap-0.5 ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isGood ? '↑' : '↓'}{delta >= 0 ? '+' : ''}{isCurrency ? fmt(delta) : delta}
                        {pct !== null && <span className="opacity-70">({pct > 0 ? '+' : ''}{pct}%)</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {subtext && <p className="text-[10px] text-slate-500 font-bold mt-1.5 uppercase flex items-center gap-1">{subtext}</p>}
          </div>
          <div className={`p-3 rounded-xl ${colorClass} group-hover:scale-110 transition-transform shrink-0 ml-3`}>
            <Icon size={20} />
          </div>
        </div>
      );
    }

    const showCompare = compareMode && compareValue !== undefined;
    const delta = showCompare ? toNum(value) - toNum(compareValue) : null;
    const pct = delta !== null && toNum(compareValue) !== 0
      ? Math.round((delta / toNum(compareValue)) * 100)
      : null;
    const isGood = delta !== null && (positiveIsGood ? delta >= 0 : delta <= 0);

    return (
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">{title}</p>
          {showCompare ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[8px] font-black text-blue-400 uppercase tracking-wider bg-blue-50 px-1 rounded">P1</span>
                <span className="text-xl font-black text-slate-800">{fmt(value)}</span>
              </div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-[8px] font-black text-emerald-500 uppercase tracking-wider bg-emerald-50 px-1 rounded">P2</span>
                <span className="text-base font-black text-slate-500">{fmt(compareValue)}</span>
              </div>
              {delta !== null && (
                <div className={`flex items-center gap-1 mt-1 text-[10px] font-black ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
                  {isGood ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {delta >= 0 ? '+' : ''}{isCurrency ? fmt(delta) : delta}
                  {pct !== null && <span className="opacity-70">({pct > 0 ? '+' : ''}{pct}%)</span>}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-black text-slate-800">{fmt(value)}</h3>
              {isTrend && <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-0.5"><TrendingUp size={10} /> +12%</span>}
            </div>
          )}
          {subtext && <p className="text-[10px] text-slate-500 font-bold mt-1.5 uppercase flex items-center gap-1">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-xl ${colorClass} group-hover:scale-110 transition-transform shrink-0 ml-3`}>
          <Icon size={20} />
        </div>
      </div>
    );
  };

  const AlertBar = ({ message, type = 'warning', children, onMouseEnter, onMouseLeave }: { message: string, type?: 'warning' | 'error' | 'info', children?: React.ReactNode, onMouseEnter?: () => void, onMouseLeave?: () => void }) => {
    const styles = {
      warning: 'bg-amber-50 text-amber-700 border-amber-200',
      error: 'bg-red-50 text-red-700 border-red-200',
      info: 'bg-blue-50 text-blue-700 border-blue-200'
    };
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-bold ${styles[type]} transition-all hover:shadow-sm relative`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="flex items-center gap-3">
          {type === 'error' ? <ShieldAlert size={16} /> : (type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />)}
          <span>{message}</span>
        </div>
        {children}
      </div>
    );
  };

  const renderGeral = () => {
    const statusData = Object.keys(STATUS_LABELS).map(key => ({
      name: STATUS_LABELS[key],
      value: filteredDemands.filter(d => getCalculatedStatus(d) === key).length,
      color: (COLORS[key as keyof typeof COLORS] as string) || '#CBD5E1'
    })).filter(d => d.value > 0);

    const statusData2 = compareMode ? Object.keys(STATUS_LABELS).map(key => ({
      name: STATUS_LABELS[key],
      value: filteredDemands2.filter(d => getCalculatedStatus(d) === key).length,
      color: (COLORS[key as keyof typeof COLORS] as string) || '#CBD5E1'
    })).filter(d => d.value > 0) : [];

    // Para 3+ períodos: dados agrupados por status (barras agrupadas)
    const statusBarData = extraPeriods.length >= 2
      ? Object.keys(STATUS_LABELS).map(key => {
          const row: any = { name: STATUS_LABELS[key] };
          allFilteredDemandsList.forEach((dList, i) => {
            row[`P${i + 1}`] = dList.filter(d => getCalculatedStatus(d) === key).length;
          });
          return row;
        }).filter(row => allFilteredDemandsList.some((_, i) => (row[`P${i + 1}`] ?? 0) > 0))
      : [];

    const regionalData = regions.map(r => {
      const row: any = {
        name: r.name,
        value: filteredDemands.filter(d => d.regionId === r.id).length,
      };
      if (compareMode) {
        allFilteredDemandsList.slice(1).forEach((dList, i) => {
          row[`value${i + 2}`] = dList.filter(d => d.regionId === r.id).length;
        });
      }
      return row;
    }).sort((a: any, b: any) => b.value - a.value);

    // --- Dados para insights Local/Corredor/UF ---
    const buildTop = (src: Demand[], extract: (d: Demand) => string, limit = 10) => {
      const counts: Record<string, number> = {};
      src.forEach(d => {
        const v = (extract(d) ?? '').trim();
        if (!v) return;
        counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const items = sorted.slice(0, limit).map(([name, value]) => ({ name, value }));
      const othersDetail = sorted.slice(limit).map(([name, value]) => ({ name, value }));
      return { items, othersDetail };
    };

    const buildTopHours = (src: Demand[], extract: (d: Demand) => string, limit = 10) => {
      const sums: Record<string, number> = {};
      src.forEach(d => {
        const v = (extract(d) ?? '').trim();
        if (!v) return;
        sums[v] = (sums[v] || 0) + getTrainingHours(d.trainingId);
      });
      const sorted = Object.entries(sums).sort((a, b) => b[1] - a[1]);
      const items = sorted.slice(0, limit).map(([name, value]) => ({ name, value }));
      const othersDetail = sorted.slice(limit).map(([name, value]) => ({ name, value }));
      return { items, othersDetail };
    };

    const localData    = buildTop(filteredDemands, d => d.trainingLocal ?? '');
    const corredorData = buildTop(filteredDemands, d => d.corredor ?? '');
    const ufData       = buildTop(filteredDemands, d => d.demandState ?? '');

    const localData2    = compareMode ? buildTop(filteredDemands2, d => d.trainingLocal ?? '') : null;
    const corredorData2 = compareMode ? buildTop(filteredDemands2, d => d.corredor ?? '') : null;
    const ufData2       = compareMode ? buildTop(filteredDemands2, d => d.demandState ?? '') : null;

    const localDisplay    = localView    === 'hours' ? buildTopHours(filteredDemands, d => d.trainingLocal ?? '') : localData;
    const corredorDisplay = corredorView === 'hours' ? buildTopHours(filteredDemands, d => d.corredor ?? '') : corredorData;
    const ufDisplay       = ufView       === 'hours' ? buildTopHours(filteredDemands, d => d.demandState ?? '') : ufData;

    const localDisplay2    = compareMode ? (localView    === 'hours' ? buildTopHours(filteredDemands2, d => d.trainingLocal ?? '') : localData2) : null;
    const corredorDisplay2 = compareMode ? (corredorView === 'hours' ? buildTopHours(filteredDemands2, d => d.corredor ?? '') : corredorData2) : null;
    const ufDisplay2       = compareMode ? (ufView       === 'hours' ? buildTopHours(filteredDemands2, d => d.demandState ?? '') : ufData2) : null;

    // REGRAS DE ALERTA OPERACIONAIS
    const noInstructorDemands = filteredDemands.filter(d => {
      const status = getCalculatedStatus(d);
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    });

    const noInstructorDemands2 = compareMode ? filteredDemands2.filter(d => {
      const status = getCalculatedStatus(d);
      if (status === 'CANCELADA' || status === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    }) : [];

    const noMeasurementDemands = filteredDemands.filter(d => {
      const isConcluido = getCalculatedStatus(d) === 'CONCLUIDA';
      const hasInstructor = !!d.instructorId;
      const measurement = measurements.find(m => m.demandId === d.id);
      const noMeasurement = !measurement || measurement.status === 'NAO_INICIADA';
      return isConcluido && hasInstructor && noMeasurement;
    });

    // DEMANDAS CANCELADAS
    const cancelledDemands  = filteredDemands.filter(d => d.status === 'CANCELADA');
    const cancelledDemands2 = compareMode ? filteredDemands2.filter(d => d.status === 'CANCELADA') : [];

    return (
      <div className="space-y-6 animate-fade-in" ref={(el) => { chartRefsMap.current['GERAL'] = el; }}>

        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 px-1 text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[0] }}>
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[0] }} />
              P1: {getPeriodLabel(filters.startDate, filters.endDate)}
            </span>
            {extraPeriods.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }}>
                <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }} />
                P{i + 2}: {getPeriodLabel(p.startDate, p.endDate)}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPICard title="Total de Demandas" value={filteredDemands.length} compareValue={compareMode ? filteredDemands2.length : undefined} periods={mkPeriods(d => d.length)} icon={Briefcase} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Total de Horas" value={`${totalAllHours}h`} compareValue={compareMode ? `${totalAllHours2}h` : undefined} periods={mkPeriods(d => `${d.reduce((a: number, x: any) => a + getTrainingHours(x.trainingId), 0)}h`)} icon={Clock} colorClass="bg-violet-50 text-violet-600" subtext="Todas as Demandas" />
          <KPICard title="Horas Concluídas" value={`${formatHoursValue(totalHours)}h`} compareValue={compareMode ? `${formatHoursValue(totalHours2)}h` : undefined} periods={hoursConcluidasPeriods} icon={Clock} colorClass="bg-emerald-50 text-emerald-600" subtext="Execuções Finalizadas" />
          <KPICard title="Pendência de Alocação" value={noInstructorDemands.length} compareValue={compareMode ? noInstructorDemands2.length : undefined} positiveIsGood={false} periods={mkPeriods(d => d.filter((x: any) => { const s = getCalculatedStatus(x); if (s === 'CANCELADA' || s === 'CONCLUIDA') return false; if (isOnlineDemand(x)) return false; return !x.instructorId; }).length)} icon={AlertCircle} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Treinamentos Concluídos" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA').length} compareValue={compareMode ? filteredDemands2.filter(d => getCalculatedStatus(d) === 'CONCLUIDA').length : undefined} periods={mkPeriods(d => d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA').length)} icon={CheckCircle} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Demandas Canceladas" value={cancelledDemands.length} compareValue={compareMode ? cancelledDemands2.length : undefined} positiveIsGood={false} periods={mkPeriods(d => d.filter((x: any) => x.status === 'CANCELADA').length)} icon={Ban} colorClass="bg-slate-100 text-slate-500" subtext="Histórico Inativo" />
        </div>

        {hibridSemPracticalHours.length > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-amber-800 uppercase tracking-wide">
                {hibridSemPracticalHours.length} demanda{hibridSemPracticalHours.length !== 1 ? 's' : ''} híbrida{hibridSemPracticalHours.length !== 1 ? 's' : ''} sem horas práticas cadastradas
              </p>
              <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                "Horas Concluídas" está usando a carga horária total do treinamento pra essas demandas, em vez das horas práticas.
                Cadastre em Cadastros → Treinamentos: {[...new Set(hibridSemPracticalHours.map(d => getTrainingName(d.trainingId)))].join(', ')}.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-between">
              <span>Distribuição de Status (Real)</span>
              <Target size={14} />
            </h3>
            <div className="flex-1 min-h-0">
              {compareMode && extraPeriods.length >= 2 ? (
                /* 3+ períodos → barras agrupadas por status */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusBarData} margin={{ top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9 }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }} onClick={(e: any) => toggleSeries(`status-${e.dataKey}`)} />
                    {allFilteredDemandsList.map((_, i) => (
                      <Bar key={i} dataKey={`P${i + 1}`} name={`P${i + 1}`} fill={PERIOD_COLORS[i % PERIOD_COLORS.length]} radius={[3, 3, 0, 0]} barSize={14} hide={hiddenSeries[`status-P${i + 1}`]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : compareMode ? (
                /* 2 períodos → dois donuts lado a lado */
                <div className="flex h-full gap-2">
                  <div className="flex-1 flex flex-col">
                    <p className="text-[8px] font-black uppercase text-center mb-1" style={{ color: PERIOD_COLORS[0] }}>P1</p>
                    {statusData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={4} dataKey="value">
                            {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                          </Pie>
                          <Tooltip />
                          <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs">Sem dados</div>}
                  </div>
                  <div className="w-px bg-slate-100 shrink-0" />
                  <div className="flex-1 flex flex-col">
                    <p className="text-[8px] font-black uppercase text-center mb-1" style={{ color: PERIOD_COLORS[1] }}>P2</p>
                    {statusData2.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={statusData2} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={4} dataKey="value">
                            {statusData2.map((entry, index) => <Cell key={`cell2-${index}`} fill={entry.color} />)}
                          </Pie>
                          <Tooltip />
                          <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs">Sem dados para P2</div>}
                  </div>
                </div>
              ) : statusData.length > 0 ? (
                /* 1 período → donut simples */
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                      {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados de demandas</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-80 flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex justify-between">
              <span>Volume por Região</span>
              <MapPin size={14} />
            </h3>
            <div className="flex-1 min-h-0">
              {filteredDemands.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionalData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: '#F8FAFC' }} />
                    {compareMode && <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }} onClick={(e: any) => toggleSeries(`regional-${e.dataKey}`)} />}
                    <Bar dataKey="value" name="P1" fill={PERIOD_COLORS[0]} radius={[4, 4, 0, 0]} barSize={compareMode ? Math.max(8, Math.floor(36 / allFilteredDemandsList.length)) : 40} hide={hiddenSeries['regional-value']} />
                    {compareMode && allFilteredDemandsList.slice(1).map((_, i) => (
                      <Bar key={i + 2} dataKey={`value${i + 2}`} name={`P${i + 2}`} fill={PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length]} radius={[4, 4, 0, 0]} barSize={Math.max(8, Math.floor(36 / allFilteredDemandsList.length))} hide={hiddenSeries[`regional-value${i + 2}`]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados regionais</div>
              )}
            </div>
          </div>
        </div>

        {/* --- INSIGHTS: Local / Corredor / UF --- */}
        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 text-[9px] font-black uppercase tracking-widest px-1">
            {allFilteredDemandsList.map((_, i) => (
              <span key={i} className="flex items-center gap-1" style={{ color: PERIOD_COLORS[i % PERIOD_COLORS.length] }}>
                <span className="w-2 h-1.5 rounded-sm inline-block" style={{ background: PERIOD_COLORS[i % PERIOD_COLORS.length] }} />
                P{i + 1}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Volume por Local do Treinamento */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Local</span>
              <div className="flex items-center gap-1.5">
                {localDisplay.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded-md">
                    +{localDisplay.othersDetail.length} ocultos
                  </span>
                )}
                <MapPin size={13} />
              </div>
            </h3>
            <div className="flex gap-1 mb-3 shrink-0">
              <button onClick={() => setLocalView('count')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${localView === 'count' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Qtd. Treinamentos</button>
              <button onClick={() => setLocalView('hours')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${localView === 'hours' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Horas</button>
            </div>
            <RankedListChart
              items={localDisplay.items}
              othersDetail={localDisplay.othersDetail}
              barColor="bg-blue-500"
              items2={localDisplay2?.items}
              valueFormatter={localView === 'hours' ? v => `${v}h` : undefined}
            />
          </div>

          {/* Volume por Corredor */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Corredor</span>
              <div className="flex items-center gap-1.5">
                {corredorDisplay.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-emerald-50 text-emerald-400 px-1.5 py-0.5 rounded-md">
                    +{corredorDisplay.othersDetail.length} ocultos
                  </span>
                )}
                <Truck size={13} />
              </div>
            </h3>
            <div className="flex gap-1 mb-3 shrink-0">
              <button onClick={() => setCorredorView('count')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${corredorView === 'count' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Qtd. Treinamentos</button>
              <button onClick={() => setCorredorView('hours')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${corredorView === 'hours' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Horas</button>
            </div>
            <RankedListChart
              items={corredorDisplay.items}
              othersDetail={corredorDisplay.othersDetail}
              barColor="bg-emerald-500"
              items2={corredorDisplay2?.items}
              valueFormatter={corredorView === 'hours' ? v => `${v}h` : undefined}
            />
          </div>

          {/* Volume por UF */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Volume por Estado (UF)</span>
              <div className="flex items-center gap-1.5">
                {ufDisplay.othersDetail.length > 0 && (
                  <span className="text-[9px] font-black bg-amber-50 text-amber-400 px-1.5 py-0.5 rounded-md">
                    +{ufDisplay.othersDetail.length} ocultos
                  </span>
                )}
                <Target size={13} />
              </div>
            </h3>
            <div className="flex gap-1 mb-3 shrink-0">
              <button onClick={() => setUfView('count')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${ufView === 'count' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Qtd. Treinamentos</button>
              <button onClick={() => setUfView('hours')} className={`text-[9px] font-black px-2 py-0.5 rounded-md transition-colors ${ufView === 'hours' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>Horas</button>
            </div>
            <RankedListChart
              items={ufDisplay.items}
              othersDetail={ufDisplay.othersDetail}
              barColor="bg-amber-500"
              items2={ufDisplay2?.items}
              valueFormatter={ufView === 'hours' ? v => `${v}h` : undefined}
            />
          </div>
        </div>

      </div>
    );
  };

  const renderOperacional = () => {
    const next7  = new Date(today.getTime() + 7  * 24 * 60 * 60 * 1000);
    const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const concluded  = filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA');
    const activeDmds = filteredDemands.filter(d => getCalculatedStatus(d) !== 'CANCELADA');
    const execRate   = activeDmds.length > 0 ? Math.round((concluded.length / activeDmds.length) * 100) : 0;
    const execColor  = execRate >= 70 ? '#10B981' : execRate >= 40 ? '#F59E0B' : '#EF4444';

    const noInstructor = filteredDemands.filter(d => {
      const s = getCalculatedStatus(d);
      if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    }).length;

    // Agenda 7 dias: em andamento OU com início nos próximos 7 dias (não canceladas/concluídas)
    const agenda7 = filteredDemands
      .filter(d => {
        const s = getCalculatedStatus(d);
        if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        const start = new Date(d.startDate);
        const end   = new Date(d.endDate);
        return start <= next7 && end >= today;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Top treinamentos no período
    const buildTrainingTop = (src: Demand[], limit = 8) => {
      const counts: Record<string, number> = {};
      src.forEach(d => {
        const name = trainings.find(t => t.id === d.trainingId)?.name;
        if (name) counts[name] = (counts[name] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return { items: sorted.slice(0, limit).map(([name, value]) => ({ name, value })), others: sorted.slice(limit).map(([name, value]) => ({ name, value })) };
    };
    const { items: topTrainings, others: othersTrainings } = buildTrainingTop(filteredDemands);
    const topTrainings2 = compareMode ? buildTrainingTop(filteredDemands2).items : undefined;

    // Ranking instrutores por demandas no período
    const buildInstructorTop = (src: Demand[], limit = 8) => {
      const counts: Record<string, number> = {};
      src.filter(d => d.instructorId).forEach(d => { counts[d.instructorId!] = (counts[d.instructorId!] || 0) + 1; });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([id, value]) => ({ name: instructors.find(i => i.id === id)?.name || id, value }));
    };
    const topInstructors  = buildInstructorTop(filteredDemands);
    const topInstructors2 = compareMode ? buildInstructorTop(filteredDemands2) : undefined;

    // Modalidade
    const modalTotal = filteredDemands.length || 1;
    const modalities = [
      { label: 'Presencial', value: filteredDemands.filter(d => getDemandModality(d) === 'PRESENCIAL').length, color: 'bg-blue-500' },
      { label: 'Online / EAD', value: filteredDemands.filter(d => ['ONLINE','EAD','ONLINE_AO_VIVO'].includes(getDemandModality(d))).length, color: 'bg-emerald-500' },
      { label: 'Híbrido', value: filteredDemands.filter(d => getDemandModality(d) === 'HIBRIDO').length, color: 'bg-violet-500' },
    ].filter(m => m.value > 0);

    // Valores de comparação para Operacional
    const noInstructor2 = compareMode ? filteredDemands2.filter(d => {
      const s = getCalculatedStatus(d);
      if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
      if (isOnlineDemand(d)) return false;
      return !d.instructorId;
    }).length : undefined;
    const alocadas2 = compareMode ? filteredDemands2.filter(d => getCalculatedStatus(d) === 'ALOCADA').length : undefined;
    const concluded2 = compareMode ? filteredDemands2.filter(d => getCalculatedStatus(d) === 'CONCLUIDA') : [];
    const activeDmds2 = compareMode ? filteredDemands2.filter(d => getCalculatedStatus(d) !== 'CANCELADA') : [];
    const execRate2 = compareMode && activeDmds2.length > 0 ? Math.round((concluded2.length / activeDmds2.length) * 100) : undefined;

    return (
      <div className="space-y-6 animate-fade-in" ref={(el) => { chartRefsMap.current['OPERACIONAL'] = el; }}>

        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 px-1 text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[0] }}>
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[0] }} />
              P1: {getPeriodLabel(filters.startDate, filters.endDate)}
            </span>
            {extraPeriods.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }}>
                <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }} />
                P{i + 2}: {getPeriodLabel(p.startDate, p.endDate)}
              </span>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title="Aguardando Instrutor" value={noInstructor} compareValue={noInstructor2} positiveIsGood={false} periods={mkPeriods(d => d.filter((x: any) => { const s = getCalculatedStatus(x); if (s === 'CANCELADA' || s === 'CONCLUIDA') return false; if (isOnlineDemand(x)) return false; return !x.instructorId; }).length)} icon={AlertCircle} colorClass="bg-orange-50 text-orange-600" />
          <KPICard title="Alocadas" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'ALOCADA').length} compareValue={alocadas2} periods={mkPeriods(d => d.filter((x: any) => getCalculatedStatus(x) === 'ALOCADA').length)} icon={Calendar} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Em Execução Hoje" value={filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length} periods={mkPeriods(d => d.filter((x: any) => getCalculatedStatus(x) === 'EM_ANDAMENTO').length)} icon={Zap} colorClass="bg-emerald-50 text-emerald-600" />
          <KPICard title="Próximos 30 Dias" value={filteredDemands.filter(d => { const s = new Date(d.startDate); return s > today && s <= next30; }).length} icon={Clock} colorClass="bg-indigo-50 text-indigo-600" />
          <KPICard title="Taxa de Execução" value={`${execRate}%`} compareValue={compareMode && execRate2 !== undefined ? `${execRate2}%` : undefined} periods={mkPeriods(d => { const conc = d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA'); const act = d.filter((x: any) => getCalculatedStatus(x) !== 'CANCELADA'); return act.length > 0 ? `${Math.round((conc.length / act.length) * 100)}%` : '0%'; })} icon={TrendingUp} colorClass="bg-teal-50 text-teal-600" subtext={`${concluded.length} de ${activeDmds.length} concluídas`} />
        </div>

        {/* Top Treinamentos + Demandas por Instrutor + Perfil do Período */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Top Treinamentos */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Top Treinamentos</span>
              <Package size={13} className="text-slate-300" />
            </h3>
            <RankedListChart items={topTrainings} othersDetail={othersTrainings} barColor="bg-violet-500" emptyLabel="Sem treinamentos no período" items2={topTrainings2} />
          </div>

          {/* Demandas por Instrutor */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between shrink-0">
              <span>Demandas por Instrutor</span>
              <UserCheck size={13} className="text-slate-300" />
            </h3>
            <RankedListChart items={topInstructors} othersDetail={[]} barColor="bg-blue-500" emptyLabel="Sem instrutores alocados" items2={topInstructors2} />
          </div>

          {/* Perfil do Período */}
          <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-5" style={{ minHeight: '22rem' }}>

            {/* Modalidade */}
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                <span>Modalidade</span>
                <MousePointer2 size={13} className="text-slate-300" />
              </h3>
              {modalities.length > 0 ? (
                <div className="space-y-2.5">
                  {modalities.map(m => (
                    <div key={m.label} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 w-24 shrink-0">{m.label}</span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${m.color}`} style={{ width: `${Math.round((m.value / modalTotal) * 100)}%` }} />
                      </div>
                      <span className="text-[10px] font-black text-slate-700 w-6 text-right shrink-0">{m.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-300 italic">Sem dados no período</p>
              )}
            </div>

            {/* Taxa de Execução — donut */}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Taxa de Execução</h3>
              <div className="flex items-center gap-4">
                <div className="relative w-[72px] h-[72px] shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F1F5F9" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={execColor} strokeWidth="3.5"
                      strokeDasharray={`${execRate} ${100 - execRate}`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[13px] font-black text-slate-800">{execRate}%</span>
                  </div>
                </div>
                <div className="space-y-1.5 flex-1">
                  {[
                    { label: 'Concluídas', count: concluded.length, dot: 'bg-emerald-500' },
                    { label: 'Em andamento', count: filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length, dot: 'bg-blue-400' },
                    { label: 'Pendentes', count: filteredDemands.filter(d => ['NOVA','PENDENTE','ALOCADA'].includes(getCalculatedStatus(d))).length, dot: 'bg-amber-400' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.dot}`} />
                      <span className="text-[10px] font-bold text-slate-400">{row.label}</span>
                      <span className="text-[10px] font-black text-slate-700 ml-auto">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agenda dos Próximos 7 Dias */}
        {(() => {
          const totalPages7 = Math.max(1, Math.ceil(agenda7.length / AGENDA7_PER_PAGE));
          const safePage7   = Math.min(agenda7Page, totalPages7);
          const startIdx7   = (safePage7 - 1) * AGENDA7_PER_PAGE;
          const pageItems7  = agenda7.slice(startIdx7, startIdx7 + AGENDA7_PER_PAGE);
          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Agenda dos Próximos 7 Dias</h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                    {agenda7.length} demanda{agenda7.length !== 1 ? 's' : ''} em execução ou com início previsto
                  </p>
                </div>
                <Calendar size={14} className="text-slate-300" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                      <th className="px-4 py-3 whitespace-nowrap">ID</th>
                      <th className="px-4 py-3 whitespace-nowrap">Início</th>
                      <th className="px-4 py-3 whitespace-nowrap">Empresa</th>
                      <th className="px-4 py-3 whitespace-nowrap">Treinamento</th>
                      <th className="px-4 py-3 whitespace-nowrap">Instrutor</th>
                      <th className="px-4 py-3 whitespace-nowrap">Local</th>
                      <th className="px-4 py-3 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pageItems7.length > 0 ? pageItems7.map(d => {
                      const cStatus    = getCalculatedStatus(d);
                      const instructor = instructors.find(i => i.id === d.instructorId);
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 text-[11px] font-black text-blue-600 font-mono whitespace-nowrap">{d.id}</td>
                          <td className="px-4 py-3 text-[11px] font-bold text-slate-600 whitespace-nowrap">
                            {new Date(d.startDate).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-4 py-3 text-[11px] font-bold text-slate-700 max-w-[140px] truncate" title={companies.find(c => c.id === d.companyId)?.name}>
                            {companies.find(c => c.id === d.companyId)?.name || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 max-w-[200px] truncate" title={trainings.find(t => t.id === d.trainingId)?.name}>
                            {trainings.find(t => t.id === d.trainingId)?.name || '—'}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-600 whitespace-nowrap">
                            {instructor
                              ? instructor.name.split(' ').slice(0, 2).join(' ')
                              : <span className="text-amber-500 font-bold text-[10px] uppercase">Sem instrutor</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{d.trainingLocal || '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${STATUS_BADGE[cStatus] || 'bg-slate-100 text-slate-500'}`}>
                              {STATUS_LABELS[cStatus] || cStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-slate-300 italic text-xs uppercase font-bold">
                          Nenhuma demanda prevista nos próximos 7 dias.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={safePage7}
                totalPages={totalPages7}
                totalItems={agenda7.length}
                itemsPerPage={AGENDA7_PER_PAGE}
                startIdx={startIdx7}
                entityLabel="demandas"
                onPageChange={setAgenda7Page}
                onItemsPerPageChange={() => {}}
                hideSizeSelector
              />
            </div>
          );
        })()}

      </div>
    );
  };

  const renderInstrutores = () => {
    const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const activeInstructors = instructors.filter(i => i.status === 'ATIVO');

    // --- Horas Ministradas por Instrutor (fonte: instructor_allocations, período filtrado) ---
    // ✅ Mesma fonte usada pelo KPI "Horas Concluídas"/"Produtividade Global" e pelo export
    // XLSX — nenhuma lógica duplicada. Mostra TODOS os instrutores com horas > 0 (não só
    // top 10): com dezenas de instrutores, o card rola verticalmente.
    // Os dois recortes NÃO se somam: o toggle do card troca de dataset. Cliente
    // e interna respondem a perguntas diferentes ("quanto entregou ao cliente"
    // vs "quanto gastou em trabalho interno") e misturá-las num número só
    // escondia as duas. Mesma função, mesmo layout, datasets separados.
    const rankingMap = instructorRanking === 'INTERNAS'
      ? (internaHoursMapsByPeriod[0] ?? new Map<string, InstructorHoursEntry>())
      : (instructorHoursMapsByPeriod[0] ?? new Map<string, InstructorHoursEntry>());
    const instructorHoursList = activeInstructors
      .map(inst => {
        const entry = rankingMap.get(inst.id);
        return {
          id: inst.id,
          name: inst.name,
          horas: entry?.horas ?? 0,
          nDemandas: entry?.nDemandas ?? 0,
          nDivididas: entry?.nDivididas ?? 0,
        };
      })
      .filter(r => r.horas > 0)
      .sort((a, b) => b.horas - a.horas);
    const maxInstructorHours = Math.max(...instructorHoursList.map(r => r.horas), 1);

    // --- Risco de dependência ---
    const dependencyRisk = trainings.filter(t => t.status === 'ATIVO').map(t => ({
      name: t.nr || t.name.substring(0, 20),
      fullName: t.name,
      count: instructors.filter(i => i.skills.some(s => s.trainingId === t.id && s.level >= 3)).length,
    })).filter(r => r.count <= 1).sort((a, b) => a.count - b.count).slice(0, 10);

    // --- Disponibilidade nos próximos 30 dias ---
    // A regra saiu daqui para domain/instructorAvailability.ts, para que o card
    // "Cobertura de Ociosidade" (aba INTERNAS) use a MESMA definição em vez de
    // reimplementá-la. Comportamento idêntico ao anterior.
    const availableNext30 = getAvailableInstructors<Instructor, Demand>(
      instructors,
      demands,
      { from: today, to: next30 },
      { statusOf: getCalculatedStatus }
    );

    // --- Sem demanda no período filtrado ---
    const instructorsWithDemandIds = new Set(
      filteredDemands.filter(d => d.instructorId).map(d => d.instructorId!)
    );
    const noDemandsInPeriod = activeInstructors.filter(i => !instructorsWithDemandIds.has(i.id));

    // --- Taxa de reaproveitamento (múltiplos treinamentos distintos concluídos) ---
    const reuseStats = activeInstructors.map(inst => {
      const distinct = new Set(
        demands
          .filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA')
          .map(d => d.trainingId)
      );
      return { inst, count: distinct.size };
    }).filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const reuseRate = activeInstructors.length > 0
      ? Math.round((reuseStats.filter(x => x.count >= 2).length / activeInstructors.length) * 100)
      : 0;
    const topReuseItems    = reuseStats.slice(0, 8).map(x => ({ name: x.inst.name.split(' ').slice(0, 2).join(' '), value: x.count }));
    const othersReuseItems = reuseStats.slice(8).map(x => ({ name: x.inst.name.split(' ').slice(0, 2).join(' '), value: x.count }));

    // --- Distribuição geográfica: instrutores habilitados vs demandas por região ---
    const geoData = regions.map(r => ({
      region: r.name,
      instructors: activeInstructors.filter(i => i.regionIds?.includes(r.id)).length,
      demands: filteredDemands.filter(d => d.regionId === r.id).length,
    })).filter(g => g.instructors > 0 || g.demands > 0).sort((a, b) => b.demands - a.demands);
    const geoMaxDemands = Math.max(...geoData.map(x => x.demands), 1);
    const geoMaxInstr   = Math.max(...geoData.map(x => x.instructors), 1);

    // --- Cobertura de competências por categoria ---
    const trainingCategories = [...new Set(trainings.filter(t => t.status === 'ATIVO').map(t => t.category))];
    const competenceCoverage = trainingCategories.map(cat => {
      const catTrainings = trainings.filter(t => t.category === cat && t.status === 'ATIVO');
      const aptCount     = activeInstructors.filter(i =>
        catTrainings.some(t => i.skills.some(s => s.trainingId === t.id && s.level >= 3))
      ).length;
      const demandCount  = filteredDemands.filter(d => catTrainings.some(t => t.id === d.trainingId)).length;
      const ratio        = demandCount > 0 ? aptCount / demandCount : aptCount > 0 ? 99 : 0;
      const barPct       = Math.min(100, Math.round(Math.min(ratio, 1) * 100));
      const shortCat     = String(cat)
        .replace('Segurança do Trabalho', 'Seg. Trabalho')
        .replace('Manutenção Industrial', 'Manut. Industrial')
        .replace('Operação de Equipamentos', 'Op. Equipamentos')
        .replace('Operação Ferroviária', 'Op. Ferroviária')
        .replace('Treinamentos Comportamentais', 'Comportamental');
      return { category: shortCat, aptCount, demandCount, ratio, barPct };
    }).sort((a, b) => b.demandCount - a.demandCount).filter(c => c.demandCount > 0 || c.aptCount > 0);

    // Valores de comparação para Instrutores
    const noDemandsInPeriod2 = compareMode
      ? activeInstructors.filter(i => !new Set(filteredDemands2.filter(d => d.instructorId).map(d => d.instructorId!)).has(i.id)).length
      : undefined;
    const reuseStats2 = compareMode ? activeInstructors.map(inst => {
      const distinct = new Set(filteredDemands2.filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA').map(d => d.trainingId));
      return { count: distinct.size };
    }) : [];
    const reuseRate2 = compareMode && activeInstructors.length > 0
      ? Math.round((reuseStats2.filter(x => x.count >= 2).length / activeInstructors.length) * 100)
      : undefined;

    return (
      <div className="space-y-6 animate-fade-in" ref={(el) => { chartRefsMap.current['INSTRUTORES'] = el; }}>

        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 px-1 text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[0] }}>
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[0] }} />
              P1: {getPeriodLabel(filters.startDate, filters.endDate)}
            </span>
            {extraPeriods.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }}>
                <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }} />
                P{i + 2}: {getPeriodLabel(p.startDate, p.endDate)}
              </span>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KPICard title="Ativos" value={activeInstructors.length} icon={Users} colorClass="bg-blue-50 text-blue-600" />
          <KPICard title="Disponíveis (30d)" value={availableNext30.length} icon={Calendar} colorClass="bg-emerald-50 text-emerald-600" subtext="Sem alocação prevista" />
          <KPICard title="Sem Demanda" value={noDemandsInPeriod.length} compareValue={noDemandsInPeriod2} positiveIsGood={false} periods={mkPeriods(d => { const withDemand = new Set(d.filter((x: any) => x.instructorId).map((x: any) => x.instructorId!)); return activeInstructors.filter((i: any) => !withDemand.has(i.id)).length; })} icon={AlertCircle} colorClass="bg-amber-50 text-amber-600" subtext="No período filtrado" />
          <KPICard title="Reaproveitamento" value={`${reuseRate}%`} compareValue={compareMode && reuseRate2 !== undefined ? `${reuseRate2}%` : undefined} periods={mkPeriods(d => { const rate = activeInstructors.length > 0 ? Math.round((activeInstructors.filter((i: any) => new Set(d.filter((x: any) => x.instructorId === i.id && getCalculatedStatus(x) === 'CONCLUIDA').map((x: any) => x.trainingId)).size >= 2).length / activeInstructors.length) * 100) : 0; return `${rate}%`; })} icon={TrendingUp} colorClass="bg-violet-50 text-violet-600" subtext="Com ≥ 2 tipos concluídos" />
          <KPICard title="Risco Dependência" value={dependencyRisk.length} icon={ShieldAlert} colorClass="bg-red-50 text-red-600" subtext="Treinamentos c/ ≤ 1 instr." />
          <KPICard title="Produtividade Global" value={`${formatHoursValue(totalHours)}h`} compareValue={compareMode ? `${formatHoursValue(totalHours2)}h` : undefined} periods={hoursConcluidasPeriods} icon={Award} colorClass="bg-indigo-50 text-indigo-600" subtext="Horas concluídas" />
        </div>

        {/* Horas Ministradas por Instrutor + Risco de Dependência */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between shrink-0">
              <span>Horas Ministradas por Instrutor</span>
              <span className="flex items-center gap-2">
                {/* Mesmo toggle do modal de export de medição (MedicaoExportModal):
                    trilho cinza, pill branca na aba ativa. */}
                <span className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
                  {(['TREINAMENTOS', 'INTERNAS'] as const).map(modo => (
                    <button
                      key={modo}
                      onClick={() => setInstructorRanking(modo)}
                      className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition ${
                        instructorRanking === modo ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {modo === 'TREINAMENTOS' ? 'Treinamentos' : 'Internas'}
                    </button>
                  ))}
                </span>
                <span className="text-[9px] font-black text-slate-300 normal-case tracking-normal">{instructorHoursList.length} instrutor{instructorHoursList.length !== 1 ? 'es' : ''}</span>
                <Award size={13} className="text-slate-300" />
              </span>
            </h3>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar space-y-1">
              {instructorHoursList.length > 0 ? instructorHoursList.map((row, idx) => {
                const pct = Math.max(2, Math.round((row.horas / maxInstructorHours) * 100));
                const tooltip = `${row.name} — ${formatHoursValue(row.horas)}h · ${row.nDemandas} ${instructorRanking === 'INTERNAS' ? 'demanda interna' : 'demanda'}${row.nDemandas !== 1 ? 's' : ''} concluída${row.nDemandas !== 1 ? 's' : ''}` +
                  (row.nDivididas > 0 ? ` · ${row.nDivididas} dividida${row.nDivididas !== 1 ? 's' : ''} com outro instrutor` : '');
                return (
                  <div key={row.id} className="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-slate-50 transition-colors" title={tooltip}>
                    <span className="text-[9px] font-black text-slate-300 w-5 text-right shrink-0">{idx + 1}</span>
                    <span className="text-[10px] font-bold text-slate-600 truncate shrink-0 w-32" title={row.name}>{row.name}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${instructorRanking === 'INTERNAS' ? 'bg-teal-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="shrink-0 w-14 text-right text-[10px] font-black text-slate-700">{formatHoursValue(row.horas)}h</div>
                    <div className="shrink-0 w-8 text-right text-[9px] font-bold text-slate-400">{row.nDemandas}d</div>
                    {/* Coluna reservada sempre com a mesma largura, com ou sem badge, pra horas/dias não deslocarem entre linhas */}
                    <div className="shrink-0 w-12 flex items-center justify-end">
                      {row.nDivididas > 0 && (
                        <span className="text-[8px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 uppercase whitespace-nowrap">
                          {row.nDivididas} div.
                        </span>
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">
                  {instructorRanking === 'INTERNAS' ? 'Sem horas internas concluídas no período' : 'Sem horas concluídas no período'}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 shrink-0">Risco de Dependência</h3>
            {dependencyRisk.length === 0
              ? <p className="text-[11px] text-slate-300 italic mt-2">Nenhum risco crítico identificado ✅</p>
              : (
                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                  {dependencyRisk.map((risk, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-red-200 transition-colors">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-700 truncate uppercase tracking-tight" title={risk.fullName}>{risk.name}</p>
                        <p className="text-[9px] text-slate-400 font-bold">{risk.count === 0 ? 'NENHUM INSTRUTOR APTO' : 'APENAS 1 INSTRUTOR APTO'}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black ${risk.count === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                        {risk.count}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>

        {/* Disponibilidade + Sem Demanda no Período */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Disponíveis nos Próximos 30 Dias</h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                  {availableNext30.length} instrutor{availableNext30.length !== 1 ? 'es' : ''} sem alocação prevista
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-black ${availableNext30.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                {availableNext30.length}
              </span>
            </div>
            {availableNext30.length > 0 ? (
              <div className="p-4 max-h-52 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {availableNext30.map(i => (
                    <div key={i.id} className="flex items-center gap-2 p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{i.name.split(' ').slice(0, 2).join(' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">Todos os instrutores possuem alocação prevista.</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Sem Demanda no Período</h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                  {noDemandsInPeriod.length} instrutor{noDemandsInPeriod.length !== 1 ? 'es' : ''} sem participação no filtro ativo
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-black ${noDemandsInPeriod.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {noDemandsInPeriod.length}
              </span>
            </div>
            {noDemandsInPeriod.length > 0 ? (
              <div className="p-4 max-h-52 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-2">
                  {noDemandsInPeriod.map(i => (
                    <div key={i.id} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{i.name.split(' ').slice(0, 2).join(' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[11px] text-emerald-500 font-bold">Todos os instrutores ativos participaram do período ✅</p>
            )}
          </div>
        </div>

        {/* Reaproveitamento + Distribuição Geográfica */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between shrink-0">
              <span>Reaproveitamento de Instrutores</span>
              <TrendingUp size={13} className="text-slate-300" />
            </h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-3 shrink-0">Nº de treinamentos distintos ministrados (histórico completo)</p>
            <RankedListChart items={topReuseItems} othersDetail={othersReuseItems} barColor="bg-violet-500" emptyLabel="Sem histórico de execuções" />
          </div>

          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between shrink-0">
              <span>Distribuição Geográfica</span>
              <MapPin size={13} className="text-slate-300" />
            </h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-4 shrink-0">Instrutores habilitados vs demandas por região (período filtrado)</p>
            {geoData.length > 0 ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {geoData.map((g, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-700 truncate max-w-[200px]" title={g.region}>{g.region}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] text-blue-600 font-black">{g.instructors} instr.</span>
                        <span className="text-[10px] text-emerald-600 font-black">{g.demands} dem.</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((g.instructors / geoMaxInstr) * 100)}%` }} />
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round((g.demands / geoMaxDemands) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-1.5 rounded-full bg-blue-400" /><span className="text-[9px] font-bold text-slate-400 uppercase">Instrutores</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-1.5 rounded-full bg-emerald-400" /><span className="text-[9px] font-bold text-slate-400 uppercase">Demandas</span></div>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-300 italic">Sem dados regionais disponíveis.</p>
            )}
          </div>
        </div>

        {/* Cobertura de Competências por Categoria */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Cobertura de Competências por Categoria</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                Instrutores aptos (nível ≥ 3) vs volume de demandas por categoria no período
              </p>
            </div>
            <Target size={14} className="text-slate-300" />
          </div>
          {competenceCoverage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                    <th className="px-5 py-3 whitespace-nowrap">Categoria</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Instrutores Aptos</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Demandas no Período</th>
                    <th className="px-5 py-3 whitespace-nowrap">Cobertura</th>
                    <th className="px-5 py-3 text-right whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {competenceCoverage.map((row, idx) => {
                    const statusCls   = row.ratio === 0 ? 'bg-red-100 text-red-600' : row.ratio < 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
                    const statusLabel = row.ratio === 0 ? 'Crítico' : row.ratio < 0.5 ? 'Alerta' : 'OK';
                    return (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 text-[11px] font-black text-slate-700 whitespace-nowrap">{row.category}</td>
                        <td className="px-5 py-3 text-[11px] font-bold text-blue-600 text-right whitespace-nowrap">{row.aptCount}</td>
                        <td className="px-5 py-3 text-[11px] font-bold text-slate-600 text-right whitespace-nowrap">{row.demandCount}</td>
                        <td className="px-5 py-3 min-w-[160px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${row.ratio >= 0.5 ? 'bg-emerald-400' : row.ratio > 0 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${row.barPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-black text-slate-500 shrink-0 w-8 text-right">{row.barPct}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${statusCls}`}>{statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">Sem dados de competência disponíveis.</p>
          )}
        </div>

      </div>
    );
  };

  const renderClientes = () => {
    const clientData = companies.map(c => {
      const row: any = {
        name: c.name,
        volume: filteredDemands.filter(d => d.companyId === c.id).length,
      };
      if (compareMode) {
        allFilteredDemandsList.slice(1).forEach((dList, i) => {
          row[`volume${i + 2}`] = dList.filter(d => d.companyId === c.id).length;
        });
      }
      return row;
    }).sort((a: any, b: any) => b.volume - a.volume).slice(0, 8).filter((c: any) => c.volume > 0);

    const trainingCategoryData: { name: string; value: number }[] = Object.entries(
      trainings.reduce((acc, t) => {
        const count = filteredDemands.filter(d => d.trainingId === t.id).length;
        acc[t.category] = (acc[t.category] || 0) + count;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, value]) => ({
      name: String(name),
      value: value as number
    })).sort((a, b) => b.value - a.value).filter(v => v.value > 0);

    const trainingCategoryHoursData: { name: string; value: number }[] = Object.entries(
      trainings.reduce((acc, t) => {
        const hours = filteredDemands.filter(d => d.trainingId === t.id).length * getTrainingHours(t.id);
        acc[t.category] = (acc[t.category] || 0) + hours;
        return acc;
      }, {} as Record<string, number>)
    ).map(([name, value]) => ({
      name: String(name),
      value: value as number
    })).sort((a, b) => b.value - a.value).filter(v => v.value > 0);

    const activeCategoryData = categoryChartMode === 'qty' ? trainingCategoryData : trainingCategoryHoursData;

    return (
      <div className="space-y-6 animate-fade-in" ref={(el) => { chartRefsMap.current['CLIENTES'] = el; }}>
        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 px-1 text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[0] }}>
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[0] }} />
              P1: {getPeriodLabel(filters.startDate, filters.endDate)}
            </span>
            {extraPeriods.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }}>
                <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }} />
                P{i + 2}: {getPeriodLabel(p.startDate, p.endDate)}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Clientes mais Ativos (Volume)</h3>
            <div className="flex-1 min-h-0">
              {clientData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientData} layout="vertical" margin={{ left: 40, right: 40 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                    <Tooltip />
                    {compareMode && <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }} onClick={(e: any) => toggleSeries(`client-${e.dataKey}`)} />}
                    <Bar dataKey="volume" name="P1" fill={PERIOD_COLORS[0]} radius={[0, 4, 4, 0]} barSize={compareMode ? Math.max(6, Math.floor(22 / allFilteredDemandsList.length)) : undefined} hide={hiddenSeries['client-volume']} />
                    {compareMode && allFilteredDemandsList.slice(1).map((_, i) => (
                      <Bar key={i + 2} dataKey={`volume${i + 2}`} name={`P${i + 2}`} fill={PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length]} radius={[0, 4, 4, 0]} barSize={Math.max(6, Math.floor(22 / allFilteredDemandsList.length))} hide={hiddenSeries[`client-volume${i + 2}`]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem demandas ativas</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 h-96 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Treinamentos por Categoria</h3>
              <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                {(['qty', 'hours'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCategoryChartMode(mode)}
                    className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${categoryChartMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    {mode === 'qty' ? 'Quantidade' : 'Horas'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {activeCategoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={activeCategoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" stroke="none">
                      {activeCategoryData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i % COLORS.CHART_PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => categoryChartMode === 'qty' ? [`${v} treinamentos`, ''] : [`${v}h ministradas`, '']} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem dados</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const renderCustos = () => {
    const toVal = (v: any): number => {
      const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
      return Number(n) || 0;
    };
    const normCat = (c: any) => String(c ?? '').toUpperCase().trim();

    const sumByCategory = (ms: typeof filteredMeasurements, cats: string | string[]): number => {
      const catList = (Array.isArray(cats) ? cats : [cats]).map(c => c.toUpperCase());
      return ms.reduce((acc, m) =>
        acc + m.attachments
          .filter((a: any) => catList.includes(normCat(a.category)))
          .reduce((s: number, a: any) => s + toVal(a.value), 0),
      0);
    };

    const countMsWithCategory = (ms: typeof filteredMeasurements, cats: string | string[]): number => {
      const catList = (Array.isArray(cats) ? cats : [cats]).map(c => c.toUpperCase());
      return ms.filter(m =>
        m.attachments.some((a: any) => catList.includes(normCat(a.category)) && toVal(a.value) > 0)
      ).length;
    };

    // --- Despesas Nao Reembolsaveis ---
    // O cliente reembolsa a medicao, mas nao todo item (Uber ate a locadora,
    // almoco acima do teto). Isto e um RECORTE do total acima, nao uma parcela
    // separada: o item marcado continua somando na sua categoria.
    // `filteredMeasurements` ja e cliente-only, entao interna nao entra aqui —
    // o custo dela e integral e aparece na aba INTERNAS.
    const naoReemb = aggregateMeasurements(filteredMeasurements as any);
    const naoReembCategorias = [
      { label: 'Hospedagem', valor: naoReemb.naoReembolsavelPorCategoria.HOSPEDAGEM },
      { label: 'Locomoção', valor: naoReemb.naoReembolsavelPorCategoria.LOCOMOCAO },
      { label: 'Café da Manhã', valor: naoReemb.naoReembolsavelPorCategoria.CAFE },
      { label: 'Almoço', valor: naoReemb.naoReembolsavelPorCategoria.ALMOCO },
      { label: 'Jantar', valor: naoReemb.naoReembolsavelPorCategoria.JANTAR },
      { label: 'Outros', valor: naoReemb.naoReembolsavelPorCategoria.OUTROS },
    ].filter(c => c.valor > 0).sort((x, y) => y.valor - x.valor);

    // Totais por categoria (com normalização)
    const hospTotal  = sumByCategory(filteredMeasurements, 'HOSPEDAGEM');
    const locoTotal  = sumByCategory(filteredMeasurements, 'LOCOMOCAO');
    const cafeTotal  = sumByCategory(filteredMeasurements, 'CAFE');
    const almoTotal  = sumByCategory(filteredMeasurements, 'ALMOCO');
    const jantTotal  = sumByCategory(filteredMeasurements, 'JANTAR');
    const outTotal   = sumByCategory(filteredMeasurements, 'OUTROS');
    const alimentTotal = cafeTotal + almoTotal + jantTotal;

    // Mix de despesas — todas as categorias, sem filtrar zeros do array (para o pie)
    const expenseData: { name: string; value: number }[] = [
      { name: 'Hospedagem',    value: hospTotal },
      { name: 'Locomoção',     value: locoTotal },
      { name: 'Café da Manhã', value: cafeTotal },
      { name: 'Almoço',        value: almoTotal },
      { name: 'Jantar',        value: jantTotal },
      { name: 'Outros',        value: outTotal  },
    ].filter(e => e.value > 0);

    // Breakdown com médias por categoria agrupada
    const catBreakdown = [
      { label: 'Hospedagem',  total: hospTotal,   count: countMsWithCategory(filteredMeasurements, 'HOSPEDAGEM'),              color: 'bg-blue-500'    },
      { label: 'Locomoção',   total: locoTotal,   count: countMsWithCategory(filteredMeasurements, 'LOCOMOCAO'),               color: 'bg-amber-500'   },
      { label: 'Alimentação', total: alimentTotal, count: countMsWithCategory(filteredMeasurements, ['CAFE','ALMOCO','JANTAR']), color: 'bg-emerald-500' },
      { label: 'Café da Manhã', total: cafeTotal,  count: countMsWithCategory(filteredMeasurements, 'CAFE'),                   color: 'bg-teal-400'    },
      { label: 'Almoço',      total: almoTotal,   count: countMsWithCategory(filteredMeasurements, 'ALMOCO'),                  color: 'bg-green-400'   },
      { label: 'Jantar',      total: jantTotal,   count: countMsWithCategory(filteredMeasurements, 'JANTAR'),                  color: 'bg-lime-400'    },
      { label: 'Outros',      total: outTotal,    count: countMsWithCategory(filteredMeasurements, 'OUTROS'),                  color: 'bg-violet-500'  },
    ].filter(c => c.total > 0);

    // Status das medições
    const concludedDemands = filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA');
    const naoIniciadaCount  = concludedDemands.filter(d =>
      !filteredMeasurements.some(m => m.demandId === d.id) ||
      filteredMeasurements.find(m => m.demandId === d.id)?.status === 'NAO_INICIADA'
    ).length;
    const totalConcluded = concludedDemands.length;

    const measurementStatusRows = [
      { key: 'NAO_INICIADA',       label: 'Não Iniciada',         count: naoIniciadaCount,                                              color: 'bg-slate-300',   textColor: 'text-slate-500'  },
      { key: 'LANCAMENTO',         label: 'Em Lançamento',        count: filteredMeasurements.filter(m => m.status === 'LANCAMENTO').length,         color: 'bg-amber-400',   textColor: 'text-amber-600'  },
      { key: 'CONFERENCIA',        label: 'Em Conferência',       count: filteredMeasurements.filter(m => m.status === 'CONFERENCIA').length,        color: 'bg-blue-400',    textColor: 'text-blue-600'   },
      { key: 'PRONTA_FATURAMENTO', label: 'Pronta Faturamento',   count: filteredMeasurements.filter(m => m.status === 'PRONTA_FATURAMENTO').length, color: 'bg-violet-400',  textColor: 'text-violet-600' },
      { key: 'FATURADA',           label: 'Faturada',             count: filteredMeasurements.filter(m => m.status === 'FATURADA').length,           color: 'bg-emerald-400', textColor: 'text-emerald-600'},
    ];

    // Top instrutores por custo gerado
    const instructorCostItems: RankedItem[] = instructors.map(inst => {
      const instDemandIds = new Set(filteredDemands.filter(d => d.instructorId === inst.id).map(d => d.id));
      const cost = filteredMeasurements
        .filter(m => instDemandIds.has(m.demandId))
        .reduce((acc, m) => acc + m.attachments.reduce((s: number, a: any) => s + toVal(a.value), 0), 0);
      return { name: inst.name.split(' ').slice(0, 2).join(' '), value: Math.round(cost * 100) / 100 };
    }).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);

    // Evolução mensal (últimos 6 meses — histórico completo, não filtrado)
    const months: { label: string; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      });
    }
    const monthlyCosts = months.map(mo => {
      const moDemandIds = new Set(
        demands.filter(d => d.endDate?.substring(0, 7) === mo.key).map(d => d.id)
      );
      const cost = measurements
        .filter(m => moDemandIds.has(m.demandId))
        .reduce((acc, m) => acc + m.attachments.reduce((s: number, a: any) => s + toVal(a.value), 0), 0);
      return { label: mo.label, cost: Math.round(cost * 100) / 100 };
    });

    const ticketMedio = filteredMeasurements.length > 0 ? totalCosts / filteredMeasurements.length : 0;

    // Valores de comparação para Custos
    const ticketMedio2 = compareMode && filteredMeasurements2.length > 0 ? totalCosts2 / filteredMeasurements2.length : undefined;
    const naoIniciada2 = compareMode ? (() => {
      const concluded2 = filteredDemands2.filter(d => getCalculatedStatus(d) === 'CONCLUIDA');
      return concluded2.filter(d =>
        !filteredMeasurements2.some(m => m.demandId === d.id) ||
        filteredMeasurements2.find(m => m.demandId === d.id)?.status === 'NAO_INICIADA'
      ).length;
    })() : undefined;
    const expenseData2: { name: string; value: number }[] = compareMode ? (() => {
      const toVal2 = (v: any): number => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number(n) || 0; };
      const normCat2 = (c: any) => String(c ?? '').toUpperCase().trim();
      const sumCat2 = (cats: string | string[]) => {
        const catList = (Array.isArray(cats) ? cats : [cats]).map(c => c.toUpperCase());
        return filteredMeasurements2.reduce((acc, m) => acc + m.attachments.filter((a: any) => catList.includes(normCat2(a.category))).reduce((s: number, a: any) => s + toVal2(a.value), 0), 0);
      };
      return [
        { name: 'Hospedagem', value: sumCat2('HOSPEDAGEM') },
        { name: 'Locomoção', value: sumCat2('LOCOMOCAO') },
        { name: 'Café da Manhã', value: sumCat2('CAFE') },
        { name: 'Almoço', value: sumCat2('ALMOCO') },
        { name: 'Jantar', value: sumCat2('JANTAR') },
        { name: 'Outros', value: sumCat2('OUTROS') },
      ].filter(e => e.value > 0);
    })() : [];

    // Para 3+ períodos: barras agrupadas por categoria de despesa
    const expenseBarData = extraPeriods.length >= 2
      ? [
          { name: 'Hospedagem', cats: 'HOSPEDAGEM' },
          { name: 'Locomoção',  cats: 'LOCOMOCAO'  },
          { name: 'Café da Manhã', cats: 'CAFE'     },
          { name: 'Almoço',     cats: 'ALMOCO'      },
          { name: 'Jantar',     cats: 'JANTAR'       },
          { name: 'Outros',     cats: 'OUTROS'       },
        ].map(cat => {
          const row: any = { name: cat.name };
          allFilteredMeasurementsList.forEach((mList, i) => {
            row[`P${i + 1}`] = sumByCategory(mList as any, cat.cats);
          });
          return row;
        }).filter(row => allFilteredMeasurementsList.some((_, i) => (row[`P${i + 1}`] ?? 0) > 0))
      : [];

    return (
      <div className="space-y-6 animate-fade-in" ref={(el) => { chartRefsMap.current['CUSTOS'] = el; }}>

        {compareMode && (
          <div className="flex flex-wrap items-center gap-3 px-1 text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[0] }}>
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[0] }} />
              P1: {getPeriodLabel(filters.startDate, filters.endDate)}
            </span>
            {extraPeriods.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1.5" style={{ color: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }}>
                <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: PERIOD_COLORS[(i + 1) % PERIOD_COLORS.length] }} />
                P{i + 2}: {getPeriodLabel(p.startDate, p.endDate)}
              </span>
            ))}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title="Total em Despesas" value={totalCosts} compareValue={compareMode ? totalCosts2 : undefined} isCurrency periods={mkPeriods((_d, m) => m.reduce((acc: number, x: any) => acc + x.attachments.reduce((s: number, a: any) => { const v = typeof a.value === 'string' ? parseFloat(a.value.replace(',', '.')) : Number(a.value); return s + (Number(v) || 0); }, 0), 0))} icon={DollarSign} colorClass="bg-amber-50 text-amber-600" />
          <KPICard title="Ticket Médio/Medição" value={ticketMedio} compareValue={ticketMedio2} isCurrency periods={mkPeriods((_d, m) => { const cost = m.reduce((acc: number, x: any) => acc + x.attachments.reduce((s: number, a: any) => { const v = typeof a.value === 'string' ? parseFloat(a.value.replace(',', '.')) : Number(a.value); return s + (Number(v) || 0); }, 0), 0); return m.length > 0 ? cost / m.length : 0; })} icon={Zap} colorClass="bg-blue-50 text-blue-600" subtext={`${filteredMeasurements.length} medições`} />
          <KPICard title="Não Iniciadas" value={naoIniciadaCount} compareValue={naoIniciada2} positiveIsGood={false} periods={mkPeriods((d, m) => { const conc = d.filter((x: any) => getCalculatedStatus(x) === 'CONCLUIDA'); return conc.filter((x: any) => !m.some((mx: any) => mx.demandId === x.id) || m.find((mx: any) => mx.demandId === x.id)?.status === 'NAO_INICIADA').length; })} icon={Clock} colorClass="bg-orange-50 text-orange-600" subtext="Demandas concluídas" />
          <KPICard title="Pronta Faturamento" value={filteredMeasurements.filter(m => m.status === 'PRONTA_FATURAMENTO').length} compareValue={compareMode ? filteredMeasurements2.filter(m => m.status === 'PRONTA_FATURAMENTO').length : undefined} periods={mkPeriods((_d, m) => m.filter((x: any) => x.status === 'PRONTA_FATURAMENTO').length)} icon={CheckCircle} colorClass="bg-violet-50 text-violet-600" />
          <KPICard title="Faturadas" value={filteredMeasurements.filter(m => m.status === 'FATURADA').length} compareValue={compareMode ? filteredMeasurements2.filter(m => m.status === 'FATURADA').length : undefined} periods={mkPeriods((_d, m) => m.filter((x: any) => x.status === 'FATURADA').length)} icon={Award} colorClass="bg-emerald-50 text-emerald-600" />
        </div>

        {/* Despesas Nao Reembolsaveis */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Despesas Não Reembolsáveis</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                O que a Colabor absorve — já incluso no total acima
              </p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600 shrink-0">
              <ShieldAlert size={20} />
            </div>
          </div>

          {naoReemb.naoReembolsavel <= 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">
              Nenhuma despesa marcada como não reembolsável no período.
            </p>
          ) : (
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h4 className="text-2xl font-black text-amber-600">{formatCurrency(naoReemb.naoReembolsavel)}</h4>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {naoReemb.itensNaoReembolsaveis} ite{naoReemb.itensNaoReembolsaveis === 1 ? 'm' : 'ns'} em {naoReemb.medicoesComNaoReembolsavel} medi{naoReemb.medicoesComNaoReembolsavel === 1 ? 'ção' : 'ções'}
                </span>
              </div>

              {naoReembCategorias.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {naoReembCategorias.map(c => (
                    <div key={c.label} className="flex items-center justify-between gap-2 p-2.5 bg-amber-50/60 rounded-xl border border-amber-100 min-w-0">
                      <span className="text-[11px] font-bold text-slate-700 truncate">{c.label}</span>
                      <span className="text-[11px] font-black text-amber-700 shrink-0">{formatCurrency(c.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mix de Despesas + Média por Categoria */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Rosca — Mix */}
          <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 shrink-0">Mix de Despesas</h3>
            <div className="flex-1 min-h-0">
              {compareMode && extraPeriods.length >= 2 ? (
                /* 3+ períodos → barras agrupadas por categoria */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseBarData} margin={{ top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9 }} tickFormatter={(v) => formatCurrency(v)} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} cursor={{ fill: '#F8FAFC' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }} onClick={(e: any) => toggleSeries(`expense-${e.dataKey}`)} />
                    {allFilteredDemandsList.map((_, i) => (
                      <Bar key={i} dataKey={`P${i + 1}`} name={`P${i + 1}`} fill={PERIOD_COLORS[i % PERIOD_COLORS.length]} radius={[3, 3, 0, 0]} barSize={14} hide={hiddenSeries[`expense-P${i + 1}`]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : compareMode ? (
                /* 2 períodos → dois donuts lado a lado */
                <div className="flex h-full gap-2">
                  <div className="flex-1 flex flex-col">
                    <p className="text-[8px] font-black uppercase text-center mb-1" style={{ color: PERIOD_COLORS[0] }}>P1</p>
                    {expenseData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={expenseData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                            {expenseData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i % COLORS.CHART_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip formatter={(val: number) => formatCurrency(val)} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs">Sem dados P1</div>}
                  </div>
                  <div className="w-px bg-slate-100 shrink-0" />
                  <div className="flex-1 flex flex-col">
                    <p className="text-[8px] font-black uppercase text-center mb-1" style={{ color: PERIOD_COLORS[1] }}>P2</p>
                    {expenseData2.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={expenseData2} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                            {expenseData2.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i % COLORS.CHART_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip formatter={(val: number) => formatCurrency(val)} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs">Sem dados P2</div>}
                  </div>
                </div>
              ) : expenseData.length > 0 ? (
                /* 1 período → donut simples */
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" stroke="none">
                      {expenseData.map((_, i) => <Cell key={i} fill={COLORS.CHART_PALETTE[i % COLORS.CHART_PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(val: number) => formatCurrency(val)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem custos registrados</div>
              )}
            </div>
          </div>

          {/* Média por Categoria */}
          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '22rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 shrink-0">Média por Categoria de Despesa</h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-4 shrink-0">Valor médio por medição com gasto na categoria</p>
            {catBreakdown.length > 0 ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
                {catBreakdown.map((cat, idx) => {
                  const avg = cat.count > 0 ? cat.total / cat.count : 0;
                  const pct = totalCosts > 0 ? Math.round((cat.total / totalCosts) * 100) : 0;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full ${cat.color} shrink-0`} />
                          <span className="text-[11px] font-black text-slate-700 truncate">{cat.label}</span>
                          <span className="text-[9px] font-bold text-slate-300 uppercase shrink-0">{cat.count}×</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span className="text-[9px] font-bold text-slate-400">média {formatCurrency(avg)}</span>
                          <span className="text-[11px] font-black text-slate-700">{formatCurrency(cat.total)}</span>
                          <span className="text-[9px] font-bold text-slate-300 w-7 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${cat.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-slate-300 italic">Sem despesas registradas no período.</p>
            )}
          </div>
        </div>

        {/* Status das Medições + Top Instrutores por Custo */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Status das Medições */}
          <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '18rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 shrink-0">Status das Medições</h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-4 shrink-0">Demandas concluídas no período filtrado</p>
            {totalConcluded > 0 ? (
              <div className="space-y-3">
                {measurementStatusRows.map((s, idx) => {
                  const pct = totalConcluded > 0 ? Math.round((s.count / totalConcluded) * 100) : 0;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[11px] font-black ${s.textColor}`}>{s.label}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-bold text-slate-600">{s.count}</span>
                          <span className="text-[9px] font-bold text-slate-300 w-7 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] font-bold text-slate-300 pt-1">{totalConcluded} demandas concluídas no total</p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-300 italic">Nenhuma demanda concluída no período.</p>
            )}
          </div>

          {/* Top Instrutores por Custo */}
          <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '18rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-between shrink-0">
              <span>Top Instrutores por Custo Gerado</span>
              <Users size={13} className="text-slate-300" />
            </h3>
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-3 shrink-0">Soma de despesas das medições por instrutor no período</p>
            <RankedListChart
              items={instructorCostItems}
              othersDetail={[]}
              barColor="bg-amber-500"
              emptyLabel="Sem despesas registradas"
              valueFormatter={(v) => formatCurrency(v)}
            />
          </div>
        </div>

        {/* Evolução Mensal de Custos */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '18rem' }}>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 shrink-0">Evolução Mensal de Custos</h3>
          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-4 shrink-0">Despesas registradas por mês — últimos 6 meses (histórico completo)</p>
          <div className="flex-1 min-h-0" style={{ minHeight: '180px' }}>
            {monthlyCosts.some(m => m.cost > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyCosts} margin={{ top: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(val: number) => [formatCurrency(val), 'Despesas']} labelStyle={{ fontWeight: 'bold', fontSize: 11 }} />
                  <Bar dataKey="cost" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={40} name="Despesas" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem histórico de despesas nos últimos 6 meses</div>
            )}
          </div>
        </div>

      </div>
    );
  };

  /* ─────────────────────────────── ABA INTERNAS ───────────────────────────────
   * Painel próprio das demandas internas: visita, SIPAT, apoio logístico e
   * eventos da Colabor. Estava no topo da tela Demandas Internas e veio pra cá
   * para o acompanhamento gerencial ficar todo no Dashboard, junto dos filtros
   * de período/região/etc. A tela Demandas Internas voltou a ser filtros +
   * listagem.
   */
  const renderInternas = () => {
    const maxCategoriaHoras = Math.max(...internaKpis.categorias.map(c => c.horas), 1);
    const maxInstrutorHoras = Math.max(...internaKpis.topInstrutores.map(r => r.horas), 1);

    // --- Custo das Demandas Internas ---
    // Interna nao gera reembolso: o que a Colabor gasta nela e custo proprio,
    // inteiro. Por isso o numero vive AQUI e nao na aba CUSTOS, que mede o que
    // e reembolsado pelo cliente (`demands` ja e cliente-only na linha ~400).
    // Mesma conta da tela de Medicao — domain/measurementTotals.ts.
    const internaIdsNoPeriodo = new Set((filteredInternasByPeriod[0] ?? []).map(d => d.id));
    const custoInterna = aggregateMeasurements(
      measurements.filter(m => internaIdsNoPeriodo.has(m.demandId)) as any
    );

    // --- Cobertura de Ociosidade ---
    // "A ferramenta de ocupacao esta sendo usada?" — dos instrutores ociosos no
    // recorte, quantos receberam demanda interna.
    //
    // A disponibilidade vem do MESMO helper do card da aba INSTRUTORES
    // (domain/instructorAvailability.ts). O countsAsBusy deixa explicito que a
    // ociosidade e medida contra o trabalho de CLIENTE: se a interna tambem
    // ocupasse, receber uma interna tiraria o instrutor de "ocioso" e a resposta
    // seria zero por construcao. Hoje ele e redundante — `demands` ja e
    // cliente-only (ver o corte na entrada, ~linha 400) — mas fica como guarda
    // caso esse dataset mude.
    const { start: internaStart, end: internaEnd } = getPeriodBounds(0);
    const hasInternaPeriod = !!(internaStart || internaEnd);
    const idleWindow = hasInternaPeriod
      ? {
          from: new Date(`${internaStart ?? internaEnd}T00:00:00`),
          to: new Date(`${internaEnd ?? internaStart}T23:59:59`),
        }
      : defaultAvailabilityWindow(today);

    const idleCoverage = computeIdleCoverage<Instructor, Demand>(
      getAvailableInstructors<Instructor, Demand>(
        instructors,
        demands,
        idleWindow,
        { statusOf: getCalculatedStatus, countsAsBusy: d => d.tipo !== 'interna' }
      ),
      filteredInternasByPeriod[0] ?? [],
      { statusOf: getCalculatedStatus }
    );
    const idleTotal = idleCoverage.available.length;
    const idleCovered = idleCoverage.covered.length;

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Mesma casca do KPICard das demais abas (título, valor e o ícone no
              quadradinho colorido à direita). Não dá para usar o componente em
              si: os quatro cards daqui têm rodapé próprio — badges de status,
              tooltip de horas, valor composto — que `subtext` não expressa. */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">Demandas Internas</p>
              <h3 className="text-2xl font-black text-slate-800">{internaKpis.totalDemandas}</h3>
              <div className="flex flex-wrap gap-1 mt-3 min-h-[1.5rem]">
                {internaKpis.porStatus.map(([status, n]) => (
                  <span key={status} className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {status.replace('_', ' ')} {n}
                  </span>
                ))}
              </div>
            </div>
            {/* Violeta: mesma cor do badge INTERNA em Logística, Medição e Agenda. */}
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600 group-hover:scale-110 transition-transform shrink-0 ml-3">
              <Building2 size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">Horas Previstas</p>
              <h3 className="text-2xl font-black text-slate-800">{formatHoursValue(internaKpis.horasPrevistas)}h</h3>
              <p
                className="text-[9px] font-bold text-slate-400 mt-3 min-h-[1.5rem]"
                title="Horas já ministradas: só demandas concluídas E com linha em instructor_allocations, rateadas por dia — mesma conta do card de instrutor e da medição. Interna com instrutor só no cadastro da demanda não entra aqui."
              >
                {formatHoursValue(internaKpis.horasMinistradas)}h já ministradas
              </p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:scale-110 transition-transform shrink-0 ml-3">
              <Clock size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">Vínculo</p>
              <h3 className="text-2xl font-black text-slate-800">
                {internaKpis.comEmpresa}<span className="text-slate-300"> / </span>{internaKpis.semEmpresa}
              </h3>
              <p className="text-[9px] font-bold text-slate-400 mt-3 min-h-[1.5rem]">Com empresa vinculada / Colabor</p>
            </div>
            <div className="p-3 rounded-xl bg-teal-50 text-teal-600 group-hover:scale-110 transition-transform shrink-0 ml-3">
              <Link2 size={20} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">Categorias</p>
              <h3 className="text-2xl font-black text-slate-800">{internaKpis.categorias.length}</h3>
              <p className="text-[9px] font-bold text-slate-400 mt-3 min-h-[1.5rem] truncate" title={internaKpis.categorias[0]?.nome ?? ''}>
                {internaKpis.categorias.length > 0 ? `Maior: ${internaKpis.categorias[0].nome}` : 'Sem categoria no recorte'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600 group-hover:scale-110 transition-transform shrink-0 ml-3">
              <Tag size={20} />
            </div>
          </div>
        </div>

        {/* Custo das Demandas Internas */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-start justify-between hover:shadow-md transition-all group">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-600 transition-colors">
              Custo das Demandas Internas
            </p>
            <h3 className="text-2xl font-black text-slate-800">{formatCurrency(custoInterna.total)}</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 min-h-[1.5rem]">
              <span className="text-[9px] font-bold text-slate-400">
                Hora/Aula <span className="text-slate-700">{formatCurrency(custoInterna.horaAula)}</span>
              </span>
              <span className="text-[9px] font-bold text-slate-400">
                Despesas <span className="text-slate-700">{formatCurrency(custoInterna.despesas)}</span>
              </span>
              <span className="text-[9px] font-bold text-slate-300">
                {custoInterna.medicoes} medi{custoInterna.medicoes === 1 ? 'ção' : 'ções'} no recorte
              </span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 text-rose-600 group-hover:scale-110 transition-transform shrink-0 ml-3">
            <DollarSign size={20} />
          </div>
        </div>

        {/* Cobertura de Ociosidade */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Cobertura de Ociosidade</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
                {hasInternaPeriod
                  ? 'Ociosos no período com demanda interna'
                  : 'Ociosos nos próximos 30 dias com demanda interna'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600 shrink-0">
              <UserCheck size={20} />
            </div>
          </div>

          {idleTotal === 0 ? (
            <p className="px-5 py-8 text-center text-[11px] text-slate-300 italic font-bold">
              Nenhum instrutor ocioso no período.
            </p>
          ) : (
            <div className="p-5 space-y-4">
              <div className="flex items-baseline gap-2">
                <h4 className="text-2xl font-black text-slate-800">
                  {idleCovered}<span className="text-slate-300"> de </span>{idleTotal}
                </h4>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  receberam demanda interna
                </span>
              </div>

              {/* Quem JA recebeu. Omitida quando X = 0 — secao vazia so ocupa
                  espaco; a lista ambar abaixo ja diz que ninguem foi coberto. */}
              {idleCoverage.covered.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Com interna no período ({idleCoverage.covered.length})
                  </p>
                  <div className="max-h-52 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-2 gap-2">
                      {idleCoverage.covered.map(i => {
                        const internas = idleCoverage.internalsByInstructor.get(i.id) ?? [];
                        const extras = internas.length - 1;
                        return (
                          <div
                            key={i.id}
                            className="flex items-center gap-2 p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100 min-w-0"
                            title={internas.map(d => d.id).join(', ')}
                          >
                            <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-[11px] font-bold text-slate-700 truncate">
                              {i.name.split(' ').slice(0, 2).join(' ')}
                            </span>
                            {internas[0] && (
                              <span className="text-[10px] font-bold text-emerald-600 shrink-0 ml-auto">
                                {internas[0].id}{extras > 0 ? ` +${extras}` : ''}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {idleCoverage.uncovered.length > 0 ? (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Sem interna no período ({idleCoverage.uncovered.length})
                  </p>
                  <div className="max-h-52 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-2 gap-2">
                      {idleCoverage.uncovered.map(i => (
                        <div key={i.id} className="flex items-center gap-2 p-2.5 bg-amber-50/60 rounded-xl border border-amber-100">
                          <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-[11px] font-bold text-slate-700 truncate">{i.name.split(' ').slice(0, 2).join(' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] font-bold text-emerald-600">
                  Todos os instrutores ociosos receberam demanda interna no período.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Concluída sem alocação vira 0h ministradas sem avisar — o mesmo silêncio
            que já mordeu a medição. Só aparece quando existe o caso. */}
        {internaKpis.concluidasSemAlocacao > 0 && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
              {internaKpis.concluidasSemAlocacao} demanda{internaKpis.concluidasSemAlocacao !== 1 ? 's' : ''} interna{internaKpis.concluidasSemAlocacao !== 1 ? 's' : ''} concluída{internaKpis.concluidasSemAlocacao !== 1 ? 's' : ''} sem alocação de instrutor.
              <span className="font-medium"> Não entra{internaKpis.concluidasSemAlocacao !== 1 ? 'm' : ''} em "horas já ministradas" nem no ranking: a fonte de horas é <code className="font-mono">instructor_allocations</code>, não o instrutor do cadastro da demanda. Aloque pela agenda para as horas passarem a contar.</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between shrink-0">
              <span>Distribuição por Categoria</span>
              <span className="text-[9px] font-black text-slate-300 normal-case tracking-normal">horas previstas</span>
            </h3>
            {internaKpis.categorias.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold">Sem demandas internas no período</div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar space-y-1">
                {internaKpis.categorias.map(cat => {
                  const pct = Math.max(2, Math.round((cat.horas / maxCategoriaHoras) * 100));
                  return (
                    <div key={cat.nome} className="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-slate-50 transition-colors" title={`${cat.nome} — ${cat.n} demanda${cat.n !== 1 ? 's' : ''} · ${formatHoursValue(cat.horas)}h previstas`}>
                      <span className="text-[10px] font-bold text-slate-600 truncate shrink-0 w-32">{cat.nome}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="shrink-0 w-14 text-right text-[10px] font-black text-slate-700">{formatHoursValue(cat.horas)}h</div>
                      <div className="shrink-0 w-8 text-right text-[9px] font-bold text-slate-400">{cat.n}d</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '20rem' }}>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between shrink-0">
              <span>Top Instrutores em Horas Internas</span>
              <span className="text-[9px] font-black text-slate-300 normal-case tracking-normal">ministradas</span>
            </h3>
            {internaKpis.topInstrutores.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-300 italic text-xs uppercase font-bold text-center px-4">Nenhuma hora interna ministrada no período</div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar space-y-1">
                {internaKpis.topInstrutores.map((row, idx) => {
                  const pct = Math.max(2, Math.round((row.horas / maxInstrutorHoras) * 100));
                  return (
                    <div key={row.id} className="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-slate-50 transition-colors" title={`${row.nome} — ${formatHoursValue(row.horas)}h em ${row.nDemandas} demanda${row.nDemandas !== 1 ? 's' : ''} interna${row.nDemandas !== 1 ? 's' : ''} concluída${row.nDemandas !== 1 ? 's' : ''}`}>
                      <span className="text-[9px] font-black text-slate-300 w-5 text-right shrink-0">{idx + 1}</span>
                      <span className="text-[10px] font-bold text-slate-600 truncate shrink-0 w-32">{row.nome}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="shrink-0 w-14 text-right text-[10px] font-black text-slate-700">{formatHoursValue(row.horas)}h</div>
                      <div className="shrink-0 w-8 text-right text-[9px] font-bold text-slate-400">{row.nDemandas}d</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── Excel Export ────────────────────────────────────────────────────────────
  const handleExportDashboard = async (mode: 'current' | 'all') => {
    setShowExportMenu(false);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Colabor';
    wb.created = new Date();

    const fmt = (v: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const toVal = (v: any): number => {
      const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
      return Number(n) || 0;
    };
    const normCat = (c: any) => String(c ?? '').toUpperCase().trim();
    const sumByCat = (ms: typeof filteredMeasurements, cats: string | string[]) => {
      const cl = (Array.isArray(cats) ? cats : [cats]).map(c => c.toUpperCase());
      return ms.reduce((acc, m) =>
        acc + m.attachments.filter((a: any) => cl.includes(normCat(a.category))).reduce((s: number, a: any) => s + toVal(a.value), 0), 0);
    };

    const styleHeader = (row: any) => {
      row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      });
      row.height = 22;
    };

    const styleSection = (row: any) => {
      row.eachCell(cell => {
        cell.font = { bold: true, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      });
      row.height = 18;
    };

    const addSection = (
      ws: any,
      title: string,
      headers: string[],
      rows: (string | number)[][]
    ) => {
      ws.addRow([]);
      const titleRow = ws.addRow([title]);
      styleSection(titleRow);
      ws.mergeCells(titleRow.number, 1, titleRow.number, headers.length);
      const hRow = ws.addRow(headers);
      styleHeader(hRow);
      rows.forEach(r => {
        const dr = ws.addRow(r);
        dr.eachCell(cell => { cell.font = { size: 10 }; cell.alignment = { vertical: 'middle' }; });
      });
    };

    const buildGeral = (ws: any) => {
      ws.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 20 }];
      // KPIs
      const noInstr = filteredDemands.filter(d => {
        const s = getCalculatedStatus(d); return s !== 'CANCELADA' && s !== 'CONCLUIDA' && !isOnlineDemand(d) && !d.instructorId;
      }).length;
      addSection(ws, 'KPIs Gerais', ['Indicador', 'Valor'],
        [
          ['Total de Demandas', filteredDemands.length],
          ['Horas Ministradas', `${totalHours}h`],
          ['Pendência de Alocação', noInstr],
          ['Treinamentos Concluídos', filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA').length],
          ['Demandas Canceladas', filteredDemands.filter(d => d.status === 'CANCELADA').length],
        ]
      );
      // Status
      const statusRows = Object.keys(STATUS_LABELS).map(k => [STATUS_LABELS[k], filteredDemands.filter(d => getCalculatedStatus(d) === k).length]);
      addSection(ws, 'Distribuição por Status', ['Status', 'Qtd'], statusRows);
      // Regional
      const regRows = regions.map(r => [r.name, filteredDemands.filter(d => d.regionId === r.id).length]).sort((a, b) => (b[1] as number) - (a[1] as number));
      addSection(ws, 'Volume por Região', ['Região', 'Qtd'], regRows);
      // Local
      const localCounts: Record<string, number> = {};
      filteredDemands.forEach(d => { const v = (d.trainingLocal ?? '').trim(); if (v) localCounts[v] = (localCounts[v] || 0) + 1; });
      addSection(ws, 'Volume por Local do Treinamento', ['Local', 'Qtd'],
        Object.entries(localCounts).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v]));
      // Corredor
      const corrCounts: Record<string, number> = {};
      filteredDemands.forEach(d => { const v = (d.corredor ?? '').trim(); if (v) corrCounts[v] = (corrCounts[v] || 0) + 1; });
      addSection(ws, 'Volume por Corredor', ['Corredor', 'Qtd'],
        Object.entries(corrCounts).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v]));
      // UF
      const ufCounts: Record<string, number> = {};
      filteredDemands.forEach(d => { const v = (d.demandState ?? '').trim(); if (v) ufCounts[v] = (ufCounts[v] || 0) + 1; });
      addSection(ws, 'Volume por Estado (UF)', ['UF', 'Qtd'],
        Object.entries(ufCounts).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v]));
    };

    const buildOperacional = (ws: any) => {
      ws.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 24 }, { width: 20 }, { width: 20 }];
      const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const next7  = new Date(today.getTime() + 7  * 24 * 60 * 60 * 1000);
      const concluded  = filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA');
      const activeDmds = filteredDemands.filter(d => getCalculatedStatus(d) !== 'CANCELADA');
      const execRate   = activeDmds.length > 0 ? Math.round((concluded.length / activeDmds.length) * 100) : 0;
      const noInstr = filteredDemands.filter(d => {
        const s = getCalculatedStatus(d); return s !== 'CANCELADA' && s !== 'CONCLUIDA' && !isOnlineDemand(d) && !d.instructorId;
      }).length;
      addSection(ws, 'KPIs Operacionais', ['Indicador', 'Valor'],
        [
          ['Aguardando Instrutor', noInstr],
          ['Alocadas', filteredDemands.filter(d => getCalculatedStatus(d) === 'ALOCADA').length],
          ['Em Execução Hoje', filteredDemands.filter(d => getCalculatedStatus(d) === 'EM_ANDAMENTO').length],
          ['Próximos 30 Dias', filteredDemands.filter(d => { const s = new Date(d.startDate); return s > today && s <= next30; }).length],
          ['Taxa de Execução', `${execRate}%`],
        ]
      );
      // Top Treinamentos
      const tCounts: Record<string, number> = {};
      filteredDemands.forEach(d => { const n = getTrainingName(d.trainingId); if (n !== 'N/A') tCounts[n] = (tCounts[n] || 0) + 1; });
      addSection(ws, 'Top Treinamentos', ['Treinamento', 'Qtd'],
        Object.entries(tCounts).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v]));
      // Ranking Instrutores
      const iCounts: Record<string, number> = {};
      filteredDemands.filter(d => d.instructorId).forEach(d => { iCounts[d.instructorId!] = (iCounts[d.instructorId!] || 0) + 1; });
      addSection(ws, 'Demandas por Instrutor', ['Instrutor', 'Qtd'],
        Object.entries(iCounts).sort((a, b) => b[1] - a[1]).map(([id, v]) => [instructors.find(i => i.id === id)?.name || id, v]));
      // Modalidade
      const modalTotal = filteredDemands.length || 1;
      addSection(ws, 'Modalidade', ['Modalidade', 'Qtd', '% do Total'],
        [
          ['Presencial',    filteredDemands.filter(d => getDemandModality(d) === 'PRESENCIAL').length,                    `${Math.round(filteredDemands.filter(d => getDemandModality(d) === 'PRESENCIAL').length / modalTotal * 100)}%`],
          ['Online / EAD',  filteredDemands.filter(d => ['ONLINE','EAD','ONLINE_AO_VIVO'].includes(getDemandModality(d))).length,          `${Math.round(filteredDemands.filter(d => ['ONLINE','EAD','ONLINE_AO_VIVO'].includes(getDemandModality(d))).length / modalTotal * 100)}%`],
          ['Híbrido',       filteredDemands.filter(d => getDemandModality(d) === 'HIBRIDO').length,                       `${Math.round(filteredDemands.filter(d => getDemandModality(d) === 'HIBRIDO').length / modalTotal * 100)}%`],
        ]
      );
      // Agenda 7 dias
      const agenda7 = filteredDemands.filter(d => {
        const s = getCalculatedStatus(d); if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        const start = new Date(d.startDate); const end = new Date(d.endDate);
        return start <= next7 && end >= today;
      }).sort((a, b) => a.startDate.localeCompare(b.startDate));
      addSection(ws, 'Agenda — Próximos 7 Dias', ['ID', 'Início', 'Empresa', 'Treinamento', 'Instrutor', 'Status'],
        agenda7.map(d => [
          d.id,
          new Date(d.startDate).toLocaleDateString('pt-BR'),
          getCompanyName(d.companyId),
          getTrainingName(d.trainingId),
          instructors.find(i => i.id === d.instructorId)?.name || '—',
          STATUS_LABELS[getCalculatedStatus(d)] || getCalculatedStatus(d),
        ])
      );
    };

    const buildInstrutores = (ws: any) => {
      ws.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 16 }];
      const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const activeInstructors = instructors.filter(i => i.status === 'ATIVO');
      const busyNext30Ids = new Set(
        demands.filter(d => { const s = getCalculatedStatus(d); if (s === 'CANCELADA' || s === 'CONCLUIDA' || !d.instructorId) return false; const st = new Date(d.startDate); const en = new Date(d.endDate); return en >= today && st <= next30; }).map(d => d.instructorId!)
      );
      const instrWithDemandIds = new Set(filteredDemands.filter(d => d.instructorId).map(d => d.instructorId!));
      // KPIs
      const reuseStats = activeInstructors.filter(inst => {
        const distinct = new Set(demands.filter(d => d.instructorId === inst.id && getCalculatedStatus(d) === 'CONCLUIDA').map(d => d.trainingId));
        return distinct.size >= 2;
      }).length;
      const reuseRate = activeInstructors.length > 0 ? Math.round((reuseStats / activeInstructors.length) * 100) : 0;
      const depRisk = trainings.filter(t => t.status === 'ATIVO' && instructors.filter(i => i.skills.some(s => s.trainingId === t.id && s.level >= 3)).length <= 1).length;
      addSection(ws, 'KPIs Instrutores', ['Indicador', 'Valor'],
        [
          ['Ativos', activeInstructors.length],
          ['Disponíveis nos próximos 30d', activeInstructors.filter(i => !busyNext30Ids.has(i.id)).length],
          ['Sem demanda no período', activeInstructors.filter(i => !instrWithDemandIds.has(i.id)).length],
          ['Taxa de Reaproveitamento', `${reuseRate}%`],
          ['Risco de Dependência (trein.)', depRisk],
          ['Horas Concluídas (período)', `${formatHoursValue(totalHours)}h`],
        ]
      );
      // Workload — mesma fonte (instructor_allocations) do card "Horas Ministradas por Instrutor"
      const exportHoursMap = instructorHoursMapsByPeriod[0] ?? new Map<string, InstructorHoursEntry>();
      addSection(ws, 'Performance — Horas Concluídas no Período', ['Instrutor', 'Horas', 'Demandas', 'Divididas c/ outro instrutor'],
        activeInstructors.map(inst => {
          const entry = exportHoursMap.get(inst.id);
          const hrs = Math.round(((entry?.horas ?? 0) + Number.EPSILON) * 100) / 100;
          return [inst.name, hrs, entry?.nDemandas ?? 0, entry?.nDivididas ?? 0];
        }).filter(r => (r[1] as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number))
      );
      // Disponíveis 30d
      addSection(ws, 'Disponíveis nos Próximos 30 Dias', ['Instrutor', 'Região(ões)'],
        activeInstructors.filter(i => !busyNext30Ids.has(i.id)).map(i => [i.name, i.regionIds.map(rid => regions.find(r => r.id === rid)?.name || rid).join(', ')])
      );
      // Sem demanda
      addSection(ws, 'Sem Demanda no Período', ['Instrutor', 'Região(ões)'],
        activeInstructors.filter(i => !instrWithDemandIds.has(i.id)).map(i => [i.name, i.regionIds.map(rid => regions.find(r => r.id === rid)?.name || rid).join(', ')])
      );
      // Risco dependência
      const depRows = trainings.filter(t => t.status === 'ATIVO').map(t => ({
        name: t.name, count: instructors.filter(i => i.skills.some(s => s.trainingId === t.id && s.level >= 3)).length
      })).filter(r => r.count <= 1).sort((a, b) => a.count - b.count);
      addSection(ws, 'Risco de Dependência por Treinamento', ['Treinamento', 'Instrutores Aptos (nível ≥ 3)'],
        depRows.map(r => [r.name, r.count])
      );
      // Distribuição geográfica
      addSection(ws, 'Distribuição Geográfica', ['Região', 'Instrutores Habilitados', 'Demandas no Período'],
        regions.map(r => [r.name, activeInstructors.filter(i => i.regionIds?.includes(r.id)).length, filteredDemands.filter(d => d.regionId === r.id).length])
          .filter(r => (r[1] as number) > 0 || (r[2] as number) > 0).sort((a, b) => (b[2] as number) - (a[2] as number))
      );
    };

    const buildClientes = (ws: any) => {
      ws.columns = [{ width: 30 }, { width: 16 }, { width: 24 }];
      const clientData = companies.map(c => [c.name, filteredDemands.filter(d => d.companyId === c.id).length] as [string, number])
        .sort((a, b) => b[1] - a[1]).filter(c => c[1] > 0);
      addSection(ws, 'Clientes mais Ativos', ['Empresa', 'Volume de Demandas'], clientData);
      // Treinamentos por categoria
      const catCounts: Record<string, number> = {};
      trainings.forEach(t => {
        const c = filteredDemands.filter(d => d.trainingId === t.id).length;
        catCounts[t.category] = (catCounts[t.category] || 0) + c;
      });
      addSection(ws, 'Demandas por Categoria de Treinamento', ['Categoria', 'Qtd'],
        Object.entries(catCounts).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).map(([n, v]) => [n, v])
      );
    };

    const buildCustos = (ws: any) => {
      ws.columns = [{ width: 28 }, { width: 20 }, { width: 20 }, { width: 20 }];
      const hospTotal = sumByCat(filteredMeasurements, 'HOSPEDAGEM');
      const locoTotal = sumByCat(filteredMeasurements, 'LOCOMOCAO');
      const cafeTotal = sumByCat(filteredMeasurements, 'CAFE');
      const almoTotal = sumByCat(filteredMeasurements, 'ALMOCO');
      const jantTotal = sumByCat(filteredMeasurements, 'JANTAR');
      const outTotal  = sumByCat(filteredMeasurements, 'OUTROS');
      const ticketMedio = filteredMeasurements.length > 0 ? totalCosts / filteredMeasurements.length : 0;
      const naoIniciada = filteredDemands.filter(d => getCalculatedStatus(d) === 'CONCLUIDA' && (!filteredMeasurements.some(m => m.demandId === d.id) || filteredMeasurements.find(m => m.demandId === d.id)?.status === 'NAO_INICIADA')).length;
      addSection(ws, 'KPIs de Custos', ['Indicador', 'Valor'],
        [
          ['Total em Despesas', fmt(totalCosts)],
          ['Ticket Médio / Medição', fmt(ticketMedio)],
          [`Medições (${filteredMeasurements.length} total)`, filteredMeasurements.length],
          ['Não Iniciadas (dem. concluídas)', naoIniciada],
          ['Pronta Faturamento', filteredMeasurements.filter(m => m.status === 'PRONTA_FATURAMENTO').length],
          ['Faturadas', filteredMeasurements.filter(m => m.status === 'FATURADA').length],
        ]
      );
      addSection(ws, 'Despesas por Categoria', ['Categoria', 'Total'],
        [
          ['Hospedagem', fmt(hospTotal)],
          ['Locomoção', fmt(locoTotal)],
          ['Café da Manhã', fmt(cafeTotal)],
          ['Almoço', fmt(almoTotal)],
          ['Jantar', fmt(jantTotal)],
          ['Outros', fmt(outTotal)],
        ]
      );
      addSection(ws, 'Status das Medições', ['Status', 'Qtd'],
        [
          ['Não Iniciada', naoIniciada],
          ['Em Lançamento', filteredMeasurements.filter(m => m.status === 'LANCAMENTO').length],
          ['Em Conferência', filteredMeasurements.filter(m => m.status === 'CONFERENCIA').length],
          ['Pronta Faturamento', filteredMeasurements.filter(m => m.status === 'PRONTA_FATURAMENTO').length],
          ['Faturada', filteredMeasurements.filter(m => m.status === 'FATURADA').length],
        ]
      );
      // Top instrutores por custo
      const instrCostRows = instructors.map(inst => {
        const ids = new Set(filteredDemands.filter(d => d.instructorId === inst.id).map(d => d.id));
        const cost = filteredMeasurements.filter(m => ids.has(m.demandId)).reduce((acc, m) => acc + m.attachments.reduce((s: number, a: any) => s + toVal(a.value), 0), 0);
        return [inst.name, fmt(cost), cost] as [string, string, number];
      }).filter(r => r[2] > 0).sort((a, b) => b[2] - a[2]).map(([n, f]) => [n, f]);
      addSection(ws, 'Custo por Instrutor', ['Instrutor', 'Total de Despesas'], instrCostRows);
    };

    const buildInternas = (ws: any) => {
      addSection(ws, 'Resumo', ['Indicador', 'Valor'],
        [
          ['Demandas internas', internaKpis.totalDemandas],
          ['Horas previstas', `${formatHoursValue(internaKpis.horasPrevistas)}h`],
          ['Horas já ministradas', `${formatHoursValue(internaKpis.horasMinistradas)}h`],
          ['Com empresa vinculada', internaKpis.comEmpresa],
          ['Colabor (sem empresa)', internaKpis.semEmpresa],
          ['Concluídas sem alocação', internaKpis.concluidasSemAlocacao],
        ]
      );
      addSection(ws, 'Por Status', ['Status', 'Qtd'],
        internaKpis.porStatus.map(([status, n]) => [status.replace('_', ' '), n])
      );
      addSection(ws, 'Por Categoria', ['Categoria', 'Demandas', 'Horas Previstas'],
        internaKpis.categorias.map(c => [c.nome, c.n, `${formatHoursValue(c.horas)}h`])
      );
      addSection(ws, 'Top Instrutores em Horas Internas', ['Instrutor', 'Horas Ministradas', 'Demandas'],
        internaKpis.topInstrutores.map(r => [r.nome, `${formatHoursValue(r.horas)}h`, r.nDemandas])
      );
    };

    const TAB_CONFIG: { id: TabType; label: string; build: (ws: any) => void }[] = [
      { id: 'GERAL',       label: 'Visão Geral',  build: buildGeral },
      { id: 'OPERACIONAL', label: 'Operacional',  build: buildOperacional },
      { id: 'INSTRUTORES', label: 'Instrutores',  build: buildInstrutores },
      { id: 'CLIENTES',    label: 'Clientes',     build: buildClientes },
      { id: 'CUSTOS',      label: 'Custos',       build: buildCustos },
      { id: 'INTERNAS',    label: 'Internas',     build: buildInternas },
    ];

    const tabs = mode === 'current' ? TAB_CONFIG.filter(t => t.id === activeTab) : TAB_CONFIG;

    for (const tab of tabs) {
      const ws = wb.addWorksheet(tab.label);
      // Metadata row
      const meta = ws.addRow([`Dashboard Colabor — ${tab.label}`, '', `Exportado em: ${new Date().toLocaleDateString('pt-BR')}`]);
      meta.getCell(1).font = { bold: true, size: 12 };
      meta.getCell(3).font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
      meta.getCell(3).alignment = { horizontal: 'right' };
      ws.mergeCells(meta.number, 1, meta.number, 2);
      tab.build(ws);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = mode === 'current'
      ? `dashboard-${activeTab.toLowerCase()}_${dateStr}.xlsx`
      : `todos-os-dashboards_${dateStr}.xlsx`;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Dashboard Gerencial</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">BI & Inteligência Operacional Colabor</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
            {[
              { id: 'GERAL', label: 'Visão Geral', icon: Target },
              { id: 'OPERACIONAL', label: 'Operacional', icon: Truck },
              { id: 'INSTRUTORES', label: 'Instrutores', icon: Award },
              { id: 'CLIENTES', label: 'Clientes', icon: Building2 },
              { id: 'CUSTOS', label: 'Custos', icon: DollarSign },
              // Building2 seria o icone do menu, mas ja e o da aba Clientes aqui —
              // Home evita a colisao e le como "casa", que e o que interna e.
              { id: 'INTERNAS', label: 'Internas', icon: Home }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id as TabType); setShowHelp(false); }}
                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 ${activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                  }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Botão exportar */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(v => !v)}
              title="Exportar dashboard"
              className={`p-2 rounded-xl border transition-all ${
                showExportMenu
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  : 'bg-white border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50'
              } shadow-sm`}
            >
              <Download size={16} />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[220px]">
                  <button
                    onClick={() => handleExportDashboard('current')}
                    className="w-full px-4 py-3 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors border-b border-slate-100"
                  >
                    <Download size={13} className="text-emerald-500" />
                    Exportar este dashboard
                  </button>
                  <button
                    onClick={() => handleExportDashboard('all')}
                    className="w-full px-4 py-3 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors"
                  >
                    <Download size={13} className="text-blue-500" />
                    Exportar todos os dashboards
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Botão de ajuda contextual */}
          <button
            onClick={() => setShowHelp(v => !v)}
            title="Legenda da aba"
            className={`p-2 rounded-xl border transition-all ${
              showHelp
                ? 'bg-blue-50 border-blue-200 text-blue-500'
                : 'bg-white border-slate-200 text-slate-400 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50'
            } shadow-sm`}
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>

      {/* Filtros Globais */}
      <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-slate-200">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[130px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Building2 size={10} /> Empresa</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.companyId} onChange={e => setFilters(prev => ({ ...prev, companyId: e.target.value }))}>
              <option value="">Todas</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="min-w-[120px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin size={10} /> Região</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.regionId} onChange={e => setFilters(prev => ({ ...prev, regionId: e.target.value }))}>
              <option value="">Todas</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div className="min-w-[120px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Filter size={10} /> Status (Real)</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[130px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><MapPin size={10} /> Local do Treinamento</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.trainingLocal} onChange={e => setFilters(prev => ({ ...prev, trainingLocal: e.target.value }))}>
              <option value="">Todos</option>
              {availableTrainingLocals.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="min-w-[110px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Truck size={10} /> Corredor</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.corredor} onChange={e => setFilters(prev => ({ ...prev, corredor: e.target.value }))}>
              <option value="">Todos</option>
              {availableCorredores.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="min-w-[130px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Monitor size={10} /> Modalidade</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.modality} onChange={e => setFilters(prev => ({ ...prev, modality: e.target.value }))}>
              <option value="">Todas</option>
              {availableModalities.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="min-w-[100px] flex-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><Target size={10} /> Estado (UF)</label>
            <select className="w-full border border-slate-200 rounded-xl px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" value={filters.demandState} onChange={e => setFilters(prev => ({ ...prev, demandState: e.target.value }))}>
              <option value="">Todos</option>
              {availableStates.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <button
            onClick={() => setFilters({ startDate: '', endDate: '', companyId: '', regionId: '', status: '', trainingLocal: '', corredor: '', demandState: '', modality: '' })}
            className="px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors shrink-0"
          >
            Limpar
          </button>
        </div>

        {/* ── Lista de Períodos ──────────────────────────────────────── */}
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">

          {/* P1 — período principal (sempre presente) */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 shrink-0 w-8">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: PERIOD_COLORS[0] }}
              />
              <span className="text-[9px] font-black text-slate-400 uppercase">P1</span>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Mês/Ano</label>
              <select
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white capitalize"
                value={getMonthSelectorValue()}
                onChange={e => handleMonthFilterChange(e.target.value)}
              >
                <option value="">Todos</option>
                {availableMonths.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <input
                type="date"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner bg-slate-50/50"
                value={filters.startDate}
                onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              />
              <input
                type="date"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-inner bg-slate-50/50"
                value={filters.endDate}
                onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>
            {/* espaço reservado para alinhar com o X dos períodos extras */}
            <div className="w-6 shrink-0" />
          </div>

          {/* P2…PN — períodos extras */}
          {extraPeriods.map((p, idx) => {
            const colorIdx = (idx + 1) % PERIOD_COLORS.length;
            const color    = PERIOD_COLORS[colorIdx];
            return (
              <div key={p.id} className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-1.5 shrink-0 w-8">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[9px] font-black text-slate-400 uppercase">P{idx + 2}</span>
                </div>
                <div className="min-w-[150px]">
                  <label className="block text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color }}>Mês/Ano</label>
                  <select
                    className="w-full border rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 shadow-sm bg-white capitalize"
                    style={{ borderColor: `${color}55`, '--tw-ring-color': color } as React.CSSProperties}
                    value={getExtraMonthValue(p)}
                    onChange={e => handleExtraMonthChange(p.id, e.target.value)}
                  >
                    <option value="">Todos</option>
                    {availableMonths.map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 flex-1 min-w-[200px]">
                  <input
                    type="date"
                    className="flex-1 border rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 shadow-inner bg-slate-50/50"
                    style={{ borderColor: `${color}55` }}
                    value={p.startDate}
                    onChange={e => updateExtraPeriod(p.id, { startDate: e.target.value })}
                  />
                  <input
                    type="date"
                    className="flex-1 border rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 shadow-inner bg-slate-50/50"
                    style={{ borderColor: `${color}55` }}
                    value={p.endDate}
                    onChange={e => updateExtraPeriod(p.id, { endDate: e.target.value })}
                  />
                </div>
                <button
                  onClick={() => removeExtraPeriod(p.id)}
                  title="Remover período"
                  className="w-6 shrink-0 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}

          {/* Botão adicionar + aviso de limite + Gerar relatório */}
          <div className="flex items-center gap-3 pt-0.5 flex-wrap">
            <button
              onClick={addExtraPeriod}
              disabled={extraPeriods.length >= 5}
              className="flex items-center gap-1 text-[10px] font-black text-blue-500 uppercase tracking-widest hover:text-blue-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowLeftRight size={11} />
              + Adicionar período
            </button>
            {extraPeriods.length >= 5 && (
              <span className="text-[9px] font-bold text-slate-400">
                Máximo de 6 períodos atingido
              </span>
            )}
            {compareMode && (
              <button
                onClick={() => setShowReportModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm transition-all"
              >
                <Download size={11} />
                Gerar relatório
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-[500px]">
        {activeTab === 'GERAL' && renderGeral()}
        {activeTab === 'OPERACIONAL' && renderOperacional()}
        {activeTab === 'INSTRUTORES' && renderInstrutores()}
        {activeTab === 'CLIENTES' && renderClientes()}
        {activeTab === 'CUSTOS' && renderCustos()}
        {activeTab === 'INTERNAS' && renderInternas()}
      </div>

      {/* Drawer de ajuda */}
      {showHelp && <HelpDrawer tab={activeTab} onClose={() => setShowHelp(false)} />}

      {/* Modal de geração de relatório */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        reportInput={reportInput}
      />
    </div>
  );
};

export default Dashboard;
