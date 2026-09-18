/**
 * EXPORTAÇÕES — escritor XLSX de TEMPLATE (I/O: ExcelJS + arquivo-base + download)
 *
 * Recebe as abas já resolvidas (domain/exports/templates/resolve.ts) e escreve
 * o arquivo do cliente. Com ARQUIVO-BASE (o modelo em public/templates/), o
 * escritor carrega o modelo, preenche a aba de linhas DENTRO dele e deixa as
 * abas estáticas (Plantas) como estão — cabeçalhos, larguras, fontes, fills
 * de tema e a aba estática vêm do próprio arquivo, sem transcrição. Não é
 * byte a byte (o ExcelJS reserializa), é conteúdo idêntico; o smoke lê de
 * volta e confere.
 *
 * Aba de linhas com `file` (layout pré-formatado no modelo):
 *   1. guarda o estilo de cada célula da 1ª linha de dados (protótipo) e da
 *      linha de totais, mais as alturas;
 *   2. remove as linhas pré-formatadas (dados + totais) — sobras do modelo
 *      não ficam com "0,2" e "R$ 0,00" soltos;
 *   3. escreve N linhas copiando o estilo do protótipo, e a linha de totais
 *      logo abaixo da última, com o estilo da linha de totais do modelo.
 *
 * Fórmulas entram como `{ formula }` (sem '='), como no Excel de pagamento.
 * Datas de verdade (UTC à meia-noite, para o serial do Excel cair no dia
 * certo) com dd/mm/yyyy; moeda e percentual com os formatos do modelo.
 * Célula editável vazia (`highlight`) fica amarela. Sem proteção, sem
 * congelamento, sem autofiltro — como o arquivo.
 *
 * Sem arquivo-base, gera do zero com um cabeçalho simples (é o caminho dos
 * templates da Etapa 3 antes do upload, e o fallback do smoke).
 */
import type {
  MeasurementTemplate,
  ResolvedCell,
  ResolvedFormSheet,
  ResolvedRowsSheet,
  ResolvedSheet,
  TemplateCellValue,
  TemplateFormat,
} from '../../domain/exports/templates/types';
import { triggerDownload, XLSX_MIME } from '../../utils/download';

const NUMFMT: Partial<Record<TemplateFormat, string>> = {
  currency: '"R$" #,##0.00',
  percent: '0.00%',
  date: 'dd/mm/yyyy',
  integer: '0',
};

const HIGHLIGHT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

