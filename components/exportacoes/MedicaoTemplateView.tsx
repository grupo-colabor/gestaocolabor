/**
 * MEDIÇÃO POR TEMPLATE (Vale) — o ramo da aba Exportações para datasets de
 * template. Dois modos, com a MESMA seleção de turmas:
 *
 *   • aba de linhas (Medição Vale, vale-v1): filtros → painel de pendências
 *     → campos manuais (Salvar) → prévia da planilha → download;
 *   • folha form (BM Vale, vale-bm-v1): filtros (corredor opcional: "Todos"
 *     agrupa por corredor) → painel → cabeçalho por (corredor, mina) (Salvar)
 *     → prévia por mina → gerar .xlsx (quando fecha em UMA mina) ou .zip
 *     (um .xlsx por mina; com "Todos", uma pasta por corredor).
 *
 * Regras da tela:
 *   • nada é gravado no download; as edições vão ao banco só no Salvar, cada
 *     uma no template dono (preços/campos por turma no vale-v1; cabeçalho no
 *     vale-bm-v1);
 *   • o download fica desabilitado enquanto houver edição não salva;
 *   • BM com cabeçalho incompleto pede confirmação ("gerar mesmo assim?");
 *   • turma sem local fica fora do BM, em destaque na barra e no painel —
 *     nunca silencioso; com "Todos", turma sem corredor idem;
 *   • turma que COMEÇOU antes do início do período e termina dentro dele é
 *     avisada na barra e no painel. Não bloqueia nada: é o efeito esperado da
 *     seleção pela data de término, e o aviso existe para quem compara com a
 *     medição do mês passado saber por que a turma está aqui;
 *   • falha de banco (carga ou salvar) e falha no arquivo-base viram banner e
 *     bloqueiam a geração.
 */
import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Info, FolderArchive, AlertTriangle } from 'lucide-react';

import type { TemplateDatasetDef } from '../../domain/exports/registry';
import type { ExportSourceData } from '../../services/exports/loadExportData';
import { applyFilters, buildFilterOptions } from '../../domain/exports/filters';
import { EMPTY_FILTERS, type ExportFilters } from '../../domain/exports/types';
import type { ExportOptions } from '../../domain/exports/options';
import {
  buildMedicaoValeRows,
  toRowsSheetInput,
  turmasComecaramAntes,
  avisoComecaramAntes,
  avisoTurmaComecouAntes,
} from '../../domain/exports/datasets/medicaoVale';
import {
  buildBm,
  bmRegionRows,
  bmFileName,
  bmZipName,
  bmZipEntryName,
  periodoLabel as bmPeriodoLabel,
} from '../../domain/exports/datasets/medicaoValeBm';
import { buildPendencias, mergePendencias, type Pendencia } from '../../domain/exports/pendencias';
import { resolveTemplate, resolveRowsSheet } from '../../domain/exports/templates/resolve';
import { VALE_TEMPLATE } from '../../domain/exports/templates/vale';
import {
  indexTemplateValues,
  emptyTemplateValuesIndex,
  planTemplateValueWrites,
  TEMPLATE_VALUE_SCOPES,
  type TemplateValuesIndex,
  type TemplateValueKey,
} from '../../domain/exports/templates/values';
import { buildTrainingsById } from '../../domain/modalityOptions';
import { persistTemplateValueWrites, type TemplateValueRow } from '../../services/exports/templateValues';
import {
  downloadTemplateXlsx,
  fetchTemplateBaseFile,
  buildTemplateXlsxBuffer,
} from '../../services/exports/templateXlsxWriter';
import { buildExportFileName } from '../../services/exports/csvWriter';
import { downloadZip } from '../../services/exports/zipWriter';
import { triggerDownload, XLSX_MIME } from '../../utils/download';

import FiltrosExportacao from './FiltrosExportacao';
import PainelPendencias from './PainelPendencias';
import GradeEditavel, { type EdicaoPendente } from './GradeEditavel';
import ExportBanner from './ExportBanner';
import { CabecalhoBm, PreviaBm } from './BmSecoes';
import { formatPreviewCell } from './formatCell';

