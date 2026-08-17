/**
 * EXPORTAÇÃO DE MEDIÇÃO MENSAL DE INSTRUTORES (.xlsx)
 *
 * Replica a planilha manual usada para pagamento de instrutores: uma aba
 * "Resumo" (1 linha por instrutor) + 1 aba por instrutor com o detalhe das
 * demandas do mês.
 *
 * REGRA CENTRAL: o app entrega demandas e HORAS; o valor da hora/aula é
 * digitado à mão na planilha depois do export. Por isso TODA célula de valor
 * sai como FÓRMULA — nunca um número calculado aqui. O valor da hora existe
 * num único lugar (coluna B do Resumo) e as abas de detalhe o referenciam com
 * referência absoluta (`Resumo!$B$n`): preencher a célula recalcula tudo.
 *
 * As horas vêm de `computeInstructorHoursByDemand` (domain/instructorHours.ts)
 * — a mesma fonte do Dashboard, que rateia a carga pelos dias reais de cada
 * instrutor e usa `training.practical_hours` em demandas HÍBRIDAS (migration
 * 006). Nada de cálculo de horas é reimplementado aqui.
 *
 * Escopo do mês: só demandas CONCLUÍDAS, com as horas recortadas pelos dias
 * que caem dentro do mês — uma demanda que atravessa a virada do mês entra
 * proporcionalmente em cada um.
 */
import { fetchDemands } from './demands';
import { fetchInstructorAllocations } from './instructorAllocations';
import { fetchMeasurements } from './measurements';
import { fetchTrainings } from './trainings';
import { fetchInstructors } from './instructors';
import { computeInstructorHoursByDemand } from '../domain/instructorHours';
import {
  buildTrainingsById,
  getModalityLabel,
  resolveDemandModality,
} from '../domain/modalityOptions';
import { formatCPF } from '../utils/cpf';
import type {
  Demand,
  DemandStatus,
  Instructor,
  InstructorAllocation,
  Measurement,
  Training,
} from '../types';

/* ========================================================================== */
/* Tipos públicos                                                             */
/* ========================================================================== */

