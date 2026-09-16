/**
 * ABA EXPORTAÇÕES (F1) — motor genérico de exportação para análise
 *
 * Fluxo: escolher o módulo → Carregar (busca nova no banco) → filtrar →
 * escolher e ordenar colunas → prévia → baixar XLSX ou CSV.
 *
 * Regras da casa que esta tela cumpre:
 *   • toda leitura via services paginados (fetchAllPaginated); qualquer falha
 *     vira banner de erro e BLOQUEIA a geração — nunca "0 linhas";
 *   • nada é recalculado aqui: as linhas vêm de domain/exports/datasets, que
 *     só chamam o domínio da medição;
 *   • acesso por dataset via registry (`requiredView`) — o mesmo gate de UI
 *     das telas. Ver o comentário em domain/exports/registry.ts.
 *
 * Os exports existentes (Excel de pagamento, Export Modal, DOCX) continuam
 * onde estavam. Esta aba é para análise, não substitui o pagamento.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, RefreshCw } from 'lucide-react';

import { canAccessView, useApp } from '../App';
import { useAuth } from '../contexts/AuthContext';
import { visibleDatasets, getDataset, isTemplateDataset, templateIdsOf, type ExportDatasetEntry } from '../domain/exports/registry';
import { EMPTY_FILTERS, type DatasetKey, type ExportFilters, type ExportTable } from '../domain/exports/types';
import { applyFilters, buildFilterOptions } from '../domain/exports/filters';
import { DEFAULT_OPTIONS, type ExportOptions } from '../domain/exports/options';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { buildMedicoesRows } from '../domain/exports/datasets/medicoes';
import { buildDemandasRows } from '../domain/exports/datasets/demandas';
import { buildTrainingsById } from '../domain/modalityOptions';
import { loadExportData, type ExportSourceData } from '../services/exports/loadExportData';
import { downloadXlsx } from '../services/exports/xlsxWriter';
import { downloadCsv, buildExportFileName } from '../services/exports/csvWriter';

import DatasetPicker from './exportacoes/DatasetPicker';
import MedicaoTemplateView from './exportacoes/MedicaoTemplateView';
import FiltrosExportacao from './exportacoes/FiltrosExportacao';
import ColunasSelector from './exportacoes/ColunasSelector';
import PreviaTabela from './exportacoes/PreviaTabela';
import ExportBanner from './exportacoes/ExportBanner';

/** Acima disto a prévia continua paginada, mas o aviso lembra que o arquivo vai ser grande. */
const AVISO_LINHAS = 20_000;

type Carga = { data: ExportSourceData; comLogistica: boolean; templateKey: string };

