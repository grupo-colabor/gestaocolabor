/**
 * SMOKE — Medição Vale: bloco [X] escritor de template
 *
 * Gera o XLSX a partir das fixtures E do arquivo-base real
 * (public/templates/vale.xlsx), lê de volta com o ExcelJS e confere:
 * fórmulas nas células certas, totais logo abaixo da última turma cobrindo a
 * faixa real, sobras do modelo removidas, Plantas igual ao snapshot, manuais
 * preservados, B/H amarelas quando vazias, data como data com dd/mm/yyyy.
 */
import fs from 'fs';
import path from 'path';
import { resolveTemplate } from '../domain/exports/templates/resolve';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { toRowsSheetInput } from '../domain/exports/datasets/medicaoVale';
import { buildTemplateXlsxBuffer } from '../services/exports/templateXlsxWriter';
import type { ValeSmokeTools } from './smokeMedicaoValeDatasets';

/** Snapshot da aba Plantas do modelo (extração de 16/09/2026), com os espaços que o arquivo tem. */
export const PLANTAS_SNAPSHOT: (string | null)[][] = [
  ['Planta ', 'Site', 'Cidade', 'Observação'],
  ['1111', 'Mutuca', 'Nova Lima', null],
  ['1111', 'Mar Azul', 'Nova Lima', 'incluir no BM de Mutuca se houver turma'],
  ['1118', 'Vargem Grande', 'Nova Lima', null],
  ['1095', 'Fábrica', 'Ouro Preto', null],
  ['4384', 'Concórdia', 'Nova Lima', null],
  ['1107', 'Brumadinho', 'Sarzedo', null],
  ['4007', 'Vale SA', 'Belo Horizonte', null],
  ['1124', 'Rio de Janeiro', 'Itaguaí', null],
  ['4002', 'Torre - Botafogo', 'Rio de Janeiro', null],
  ['1079', 'Fazendao', 'Catas Altas', null],
  ['1074', 'Timbopeba', 'Ouro Preto', null],
  ['1070', 'Caue ', 'Itabira', null],
  ['1083', 'Brucutu', 'São Gonçalo do Rio Abaixo', null],
  ['4052', 'EFVM', 'Nova Era', null],
  ['4207', 'EFVM', 'Costa Lacerda (Santa Bárbara)', null],
  ['4208', 'EFVM', 'Conselheiro Pena', null],
  ['4059', 'EFVM', 'Governador Valadares', null],
  ['1090', 'EFVM', 'Vitoria', null],
  ['1090', 'EFVM', 'Serra', null],
  ['1042', 'EFVM', 'Simões Filho - BA', null],
  ['1086', 'Mário Carvalho', 'Ipatinga', null],
  ['1086', 'Mário Carvalho', 'Barao de Cocais', null],
];

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

