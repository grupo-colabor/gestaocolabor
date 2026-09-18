/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — a tela de gerenciamento
 *
 * Criar, editar, duplicar, ativar e desativar os modelos. É a única tela desta
 * funcionalidade que a operação abre no dia a dia; a aba Exportações consome o
 * resultado (um módulo "Medição <Empresa>" por modelo ativo).
 *
 * TRÊS COISAS QUE ESTA TELA NÃO FAZ, DE PROPÓSITO:
 *
 *   1. Não decide nada em silêncio. Modelo incompleto aparece na lista com o
 *      motivo escrito, do mesmo jeito que aparece desabilitado na aba.
 *   2. Não tem fallback para a troca de ativo. `ativarModelo` é UMA chamada, que
 *      vira a função `set_active_measurement_template` (migration 022) — uma
 *      transação. Duas chamadas deixariam a empresa sem módulo no meio.
 *   3. Não deixa trocar o arquivo-base em silêncio. Se os cabeçalhos mudarem, a
 *      tela BLOQUEIA e mostra o que mudou, coluna a coluna: com um arquivo de
 *      colunas diferentes o mapeamento continuaria "funcionando" e escreveria
 *      no lugar errado, sem reclamar de nada.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, FileWarning, Loader2, Pencil, Plus, Power, Trash2 } from 'lucide-react';

import {
  ativarModelo,
  criarModelo,
  desativarModelo,
  duplicarModelo,
  excluirModelo,
  listarModelos,
  modeloPrecisaConserto,
  salvarMapeamento,
  type LoadedTemplate,
} from '../../../domain/exports/templates/store';
import {
  buildBaseFingerprint,
  buildTemplateMapping,
  compareBaseFingerprint,
  parseBaseFingerprint,
  parseTemplateMapping,
  templateFromRecord,
  type MappingColumn,
  type TemplateMapping,
} from '../../../domain/exports/templates/mapping';
import { motivoIndisponivel } from '../../../domain/exports/registry';
import { supabaseTemplateStoreGateway } from '../../../services/exports/templates';
import { removeTemplateBaseFile, uploadTemplateBaseFile } from '../../../services/exports/templateStorage';
import { excluirTemplateComArquivo } from '../../../services/exports/templates';
import { planejarExclusao } from '../../../domain/exports/templates/store';
import { buildMedicaoValeRows, toRowsSheetInput } from '../../../domain/exports/datasets/medicaoVale';
import { emptyTemplateValuesIndex } from '../../../domain/exports/templates/values';
import { loadExportData, type ExportSourceData } from '../../../services/exports/loadExportData';
import ExportBanner from '../ExportBanner';
import ModeloUpload, { type PlanilhaConfirmada } from './ModeloUpload';
import ModeloMapeamento, { colunaConfigurada } from './ModeloMapeamento';
import ModeloConferencia from './ModeloConferencia';

type Tela =
  | { modo: 'lista' }
  | { modo: 'novo' }
  | { modo: 'novo-arquivo'; companyId: string; companyName: string; nome: string }
  | { modo: 'trocar-arquivo'; modelo: LoadedTemplate }
  | { modo: 'mapear'; modelo: LoadedTemplate; mapping: TemplateMapping; diff: string[] | null; arquivoNovo: File | null };

const gw = supabaseTemplateStoreGateway;

/**
 * O template como ele ficaria com o mapeamento que está na tela AGORA — é o que
 * a conferência precisa mostrar. Não é o que está gravado: a graça é ver o
 * efeito da configuração antes de salvar.
 */
function templateDePreview(t: Extract<Tela, { modo: 'mapear' }>) {
  return templateFromRecord({ ...t.modelo.record, mapping: buildTemplateMapping(t.mapping) }).template;
}

/** As turmas da EMPRESA do modelo, concluídas, na ordem em que sairiam. */
function turmasParaConferencia(t: Extract<Tela, { modo: 'mapear' }>, carga: ExportSourceData) {
  const template = templateDePreview(t);
  const rows = buildMedicaoValeRows({
    ...carga,
    template,
    templateValues: emptyTemplateValuesIndex(),
  });
  return toRowsSheetInput(rows.filter(r => r.elegivelTurmas));
}

