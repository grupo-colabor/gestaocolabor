/**
 * SMOKE — valor com separador de milhar ("1.234,56") e notinha sem valor na
 * Medição Vale e no BM. Chamado por smokeMedicaoVale.ts ([MIL]) e
 * smokeMedicaoValeBm.ts ([MIL-BM]).
 *
 * O bug que o parser pt-BR fechou: a leitura antiga trocava só a PRIMEIRA
 * vírgula ("1.234,56" → "1.234.56" → 1,234) e o Salvar gravava esse número.
 * Aqui o item chega como TEXTO (o que o painel tem em edição, e o que um
 * dado antigo em texto teria) e precisa sair 1.234,56 nos dois documentos;
 * 1.234,56 × 1,2 = 1.481,472 na linha de despesas do BM, igual ao Σ da coluna
 * R da Medição Vale.
 *
 * A notinha com valor 0 que entra na medição do cliente é aviso (decisão 9):
 * a turma continua na planilha, a coluna da categoria sai amarela e o
 * painel avisa; no BM, a linha de despesas da mina sai amarela.
 */
import fs from 'fs';
import path from 'path';

import { buildMedicaoValeRows, toRowsSheetInput } from '../domain/exports/datasets/medicaoVale';
import { avisoBmValorAConferir, bmRegionDestaques, bmRegionRows, buildBm, periodoLabel } from '../domain/exports/datasets/medicaoValeBm';
import { buildPendencias } from '../domain/exports/pendencias';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { VALE_BM_TEMPLATE } from '../domain/exports/templates/vale-bm';
import { resolveRowsSheet, resolveTemplate } from '../domain/exports/templates/resolve';
import { buildTemplateXlsxBuffer } from '../services/exports/templateXlsxWriter';
import { demandaVale, medicao } from './smokeMedicaoValeDatasets';
import { fonteNr, type NrTools } from './smokeNaoReembolsaMedicaoCliente';
import { sigmaMedicaoVale } from './smokeMedicaoValeBmChecks';

function contador(t: NrTools) {
  let falhas = 0;
  const check: NrTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: NrTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };
  const perto: NrTools['perto'] = (n, a, b) => { if (!(Math.abs(a - b) < 1e-6)) falhas++; t.perto(n, a, b); };
  return { check, eq, perto, falhas: () => falhas };
}

const raiz = process.cwd();
const AMARELO = 'FFFFFF00';
const texto = (v: any): string | null => (v && typeof v === 'object' && 'formula' in v ? `=${v.formula}` : v === null || v === undefined ? null : String(v));

/** A leitura ANTIGA, só como contraprova do que foi corrigido (proibida no app). */
const leituraAntiga = (v: string) => parseFloat(v.replace(',', '.'));

const itemMilhar = { id: 'mil', name: 'Lançamento Avulso', url: '#', type: 'text/plain', category: 'LOCOMOCAO', value: '1.234,56' };
const notinhaZero = { id: 'zero', name: 'hotel.pdf', url: 'https://storage/hotel.pdf', type: 'application/pdf', category: 'HOSPEDAGEM', value: 0 };

function fonte(comZero: boolean) {
  const d = demandaVale({ id: 'DEM-1310', clientDemandId: 'SAP-1310' });
  const m = medicao('DEM-1310', { attachments: comZero ? [itemMilhar, notinhaZero] : [itemMilhar] });
  return fonteNr([d], [m]);
}

/* ═════════════════════════════════ MEDIÇÃO VALE ═════════════════════════════════ */

