/**
 * MEDIÇÃO POR TEMPLATE (Vale) — o ramo da aba Exportações para datasets de
 * template: filtros → painel de pendências → campos manuais (Salvar) →
 * prévia da planilha → download no layout do cliente.
 *
 * Regras da tela:
 *   • nada é gravado no download; as edições vão ao banco só no Salvar;
 *   • o download fica desabilitado enquanto houver edição não salva
 *     ("salve antes de gerar");
 *   • falha de banco (carga ou salvar) e falha no arquivo-base viram banner
 *     e bloqueiam a geração.
 */
import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Info } from 'lucide-react';

import type { TemplateDatasetDef } from '../../domain/exports/registry';
import type { ExportSourceData } from '../../services/exports/loadExportData';
import { applyFilters, buildFilterOptions } from '../../domain/exports/filters';
import { EMPTY_FILTERS, type ExportFilters } from '../../domain/exports/types';
import type { ExportOptions } from '../../domain/exports/options';
import { buildMedicaoValeRows, toRowsSheetInput } from '../../domain/exports/datasets/medicaoVale';
import { buildPendencias } from '../../domain/exports/pendencias';
import { resolveTemplate, resolveRowsSheet } from '../../domain/exports/templates/resolve';
import {
  indexTemplateValues,
  emptyTemplateValuesIndex,
  TEMPLATE_VALUE_SCOPES,
  type TemplateValuesIndex,
} from '../../domain/exports/templates/values';
import { buildTrainingsById } from '../../domain/modalityOptions';
import { saveTemplateValues, type TemplateValueRow } from '../../services/exports/templateValues';
import { downloadTemplateXlsx } from '../../services/exports/templateXlsxWriter';
import { buildExportFileName } from '../../services/exports/csvWriter';

import FiltrosExportacao from './FiltrosExportacao';
import PainelPendencias from './PainelPendencias';
import GradeEditavel, { type EdicaoPendente } from './GradeEditavel';
import ExportBanner from './ExportBanner';
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

const MedicaoTemplateView: React.FC<{
  dataset: TemplateDatasetDef;
  carga: ExportSourceData;
  options: ExportOptions;
  onOptionsChange: (o: ExportOptions) => void;
  corredoresBase: string[];
  regionNameById: Map<string, string>;
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void;
}> = ({ dataset, carga, options, onOptionsChange, corredoresBase, onNotify }) => {
  const template = dataset.template;
  const sheetTurmas = template.sheets.find(s => s.kind === 'rows')!;

  const [filters, setFilters] = useState<ExportFilters>(EMPTY_FILTERS);
  const [valoresSalvos, setValoresSalvos] = useState<TemplateValueRow[]>(carga.templateValues);
  const [pendentes, setPendentes] = useState<Map<string, EdicaoPendente>>(new Map());
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Remonta os inputs (não controlados) da grade após salvar/descartar/recarregar. */
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
    () => buildMedicaoValeRows({ ...carga, template, templateValues: values, options }),
    [carga, template, values, options]
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
  const pendencias = useMemo(
    () =>
      buildPendencias(filtered, {
        sheet: sheetTurmas,
        templateValues: values,
        logisticAllocations: carga.logisticAllocations,
        logisticBlocks: carga.logisticBlocks,
      }),
    [filtered, sheetTurmas, values, carga]
  );
  const previa = useMemo(() => resolveRowsSheet(sheetTurmas, toRowsSheetInput(elegiveis), values), [sheetTurmas, elegiveis, values]);

  const temPendente = pendentes.size > 0;
  const podeGerar = elegiveis.length > 0 && !temPendente && !salvando && !gerando && !erro;

  const registrarEdicao = (e: EdicaoPendente) => {
    // Sem mudança em relação ao salvo: não vira pendente.
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
      const gravados = await saveTemplateValues(template.id, [...pendentes.values()]);
      setValoresSalvos(prev => {
        const porChave = new Map(prev.map(r => [`${r.scope}:${r.training_id ?? r.demand_id}:${r.column_key}`, r]));
        for (const g of gravados) porChave.set(`${g.scope}:${g.training_id ?? g.demand_id}:${g.column_key}`, g);
        return [...porChave.values()];
      });
      setPendentes(new Map());
      setResetKey(k => k + 1);
      onNotify(`${gravados.length} valor(es) salvos.`, 'success');
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

  const demandasComPendencia = useMemo(() => new Set(pendencias.map(p => p.demand.id)), [pendencias]);
  const semPeriodo = !filters.dataInicio && !filters.dataFim;

  const gerar = async () => {
    if (!podeGerar) return;
    setGerando(true);
    setErro(null);
    try {
      const sheets = resolveTemplate(template, toRowsSheetInput(elegiveis), values);
      const nome = buildExportFileName(template.fileNameBase, 'xlsx');
      await downloadTemplateXlsx(template, sheets, nome);
      onNotify(`${nome} gerado com ${elegiveis.length} turma(s).`, 'success');
    } catch (e: any) {
      setErro(`Falha ao gerar a planilha: ${e?.message || e}`);
    } finally {
      setGerando(false);
    }
  };

  // Prévia: colunas do template; fórmulas mostradas como o Excel vai calcular.
  const previaValor = (cell: { value?: unknown; formula?: string }, rowIdx: number, colIdx: number): string => {
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
        <div className="flex items-center gap-6">
          <div>
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Turmas na planilha</span>
            <span className="text-xl font-black">{elegiveis.length}</span>
            <span className="text-xs text-slate-400"> de {filtered.length} no recorte</span>
          </div>
          <div>
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Edições não salvas</span>
            <span className={`text-xl font-black ${temPendente ? 'text-amber-300' : ''}`}>{pendentes.size}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={gerar}
            disabled={!podeGerar}
            title={temPendente ? 'Salve antes de gerar' : undefined}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {gerando ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Gerar {template.label}
          </button>
        </div>
      </div>
      {temPendente && <ExportBanner tipo="aviso">Há edições não salvas. <strong>Salve antes de gerar</strong> — o download nunca grava.</ExportBanner>}

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
    </div>
  );
};

export default MedicaoTemplateView;
