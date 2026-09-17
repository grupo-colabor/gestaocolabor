/**
 * SMOKE — Modelos de exportação salvos (domain/exports/presets.ts, migration 021)
 *
 * Rodar com:  npm run smoke:exportacoes-modelos
 *
 *   [C] Config: buildPresetConfig descarta o período; applyPreset preserva o
 *       período da tela, aplica colunas na ordem, ignora coluna inexistente
 *       COM aviso, cai nos defaults quando nada existe, ignora filtro/opção
 *       desconhecidos ou com tipo errado com aviso, e não lança com lixo.
 *   [N] Nome: vazio, longo, duplicado sem diferenciar caixa, renomear a si.
 *   [A] Ações com gateway em memória: salvar, salvar como padrão desmarca o
 *       anterior antes do insert, renomear, excluir, definir/tirar padrão,
 *       regravar; nome duplicado é recusado ANTES do banco; dataset invisível
 *       não lista; padrão por módulo.
 *   [E] Guarda de fonte: domínio sem services/react/supabase; serviço lança em
 *       zero linhas e grava updated_at; a tela aplica pelo domínio e mostra
 *       avisos; a barra não fala com o banco.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import {
  applyPreset,
  buildPresetConfig,
  createMemoryPresetGateway,
  defaultPresetOf,
  definirPadrao,
  excluirModelo,
  normalizePresetName,
  presetsOf,
  renomearModelo,
  salvarModelo,
  atualizarModelo,
  validatePresetName,
  visiblePresets,
  PRESET_NAME_MAX,
  type ExportPreset,
} from '../domain/exports/presets';
import { MEDICOES_DATASET } from '../domain/exports/datasets/medicoes';
import { DEMANDAS_DATASET } from '../domain/exports/datasets/demandas';
import { defaultColumnKeys } from '../domain/exports/buildRows';
import { EMPTY_FILTERS } from '../domain/exports/types';
import { DEFAULT_OPTIONS } from '../domain/exports/options';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
async function lanca(f: () => Promise<unknown>): Promise<string> {
  try { await f(); return ''; } catch (e: any) { return String(e?.message ?? e); }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [C] Config: montar e aplicar
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[C] Config — período fora; aplicar com avisos, nunca em silêncio');
{
  const filtrosTela = { ...EMPTY_FILTERS, dataInicio: '2026-08-01', dataFim: '2026-08-31', uf: 'MG', papel: 'TITULAR' as const, statusMedicao: ['FATURADA'] };
  const opcoesTela = { ...DEFAULT_OPTIONS, usarValorHH: false };
  const cfg = buildPresetConfig(filtrosTela, opcoesTela, ['empresa', 'demandId', 'horasPagamento']);
  check('config v1 sem dataInicio/dataFim, com os demais filtros', cfg.v === 1 && !('dataInicio' in cfg.filters) && !('dataFim' in cfg.filters) && cfg.filters.uf === 'MG' && cfg.filters.papel === 'TITULAR');
  eq('config guarda opções e colunas na ordem', [cfg.options, cfg.columns], [{ usarValorHH: false, incluirCanceladas: false }, ['empresa', 'demandId', 'horasPagamento']]);
  cfg.columns.push('x'); (cfg.filters.statusMedicao as string[]).push('y');
  check('config não compartilha arrays com a tela', filtrosTela.statusMedicao.length === 1);

  const tela = { filters: { ...EMPTY_FILTERS, dataInicio: '2026-09-01', dataFim: '2026-09-30', uf: 'ES' }, options: { ...DEFAULT_OPTIONS } };
  const ok = applyPreset(MEDICOES_DATASET, buildPresetConfig(filtrosTela, opcoesTela, ['empresa', 'demandId', 'horasPagamento']), tela);
  eq('aplicar: período é o da TELA, não o do modelo', [ok.filters.dataInicio, ok.filters.dataFim], ['2026-09-01', '2026-09-30']);
  eq('aplicar: filtros do modelo substituem os da tela (uf MG, papel, statusMedicao)', [ok.filters.uf, ok.filters.papel, ok.filters.statusMedicao], ['MG', 'TITULAR', ['FATURADA']]);
  eq('aplicar: colunas na ordem gravada; opções do modelo', [ok.columns, ok.options.usarValorHH, ok.avisos], [['empresa', 'demandId', 'horasPagamento'], false, []]);

  const velho = { v: 1, filters: { uf: 'MG', dataInicio: '2025-01-01', filtroQueNaoExiste: 'x', statusMedicao: 'nao-e-array', tipo: 42 }, options: { usarValorHH: 'sim', opcaoVelha: true }, columns: ['demandId', 'colunaQueSumiu', 'empresa', 'demandId', 'outraSumida'] };
  const r = applyPreset(MEDICOES_DATASET, velho, tela);
  eq('coluna inexistente: aplica o que existe, sem repetir', r.columns, ['demandId', 'empresa']);
  check('coluna inexistente: AVISA nomeando as chaves', r.avisos.some(a => a.includes('colunaQueSumiu') && a.includes('outraSumida') && a.includes(MEDICOES_DATASET.label)));
  check('período gravado num modelo velho é ignorado com aviso; o da tela fica', r.filters.dataInicio === '2026-09-01' && r.avisos.some(a => /período/i.test(a)));
  check('filtro desconhecido ou com tipo errado: ignorado com aviso', r.filters.uf === 'MG' && r.filters.tipo === '' && JSON.stringify(r.filters.statusMedicao) === '[]' && r.avisos.some(a => a.includes('filtroQueNaoExiste') && a.includes('statusMedicao') && a.includes('tipo')));
  check('opção com tipo errado/desconhecida: default + aviso', r.options.usarValorHH === true && r.avisos.some(a => a.includes('usarValorHH') && a.includes('opcaoVelha')));

  const nada = applyPreset(MEDICOES_DATASET, { v: 1, filters: {}, options: {}, columns: ['x', 'y'] }, tela);
  eq('nenhuma coluna existe mais: colunas padrão + aviso', [nada.columns, nada.avisos.length], [defaultColumnKeys(MEDICOES_DATASET), 2]);
  for (const lixo of [null, undefined, 'texto', 7, [], { columns: 'demandId' }]) {
    const l = applyPreset(DEMANDAS_DATASET, lixo, tela);
    check(`config ilegível (${JSON.stringify(lixo)}) não lança: defaults + aviso`, l.columns.length > 0 && l.avisos.length > 0 && l.filters.dataInicio === '2026-09-01');
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [N] Nome
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[N] Nome do modelo');
{
  const outros = [{ id: 'p1', name: 'Mensal Vale' }, { id: 'p2', name: 'Só MG' }];
  eq('normaliza espaços', normalizePresetName('  Mensal   Vale  '), 'Mensal Vale');
  check('vazio recusado', validatePresetName('   ', outros) !== null);
  check('longo recusado', validatePresetName('x'.repeat(PRESET_NAME_MAX + 1), outros) !== null && validatePresetName('x'.repeat(PRESET_NAME_MAX), outros) === null);
  check('duplicado sem diferenciar caixa/espaços recusado', validatePresetName('mensal  vale', outros) !== null);
  check('renomear para o próprio nome (mesmo id) é aceito', validatePresetName('Mensal Vale', outros, 'p1') === null);
  check('nome novo aceito', validatePresetName('Trimestral', outros) === null);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [A] Ações com gateway em memória
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[A] Ações — salvar, padrão único, renomear, excluir, regravar');
(async () => {
  const cfg = (cols: string[]) => buildPresetConfig(EMPTY_FILTERS, DEFAULT_OPTIONS, cols);
  const gw = createMemoryPresetGateway([
    { id: 'p1', datasetId: 'medicoes', name: 'Padrão antigo', config: cfg(['demandId']), isDefault: true },
    { id: 'p2', datasetId: 'vale-bm', name: 'BM', config: cfg([]), isDefault: false },
  ]);
  let presets = await gw.list();
  eq('lista inicial', presets.map(p => `${p.datasetId}:${p.name}:${p.isDefault}`), ['medicoes:Padrão antigo:true', 'vale-bm:BM:false']);

  // salvar comum
  let r = await salvarModelo(gw, presets, { datasetId: 'medicoes', name: '  Mensal MG ', config: cfg(['empresa', 'demandId']), isDefault: false });
  presets = r.presets;
  eq('salvar: nome normalizado, entra na lista, não é padrão', [r.salvo.name, r.salvo.isDefault, presetsOf(presets, 'medicoes').map(p => p.name)], ['Mensal MG', false, ['Mensal MG', 'Padrão antigo']]);

  // duplicado recusado antes do banco
  const antes = gw.chamadas.length;
  const msg = await lanca(() => salvarModelo(gw, presets, { datasetId: 'medicoes', name: 'mensal mg', config: cfg([]), isDefault: false }));
  check('nome duplicado recusado ANTES de chamar o banco', /já existe/i.test(msg) && gw.chamadas.length === antes);

  // salvar como padrão desmarca o anterior ANTES do insert (o índice único parcial recusaria)
  const marca = gw.chamadas.length;
  r = await salvarModelo(gw, presets, { datasetId: 'medicoes', name: 'Novo padrão', config: cfg(['demandId']), isDefault: true });
  presets = r.presets;
  eq('salvar como padrão: o anterior é desmarcado antes do insert', gw.chamadas.slice(marca), ['update:p1:isDefault', 'insert:Novo padrão']);
  eq('um único padrão no módulo', presetsOf(presets, 'medicoes').filter(p => p.isDefault).map(p => p.name), ['Novo padrão']);
  eq('defaultPresetOf', defaultPresetOf(presets, 'medicoes')?.name, 'Novo padrão');
  check('o padrão de outro módulo não é tocado', presets.find(p => p.id === 'p2')?.isDefault === false);

  // definir padrão em outro e tirar
  presets = await definirPadrao(gw, presets, 'p1', true);
  eq('definir padrão troca (desmarca o atual, marca o pedido)', presetsOf(presets, 'medicoes').filter(p => p.isDefault).map(p => p.id), ['p1']);
  presets = await definirPadrao(gw, presets, 'p1', false);
  eq('tirar padrão deixa o módulo sem padrão', defaultPresetOf(presets, 'medicoes'), undefined);

  // renomear (validação) e regravar
  const dup = await lanca(() => renomearModelo(gw, presets, 'p1', 'Mensal MG'));
  check('renomear para nome já usado é recusado', /já existe/i.test(dup));
  presets = await renomearModelo(gw, presets, 'p1', 'Padrão antigo (v2)');
  eq('renomear grava e reflete na lista', presets.find(p => p.id === 'p1')?.name, 'Padrão antigo (v2)');
  presets = await atualizarModelo(gw, presets, 'p1', cfg(['empresa']));
  eq('regravar substitui o config', presets.find(p => p.id === 'p1')?.config.columns, ['empresa']);

  // excluir
  presets = await excluirModelo(gw, presets, 'p1');
  check('excluir some da lista e do gateway', !presets.some(p => p.id === 'p1') && !gw.rows.some(p => p.id === 'p1'));
  check('excluir inexistente lança (nunca finge)', /não encontrado/i.test(await lanca(() => excluirModelo(gw, presets, 'nope'))));
  check('update inexistente no gateway lança com a dica de RLS', /RLS/.test(await lanca(() => gw.update('nope', { name: 'x' }))));

  // visibilidade por requiredView
  const visiveis = visiblePresets(presets, new Set(['medicoes', 'demandas']));
  check('modelo de dataset que o perfil não vê (vale-bm) não lista', !visiveis.some(p => p.datasetId === 'vale-bm') && visiveis.length === presetsOf(presets, 'medicoes').length);

  // lista vazia = ok
  eq('gateway vazio: lista vazia, sem erro', await createMemoryPresetGateway().list(), []);

  /* ──────────────────────────────────────────────────────────────────────
   * [E] Guarda de fonte
   * ──────────────────────────────────────────────────────────────────── */
  console.log('\n[E] Guarda de fonte');
  {
    const dom = semComentarios(ler('domain/exports/presets.ts'));
    check('domínio não importa services/, react, supabase', !/from\s+['"][^'"]*\/services\//.test(dom) && !/from\s+['"]react/.test(dom) && !/supabase/i.test(dom));
    const svc = semComentarios(ler('services/exports/presets.ts'));
    check('serviço lê via fetchAllPaginated e lança em zero linhas no update e no delete',
      svc.includes('fetchAllPaginated<ExportPresetRow>') && (svc.match(/nenhuma linha afetada/g) ?? []).length === 2 && svc.includes("throw new Error('Modelo não gravado"));
    check('serviço grava updated_at no update (sem trigger no banco)', svc.includes('updated_at: new Date().toISOString()'));
    check('serviço não manda user_id no insert (DEFAULT auth.uid() + WITH CHECK)', !/user_id:/.test(svc.split('insert(')[1] ?? ''));
    const tela = semComentarios(ler('components/Exportacoes.tsx'));
    check('tela aplica pelo domínio e mostra os avisos', tela.includes('applyPreset(') && tela.includes('setAvisosModelo(') && tela.includes('visiblePresets('));
    check('tela: padrão aplicado ao abrir o módulo, só para dataset de tabela', tela.includes('defaultPresetOf(') && tela.includes('padraoAplicado'));
    check('tela: período do modelo nunca é gravado (buildPresetConfig) e o gateway é o do serviço', tela.includes('buildPresetConfig(') && tela.includes('supabasePresetGateway'));
    const barra = semComentarios(ler('components/exportacoes/ModelosBar.tsx'));
    check('barra não fala com o banco nem com services/', !/supabase|\/services\//.test(barra));
    const mig = ler('supabase/migrations/021_export_presets.sql');
    check('migration 021: RLS por dono nas quatro operações, unique parcial do padrão, default auth.uid()',
      (mig.match(/user_id = auth\.uid\(\)/g) ?? []).length >= 5 && mig.includes('WHERE is_default') && mig.includes('DEFAULT auth.uid()') && mig.includes('ON DELETE CASCADE'));
  }

  console.log(falhas === 0 ? '\n✅ SMOKE EXPORTACOES MODELOS: OK' : `\n❌ SMOKE EXPORTACOES MODELOS: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

export {};