/** 'YYYY-MM-DD' -> Date UTC à meia-noite (o ExcelJS converte por UTC). */
function toExcelDate(v: TemplateCellValue): Date | null {
  if (v instanceof Date) return v;
  const s = String(v ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function cellValue(cell: ResolvedCell): any {
  if (cell.formula) return { formula: cell.formula };
  const v = cell.value;
  if (v === undefined || v === null) return null;
  if (cell.format === 'date') return toExcelDate(v);
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (v instanceof Date) return v;
  return v;
}

const clone = <T,>(o: T): T => (o ? JSON.parse(JSON.stringify(o)) : o);

function applyCell(target: any, cell: ResolvedCell | null, protoStyle?: any) {
  // ⚠️ Células carregadas do arquivo COMPARTILHAM o objeto de estilo quando
  // têm o mesmo estilo (é assim que o ExcelJS lê o xlsx). Mutar `fill` ou
  // `numFmt` direto pintaria todas as irmãs — foi o que fez G20 ficar amarela
  // junto com G19 no BM. Sempre clonar antes de mexer.
  target.style = protoStyle ? clone(protoStyle) : clone(target.style ?? {});
  if (!cell) {
    target.value = null;
    return;
  }
  target.value = cellValue(cell);
  const fmt = cell.format ? NUMFMT[cell.format] : undefined;
  if (fmt) target.numFmt = fmt;
  if (cell.highlight) target.fill = clone(HIGHLIGHT_FILL);
}

/**
 * Preenche a aba de linhas DENTRO do arquivo-base.
 *
 * ⚠️ `worksheet.spliceRows` é no-op numa planilha carregada de arquivo no
 * ExcelJS 4.4 (verificado: `_rows.length` não muda). Por isso a aba não é
 * editada no lugar: o escritor guarda o que o modelo traz (linhas acima e
 * inclusive o cabeçalho, com valores e estilos; estilo da 1ª linha de dados;
 * estilo da linha de totais; larguras; views; alturas), REMOVE a aba e a
 * recria com o mesmo `orderNo` — que é o que o ExcelJS usa para ordenar as
 * abas ao gravar, então a Vale continua vendo "Turmas Realizadas" antes de
 * "Plantas". Fills de tema, fontes e bordas sobrevivem porque são copiados
 * como estilo de célula.
 */
function writeRowsSheetIntoBase(workbook: any, ws: any, sheet: ResolvedRowsSheet) {
  const layout = sheet.file;
  if (!layout) throw new Error(`Template: aba ${sheet.name} sem layout do arquivo-base`);
  const nCols = sheet.columns.length;

  // 1) O que o modelo traz e tem de continuar igual.
  const orderNo = ws.orderNo;
  const views = clone(ws.views);
  const pageSetup = clone(ws.pageSetup);
  const properties = clone(ws.properties);
  const widths: (number | undefined)[] = [];
  for (let c = 1; c <= Math.max(nCols, ws.columnCount); c++) widths.push(ws.getColumn(c).width);

  const acima: { height?: number; cells: { value: any; style: any }[] }[] = [];
  for (let r = 1; r < layout.firstDataRow; r++) {
    const row = ws.getRow(r);
    const cells: { value: any; style: any }[] = [];
    for (let c = 1; c <= Math.max(nCols, row.cellCount); c++) {
      const cell = row.getCell(c);
      cells.push({ value: clone(cell.value), style: clone(cell.style) });
    }
    acima.push({ height: row.height, cells });
  }

  const protoRow = ws.getRow(layout.firstDataRow);
  const protoStyles: any[] = [];
  for (let c = 1; c <= nCols; c++) protoStyles.push(clone(protoRow.getCell(c).style));
  const protoHeight = protoRow.height;

  const totalsProto = ws.getRow(layout.totalsRow);
  const totalsStyles: any[] = [];
  for (let c = 1; c <= nCols; c++) totalsStyles.push(clone(totalsProto.getCell(c).style));
  const totalsHeight = totalsProto.height;

  // 2) Recria a aba no mesmo lugar.
  workbook.removeWorksheet(ws.id);
  const novo = workbook.addWorksheet(sheet.name, { views, pageSetup, properties });
  novo.orderNo = orderNo;
  widths.forEach((w, i) => {
    if (w) novo.getColumn(i + 1).width = w;
  });

  acima.forEach((r, i) => {
    const row = novo.getRow(i + 1);
    r.cells.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.value = c.value;
      cell.style = c.style;
    });
    if (r.height) row.height = r.height;
  });

  // 3) Dados e totais, com o estilo do modelo.
  sheet.rows.forEach((cells, i) => {
    const row = novo.getRow(sheet.firstDataRow + i);
    cells.forEach((cell, j) => applyCell(row.getCell(j + 1), cell, protoStyles[j]));
    if (protoHeight) row.height = protoHeight;
  });

  if (sheet.totalsRow) {
    const row = novo.getRow(sheet.firstDataRow + sheet.rows.length);
    sheet.totalsRow.forEach((cell, j) => applyCell(row.getCell(j + 1), cell, totalsStyles[j]));
    if (totalsHeight) row.height = totalsHeight;
  }
}

/**
 * Preenche uma folha FORM (documento assinável, ex. BM) DENTRO do arquivo-base.
 *
 * Células endereçadas: só o valor (e o fill amarelo quando destacada); a
 * mesclagem vem do arquivo. Região de linhas:
 *   1. quando as linhas passam da capacidade pré-formatada, `insertRows` na
 *      linha do total — verificado no ExcelJS 4.4 com o vale-bm.xlsx: as
 *      mesclagens abaixo (total e assinaturas) são deslocadas e as imagens
 *      ficam; o que NÃO vem de graça é o estilo e a mesclagem das linhas
 *      novas (copiados da 1ª linha da região) e as fórmulas (o ExcelJS não as
 *      desloca — por isso o total é sempre reescrito na faixa real);
 *   2. escreve as linhas; nas posições pré-formatadas que sobraram, limpa as
 *      colunas de dado (o modelo traz exemplos) e deixa as fórmulas do arquivo,
 *      que mostram "-";
 *   3. total na linha calculada pelo resolvedor;
 *   4. com inserção, solta a altura de impressão (fitToHeight 0): o modelo é
 *      "1 página × 1 página" e um BM longo ficaria ilegível.
 */
