/**
 * MONTAGEM DA PLANILHA DE MEDIÇÃO (.xlsx) — camada pura
 *
 * Datas, resolução de período e construção do workbook. Sem Supabase e sem
 * DOM: só transforma blocos já prontos em planilha. A busca dos dados e o
 * download ficam em `medicaoExportService.ts`.
 *
 * A separação não é estética — é o que permite o smoke test
 * (`npm run smoke:medicao`) rodar em Node sem instanciar cliente de banco.
 *
 * REGRA CENTRAL: o app entrega demandas e HORAS; o valor da hora/aula é
 * digitado à mão na planilha depois do export. Por isso TODA célula de valor
 * sai como FÓRMULA — nunca um número calculado aqui. O valor da hora existe
 * num único lugar (coluna B do Resumo) e as abas de detalhe o referenciam com
 * referência absoluta (`Resumo!$B$n`): preencher a célula recalcula tudo.
 */

/* ========================================================================== */
/* Tipos públicos                                                             */
/* ========================================================================== */

export interface MedicaoDetailRow {
  /** Código da demanda (DEM-xxxx). */
  demandId: string;
  trainingName: string;
  /** Dias efetivamente alocados ao instrutor dentro do período, 'YYYY-MM-DD'. */
  dias: string[];
  local: string;
  modalidade: string;
  horas: number;
}

export interface MedicaoInstructorBlock {
  instructorId: string;
  nome: string;
  cpf: string;
  linhas: MedicaoDetailRow[];
}

/** Como o usuário escolheu o período. Ambos os modos resolvem para o mesmo par de datas. */
export type MedicaoPeriodo =
  | { modo: 'MES'; year: number; month: number }
  | { modo: 'PERSONALIZADO'; dataInicio: string; dataFim: string };

export interface MedicaoPeriodoResolvido {
  /** 'YYYY-MM-DD', inclusivo. */
  dataInicio: string;
  /** 'YYYY-MM-DD', inclusivo. */
  dataFim: string;
  /** Período por extenso — vai para o título do Resumo e para as mensagens da UI. */
  label: string;
  fileName: string;
}
/* ========================================================================== */
/* Datas                                                                      */
/* ========================================================================== */