export interface MedicaoDetailRow {
  /** Código da demanda (DEM-xxxx). */
  demandId: string;
  trainingName: string;
  /** Dias efetivamente alocados ao instrutor dentro do mês, 'YYYY-MM-DD'. */
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

export type MedicaoExportResult =
  | { status: 'OK'; fileName: string; instrutores: number; linhas: number }
  | { status: 'VAZIO' };

/* ========================================================================== */
/* Mapeamento DB -> domínio                                                   */
/* ========================================================================== */
/* Espelha os mappers do App.tsx, restrito aos campos usados pelo cálculo de
 * horas e pelas colunas da planilha. O export não lê o contexto do React de
 * propósito: busca do banco na hora, para não depender de estado stale. */

function mapSpecificDates(raw: any): Demand['specificDates'] {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? safeParseArray(raw) : null;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  return arr.map((sd: any) => {
    if (typeof sd === 'string') {
      // Coluna text[]: pode guardar o objeto serializado ou a data pura.
      const parsed = safeParseObject(sd);
      if (parsed?.data) {
        return {
          data: String(parsed.data).slice(0, 10),
          horarioInicio: parsed.horarioInicio ?? '08:00',
          horarioFim: parsed.horarioFim ?? '18:00',
        };
      }
      return { data: sd.slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
    }
    if (sd && typeof sd === 'object') {
      return {
        data: String(sd.data ?? '').slice(0, 10),
        horarioInicio: sd.horarioInicio ?? '08:00',
        horarioFim: sd.horarioFim ?? '18:00',
      };
    }
    return { data: String(sd).slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
  });
}

function safeParseArray(raw: string): any[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeParseObject(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapDemand(row: any): Demand {
  return {
    id: row.id,
    companyId: row.company_id ?? '',
    trainingId: row.training_id ?? '',
    regionId: row.region_id ?? '',
    trainingLocal: row.training_local ?? '',
    demandState: row.demand_state ?? undefined,
    modality: row.modality ?? 'PRESENCIAL',
    dateMode: row.date_mode ?? 'CONTINUO',
    specificDates: mapSpecificDates(row.specific_dates),
    status: (row.status ?? 'NOVA') as DemandStatus,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    practiceStartDate: row.practice_start_date ?? undefined,
    practiceEndDate: row.practice_end_date ?? undefined,
    instructorId: row.instructor_id ?? undefined,
  } as Demand;
}

function mapTraining(row: any): Training {
  return {
    id: row.id,
    name: row.name ?? '',
    hours: row.hours ?? 0,
    practicalHours: row.practical_hours ?? null,
    modality: row.modality ?? 'PRESENCIAL',
    status: row.status ?? 'ATIVO',
  } as Training;
}

function mapMeasurement(row: any): Measurement {
  return {
    id: row.id,
    demandId: row.demand_id,
    status: row.status,
    expenses: { ...(row.expenses ?? {}) },
    attachments: row.attachments ?? [],
    otherExpenses: row.other_expenses ?? [],
    updatedAt: row.updated_at ?? row.created_at ?? '',
  } as Measurement;
}

function mapInstructor(row: any): Pick<Instructor, 'id' | 'name' | 'cpf'> {
  return {
    id: row.id,
    name: row.full_name ?? '(sem nome)',
    cpf: row.cpf ?? undefined,
  };
}

function mapAllocation(row: any): InstructorAllocation {
  return {
    id: row.id,
    demandId: row.demand_id,
    instructorId: row.instructor_id,
    startDate: row.start_date,
    endDate: row.end_date,
  };
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

/* ========================================================================== */
/* Busca + montagem dos dados                                                 */
/* ========================================================================== */

/**
 * Busca tudo que a medição do mês precisa e devolve um bloco por instrutor
 * com alocação no período (ordenado por nome).
 *
 * Toda a busca passa pelos services existentes, que paginam via
 * `fetchAllPaginated` (.range() em lote de 1000 até esgotar) e propagam erro
 * — `demands`, `instructor_allocations` e `measurements` já estouram ou estão
 * perto de estourar o corte silencioso de 1000 linhas do PostgREST.
 */
export async function fetchMedicaoData(year: number, month: number): Promise<MedicaoInstructorBlock[]> {
  const [demandRows, allocationRows, measurementRows, trainingRows, instructorRows] = await Promise.all([
    fetchDemands(),
    fetchInstructorAllocations(),
    fetchMeasurements(),
    fetchTrainings(),
    fetchInstructors(),
  ]);

  const demands = (demandRows ?? []).map(mapDemand);
  const instructorAllocations = (allocationRows ?? []).map(mapAllocation);
  const measurements = (measurementRows ?? []).map(mapMeasurement);
  const trainings = (trainingRows ?? []).map(mapTraining);
  const instructors = (instructorRows ?? []).map(mapInstructor);

  const { start, end } = monthBounds(year, month);

  const hoursRows = computeInstructorHoursByDemand({
    demands,
    instructorAllocations,
    trainings,
    measurements,
    periodStart: start,
    periodEnd: end,
  });

  const demandsById = new Map(demands.map(d => [d.id, d]));
  const trainingsById = buildTrainingsById(trainings);
  const trainingNameById = new Map(trainings.map(t => [String(t.id), t.name]));
  const instructorsById = new Map(instructors.map(i => [i.id, i]));

  const blocks = new Map<string, MedicaoInstructorBlock>();

  for (const row of hoursRows) {
    const demand = demandsById.get(row.demandId);
    if (!demand) continue;

    let block = blocks.get(row.instructorId);
    if (!block) {
      const instructor = instructorsById.get(row.instructorId);
      block = {
        instructorId: row.instructorId,
        nome: instructor?.name ?? `Instrutor ${row.instructorId}`,
        cpf: instructor?.cpf ? formatCPF(instructor.cpf) : '',
        linhas: [],
      };
      blocks.set(row.instructorId, block);
    }

    const local = [demand.trainingLocal, demand.demandState].filter(Boolean).join(' - ');

    block.linhas.push({
      demandId: demand.id,
      trainingName: trainingNameById.get(String(demand.trainingId)) ?? '—',
      dias: row.dias,
      local: local || '—',
      modalidade: getModalityLabel(resolveDemandModality(demand, trainingsById)),
      // 2 casas: mesmo arredondamento do export do Dashboard, evita ruído de float.
      horas: Math.round((row.horas + Number.EPSILON) * 100) / 100,
    });
  }

  const result = [...blocks.values()];
  for (const block of result) {
    block.linhas.sort((a, b) => (a.dias[0] ?? '').localeCompare(b.dias[0] ?? '') || a.demandId.localeCompare(b.demandId));
  }
  result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return result;
}

/* ========================================================================== */
/* Workbook                                                                   */
/* ========================================================================== */

const HEADER_FILL = 'FF1E293B';
const INPUT_FILL = 'FFFFFF00'; // amarelo: célula de preenchimento manual
const FMT_HORAS = '0.0';
const FMT_MOEDA = '"R$" #,##0.00';

const RESUMO_SHEET = 'Resumo';
/** Linha 1 = cabeçalho; dados começam na 2 (Resumo e abas de detalhe). */
const FIRST_DATA_ROW = 2;

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
export async function buildMedicaoWorkbook(blocks: MedicaoInstructorBlock[], year: number, month: number) {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestão Colabor';
  workbook.created = new Date();
  workbook.title = `Medição de Instrutores ${String(month).padStart(2, '0')}/${year}`;

  const resumo = workbook.addWorksheet(RESUMO_SHEET, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  resumo.columns = [
    { width: 34 }, // A Instrutor
    { width: 18 }, // B Hora/Aula  <- único input
    { width: 26 }, // C Total de Horas — automático
    { width: 26 }, // D Total (R$) — automático
    { width: 20 }, // E CPF/CNPJ
    { width: 50 }, // F Dados Bancários
  ];
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
    resumoRow: FIRST_DATA_ROW + i,
  }));

  for (const { block, sheetName, resumoRow } of planned) {
    const lastDetailRow = FIRST_DATA_ROW + block.linhas.length - 1;

    const row = resumo.addRow([block.nome, null, null, null, block.cpf || '', '']);

    // B: única entrada numérica manual da planilha inteira.
    const rateCell = row.getCell(2);
    markAsInput(rateCell);
    rateCell.numFmt = FMT_MOEDA;

    // C: soma das horas da aba do instrutor (range fechado, não coluna inteira).
    const horasCell = row.getCell(3);
    horasCell.value = { formula: `SUM(${sheetRef(sheetName)}!F${FIRST_DATA_ROW}:F${lastDetailRow})` };
    horasCell.numFmt = FMT_HORAS;

    const totalCell = row.getCell(4);
    totalCell.value = { formula: `B${resumoRow}*C${resumoRow}` };
    totalCell.numFmt = FMT_MOEDA;
    totalCell.font = { bold: true };

    // F: sem dados bancários no cadastro de instrutor — preenchimento manual.
    markAsInput(row.getCell(6));
  }

  const lastResumoRow = FIRST_DATA_ROW + planned.length - 1;
  const totalGeralRow = resumo.addRow(['TOTAL GERAL', null, null, null, '', '']);
  totalGeralRow.getCell(1).font = { bold: true };
  totalGeralRow.getCell(3).value = { formula: `SUM(C${FIRST_DATA_ROW}:C${lastResumoRow})` };
  totalGeralRow.getCell(3).numFmt = FMT_HORAS;
  totalGeralRow.getCell(3).font = { bold: true };
  totalGeralRow.getCell(4).value = { formula: `SUM(D${FIRST_DATA_ROW}:D${lastResumoRow})` };
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
      const rowIdx = FIRST_DATA_ROW + i;
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

    const lastDetailRow = FIRST_DATA_ROW + block.linhas.length - 1;
    const totalRow = ws.addRow(['', '', '', '', 'Total:', null, null]);
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: 'right' };
    totalRow.getCell(6).value = { formula: `SUM(F${FIRST_DATA_ROW}:F${lastDetailRow})` };
    totalRow.getCell(6).numFmt = FMT_HORAS;
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(7).value = { formula: `SUM(G${FIRST_DATA_ROW}:G${lastDetailRow})` };
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

function triggerDownload(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Ponta a ponta: busca o mês, monta o workbook e dispara o download.
 * Mês sem nenhuma alocação devolve `{ status: 'VAZIO' }` e NÃO gera arquivo.
 * Falha de busca propaga o erro (nada de array vazio silencioso).
 */
export async function exportMedicaoMensal(year: number, month: number): Promise<MedicaoExportResult> {
  const blocks = await fetchMedicaoData(year, month);
  if (blocks.length === 0) return { status: 'VAZIO' };

  const workbook = await buildMedicaoWorkbook(blocks, year, month);
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

  const fileName = `Medicao_Instrutores_${String(month).padStart(2, '0')}-${year}.xlsx`;
  triggerDownload(buffer, fileName);

  return {
    status: 'OK',
    fileName,
    instrutores: blocks.length,
    linhas: blocks.reduce((acc, b) => acc + b.linhas.length, 0),
  };
}