export async function runWriterChecks(t: ValeSmokeTools, ctx: { src: any; rows: any[] }): Promise<number> {
  let falhas = 0;
  const check: ValeSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: ValeSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };

  console.log('\n[X] Escritor de template — arquivo-base real, lido de volta');

  const basePath = path.join(process.cwd(), 'public', 'templates', 'vale.xlsx');
  check('arquivo-base existe em public/templates/vale.xlsx', fs.existsSync(basePath));
  if (!fs.existsSync(basePath)) return falhas;
  const base = fs.readFileSync(basePath);

  const linhas = toRowsSheetInput(ctx.rows);
  const sheets = resolveTemplate(VALE_TEMPLATE, linhas, ctx.src.templateValues);
  const n = linhas.length;
  const buffer = await buildTemplateXlsxBuffer(VALE_TEMPLATE, sheets, base);

  const ExcelJS = (await import('exceljs')) as any;
  const wb = new (ExcelJS.default ?? ExcelJS).Workbook();
  await wb.xlsx.load(buffer);

  eq('duas abas, na ordem do modelo', wb.worksheets.map((w: any) => w.name), ['Turmas Realizadas', 'Plantas']);
  const ws = wb.getWorksheet('Turmas Realizadas');
  const cell = (addr: string) => ws.getCell(addr);

  eq('cabeçalho preservado do arquivo (D1 com espaço)', [texto(cell('A1').value), texto(cell('D1').value), texto(cell('T1').value)], ['Número do anexo', 'Local Treinamento ', 'Observação']);
  // O escritor copia a linha 1 DO ARQUIVO, não do template: se os dois
  // divergirem, a planilha sai com cabeçalho de uma coluna sobre dado de outra.
  eq('linha 1 do arquivo-base = cabeçalhos do template, coluna a coluna',
    sheets[0].kind === 'rows' ? sheets[0].columns.map((c, i) => texto(ws.getRow(1).getCell(i + 1).value)) : [],
    sheets[0].kind === 'rows' ? sheets[0].columns.map(c => c.header) : ['?']);
  check('cabeçalho mantém o fill de tema do modelo', !!cell('A1').fill && cell('A1').fill.pattern === 'solid');
  check('as colunas novas (E..H) têm o mesmo fill de cabeçalho', ['E1', 'F1', 'G1', 'H1'].every(a => cell(a).fill?.pattern === 'solid'));
  eq(`${n} turmas nas linhas 2..${n + 1}`, ws.getRow(n + 1).getCell(1).value, n);
  eq('A é sequência 1..n', Array.from({ length: n }, (_, i) => ws.getRow(2 + i).getCell(1).value), Array.from({ length: n }, (_, i) => i + 1));
  eq('K2 = I2*J2', texto(cell('K2').value), '=I2*J2');
  eq('R2 = SUM(L2:P2)+(SUM(L2:P2)*Q2)', texto(cell('R2').value), '=SUM(L2:P2)+(SUM(L2:P2)*Q2)');
  eq(`K${n + 1} na última turma`, texto(cell(`K${n + 1}`).value), `=I${n + 1}*J${n + 1}`);

  const tot = n + 2;
  eq(`totais logo abaixo da última turma (linha ${tot}): I`, texto(cell(`I${tot}`).value), `=SUM(I2:I${n + 1})`);
  eq('total de K cobre a faixa real (corrigido do modelo)', texto(cell(`K${tot}`).value), `=SUM(K2:K${n + 1})`);
  eq('totais em L..P e R', ['L', 'M', 'N', 'O', 'P', 'R'].map(l => texto(cell(`${l}${tot}`).value)), ['L', 'M', 'N', 'O', 'P', 'R'].map(l => `=SUM(${l}2:${l}${n + 1})`));
  eq('sem total em J, Q, S, T', ['J', 'Q', 'S', 'T'].map(l => cell(`${l}${tot}`).value ?? null), [null, null, null, null]);
  check('linha de totais com o estilo do modelo (negrito)', !!cell(`I${tot}`).font?.bold);
  eq('sobras do modelo removidas: nada abaixo dos totais', ws.getRow(tot + 1).getCell(17).value ?? null, null);
  check('rowCount termina nos totais', ws.rowCount === tot || ws.actualRowCount === tot);

  // Valores da primeira turma (DEM-100: SAP-100, preço por treinamento 120, combustível 45, obs).
  eq('B2 = ID SAP', cell('B2').value, 'SAP-100');
  eq('J2 = preço HH por treinamento', cell('J2').value, 120);
  eq('J2 com formato de moeda (aprovado)', cell('J2').numFmt, '"R$" #,##0.00');
  eq('M2 = combustível digitado', cell('M2').value, 45);
  eq('Q2 = 0,2 com 0.00%', [cell('Q2').value, cell('Q2').numFmt], [0.2, '0.00%']);
  eq('T2 = observação', cell('T2').value, 'Turma extra');
  eq('L2/N2/O2/P2 = despesas reembolsáveis', ['L', 'N', 'O', 'P'].map(l => cell(`${l}2`).value), [80, 50, 200, 25]);
  eq('S2 = titulares " / "', cell('S2').value, 'Titular / Segundo');
  eq('G2 = horário de início HH:mm como texto', cell('G2').value, '08:00');
  eq('H2 = horário de término HH:mm como texto', cell('H2').value, '17:00');
  eq('I2 = carga como número', cell('I2').value, 16);
  check('E2 é data de verdade', cell('E2').value instanceof Date);
  eq('E2 no dia certo (UTC)', (cell('E2').value as Date).toISOString().slice(0, 10), '2026-08-10');
  eq('E2 com dd/mm/yyyy', cell('E2').numFmt, 'dd/mm/yyyy');
  check('F2 (data fim) é data de verdade', cell('F2').value instanceof Date);
  eq('F2 = último dia, com dd/mm/yyyy', [(cell('F2').value as Date).toISOString().slice(0, 10), cell('F2').numFmt], ['2026-08-11', 'dd/mm/yyyy']);
  check('linha de dados copia o estilo do protótipo (borda fina)', cell('C2').border?.left?.style === 'thin');

  // Segunda turma (DEM-101): sem ID SAP -> B amarela; preço sobrescrito 150.
  eq('B3 vazia e amarela', [cell('B3').value ?? null, cell('B3').fill?.fgColor?.argb], [null, 'FFFFFF00']);
  eq('J3 = preço sobrescrito na demanda', cell('J3').value, 150);
  check('J3 não é amarela (tem valor)', cell('J3').fill?.fgColor?.argb !== 'FFFFFF00');
  // Terceira (DEM-102, híbrida, dias específicos, treinamento sem preço): J amarela, vazia.
  eq('J4 vazia e amarela', [cell('J4').value ?? null, cell('J4').fill?.fgColor?.argb], [null, 'FFFFFF00']);
  eq('I4 = 40 (carga do treinamento, híbrida)', cell('I4').value, 40);
  eq('F4 = último dia específico (22/08), G4/H4 = horários do primeiro e do último dia',
    [(cell('F4').value as Date).toISOString().slice(0, 10), cell('G4').value, cell('H4').value], ['2026-08-22', '13:00', '18:00']);
  check('G4/H4 com horário não são amarelas', cell('G4').fill?.fgColor?.argb !== 'FFFFFF00' && cell('H4').fill?.fgColor?.argb !== 'FFFFFF00');

  // Plantas: igual ao snapshot, célula a célula.
  const plantas = wb.getWorksheet('Plantas');
  const lidas: (string | null)[][] = [];
  for (let r = 1; r <= PLANTAS_SNAPSHOT.length; r++) {
    lidas.push([1, 2, 3, 4].map(c => texto(plantas.getRow(r).getCell(c).value)));
  }
  eq('Plantas igual ao snapshot (23 × 4)', lidas, PLANTAS_SNAPSHOT);
  eq('Plantas sem linha extra', plantas.getRow(PLANTAS_SNAPSHOT.length + 1).getCell(1).value ?? null, null);

  // Sem arquivo-base: gera do zero, mesmas fórmulas.
  const semBase = await buildTemplateXlsxBuffer(VALE_TEMPLATE, sheets, null);
  const wb2 = new (ExcelJS.default ?? ExcelJS).Workbook();
  await wb2.xlsx.load(semBase);
  const ws2 = wb2.getWorksheet('Turmas Realizadas');
  eq('sem base: cabeçalho do template', ws2.getCell('D1').value, 'Local Treinamento ');
  eq('sem base: mesma fórmula', texto(ws2.getCell('R2').value), '=SUM(L2:P2)+(SUM(L2:P2)*Q2)');
  eq('sem base: totais na mesma linha', texto(ws2.getCell(`I${tot}`).value), `=SUM(I2:I${n + 1})`);
  check('sem base: aba Plantas existe vazia', !!wb2.getWorksheet('Plantas'));

  // Zero turmas: totais valem 0, nada quebra.
  const vazio = await buildTemplateXlsxBuffer(VALE_TEMPLATE, resolveTemplate(VALE_TEMPLATE, [], ctx.src.templateValues), base);
  const wb3 = new (ExcelJS.default ?? ExcelJS).Workbook();
  await wb3.xlsx.load(vazio);
  eq('zero turmas: totais na linha 2 valendo 0', wb3.getWorksheet('Turmas Realizadas').getCell('I2').value, 0);

  return falhas;
}
