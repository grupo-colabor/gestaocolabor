/**
 * CARD "DESPESAS NÃO REEMBOLSÁVEIS" — aba CUSTOS do Dashboard
 *
 * Recebe a lista PRONTA (`listNonReimbursableByDemand`, calculada no
 * Dashboard em um useMemo que o export também lê) e só desenha: o resumo de
 * sempre (total, "N itens em M medições", os quatro mini-cards do Painel de
 * Medição) e, ao clicar no cabeçalho, a lista por trás do número em duas
 * visões — "Por demanda" (uma linha por demanda, itens ao clicar) e "Por item"
 * (tabela plana, ordenável por valor e por data). Nenhuma soma é feita aqui:
 * rodapés e totais vêm do mesmo objeto do card, então não há como divergir.
 *
 * Comportamentos combinados:
 *   • começa SEMPRE recolhido; o cabeçalho inteiro é o botão (aria-expanded);
 *   • a visão escolhida é lembrada em localStorage (try/catch; sem ela o card
 *     renderiza igual, em "Por demanda"); trocar de visão NÃO recolhe o card;
 *   • paginação local nas duas visões (usePagination + useStableArray, para a
 *     página não voltar a 1 em re-render alheio), visível acima de 20 linhas;
 *   • com comparação de períodos ligada, o número grande vira a fileira
 *     P1..PN como nos KPIs — a lista continua só de P1 (opção A do parecer);
 *   • órfãos de Outros marcados ficam fora da lista e do total, mas a nota
 *     "N itens órfãos fora do total" avisa que existem.
 *
 * O DEM-N vira link para a Medição quando `onOpenDemand` é informado (só com
 * permissão de acessar a tela — quem decide é o Dashboard); o clique nele não
 * expande/recolhe a linha (stopPropagation).
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { ExpenseSummaryCard } from '../ui/ExpenseSummaryCard';
import Pagination from '../Pagination';
import { usePagination } from '../../hooks/usePagination';
import { useStableArray } from '../../hooks/useStableArray';
import { PANEL_EXPENSE_LABELS, type PanelExpenseBucket } from '../../domain/measurementTotals';
import type { NonReimbursableDemand, NonReimbursableItem, NonReimbursableList } from '../../domain/nonReimbursableExpenses';
import { toBrDate } from '../../domain/exports/shared';
import { ACCENT, TOGGLE_OFF } from './MetricToggle';

export type NonReimbursableView = 'demanda' | 'item';

const VIEW_STORAGE_KEY = 'dashboard.naoReemb.visao';
const PAGE_SIZE = 20;

/** Lê a visão lembrada; qualquer problema com localStorage cai no padrão. */
function readStoredView(): NonReimbursableView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === 'item' ? 'item' : 'demanda';
  } catch {
    return 'demanda';
  }
}

function storeView(v: NonReimbursableView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  } catch {
    // localStorage indisponível (modo privado restrito): a escolha vale só nesta sessão.
  }
}

/** Cores dos cinco status da medição, as mesmas do Painel de Medição. */
const STATUS_BADGE: Record<string, string> = {
  NAO_INICIADA: 'bg-slate-100 text-slate-600',
  LANCAMENTO: 'bg-orange-100 text-orange-800',
  CONFERENCIA: 'bg-blue-100 text-blue-800',
  PRONTA_FATURAMENTO: 'bg-green-100 text-green-800',
  FATURADA: 'bg-purple-100 text-purple-800',
};

const periodo = (inicio: string, fim: string): string => {
  const a = toBrDate(inicio);
  const b = toBrDate(fim);
  if (!a && !b) return '—';
  return a === b || !b ? a : `${a} – ${b}`;
};

type SortKey = 'valor' | 'data';
type SortDir = 'asc' | 'desc';

/** Chave de data do item: a do item quando existe, senão o início da demanda. */
const dataChave = (it: NonReimbursableItem): string => (it.dataItem || it.dataInicio || '');