const Exportacoes: React.FC = () => {
  const { regions, operationalBases, setNotification } = useApp();
  const { profile } = useAuth();
  const role = profile?.role;

  const datasets = useMemo(
    () => visibleDatasets(view => !!canAccessView(role, view as any)),
    [role]
  );

  const [datasetKey, setDatasetKey] = useState<DatasetKey | null>(null);
  useEffect(() => {
    if (!datasetKey && datasets.length > 0) setDatasetKey(datasets[0].key);
  }, [datasets, datasetKey]);
  const dataset: ExportDatasetEntry | null = datasetKey ? getDataset(datasetKey) : null;
  const templateDataset = dataset && isTemplateDataset(dataset) ? dataset : null;

  const [carga, setCarga] = useState<Carga | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState<'xlsx' | 'csv' | null>(null);
  const [filters, setFilters] = useState<ExportFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  // Colunas por dataset: nascem no default aprovado; a seleção sobrevive à
  // troca de módulo dentro da sessão.
  const selectedKeys = dataset && !isTemplateDataset(dataset) ? (selected[dataset.key] ?? defaultColumnKeys(dataset)) : [];
  const setSelectedKeys = (keys: string[]) => dataset && setSelected(prev => ({ ...prev, [dataset.key]: keys }));

  const precisaLogistica = datasetKey === 'demandas' || !!templateDataset;
  const templateIds = templateDataset ? templateIdsOf(templateDataset) : [];
  const templateKey = [...templateIds].sort().join(',');
  const cargaServe =
    !!carga && (!precisaLogistica || carga.comLogistica) && (!templateKey || carga.templateKey === templateKey);

  const carregar = useCallback(async () => {
    if (!datasetKey) return;
    setCarregando(true);
    setErro(null);
    try {
      const comLogistica = datasetKey === 'demandas' || !!templateKey;
      const data = await loadExportData({ includeLogistics: comLogistica, templateIds });
      setCarga({ data, comLogistica, templateKey });
    } catch (e: any) {
      console.error('[Exportacoes] falha ao carregar', e);
      setCarga(null);
      setErro(e?.message || String(e));
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetKey, templateKey]);

  const regionNameById = useMemo(() => new Map(regions.map(r => [r.id, r.name])), [regions]);

  // Linhas do dataset (sem filtro): montadas uma vez por carga.
  const rows = useMemo(() => {
    if (!dataset || !cargaServe || !carga || isTemplateDataset(dataset)) return null;
    const src = { ...carga.data, regionNameById, options };
    if (dataset.key === 'medicoes') return buildMedicoesRows(src);
    return buildDemandasRows(src);
  }, [dataset, carga, cargaServe, regionNameById, options]);

  const trainingsById = useMemo(
    () => buildTrainingsById(carga?.data.trainings ?? []),
    [carga]
  );

  const filterOptions = useMemo(
    () => (rows && carga ? buildFilterOptions(rows, carga.data.trainings, carga.data.companies, carga.data.instructors) : null),
    [rows, carga]
  );

  const filteredRows = useMemo(
    () => (rows && dataset ? applyFilters(rows, filters, dataset.filters, { trainingsById, options }) : null),
    [rows, dataset, filters, trainingsById, options]
  );

  const table: ExportTable | null = useMemo(() => {
    if (!dataset || isTemplateDataset(dataset) || !filteredRows || selectedKeys.length === 0) return null;
    try {
      return buildTable(dataset, filteredRows, selectedKeys);
    } catch (e) {
      console.error('[Exportacoes] buildTable', e);
      return null;
    }
  }, [dataset, filteredRows, selectedKeys]);

  const podeBaixar = !!table && table.rows.length > 0 && !erro && !carregando && !gerando;

  const baixar = async (formato: 'xlsx' | 'csv') => {
    if (!table || !dataset || isTemplateDataset(dataset) || !podeBaixar) return;
    setGerando(formato);
    try {
      const nome = buildExportFileName(dataset.fileBase, formato);
      if (formato === 'xlsx') {
        await downloadXlsx(table, nome, { sheetName: dataset.label, title: `Exportação — ${dataset.label}` });
      } else {
        downloadCsv(table, nome);
      }
      setNotification({ message: `${nome} gerado com ${table.rows.length} linha(s).`, type: 'success' });
    } catch (e: any) {
      console.error('[Exportacoes] falha ao gerar', e);
      setErro(`Falha ao gerar o arquivo: ${e?.message || e}`);
    } finally {
      setGerando(null);
    }
  };

  if (datasets.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold text-red-600">Nenhum módulo disponível</h2>
        <p>Seu perfil não tem acesso a nenhum dos módulos exportáveis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Exportações</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Planilhas de análise por módulo — filtre, escolha as colunas e baixe
          </p>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={carregando || !datasetKey}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 shadow-md disabled:opacity-60"
        >
          {carregando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          <span>{carga ? 'Recarregar dados' : 'Carregar dados'}</span>
        </button>
      </div>

      {erro && (
        <ExportBanner tipo="erro">
          <strong>Falha ao ler o banco.</strong> Nada foi gerado — a exportação fica bloqueada até uma
          carga completa. Detalhe: <code className="text-xs">{erro}</code>
        </ExportBanner>
      )}

      {datasetKey && (
        <DatasetPicker datasets={datasets} value={datasetKey} onChange={k => { setDatasetKey(k); setErro(null); }} disabled={carregando} />
      )}

      {!carga && !erro && !carregando && (
        <ExportBanner tipo="aviso">
          Clique em <strong>Carregar dados</strong> para buscar o cadastro completo no banco. A busca é
          refeita a cada clique, para o arquivo não sair de um estado antigo da tela.
        </ExportBanner>
      )}

      {carga && !cargaServe && !carregando && (
        <ExportBanner tipo="aviso">
          Este módulo precisa de dados que a última carga não trouxe (logística, documentos ou os
          valores do template). Clique em <strong>Recarregar dados</strong>.
        </ExportBanner>
      )}

      {templateDataset && carga && cargaServe && (
        <MedicaoTemplateView
          dataset={templateDataset}
          carga={carga.data}
          options={options}
          onOptionsChange={setOptions}
          corredoresBase={operationalBases.corredores ?? []}
          regionNameById={regionNameById}
          onNotify={(message, type) => setNotification({ message, type })}
        />
      )}

      {dataset && !isTemplateDataset(dataset) && rows && (
        <>
          <FiltrosExportacao
            allowed={dataset.filters}
            value={filters}
            options={filterOptions}
            onChange={setFilters}
            allowedOptions={dataset.options}
            optionValues={options}
            onOptionsChange={setOptions}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-1">
              <ColunasSelector dataset={dataset} selected={selectedKeys} onChange={setSelectedKeys} />
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="bg-slate-900 text-white rounded-2xl px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-6">
                  <div>
                    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Linhas</span>
                    <span className="text-xl font-black">{(filteredRows?.length ?? 0).toLocaleString('pt-BR')}</span>
                    <span className="text-xs text-slate-400"> de {(rows.length).toLocaleString('pt-BR')}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Colunas</span>
                    <span className="text-xl font-black">{selectedKeys.length}</span>
                  </div>
                  <div className="hidden md:block">
                    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Dados lidos em</span>
                    <span className="text-xs font-bold">{carga!.data.loadedAt.toLocaleString('pt-BR')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => baixar('xlsx')}
                    disabled={!podeBaixar}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {gerando === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} XLSX
                  </button>
                  <button
                    type="button"
                    onClick={() => baixar('csv')}
                    disabled={!podeBaixar}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {gerando === 'csv' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} CSV
                  </button>
                </div>
              </div>

              {selectedKeys.length === 0 && (
                <ExportBanner tipo="aviso">Selecione ao menos uma coluna.</ExportBanner>
              )}
              {(filteredRows?.length ?? 0) > AVISO_LINHAS && (
                <ExportBanner tipo="aviso">
                  Mais de {AVISO_LINHAS.toLocaleString('pt-BR')} linhas. O arquivo sai inteiro, mas
                  considere um filtro de período.
                </ExportBanner>
              )}

              {table && <PreviaTabela table={table} />}

              {dataset.key === 'medicoes' && (
                <p className="text-[11px] text-slate-400 leading-relaxed flex items-start gap-2">
                  <Download size={12} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>Horas pagamento</strong> é a linha que o Excel de pagamento imprimiria para a
                    pessoa na demanda (rateio da alocação com o override da medição), sem recorte de mês.
                    Em branco significa que o Excel não geraria linha — demanda não concluída, acompanhante
                    sem horas informadas ou pessoa sem alocação. Ligue <em>Origem das horas</em> nas colunas
                    para ver o motivo, e <em>Horas informadas</em>/<em>Horas (painel)</em> para comparar com o
                    que está gravado e com o que o Painel de Medição mostra.
                  </span>
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Exportacoes;
