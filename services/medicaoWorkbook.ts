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
 * digitado à mão na planilha depois do export. Por isso TODA célula de
 * hora/aula e de total sai como FÓRMULA — nunca um número calculado aqui.
 *
 * A tarifa varia por EMPRESA, não por instrutor: o mesmo instrutor recebe um
 * valor/hora na Vale e outro em outro cliente. Por isso as tarifas moram numa
 * aba própria ("Tarifas"), uma linha por par (instrutor, empresa), e a coluna
 * Hora/aula de cada aba de detalhe busca a tarifa por SUMIFS cruzando o nome
 * do instrutor com a empresa da PRÓPRIA LINHA. Preencher uma célula da aba
 * Tarifas recalcula todas as linhas daquele par.
 *
 * DESPESAS: as quatro colunas de despesa da aba do instrutor são NÚMEROS (fatos
 * da medição, não tarifa) e trazem SÓ o que a Colabor deve ao instrutor — os
 * itens marcados como "pago pelo instrutor" no painel. Despesa paga pela
 * Colabor não aparece na aba dele. `Total despesas`, `Hora/aula` e `Total` da
 * linha são fórmulas, e os totais usam SUM (nunca `+`): a linha do acompanhante
 * sem horas informadas tem TEXTO na célula de hora/aula, e `+` daria #VALUE!.
 *
 * ACOMPANHANTE SEM HORAS: aparece com Horas em branco, destravada e amarela
 * (a única entrada manual da aba de detalhe), hora/aula = "horas não
 * informadas" até alguém digitar, e as despesas dele. Nunca 0 silencioso.
 */

import type { MedicaoReembolso, MotivoSemHoras } from '../domain/paymentRows';

/* ========================================================================== */
/* Tipos públicos                                                             */
/* ========================================================================== */

export type { MedicaoReembolso, MotivoSemHoras } from '../domain/paymentRows';

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
  /**
   * `null` = NINGUÉM INFORMOU (acompanhante sem horas digitadas). A célula sai
   * vazia, destravada e amarela, e o hora/aula da linha mostra o texto "horas
   * não informadas" até alguém preencher. Nunca 0: zero aqui seria pagamento
   * zerado em silêncio.
   */
  horas: number | null;
  /** `false` quando `horas` é `null`. Redundante de propósito: é o que o reconcile lê. */
  horasInformadas: boolean;
  /**
   * Por que está sem horas — decide o texto da célula de hora/aula.
   * Ausente com `horasInformadas: false` = 'ACOMPANHANTE' (compatibilidade).
   */
  motivoSemHoras?: MotivoSemHoras;
  /**
   * Despesas que a Colabor deve a ESTE instrutor nesta demanda: só os itens
   * marcados como "pago pelo instrutor" na medição (domain/paymentRows.ts).
   * Despesa paga pela Colabor não aparece na aba dele.
   */
  reembolso: MedicaoReembolso;
  /**
   * Categoria da demanda INTERNA (SIPAT, Visita, Apoio Logístico...). Vazia em
   * demanda de cliente, que já é identificada por empresa + treinamento.
   * Informativa: não entra em fórmula.
   */
  categoria: string;
  /**
   * CHAVE DE TARIFA. Demanda interna vale menos que treinamento, então o par
   * (instrutor, empresa) não basta para achar a hora/aula.
   */
  tipo: TarifaTipo;
  /**
   * CHAVE DE TARIFA. Hora noturna vale mais. Regra em domain/demandDays
   * (isNightDemand): fim >= 19:00 ou o turno vira o dia.
   */
  noturno: boolean;
  /**
   * CHAVE DE TARIFA (F3, decisão D4). Acompanhante não ministra: a hora dele
   * vale outra coisa, e sem este eixo a mesma pessoa na mesma empresa teria de
   * ter uma tarifa só para os dois papéis.
   *
   * OBRIGATÓRIO de propósito, e não opcional com default: chave de SUMIFS que
   * pode sair vazia zera o valor em silêncio — é a mesma classe do 'Não'
   * literal da coluna Noturno, que já custou uma rodada de medição.
   */
  papel: TarifaPapel;
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
// diante. Tarifas não tem título: cabeçalho na 1, dados na 2.
const RESUMO_TITLE_ROW = 1;
const RESUMO_HEADER_ROW = 2;
const RESUMO_FIRST_DATA_ROW = 3;
const TARIFAS_FIRST_DATA_ROW = 2;