const chaveEdicao = (e: EdicaoPendente) => `${e.scope}:${e.refId}:${e.columnKey}`;

/** Índice base + edições pendentes, sem mutar o base. */
function mergeIndex(base: TemplateValuesIndex, pendentes: Map<string, EdicaoPendente>): TemplateValuesIndex {
  const out = emptyTemplateValuesIndex();
  for (const scope of TEMPLATE_VALUE_SCOPES) {
    for (const [ref, cols] of base[scope]) out[scope].set(ref, new Map(cols));
  }
  for (const e of pendentes.values()) {
    const porRef = out[e.scope].get(e.refId) ?? new Map();
    porRef.set(e.columnKey, e.value);
    out[e.scope].set(e.refId, porRef);
  }
  return out;
}

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MedicaoTemplateView: React.FC<{
  dataset: TemplateDatasetDef;
  carga: ExportSourceData;
  options: ExportOptions;
  onOptionsChange: (o: ExportOptions) => void;
  corredoresBase: string[];
  regionNameById: Map<string, string>;
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void;
  /**
   * Leitor do arquivo-base quando ele mora no Storage (modelos por empresa,
   * migration 022). A Vale não usa: o dela é público e o caminho não muda.
   */
  baseFileLoader?: (bucket: string, path: string) => Promise<ArrayBuffer>;
}> = ({ dataset, carga, options, onOptionsChange, corredoresBase, onNotify, baseFileLoader }) => {
  const template = dataset.template;
  const isBm = template.sheets.some(s => s.kind === 'form');
  /** O template da aba de linhas — no BM, as turmas continuam vindo do vale-v1. */
  const turmasTemplate = isBm ? VALE_TEMPLATE : template;
  const sheetTurmas = turmasTemplate.sheets.find(s => s.kind === 'rows')!;

  const [filters, setFilters] = useState<ExportFilters>(EMPTY_FILTERS);
  const [valoresSalvos, setValoresSalvos] = useState<TemplateValueRow[]>(carga.templateValues);
  const [pendentes, setPendentes] = useState<Map<string, EdicaoPendente>>(new Map());
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dataEnvio, setDataEnvio] = useState<string>(hojeISO());
  /** Remonta os inputs (não controlados) após salvar/descartar/recarregar. */
  const [resetKey, setResetKey] = useState(0);

  // Nova carga = valores novos do banco e edições pendentes descartadas.
  React.useEffect(() => {
    setValoresSalvos(carga.templateValues);
    setPendentes(new Map());
    setResetKey(k => k + 1);
  }, [carga]);

  const baseIndex = useMemo(() => indexTemplateValues(valoresSalvos), [valoresSalvos]);
  const values = useMemo(() => mergeIndex(baseIndex, pendentes), [baseIndex, pendentes]);
  const trainingsById = useMemo(() => buildTrainingsById(carga.trainings), [carga.trainings]);
  const trainingNames = useMemo(() => new Map(carga.trainings.map(t => [String(t.id), t.name])), [carga.trainings]);

  const rows = useMemo(
    () => buildMedicaoValeRows({ ...carga, template: turmasTemplate, templateValues: values, options }),
    [carga, turmasTemplate, values, options]
  );
  const filtered = useMemo(
    () => applyFilters(rows, filters, dataset.filters, { trainingsById, options }),
    [rows, filters, dataset.filters, trainingsById, options]
  );
  const filterOptions = useMemo(
    () => buildFilterOptions(rows, carga.trainings, carga.companies, carga.instructors, corredoresBase),
    [rows, carga, corredoresBase]
  );
  const elegiveis = useMemo(() => filtered.filter(r => r.elegivelTurmas), [filtered]);
  /** Turmas herdadas do mês anterior: começaram antes do início e terminam aqui. */
  const comecaramAntes = useMemo(
    () => turmasComecaramAntes(filtered, filters.dataInicio || undefined),
    [filtered, filters.dataInicio]
  );

  /* ───────── BM ───────── */
  /** Corredor "Todos": um BM por (corredor, mina) do recorte; o zip ganha uma pasta por corredor. */
  const todosCorredores = isBm && !filters.corredor;
  const bm = useMemo(
    () => (isBm ? buildBm(filtered, values, template, { corredor: filters.corredor || undefined, mina: filters.site || undefined }) : null),
    [isBm, filtered, values, template, filters.corredor, filters.site]
  );
  /** Um .xlsx só quando o recorte fecha em UMA mina (corredor + mina); senão .zip. */
  const saiXlsx = !!bm && !!filters.site && bm.minas.length === 1;
  const periodoLabel = bmPeriodoLabel(filters.dataInicio, filters.dataFim);

  const pendencias = useMemo(() => {
    const base = buildPendencias(filtered, {
      sheet: sheetTurmas,
      // O template vai junto: é ele que dá o cabeçalho e a letra de cada
      // coluna aos textos. Para os de CÓDIGO (Vale) nada muda — ver
      // NOMES_HISTORICOS em domain/exports/pendencias.ts.
      template: turmasTemplate,
      templateValues: values,
      logisticAllocations: carga.logisticAllocations,
      logisticBlocks: carga.logisticBlocks,
    });
    const extras: { row: (typeof filtered)[number]; pendencia: Pendencia }[] = [];
    for (const r of comecaramAntes) extras.push({ row: r, pendencia: { tipo: 'aviso', texto: avisoTurmaComecouAntes(r) } });
    if (!bm) return extras.length > 0 ? mergePendencias(base, extras) : base;
    for (const r of bm.semLocal) extras.push({ row: r, pendencia: { tipo: 'aviso', texto: 'Sem local na demanda — fora do BM (corrija o local)' } });
    for (const r of bm.semCorredor) extras.push({ row: r, pendencia: { tipo: 'aviso', texto: 'Sem corredor na demanda — fora do BM (informe o corredor)' } });
    for (const m of bm.minas) {
      if (m.cabecalhoIncompleto.length === 0) continue;
      for (const r of m.turmas) extras.push({ row: r, pendencia: { tipo: 'aviso', texto: `Cabeçalho do BM incompleto para ${m.corredor} | ${m.mina}` } });
    }
    for (const d of bm.nomesDuplicados) {
      for (const r of filtered) {
        if (d.trainingIds.includes(r.trainingId)) extras.push({ row: r, pendencia: { tipo: 'aviso', texto: `Cadastro de treinamento duplicado (${d.trainingIds.length} ids com o mesmo nome) — o BM agrega pelo nome` } });
      }
    }
    return mergePendencias(base, extras);
  }, [filtered, sheetTurmas, values, carga, bm, comecaramAntes]);

  const previa = useMemo(() => (isBm ? null : resolveRowsSheet(sheetTurmas, toRowsSheetInput(elegiveis), values)), [isBm, sheetTurmas, elegiveis, values]);

  const temPendente = pendentes.size > 0;
  const podeGerar = !temPendente && !salvando && !gerando && !erro && (isBm ? !!bm && bm.minas.length > 0 : elegiveis.length > 0);

  const registrarEdicao = (e: EdicaoPendente) => {
    const salvo = baseIndex[e.scope].get(e.refId)?.get(e.columnKey);
    const igual = (salvo ?? null) === (e.value ?? null) || (salvo === undefined && (e.value === null || e.value === ''));
    setPendentes(prev => {
      const next = new Map(prev);
      if (igual) next.delete(chaveEdicao(e));
      else next.set(chaveEdicao(e), e);
      return next;
    });
  };

  const salvar = async () => {
    if (!temPendente) return;
    setSalvando(true);
    setErro(null);
    try {
      // Cada edição vai para o template dono: preços/campos por turma no
      // vale-v1; cabeçalho do BM no vale-bm-v1.
      const porTemplate = new Map<string, EdicaoPendente[]>();
      for (const e of pendentes.values()) {
        const id = e.templateId ?? turmasTemplate.id;
        porTemplate.set(id, [...(porTemplate.get(id) ?? []), e]);
      }
      // Campo esvaziado que tinha valor salvo vira DELETE da linha; campo que
      // nunca existiu e continua vazio não vai ao banco. A decisão é do
      // domínio (planTemplateValueWrites), sobre o que está salvo DESTE template.
      const gravados: TemplateValueRow[] = [];
      const apagados: { templateId: string; key: TemplateValueKey }[] = [];
      for (const [id, items] of porTemplate) {
        const salvosDoTemplate = indexTemplateValues(valoresSalvos.filter(r => r.template_id === id));
        const plan = planTemplateValueWrites(items, salvosDoTemplate);
        const r = await persistTemplateValueWrites(id, plan);
        gravados.push(...r.gravados);
        apagados.push(...r.apagados.map(key => ({ templateId: id, key })));
      }
      setValoresSalvos(prev => {
        const chave = (r: TemplateValueRow) => `${r.template_id}:${r.scope}:${r.training_id ?? r.demand_id ?? r.context_key}:${r.column_key}`;
        const porChave = new Map(prev.map(r => [chave(r), r]));
        for (const a of apagados) porChave.delete(`${a.templateId}:${a.key.scope}:${a.key.refId}:${a.key.columnKey}`);
        for (const g of gravados) porChave.set(chave(g), g);
        return [...porChave.values()];
      });
      setPendentes(new Map());
      setResetKey(k => k + 1);
      const partes = [
        gravados.length > 0 ? `${gravados.length} valor(es) salvos` : null,
        apagados.length > 0 ? `${apagados.length} valor(es) apagados` : null,
      ].filter(Boolean);
      onNotify(partes.length > 0 ? `${partes.join(', ')}.` : 'Nada a gravar.', 'success');
    } catch (e: any) {
      setErro(`Falha ao salvar: ${e?.message || e}`);
    } finally {
      setSalvando(false);
    }
  };

  const descartar = () => {
    setPendentes(new Map());
    setResetKey(k => k + 1);
  };

  const gerar = async () => {
    if (!podeGerar) return;
    setGerando(true);
    setErro(null);
    try {
      if (isBm && bm) {
        // Todas as minas incompletas de uma vez (com "Todos", de todos os corredores).
        const incompletas = bm.minas.filter(m => m.cabecalhoIncompleto.length > 0);
        if (incompletas.length > 0) {
          const lista = incompletas.map(m => `${m.corredor} | ${m.mina}`).join(', ');
          if (!window.confirm(`Cabeçalho incompleto para ${lista} — gerar mesmo assim?`)) return;
        }
        const base = await fetchTemplateBaseFile(template, baseFileLoader);
        const entries: { name: string; data: ArrayBuffer }[] = [];
        for (const m of bm.minas) {
          const sheets = resolveTemplate(template, [], values, {
            context: m.contexto,
            manual: { dataEnvio },
            periodoLabel,
            regionRows: bmRegionRows(m),
          });
          // Com "Todos": "<corredor>/<mesmo nome de arquivo de hoje>"; senão, na raiz.
          entries.push({ name: bmZipEntryName(template, m, filters.dataInicio, filters.dataFim, todosCorredores), data: await buildTemplateXlsxBuffer(template, sheets, base) });
        }
        if (saiXlsx) {
          const nome = bmFileName(template, bm.minas[0].corredor, bm.minas[0].mina, filters.dataInicio, filters.dataFim);
          triggerDownload(entries[0].data, nome, XLSX_MIME);
          onNotify(`${nome} gerado (${bm.minas[0].turmas.length} turma(s)).`, 'success');
        } else {
          const nome = bmZipName(template, filters.corredor, filters.dataInicio, filters.dataFim);
          await downloadZip(entries, nome);
          onNotify(`${nome} gerado com ${entries.length} BM(s)${todosCorredores ? ` em ${bm.corredores.length} pasta(s)` : ''}.`, 'success');
        }
        return;
      }
      const sheets = resolveTemplate(template, toRowsSheetInput(elegiveis), values);
      const nome = buildExportFileName(template.fileNameBase, 'xlsx');
      await downloadTemplateXlsx(template, sheets, nome, baseFileLoader);
      onNotify(`${nome} gerado com ${elegiveis.length} turma(s).`, 'success');
    } catch (e: any) {
      setErro(`Falha ao gerar: ${e?.message || e}`);
    } finally {
      setGerando(false);
    }
  };

  // Prévia da aba de linhas: fórmulas mostradas como o Excel vai calcular.
  const previaValor = (cell: { value?: unknown; formula?: string }, rowIdx: number, colIdx: number): string => {
    if (!previa) return '';
    if (cell.formula) {
      const r = previa.rows[rowIdx];
      const byKey = (k: string) => Number(r[previa.columns.findIndex(c => c.key === k)]?.value ?? 0) || 0;
      const key = previa.columns[colIdx].key;
      if (key === 'valorTotal') return formatPreviewCell(byKey('cargaHoraria') * byKey('precoHH'), 'currency');
      if (key === 'valorTotalDespesas') {
        const s = byKey('locacao') + byKey('combustivel') + byKey('alimentacao') + byKey('hospedagem') + byKey('outros');
        return formatPreviewCell(s + s * byKey('pctDespesa'), 'currency');
      }
      return `= ${cell.formula}`;
    }
    const c = previa.columns[colIdx];
    const v = cell.value as any;
    if (c.format === 'date') return v ? String(v).split('-').reverse().join('/') : '—';
    if (c.format === 'percent') return v == null ? '—' : `${Math.round(Number(v) * 10000) / 100}%`;
    if (c.format === 'currency') return formatPreviewCell(v ?? null, 'currency');
    return v == null || v === '' ? '—' : String(v);
  };

  const semPeriodo = !filters.dataInicio && !filters.dataFim;
  const demandasComPendencia = useMemo(() => new Set(pendencias.map(p => p.demand.id)), [pendencias]);
  const turmasNoBm = bm ? bm.minas.reduce((acc, m) => acc + m.turmas.length, 0) : 0;

  return (
    <div className="space-y-6">
      <FiltrosExportacao
        allowed={dataset.filters}
        value={filters}
        options={filterOptions}
        onChange={setFilters}
        allowedOptions={dataset.options}
        optionValues={options}
        onOptionsChange={onOptionsChange}
        locationAssociations={carga.locationAssociations}
        nota={
          <span className="flex items-start gap-2">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>{template.notes?.join(' ')}</span>
          </span>
        }
      />
      {semPeriodo && (
        <p className="text-[11px] text-slate-400 -mt-3 px-2">
          sem período: todas as turmas concluídas ({elegiveis.length})
        </p>
      )}
      {erro && <ExportBanner tipo="erro"><strong>Bloqueado.</strong> {erro}</ExportBanner>}

      <PainelPendencias pendencias={pendencias} totalNoRecorte={filtered.length} />

      {isBm && bm && (
        <>
          <CabecalhoBm template={template} bm={bm} values={values} resetKey={resetKey} onEdit={registrarEdicao} />
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 flex flex-col md:flex-row md:items-center gap-4">
            <label className="text-xs font-bold text-slate-600 flex items-center gap-2">
              Data de envio
              <input type="date" value={dataEnvio} onChange={e => setDataEnvio(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <span className="text-[11px] text-slate-400">Período impresso: {periodoLabel || '— (sem período nos filtros)'}</span>
          </div>
        </>
      )}

      <GradeEditavel
        rows={elegiveis}
        allRows={rows}
        columns={sheetTurmas.columns ?? []}
        values={values}
        onEdit={registrarEdicao}
        trainingNames={trainingNames}
        demandasComPendencia={demandasComPendencia}
        pendentes={pendentes.size}
        salvando={salvando}
        onSalvar={salvar}
        onDescartar={descartar}
        resetKey={resetKey}
      />

      <div className="bg-slate-900 text-white rounded-2xl px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{isBm ? 'Turmas no BM' : 'Turmas na planilha'}</span>
            <span className="text-xl font-black">{isBm ? turmasNoBm : elegiveis.length}</span>
            <span className="text-xs text-slate-400"> de {filtered.length} no recorte</span>
          </div>
          {isBm && bm && (
            <div>
              <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Minas</span>
              <span className="text-xl font-black">{bm.minas.length}</span>
              <span className="text-xs text-slate-400"> {saiXlsx ? '· 1 .xlsx' : todosCorredores ? `· .zip, ${bm.corredores.length} pasta(s) por corredor` : '· .zip'}</span>
            </div>
          )}
          <div>
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Edições não salvas</span>
            <span className={`text-xl font-black ${temPendente ? 'text-amber-300' : ''}`}>{pendentes.size}</span>
          </div>
          {isBm && bm && bm.semLocal.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-400 text-slate-900 rounded-xl px-3 py-2 text-xs font-black">
              <AlertTriangle size={16} />
              {bm.semLocal.length} turma(s) sem local ficaram fora do BM — corrija o local na demanda
            </div>
          )}
          {isBm && bm && bm.semCorredor.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-400 text-slate-900 rounded-xl px-3 py-2 text-xs font-black">
              <AlertTriangle size={16} />
              {bm.semCorredor.length} turma(s) sem corredor ficaram fora do BM — informe o corredor na demanda
            </div>
          )}
          {comecaramAntes.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-700 text-slate-100 rounded-xl px-3 py-2 text-xs font-bold">
              <Info size={16} className="shrink-0" />
              {avisoComecaramAntes(comecaramAntes.length, filters.dataInicio)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={gerar}
          disabled={!podeGerar}
          title={temPendente ? 'Salve antes de gerar' : undefined}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {gerando ? <Loader2 size={16} className="animate-spin" /> : isBm && !saiXlsx ? <FolderArchive size={16} /> : <FileSpreadsheet size={16} />}
          Gerar {template.label}{isBm ? (saiXlsx ? ' (.xlsx)' : ' (.zip)') : ''}
        </button>
      </div>
      {temPendente && <ExportBanner tipo="aviso">Há edições não salvas. <strong>Salve antes de gerar</strong> — o download nunca grava.</ExportBanner>}

      {isBm && bm && <PreviaBm bm={bm} periodoLabel={periodoLabel} />}

      {!isBm && previa && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Prévia — aba "{sheetTurmas.name}" ({elegiveis.length} linhas + totais)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-900 text-white">
                  {previa.columns.map(c => (
                    <th key={c.key} className="p-3 font-black uppercase tracking-wide text-[10px] whitespace-nowrap">{c.letter} · {c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previa.rows.slice(0, 200).map((cells, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    {cells.map((cell, j) => (
                      <td key={j} className={`p-3 whitespace-nowrap max-w-[260px] truncate ${cell.highlight ? 'bg-yellow-100' : ''} ${cell.formula ? 'text-slate-500 italic' : 'text-slate-700'}`}>
                        {previaValor(cell, i, j)}
                      </td>
                    ))}
                  </tr>
                ))}
                {previa.rows.length === 0 && (
                  <tr><td colSpan={previa.columns.length} className="p-10 text-center text-slate-300 font-bold">Nenhuma turma elegível com os filtros aplicados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {previa.rows.length > 200 && <p className="px-6 py-2 text-[11px] text-slate-400">Prévia limitada a 200 linhas; a planilha sai inteira.</p>}
        </div>
      )}
    </div>
  );
};

export default MedicaoTemplateView;