/** Primeiro e último dia do mês, 'YYYY-MM-DD'. `month` é 1-12. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0');
  // Dia 0 do mês seguinte = último dia deste mês (cobre bissexto sem tabela).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

const toBR = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

function isContiguous(dias: string[]): boolean {
  for (let i = 1; i < dias.length; i++) {
    const prev = new Date(`${dias[i - 1]}T12:00:00`);
    prev.setDate(prev.getDate() + 1);
    const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
    if (expected !== dias[i]) return false;
  }
  return true;
}

/** '05/03/2026' | '05/03/2026 a 07/03/2026' | '05/03/2026, 09/03/2026'. */
export function formatDias(dias: string[]): string {
  if (!dias.length) return '—';
  if (dias.length === 1) return toBR(dias[0]);
  if (isContiguous(dias)) return `${toBR(dias[0])} a ${toBR(dias[dias.length - 1])}`;
  return dias.map(toBR).join(', ');
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Nº de dias do intervalo, contando as duas pontas. */
export function countDaysInclusive(dataInicio: string, dataFim: string): number {
  const start = new Date(`${dataInicio}T12:00:00`);
  const end = new Date(`${dataFim}T12:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Único ponto onde os dois modos viram um par de datas. Daqui pra baixo não
 * existe mais "modo": o cálculo e a planilha só enxergam [dataInicio, dataFim].
 */
export function resolvePeriodo(periodo: MedicaoPeriodo): MedicaoPeriodoResolvido {
  if (periodo.modo === 'MES') {
    const { year, month } = periodo;
    const { start, end } = monthBounds(year, month);
    return {
      dataInicio: start,
      dataFim: end,
      label: `${MONTH_NAMES[month - 1]}/${year} (${toBR(start)} a ${toBR(end)})`,
      fileName: `Medicao_Instrutores_${String(month).padStart(2, '0')}-${year}.xlsx`,
    };
  }

  const dataInicio = periodo.dataInicio.slice(0, 10);
  const dataFim = periodo.dataFim.slice(0, 10);

  if (!dataInicio || !dataFim) {
    throw new Error('Período inválido: informe a data de início e a de fim.');
  }
  if (dataFim < dataInicio) {
    throw new Error('Período inválido: a data de fim é anterior à de início.');
  }

  const brInicio = toBR(dataInicio);
  const brFim = toBR(dataFim);
  return {
    dataInicio,
    dataFim,
    label: `${brInicio} a ${brFim}`,
    fileName: `Medicao_Instrutores_${brInicio.replaceAll('/', '-')}_a_${brFim.replaceAll('/', '-')}.xlsx`,
  };
}
/* ========================================================================== */
/* Workbook                                                                   */
/* ========================================================================== */

const HEADER_FILL = 'FF1E293B';
const INPUT_FILL = 'FFFFFF00'; // amarelo: célula de preenchimento manual
const FMT_HORAS = '0.0';
const FMT_MOEDA = '"R$" #,##0.00';

const RESUMO_SHEET = 'Resumo';

// Resumo: linha 1 = título com o período por extenso (para o arquivo ser
// autoexplicativo depois de baixado), linha 2 = cabeçalho, dados da 3 em
// diante. Abas de detalhe não têm título: cabeçalho na 1, dados da 2.
const RESUMO_TITLE_ROW = 1;
const RESUMO_HEADER_ROW = 2;
const RESUMO_FIRST_DATA_ROW = 3;
const DETAIL_FIRST_DATA_ROW = 2;

/**
 * Proteção das abas — sem senha, de propósito: é uma trava contra digitar por
 * cima de fórmula, não um cadeado. Quem realmente precisar editar remove em
 * Revisão › Desproteger Planilha, num clique.
 *
 * Motivo: na primeira rodada real o valor da hora foi digitado na coluna
 * Valor da aba do instrutor, sobrescrevendo `=F2*Resumo!$B$2` — a planilha
 * parou de recalcular sem dar nenhum sinal. Só as células de input manual
 * ficam destravadas (`locked: false`).
 */
const SHEET_PROTECTION = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  // Formatação e ordenação seguem liberadas — o que trava é a escrita.
  formatCells: true,
  formatColumns: true,
  formatRows: true,
  sort: true,
  autoFilter: true,
  insertRows: false,
  insertColumns: false,
  deleteRows: false,
  deleteColumns: false,
  insertHyperlinks: false,
  pivotTables: false,
};

/** Destrava a célula e aplica o visual de campo de preenchimento manual. */
function markAsInput(cell: any) {
  cell.protection = { locked: false };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  };
}

/**
 * Nome de aba válido no Excel: máx. 31 chars, sem / \ ? * [ ] :, sem apóstrofo
 * nas pontas. Nomes repetidos (após o corte de 31) recebem sufixo numérico.
 */
export function sanitizeSheetName(raw: string, used: Set<string>): string {
  let base = String(raw ?? '')
    .replace(/[\/\\?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();

  if (!base) base = 'Instrutor';
  base = base.slice(0, 31).trim();

  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
    n++;
  }

  used.add(name.toLowerCase());
  return name;
}

/** Referência a uma aba dentro de fórmula: sempre entre aspas, com '' escapado. */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;

function styleHeaderRow(row: any, lastCol: number) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  row.height = 20;
}

/**
 * Monta o workbook. Todas as colunas de valor são fórmulas; a única entrada
 * numérica humana é a coluna B do Resumo (Hora/Aula), em amarelo.
 *
 * Todas as abas saem protegidas (sem senha) com apenas as células de input
 * destravadas — ver SHEET_PROTECTION. Os cabeçalhos das colunas derivadas
 * levam o sufixo "— automático", e as duas células decisivas (Hora/Aula no
 * Resumo, Valor na aba de detalhe) levam nota explicando onde preencher.
 */
export async function buildMedicaoWorkbook(
  blocks: MedicaoInstructorBlock[],
  periodo: MedicaoPeriodoResolvido
) {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestão Colabor';
  workbook.created = new Date();
  workbook.title = `Medição de Instrutores — ${periodo.label}`;

  const resumo = workbook.addWorksheet(RESUMO_SHEET, {
    views: [{ state: 'frozen', ySplit: RESUMO_HEADER_ROW }],
  });
  resumo.columns = [
    { width: 34 }, // A Instrutor
    { width: 18 }, // B Hora/Aula  <- único input
    { width: 26 }, // C Total de Horas — automático
    { width: 26 }, // D Total (R$) — automático
    { width: 20 }, // E CPF/CNPJ
    { width: 50 }, // F Dados Bancários
  ];

  // Título: o período tem que viajar DENTRO do arquivo. O nome do arquivo se
  // perde assim que alguém renomeia ou encaminha a planilha.
  const titleRow = resumo.addRow([`MEDIÇÃO DE INSTRUTORES — ${periodo.label}`]);
  resumo.mergeCells(RESUMO_TITLE_ROW, 1, RESUMO_TITLE_ROW, 6);
  titleRow.getCell(1).font = { bold: true, size: 13 };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  titleRow.height = 26;

  const resumoHeader = resumo.addRow([
    'Instrutor',
    'Hora/Aula (R$)',
    'Total de Horas — automático',
    'Total (R$) — automático',
    'CPF/CNPJ',
    'Dados Bancários',
  ]);
  styleHeaderRow(resumoHeader, 6);

  resumoHeader.getCell(2).note =
    'PREENCHA AQUI.\n\n' +
    'Esta é a única coluna a preencher em toda a planilha: o valor da hora/aula ' +
    'de cada instrutor, nas células amarelas abaixo.\n\n' +
    'Ao preencher, o Excel calcula sozinho o Total de Horas, o Total (R$), o ' +
    'TOTAL GERAL e a coluna Valor da aba de cada instrutor.\n\n' +
    'As demais colunas contêm fórmulas e estão protegidas — digitar por cima ' +
    'delas quebraria o cálculo.';

  // Nome da aba de cada instrutor tem que existir ANTES das fórmulas do
  // Resumo, e a linha do Resumo antes das fórmulas da aba de detalhe — daí
  // resolver os nomes primeiro e escrever as duas pontas depois.
  const usedSheetNames = new Set<string>([RESUMO_SHEET.toLowerCase()]);
  const planned = blocks.map((block, i) => ({
    block,
    sheetName: sanitizeSheetName(block.nome, usedSheetNames),
    resumoRow: RESUMO_FIRST_DATA_ROW + i,
  }));

  for (const { block, sheetName, resumoRow } of planned) {
    const lastDetailRow = DETAIL_FIRST_DATA_ROW + block.linhas.length - 1;

    const row = resumo.addRow([block.nome, null, null, null, block.cpf || '', '']);

    // B: única entrada numérica manual da planilha inteira.
    const rateCell = row.getCell(2);
    markAsInput(rateCell);
    rateCell.numFmt = FMT_MOEDA;

    // C: soma das horas da aba do instrutor (range fechado, não coluna inteira).
    const horasCell = row.getCell(3);
    horasCell.value = { formula: `SUM(${sheetRef(sheetName)}!F${DETAIL_FIRST_DATA_ROW}:F${lastDetailRow})` };
    horasCell.numFmt = FMT_HORAS;

    const totalCell = row.getCell(4);
    totalCell.value = { formula: `B${resumoRow}*C${resumoRow}` };
    totalCell.numFmt = FMT_MOEDA;
    totalCell.font = { bold: true };

    // F: sem dados bancários no cadastro de instrutor — preenchimento manual.
    markAsInput(row.getCell(6));
  }

  const lastResumoRow = RESUMO_FIRST_DATA_ROW + planned.length - 1;
  const totalGeralRow = resumo.addRow(['TOTAL GERAL', null, null, null, '', '']);
  totalGeralRow.getCell(1).font = { bold: true };
  totalGeralRow.getCell(3).value = { formula: `SUM(C${RESUMO_FIRST_DATA_ROW}:C${lastResumoRow})` };
  totalGeralRow.getCell(3).numFmt = FMT_HORAS;
  totalGeralRow.getCell(3).font = { bold: true };
  totalGeralRow.getCell(4).value = { formula: `SUM(D${RESUMO_FIRST_DATA_ROW}:D${lastResumoRow})` };
  totalGeralRow.getCell(4).numFmt = FMT_MOEDA;
  totalGeralRow.getCell(4).font = { bold: true };

  /* ---- abas de detalhe ---- */
  for (const { block, sheetName, resumoRow } of planned) {
    const ws = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { width: 14 }, // A Código
      { width: 40 }, // B Treinamento
      { width: 26 }, // C Data
      { width: 28 }, // D Local
      { width: 18 }, // E Modalidade
      { width: 10 }, // F Horas
      { width: 26 }, // G Valor (R$) — automático
    ];
    const detailHeader = ws.addRow([
      'Código', 'Treinamento', 'Data', 'Local', 'Modalidade', 'Horas', 'Valor (R$) — automático',
    ]);
    styleHeaderRow(detailHeader, 7);

    // Foi exatamente aqui que o valor da hora foi digitado por cima da fórmula
    // na primeira rodada real — daí a nota, além da proteção da aba.
    detailHeader.getCell(7).note =
      'NÃO PREENCHA AQUI.\n\n' +
      'Esta coluna é calculada: horas × valor da hora/aula.\n\n' +
      'O valor da hora/aula se preenche uma única vez, na coluna amarela ' +
      '"Hora/Aula (R$)" da aba Resumo, na linha deste instrutor.';

    block.linhas.forEach((linha, i) => {
      const rowIdx = DETAIL_FIRST_DATA_ROW + i;
      const row = ws.addRow([
        linha.demandId,
        linha.trainingName,
        formatDias(linha.dias),
        linha.local,
        linha.modalidade,
        linha.horas,
        null,
      ]);
      row.getCell(6).numFmt = FMT_HORAS;

      // Referência absoluta à Hora/Aula do Resumo: existe um único lugar onde
      // o valor é digitado, e preenchê-lo recalcula esta coluna inteira.
      const valorCell = row.getCell(7);
      valorCell.value = { formula: `F${rowIdx}*Resumo!$B$${resumoRow}` };
      valorCell.numFmt = FMT_MOEDA;
    });

    const lastDetailRow = DETAIL_FIRST_DATA_ROW + block.linhas.length - 1;
    const totalRow = ws.addRow(['', '', '', '', 'Total:', null, null]);
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: 'right' };
    totalRow.getCell(6).value = { formula: `SUM(F${DETAIL_FIRST_DATA_ROW}:F${lastDetailRow})` };
    totalRow.getCell(6).numFmt = FMT_HORAS;
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(7).value = { formula: `SUM(G${DETAIL_FIRST_DATA_ROW}:G${lastDetailRow})` };
    totalRow.getCell(7).numFmt = FMT_MOEDA;
    totalRow.getCell(7).font = { bold: true };

    // Aba de detalhe é 100% derivada: nada aqui é de preenchimento manual.
    await ws.protect(undefined, SHEET_PROTECTION);
  }

  // Sem senha: só as células amarelas (B e F) ficam editáveis; o resto exige
  // Revisão › Desproteger Planilha, o que torna a sobrescrita deliberada.
  await resumo.protect(undefined, SHEET_PROTECTION);

  return workbook;
}
