import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, PencilLine, Save, Search, Undo2 } from 'lucide-react';
import type { MedicaoValeRow } from '../../domain/exports/datasets/medicaoVale';
import type { HybridPart, TemplateColumn } from '../../domain/exports/templates/types';
import { manualColumnKey, resolveManualValue, type ManualValueSource } from '../../domain/exports/templates/resolve';
import { hybridPriceStatus, type HybridPriceBadge } from '../../domain/exports/templates/hybridPrice';
import type { HybridSplit } from '../../domain/hybridHours';
import type { TemplateValuesIndex, TemplateValueScope } from '../../domain/exports/templates/values';
import { toBrDate } from '../../domain/exports/shared';
import { usePagination } from '../../hooks/usePagination';
import { useStableArray } from '../../hooks/useStableArray';
import Pagination from '../Pagination';

export type EdicaoPendente = {
  scope: TemplateValueScope;
  refId: string;
  columnKey: string;
  value: number | string | null;
  /** Template dono do valor. Ausente = o template da aba de linhas (preços e campos por turma). */
  templateId?: string;
};

const FONTE_LABEL: Record<ManualValueSource, string> = {
  demanda: 'sobrescrito',
  treinamento: 'treinamento',
  padrão: 'padrão',
  vazio: 'vazio',
};
/** Cores da badge "fonte do preço": vazio em amarelo, igual à célula da planilha. */
const FONTE_CLASS: Record<ManualValueSource, string> = {
  demanda: 'bg-blue-100 text-blue-700',
  treinamento: 'bg-slate-100 text-slate-600',
  padrão: 'bg-slate-100 text-slate-600',
  vazio: 'bg-yellow-100 text-yellow-800',
};

/** Selo do card de treinamento híbrido: amarelo enquanto faltar um dos dois preços. */
const SELO_HIBRIDA_CLASS: Record<HybridPriceBadge, string> = {
  'com preço': FONTE_CLASS.treinamento,
  'falta online': FONTE_CLASS.vazio,
  'falta presencial': FONTE_CLASS.vazio,
  'sem preço': FONTE_CLASS.vazio,
};

/** Rótulo das horas ao lado de cada preço da híbrida ("8h" / "32h"), ou o motivo de não haver. */
const horasDaParte = (split: HybridSplit | undefined, parte: HybridPart): string => {
  if (!split) return '';
  if (split.ok !== true) return 'horas práticas não cadastradas';
  return `${parte === 'PRESENCIAL' ? split.presencial : split.online}h`;
};

const PAGE = 25;
const normalize = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const inputClass = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const searchClass = 'w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500';

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer whitespace-nowrap">
    <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={checked} onChange={e => onChange(e.target.checked)} />
    {label}
  </label>
);

