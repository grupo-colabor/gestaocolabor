/**
 * SMOKE — Medição Vale (template de medição por empresa)
 *
 * Rodar com:  npm run smoke:medicao-vale
 *
 *   [T] Resolvedor: fórmulas por chave viram letras na ordem atual; reordenar
 *       coluna não quebra fórmula; totais cobrem exatamente a faixa de dados;
 *       valor manual: demanda > treinamento > padrão > vazio.
 *   [V] Template Vale: 18 colunas na ordem do arquivo, cabeçalhos exatos
 *       (com os espaços), I = G*H e P = SUM(J:N)+(SUM(J:N)*O) nas letras que
 *       o modelo usa, totais em G, I..N, P.
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
  dataInicio: '2026-08-10', horarioInicio: '08:00', nDias: 2, statusCalculado: 'CONCLUIDA',
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
}

/* ────────────────────────────────────────────────────────────────────────────
 * [V] Template Vale — o layout do arquivo
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[V] Template Vale');
{
  const turmas = VALE_TEMPLATE.sheets[0];
  const cols = resolveColumns(turmas);
  eq('18 colunas A..R', cols.map(c => c.letter).join(''), 'ABCDEFGHIJKLMNOPQR');
  eq('cabeçalhos exatos do arquivo (com os espaços)', cols.map(c => c.header), [
    'Número do anexo', 'ID da Turma', 'Treinamento', 'Local Treinamento ', 'Data', 'Horário', 'Carga horária',
    'Preço unitário HH', 'Valor total do treinamento', 'Despesa reembolsável (locação veículo/táxi)',
    'Despesa reembolsável (combustível)', 'Despesa reembolsável (alimentação)', 'Despesa reembolsável (hospedagem)',
    'Despesa reembolsável (outros)', '% despesa reembolsável', 'Valor total despesas', 'Consultor', 'Observação',
  ]);
  const r = resolveRowsSheet(turmas, [{ input: linha(), refs: refs('DEM-100') }, { input: linha({ demandId: 'DEM-101' }), refs: refs('DEM-101') }], emptyTemplateValuesIndex());
  eq('I = G*H na linha 2', r.rows[0][8].formula, 'G2*H2');
  eq('P = SUM(J:N)+(SUM(J:N)*O) na linha 3', r.rows[1][15].formula, 'SUM(J3:N3)+(SUM(J3:N3)*O3)');
  eq('totais em G, I..N, P (e não em H, O, Q, R)', r.totalsRow!.map((c, i) => (c ? cols[i].letter : null)).filter(Boolean), ['G', 'I', 'J', 'K', 'L', 'M', 'N', 'P']);
  eq('total de I cobre a faixa real (corrigido do modelo)', r.totalsRow![8]!.formula, 'SUM(I2:I3)');
  eq('O = 0,2 por padrão', r.rows[0][14].value, 0.2);
  eq('K (combustível) nasce 0', r.rows[0][10].value, 0);
  eq('B sem ID SAP fica destacada', resolveRowsSheet(turmas, [{ input: linha({ clientDemandId: '' }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).rows[0][1].highlight, true);
  eq('H sem preço fica destacada', r.rows[0][7].highlight, true);
  eq('consultor: titulares com " / "', resolveRowsSheet(turmas, [{ input: linha({ titulares: ['A', 'B'] }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).rows[0][16].value, 'A / B');
  check('Plantas é estática do arquivo', VALE_TEMPLATE.sheets[1].kind === 'static' && VALE_TEMPLATE.sheets[1].staticFrom === 'file');
  check('template casa Vale por nome, como o formulário', VALE_TEMPLATE.company.nameIncludes === 'VALE');
  check('id do template é o template_id da 017', VALE_TEMPLATE.id === 'vale-v1');
  check('colunas manuais declaram persistScope', VALE_TURMAS_COLUMNS.filter(c => c.source === 'manual').every(c => !!c.persistScope));
  const abas = resolveTemplate(VALE_TEMPLATE, [], emptyTemplateValuesIndex());
  eq('resolveTemplate devolve as duas abas na ordem', abas.map(a => `${a.name}:${a.kind}`), ['Turmas Realizadas:rows', 'Plantas:static']);
}

/* Blocos [D] dataset, [X] escritor (assíncrono: lê o arquivo-base), [P] painel. */
import { runValeDatasetChecks, buildValeContext } from './smokeMedicaoValeDatasets';
import { runWriterChecks } from './smokeMedicaoValeWriter';

(async () => {
  falhas += runValeDatasetChecks({ ...tools, fixtures });
  falhas += await runWriterChecks({ ...tools, fixtures }, buildValeContext());

  console.log(falhas === 0 ? '\n✅ SMOKE MEDICAO VALE: OK' : `\n❌ SMOKE MEDICAO VALE: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
