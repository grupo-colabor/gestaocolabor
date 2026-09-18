/**
 * SMOKE — Modelos de medição por empresa: bloco [A], leitura do arquivo (I/O)
 *
 * Chamado por smokeModelosMedicao.ts (runner assíncrono: abre .xlsx de
 * verdade). Mesmo contrato dos blocos irmãos da Vale: recebe os helpers e usa
 * o `check` compartilhado.
 *
 *   • guarda de assinatura de bytes ANTES do ExcelJS: .xls antigo, PDF, vazio
 *     e grande demais recusados pelo que são, cada um com a frase que a pessoa
 *     precisa ler;
 *   • fotografia do `public/templates/vale.xlsx` REAL, e a heurística achando
 *     o cabeçalho dele na linha 1;
 *   • fixture montada em memória (título mesclado, aba oculta, aba protegida)
 *     atravessando o caminho inteiro: bytes -> ExcelJS -> snapshot -> sugestão.
 *
 * A fixture é construída aqui, não versionada como binário: o smoke tem de
 * provar a leitura de um arquivo que ele mesmo descreve, e um .xlsx no git
 * seria uma caixa-preta que ninguém revisa.
 */
import fs from 'fs';
import path from 'path';

import {
  assertXlsx,
  readTemplateFile,
  TemplateFileError,
  TEMPLATE_FILE_MAX_BYTES,
} from '../services/exports/templateFile';
import { suggestHeader, suggestSheet } from '../domain/exports/templates/inspect';

interface Tools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
}

/** Monta o .xlsx de fixture em memória e devolve os bytes. */
async function fixtureXlsx(): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new (ExcelJS as any).Workbook();

  const ws = wb.addWorksheet('Medição');
  ws.getCell('A1').value = 'RELATÓRIO DE MEDIÇÃO — CLIENTE X';
  ws.mergeCells('A1:E1');
  // L2 fica vazia de propósito.
  ws.getRow(3).values = ['Item', 'Descrição do Serviço', 'Qtd', 'Valor Unit.', 'Total'];
  ws.getRow(4).values = [1, 'NR-35 Trabalho em Altura', 8, 150, 1200];
  ws.getRow(5).values = [2, 'NR-10 Básico', 40, 150, 6000];

  const oculta = wb.addWorksheet('Interna');
  oculta.state = 'hidden';
  oculta.getCell('A1').value = 'uso interno';

  const travada = wb.addWorksheet('Travada');
  travada.getCell('A1').value = 'x';
  await travada.protect('segredo', { selectLockedCells: true });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

async function esperaRecusa(
  t: Tools,
  nome: string,
  fn: () => unknown | Promise<unknown>,
  codigo: string,
  trecho?: string
) {
  try {
    await fn();
    t.check(nome, false, 'não recusou');
  } catch (e: any) {
    const ok =
      e instanceof TemplateFileError &&
      e.codigo === codigo &&
      (!trecho || String(e.message).includes(trecho));
    t.check(nome, ok, `codigo=${e?.codigo} msg=${String(e?.message).slice(0, 120)}`);
  }
}

