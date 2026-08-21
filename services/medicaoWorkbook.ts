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
 * sai como FÓRMULA — nunca um número calculado aqui.
 *
 * A tarifa varia por EMPRESA, não por instrutor: o mesmo instrutor recebe um
 * valor/hora na Vale e outro em outro cliente. Por isso as tarifas moram numa
 * aba própria ("Tarifas"), uma linha por par (instrutor, empresa), e a coluna
 * Valor de cada aba de detalhe busca a tarifa por SUMIFS cruzando o nome do
 * instrutor com a empresa da PRÓPRIA LINHA. Preencher uma célula da aba
 * Tarifas recalcula todas as linhas daquele par.
 */

/* ========================================================================== */
/* Tipos públicos                                                             */
/* ========================================================================== */

export interface MedicaoDetailRow {
  /** Código da demanda (DEM-xxxx). */
  demandId: string;
  /**
   * Nome da empresa/cliente da demanda — é a CHAVE de busca da tarifa na aba
   * Tarifas, então tem que ser exatamente a mesma string dos dois lados.
   * Vem do cadastro (`companies.name` via `demands.company_id`), nunca digitada.
   */
  empresa: string;
  trainingName: string;
  /** Dias efetivamente alocados ao instrutor dentro do período, 'YYYY-MM-DD'. */
  dias: string[];
  local: string;
  modalidade: string;
  horas: number;
  /**
   * Categoria da demanda INTERNA (SIPAT, Visita, Apoio Logístico...). Vazia em
   * demanda de cliente, que já é identificada por empresa + treinamento.
   */
  categoria: string;
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
const TARIFAS_SHEET = 'Tarifas';

// Resumo: linha 1 = título com o período por extenso (para o arquivo ser
// autoexplicativo depois de baixado), linha 2 = cabeçalho, dados da 3 em
// diante. Tarifas e abas de detalhe não têm título: cabeçalho na 1, dados na 2.
const RESUMO_TITLE_ROW = 1;
const RESUMO_HEADER_ROW = 2;
const RESUMO_FIRST_DATA_ROW = 3;
const TARIFAS_FIRST_DATA_ROW = 2;
const DETAIL_FIRST_DATA_ROW = 2;

/** Coluna da Empresa na aba de detalhe — chave do SUMIFS de tarifa. */
const DETAIL_COL_EMPRESA = 'B';
/** Colunas calculadas da aba de detalhe. */
const DETAIL_COL_HORAS = 'G';
const DETAIL_COL_VALOR = 'H';

/**
 * Proteção das abas — sem senha, de propósito: é uma trava contra digitar por
 * cima de fórmula, não um cadeado. Quem realmente precisar editar remove em
 * Revisão › Desproteger Planilha, num clique.
 *
 * Motivo: na primeira rodada real o valor da hora foi digitado na coluna
 * Valor da aba do instrutor, por cima da fórmula — a planilha parou de
 * recalcular sem dar nenhum sinal. Só as células de input manual ficam
 * destravadas (`locked: false`): a coluna de tarifa na aba Tarifas e a de
 * dados bancários no Resumo.
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

/**
 * Texto usado como CRITÉRIO de SUMIFS/COUNTIFS.
 *
 * Dois escapes diferentes, pelo mesmo preço: aspas dobradas (para fechar a
 * string dentro da fórmula) e `~` antes de `*` e `?` — nesses critérios os
 * dois são CURINGAS, então um nome com asterisco casaria linhas demais e
 * somaria tarifa de outro instrutor.
 */
function criteriaText(raw: string): string {
  const escapado = String(raw ?? '')
    .replace(/~/g, '~~')
    .replace(/\*/g, '~*')
    .replace(/\?/g, '~?')
    .replace(/"/g, '""');
  return `"${escapado}"`;
}

function styleHeaderRow(row: any, lastCol: number) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  row.height = 20;
}

/** Par (instrutor, empresa) que precisa de uma tarifa preenchida. */
interface TarifaRow {
  instrutor: string;
  empresa: string;
}

/** Pares presentes no período, sem repetição, ordenados por instrutor e empresa. */
function buildTarifaRows(blocks: MedicaoInstructorBlock[]): TarifaRow[] {
  const rows: TarifaRow[] = [];
  for (const block of blocks) {
    const empresas = [...new Set(block.linhas.map(l => l.empresa))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const empresa of empresas) rows.push({ instrutor: block.nome, empresa });
  }
  return rows;
}

/**
 * Monta o workbook: Resumo, Tarifas e uma aba por instrutor.
 *
 * Toda coluna de valor é FÓRMULA. As únicas entradas manuais são a coluna
 * Hora/Aula da aba Tarifas (uma por par instrutor+empresa) e os Dados
 * Bancários no Resumo — só elas saem destravadas.
 *
 * Todas as abas saem protegidas (sem senha) — ver SHEET_PROTECTION. Os
 * cabeçalhos das colunas derivadas levam o sufixo "— automático", e as duas
 * células decisivas (tarifa em Tarifas, Valor na aba de detalhe) levam nota
 * dizendo onde preencher e onde não preencher.
 *
 * NOTA SOBRE O SEPARADOR DE ARGUMENTOS: no XML do .xlsx a fórmula é sempre
 * gravada com VÍRGULA, independentemente do idioma. É o Excel que exibe
 * ponto-e-vírgula em PT-BR na hora de abrir. Escrever ';' aqui geraria
 * fórmula inválida.
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

  /* ======================================================================== */
  /* Aba 1 — Resumo                                                           */
  /* ======================================================================== */