/** A planilha confirmada vira um mapeamento em branco, pronto para configurar. */
function mapeamentoInicial(p: PlanilhaConfirmada, anterior?: TemplateMapping): TemplateMapping {
  const porCabecalho = new Map((anterior?.columns ?? []).map(c => [c.header, c]));
  const columns: MappingColumn[] = p.colunas.map(c => {
    // Trocando o arquivo-base, o que casa por CABEÇALHO mantém a configuração;
    // o resto volta a "não configurada", e a pessoa reconfere.
    const antiga = porCabecalho.get(c.header);
    return antiga ? { ...antiga, key: c.key, header: c.header } : { key: c.key, header: c.header, origem: 'branco' as const };
  });
  return buildTemplateMapping({
    v: 1,
    sheetName: p.sheetName,
    headerRow: p.headerRow,
    firstDataRow: p.firstDataRow,
    columns,
    constants: anterior?.constants ?? [],
    totals: (anterior?.totals ?? []).filter(k => columns.some(c => c.key === k)),
  });
}

const ModelosMedicao: React.FC<{
  companies: { id: string; name: string }[];
  onNotify: (msg: string, tipo: 'success' | 'error' | 'info') => void;
  /** Chamado quando a lista muda, para a aba recarregar os módulos. */
  onModelosMudaram: () => void;
}> = ({ companies, onNotify, onModelosMudaram }) => {
  const [modelos, setModelos] = useState<LoadedTemplate[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tela, setTela] = useState<Tela>({ modo: 'lista' });

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setModelos(await listarModelos(gw));
    } catch (e: any) {
      setErro(`Não foi possível ler os modelos: ${e?.message || e}`);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const comEmpresa = useCallback(
    (m: LoadedTemplate) => companies.find(c => c.id === m.record.companyId)?.name || m.record.companyName || '(empresa removida)',
    [companies]
  );

  const porEmpresa = useMemo(() => {
    const mapa = new Map<string, LoadedTemplate[]>();
    for (const m of modelos) {
      const nome = comEmpresa(m);
      mapa.set(nome, [...(mapa.get(nome) ?? []), m]);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [modelos, comEmpresa]);

  /* ───────── conferência com turmas reais (item 20) ───────── */
  /**
   * A carga das demandas é pesada, então ela acontece UMA vez, quando a tela de
   * mapeamento abre, e em segundo plano: o mapeamento não espera por ela. A
   * conferência aparece embaixo assim que os dados chegam.
   *
   * Falha aqui NÃO bloqueia salvar — a conferência é uma ajuda, e deixar de
   * salvar um mapeamento pronto porque a lista de turmas não carregou seria
   * punir a pessoa por um problema que não é dela.
   */
  const [carga, setCarga] = useState<ExportSourceData | null>(null);
  const [cargaErro, setCargaErro] = useState<string | null>(null);
  const [carregandoTurmas, setCarregandoTurmas] = useState(false);

  useEffect(() => {
    if (tela.modo !== 'mapear' || carga || carregandoTurmas) return;
    let vivo = true;
    setCarregandoTurmas(true);
    loadExportData({ includeLogistics: false })
      .then(d => { if (vivo) setCarga(d); })
      .catch(e => { if (vivo) setCargaErro(e?.message || String(e)); })
      .finally(() => { if (vivo) setCarregandoTurmas(false); });
    return () => { vivo = false; };
  }, [tela.modo, carga, carregandoTurmas]);

  /** Roda uma ação do domínio, cuidando de erro e de recarga, num lugar só. */
  const acao = async (fn: () => Promise<{ mensagem: string }>) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fn();
      await recarregar();
      onModelosMudaram();
      onNotify(r.mensagem, 'success');
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setOcupado(false);
    }
  };

  /* ───────────────────────── criar ───────────────────────── */

  const [novo, setNovo] = useState({ companyId: '', nome: '' });

  const criar = async () => {
    const empresa = companies.find(c => c.id === novo.companyId);
    if (!empresa) return;
    setOcupado(true);
    setErro(null);
    try {
      const atuais = modelos.map(m => m.record);
      await criarModelo(gw, atuais, { companyId: empresa.id, companyName: empresa.name, name: novo.nome });
      const lista = await listarModelos(gw);
      setModelos(lista);
      onModelosMudaram();
      setTela({ modo: 'novo-arquivo', companyId: empresa.id, companyName: empresa.name, nome: novo.nome.trim() });
      setNovo({ companyId: '', nome: '' });
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setOcupado(false);
    }
  };

  /* ───────── enviar o arquivo e abrir o mapeamento ───────── */

  const enviarArquivo = async (p: PlanilhaConfirmada, modelo: LoadedTemplate, anterior?: TemplateMapping) => {
    setOcupado(true);
    setErro(null);
    try {
      const up = await uploadTemplateBaseFile(modelo.record.companyId, modelo.record.id, p.arquivo, p.arquivo.name);
      const mapping = mapeamentoInicial(p, anterior);
      const fingerprint = buildBaseFingerprint(mapping, p.headers);

      // O arquivo vai para o banco agora; o MAPEAMENTO só no "Salvar" da tela
      // seguinte, para a pessoa poder desistir sem deixar meio configurado.
      await gw.update(modelo.record.id, {
        storageBucket: up.bucket,
        storagePath: up.path,
        baseFingerprint: fingerprint,
      });
      const lista = await listarModelos(gw);
      setModelos(lista);
      const atualizado = lista.find(m => m.record.id === modelo.record.id)!;
      setTela({ modo: 'mapear', modelo: atualizado, mapping, diff: null, arquivoNovo: null });
      onModelosMudaram();
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setOcupado(false);
    }
  };

  /** Trocar o arquivo-base de um modelo que já tem mapeamento. */
  const trocarArquivo = (p: PlanilhaConfirmada, modelo: LoadedTemplate) => {
    const { mapping: anterior } = parseTemplateMapping(modelo.record.mapping);
    const antes = parseBaseFingerprint(modelo.record.baseFingerprint);
    const agora = buildBaseFingerprint({ ...anterior, sheetName: p.sheetName, headerRow: p.headerRow }, p.headers);
    const diff = antes ? compareBaseFingerprint(antes, agora) : [];

    if (diff.length === 0) {
      void enviarArquivo(p, modelo, anterior);
      return;
    }
    // Mudou: abre o mapeamento BLOQUEADO, com o diff na tela.
    const mapping = mapeamentoInicial(p, anterior);
    setTela({ modo: 'mapear', modelo, mapping, diff, arquivoNovo: p.arquivo });
  };

  /* ───────── salvar o mapeamento ───────── */

  const salvar = async (t: Extract<Tela, { modo: 'mapear' }>) => {
    setOcupado(true);
    setErro(null);
    try {
      let modelo = t.modelo;
      // Arquivo trocado com diff: só agora ele sobe, depois da reconferência.
      if (t.arquivoNovo) {
        const up = await uploadTemplateBaseFile(
          modelo.record.companyId, modelo.record.id, t.arquivoNovo, t.arquivoNovo.name
        );
        await gw.update(modelo.record.id, {
          storageBucket: up.bucket,
          storagePath: up.path,
          baseFingerprint: buildBaseFingerprint(t.mapping, t.mapping.columns.map(c => c.header)),
        });
        modelo = { ...modelo, record: { ...modelo.record, storageBucket: up.bucket, storagePath: up.path } };
      }
      const atuais = (await listarModelos(gw)).map(m => m.record);
      const r = await salvarMapeamento(gw, atuais, modelo.record.id, { mapping: buildTemplateMapping(t.mapping) });
      await recarregar();
      onModelosMudaram();
      onNotify(r.mensagem, 'success');
      setTela({ modo: 'lista' });
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setOcupado(false);
    }
  };

  const remover = async (m: LoadedTemplate) => {
    if (!window.confirm(`Excluir o modelo "${m.record.name}" de ${comEmpresa(m)}? Isso não pode ser desfeito.`)) return;
    setOcupado(true);
    setErro(null);
    try {
      const atuais = modelos.map(x => x.record);
      const plano = planejarExclusao(m.record, atuais);
      await excluirTemplateComArquivo(
        m.record.id,
        { bucket: plano.storageBucket, path: plano.storagePath },
        removeTemplateBaseFile
      );
      await recarregar();
      onModelosMudaram();
      onNotify(`Modelo "${m.record.name}" excluído.`, 'success');
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setOcupado(false);
    }
  };

  /* ═══════════════════════ telas ═══════════════════════ */

  const Voltar: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 flex items-center gap-1.5"
    >
      <ArrowLeft size={14} /> Voltar para a lista
    </button>
  );

  const banner = erro ? (
    <ExportBanner tipo="erro">
      <strong>Não foi possível concluir.</strong> {erro}
    </ExportBanner>
  ) : null;

  /* ───── novo modelo: empresa + nome ───── */
  if (tela.modo === 'novo') {
    const empresa = companies.find(c => c.id === novo.companyId);
    return (
      <div className="space-y-4">
        <Voltar onClick={() => setTela({ modo: 'lista' })} />
        {banner}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-black text-slate-800">Novo modelo de medição</h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Um modelo por empresa. Ele descreve a planilha que aquele cliente exige na medição.
            </p>
          </div>
          <label className="block">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Empresa</span>
            <select
              value={novo.companyId}
              onChange={e => setNovo(v => ({ ...v, companyId: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">Escolha a empresa…</option>
              {[...companies].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {empresa && (
              <span className="block text-[11px] text-slate-500 mt-1">
                Na aba Exportações, este módulo vai se chamar <strong>Medição {empresa.name}</strong>.
              </span>
            )}
          </label>
          <label className="block">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Nome do modelo
            </span>
            <input
              value={novo.nome}
              onChange={e => setNovo(v => ({ ...v, nome: e.target.value }))}
              placeholder="Padrão 2027"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <span className="block text-[11px] text-slate-400 mt-1">
              Só para você se organizar nesta lista — não aparece na planilha nem para o cliente.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void criar()}
            disabled={!novo.companyId || !novo.nome.trim() || ocupado}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
          >
            {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar e enviar a planilha
          </button>
        </div>
      </div>
    );
  }

  /* ───── novo modelo: o arquivo ───── */
  if (tela.modo === 'novo-arquivo') {
    const modelo = modelos.find(m => m.record.companyId === tela.companyId && m.record.name === tela.nome);
    return (
      <div className="space-y-4">
        <Voltar onClick={() => setTela({ modo: 'lista' })} />
        {banner}
        {modelo ? (
          <ModeloUpload
            empresaLabel={tela.companyName}
            onConfirmar={p => void enviarArquivo(p, modelo)}
            onCancelar={() => setTela({ modo: 'lista' })}
          />
        ) : (
          <ExportBanner tipo="aviso">Modelo criado. Abra-o na lista para enviar a planilha.</ExportBanner>
        )}
      </div>
    );
  }

  /* ───── trocar a planilha-base de um modelo já configurado ───── */
  if (tela.modo === 'trocar-arquivo') {
    const m = tela.modelo;
    return (
      <div className="space-y-4">
        <Voltar onClick={() => setTela({ modo: 'lista' })} />
        {banner}
        <ModeloUpload
          empresaLabel={comEmpresa(m)}
          acaoLabel="Comparar com a planilha atual"
          onConfirmar={p => trocarArquivo(p, m)}
          onCancelar={() => setTela({ modo: 'lista' })}
          avisoExtra={
            <ExportBanner tipo="aviso">
              Este modelo já tem uma planilha-base. Se a nova tiver colunas diferentes, o app vai
              mostrar exatamente o que mudou e pedir que você reconfira antes de salvar.
            </ExportBanner>
          }
        />
      </div>
    );
  }

  /* ───── mapear ───── */
  if (tela.modo === 'mapear') {
    const t = tela;
    const faltam = t.mapping.columns.filter(c => !colunaConfigurada(c)).length;
    const bloqueiaPorDiff = (t.diff?.length ?? 0) > 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Voltar onClick={() => setTela({ modo: 'lista' })} />
          <button
            type="button"
            onClick={() => void salvar(t)}
            disabled={faltam > 0 || ocupado}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
            title={faltam > 0 ? `Faltam ${faltam} coluna(s)` : undefined}
          >
            {ocupado ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Salvar mapeamento
          </button>
        </div>
        {banner}
        <ModeloMapeamento
          mapping={t.mapping}
          onChange={mapping => setTela({ ...t, mapping })}
          topo={
            <>
              <div className="bg-white px-5 py-3 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-black text-slate-800">
                  {t.modelo.record.name} — {comEmpresa(t.modelo)}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Aba «{t.mapping.sheetName}», cabeçalho na linha {t.mapping.headerRow}, turmas a partir da
                  linha {t.mapping.firstDataRow}.
                </p>
              </div>
              {bloqueiaPorDiff && (
                <ExportBanner tipo="erro">
                  <strong>A planilha nova tem colunas diferentes da anterior.</strong> Confira cada item
                  abaixo e reconfigure as colunas afetadas — o mapeamento antigo escreveria no lugar
                  errado sem avisar.
                  <ul className="list-disc ml-4 mt-2 space-y-0.5">
                    {t.diff!.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    O que tinha o mesmo cabeçalho foi mantido; o resto voltou para “não configurada”.
                  </p>
                </ExportBanner>
              )}
            </>
          }
        />

        {/* ───── conferência com turmas reais ───── */}
        {carregandoTurmas && (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4 justify-center">
            <Loader2 size={16} className="animate-spin" /> Buscando as turmas do período para você conferir…
          </div>
        )}
        {cargaErro && (
          <ExportBanner tipo="aviso">
            Não deu para buscar as turmas para a conferência ({cargaErro}). Você ainda pode salvar o
            mapeamento; confira depois, na aba Exportações.
          </ExportBanner>
        )}
        {carga && (
          <ModeloConferencia
            template={templateDePreview(t)}
            linhas={turmasParaConferencia(t, carga)}
            values={emptyTemplateValuesIndex()}
          />
        )}
      </div>
    );
  }

  /* ───── lista ───── */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800">Modelos de medição por empresa</h2>
          <p className="text-[11px] text-slate-400">
            Cada empresa pode ter vários modelos, mas só um <strong>ativo</strong> — é o ativo que vira
            módulo na aba Exportações.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTela({ modo: 'novo' })}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-md"
        >
          <Plus size={16} /> Novo modelo
        </button>
      </div>

      {banner}

      {carregando ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
          <Loader2 size={18} className="animate-spin" /> Carregando modelos…
        </div>
      ) : modelos.length === 0 ? (
        <ExportBanner tipo="aviso">
          Nenhum modelo cadastrado ainda. Clique em <strong>Novo modelo</strong>, escolha a empresa e
          envie a planilha que ela usa na medição.
        </ExportBanner>
      ) : (
        <div className="space-y-5">
          {porEmpresa.map(([empresa, lista]) => (
            <div key={empresa} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">{empresa}</h3>
              </div>
              <ul className="divide-y divide-slate-100">
                {lista.map(m => {
                  const motivo = motivoIndisponivel(m.template);
                  return (
                    <li key={m.record.id} className="px-5 py-4 flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-[220px]">
                        <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          {m.record.name}
                          {m.record.isActive && (
                            <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">
                              ativo
                            </span>
                          )}
                        </p>
                        {motivo ? (
                          <p className="text-xs text-amber-700 flex items-start gap-1.5 mt-1">
                            <FileWarning size={13} className="mt-0.5 shrink-0" /> {motivo}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500 mt-1">
                            Pronto para gerar — aba «{m.record.sheetName}», {m.template.sheets[0]?.columns?.length ?? 0} colunas.
                          </p>
                        )}
                        {modeloPrecisaConserto(m) && m.avisos.length > 0 && (
                          <ul className="text-[11px] text-amber-700 list-disc ml-4 mt-1 space-y-0.5">
                            {m.avisos.slice(0, 3).map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => {
                            const { mapping } = parseTemplateMapping(m.record.mapping);
                            if (mapping.columns.length === 0) {
                              setTela({ modo: 'novo-arquivo', companyId: m.record.companyId, companyName: empresa, nome: m.record.name });
                              return;
                            }
                            setTela({ modo: 'mapear', modelo: m, mapping, diff: null, arquivoNovo: null });
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:border-slate-400 flex items-center gap-1.5 disabled:opacity-40"
                        >
                          <Pencil size={13} /> {m.record.storagePath ? 'Editar colunas' : 'Enviar planilha'}
                        </button>

                        {m.record.storagePath && (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => setTela({ modo: 'trocar-arquivo', modelo: m })}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:border-slate-400 flex items-center gap-1.5 disabled:opacity-40"
                            title="Enviar outra planilha-base para este modelo"
                          >
                            <FileWarning size={13} /> Trocar planilha
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void acao(() => duplicarModelo(gw, modelos.map(x => x.record), m.record.id))}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:border-slate-400 flex items-center gap-1.5 disabled:opacity-40"
                        >
                          <Copy size={13} /> Duplicar
                        </button>

                        {m.record.isActive ? (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => void acao(() => desativarModelo(gw, modelos.map(x => x.record), m.record.id))}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:border-slate-400 flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <Power size={13} /> Desativar
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={ocupado || !!motivo}
                            title={motivo ?? undefined}
                            onClick={() => void acao(() => ativarModelo(gw, modelos.map(x => x.record), m.record.id))}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <Power size={13} /> Usar este
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void remover(m)}
                          title="Excluir"
                          className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Trocar o modelo ativo de uma empresa não muda as medições já geradas — só o que for gerado daqui
        para a frente.
      </p>
    </div>
  );
};

export default ModelosMedicao;