// Aba do instrutor, no formato da planilha manual da Colabor: linha 1 = nome,
// linha 2 = CPF/CNPJ e dados bancários (por fórmula, do Resumo), linha 3 =
// cabeçalho das colunas, dados da 4 em diante. Congelada até a 3.
const DETAIL_NAME_ROW = 1;
const DETAIL_INFO_ROW = 2;
const DETAIL_HEADER_ROW = 3;
const DETAIL_FIRST_DATA_ROW = 4;

/**
 * Colunas da aba de detalhe. As despesas entram ANTES das horas, na ordem do
 * painel (Hospedagem · Transporte · Alimentação · Outros · Total despesas); as
 * chaves de tarifa (Tipo, Noturno, Papel) e a Categoria informativa ficam no
 * fim. Toda fórmula referencia estas constantes — mudar uma letra aqui move a
 * coluna inteira sem quebrar SUM/SUMIFS.
 */
const DETAIL_COL_EMPRESA = 'B';      // <- chave de tarifa
const DETAIL_COL_HOSPEDAGEM = 'G';
const DETAIL_COL_LOCOMOCAO = 'H';
const DETAIL_COL_ALIMENTACAO = 'I';
const DETAIL_COL_OUTROS = 'J';
const DETAIL_COL_DESPESAS = 'K';     // = SUM(G:J) da linha
const DETAIL_COL_HORAS = 'L';        // <- multiplicador (em branco/amarela no acompanhante sem horas)
const DETAIL_COL_HORA_AULA = 'M';    // = L × tarifa (SUMIFS)
const DETAIL_COL_TOTAL = 'N';        // = SUM(K, M)
const DETAIL_COL_TIPO = 'O';         // <- chave de tarifa
const DETAIL_COL_NOTURNO = 'Q';      // <- chave de tarifa
const DETAIL_COL_PAPEL = 'R';        // <- chave de tarifa
const DETAIL_LAST_COL_IDX = 18;      // R
/** Índices 1-based das colunas que recebem fórmula ou número na linha de dados. */
const DETAIL_IDX = {
  hospedagem: 7, locomocao: 8, alimentacao: 9, outros: 10, despesas: 11,
  horas: 12, horaAula: 13, total: 14,
} as const;

/** Textos que a célula de hora/aula mostra enquanto Horas estiver em branco. */
export const HORAS_NAO_INFORMADAS = 'horas não informadas';
export const HIBRIDA_SEM_HORAS = 'híbrida: informe as horas presenciais realizadas';
const textoSemHoras = (motivo: MotivoSemHoras | undefined) =>
  motivo === 'HIBRIDA' ? HIBRIDA_SEM_HORAS : HORAS_NAO_INFORMADAS;

/** Colunas do Resumo (1-based). */
const RESUMO_IDX = {
  instrutor: 1, horas: 2, horaAula: 3, reembolso: 4, totalPagar: 5, pendentes: 6, horasPendentes: 7, cpf: 8, banco: 9,
} as const;
const RESUMO_COL_BANCO = 'I';
const RESUMO_LAST_COL_IDX = 9;

/**
 * Colunas da aba Tarifas. A tarifa deixou de ser uma por (instrutor, empresa):
 * hora noturna vale mais e demanda interna vale menos, então o mesmo par pode
 * precisar de três valores diferentes (diurno, noturno, interna). As quatro
 * primeiras colunas são a CHAVE; só a última é digitada.
 */
const TARIFA_COL_INSTRUTOR = 'A';
const TARIFA_COL_EMPRESA = 'B';
const TARIFA_COL_TIPO = 'C';
const TARIFA_COL_NOTURNO = 'D';
const TARIFA_COL_PAPEL = 'E';
const TARIFA_COL_VALOR = 'F';
/** Índice 1-based da coluna digitável, para markAsInput. */
const TARIFA_VALOR_IDX = 6;