  const resumo = workbook.addWorksheet(RESUMO_SHEET, {
    views: [{ state: 'frozen', ySplit: RESUMO_HEADER_ROW }],
  });
  resumo.columns = [
    { width: 34 }, // A Instrutor
    { width: 26 }, // B Total de Horas — automático
    { width: 26 }, // C Total (R$) — automático
    { width: 22 }, // D Tarifas pendentes — automático
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
    'Total de Horas — automático',
    'Total (R$) — automático',
    'Tarifas pendentes — automático',
    'CPF/CNPJ',
    'Dados Bancários',
  ]);
  styleHeaderRow(resumoHeader, 6);

  resumoHeader.getCell(4).note =
    'Quantas tarifas deste instrutor ainda estão em branco na aba Tarifas.\n\n' +
    'Enquanto este número for maior que zero, o Total (R$) está incompleto: ' +
    'as demandas da empresa sem tarifa entram valendo R$ 0,00.\n\n' +
    'Confira que a coluna inteira esteja zerada antes de fechar a medição.';

  /* ======================================================================== */
  /* Aba 2 — Tarifas (a única entrada manual de valor)                        */
  /* ======================================================================== */

  const tarifaRows = buildTarifaRows(blocks);

  const tarifas = workbook.addWorksheet(TARIFAS_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  tarifas.columns = [
    { width: 34 }, // A Instrutor
    { width: 38 }, // B Empresa
    { width: 20 }, // C Hora/Aula  <- input
  ];
  const tarifasHeader = tarifas.addRow(['Instrutor', 'Empresa', 'Hora/Aula (R$)']);
  styleHeaderRow(tarifasHeader, 3);

  tarifasHeader.getCell(3).note =
    'PREENCHA AQUI.\n\n' +
    'Esta é a única coluna a preencher em toda a planilha: o valor da hora/aula ' +
    'de cada instrutor EM CADA EMPRESA, nas células amarelas abaixo.\n\n' +
    'A tarifa varia por cliente — o mesmo instrutor pode ter valores diferentes ' +
    'em empresas diferentes, e cada linha aqui é um par instrutor + empresa.\n\n' +
    'Ao preencher, o Excel recalcula sozinho a coluna Valor da aba do instrutor, ' +
    'o Total (R$) e o TOTAL GERAL do Resumo.';

  for (const { instrutor, empresa } of tarifaRows) {
    const row = tarifas.addRow([instrutor, empresa, null]);
    const tarifaCell = row.getCell(3);
    markAsInput(tarifaCell);
    tarifaCell.numFmt = FMT_MOEDA;
  }

  await tarifas.protect(undefined, SHEET_PROTECTION);

  /* ======================================================================== */
  /* Resumo — linhas por instrutor                                            */
  /* ======================================================================== */

  // Nome da aba de cada instrutor tem que existir ANTES das fórmulas do
  // Resumo — daí resolver os nomes primeiro e escrever as fórmulas depois.
  const usedSheetNames = new Set<string>([RESUMO_SHEET.toLowerCase(), TARIFAS_SHEET.toLowerCase()]);
  const planned = blocks.map((block, i) => ({
    block,
    sheetName: sanitizeSheetName(block.nome, usedSheetNames),
    resumoRow: RESUMO_FIRST_DATA_ROW + i,
  }));

  for (const { block, sheetName } of planned) {
    const lastDetailRow = DETAIL_FIRST_DATA_ROW + block.linhas.length - 1;
    const detalhe = sheetRef(sheetName);
    const nomeCriterio = criteriaText(block.nome);

    const row = resumo.addRow([block.nome, null, null, null, block.cpf || '', '']);

    // B: horas somadas da aba do instrutor (range fechado, não coluna inteira).
    const horasCell = row.getCell(2);
    horasCell.value = {
      formula: `SUM(${detalhe}!${DETAIL_COL_HORAS}${DETAIL_FIRST_DATA_ROW}:${DETAIL_COL_HORAS}${lastDetailRow})`,
    };
    horasCell.numFmt = FMT_HORAS;

    // C: o total NÃO é horas × tarifa única — cada linha da aba de detalhe já
    // aplicou a tarifa da sua empresa, então aqui é só a soma daquela coluna.
    const totalCell = row.getCell(3);
    totalCell.value = {
      formula: `SUM(${detalhe}!${DETAIL_COL_VALOR}${DETAIL_FIRST_DATA_ROW}:${DETAIL_COL_VALOR}${lastDetailRow})`,
    };
    totalCell.numFmt = FMT_MOEDA;
    totalCell.font = { bold: true };

    // D: tarifas ainda em branco deste instrutor na aba Tarifas. Sem isso, uma
    // tarifa esquecida vira R$ 0,00 no total e passa despercebida.
    const pendentesCell = row.getCell(4);
    pendentesCell.value = {
      formula: `COUNTIFS(${TARIFAS_SHEET}!$A:$A,${nomeCriterio},${TARIFAS_SHEET}!$C:$C,"")`,
    };
    pendentesCell.numFmt = '0';
    pendentesCell.alignment = { horizontal: 'center' };

    // F: sem dados bancários no cadastro de instrutor — preenchimento manual.
    markAsInput(row.getCell(6));
  }

  const lastResumoRow = RESUMO_FIRST_DATA_ROW + planned.length - 1;
  const totalGeralRow = resumo.addRow(['TOTAL GERAL', null, null, null, '', '']);
  totalGeralRow.getCell(1).font = { bold: true };
  for (const col of [2, 3, 4]) {
    const letra = String.fromCharCode(64 + col);
    const cell = totalGeralRow.getCell(col);
    cell.value = { formula: `SUM(${letra}${RESUMO_FIRST_DATA_ROW}:${letra}${lastResumoRow})` };
    cell.font = { bold: true };
  }
  totalGeralRow.getCell(2).numFmt = FMT_HORAS;
  totalGeralRow.getCell(3).numFmt = FMT_MOEDA;
  totalGeralRow.getCell(4).numFmt = '0';
  totalGeralRow.getCell(4).alignment = { horizontal: 'center' };

  await resumo.protect(undefined, SHEET_PROTECTION);

  /* ======================================================================== */
  /* Abas de detalhe — uma por instrutor                                      */
  /* ======================================================================== */

  for (const { block, sheetName } of planned) {
    const ws = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { width: 14 }, // A Código
      { width: 32 }, // B Empresa
      { width: 40 }, // C Treinamento
      { width: 26 }, // D Data
      { width: 28 }, // E Local
      { width: 18 }, // F Modalidade
      { width: 10 }, // G Horas
      { width: 26 }, // H Valor (R$) — automático
      { width: 22 }, // I Categoria (só demanda interna)
    ];
    // ⚠️ Categoria entra no FIM, depois de Valor. Empresa (B), Horas (G) e
    // Valor (H) NÃO podem mudar de letra: a fórmula de valor referencia
    // DETAIL_COL_EMPRESA/HORAS por letra, e o SUMIFS da tarifa cruza a coluna B
    // com a aba Tarifas.
    const detailHeader = ws.addRow([
      'Código', 'Empresa', 'Treinamento', 'Data', 'Local', 'Modalidade', 'Horas',
      'Valor (R$) — automático', 'Categoria',
    ]);
    styleHeaderRow(detailHeader, 9);

    // Foi exatamente aqui que o valor da hora foi digitado por cima da fórmula
    // na primeira rodada real — daí a nota, além da proteção da aba.
    detailHeader.getCell(8).note =
      'NÃO PREENCHA AQUI.\n\n' +
      'Esta coluna é calculada: horas × a tarifa da empresa desta linha.\n\n' +
      'A tarifa se preenche na aba Tarifas, na linha que cruza este instrutor ' +
      'com a empresa da coluna B.';

    const nomeCriterio = criteriaText(block.nome);

    block.linhas.forEach((linha, i) => {
      const rowIdx = DETAIL_FIRST_DATA_ROW + i;
      const row = ws.addRow([
        linha.demandId,
        linha.empresa,
        linha.trainingName,
        formatDias(linha.dias),
        linha.local,
        linha.modalidade,
        linha.horas,
        null,
        linha.categoria || null,
      ]);
      row.getCell(7).numFmt = FMT_HORAS;

      // A tarifa vem do par (instrutor, empresa DESTA LINHA): o instrutor é
      // literal (a aba é dele), a empresa é referência à coluna B, para uma
      // demanda de outro cliente na linha de baixo puxar outra tarifa.
      const valorCell = row.getCell(8);
      valorCell.value = {
        formula:
          `${DETAIL_COL_HORAS}${rowIdx}*SUMIFS(` +
          `${TARIFAS_SHEET}!$C:$C,` +
          `${TARIFAS_SHEET}!$A:$A,${nomeCriterio},` +
          `${TARIFAS_SHEET}!$B:$B,${DETAIL_COL_EMPRESA}${rowIdx})`,
      };
      valorCell.numFmt = FMT_MOEDA;
    });

    const lastDetailRow = DETAIL_FIRST_DATA_ROW + block.linhas.length - 1;
    const totalRow = ws.addRow(['', '', '', '', '', 'Total:', null, null, '']);
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).alignment = { horizontal: 'right' };
    totalRow.getCell(7).value = {
      formula: `SUM(${DETAIL_COL_HORAS}${DETAIL_FIRST_DATA_ROW}:${DETAIL_COL_HORAS}${lastDetailRow})`,
    };
    totalRow.getCell(7).numFmt = FMT_HORAS;
    totalRow.getCell(7).font = { bold: true };
    totalRow.getCell(8).value = {
      formula: `SUM(${DETAIL_COL_VALOR}${DETAIL_FIRST_DATA_ROW}:${DETAIL_COL_VALOR}${lastDetailRow})`,
    };
    totalRow.getCell(8).numFmt = FMT_MOEDA;
    totalRow.getCell(8).font = { bold: true };

    // Aba de detalhe é 100% derivada: nada aqui é de preenchimento manual.
    await ws.protect(undefined, SHEET_PROTECTION);
  }

  return workbook;
}