const SectionHeader: React.FC<{ aberto: boolean; onToggle: () => void; titulo: string; resumo: string }> = ({ aberto, onToggle, titulo, resumo }) => (
  <button type="button" onClick={onToggle} className="w-full px-6 py-3 flex items-center gap-3 text-left hover:bg-slate-50 border-t border-slate-100">
    {aberto ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{titulo}</span>
    <span className="text-[11px] text-slate-500">— {resumo}</span>
  </button>
);

/**
 * Campos manuais do template, editáveis na prévia. Dois blocos recolhidos por
 * padrão, com contador no cabeçalho:
 *   • POR TREINAMENTO (persistScope 'training'): o preço HH que vale para toda
 *     turma daquele treinamento sem sobrescrita. Só os treinamentos das turmas
 *     do recorte; o toggle "mostrar todos os treinamentos Vale" lista também os
 *     de outras demandas da Vale, para cadastrar preço antecipadamente. Sem
 *     preço primeiro, depois alfabético.
 *   • POR TURMA: sobrescrita do preço, combustível, % e observação. Busca,
 *     toggle "só turmas com pendência ou exceção" (ligado) e 25 por página.
 * Nada é gravado aqui: as edições sobem como pendentes; a barra fixa no rodapé
 * oferece Salvar / Descartar enquanto houver pendente. O download fica travado
 * nesse estado (a tela pai cuida disso).
 *
 * HÍBRIDA (template com `hybridSplit`): o treinamento híbrido tem DOIS campos
 * de preço — presencial e online, cada um com as horas da parte ao lado — e o
 * selo só diz "com preço" com os dois preenchidos ("falta online" / "falta
 * presencial" com um só). Na turma, a sobrescrita também é por parte. O preço
 * único gravado antes da divisão aparece no card e não é usado em silêncio.
 */
const GradeEditavel: React.FC<{
  /** Turmas elegíveis do recorte (as que vão para a planilha). */
  rows: MedicaoValeRow[];
  /** Todas as demandas da empresa (qualquer status/período), para "todos os treinamentos Vale". */
  allRows: MedicaoValeRow[];
  columns: TemplateColumn[];
  values: TemplateValuesIndex;
  onEdit: (e: EdicaoPendente) => void;
  trainingNames: Map<string, string>;
  /**
   * Treinamentos HÍBRIDOS (id → divisão pelo cadastro). Com `hybridSplit`
   * ligado, cada um ganha dois campos de preço. Ausente = nenhum híbrido.
   */
  hibridas?: Map<string, HybridSplit>;
  /** O template da aba de linhas divide a híbrida? (modelos do banco: não). */
  hybridSplit?: boolean;
  /** Demandas com pendência (ids), para o toggle "só com pendência ou exceção". */
  demandasComPendencia: Set<string>;
  pendentes: number;
  salvando: boolean;
  onSalvar: () => void;
  onDescartar: () => void;
  /** Muda a cada salvar/descartar: remonta os inputs (não controlados). */
  resetKey: number;
}> = ({ rows, allRows, columns, values, onEdit, trainingNames, hibridas, hybridSplit = false, demandasComPendencia, pendentes, salvando, onSalvar, onDescartar, resetKey }) => {
  /** A híbrida só tem dois preços quando o template divide E a coluna declara as chaves. */
  const splitDe = useCallback(
    (tid: string): HybridSplit | undefined => (hybridSplit && hibridas ? hibridas.get(tid) : undefined),
    [hybridSplit, hibridas]
  );
  // ⚠️ Memoizadas de propósito: `porDemanda` entra nas dependências do
  // useMemo de `turmas`. Sem isto, cada render produzia um array novo, `turmas`
  // ganhava referência nova e o usePagination (que volta para a página 1 quando
  // a lista muda) desfazia o clique em "2" no mesmo ciclo — a paginação da
  // grade parecia travada. Coberto por scripts/smokeGradePaginacao.tsx.
  const { porTreinamento, porDemanda, precoCol } = useMemo(() => {
    const manuais = columns.filter(c => c.source === 'manual' && c.editable);
    const treino = manuais.filter(c => c.persistScope === 'training');
    return {
      porTreinamento: treino,
      porDemanda: manuais.filter(c => c.persistScope === 'demand' || c.overrideScope === 'demand'),
      precoCol: treino[0] as TemplateColumn | undefined,
    };
  }, [columns]);

  const [abertoTreino, setAbertoTreino] = useState(false);
  const [abertoTurma, setAbertoTurma] = useState(false);
  const [buscaTreino, setBuscaTreino] = useState('');
  const [todosTreinos, setTodosTreinos] = useState(false);
  const [buscaTurma, setBuscaTurma] = useState('');
  const [soPendentes, setSoPendentes] = useState(true);

  /* ───────── por treinamento ───────── */
  const idsNoRecorte = useMemo(() => new Set<string>(rows.map(r => r.trainingId).filter(id => !!id)), [rows]);
  const idsVale = useMemo(() => new Set<string>(allRows.map(r => r.trainingId).filter(id => !!id)), [allRows]);
  /**
   * "Com preço" por treinamento: o preço de sempre — ou, na híbrida dividida,
   * os DOIS preços da parte. É a mesma regra do selo e do contador.
   */
  const temPreco = useCallback(
    (tid: string): boolean => {
      if (!precoCol) return false;
      const refs = { trainingId: tid, demandId: '' };
      if (precoCol.hybridKeys && splitDe(tid)) return hybridPriceStatus(precoCol, refs, values).completo;
      return resolveManualValue(precoCol, refs, values).fonte === 'treinamento';
    },
    [precoCol, splitDe, values]
  );
  const treinamentos = useMemo(() => {
    const base: string[] = Array.from(todosTreinos ? idsVale : idsNoRecorte);
    const q = normalize(buscaTreino.trim());
    return base
      .map(tid => ({ tid, nome: trainingNames.get(tid) ?? tid, comPreco: temPreco(tid) }))
      .filter(t => !q || normalize(t.nome).includes(q))
      .sort((a, b) => Number(a.comPreco) - Number(b.comPreco) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [idsNoRecorte, idsVale, todosTreinos, buscaTreino, temPreco, trainingNames]);
  const totalTreinos = (todosTreinos ? idsVale : idsNoRecorte).size;
  const treinosComPreco = useMemo(
    () => Array.from<string>(todosTreinos ? idsVale : idsNoRecorte).filter(temPreco).length,
    [idsNoRecorte, idsVale, todosTreinos, temPreco]
  );

  /* ───────── por turma ───────── */
  /** As partes que a linha tem na grade: duas na híbrida dividida, senão uma "inteira" (undefined). */
  const partesDe = useCallback(
    (r: MedicaoValeRow): (HybridPart | undefined)[] =>
      hybridSplit && r.hibrida && precoCol?.hybridKeys ? ['PRESENCIAL', 'ONLINE'] : [undefined],
    [hybridSplit, precoCol]
  );
  const temExcecao = useCallback(
    (r: MedicaoValeRow) =>
      porDemanda.some(c =>
        (c.hybridKeys ? partesDe(r) : [undefined]).some(parte => resolveManualValue(c, { ...r.refs, parte }, values).fonte === 'demanda')
      ),
    [porDemanda, partesDe, values]
  );
  const turmasComExcecao = useMemo(() => rows.filter(temExcecao).length, [rows, temExcecao]);
  const turmasDerivadas = useMemo(() => {
    const q = normalize(buscaTurma.trim());
    return rows.filter(r => {
      if (soPendentes && !demandasComPendencia.has(r.demand.id) && !temExcecao(r)) return false;
      if (!q) return true;
      return normalize([r.demand.id, r.input.clientDemandId, r.input.trainingName, ...r.input.titulares].join(' ')).includes(q);
    });
  }, [rows, buscaTurma, soPendentes, demandasComPendencia, temExcecao]);
  // Referência estável por conteúdo: editar um preço muda `values` (e
  // `temExcecao`), mas a lista de turmas é a mesma — a página não pode voltar.
  const turmas = useStableArray<MedicaoValeRow>(turmasDerivadas, r => r.demand.id);
  const pag = usePagination<MedicaoValeRow>(turmas, 'exportacoes.grade.turmas', PAGE);

  const parse = (col: TemplateColumn, raw: string): number | string | null => {
    if (col.format === 'text') return raw;
    if (raw.trim() === '') return null;
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return col.format === 'percent' ? n / 100 : n;
  };
  const show = (col: TemplateColumn, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (col.format === 'percent') return String(Math.round(Number(v) * 10000) / 100);
    return String(v);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
      <div className="px-6 py-4">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <PencilLine size={14} /> Campos manuais da planilha
        </h3>
        <p className="text-[11px] text-slate-400 mt-1">
          O preço HH é lembrado por treinamento e pré-preenche as turmas; sobrescreva na turma quando precisar.
          Nada é gravado até clicar em <strong>Salvar</strong>.
        </p>
      </div>

      {/* ───────── Por treinamento ───────── */}
      <SectionHeader
        aberto={abertoTreino}
        onToggle={() => setAbertoTreino(a => !a)}
        titulo="Por treinamento"
        resumo={`${totalTreinos} treinamentos, ${treinosComPreco} com preço`}
      />
      {abertoTreino && precoCol && (
        <div key={`treino-${resetKey}`} className="px-6 pb-4 space-y-3 bg-slate-50/60">
          <div className="flex flex-col md:flex-row md:items-center gap-3 pt-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input type="text" value={buscaTreino} onChange={e => setBuscaTreino(e.target.value)} placeholder="Buscar treinamento" className={searchClass} />
            </div>
            <Toggle checked={todosTreinos} onChange={setTodosTreinos} label="mostrar todos os treinamentos Vale" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {treinamentos.map(t => {
              const split = precoCol.hybridKeys ? splitDe(t.tid) : undefined;
              if (split) {
                // Híbrida: dois preços, com as horas de cada parte ao lado.
                const st = hybridPriceStatus(precoCol, { trainingId: t.tid, demandId: '' }, values);
                const partes: { parte: HybridPart; rotulo: string; atual: typeof st.presencial }[] = [
                  { parte: 'PRESENCIAL', rotulo: 'Preço HH presencial', atual: st.presencial },
                  { parte: 'ONLINE', rotulo: 'Preço HH online', atual: st.online },
                ];
                return (
                  <div key={t.tid} className="text-xs bg-white rounded-xl border border-slate-200 p-3" data-hibrida={t.tid}>
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-slate-600 truncate flex-1" title={t.nome}>{t.nome}</span>
                      <span className="text-[9px] font-bold text-violet-600 uppercase">híbrido</span>
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${SELO_HIBRIDA_CLASS[st.selo]}`}>{st.selo}</span>
                    </span>
                    {partes.map(p => (
                      <label key={p.parte} className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {p.rotulo} <span className="text-slate-300">· {horasDaParte(split, p.parte)}</span>
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputClass}
                          defaultValue={show(precoCol, p.atual.fonte === 'treinamento' ? p.atual.value : null)}
                          placeholder="R$"
                          onBlur={e => onEdit({ scope: 'training', refId: t.tid, columnKey: manualColumnKey(precoCol, p.parte), value: parse(precoCol, e.target.value) })}
                        />
                      </label>
                    ))}
                    {st.precoUnicoAntigo !== null && (
                      <p className="mt-2 text-[10px] text-amber-700 leading-snug">
                        Preço único anterior: R$ {show(precoCol, st.precoUnicoAntigo)} — não vale para híbrida; informe o presencial e o online.
                      </p>
                    )}
                  </div>
                );
              }
              const atual = resolveManualValue(precoCol, { trainingId: t.tid, demandId: '' }, values);
              return (
                <label key={t.tid} className="text-xs bg-white rounded-xl border border-slate-200 p-3">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-slate-600 truncate flex-1" title={t.nome}>{t.nome}</span>
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${t.comPreco ? FONTE_CLASS.treinamento : FONTE_CLASS.vazio}`}>
                      {t.comPreco ? 'com preço' : 'sem preço'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{precoCol.header}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputClass}
                      defaultValue={show(precoCol, atual.fonte === 'treinamento' ? atual.value : null)}
                      placeholder="R$"
                      onBlur={e => onEdit({ scope: 'training', refId: t.tid, columnKey: precoCol.key, value: parse(precoCol, e.target.value) })}
                    />
                  </span>
                </label>
              );
            })}
            {treinamentos.length === 0 && <p className="text-xs text-slate-300 font-bold py-4">Nenhum treinamento.</p>}
          </div>
        </div>
      )}

      {/* ───────── Por turma ───────── */}
      <SectionHeader
        aberto={abertoTurma}
        onToggle={() => setAbertoTurma(a => !a)}
        titulo="Por turma"
        resumo={`${rows.length} turmas, ${turmasComExcecao} com exceção`}
      />
      {abertoTurma && (
        <div key={`turma-${resetKey}`} className="bg-slate-50/60">
          <div className="px-6 pt-3 pb-2 flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input type="text" value={buscaTurma} onChange={e => setBuscaTurma(e.target.value)} placeholder="Buscar por DEM-, ID SAP, treinamento ou instrutor" className={searchClass} />
            </div>
            <Toggle checked={soPendentes} onChange={setSoPendentes} label="só turmas com pendência ou exceção" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-500">
                  <th className="p-3 font-black uppercase text-[10px]">Turma</th>
                  <th className="p-3 font-black uppercase text-[10px]">Treinamento</th>
                  <th className="p-3 font-black uppercase text-[10px]">Data</th>
                  {porDemanda.map(col => (
                    <th key={col.key} className="p-3 font-black uppercase text-[10px] whitespace-nowrap">{col.header}</th>
                  ))}
                  <th className="p-3 font-black uppercase text-[10px]">Fonte do preço</th>
                </tr>
              </thead>
              <tbody>
                {pag.paginatedItems.map(r => {
                  const partes = partesDe(r);
                  const hibrida = partes.length === 2;
                  return (
                    <tr key={r.demand.id} className="border-t border-slate-100 bg-white" data-turma={r.demand.id}>
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-black font-mono text-blue-600">{r.demand.id}</span>
                        <span className="block text-[10px] text-slate-400 font-mono">{r.input.clientDemandId || 'sem ID SAP'}</span>
                      </td>
                      <td className="p-3 max-w-[220px] truncate" title={r.input.trainingName}>
                        {r.input.trainingName}
                        {hibrida && <span className="block text-[9px] font-bold text-violet-600 uppercase">híbrido · duas linhas</span>}
                      </td>
                      <td className="p-3 whitespace-nowrap">{toBrDate(r.input.dataInicio)}</td>
                      {porDemanda.map(col => {
                        // Coluna com chave por parte numa híbrida: um campo por parte (presencial / online).
                        const colPartes = col.hybridKeys && hibrida ? partes : [undefined];
                        return (
                          <td key={col.key} className="p-2 min-w-[120px] space-y-1">
                            {colPartes.map(parte => {
                              const atual = resolveManualValue(col, { ...r.refs, parte }, values);
                              const proprio = atual.fonte === 'demanda' ? atual.value : null;
                              return (
                                <span key={parte ?? 'unica'} className="flex items-center gap-1">
                                  {parte && <span className="text-[9px] text-slate-400 w-14 shrink-0">{parte === 'PRESENCIAL' ? 'presencial' : 'online'}</span>}
                                  <input
                                    type="text"
                                    inputMode={col.format === 'text' ? 'text' : 'decimal'}
                                    className={inputClass}
                                    defaultValue={show(col, proprio)}
                                    placeholder={col.format === 'text' ? '' : show(col, atual.value) || '—'}
                                    onBlur={e => onEdit({ scope: 'demand', refId: r.demand.id, columnKey: manualColumnKey(col, parte), value: parse(col, e.target.value) })}
                                  />
                                </span>
                              );
                            })}
                          </td>
                        );
                      })}
                      <td className="p-3 whitespace-nowrap space-y-1">
                        {precoCol && partes.map(parte => {
                          const preco = resolveManualValue(precoCol, { ...r.refs, parte }, values);
                          return (
                            <span key={parte ?? 'unica'} className="flex items-center gap-1">
                              {parte && <span className="text-[9px] text-slate-400 w-14 shrink-0">{parte === 'PRESENCIAL' ? 'presencial' : 'online'}</span>}
                              <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${FONTE_CLASS[preco.fonte]}`}>{FONTE_LABEL[preco.fonte]}</span>
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  );
                })}
                {turmas.length === 0 && (
                  <tr><td colSpan={4 + porDemanda.length} className="p-8 text-center text-slate-300 font-bold bg-white">
                    {rows.length === 0 ? 'Nenhuma turma no recorte.' : 'Nenhuma turma com pendência ou exceção — desligue o filtro para ver todas.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {turmas.length > PAGE && (
            <Pagination
              currentPage={pag.currentPage}
              totalPages={pag.totalPages}
              totalItems={turmas.length}
              itemsPerPage={pag.itemsPerPage}
              startIdx={pag.startIdx}
              entityLabel="turmas"
              onPageChange={pag.setCurrentPage}
              onItemsPerPageChange={pag.handleItemsPerPageChange}
              hideSizeSelector
            />
          )}
        </div>
      )}

      {/* ───────── barra fixa: alterações não salvas ───────── */}
      {pendentes > 0 && (
        <div className="sticky bottom-0 z-10 bg-amber-50 border-t border-amber-200 px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-xs font-bold text-amber-900">
            {pendentes} {pendentes === 1 ? 'alteração não salva' : 'alterações não salvas'} — o download fica travado até salvar ou descartar.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDescartar}
              disabled={salvando}
              className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-amber-100 flex items-center gap-1.5 disabled:opacity-40"
            >
              <Undo2 size={14} /> Descartar
            </button>
            <button
              type="button"
              onClick={onSalvar}
              disabled={salvando}
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-40"
            >
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GradeEditavel;