export async function runArquivoChecks(t: Tools): Promise<number> {
  const raiz = process.cwd();

  console.log('\n[A] Arquivo enviado — guarda de assinatura antes do ExcelJS');
  {
    // Assinatura OLE2 sintética: é o que TODO .xls tem nos 8 primeiros bytes,
    // e não depende de nenhum arquivo no repositório.
    const xls = new Uint8Array(512);
    xls.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await esperaRecusa(t, '.xls antigo é recusado citando ".xlsx"', () => assertXlsx(xls), 'xls-antigo', '.xlsx');
    t.check(
      'e a frase diz o que fazer (salvar como Pasta de Trabalho)',
      (() => {
        try { assertXlsx(xls); return false; } catch (e: any) { return String(e.message).includes('salve como'); }
      })()
    );
    await esperaRecusa(t, 'readTemplateFile também recusa o .xls', () => readTemplateFile(xls), 'xls-antigo');

    // A RAZÃO DE SER da guarda, contra um .xls de verdade: o ExcelJS 4.4 o
    // carrega SEM lançar e devolve ZERO abas. Só roda quando o arquivo está
    // na máquina (ele não é versionado); quando não está, isso é DITO, nunca
    // contado como sucesso.
    const xlsReal = path.join(raiz, 'public/templates/vale-bm.xls');
    if (fs.existsSync(xlsReal)) {
      const bytes = fs.readFileSync(xlsReal);
      const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
      const wb = new (ExcelJS as any).Workbook();
      let lancou = false;
      try { await wb.xlsx.load(bytes); } catch { lancou = true; }
      t.check('.xls real: o ExcelJS NÃO lança (é por isso que a guarda existe)', !lancou);
      t.check('.xls real: e devolve zero abas — a falha silenciosa que a guarda evita', (wb.worksheets ?? []).length === 0);
      await esperaRecusa(t, '.xls real é recusado pela guarda', () => readTemplateFile(bytes), 'xls-antigo');
    } else {
      console.log('  --    .xls real ausente (public/templates/vale-bm.xls não é versionado) — 3 checagens PULADAS');
    }

    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    await esperaRecusa(t, 'PDF é recusado pelo que é', () => assertXlsx(pdf), 'nao-e-xlsx', 'PDF');

    await esperaRecusa(t, 'arquivo vazio é recusado', () => assertXlsx(new Uint8Array(0)), 'vazio');

    const grande = new Uint8Array(TEMPLATE_FILE_MAX_BYTES + 1);
    grande.set([0x50, 0x4b, 0x03, 0x04]);
    await esperaRecusa(t, 'acima do limite é recusado com o tamanho', () => assertXlsx(grande), 'grande', 'MB');

    // Zip que não é xlsx: passa a assinatura e morre no parser, com motivo.
    const zipVazio = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);
    await esperaRecusa(t, 'zip que não é planilha vira "ilegível", não silêncio', () => readTemplateFile(zipVazio), 'ilegivel');

    const xlsx = fs.readFileSync(path.join(raiz, 'public/templates/vale.xlsx'));
    let passou = true;
    try { assertXlsx(xlsx); } catch { passou = false; }
    t.check('.xlsx de verdade passa na guarda', passou);
  }

  console.log('\n[A] Fotografia do vale.xlsx real');
  {
    const bytes = fs.readFileSync(path.join(raiz, 'public/templates/vale.xlsx'));
    const snap = await readTemplateFile(bytes);
    t.eq('duas abas, na ordem do arquivo', snap.sheets.map(s => s.name), ['Turmas Realizadas', 'Plantas']);
    t.check('nenhuma oculta, nenhuma protegida', snap.sheets.every(s => !s.hidden && !s.locked));

    const turmas = snap.sheets[0];
    t.check('19 colunas declaradas pelo arquivo', turmas.columnCount === 19, String(turmas.columnCount));
    t.eq('primeiro cabeçalho, com os espaços do arquivo',
      turmas.rows[0].slice(0, 4).map(c => c.text),
      ['Número do anexo', 'ID da Turma', 'Treinamento', 'Local Treinamento ']);

    const s = suggestHeader(turmas);
    t.eq('vale.xlsx: cabeçalho na linha 1', s.headerRow, 1);
    t.eq('confiança alta', s.confianca, 'alta');
    t.eq('as 18 colunas do template, na ordem',
      s.columns.slice(0, 3).map(c => `${c.letter}:${c.header}`),
      ['A:Número do anexo', 'B:ID da Turma', 'C:Treinamento']);
    t.check('sugere a aba de turmas, não a de Plantas', suggestSheet(snap).sheetName === 'Turmas Realizadas');
  }

  console.log('\n[A] Fixture em memória — bytes até a sugestão');
  {
    const buf = await fixtureXlsx();
    const snap = await readTemplateFile(buf);

    t.eq('três abas', snap.sheets.map(s => s.name), ['Medição', 'Interna', 'Travada']);
    t.check('aba oculta detectada', snap.sheets[1].hidden === true);
    t.check('aba protegida detectada', snap.sheets[2].locked === true);
    t.check('a visível não é marcada como oculta nem protegida', !snap.sheets[0].hidden && !snap.sheets[0].locked);

    const medicao = snap.sheets[0];
    t.eq('mesclagem do título foi lida', medicao.merges, ['A1:E1']);
    t.eq('células cobertas pela mesclagem vêm como "mesclada"',
      medicao.rows[0].map(c => c.type), ['texto', 'mesclada', 'mesclada', 'mesclada', 'mesclada']);
    t.eq('linha 2 vazia', medicao.rows[1].map(c => c.type), ['vazio', 'vazio', 'vazio', 'vazio', 'vazio']);
    t.eq('linha 3 toda texto', medicao.rows[2].map(c => c.type), ['texto', 'texto', 'texto', 'texto', 'texto']);
    t.eq('linha 4 tem número', medicao.rows[3].map(c => c.type), ['numero', 'texto', 'numero', 'numero', 'numero']);

    const escolha = suggestSheet(snap);
    t.eq('escolhe a aba visível com cabeçalho', escolha.sheetName, 'Medição');
    t.eq('cabeçalho na linha 3, dados na 4', [escolha.header.headerRow, escolha.header.firstDataRow], [3, 4]);
    t.eq('colunas sugeridas', escolha.header.columns.map(c => c.header),
      ['Item', 'Descrição do Serviço', 'Qtd', 'Valor Unit.', 'Total']);
    t.check('avisa que as demais abas saem como estão',
      escolha.avisos.some(a => a.includes('exatamente como estão')));
  }

  return 0;
}
