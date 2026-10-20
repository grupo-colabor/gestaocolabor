/**
 * SMOKE — Medição Vale (template de medição por empresa)
 *
 * Rodar com:  npm run smoke:medicao-vale
 *
 *   [T] Resolvedor: fórmulas por chave viram letras na ordem atual; reordenar
 *       coluna não quebra fórmula; totais cobrem exatamente a faixa de dados;
 *       valor manual: demanda > treinamento > padrão > vazio.
 *   [V] Template Vale: 20 colunas na ordem do arquivo, cabeçalhos exatos
 *       (com os espaços), K = I*J e R = SUM(L:P)+(SUM(L:P)*Q) nas letras que
 *       o modelo usa, totais em I, K..P, R.
 *   [D] Dataset: linhas por demanda Vale (entra no commit 4).
 *   [X] Escritor: XLSX gerado a partir das fixtures e do arquivo-base, lido de
 *       volta — fórmulas nas células certas, Plantas igual ao snapshot,
 *       manuais preservados (entra no commit 5).
 *   [P] Painel de pendências (entra no commit 6).
 *   [E] Guarda de fonte: domain/exports/templates/** sem services, react ou
 *       exceljs; vale.ts sem letra de coluna literal em fórmula.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import { VALE_TEMPLATE, VALE_TURMAS_COLUMNS } from '../domain/exports/templates/vale';
import {
  columnLetter,
  resolveColumns,
  resolveFormula,
  resolveManualValue,
  resolveRowsSheet,
  resolveTemplate,
} from '../domain/exports/templates/resolve';
import { indexTemplateValues, emptyTemplateValuesIndex } from '../domain/exports/templates/values';
import type { TemplateRowInput } from '../domain/exports/templates/sourceFields';
import type { TemplateSheet } from '../domain/exports/templates/types';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
const perto = (nome: string, atual: number, esperado: number) =>
  check(nome, Math.abs(atual - esperado) < 1e-6, `esperado ${esperado}, veio ${atual}`);

const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function listarTs(dir: string): string[] {
  const out: string[] = [];
  for (const nome of fs.readdirSync(path.join(raiz, dir))) {
    const rel = path.join(dir, nome).replace(/\\/g, '/');
    if (fs.statSync(path.join(raiz, rel)).isDirectory()) out.push(...listarTs(rel));
    else if (rel.endsWith('.ts')) out.push(rel);
  }
  return out;
}

export const tools = { check, eq, perto, ler, semComentarios };

/* ────────────────────────── fixtures de linha ────────────────────────── */
const linha = (over: Partial<TemplateRowInput> = {}): TemplateRowInput => ({
  demandId: 'DEM-100', clientDemandId: 'SAP-1', companyName: 'Vale', trainingId: 'T_PRE',
  trainingName: 'NR 35', cargaHoraria: 16, local: 'Itabira', corredor: 'Sudeste', uf: 'MG',
  dataInicio: '2026-08-10', dataFim: '2026-08-11', horarioInicio: '08:00', horarioFim: '17:00', nDias: 2, statusCalculado: 'CONCLUIDA',
  titulares: ['Titular'], despesas: { locomocao: 80, alimentacao: 50, hospedagem: 200, outros: 30, total: 360 },
  medicaoStatus: 'PRONTA_FATURAMENTO', temMedicao: true, ...over,
});
const refs = (demandId: string, trainingId = 'T_PRE') => ({ demandId, trainingId });
export const fixtures = { linha, refs };

