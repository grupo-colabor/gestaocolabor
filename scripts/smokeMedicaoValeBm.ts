/**
 * SMOKE — BM da Vale (folha form do template engine)
 *
 * Rodar com:  npm run smoke:medicao-vale-bm
 *
 *   [F] Resolvedor de folha form: células endereçadas por chave (context /
 *       manual / periodo / dataEnvio), região de linhas com fórmulas por chave
 *       nas letras do arquivo, total SEMPRE reescrito na faixa real, cálculo
 *       de linhas extras quando passa da capacidade.
 *   [Σ] Dataset BM: Σ (preço × quantidade) das linhas 20 = Σ coluna I da aba
 *       Turmas para o mesmo recorte; quantidade da linha 70 = Σ coluna P;
 *       agregação por nome normalizado + preço; turma sem local fora, com
 *       contagem; um BM por mina.
 *   [X] Escritor: XLSX gerado do vale-bm.xlsx real e lido de volta — cabeçalho
 *       nos endereços do modelo, região, total, 30 treinamentos → linhas
 *       inseridas com mesclagens, assinaturas e imagens intactas.
 *   [Z] Zip: uma entrada por mina, nomes esperados.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import { resolveFormSheet, resolveFormula } from '../domain/exports/templates/resolve';
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
export const tools = { check, eq, perto };

/* ────────────────────────────────────────────────────────────────────────────
 * [F] Resolvedor de folha form
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[F] Resolvedor de folha form');
{
  const sheet: TemplateSheet = {
    name: 'FORM',
    kind: 'form',
    cells: [
      { key: 'contrato', cell: 'B13', source: 'context', highlightWhenEmpty: true },
      { key: 'gestor', cell: 'E16', source: 'context', highlightWhenEmpty: true },
      { key: 'dataEnvio', cell: 'B16', source: 'dataEnvio', format: 'date' },
      { key: 'periodo', cell: 'I16', source: 'periodo' },
      { key: 'obs', cell: 'A1', source: 'manual', defaultValue: 'padrão' },
    ],
    region: {
      rowScope: 'training',
      firstRow: 19,
      lastRowInFile: 42,
      totalsRowInFile: 43,
      mergeCols: ['C:E', 'I:J'],
      columns: [
        { key: 'qqp', col: 'B', source: 'field' },
        { key: 'descricao', col: 'C', source: 'field' },
        { key: 'unidade', col: 'F', source: 'constant', value: 'Hora/Aula ' },
        { key: 'preco', col: 'G', source: 'field', highlightWhenEmpty: true },
        { key: 'quantidade', col: 'H', source: 'field' },
        { key: 'total', col: 'I', source: 'formula', formula: '={col:preco}{row}*{col:quantidade}{row}' },
      ],
      totals: { col: 'I', formula: 'SUM({col:total}{first}:J{last})' },
    },
  };
  const ctx = new Map<string, any>([['contrato', '5900123435']]);
  const linha = (i: number, preco: number | null = 100) => ({ qqp: '20', descricao: `T${i}`, preco, quantidade: 8 });

  const r = resolveFormSheet(sheet, {
    context: ctx,
    manual: { dataEnvio: '2026-09-16' },
    periodoLabel: '01/08/2026 a 31/08/2026',
    regionRows: [linha(1), linha(2, null)],
  });
  const cel = (a: string) => r.cells.find(c => c.address === a)!;
  eq('context lido por chave', cel('B13').value, '5900123435');
  eq('context ausente -> vazio e destacado', [cel('E16').value, cel('E16').highlight], [null, true]);
  eq('dataEnvio vem do manual, formato date', [cel('B16').value, cel('B16').format], ['2026-09-16', 'date']);
  eq('periodo do rótulo', cel('I16').value, '01/08/2026 a 31/08/2026');
  eq('manual ausente -> default', cel('A1').value, 'padrão');

  const reg = r.region!;
  eq('capacidade do arquivo = 24', reg.capacity, 24);
  eq('2 linhas: sem inserção, total na 43, faixa 19..42', [reg.extraRows, reg.totalsRow, reg.lastRow], [0, 43, 42]);
  eq('total reescrito na faixa real', reg.totalsCell, { col: 'I', formula: 'SUM(I19:J42)' });
  eq('linha 1: letras do arquivo e fórmula por chave', reg.rows[0].map(c => `${c.col}=${c.cell.formula ?? c.cell.value}`), ['B=20', 'C=T1', 'F=Hora/Aula ', 'G=100', 'H=8', 'I=G19*H19']);
  eq('linha 2: preço vazio destacado', reg.rows[1].find(c => c.col === 'G')!.cell.highlight, true);
  eq('colunas limpas nas sobras = as não-fórmula', reg.clearCols, ['B', 'C', 'F', 'G', 'H']);

  const r30 = resolveFormSheet(sheet, { regionRows: Array.from({ length: 30 }, (_, i) => linha(i + 1)) });
  eq('30 linhas: 6 extras, total na 49, faixa 19..48', [r30.region!.extraRows, r30.region!.totalsRow, r30.region!.lastRow], [6, 49, 48]);
  eq('30 linhas: total SUM(I19:J48)', r30.region!.totalsCell.formula, 'SUM(I19:J48)');
  eq('30 linhas: fórmula da 30ª na linha 48', r30.region!.rows[29].find(c => c.col === 'I')!.cell.formula, 'G48*H48');

  let lancou = false;
  try { resolveFormSheet({ ...sheet, kind: 'rows' } as any, {}); } catch { lancou = true; }
  check('aba que não é form é erro', lancou);
  eq('resolveFormula com letra literal no total é aceito na folha form', resolveFormula('SUM(I{first}:J{last})', [], { first: 19, last: 42 }), 'SUM(I19:J42)');
}

/* Blocos [Σ] [X] [Z] entram com dataset, escritor e zip. */
import { runBmChecks } from './smokeMedicaoValeBmChecks';

(async () => {
  // Sequenciado: `falhas += await f()` leria `falhas` antes da chamada.
  const n = await runBmChecks(tools);
  falhas = Math.max(falhas, n);
  console.log(falhas === 0 ? '\n✅ SMOKE MEDICAO VALE BM: OK' : `\n❌ SMOKE MEDICAO VALE BM: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