/**
 * Rótulos que aparecem NA PLANILHA e são comparados literalmente pelo SUMIFS —
 * mudar qualquer um destes quebra o casamento entre detalhe e Tarifas.
 */
export type TarifaTipo = 'Treinamento' | 'Interna';
/**
 * Rótulos do papel na planilha. Só ACOMPANHANTE se separa: participante de
 * interna ministra a demanda (a F1 o definiu como titular pleno) e entra como
 * 'Titular', o que mantém a tarifa das internas exatamente onde estava.
 */
export type TarifaPapel = 'Titular' | 'Acompanhante';
const NOTURNO_SIM = 'Sim';
/**
 * Diurno é 'Não' LITERAL, nunca célula vazia.
 *
 * Já foi '' e isso zerava toda linha diurna em silêncio. Vazio não sobrevive à
 * ida e volta pelo arquivo: na aba Tarifas o '' virava uma célula de TEXTO
 * vazio (t="s" apontando para uma sharedString em branco), enquanto na aba de
 * detalhe a mesma coluna saía como célula AUSENTE do XML. O SUMIFS compara os
 * dois lados e o Excel, ao receber célula vazia como CRITÉRIO, converte o
 * critério para o número 0 — que não casa com texto vazio. Resultado:
 * Valor = R$ 0,00 com a tarifa preenchida do lado de lá.
 *
 * Rótulo não-vazio dos dois lados mata a classe inteira do problema, e é o
 * mesmo padrão da coluna Tipo ('Treinamento'/'Interna'), que nunca falhou.
 */
const NOTURNO_NAO = 'Não';
const noturnoLabel = (noturno: boolean) => (noturno ? NOTURNO_SIM : NOTURNO_NAO);

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

/** Combinação que precisa de uma tarifa preenchida. */
interface TarifaRow {
  instrutor: string;
  empresa: string;
  tipo: TarifaTipo;
  noturno: boolean;
  papel: TarifaPapel;
}

/**
 * Uma linha por combinação (instrutor, empresa, tipo, noturno) que EXISTE nas
 * demandas do período.
 *
 * Deliberadamente NÃO é produto cartesiano: gerar todas as combinações
 * possíveis encheria a aba de linhas que ninguém precisa preencher e inflaria
 * o contador de "Tarifas pendentes" do Resumo com pendência fantasma. Instrutor
 * que só teve treinamento diurno numa empresa continua vendo uma linha só.
 */