/* ────────────────────────────────────────────────────────────────────────────
 * [E] Guarda de fonte
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[E] Guarda de fonte — templates sem I/O, Vale sem letra literal');
{
  for (const rel of listarTs('domain/exports/templates')) {
    const src = semComentarios(ler(rel));
    check(`${rel} não importa services/`, !/from\s+['"][^'"]*\/services\//.test(src));
    check(`${rel} não importa react`, !/from\s+['"]react(-dom)?['"]/.test(src));
    check(`${rel} não importa exceljs`, !/exceljs/.test(src));
    check(`${rel} não toca supabase`, !/supabase/i.test(src));
  }
  const vale = semComentarios(ler('domain/exports/templates/vale.ts'));
  const formulas = [...vale.matchAll(/formula:\s*\n?\s*'([^']+)'/g)].map(m => m[1]);
  check('vale.ts tem fórmulas', formulas.length >= 2);
  for (const f of formulas) {
    check(`fórmula sem letra literal: ${f.slice(0, 40)}…`, !/(^|[^{:a-zA-Z])[A-Z]{1,2}\d/.test(f) && !/[A-Z]{1,2}\{row\}/.test(f.replace(/\{col:[^}]+\}/g, '')));
    check('fórmula referencia só {col:…}', /\{col:/.test(f));
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [T] Resolvedor
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[T] Resolvedor de template');
{
  eq('letras: A, Z, AA, AB', [columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)], ['A', 'Z', 'AA', 'AB']);

  const sheet: TemplateSheet = {
    name: 'T', kind: 'rows', headerRow: 1, firstDataRow: 2,
    columns: [
      { key: 'seq', header: 'N', source: 'sequence' },
      { key: 'h', header: 'H', source: 'demand.cargaHoraria', format: 'hours' },
      { key: 'p', header: 'P', source: 'manual', persistScope: 'training', overrideScope: 'demand', format: 'currency', highlightWhenEmpty: true, editable: true },
      { key: 'v', header: 'V', source: 'formula', formula: '={col:h}{row}*{col:p}{row}', format: 'currency' },
      { key: 'pct', header: '%', source: 'manual', persistScope: 'demand', defaultValue: 0.2, format: 'percent', editable: true },
    ],
    totals: { sumColumns: ['h', 'v'] },
  };
  const cols = resolveColumns(sheet);
  eq('letras na ordem do template', cols.map(c => c.letter), ['A', 'B', 'C', 'D', 'E']);
  eq('fórmula por chave -> letras', resolveFormula('={col:h}{row}*{col:p}{row}', cols, { row: 7 }), 'B7*C7');
  eq('SUM com first/last', resolveFormula('SUM({col:v}{first}:{col:v}{last})', cols, { first: 2, last: 9 }), 'SUM(D2:D9)');
  let lancou = false;
  try { resolveFormula('={col:nada}{row}', cols, { row: 1 }); } catch { lancou = true; }
  check('chave desconhecida em fórmula é erro', lancou);
  lancou = false;
  try { resolveFormula('={col:h}{row}', cols, {}); } catch { lancou = true; }
  check('{row} sem contexto é erro', lancou);

  // Reordenar: a fórmula continua apontando para as colunas certas.
  const reordenada: TemplateSheet = { ...sheet, columns: [sheet.columns![2], sheet.columns![0], sheet.columns![1], sheet.columns![3], sheet.columns![4]] };
  const cols2 = resolveColumns(reordenada);
  eq('reordenar colunas muda as letras, não a fórmula', resolveFormula('={col:h}{row}*{col:p}{row}', cols2, { row: 3 }), 'C3*A3');

  const values = indexTemplateValues([
    { scope: 'training', column_key: 'p', training_id: 'T_PRE', demand_id: null, value: 100 },
    { scope: 'demand', column_key: 'p', training_id: null, demand_id: 'DEM-2', value: 150 },
    { scope: 'demand', column_key: 'pct', training_id: null, demand_id: 'DEM-2', value: 0.1 },
    { scope: 'demand', column_key: 'p', training_id: null, demand_id: 'DEM-4', value: '' },
  ]);
  const pCol = sheet.columns![2];
  const pctCol = sheet.columns![4];
  eq('manual: demanda vence treinamento', resolveManualValue(pCol, refs('DEM-2'), values), { value: 150, fonte: 'demanda' });
  eq('manual: treinamento quando a demanda não sobrescreve', resolveManualValue(pCol, refs('DEM-1'), values), { value: 100, fonte: 'treinamento' });
  eq('manual: sem nada e sem default -> vazio', resolveManualValue(pCol, refs('DEM-3', 'T_X'), values), { value: null, fonte: 'vazio' });
  eq('manual: sobrescrita gravada como "" NÃO vence (é vazio)', resolveManualValue(pCol, refs('DEM-4'), values), { value: 100, fonte: 'treinamento' });
  eq('manual: default quando ninguém digitou', resolveManualValue(pctCol, refs('DEM-1'), values), { value: 0.2, fonte: 'padrão' });
  eq('manual: por demanda digitado', resolveManualValue(pctCol, refs('DEM-2'), values), { value: 0.1, fonte: 'demanda' });

  const resolved = resolveRowsSheet(sheet, [
    { input: linha({ demandId: 'DEM-1' }), refs: refs('DEM-1') },
    { input: linha({ demandId: 'DEM-2' }), refs: refs('DEM-2') },
    { input: linha({ demandId: 'DEM-3', cargaHoraria: 8 }), refs: refs('DEM-3', 'T_X') },
  ], values);
  eq('sequência 1..n', resolved.rows.map(r => r[0].value), [1, 2, 3]);
  eq('campo do app', resolved.rows.map(r => r[1].value), [16, 16, 8]);
  eq('manual por linha', resolved.rows.map(r => r[2].value), [100, 150, null]);
  check('vazio editável destacado', resolved.rows[2][2].highlight === true && resolved.rows[0][2].highlight === false);
  eq('fórmula por linha', resolved.rows.map(r => r[3].formula), ['B2*C2', 'B3*C3', 'B4*C4']);
  eq('totais só nas colunas declaradas', resolved.totalsRow!.map(c => c?.formula ?? null), [null, 'SUM(B2:B4)', null, 'SUM(D2:D4)', null]);
  const vazio = resolveRowsSheet(sheet, [], emptyTemplateValuesIndex());
  eq('sem linhas: totais valem 0 em vez de SUM inválido', vazio.totalsRow!.map(c => c?.value ?? null), [null, 0, null, 0, null]);

  lancou = false;
  try { resolveColumns({ ...sheet, columns: [sheet.columns![0], sheet.columns![0]] }); } catch { lancou = true; }
  check('chave repetida é erro', lancou);

  // ── Híbrida dividida: parte da linha, chave por parte, zero na online, anexo por turma ──
  const hibSheet: TemplateSheet = {
    ...sheet,
    columns: [
      sheet.columns![0],
      sheet.columns![1],
      { ...sheet.columns![2], hybridKeys: { presencial: 'pPres', online: 'pOnl' } },
      sheet.columns![3],
      { key: 'desp', header: 'D', source: 'expenses.locomocao', format: 'currency', hybridOnline: 'zero' },
      { key: 'comb', header: 'C', source: 'manual', persistScope: 'demand', defaultValue: 0, format: 'currency', editable: true, hybridOnline: 'zero' },
    ],
  };
  const pHib = hibSheet.columns![2];
  const hibValues = indexTemplateValues([
    { scope: 'training', column_key: 'p', training_id: 'T_HIB', demand_id: null, value: 100 },       // preço único antigo
    { scope: 'training', column_key: 'pPres', training_id: 'T_HIB', demand_id: null, value: 290 },
    { scope: 'training', column_key: 'pOnl', training_id: 'T_HIB', demand_id: null, value: 200 },
    { scope: 'demand', column_key: 'pOnl', training_id: null, demand_id: 'DEM-H2', value: 180 },
    { scope: 'demand', column_key: 'comb', training_id: null, demand_id: 'DEM-H1', value: 45 },
  ]);
  const refsH = (demandId: string, parte?: any) => ({ demandId, trainingId: 'T_HIB', parte });
  eq('parte presencial lê a chave presencial do treinamento', resolveManualValue(pHib, refsH('DEM-H1', 'PRESENCIAL'), hibValues), { value: 290, fonte: 'treinamento' });
  eq('parte online lê a chave online', resolveManualValue(pHib, refsH('DEM-H1', 'ONLINE'), hibValues), { value: 200, fonte: 'treinamento' });
  eq('sobrescrita na turma vale por parte (online da DEM-H2)', resolveManualValue(pHib, refsH('DEM-H2', 'ONLINE'), hibValues), { value: 180, fonte: 'demanda' });
  eq('e não vaza para a outra parte', resolveManualValue(pHib, refsH('DEM-H2', 'PRESENCIAL'), hibValues), { value: 290, fonte: 'treinamento' });
  eq('sem parte, a coluna continua lendo a chave de sempre (preço único)', resolveManualValue(pHib, refsH('DEM-H1'), hibValues), { value: 100, fonte: 'treinamento' });
  eq('o preço único NUNCA é usado por uma parte', resolveManualValue(pHib, { demandId: 'DEM-H3', trainingId: 'T_SO_UNICO', parte: 'PRESENCIAL' }, indexTemplateValues([{ scope: 'training', column_key: 'p', training_id: 'T_SO_UNICO', demand_id: null, value: 100 }])), { value: null, fonte: 'vazio' });
  eq('combustível digitado sai na presencial e vale 0 na online', [resolveManualValue(hibSheet.columns![5], refsH('DEM-H1', 'PRESENCIAL'), hibValues).value, resolveManualValue(hibSheet.columns![5], refsH('DEM-H1', 'ONLINE'), hibValues).value], [45, 0]);

  const rH = resolveRowsSheet(hibSheet, [
    { input: linha({ demandId: 'DEM-H0' }), refs: refsH('DEM-H0') },
    { input: linha({ demandId: 'DEM-H1', cargaHoraria: 8 }), refs: refsH('DEM-H1', 'PRESENCIAL') },
    { input: linha({ demandId: 'DEM-H1', cargaHoraria: 32, despesas: { locomocao: 0, alimentacao: 0, hospedagem: 0, outros: 0, total: 0 } }), refs: refsH('DEM-H1', 'ONLINE') },
    { input: linha({ demandId: 'DEM-H2' }), refs: refsH('DEM-H2') },
  ], hibValues);
  eq('anexo por TURMA: as duas partes repetem o número e a seguinte não pula', rH.rows.map(r => r[0].value), [1, 2, 2, 3]);
  eq('carga por parte e fórmula por linha', rH.rows.map(r => `${r[1].value}:${r[3].formula}`), ['16:B2*C2', '8:B3*C3', '32:B4*C4', '16:B5*C5']);
  eq('preço por parte na célula', rH.rows.map(r => r[2].value), [100, 290, 200, 100]);
  eq('despesa do app: 80 na presencial, 0 na online', [rH.rows[1][4].value, rH.rows[2][4].value], [80, 0]);
  eq('totais somam as duas partes (8 + 32 entram na carga)', rH.totalsRow![1]!.formula, 'SUM(B2:B5)');
  eq('sem híbrida, a sequência continua 1..n', resolveRowsSheet(sheet, [
    { input: linha({ demandId: 'A' }), refs: refs('A') }, { input: linha({ demandId: 'B' }), refs: refs('B') },
  ], values).rows.map(r => r[0].value), [1, 2]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [V] Template Vale — o layout do arquivo
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[V] Template Vale');
{
  const turmas = VALE_TEMPLATE.sheets[0];
  const cols = resolveColumns(turmas);
  eq('20 colunas A..T', cols.map(c => c.letter).join(''), 'ABCDEFGHIJKLMNOPQRST');
  eq('cabeçalhos exatos do arquivo (com os espaços)', cols.map(c => c.header), [
    'Número do anexo', 'ID da Turma', 'Treinamento', 'Local Treinamento ', 'Data início', 'Data fim', 'Horário início', 'Horário fim', 'Carga horária',
    'Preço unitário HH', 'Valor total do treinamento', 'Despesa reembolsável (locação veículo/táxi)',
    'Despesa reembolsável (combustível)', 'Despesa reembolsável (alimentação)', 'Despesa reembolsável (hospedagem)',
    'Despesa reembolsável (outros)', '% despesa reembolsável', 'Valor total despesas', 'Consultor', 'Observação',
  ]);
  const r = resolveRowsSheet(turmas, [{ input: linha(), refs: refs('DEM-100') }, { input: linha({ demandId: 'DEM-101' }), refs: refs('DEM-101') }], emptyTemplateValuesIndex());
  eq('K = I*J na linha 2', r.rows[0][10].formula, 'I2*J2');
  eq('R = SUM(L:P)+(SUM(L:P)*Q) na linha 3', r.rows[1][17].formula, 'SUM(L3:P3)+(SUM(L3:P3)*Q3)');
  eq('totais em I, K..P, R (e não em J, Q, S, T)', r.totalsRow!.map((c, i) => (c ? cols[i].letter : null)).filter(Boolean), ['I', 'K', 'L', 'M', 'N', 'O', 'P', 'R']);
  eq('total de K cobre a faixa real (corrigido do modelo)', r.totalsRow![10]!.formula, 'SUM(K2:K3)');
  eq('Q = 0,2 por padrão', r.rows[0][16].value, 0.2);
  eq('M (combustível) nasce 0', r.rows[0][12].value, 0);
  eq('B sem ID SAP fica destacada', resolveRowsSheet(turmas, [{ input: linha({ clientDemandId: '' }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).rows[0][1].highlight, true);
  eq('J sem preço fica destacada', r.rows[0][9].highlight, true);
  eq('E/F = data início e data fim; G/H = horários', r.rows[0].slice(4, 8).map(c => c.value), ['2026-08-10', '2026-08-11', '08:00', '17:00']);
  check('com horário, G e H não são destacadas', r.rows[0][6].highlight === false && r.rows[0][7].highlight === false);
  eq('sem horário gravado: G e H vazias e amarelas (nada de 08:00/17:00)',
    resolveRowsSheet(turmas, [{ input: linha({ horarioInicio: '', horarioFim: '' }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).rows[0].slice(6, 8).map(c => [c.value ?? null, c.highlight]), [[null, true], [null, true]]);
  eq('consultor: titulares com " / "', resolveRowsSheet(turmas, [{ input: linha({ titulares: ['A', 'B'] }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).rows[0][18].value, 'A / B');
  check('Plantas é estática do arquivo', VALE_TEMPLATE.sheets[1].kind === 'static' && VALE_TEMPLATE.sheets[1].staticFrom === 'file');
  check('template casa Vale por nome, como o formulário', VALE_TEMPLATE.company.nameIncludes === 'VALE');
  check('id do template é o template_id da 017', VALE_TEMPLATE.id === 'vale-v1');
  check('colunas manuais declaram persistScope', VALE_TURMAS_COLUMNS.filter(c => c.source === 'manual').every(c => !!c.persistScope));
  check('a Vale divide a híbrida em duas linhas', VALE_TEMPLATE.hybridSplit === true);
  eq('preço HH com uma chave por parte', VALE_TURMAS_COLUMNS.find(c => c.key === 'precoHH')!.hybridKeys, { presencial: 'precoHHPresencial', online: 'precoHHOnline' });
  eq('as cinco despesas (inclusive o combustível manual) zeram na online', VALE_TURMAS_COLUMNS.filter(c => c.hybridOnline === 'zero').map(c => c.key), ['locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros']);
  check('carga em branco sai amarela', VALE_TURMAS_COLUMNS.find(c => c.key === 'cargaHoraria')!.highlightWhenEmpty === true);
  const abas = resolveTemplate(VALE_TEMPLATE, [], emptyTemplateValuesIndex());
  eq('resolveTemplate devolve as duas abas na ordem', abas.map(a => `${a.name}:${a.kind}`), ['Turmas Realizadas:rows', 'Plantas:static']);
}

/* Blocos [D] dataset, [X] escritor (assíncrono: lê o arquivo-base), [P] painel. */
import { runValeDatasetChecks, buildValeContext } from './smokeMedicaoValeDatasets';
import { runWriterChecks } from './smokeMedicaoValeWriter';
import { runPanelChecks } from './smokeMedicaoValePanel';
import { runValoresChecks } from './smokeMedicaoValeValores';

(async () => {
  // Sequenciado de propósito (`falhas += f()` lê `falhas` ANTES de chamar f e
  // perderia os incrementos feitos lá dentro pelo `check` compartilhado).
  const f1 = runValeDatasetChecks({ ...tools, fixtures });
  falhas = Math.max(falhas, f1);
  const f2 = await runWriterChecks({ ...tools, fixtures }, buildValeContext());
  falhas = Math.max(falhas, f2);
  const f3 = runPanelChecks({ ...tools, fixtures }, buildValeContext());
  falhas = Math.max(falhas, f3);
  const f4 = await runValoresChecks({ ...tools, fixtures });
  falhas = Math.max(falhas, f4);

  console.log(falhas === 0 ? '\n✅ SMOKE MEDICAO VALE: OK' : `\n❌ SMOKE MEDICAO VALE: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
