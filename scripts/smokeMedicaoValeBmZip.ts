/**
 * SMOKE — BM da Vale: bloco [Z] zip por corredor (uma entrada por mina).
 */
import fs from 'fs';
import path from 'path';
import { resolveTemplate } from '../domain/exports/templates/resolve';
import { VALE_BM_TEMPLATE } from '../domain/exports/templates/vale-bm';
import { buildBm, bmRegionRows, bmFileName, bmZipName, periodoLabel } from '../domain/exports/datasets/medicaoValeBm';
import { buildTemplateXlsxBuffer } from '../services/exports/templateXlsxWriter';
import { buildZip } from '../services/exports/zipWriter';
import type { BmSmokeTools } from './smokeMedicaoValeBmChecks';

export async function runBmZipChecks(t: BmSmokeTools, ctx: { src: any; recorte: any[] }): Promise<number> {
  let falhas = 0;
  const check: BmSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: BmSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };

  console.log('\n[Z] Zip por corredor');
  const base = fs.readFileSync(path.join(process.cwd(), 'public', 'templates', 'vale-bm.xlsx'));
  const bm = buildBm(ctx.recorte, ctx.src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
  const [di, df] = ['2026-08-01', '2026-08-31'];

  const entries = [];
  for (const m of bm.minas) {
    const sheets = resolveTemplate(VALE_BM_TEMPLATE, [], ctx.src.templateValues, {
      context: m.contexto, manual: { dataEnvio: '2026-09-16' }, periodoLabel: periodoLabel(di, df), regionRows: bmRegionRows(m),
    });
    entries.push({ name: bmFileName(VALE_BM_TEMPLATE, 'Sudeste', m.mina, di, df), data: await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, sheets, base) });
  }
  const zipBuf = await buildZip(entries);
  const mod: any = await import('jszip');
  const JSZip = mod.default ?? mod;
  const zip = await JSZip.loadAsync(zipBuf);
  const nomes = Object.keys(zip.files).sort();
  eq('uma entrada por mina, com os nomes esperados', nomes, [
    'vale-bm-sudeste-brucutu-2026-08-01_2026-08-31.xlsx',
    'vale-bm-sudeste-timbopeba-2026-08-01_2026-08-31.xlsx',
  ]);
  eq('nome do zip', bmZipName(VALE_BM_TEMPLATE, 'Sudeste', di, df), 'vale-bm-sudeste-2026-08-01_2026-08-31.zip');

  const ExcelJS = (await import('exceljs')) as any;
  const Workbook = (ExcelJS.default ?? ExcelJS).Workbook;
  for (const nome of nomes) {
    const data = await zip.file(nome).async('arraybuffer');
    const wb = new Workbook();
    await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    const mina = nome.includes('brucutu') ? 'Brucutu' : 'Timbopeba';
    check(`${nome}: é um BM válido (folha, total na 43)`, ws.name === 'BOLETIM MEDIÇÃO' && !!ws.getCell('I43').value);
    if (mina === 'Timbopeba') {
      eq('Timbopeba: cabeçalho sem cadastro sai em branco e amarelo (B13)', [ws.getCell('B13').value ?? null, ws.getCell('B13').fill?.fgColor?.argb], [null, 'FFFFFF00']);
    } else {
      eq('Brucutu: cabeçalho preenchido (B13)', ws.getCell('B13').value, '5900123435');
    }
  }
  check('zip tem tamanho plausível (< 200 KB para 2 BMs)', zipBuf.byteLength > 10_000 && zipBuf.byteLength < 200_000);

  let lancou = false;
  try { await buildZip([]); } catch { lancou = true; }
  check('zip vazio é erro', lancou);
  lancou = false;
  try { await buildZip([{ name: 'a.xlsx', data: new Uint8Array(1) }, { name: 'a.xlsx', data: new Uint8Array(1) }]); } catch { lancou = true; }
  check('nome repetido é erro', lancou);

  const tmp = 'C:\\tmp';
  if (fs.existsSync(tmp)) fs.writeFileSync(path.join(tmp, bmZipName(VALE_BM_TEMPLATE, 'Sudeste', di, df)), Buffer.from(zipBuf));
  return falhas;
}