/**
 * Devolve as mesclagens das linhas INSERIDAS, para serem aplicadas numa
 * segunda passagem. ⚠️ Depois de `insertRows` o ExcelJS só desloca as
 * mesclagens existentes ao GRAVAR; no modelo em memória as linhas novas ainda
 * aparecem cobertas pelas mesclagens antigas e `mergeCells` lança "Cannot
 * merge already merged cells". Gravar, recarregar e mesclar resolve
 * (verificado com o vale-bm.xlsx); ver `buildTemplateWorkbook`.
 */
function writeFormSheetIntoBase(ws: any, sheet: ResolvedFormSheet): string[] {
  for (const c of sheet.cells) {
    applyCell(ws.getCell(c.address), { value: c.value, formula: c.formula, format: c.format, highlight: c.highlight });
  }

  const reg = sheet.region;
  if (!reg) return [];

  const nCols = Math.max(ws.columnCount, 10);
  const protoRow = ws.getRow(reg.firstRow);
  const protoStyles: any[] = [];
  for (let c = 1; c <= nCols; c++) protoStyles.push(clone(protoRow.getCell(c).style));
  const protoHeight = protoRow.height;

  const mergesPendentes: string[] = [];
  if (reg.extraRows > 0) {
    ws.insertRows(reg.totalsRowInFile, Array.from({ length: reg.extraRows }, () => []));
    for (let r = reg.totalsRowInFile; r < reg.totalsRowInFile + reg.extraRows; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= nCols; c++) row.getCell(c).style = clone(protoStyles[c - 1]);
      if (protoHeight) row.height = protoHeight;
      for (const m of reg.mergeCols) {
        const [a, b] = m.split(':');
        mergesPendentes.push(`${a}${r}:${b}${r}`);
      }
    }
    ws.pageSetup = { ...ws.pageSetup, fitToHeight: 0 };
  }

  reg.rows.forEach((cells, i) => {
    const r = reg.firstRow + i;
    for (const { col, cell } of cells) applyCell(ws.getCell(`${col}${r}`), cell);
  });

  // Sobras pré-formatadas: limpa os exemplos do modelo, mantém as fórmulas.
  for (let r = reg.firstRow + reg.rows.length; r <= reg.lastRowInFile; r++) {
    for (const col of reg.clearCols) ws.getCell(`${col}${r}`).value = null;
  }

  ws.getCell(`${reg.totalsCell.col}${reg.totalsRow}`).value = { formula: reg.totalsCell.formula };
  return mergesPendentes;
}

function writeRowsSheetFromScratch(ws: any, sheet: ResolvedRowsSheet) {
  ws.columns = sheet.columns.map(c => ({ width: 16 }));
  const header = ws.getRow(sheet.headerRow);
  sheet.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = clone(HEADER_FILL);
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.rows.forEach((cells, r) => {
    const row = ws.getRow(sheet.firstDataRow + r);
    cells.forEach((cell, i) => applyCell(row.getCell(i + 1), cell));
  });
  if (sheet.totalsRow) {
    const row = ws.getRow(sheet.firstDataRow + sheet.rows.length);
    sheet.totalsRow.forEach((cell, i) => {
      const target = row.getCell(i + 1);
      applyCell(target, cell);
      if (cell) target.font = { bold: true };
    });
  }
}