export async function runMilharValeChecks(t: NrTools): Promise<number> {
  const { check, eq, perto, falhas } = contador(t);
  console.log('\n[MIL] "1.234,56" e notinha sem valor na Medição Vale');

  check('contraprova: a leitura antiga dava 1,234', Math.abs(leituraAntiga('1.234,56') - 1.234) < 1e-9);

  const src = fonte(true);
  const rows = buildMedicaoValeRows(src);
  perto('linha: locomoção = 1234,56', rows[0].input.despesas.locomocao, 1234.56);
  eq('linha: hospedagem 0 e a notinha vira aviso', [rows[0].input.despesas.hospedagem, rows[0].valoresAConferir.map(i => `${i.itemId}:${i.status}`)], [0, ['zero:semValor']]);

  const linhas = toRowsSheetInput(rows, VALE_TEMPLATE);
  const sheet = resolveRowsSheet(VALE_TEMPLATE.sheets[0], linhas, src.templateValues);
  const ci = (k: string) => sheet.columns.findIndex(c => c.key === k);
  const cel = (k: string) => sheet.rows[0][ci(k)];
  eq('planilha: L = 1234,56, sem amarelo', [cel('locacao').value, cel('locacao').highlight], [1234.56, false]);
  eq('planilha: O (hospedagem) = 0 e AMARELA (notinha sem valor)', [cel('hospedagem').value, cel('hospedagem').highlight], [0, true]);
  check('a turma continua na planilha com hora/aula (decisão 9: só aviso)', rows[0].elegivelTurmas && cel('cargaHoraria').value === 16);
  const pend = buildPendencias(rows, { sheet: VALE_TEMPLATE.sheets[0], template: VALE_TEMPLATE, templateValues: src.templateValues, logisticAllocations: [], logisticBlocks: [] })[0]?.pendencias.map(p => p.texto) ?? [];
  check('painel de pendências: "Notinha sem valor em Hospedagem (1 item · célula O)"', pend.includes('Notinha sem valor em Hospedagem (1 item · célula O)'), JSON.stringify(pend));

  const basePath = path.join(raiz, 'public', 'templates', 'vale.xlsx');
  check('arquivo-base da Vale existe', fs.existsSync(basePath));
  if (fs.existsSync(basePath)) {
    const buf = await buildTemplateXlsxBuffer(VALE_TEMPLATE, resolveTemplate(VALE_TEMPLATE, linhas, src.templateValues), fs.readFileSync(basePath));
    const ExcelJS = (await import('exceljs')) as any;
    const wb = new (ExcelJS.default ?? ExcelJS).Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Turmas Realizadas');
    eq('XLSX lido de volta: L2 = 1234,56', ws.getCell('L2').value, 1234.56);
    check('XLSX: L2 não é amarela', ws.getCell('L2').fill?.fgColor?.argb !== AMARELO);
    eq('XLSX: O2 = 0 e amarela (notinha sem valor)', [ws.getCell('O2').value, ws.getCell('O2').fill?.fgColor?.argb], [0, AMARELO]);
    eq('XLSX: R2 soma L2:P2 com o % (Excel dá 1.481,472)', texto(ws.getCell('R2').value), '=SUM(L2:P2)+(SUM(L2:P2)*Q2)');
  }

  const semZero = resolveRowsSheet(VALE_TEMPLATE.sheets[0], toRowsSheetInput(buildMedicaoValeRows(fonte(false)), VALE_TEMPLATE), src.templateValues);
  check('sem a notinha zerada, nenhuma despesa amarela (o destaque é por item, não por coluna zerada)',
    ['locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros'].every(k => semZero.rows[0][ci(k)].highlight === false));

  return falhas();
}

/* ═══════════════════════════════════ BM VALE ═══════════════════════════════════ */

export async function runMilharBmChecks(t: NrTools): Promise<number> {
  const { check, eq, perto, falhas } = contador(t);
  console.log('\n[MIL-BM] "1.234,56" e notinha sem valor no BM');

  const src = fonte(true);
  const rows = buildMedicaoValeRows(src);
  const bm = buildBm(rows.filter(r => r.elegivelTurmas), src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste', mina: 'Brucutu' });
  const bru = bm.minas[0];
  const despesas = bru.linhas.find(l => l.tipo === 'despesas')!;
  perto('linha "Despesas Tributáveis" = 1234,56 × 1,2 = 1481,472', despesas.quantidade!, 1481.472);
  perto('igualdade BM × Medição Vale: total do boletim = Σ (K + R)', bru.totalTreinamentos + bru.totalDespesas, sigmaMedicaoVale(rows, src.templateValues).noBm);
  eq('linha de despesas marcada para conferir (notinha sem valor na turma)', [despesas.conferir, bru.turmasComValorAConferir], [['quantidade'], ['DEM-1310']]);
  eq('aviso da turma no painel do BM', avisoBmValorAConferir(bru), 'Despesa sem valor ou suspeita nesta turma — linha "Despesas Tributáveis" do BM em amarelo (Sudeste | Brucutu)');

  const basePath = path.join(raiz, 'public', 'templates', 'vale-bm.xlsx');
  check('arquivo-base do BM existe', fs.existsSync(basePath));
  if (fs.existsSync(basePath)) {
    const ExcelJS = (await import('exceljs')) as any;
    const gerar = async (mina: typeof bru) => {
      const sheets = resolveTemplate(VALE_BM_TEMPLATE, [], src.templateValues, {
        context: mina.contexto, manual: { dataEnvio: '2026-09-16' }, periodoLabel: periodoLabel('2026-08-01', '2026-08-31'),
        regionRows: bmRegionRows(mina), regionDestaques: bmRegionDestaques(mina),
      });
      const wb = new (ExcelJS.default ?? ExcelJS).Workbook();
      await wb.xlsx.load(await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, sheets, fs.readFileSync(basePath)));
      return wb.worksheets[0];
    };
    const ws = await gerar(bru);
    const ultima = 19 + bru.linhas.length - 1;
    perto('XLSX do BM lido de volta: H da linha de despesas = 1481,472', ws.getCell(`H${ultima}`).value, 1481.472);
    eq('XLSX do BM: H da linha de despesas AMARELA', ws.getCell(`H${ultima}`).fill?.fgColor?.argb, AMARELO);
    check('XLSX do BM: a linha de treinamento não é amarela', ws.getCell('H19').fill?.fgColor?.argb !== AMARELO);

    const rowsSemZero = buildMedicaoValeRows(fonte(false));
    const bmSemZero = buildBm(rowsSemZero.filter(r => r.elegivelTurmas), src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste', mina: 'Brucutu' }).minas[0];
    const ws2 = await gerar(bmSemZero);
    const ultima2 = 19 + bmSemZero.linhas.length - 1;
    perto('sem a notinha zerada: a mesma quantidade 1481,472', ws2.getCell(`H${ultima2}`).value, 1481.472);
    check('e a linha de despesas não é amarela', ws2.getCell(`H${ultima2}`).fill?.fgColor?.argb !== AMARELO);
  }

  return falhas();
}