function buildTarifaRows(blocks: MedicaoInstructorBlock[]): TarifaRow[] {
  const rows: TarifaRow[] = [];
  for (const block of blocks) {
    const vistas = new Map<string, TarifaRow>();
    for (const linha of block.linhas) {
      const chave = [linha.empresa, linha.tipo, linha.noturno ? '1' : '0', linha.papel].join('\u0000');
      if (!vistas.has(chave)) {
        vistas.set(chave, {
          instrutor: block.nome,
          empresa: linha.empresa,
          tipo: linha.tipo,
          noturno: linha.noturno,
          papel: linha.papel,
        });
      }
    }
    rows.push(
      ...[...vistas.values()].sort(
        (a, b) =>
          a.empresa.localeCompare(b.empresa, 'pt-BR') ||
          a.tipo.localeCompare(b.tipo, 'pt-BR') ||
          Number(a.noturno) - Number(b.noturno) ||
          a.papel.localeCompare(b.papel, 'pt-BR')
      )
    );
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
    { width: 24 }, // B Total de Horas — automático
    { width: 24 }, // C Hora/aula (R$) — automático
    { width: 30 }, // D Despesas a reembolsar (R$) — automático
    { width: 26 }, // E Total a pagar (R$) — automático
    { width: 26 }, // F Tarifas pendentes — automático
    { width: 24 }, // G Horas pendentes — automático
    { width: 20 }, // H CPF/CNPJ
    { width: 50 }, // I Dados Bancários
  ];

  // Título: o período tem que viajar DENTRO do arquivo. O nome do arquivo se
  // perde assim que alguém renomeia ou encaminha a planilha.
  const titleRow = resumo.addRow([`MEDIÇÃO DE INSTRUTORES — ${periodo.label}`]);
  resumo.mergeCells(RESUMO_TITLE_ROW, 1, RESUMO_TITLE_ROW, RESUMO_LAST_COL_IDX);
  titleRow.getCell(1).font = { bold: true, size: 13 };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  titleRow.height = 26;

  const resumoHeader = resumo.addRow([
    'Instrutor',
    'Total de Horas — automático',
    'Hora/aula (R$) — automático',
    'Despesas a reembolsar (R$) — automático',
    'Total a pagar (R$) — automático',
    'Tarifas pendentes — automático',
    'Horas pendentes — automático',
    'CPF/CNPJ',
    'Dados Bancários',
  ]);
  styleHeaderRow(resumoHeader, RESUMO_LAST_COL_IDX);

  resumoHeader.getCell(RESUMO_IDX.horasPendentes).note =
    'Quantas linhas da aba deste instrutor estão com Horas em branco (célula ' +
    'amarela): acompanhante sem horas informadas ou demanda híbrida sem as ' +
    'horas presenciais digitadas na medição. Enquanto for maior que zero, o ' +
    'Hora/aula e o Total a pagar estão incompletos. Preencha na aba (ou na ' +
    'medição e exporte de novo).';

  resumoHeader.getCell(RESUMO_IDX.reembolso).note =
    'Despesas que a Colabor deve a este instrutor: só os itens marcados como ' +
    '"Pago pelo instrutor" na medição. Despesa paga pela Colabor não entra aqui. ' +
    'É a soma da coluna Total despesas da aba dele.';
  resumoHeader.getCell(RESUMO_IDX.totalPagar).note =
    'Hora/aula + Despesas a reembolsar — a soma da coluna Total da aba do instrutor.';
  resumoHeader.getCell(RESUMO_IDX.pendentes).note =
    'Quantas tarifas deste instrutor ainda estão em branco na aba Tarifas.\n\n' +
    'Enquanto este número for maior que zero, o Hora/aula (R$) está incompleto: ' +
    'as demandas da empresa sem tarifa entram valendo R$ 0,00. Um acompanhante ' +
    'sem horas informadas também conta aqui: a tarifa dele existe na aba Tarifas ' +
    'para o valor calcular assim que alguém preencher as horas.\n\n' +
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
    { width: 16 }, // C Tipo      <- chave
    { width: 12 }, // D Noturno   <- chave
    { width: 16 }, // E Papel     <- chave
    { width: 20 }, // F Hora/Aula <- input
  ];
  const tarifasHeader = tarifas.addRow(['Instrutor', 'Empresa', 'Tipo', 'Noturno', 'Papel', 'Hora/Aula (R$)']);
  styleHeaderRow(tarifasHeader, TARIFA_VALOR_IDX);

  tarifasHeader.getCell(TARIFA_VALOR_IDX).note =
    'PREENCHA AQUI.\n\n' +
    'Esta é a única coluna a preencher em toda a planilha: o valor da hora/aula ' +
    'de cada linha, nas células amarelas abaixo.\n\n' +
    'Cada linha é uma combinação de instrutor + empresa + tipo + noturno + papel, ' +
    'porque a tarifa muda nos quatro eixos: por cliente, entre treinamento e ' +
    'demanda interna, entre hora diurna e noturna, e entre quem ministra e quem ' +
    'acompanha. O mesmo instrutor na mesma empresa pode aparecer em mais de uma ' +
    'linha — preencha todas.\n\n' +
    'Tipo: "Treinamento" ou "Interna". Noturno: "Sim" quando o turno termina ' +
    '19:00 ou mais tarde (ou vira o dia); "Não" quando é diurno. Papel: ' +
    '"Titular" para quem ministra (inclusive o participante de demanda interna) ' +
    'e "Acompanhante" para quem acompanha sem ministrar.\n\n' +
    'Ao preencher, o Excel recalcula sozinho a coluna Valor da aba do instrutor, ' +
    'o Total (R$) e o TOTAL GERAL do Resumo.';

  for (const { instrutor, empresa, tipo, noturno, papel } of tarifaRows) {
    const row = tarifas.addRow([instrutor, empresa, tipo, noturnoLabel(noturno), papel, null]);
    const tarifaCell = row.getCell(TARIFA_VALOR_IDX);
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
    // Soma de uma coluna da aba do instrutor: range FECHADO (não coluna
    // inteira). SUM ignora texto, então a linha de "horas não informadas" e a
    // linha de total não contaminam nada.
    const somaDaAba = (col: string) =>
      `SUM(${detalhe}!${col}${DETAIL_FIRST_DATA_ROW}:${col}${lastDetailRow})`;

    const row = resumo.addRow([block.nome, null, null, null, null, null, null, block.cpf || '', '']);

    // B: horas somadas da aba do instrutor.
    const horasCell = row.getCell(RESUMO_IDX.horas);
    horasCell.value = { formula: somaDaAba(DETAIL_COL_HORAS) };
    horasCell.numFmt = FMT_HORAS;

    // C: o hora/aula NÃO é horas × tarifa única — cada linha da aba de detalhe
    // já aplicou a tarifa da sua empresa, então aqui é só a soma daquela coluna.
    const horaAulaCell = row.getCell(RESUMO_IDX.horaAula);
    horaAulaCell.value = { formula: somaDaAba(DETAIL_COL_HORA_AULA) };
    horaAulaCell.numFmt = FMT_MOEDA;

    // D: despesas a reembolsar = Σ Total despesas da aba (só o pago pelo instrutor).
    const reembolsoCell = row.getCell(RESUMO_IDX.reembolso);
    reembolsoCell.value = { formula: somaDaAba(DETAIL_COL_DESPESAS) };
    reembolsoCell.numFmt = FMT_MOEDA;

    // E: total a pagar = Σ Total da aba (que já é SUM(despesas, hora/aula) por linha).
    const totalCell = row.getCell(RESUMO_IDX.totalPagar);
    totalCell.value = { formula: somaDaAba(DETAIL_COL_TOTAL) };
    totalCell.numFmt = FMT_MOEDA;
    totalCell.font = { bold: true };

    // F: tarifas ainda em branco deste instrutor na aba Tarifas. Sem isso, uma
    // tarifa esquecida vira R$ 0,00 no total e passa despercebida. Conta a
    // coluna do VALOR, que mudou de letra ao entrarem Tipo e Noturno.
    const pendentesCell = row.getCell(RESUMO_IDX.pendentes);
    pendentesCell.value = {
      formula:
        `COUNTIFS(` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_INSTRUTOR}:$${TARIFA_COL_INSTRUTOR},${nomeCriterio},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_VALOR}:$${TARIFA_COL_VALOR},"")`,
    };
    pendentesCell.numFmt = '0';
    pendentesCell.alignment = { horizontal: 'center' };

    // G: linhas da aba com Horas em branco (acompanhante sem horas, híbrida sem
    // horas presenciais). COUNTIF(...,"") conta célula vazia — é o que a célula
    // amarela é até alguém digitar.
    const horasPendentesCell = row.getCell(RESUMO_IDX.horasPendentes);
    horasPendentesCell.value = {
      formula: `COUNTIF(${detalhe}!${DETAIL_COL_HORAS}${DETAIL_FIRST_DATA_ROW}:${DETAIL_COL_HORAS}${lastDetailRow},"")`,
    };
    horasPendentesCell.numFmt = '0';
    horasPendentesCell.alignment = { horizontal: 'center' };

    // I: sem dados bancários no cadastro de instrutor — preenchimento manual.
    // A aba do instrutor lê esta célula por fórmula (linha 2): digita-se uma vez.
    markAsInput(row.getCell(RESUMO_IDX.banco));
  }

  const lastResumoRow = RESUMO_FIRST_DATA_ROW + planned.length - 1;
  const totalGeralRow = resumo.addRow(['TOTAL GERAL', null, null, null, null, null, null, '', '']);
  totalGeralRow.getCell(1).font = { bold: true };
  for (const col of [RESUMO_IDX.horas, RESUMO_IDX.horaAula, RESUMO_IDX.reembolso, RESUMO_IDX.totalPagar, RESUMO_IDX.pendentes, RESUMO_IDX.horasPendentes]) {
    const letra = String.fromCharCode(64 + col);
    const cell = totalGeralRow.getCell(col);
    cell.value = { formula: `SUM(${letra}${RESUMO_FIRST_DATA_ROW}:${letra}${lastResumoRow})` };
    cell.font = { bold: true };
  }
  totalGeralRow.getCell(RESUMO_IDX.horas).numFmt = FMT_HORAS;
  totalGeralRow.getCell(RESUMO_IDX.horaAula).numFmt = FMT_MOEDA;
  totalGeralRow.getCell(RESUMO_IDX.reembolso).numFmt = FMT_MOEDA;
  totalGeralRow.getCell(RESUMO_IDX.totalPagar).numFmt = FMT_MOEDA;
  totalGeralRow.getCell(RESUMO_IDX.pendentes).numFmt = '0';
  totalGeralRow.getCell(RESUMO_IDX.pendentes).alignment = { horizontal: 'center' };
  totalGeralRow.getCell(RESUMO_IDX.horasPendentes).numFmt = '0';
  totalGeralRow.getCell(RESUMO_IDX.horasPendentes).alignment = { horizontal: 'center' };

  await resumo.protect(undefined, SHEET_PROTECTION);

  /* ======================================================================== */
  /* Abas de detalhe — uma por instrutor                                      */
  /* ======================================================================== */

  for (const { block, sheetName, resumoRow } of planned) {
    const ws = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: DETAIL_HEADER_ROW }] });
    ws.columns = [
      { width: 14 }, // A Código
      { width: 32 }, // B Empresa            <- chave de tarifa
      { width: 40 }, // C Treinamento
      { width: 26 }, // D Data
      { width: 28 }, // E Local
      { width: 18 }, // F Modalidade
      { width: 16 }, // G Hospedagem
      { width: 22 }, // H Transporte (Locomoção)
      { width: 16 }, // I Alimentação
      { width: 14 }, // J Outros
      { width: 26 }, // K Total despesas — automático
      { width: 10 }, // L Horas              <- multiplicador
      { width: 26 }, // M Hora/aula (R$) — automático
      { width: 24 }, // N Total (R$) — automático
      { width: 16 }, // O Tipo               <- chave de tarifa
      { width: 22 }, // P Categoria          (informativa)
      { width: 12 }, // Q Noturno            <- chave de tarifa
      { width: 16 }, // R Papel              <- chave de tarifa
    ];

    // Linha 1: nome. Linha 2: CPF/CNPJ (cadastro) e dados bancários — estes por
    // FÓRMULA a partir do Resumo, para serem digitados uma vez só. O IF evita o
    // 0 que uma referência a célula vazia mostraria.
    const nameRow = ws.addRow([block.nome]);
    ws.mergeCells(DETAIL_NAME_ROW, 1, DETAIL_NAME_ROW, 6);
    nameRow.getCell(1).font = { bold: true, size: 13 };
    nameRow.height = 24;

    const infoRow = ws.addRow(['CPF/CNPJ', block.cpf || '', 'Dados bancários', null]);
    ws.mergeCells(DETAIL_INFO_ROW, 4, DETAIL_INFO_ROW, 8);
    infoRow.getCell(1).font = { bold: true, color: { argb: 'FF64748B' } };
    infoRow.getCell(3).font = { bold: true, color: { argb: 'FF64748B' } };
    const bancoRef = `${RESUMO_SHEET}!${RESUMO_COL_BANCO}${resumoRow}`;
    infoRow.getCell(4).value = { formula: `IF(${bancoRef}="","",${bancoRef})` };

    // O (Tipo), Q (Noturno) e R (Papel) são CHAVE de fórmula — o SUMIFS da
    // tarifa cruza as três com a aba Tarifas. P (Categoria) é só informativa.
    const detailHeader = ws.addRow([
      'Código', 'Empresa', 'Treinamento', 'Data', 'Local', 'Modalidade',
      'Hospedagem', 'Transporte (Locomoção)', 'Alimentação', 'Outros', 'Total despesas — automático',
      'Horas', 'Hora/aula (R$) — automático', 'Total (R$) — automático',
      'Tipo', 'Categoria', 'Noturno', 'Papel',
    ]);
    styleHeaderRow(detailHeader, DETAIL_LAST_COL_IDX);

    detailHeader.getCell(DETAIL_IDX.despesas).note =
      'Só o que a Colabor deve a este instrutor: itens marcados como "Pago pelo ' +
      'instrutor" na medição, nas quatro colunas à esquerda. Despesa paga pela ' +
      'Colabor não aparece nesta aba.';
    // Foi exatamente aqui que o valor da hora foi digitado por cima da fórmula
    // na primeira rodada real — daí a nota, além da proteção da aba.
    detailHeader.getCell(DETAIL_IDX.horaAula).note =
      'NÃO PREENCHA AQUI.\n\n' +
      'Esta coluna é calculada: horas × a tarifa desta linha.\n\n' +
      'A tarifa se preenche na aba Tarifas, na linha que cruza este instrutor ' +
      `com a empresa da coluna ${DETAIL_COL_EMPRESA}, o tipo da coluna ${DETAIL_COL_TIPO}, ` +
      `o noturno da coluna ${DETAIL_COL_NOTURNO} e o papel da coluna ${DETAIL_COL_PAPEL}.\n\n` +
      `"${HORAS_NAO_INFORMADAS}" = acompanhante sem horas na medição; ` +
      `"${HIBRIDA_SEM_HORAS}" = demanda híbrida sem as horas presenciais digitadas. ` +
      'Nos dois casos, preencha a célula amarela de Horas (ou informe na medição e exporte de novo).';
    detailHeader.getCell(DETAIL_IDX.total).note = 'Total despesas + Hora/aula desta linha.';

    const nomeCriterio = criteriaText(block.nome);

    block.linhas.forEach((linha, i) => {
      const rowIdx = DETAIL_FIRST_DATA_ROW + i;
      const r = linha.reembolso;
      const row = ws.addRow([
        linha.demandId,
        linha.empresa,
        linha.trainingName,
        formatDias(linha.dias),
        linha.local,
        linha.modalidade,
        r.hospedagem,
        r.locomocao,
        r.alimentacao,
        r.outros,
        null, // K Total despesas (fórmula)
        linha.horasInformadas ? linha.horas : null,
        null, // M Hora/aula (fórmula)
        null, // N Total (fórmula)
        linha.tipo,
        linha.categoria || null,
        noturnoLabel(linha.noturno),
        linha.papel,
      ]);
      for (const idx of [DETAIL_IDX.hospedagem, DETAIL_IDX.locomocao, DETAIL_IDX.alimentacao, DETAIL_IDX.outros]) {
        row.getCell(idx).numFmt = FMT_MOEDA;
      }

      // K: total das despesas da linha.
      const despesasCell = row.getCell(DETAIL_IDX.despesas);
      despesasCell.value = { formula: `SUM(${DETAIL_COL_HOSPEDAGEM}${rowIdx}:${DETAIL_COL_OUTROS}${rowIdx})` };
      despesasCell.numFmt = FMT_MOEDA;

      // L: horas. Acompanhante sem horas informadas: em branco, destravada e
      // amarela — a única entrada manual desta aba, e sinalizada como tal.
      const horasCell = row.getCell(DETAIL_IDX.horas);
      horasCell.numFmt = FMT_HORAS;
      if (!linha.horasInformadas) {
        markAsInput(horasCell);
        horasCell.note = linha.motivoSemHoras === 'HIBRIDA'
          ? 'Demanda híbrida sem as horas presenciais informadas na medição. A carga ' +
            'do treinamento é a TOTAL (EAD + prática) e o split varia por demanda — a ' +
            'planilha não inventa. Preencha aqui as horas presenciais realizadas, ou ' +
            'informe na medição e exporte de novo.'
          : 'Acompanhante sem horas informadas na medição. Ninguém sabe quantas horas ' +
            'ele fez, só quantos dias acompanhou — a planilha não inventa. Preencha ' +
            'aqui, ou informe na medição e exporte de novo.';
      }

      // M: a tarifa vem da combinação DESTA LINHA: o instrutor é literal (a aba
      // é dele) e empresa/tipo/noturno/papel são referências às próprias
      // colunas, para a linha de baixo — outro cliente, ou a mesma empresa em
      // turno noturno — puxar outra tarifa.
      const horasVezesTarifa =
        `${DETAIL_COL_HORAS}${rowIdx}*SUMIFS(` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_VALOR}:$${TARIFA_COL_VALOR},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_INSTRUTOR}:$${TARIFA_COL_INSTRUTOR},${nomeCriterio},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_EMPRESA}:$${TARIFA_COL_EMPRESA},${DETAIL_COL_EMPRESA}${rowIdx},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_TIPO}:$${TARIFA_COL_TIPO},${DETAIL_COL_TIPO}${rowIdx},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_NOTURNO}:$${TARIFA_COL_NOTURNO},${DETAIL_COL_NOTURNO}${rowIdx},` +
        `${TARIFAS_SHEET}!$${TARIFA_COL_PAPEL}:$${TARIFA_COL_PAPEL},${DETAIL_COL_PAPEL}${rowIdx})`;
      const horaAulaCell = row.getCell(DETAIL_IDX.horaAula);
      horaAulaCell.value = {
        // Sem horas: TEXTO visível até alguém digitar — e some sozinho quando
        // digitarem, porque a fórmula continua lá. Só nesta linha: as demais
        // mantêm a fórmula de sempre.
        formula: linha.horasInformadas
          ? horasVezesTarifa
          : `IF(${DETAIL_COL_HORAS}${rowIdx}="","${textoSemHoras(linha.motivoSemHoras)}",${horasVezesTarifa})`,
      };
      horaAulaCell.numFmt = FMT_MOEDA;

      // N: SUM, nunca `+` — se M for o texto acima, `+` daria #VALUE!.
      const totalCell = row.getCell(DETAIL_IDX.total);
      totalCell.value = { formula: `SUM(${DETAIL_COL_DESPESAS}${rowIdx},${DETAIL_COL_HORA_AULA}${rowIdx})` };
      totalCell.numFmt = FMT_MOEDA;
      totalCell.font = { bold: true };
    });

    const lastDetailRow = DETAIL_FIRST_DATA_ROW + block.linhas.length - 1;
    const totalRow = ws.addRow(['', '', '', '', '', 'Total:']);
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).alignment = { horizontal: 'right' };
    const somaColuna = (col: string) => `SUM(${col}${DETAIL_FIRST_DATA_ROW}:${col}${lastDetailRow})`;
    const totais: [number, string, string][] = [
      [DETAIL_IDX.hospedagem, DETAIL_COL_HOSPEDAGEM, FMT_MOEDA],
      [DETAIL_IDX.locomocao, DETAIL_COL_LOCOMOCAO, FMT_MOEDA],
      [DETAIL_IDX.alimentacao, DETAIL_COL_ALIMENTACAO, FMT_MOEDA],
      [DETAIL_IDX.outros, DETAIL_COL_OUTROS, FMT_MOEDA],
      [DETAIL_IDX.despesas, DETAIL_COL_DESPESAS, FMT_MOEDA],
      [DETAIL_IDX.horas, DETAIL_COL_HORAS, FMT_HORAS],
      [DETAIL_IDX.horaAula, DETAIL_COL_HORA_AULA, FMT_MOEDA],
      [DETAIL_IDX.total, DETAIL_COL_TOTAL, FMT_MOEDA],
    ];
    for (const [idx, col, fmt] of totais) {
      const cell = totalRow.getCell(idx);
      cell.value = { formula: somaColuna(col) };
      cell.numFmt = fmt;
      cell.font = { bold: true };
    }

    // Aba de detalhe é derivada, com UMA exceção sinalizada: a célula de Horas
    // do acompanhante sem horas informadas (amarela, destravada).
    await ws.protect(undefined, SHEET_PROTECTION);
  }

  return workbook;
}