export async function buildTemplateWorkbook(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  baseFile?: ArrayBuffer | Uint8Array | null
): Promise<any> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;
  let workbook = new ExcelJS.Workbook();

  if (baseFile) {
    await workbook.xlsx.load(baseFile as any);
  } else {
    workbook.creator = 'Gestão Colabor';
    workbook.created = new Date();
  }

  /** Mesclagens das linhas inseridas em folhas form — aplicadas na 2ª passagem. */
  const mergesPendentes: { sheet: string; ranges: string[] }[] = [];

  for (const sheet of sheets) {
    const existing = workbook.getWorksheet(sheet.name);
    if (sheet.kind === 'static') {
      if (!existing) {
        // Sem arquivo-base a aba estática não tem de onde vir: fica vazia, com o nome.
        workbook.addWorksheet(sheet.name);
      }
      continue;
    }
    if (sheet.kind === 'form') {
      // Folha form só faz sentido sobre o arquivo do cliente: os endereços
      // e as mesclagens são dele.
      if (!baseFile || !existing) {
        throw new Error(`A folha "${sheet.name}" do template "${template.label}" precisa do arquivo-base (${template.baseFile ?? 'não informado'}).`);
      }
      const ranges = writeFormSheetIntoBase(existing, sheet);
      if (ranges.length) mergesPendentes.push({ sheet: sheet.name, ranges });
      continue;
    }
    if (baseFile) {
      if (!existing) throw new Error(`O arquivo-base do template "${template.label}" não tem a aba "${sheet.name}".`);
      writeRowsSheetIntoBase(workbook, existing, sheet);
    } else {
      writeRowsSheetFromScratch(existing ?? workbook.addWorksheet(sheet.name), sheet);
    }
  }

  // 2ª passagem: com linhas inseridas, grava, recarrega e só então mescla as
  // linhas novas — ver writeFormSheetIntoBase.
  if (mergesPendentes.length) {
    const buffer = await workbook.xlsx.writeBuffer();
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    for (const { sheet, ranges } of mergesPendentes) {
      const ws = workbook.getWorksheet(sheet);
      for (const r of ranges) ws.mergeCells(r);
    }
  }

  return workbook;
}

export async function buildTemplateXlsxBuffer(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  baseFile?: ArrayBuffer | Uint8Array | null
): Promise<ArrayBuffer> {
  const wb = await buildTemplateWorkbook(template, sheets, baseFile);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * De onde vem o arquivo-base quando ele não é público: recebe bucket e caminho
 * e devolve os bytes. Injetado para este arquivo não importar o Storage —
 * quem o implementa é services/exports/templateFile.ts.
 */
export type TemplateBaseLoader = (bucket: string, path: string) => Promise<ArrayBuffer>;

/**
 * Busca o arquivo-base do template. Falha PROPAGA: sem o modelo não há como
 * garantir o layout, então não se gera nada.
 *
 * Dois caminhos, e o da VALE não muda: sem `baseFileFrom`, ou com 'public', é
 * `fetch` no caminho servido pelo app, exatamente como sempre foi. Com
 * 'storage' (modelos por empresa, migration 022) o `loader` baixa do bucket
 * privado — a URL assinada expira, então ela não pode estar guardada no
 * template e é resolvida na hora.
 */
export async function fetchTemplateBaseFile(
  template: MeasurementTemplate,
  loader?: TemplateBaseLoader
): Promise<ArrayBuffer | null> {
  if (!template.baseFile) return null;
  if (template.baseFileFrom === 'storage') {
    if (!loader) {
      throw new Error(
        `O modelo "${template.label}" guarda a planilha-base no armazenamento, mas nenhum leitor foi informado.`
      );
    }
    return loader(template.baseFileBucket ?? '', template.baseFile);
  }
  const resp = await fetch(template.baseFile);
  if (!resp.ok) throw new Error(`Arquivo-base do template não encontrado (${template.baseFile}: HTTP ${resp.status}).`);
  return resp.arrayBuffer();
}

export async function downloadTemplateXlsx(
  template: MeasurementTemplate,
  sheets: ResolvedSheet[],
  fileName: string,
  loader?: TemplateBaseLoader
): Promise<void> {
  const base = await fetchTemplateBaseFile(template, loader);
  const buffer = await buildTemplateXlsxBuffer(template, sheets, base);
  triggerDownload(buffer, fileName, XLSX_MIME);
}