export interface NonReimbursablePeriodTotal {
  label: string;
  color: string;
  value: number;
}

export interface NonReimbursableCardProps {
  list: NonReimbursableList;
  formatCurrency: (v: number) => string;
  /** Ícone e cor de cada mini-card (o mesmo mapa do card de internas). */
  bucketStyle: Record<PanelExpenseBucket, { icon: any; colorClass: string }>;
  /** Comparação ligada: um total por período (P1..PN). Ausente/1 = número único. */
  periods?: NonReimbursablePeriodTotal[];
  /** Abre a demanda na Medição. Ausente = o DEM-N é texto. */
  onOpenDemand?: (demandId: string) => void;
}

const TH = 'px-3 py-2.5 whitespace-nowrap';
const TD = 'px-3 py-2 text-[11px] whitespace-nowrap';
const MONEY = `${TD} text-right font-mono tabular-nums`;

const NonReimbursableCard: React.FC<NonReimbursableCardProps> = ({ list, formatCurrency, bucketStyle, periods, onOpenDemand }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<NonReimbursableView>(readStoredView);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'valor', dir: 'desc' });

  const changeView = (v: NonReimbursableView) => {
    setView(v);
    storeView(v);
  };

  const toggleDemand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleSort = (key: SortKey) =>
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  // ---- Por demanda: a ordem já vem da lista (total desc). ----
  const demandas = useStableArray<NonReimbursableDemand>(list.demandas, d => `${d.demandId}:${d.total}:${d.qtdItens}`);
  const pagDemandas = usePagination<NonReimbursableDemand>(demandas, 'dashboard.naoReemb.porDemanda', PAGE_SIZE);

  // ---- Por item: ordenação local sobre a lista plana. ----
  const itensOrdenados = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list.itens].sort((a, b) => {
      if (sort.key === 'valor') return (a.valor - b.valor) * dir || a.demandId.localeCompare(b.demandId);
      return dataChave(a).localeCompare(dataChave(b)) * dir || a.demandId.localeCompare(b.demandId) || b.valor - a.valor;
    });
  }, [list.itens, sort]);
  const itens = useStableArray<NonReimbursableItem>(itensOrdenados, i => `${i.demandId}/${i.itemId}:${i.valor}`);
  const pagItens = usePagination<NonReimbursableItem>(itens, 'dashboard.naoReemb.porItem', PAGE_SIZE);

  const comparando = !!periods && periods.length >= 2;
  const listaId = 'dashboard-nao-reembolsaveis-lista';

  const sortIcon = (key: SortKey) =>
    sort.key !== key ? <ArrowUpDown size={10} className="opacity-40" /> : sort.dir === 'desc' ? <ArrowDown size={10} /> : <ArrowUp size={10} />;

  const DemandLink: React.FC<{ id: string }> = ({ id }) =>
    onOpenDemand ? (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onOpenDemand(id); }}
        title="Abrir na Medição"
        className="font-mono font-black text-blue-600 hover:underline"
      >
        {id}
      </button>
    ) : (
      <span className="font-mono font-black text-slate-700">{id}</span>
    );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Cabeçalho inteiro é o botão de expandir/recolher. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={listaId}
        className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 text-left hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Despesas Não Reembolsáveis</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">
              O que a Colabor absorve — já incluso no total acima
              <span className="normal-case tracking-normal text-slate-300 font-bold"> · {open ? 'recolher' : 'ver demandas'}</span>
            </p>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-amber-50 text-amber-600 shrink-0">
          <ShieldAlert size={20} />
        </div>
      </button>

      {/* Resumo: total em destaque à esquerda, os quatro mini-cards à direita.
          Os mini-cards aparecem SEMPRE, zerados inclusive, para o card não
          mudar de altura quando a primeira despesa for marcada. */}
      <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="lg:w-48 xl:w-56 shrink-0 min-w-0">
          {comparando ? (
            <div className="space-y-1">
              {periods!.map((p, i) => {
                const delta = i > 0 ? p.value - periods![0].value : null;
                // Não reembolsável: menor é melhor.
                const bom = delta !== null && delta <= 0;
                return (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: p.color }}>{p.label}</span>
                    <span className={`font-black leading-none ${i === 0 ? 'text-xl text-amber-600' : 'text-base text-slate-600'}`}>{formatCurrency(p.value)}</span>
                    {delta !== null && (
                      <span className={`text-[9px] font-black ${bom ? 'text-emerald-600' : 'text-red-500'}`}>
                        {bom ? '↓' : '↑'}{delta >= 0 ? '+' : ''}{formatCurrency(delta)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <h4 className="text-2xl font-black text-amber-600">{formatCurrency(list.total)}</h4>
          )}
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            {list.qtdItens} ite{list.qtdItens === 1 ? 'm' : 'ns'} em {list.medicoes} medi{list.medicoes === 1 ? 'ção' : 'ções'}
            {comparando && <span className="text-slate-300"> · P1</span>}
          </p>
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PANEL_EXPENSE_LABELS.map(({ key, label }) => (
            <ExpenseSummaryCard
              key={key}
              label={label}
              value={formatCurrency(list.quebra[key])}
              icon={bucketStyle[key].icon}
              colorClass={bucketStyle[key].colorClass}
              surfaceClass="bg-slate-50"
            />
          ))}
        </div>
      </div>

      {list.total <= 0 && (
        <p className="px-5 pb-5 -mt-2 text-[11px] text-slate-300 italic font-bold">
          Nenhuma despesa marcada como não reembolsável no período.
        </p>
      )}
      {list.itensOrfaos > 0 && (
        <p className="px-5 pb-4 -mt-2 text-[10px] text-slate-400 font-bold" title="Anexos de Outras despesas apontando para linha apagada: o painel não soma, e aqui também não.">
          {list.itensOrfaos} ite{list.itensOrfaos === 1 ? 'm órfão' : 'ns órfãos'} fora do total
        </p>
      )}

      {/* ─────────────── Lista (recolhida por padrão) ─────────────── */}
      {open && (
        <div id={listaId} className="border-t border-slate-100">
          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
            <div className="flex gap-1" role="group" aria-label="Visão da lista">
              {([['demanda', 'Por demanda'], ['item', 'Por item']] as [NonReimbursableView, string][]).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={`text-[9px] font-black px-2.5 py-1 rounded-md transition-colors ${view === v ? ACCENT.amber.toggleOn : TOGGLE_OFF}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {view === 'demanda'
                ? `${list.demandas.length} demanda${list.demandas.length === 1 ? '' : 's'} · ordem por total`
                : `${list.itens.length} ite${list.itens.length === 1 ? 'm' : 'ns'} · clique em Data ou Valor para ordenar`}
            </p>
          </div>

          {list.itens.length === 0 ? (
            <p className="px-5 py-6 text-[11px] text-slate-300 italic font-bold">Nenhum item marcado no período.</p>
          ) : view === 'demanda' ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                      <th className={`${TH} w-6`} aria-label="Expandir" />
                      <th className={TH}>Demanda</th>
                      <th className={TH}>Empresa</th>
                      <th className={TH}>Treinamento</th>
                      <th className={TH}>Período</th>
                      <th className={TH}>Pessoa(s)</th>
                      <th className={TH}>Medição</th>
                      <th className={`${TH} text-right`}>Hospedagem</th>
                      <th className={`${TH} text-right`}>Locomoção</th>
                      <th className={`${TH} text-right`}>Alimentação</th>
                      <th className={`${TH} text-right`}>Outros</th>
                      <th className={`${TH} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pagDemandas.paginatedItems.map(d => {
                      const aberta = expanded.has(d.demandId);
                      return (
                        <React.Fragment key={d.demandId}>
                          <tr
                            onClick={() => toggleDemand(d.demandId)}
                            className="hover:bg-amber-50/40 transition-colors cursor-pointer"
                            aria-expanded={aberta}
                          >
                            <td className={`${TD} text-slate-400`}>
                              {aberta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </td>
                            <td className={TD}><DemandLink id={d.demandId} /></td>
                            <td className={`${TD} font-bold text-slate-700 max-w-[140px] truncate`} title={d.empresa}>{d.empresa}</td>
                            <td className={`${TD} text-slate-600 max-w-[200px] truncate`} title={d.treinamento}>{d.treinamento}</td>
                            <td className={`${TD} text-slate-600`}>{periodo(d.dataInicio, d.dataFim)}</td>
                            <td className={`${TD} text-slate-600 max-w-[200px] truncate`} title={d.pessoasLabel}>{d.pessoasLabel}</td>
                            <td className={TD}>
                              <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${STATUS_BADGE[d.medicaoStatus] || 'bg-slate-100 text-slate-500'}`}>
                                {d.medicaoStatusLabel}
                              </span>
                            </td>
                            <td className={`${MONEY} text-slate-600`}>{formatCurrency(d.quebra.hospedagem)}</td>
                            <td className={`${MONEY} text-slate-600`}>{formatCurrency(d.quebra.locomocao)}</td>
                            <td className={`${MONEY} text-slate-600`}>{formatCurrency(d.quebra.alimentacao)}</td>
                            <td className={`${MONEY} text-slate-600`}>{formatCurrency(d.quebra.outros)}</td>
                            <td className={`${MONEY} font-black text-amber-700`}>{formatCurrency(d.total)}</td>
                          </tr>
                          {aberta && (
                            <tr className="bg-slate-50/50">
                              <td />
                              <td colSpan={11} className="px-3 pb-3 pt-1">
                                <table className="w-full text-left">
                                  <thead>
                                    <tr className="text-[9px] text-slate-400 uppercase font-black border-b border-slate-100">
                                      <th className="px-2 py-1.5">Categoria</th>
                                      <th className="px-2 py-1.5">Descrição</th>
                                      <th className="px-2 py-1.5">Data</th>
                                      <th className="px-2 py-1.5">Dono</th>
                                      <th className="px-2 py-1.5">Pago pelo instrutor</th>
                                      <th className="px-2 py-1.5 text-right">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {d.itens.map(it => (
                                      <tr key={it.itemId}>
                                        <td className="px-2 py-1.5 text-[11px] font-bold text-slate-700 whitespace-nowrap">{it.categoriaLabel}</td>
                                        <td className="px-2 py-1.5 text-[11px] text-slate-600 max-w-[260px] truncate" title={it.descricao}>{it.descricao || '—'}</td>
                                        <td className="px-2 py-1.5 text-[11px] text-slate-500 whitespace-nowrap">{toBrDate(it.dataItem) || '—'}</td>
                                        <td className="px-2 py-1.5 text-[11px] text-slate-600 whitespace-nowrap">
                                          {it.pessoa} <span className="text-slate-400">({it.papelLabel})</span>
                                        </td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                          {it.pagoPeloInstrutor
                                            ? <span className="px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-300">Pago pelo instrutor</span>
                                            : <span className="text-[10px] text-slate-300">—</span>}
                                        </td>
                                        <td className="px-2 py-1.5 text-[11px] text-right font-mono tabular-nums font-bold text-slate-700">{formatCurrency(it.valor)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200 text-[11px] font-black text-slate-700">
                      <td />
                      <td className={TD} colSpan={6}>Total · {list.demandas.length} demanda{list.demandas.length === 1 ? '' : 's'}, {list.qtdItens} ite{list.qtdItens === 1 ? 'm' : 'ns'}</td>
                      <td className={MONEY}>{formatCurrency(list.quebra.hospedagem)}</td>
                      <td className={MONEY}>{formatCurrency(list.quebra.locomocao)}</td>
                      <td className={MONEY}>{formatCurrency(list.quebra.alimentacao)}</td>
                      <td className={MONEY}>{formatCurrency(list.quebra.outros)}</td>
                      <td className={`${MONEY} text-amber-700`}>{formatCurrency(list.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {demandas.length > PAGE_SIZE && (
                <Pagination
                  currentPage={pagDemandas.currentPage}
                  totalPages={pagDemandas.totalPages}
                  totalItems={demandas.length}
                  itemsPerPage={pagDemandas.itemsPerPage}
                  startIdx={pagDemandas.startIdx}
                  entityLabel="demandas"
                  onPageChange={pagDemandas.setCurrentPage}
                  onItemsPerPageChange={pagDemandas.handleItemsPerPageChange}
                />
              )}
            </>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase font-black bg-slate-50/60 border-b border-slate-100">
                      <th className={TH}>Demanda</th>
                      <th className={TH}>Empresa</th>
                      <th className={TH}>Treinamento</th>
                      <th className={TH}>Pessoa</th>
                      <th className={TH}>Papel</th>
                      <th className={TH}>Categoria</th>
                      <th className={TH}>Descrição</th>
                      <th className={TH} aria-sort={sort.key === 'data' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggleSort('data')} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">
                          Data {sortIcon('data')}
                        </button>
                      </th>
                      <th className={TH}>Pago pelo instrutor</th>
                      <th className={`${TH} text-right`} aria-sort={sort.key === 'valor' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggleSort('valor')} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">
                          Valor {sortIcon('valor')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pagItens.paginatedItems.map(it => (
                      <tr key={`${it.demandId}/${it.itemId}`} className="hover:bg-amber-50/40 transition-colors">
                        <td className={TD}><DemandLink id={it.demandId} /></td>
                        <td className={`${TD} font-bold text-slate-700 max-w-[140px] truncate`} title={it.empresa}>{it.empresa}</td>
                        <td className={`${TD} text-slate-600 max-w-[180px] truncate`} title={it.treinamento}>{it.treinamento}</td>
                        <td className={`${TD} text-slate-600 max-w-[160px] truncate`} title={it.pessoa}>{it.pessoa}</td>
                        <td className={`${TD} text-slate-500`}>{it.papelLabel}</td>
                        <td className={`${TD} font-bold text-slate-700`}>{it.categoriaLabel}</td>
                        <td className={`${TD} text-slate-600 max-w-[220px] truncate`} title={it.descricao}>{it.descricao || '—'}</td>
                        <td className={`${TD} text-slate-500`}>{toBrDate(it.dataItem) || '—'}</td>
                        <td className={TD}>
                          {it.pagoPeloInstrutor
                            ? <span className="px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-300">Sim</span>
                            : <span className="text-[10px] text-slate-300">—</span>}
                        </td>
                        <td className={`${MONEY} font-black text-slate-700`}>{formatCurrency(it.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200 text-[11px] font-black text-slate-700">
                      <td className={TD} colSpan={9}>Total · {list.qtdItens} ite{list.qtdItens === 1 ? 'm' : 'ns'} em {list.medicoes} medi{list.medicoes === 1 ? 'ção' : 'ções'}</td>
                      <td className={`${MONEY} text-amber-700`}>{formatCurrency(list.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {itens.length > PAGE_SIZE && (
                <Pagination
                  currentPage={pagItens.currentPage}
                  totalPages={pagItens.totalPages}
                  totalItems={itens.length}
                  itemsPerPage={pagItens.itemsPerPage}
                  startIdx={pagItens.startIdx}
                  entityLabel="itens"
                  onPageChange={pagItens.setCurrentPage}
                  onItemsPerPageChange={pagItens.handleItemsPerPageChange}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default NonReimbursableCard;
