/**
 * SMOKE — BM da Vale: bloco [X] escritor de folha form (arquivo-base real,
 * lido de volta) e o XLSX de exemplo para abrir no Excel.
 */
import fs from 'fs';
import path from 'path';
import { resolveFormSheet, resolveTemplate } from '../domain/exports/templates/resolve';
import { VALE_BM_TEMPLATE } from '../domain/exports/templates/vale-bm';
import { buildBm, bmRegionRows, periodoLabel } from '../domain/exports/datasets/medicaoValeBm';
import { buildTemplateXlsxBuffer } from '../services/exports/templateXlsxWriter';
import type { BmSmokeTools } from './smokeMedicaoValeBmChecks';

const texto = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('formula' in v) return `=${v.formula}`;
    if ('sharedFormula' in v) return `=shared(${v.sharedFormula})`;
    if ('richText' in v) return v.richText.map((r: any) => r.text).join('');
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
};

export async function runBmWriterChecks(t: BmSmokeTools, ctx: { src: any; recorte: any[] }): Promise<number> {
  let falhas = 0;
  const check: BmSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: BmSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };

  console.log('\n[X] Escritor de folha form — vale-bm.xlsx real, lido de volta');
  const basePath = path.join(process.cwd(), 'public', 'templates', 'vale-bm.xlsx');
  check('arquivo-base existe em public/templates/vale-bm.xlsx', fs.existsSync(basePath));
  if (!fs.existsSync(basePath)) return falhas;
  const base = fs.readFileSync(basePath);
  const ExcelJS = (await import('exceljs')) as any;
  const Workbook = (ExcelJS.default ?? ExcelJS).Workbook;
  const reload = async (buf: ArrayBuffer) => { const wb = new Workbook(); await wb.xlsx.load(buf); return wb.worksheets[0]; };

  const bm = buildBm(ctx.recorte, ctx.src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
  const bru = bm.minas.find(m => m.mina === 'Brucutu')!;
  const sheets = resolveTemplate(VALE_BM_TEMPLATE, [], ctx.src.templateValues, {
    context: bru.contexto,
    manual: { dataEnvio: '2026-09-16' },
    periodoLabel: periodoLabel('2026-08-01', '2026-08-31'),
    regionRows: bmRegionRows(bru),
  });
  const buffer = await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, sheets, base);
  const ws = await reload(buffer);
  const cell = (a: string) => ws.getCell(a);
  const n = bru.linhas.length;

  eq('folha única com o nome do modelo', ws.name, 'BOLETIM MEDIÇÃO');
  eq('F10 gerência executiva (mesclada F10:G10)', cell('F10').value, 'Gerência Executiva de Operações');
  eq('H10 gerência', cell('H10').value, 'Gerência de Segurança');
  eq('B13 contrato', cell('B13').value, '5900123435');
  eq('E13 contratada', cell('E13').value, 'Colabor Consultoria e Treinamento LTDA');
  eq('F13 objeto', cell('F13').value, 'Treinamentos Presenciais Corredor Sudeste');
  check('B16 data de envio é data de verdade', cell('B16').value instanceof Date);
  eq('B16 no dia certo', (cell('B16').value as Date).toISOString().slice(0, 10), '2026-09-16');
  eq('E16 gestor', cell('E16').value, 'Soraya Martins');
  eq('F16 local', cell('F16').value, 'Mina de Brucutu');
  eq('I16 período', cell('I16').value, '01/08/2026 a 31/08/2026');
  check('mesclagens do cabeçalho preservadas (F10:G10, B13:D14, F13:J14)', ['F10:G10', 'B13:D14', 'F13:J14'].every(m => ws.model.merges.includes(m)));

  eq(`${n} linhas na região: B19 = QQP 20`, cell('B19').value, '20');
  eq('C19 descrição', cell('C19').value, bru.linhas[0].descricao);
  eq('F19 unidade com o espaço do arquivo', cell('F19').value, 'Hora/Aula ');
  eq('G19 preço', cell('G19').value, bru.linhas[0].preco);
  eq('H19 quantidade (Σ carga)', cell('H19').value, bru.linhas[0].quantidade);
  eq('I19 = G19*H19', texto(cell('I19').value), '=G19*H19');
  const ultima = 19 + n - 1;
  eq(`última linha (${ultima}) = despesas QQP 70, unidade 1, preço 1`, [cell(`B${ultima}`).value, cell(`F${ultima}`).value, cell(`G${ultima}`).value], ['70', 1, 1]);
  eq('quantidade da linha 70 = Σ P', cell(`H${ultima}`).value, bru.totalDespesas);
  const semPreco = 19 + bru.linhas.findIndex(l => l.preco === null);
  eq(`linha sem preço (híbrida) na ${semPreco}: G vazia e amarela`, [cell(`G${semPreco}`).value ?? null, cell(`G${semPreco}`).fill?.fgColor?.argb], [null, 'FFFFFF00']);
  const comPreco = 19 + bru.linhas.findIndex(l => l.preco !== null);
  check(`linha com preço na ${comPreco}: G não é amarela`, cell(`G${comPreco}`).fill?.fgColor?.argb !== 'FFFFFF00');
  eq('sobras do modelo limpas (exemplo "Despesas Tributáveis" da linha 20 sumiu)', cell(`C${ultima + 1}`).value ?? null, null);
  eq('sobras mantêm a fórmula do arquivo', texto(cell(`I${ultima + 1}`).value), `=G${ultima + 1}*H${ultima + 1}`);
  eq('total na 43 reescrito na faixa real', texto(cell('I43').value), '=SUM(I19:J42)');
  eq('rótulo do total intacto', cell('B43').value, 'VALOR TOTAL DESTA MEDIÇÃO (R$)');
  eq('mesclagens: 77 como no modelo', ws.model.merges.length, 77);
  eq('imagens: 2', ws.getImages().length, 2);
  check('assinaturas no lugar (B49 "Assinatura do Preposto")', String(cell('B49').value).startsWith('Assinatura do Preposto'));

  // Exemplo para abrir no Excel.
  const outDir = path.join(process.cwd(), 'node_modules', '.cache');
  const exemplo = path.join(outDir, 'exemplo-vale-bm-brucutu.xlsx');
  fs.writeFileSync(exemplo, Buffer.from(buffer));
  const tmp = 'C:\\tmp';
  if (fs.existsSync(tmp)) fs.copyFileSync(exemplo, path.join(tmp, 'exemplo-vale-bm-brucutu.xlsx'));
  check('exemplo gravado em node_modules/.cache (e em C:\\tmp quando existe)', fs.existsSync(exemplo));

  // 30 treinamentos: 6 linhas inseridas antes do total.
  const region30 = Array.from({ length: 30 }, (_, i) => ({ qqp: '20', descricao: `Aplicação de Treinamento - T${i + 1}`, unidade: 'Hora/Aula ', preco: 100, quantidade: 8 }));
  const form30 = resolveFormSheet(VALE_BM_TEMPLATE.sheets[0], { context: bru.contexto, manual: { dataEnvio: '2026-09-16' }, periodoLabel: 'x', regionRows: region30 });
  const buf30 = await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, [form30], base);
  const w30 = await reload(buf30);
  eq('30 linhas: 30ª na 48 com fórmula certa', texto(w30.getCell('I48').value), '=G48*H48');
  eq('30 linhas: total na 49 = SUM(I19:J48)', texto(w30.getCell('I49').value), '=SUM(I19:J48)');
  eq('30 linhas: rótulo do total deslocado para a 49', w30.getCell('B49').value, 'VALOR TOTAL DESTA MEDIÇÃO (R$)');
  check('30 linhas: linhas inseridas mescladas (C44:E44, I48:J48)', w30.model.merges.includes('C44:E44') && w30.model.merges.includes('I48:J48'));
  check('30 linhas: total mesclado (B49:H49, I49:J49)', w30.model.merges.includes('B49:H49') && w30.model.merges.includes('I49:J49'));
  check('30 linhas: assinaturas deslocadas 6 linhas (G51:J51, B55:D55)', w30.model.merges.includes('G51:J51') && w30.model.merges.includes('B55:D55'));
  check('30 linhas: "Assinatura do Preposto" agora na 55', String(w30.getCell('B55').value).startsWith('Assinatura do Preposto'));
  eq('30 linhas: total de mesclagens = 77 + 6×2', w30.model.merges.length, 77 + 12);
  eq('30 linhas: imagens continuam 2', w30.getImages().length, 2);
  check('30 linhas: estilo copiado (borda medium à esquerda em B44)', w30.getCell('B44').border?.left?.style === 'medium');
  eq('30 linhas: altura 60 na linha inserida', w30.getRow(44).height, 60);
  eq('30 linhas: impressão solta em altura', w30.pageSetup.fitToHeight, 0);
  const exemplo30 = path.join(outDir, 'exemplo-vale-bm-30-linhas.xlsx');
  fs.writeFileSync(exemplo30, Buffer.from(buf30));
  if (fs.existsSync(tmp)) fs.copyFileSync(exemplo30, path.join(tmp, 'exemplo-vale-bm-30-linhas.xlsx'));

  // Sem arquivo-base: erro claro, nunca um BM sem layout.
  let lancou = '';
  try { await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, sheets, null); } catch (e: any) { lancou = e.message; }
  check('sem arquivo-base a folha form recusa gerar', /arquivo-base/.test(lancou));

  return falhas;
}
