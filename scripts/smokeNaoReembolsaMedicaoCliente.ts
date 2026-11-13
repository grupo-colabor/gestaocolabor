/**
 * SMOKE — "NÃO REEMBOLSA" nunca entra na medição do cliente (Medição Vale e BM)
 *
 * Chamado por smokeMedicaoVale.ts ([NR]) e smokeMedicaoValeBm.ts ([NR-BM]).
 *
 * O caso que motivou a rodada é a DEM-1297 (concluída, pronta para faturar),
 * Locomoção R$ 332,86:
 *   • Combustível R$ 151,97 → reembolsável (entra)
 *   • Uber        R$  46,95 → NÃO REEMBOLSA (fora)
 *   • Uber        R$  58,98 → NÃO REEMBOLSA (fora)
 *   • Uber 2      R$  74,96 → NÃO REEMBOLSA (fora)
 * O painel mostra "Não reembolsável R$ 180,89". Nos dois documentos a despesa
 * da demanda é R$ 151,97 (base do 20%), nunca R$ 332,86.
 *
 * A fixture mistura os formatos reais do item: notinha anexada (url do
 * Storage) e "Lançamento Avulso" (url '#', `VAL-…`), valor como número e como
 * texto com vírgula ou ponto — os quatro passam pela MESMA leitura.
 *
 * Casos extras: todos os itens não reembolsáveis (despesa 0, a linha continua
 * saindo com hora/aula); v2 com item marcado em bloco de participante e de
 * acompanhante; dividida entre titulares; híbrida em duas linhas (a despesa
 * não duplica nem reaparece na online); as seis categorias; sobrescrita em
 * Campos manuais; modelo por empresa (template do banco); BM por mina, com
 * corredor "Todos" e lido de volta do XLSX.
 *
 * Cada runner devolve as próprias falhas; o chamador soma e sai com 1.
 */
import fs from 'fs';
import path from 'path';

import {
  computeClientMeasurementExpenses,
  computeMeasurementTotals,
  entraNaMedicaoDoCliente,
} from '../domain/measurementTotals';
import { reembolsoDaPessoa } from '../domain/paymentRows';
import { buildMedicaoValeRows, toRowsSheetInput, type MedicaoValeRow } from '../domain/exports/datasets/medicaoVale';
import { avisoBmNaoReembolsavel, bmRegionRows, buildBm, bmZipEntryName, periodoLabel } from '../domain/exports/datasets/medicaoValeBm';
import { buildPendencias } from '../domain/exports/pendencias';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { VALE_BM_TEMPLATE } from '../domain/exports/templates/vale-bm';
import { resolveRowsSheet, resolveTemplate, resolveTemplateWithProblems } from '../domain/exports/templates/resolve';
import { emptyTemplateValuesIndex, indexTemplateValues, type TemplateValuesIndex } from '../domain/exports/templates/values';
import { applyFilters } from '../domain/exports/filters';
import { EMPTY_FILTERS } from '../domain/exports/types';
import { buildTrainingsById } from '../domain/modalityOptions';
import { buildTemplateXlsxBuffer } from '../services/exports/templateXlsxWriter';
import { COMPANIES, HOJE, TRAININGS, demandaVale, medicao } from './smokeMedicaoValeDatasets';
import { sigmaMedicaoVale } from './smokeMedicaoValeBmChecks';

export interface NrTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
}

/** Contador local + repasse ao `check` do chamador (mesmo padrão dos outros runners). */
function contador(t: NrTools) {
  let falhas = 0;
  const check: NrTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: NrTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };
  const perto: NrTools['perto'] = (n, a, b) => { if (!(Math.abs(a - b) < 1e-6)) falhas++; t.perto(n, a, b); }; // NaN-safe
  return { check, eq, perto, falhas: () => falhas };
}

const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/* ─────────────────────────────── fixtures ─────────────────────────────── */

export const INSTRUCTORS_NR = [
  { id: 'INS-T', name: 'Titular' },
  { id: 'INS-2', name: 'Segundo' },
  { id: 'INS-C', name: 'Acompanhante' },
];

/** Os quatro itens da DEM-1297, nos formatos que o painel grava. */
export const ITENS_1297 = () => [
  // Notinha anexada, valor digitado com vírgula.
  { id: 'n1297-comb', name: 'Combustível.jpg', url: 'https://storage/comb.jpg', type: 'image/jpeg', date: '2026-08-11T10:00:00Z', category: 'LOCOMOCAO', value: '151,97' },
  // Lançamento avulso (handleAddManualValue), valor com vírgula.
  { id: 'VAL-1297-1', name: 'Lançamento Avulso', url: '#', type: 'text/plain', date: '2026-08-11T18:00:00Z', category: 'LOCOMOCAO', value: '46,95', reembolsavel: false },
  // Notinha anexada, valor como número.
  { id: 'n1297-uber', name: 'Uber.pdf', url: 'https://storage/uber.pdf', type: 'application/pdf', date: '2026-08-10T07:00:00Z', category: 'LOCOMOCAO', value: 58.98, reembolsavel: false },
  // Lançamento avulso, valor com ponto.
  { id: 'VAL-1297-2', name: 'Uber 2', url: '#', type: 'text/plain', date: '2026-08-11T19:00:00Z', category: 'LOCOMOCAO', value: '74.96', reembolsavel: false },
];

export const VALORES_NR: TemplateValuesIndex = indexTemplateValues([
  { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120 },
  { scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
  { scope: 'training', column_key: 'precoHHOnline', training_id: 'T_HIB', demand_id: null, value: 200 },
]);

/** Fonte do dataset: uma alocação por demanda (titular da própria demanda), a não ser que venha outra. */
export function fonteNr(demands: any[], measurements: any[], over: any = {}) {
  return {
    template: VALE_TEMPLATE,
    demands,
    measurements,
    trainings: TRAININGS,
    instructors: INSTRUCTORS_NR,
    companies: COMPANIES,
    instructorAllocations: demands
      .filter(d => d.instructorId)
      .map((d, i) => ({ id: `NR-A${i}`, demandId: d.id, instructorId: d.instructorId, startDate: d.startDate, endDate: d.endDate })),
    templateValues: VALORES_NR,
    now: HOJE,
    ...over,
  };
}

export const dem1297 = (over: any = {}) => demandaVale({ id: 'DEM-1297', clientDemandId: 'SAP-1297', ...over });
export const med1297 = (over: any = {}) => medicao('DEM-1297', { attachments: ITENS_1297(), ...over });

/* ─────────────────────── leitura da aba Turmas (resolvida) ─────────────────────── */

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const DESPESA_COLS = ['locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros'] as const;

/** Uma linha da planilha como o Excel vai calculá-la: L..P, base do 20% (Σ L..P), R calculado. */
function planilha(rows: MedicaoValeRow[], values: TemplateValuesIndex) {
  const linhas = toRowsSheetInput(rows, VALE_TEMPLATE);
  const s = resolveRowsSheet(VALE_TEMPLATE.sheets[0], linhas, values);
  const ci = (k: string) => s.columns.findIndex(c => c.key === k);
  return linhas.map((l, i) => {
    const v = (k: string) => s.rows[i][ci(k)].value;
    const base = r2(DESPESA_COLS.reduce((acc, k) => acc + n(v(k)), 0));
    const pct = n(v('pctDespesa'));
    return {
      demandId: l.refs.demandId,
      parte: l.refs.parte,
      L: v('locacao'), M: v('combustivel'), N: v('alimentacao'), O: v('hospedagem'), P: v('outros'), Q: v('pctDespesa'),
      base,
      /** O valor que a fórmula de R dá no Excel: SUM(L:P) + SUM(L:P) × Q. */
      R: base + base * pct,
      R_formula: s.rows[i][ci('valorTotalDespesas')].formula,
      carga: v('cargaHoraria'),
      preco: v('precoHH'),
      numeros: s.rows[i].map(c => c.value).filter((x): x is number => typeof x === 'number'),
    };
  });
}

const textosPendencia = (rows: MedicaoValeRow[], values: TemplateValuesIndex, demandId: string) =>
  buildPendencias(rows, { sheet: VALE_TEMPLATE.sheets[0], template: VALE_TEMPLATE, templateValues: values, logisticAllocations: [], logisticBlocks: [] })
    .find(p => p.demand.id === demandId)?.pendencias.map(p => p.texto) ?? [];

const AVISO_1297 = 'Item não reembolsável fora das colunas da Vale (R$ 180,89)';

/**
 * Σ BM vs Σ Medição Vale, com até 1 centavo de folga POR UM MOTIVO SÓ, que
 * não é desta rodada: o BM arredonda o P de cada turma antes de somar
 * (`turmasNumeros`: 182,364 → 182,36), e o total da coluna R da Medição Vale
 * soma sem arredondar (2 × 182,364 = 364,728 → 364,73). Com valores de 3ª
 * casa (151,97 × 1,2) os dois documentos podem diferir em 1 centavo. Achado
 * registrado no relatório, decisão de negócio pendente — não é o "não
 * reembolsa": um item marcado vazando daria diferença de 180,89 × 1,2.
 */
const ATE_UM_CENTAVO = 0.0100001;

const texto = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'formula' in v) return `=${v.formula}`;
  return String(v);
};

/* ════════════════════════════════ MEDIÇÃO VALE ════════════════════════════════ */

export async function runNaoReembolsaValeChecks(t: NrTools): Promise<number> {
  const { check, eq, perto, falhas } = contador(t);

  console.log('\n[NR] "Não reembolsa" fora da Medição Vale — DEM-1297 e casos extras');

  /* ── A regra, no domínio ── */
  {
    const m = med1297();
    eq('entraNaMedicaoDoCliente: só o combustível entra', ITENS_1297().map(entraNaMedicaoDoCliente), [true, false, false, false]);
    check('item sem a flag (antigo) entra', entraNaMedicaoDoCliente({ category: 'LOCOMOCAO', value: 10 }));
    check('reembolsavel: true entra', entraNaMedicaoDoCliente({ category: 'LOCOMOCAO', value: 10, reembolsavel: true }));
    check('pagoPeloInstrutor não decide nada aqui', !entraNaMedicaoDoCliente({ category: 'LOCOMOCAO', value: 10, reembolsavel: false, pagoPeloInstrutor: true })
      && entraNaMedicaoDoCliente({ category: 'LOCOMOCAO', value: 10, pagoPeloInstrutor: true }));

    const c = computeClientMeasurementExpenses(m);
    perto('porta única: entram R$ 151,97 em locomoção', c.entram.locomocao, 151.97);
    perto('porta única: total que entra = R$ 151,97', c.entram.total, 151.97);
    perto('porta única: excluído = R$ 180,89', c.naoReembolsavelExcluido, 180.89);
    eq('porta única: 3 itens fora', c.itensExcluidos, 3);
    perto('porta única: todas = R$ 332,86 (o que o painel soma)', c.todas.total, 332.86);
    perto('partição: entram + excluído = todas', r2(c.entram.total + c.naoReembolsavelExcluido), r2(c.todas.total));
    eq('medição ausente: tudo zero (é "sem medição", que o painel avisa)', [computeClientMeasurementExpenses(undefined).entram.total, computeClientMeasurementExpenses(undefined).naoReembolsavelExcluido], [0, 0]);

    // O que NÃO pode mudar: Painel de Medição.
    const painel = computeMeasurementTotals(m);
    perto('painel: Subtotal Final de despesas continua R$ 332,86', painel.total, 332.86);
    perto('painel: indicador "Não reembolsável" continua R$ 180,89', r2(painel.naoReembolsavel), 180.89);
    perto('painel e porta única dizem o mesmo excluído', r2(painel.naoReembolsavel), c.naoReembolsavelExcluido);

    // Excel de pagamento: quem manda é pagoPeloInstrutor — a flag não reembolsa não tira nada.
    const pago = medicao('DEM-1297', { attachments: ITENS_1297().map(a => ({ ...a, pagoPeloInstrutor: true })) });
    const pagoSemFlag = medicao('DEM-1297', { attachments: ITENS_1297().map(a => ({ ...a, pagoPeloInstrutor: true, reembolsavel: undefined })) });
    const pessoas = [{ instructorId: 'INS-T', papel: 'TITULAR' as const }];
    perto('Excel de pagamento: reembolso ao instrutor = R$ 332,86 mesmo com 3 itens "não reembolsa"', reembolsoDaPessoa(pago, dem1297(), pessoas, 'INS-T').total, 332.86);
    perto('e é o MESMO valor sem a flag (a flag não altera o reembolso)', reembolsoDaPessoa(pago, dem1297(), pessoas, 'INS-T').total, reembolsoDaPessoa(pagoSemFlag, dem1297(), pessoas, 'INS-T').total);
  }

  /* ── DEM-1297 (v1) na Medição Vale ── */
  {
    const src = fonteNr([dem1297()], [med1297()]);
    const rows = buildMedicaoValeRows(src);
    const r = rows[0];
    check('DEM-1297 é elegível para a aba Turmas', r.elegivelTurmas);
    eq('DEM-1297: despesas da linha = só o combustível', r.input.despesas, { locomocao: 151.97, alimentacao: 0, hospedagem: 0, outros: 0, total: 151.97 });
    perto('DEM-1297: naoReembolsavelExcluido = R$ 180,89', r.naoReembolsavelExcluido, 180.89);
    perto('DEM-1297: despesasTotalTodas = R$ 332,86 (referência do painel)', r.despesasTotalTodas, 332.86);

    const [l] = planilha(rows, src.templateValues);
    eq('L..P: L = 151,97 e o resto 0', [l.L, l.M, l.N, l.O, l.P], [151.97, 0, 0, 0, 0]);
    perto('base do 20% (Σ L..P) = R$ 151,97', l.base, 151.97);
    eq('Q = 20%', l.Q, 0.2);
    eq('R é a fórmula sobre L..P (o que está fora de L..P não tem como entrar)', l.R_formula, 'SUM(L2:P2)+(SUM(L2:P2)*Q2)');
    perto('R (total despesas da linha) = 151,97 × 1,2 = R$ 182,364', l.R, 182.364);
    check('R não é 332,86 × 1,2', Math.abs(l.R - 332.86 * 1.2) > 1);
    check('nenhuma célula numérica da linha carrega 332,86 nem 180,89', !l.numeros.some(x => Math.abs(x - 332.86) < 1e-6 || Math.abs(x - 180.89) < 1e-6));
    eq('hora/aula da linha continua: carga 16 × preço 120', [l.carga, l.preco], [16, 120]);

    // Aviso de linha no painel de pendências (texto congelado da Vale).
    check(`painel de pendências: "${AVISO_1297}"`, textosPendencia(rows, src.templateValues, 'DEM-1297').includes(AVISO_1297));

    // O arquivo, lido de volta.
    const basePath = path.join(raiz, 'public', 'templates', 'vale.xlsx');
    check('arquivo-base da Vale existe', fs.existsSync(basePath));
    if (fs.existsSync(basePath)) {
      const sheets = resolveTemplate(VALE_TEMPLATE, toRowsSheetInput(rows, VALE_TEMPLATE), src.templateValues);
      const buf = await buildTemplateXlsxBuffer(VALE_TEMPLATE, sheets, fs.readFileSync(basePath));
      const ExcelJS = (await import('exceljs')) as any;
      const wb = new (ExcelJS.default ?? ExcelJS).Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.getWorksheet('Turmas Realizadas');
      eq('XLSX: L2..P2 = 151,97 / 0 / 0 / 0 / 0', ['L2', 'M2', 'N2', 'O2', 'P2'].map(a => ws.getCell(a).value), [151.97, 0, 0, 0, 0]);
      eq('XLSX: R2 soma L2:P2 com o % de Q2', texto(ws.getCell('R2').value), '=SUM(L2:P2)+(SUM(L2:P2)*Q2)');
      eq('XLSX: total de L na linha 3 cobre só a turma', texto(ws.getCell('L3').value), '=SUM(L2:L2)');
      const numericas: number[] = [];
      ws.getRow(2).eachCell((c: any) => { if (typeof c.value === 'number') numericas.push(c.value); });
      check('XLSX: nenhuma célula da linha 2 com 332,86 ou 180,89', !numericas.some(x => Math.abs(x - 332.86) < 1e-6 || Math.abs(x - 180.89) < 1e-6));
    }
  }

  /* ── Todos os itens não reembolsáveis ── */
  {
    const todosFora = ITENS_1297().map(a => ({ ...a, reembolsavel: false }));
    const src = fonteNr([dem1297()], [med1297({ attachments: todosFora })]);
    const rows = buildMedicaoValeRows(src);
    const [l] = planilha(rows, src.templateValues);
    check('todos fora: a turma continua elegível', rows[0].elegivelTurmas);
    eq('todos fora: despesas da linha = 0', rows[0].input.despesas.total, 0);
    eq('todos fora: L..P = 0 e base 0', [l.L, l.M, l.N, l.O, l.P, l.base], [0, 0, 0, 0, 0, 0]);
    eq('todos fora: a linha sai com hora/aula (carga 16, preço 120)', [l.carga, l.preco], [16, 120]);
    perto('todos fora: excluído = R$ 332,86', rows[0].naoReembolsavelExcluido, 332.86);
    check('todos fora: aviso com o valor cheio', textosPendencia(rows, src.templateValues, 'DEM-1297').includes('Item não reembolsável fora das colunas da Vale (R$ 332,86)'));
  }

  /* ── v2: item marcado em bloco de participante e de acompanhante ── */
  {
    const m = medicao('DEM-1297', {
      expenses: {
        classHours: 16,
        participantes: [
          { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 },
          { instructorId: 'INS-2', papel: 'PARTICIPANTE', valorHH: 80 },
          { instructorId: 'INS-C', papel: 'ACOMPANHANTE', horas: 4, valorHH: 50 },
        ],
      },
      attachments: [
        ...ITENS_1297().slice(0, 2), // titular (sem dono): combustível entra, Uber fora
        { id: 'p-hosp', category: 'HOSPEDAGEM', value: 200, instructorId: 'INS-2' },                      // participante, entra
        { id: 'p-alm', category: 'ALMOCO', value: '40,00', instructorId: 'INS-2', reembolsavel: false },   // participante, fora
        { id: 'c-uber', category: 'LOCOMOCAO', value: 58.98, instructorId: 'INS-C', reembolsavel: false }, // acompanhante, fora
        { id: 'c-jan', category: 'JANTAR', value: 35, instructorId: 'INS-C' },                             // acompanhante, entra
        { id: 'x-outro', category: 'LOCOMOCAO', value: 74.96, instructorId: 'INS-SAIU', reembolsavel: false }, // dono fora da lista → titular, fora
      ],
    });
    const src = fonteNr([dem1297()], [m]);
    const rows = buildMedicaoValeRows(src);
    eq('v2: despesas = combustível + hospedagem do participante + jantar do acompanhante',
      rows[0].input.despesas, { locomocao: 151.97, alimentacao: 35, hospedagem: 200, outros: 0, total: 386.97 });
    perto('v2: excluído = 46,95 + 40 + 58,98 + 74,96 = R$ 220,89', rows[0].naoReembolsavelExcluido, 220.89);
    const [l] = planilha(rows, src.templateValues);
    eq('v2: L / N / O na planilha', [l.L, l.N, l.O], [151.97, 35, 200]);
    perto('v2: base do 20% = R$ 386,97', l.base, 386.97);
  }

  /* ── Dividida entre titulares ── */
  {
    const d = dem1297({ instructorId: 'INS-T' });
    const m = medicao('DEM-1297', {
      expenses: {
        classHours: 16,
        participantes: [
          { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100, horasRateio: 8 },
          { instructorId: 'INS-2', papel: 'TITULAR', valorHH: 100, horasRateio: 8 },
        ],
      },
      attachments: [
        ...ITENS_1297().slice(0, 2),
        { id: 'd2-comb', category: 'LOCOMOCAO', value: 30, instructorId: 'INS-2' },
        { id: 'd2-uber', category: 'LOCOMOCAO', value: '58,98', instructorId: 'INS-2', reembolsavel: false },
        { id: 'd2-uber2', category: 'LOCOMOCAO', value: '74,96', instructorId: 'INS-2', reembolsavel: false },
      ],
    });
    const src = fonteNr([d], [m], {
      instructorAllocations: [
        { id: 'DV1', demandId: 'DEM-1297', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
        { id: 'DV2', demandId: 'DEM-1297', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
      ],
    });
    const rows = buildMedicaoValeRows(src);
    eq('dividida: uma linha só, consultor "Titular / Segundo"', [rows.length, rows[0].input.titulares], [1, ['Titular', 'Segundo']]);
    perto('dividida: locomoção = 151,97 + 30 (o reembolsável dos DOIS titulares)', rows[0].input.despesas.locomocao, 181.97);
    perto('dividida: excluído = 46,95 + 58,98 + 74,96', rows[0].naoReembolsavelExcluido, 180.89);
  }

  /* ── Híbrida em duas linhas ── */
  {
    const d = dem1297({ trainingId: 'T_HIB' });
    const src = fonteNr([d], [med1297()]);
    const rows = buildMedicaoValeRows(src);
    const ls = planilha(rows, src.templateValues);
    eq('híbrida: duas linhas, presencial e online', ls.map(l => l.parte), ['PRESENCIAL', 'ONLINE']);
    eq('híbrida: L presencial = 151,97; online = 0', [ls[0].L, ls[1].L], [151.97, 0]);
    eq('híbrida: online com L..P todo zerado', [ls[1].L, ls[1].M, ls[1].N, ls[1].O, ls[1].P], [0, 0, 0, 0, 0]);
    perto('híbrida: Σ base do 20% nas duas linhas = R$ 151,97 (não duplica)', r2(ls[0].base + ls[1].base), 151.97);
    perto('híbrida: R presencial = R$ 182,364', ls[0].R, 182.364);
    perto('híbrida: R online = 0 (a despesa não reaparece na segunda linha)', ls[1].R, 0);
    check('híbrida: nenhuma linha carrega 180,89 nem 332,86', !ls.some(l => l.numeros.some(x => Math.abs(x - 180.89) < 1e-6 || Math.abs(x - 332.86) < 1e-6)));
    eq('híbrida: carga 8 + 32 (hora/aula das duas partes continua)', ls.map(l => l.carga), [8, 32]);
    eq('híbrida: o aviso sai UMA vez na turma', textosPendencia(rows, src.templateValues, 'DEM-1297').filter(x => x === AVISO_1297).length, 1);
  }

  /* ── As seis categorias ── */
  {
    const itens = [
      { id: 'h1', category: 'HOSPEDAGEM', value: 300 }, { id: 'h2', category: 'HOSPEDAGEM', value: 100, reembolsavel: false },
      { id: 'l1', category: 'LOCOMOCAO', value: '151,97' }, { id: 'l2', category: 'LOCOMOCAO', value: '46,95', reembolsavel: false },
      { id: 'c1', category: 'CAFE', value: 10 }, { id: 'c2', category: 'CAFE', value: 5, reembolsavel: false },
      { id: 'a1', category: 'ALMOCO', value: 40 }, { id: 'a2', category: 'ALMOCO', value: 20, reembolsavel: false },
      { id: 'j1', category: 'JANTAR', value: 35 }, { id: 'j2', category: 'JANTAR', value: 15, reembolsavel: false },
      { id: 'o1', category: 'OUTROS', value: 25, otherId: 'O1' }, { id: 'o2', category: 'OUTROS', value: 12, otherId: 'O1', reembolsavel: false },
    ];
    const src = fonteNr([dem1297()], [med1297({ attachments: itens, otherExpenses: [{ id: 'O1', description: 'Pedágio', value: '' }] })]);
    const rows = buildMedicaoValeRows(src);
    eq('seis categorias: só o reembolsável de cada uma entra',
      rows[0].input.despesas, { locomocao: 151.97, alimentacao: 85, hospedagem: 300, outros: 25, total: 561.97 });
    perto('seis categorias: excluído = 100 + 46,95 + 5 + 20 + 15 + 12', rows[0].naoReembolsavelExcluido, 198.95);
    const [l] = planilha(rows, src.templateValues);
    eq('seis categorias: L / N / O / P', [l.L, l.N, l.O, l.P], [151.97, 85, 300, 25]);
  }

  /* ── Sobrescrita em Campos manuais (measurement_template_values) ── */
  {
    const valores = indexTemplateValues([
      { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120 },
      { scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-1297', value: 20 },
      { scope: 'demand', column_key: 'pctDespesa', training_id: null, demand_id: 'DEM-1297', value: 0.1 },
    ]);
    const src = fonteNr([dem1297()], [med1297()], { templateValues: valores });
    const rows = buildMedicaoValeRows(src);
    const [l] = planilha(rows, valores);
    eq('sobrescrita: combustível digitado (M) vale como está; L continua só o reembolsável', [l.L, l.M], [151.97, 20]);
    perto('sobrescrita: base do % = 151,97 + 20', l.base, 171.97);
    perto('sobrescrita: % digitado vale (171,97 × 1,1)', l.R, 171.97 * 1.1);
    check('sobrescrita: o aviso continua com o valor excluído', textosPendencia(rows, valores, 'DEM-1297').includes(AVISO_1297));
    const tudo = indexTemplateValues([{ scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-1297', value: 332.86 }]);
    eq('sobrescrita: o digitado não passa pela regra (332,86 digitado sai 332,86 em M)', planilha(buildMedicaoValeRows(fonteNr([dem1297()], [med1297()], { templateValues: tudo })), tudo)[0].M, 332.86);
  }

  /* ── Modelo por empresa (template do banco) ── */
  {
    const modelo: any = {
      id: 'tpl:nr', version: 1, origin: 'db', label: 'Medição Vale (banco)', company: { nameIncludes: 'VALE' },
      fileNameBase: 'medicao', baseFile: 'templates/x/y.xlsx', baseFileFrom: 'storage',
      sheets: [{
        name: 'Dados', kind: 'rows', rowScope: 'demand', headerRow: 1, firstDataRow: 2,
        columns: [
          { key: 'dem', header: 'Demanda', source: 'demand.id', format: 'text' },
          { key: 'loc', header: 'Locomoção', source: 'expenses.locomocao', format: 'currency' },
          { key: 'tot', header: 'Despesas', source: 'expenses.total', format: 'currency' },
        ],
      }],
    };
    const rows = buildMedicaoValeRows({ ...fonteNr([dem1297()], [med1297()]), template: modelo });
    const out = resolveTemplateWithProblems(modelo, toRowsSheetInput(rows, modelo), emptyTemplateValuesIndex());
    const sheet: any = out.sheets[0];
    eq('modelo por empresa: sem problema de configuração', out.problems, []);
    eq('modelo por empresa: hoje EXCLUI o não reembolsável (locomoção e total = 151,97)', sheet.rows[0].slice(1).map((c: any) => c.value), [151.97, 151.97]);
  }

  /* ── Guardas de fonte: a regra mora num lugar só ── */
  {
    const vale = semComentarios(ler('domain/exports/datasets/medicaoVale.ts'));
    check('medicaoVale.ts lê as despesas pela porta única', vale.includes('computeClientMeasurementExpenses(m as any)'));
    check('e não refaz o filtro (sem isNaoReembolsavel / reembolsavel / computePanelExpenseBreakdown)',
      !/isNaoReembolsavel|\.reembolsavel|computePanelExpenseBreakdown/.test(vale));

    const totais = semComentarios(ler('domain/measurementTotals.ts'));
    check('entraNaMedicaoDoCliente é isNaoReembolsavel negado (reaproveita o helper do card)',
      /export const entraNaMedicaoDoCliente = \(a: TotalizableAttachment\): boolean => !isNaoReembolsavel\(a\);/.test(totais));
    check('computeClientMeasurementExpenses filtra por entraNaMedicaoDoCliente', totais.includes('itemFilter: entraNaMedicaoDoCliente'));

    // Fora do domínio de medição, quem lê a flag em domain/exports são só os
    // datasets Despesas e Medições (fora do escopo, de propósito).
    const lista = (dir: string): string[] => fs.readdirSync(path.join(raiz, dir)).flatMap(f => {
      const rel = `${dir}/${f}`;
      return fs.statSync(path.join(raiz, rel)).isDirectory() ? lista(rel) : rel.endsWith('.ts') ? [rel] : [];
    });
    const leitores = lista('domain/exports').filter(f => /isNaoReembolsavel|\.reembolsavel\b/.test(semComentarios(ler(f))));
    eq('em domain/exports só Despesas e Medições leem a flag direto', leitores.sort(), ['domain/exports/datasets/despesas.ts', 'domain/exports/datasets/medicoes.ts']);

    for (const f of ['domain/paymentRows.ts', 'services/medicaoExportService.ts', 'services/medicaoWorkbook.ts']) {
      check(`Excel de pagamento (${f}) não lê o "não reembolsa"`, !/isNaoReembolsavel|entraNaMedicaoDoCliente|computeClientMeasurementExpenses|\.reembolsavel\b/.test(semComentarios(ler(f))));
    }
    const painel = semComentarios(ler('components/Measurement.tsx'));
    check('Painel de Medição: Subtotal Final e "Não reembolsável" continuam em computeMeasurementTotals',
      painel.includes('formatCurrency(totals.total)') && painel.includes('formatCurrency(totals.naoReembolsavel)') && !painel.includes('computeClientMeasurementExpenses'));
  }

  return falhas();
}

/* ═══════════════════════════════════ BM VALE ═══════════════════════════════════ */

/**
 * Recorte do BM: agosto, com
 *   • DEM-1297 em Sudeste|Brucutu (o caso real);
 *   • DEM-1303 também em Brucutu — hospedagem 200 entra, almoço 30 marcado fica
 *     fora (os demais itens da demanda continuam);
 *   • DEM-1298 em Sudeste|Timbopeba com TODOS os itens marcados;
 *   • DEM-1301 híbrida em Sudeste|Cauê com os itens da DEM-1297;
 *   • DEM-1304 em Ferrovia/MG|Vitória com um Uber marcado — só com "Todos".
 */
export function buildBmNrFixture() {
  const demands = [
    dem1297(),
    demandaVale({ id: 'DEM-1303', trainingLocal: 'Brucutu', startDate: '2026-08-12T08:00', endDate: '2026-08-13T17:00' }),
    demandaVale({ id: 'DEM-1298', trainingLocal: 'Timbopeba', startDate: '2026-08-14T08:00', endDate: '2026-08-15T17:00' }),
    demandaVale({ id: 'DEM-1301', trainingId: 'T_HIB', trainingLocal: 'Cauê', startDate: '2026-08-17T08:00', endDate: '2026-08-18T17:00' }),
    demandaVale({ id: 'DEM-1304', corredor: 'Ferrovia/MG', trainingLocal: 'Vitória', startDate: '2026-08-19T08:00', endDate: '2026-08-20T17:00' }),
  ];
  const measurements = [
    med1297(),
    medicao('DEM-1303', { attachments: [{ id: 'b1', category: 'HOSPEDAGEM', value: 200 }, { id: 'b2', category: 'ALMOCO', value: 30, reembolsavel: false }] }),
    medicao('DEM-1298', { attachments: ITENS_1297().map(a => ({ ...a, reembolsavel: false })) }),
    medicao('DEM-1301', { attachments: ITENS_1297() }),
    medicao('DEM-1304', { attachments: [{ id: 'v1', category: 'LOCOMOCAO', value: 140 }, { id: 'v2', category: 'LOCOMOCAO', value: 46.95, reembolsavel: false }] }),
  ];
  const src = fonteNr(demands, measurements);
  const rows = buildMedicaoValeRows(src);
  const ctx = { trainingsById: buildTrainingsById(TRAININGS), now: HOJE };
  const allowed: any = ['periodoFim', 'corredor', 'site', 'statusMedicao'];
  const agosto = { ...EMPTY_FILTERS, dataInicio: '2026-08-01', dataFim: '2026-08-31' };
  return {
    src,
    rows,
    recorte: applyFilters(rows, { ...agosto, corredor: 'Sudeste' }, allowed, ctx),
    recorteTodos: applyFilters(rows, agosto, allowed, ctx),
  };
}

export async function runNaoReembolsaBmChecks(t: NrTools): Promise<number> {
  const { check, eq, perto, falhas } = contador(t);

  console.log('\n[NR-BM] "Não reembolsa" fora do BM — DEM-1297 e casos extras');
  const { src, recorte, recorteTodos } = buildBmNrFixture();
  const values = src.templateValues;
  const despesasDe = (m: { linhas: { tipo: string; quantidade: number | null }[] }) => m.linhas.find(l => l.tipo === 'despesas')!.quantidade;

  /* ── DEM-1297 sozinha: o número do boletim ── */
  {
    const so1297 = recorte.filter(r => r.demand.id === 'DEM-1297');
    const bm = buildBm(so1297, values, VALE_BM_TEMPLATE, { corredor: 'Sudeste', mina: 'Brucutu' });
    eq('DEM-1297: um BM, Sudeste | Brucutu', bm.minas.map(m => `${m.corredor}|${m.mina}`), ['Sudeste|Brucutu']);
    const bru = bm.minas[0];
    perto('DEM-1297: linha de despesas = 151,97 × 1,2 = 182,364 exato (base do 20% = 151,97)', despesasDe(bru)!, 182.364);
    check('DEM-1297: nunca 332,86 × 1,2 (399,432)', Math.abs(bru.totalDespesas - 332.86 * 1.2) > 1);
    perto('DEM-1297: treinamento 16h × R$ 120', bru.totalTreinamentos, 1920);
    perto('DEM-1297: total do boletim = 1920 + 182,364, sem os 180,89', bru.totalTreinamentos + bru.totalDespesas, 2102.364);
    perto('DEM-1297: conferência — R$ 180,89 fora', bru.naoReembolsavelExcluido, 180.89);
    eq('DEM-1297: a demanda afetada aparece na conferência', bru.turmasComNaoReembolsavel, ['DEM-1297']);
    eq('aviso da conferência', avisoBmNaoReembolsavel(bru.naoReembolsavelExcluido, bru.turmasComNaoReembolsavel.length), 'R$ 180,89 não reembolsável fora da linha de despesas (1 turma(s))');
    perto('Σ BM = Σ Medição Vale com uma turma só (exato: o BM lê as mesmas células)', r2(bru.totalTreinamentos + bru.totalDespesas), sigmaMedicaoVale(so1297, values).noBm);

    // O XLSX do BM, lido de volta.
    const basePath = path.join(raiz, 'public', 'templates', 'vale-bm.xlsx');
    check('arquivo-base do BM existe', fs.existsSync(basePath));
    if (fs.existsSync(basePath)) {
      const sheets = resolveTemplate(VALE_BM_TEMPLATE, [], values, {
        context: bru.contexto, manual: { dataEnvio: '2026-09-16' }, periodoLabel: periodoLabel('2026-08-01', '2026-08-31'), regionRows: bmRegionRows(bru),
      });
      const buf = await buildTemplateXlsxBuffer(VALE_BM_TEMPLATE, sheets, fs.readFileSync(basePath));
      const ExcelJS = (await import('exceljs')) as any;
      const wb = new (ExcelJS.default ?? ExcelJS).Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      const ultima = 19 + bru.linhas.length - 1;
      eq('XLSX do BM: linha de despesas QQP 70', ws.getCell(`B${ultima}`).value, '70');
      perto('XLSX do BM: quantidade da linha de despesas = 182,364 exato', ws.getCell(`H${ultima}`).value, 182.364);
      eq('XLSX do BM: treinamento 16h a R$ 120', [ws.getCell('G19').value, ws.getCell('H19').value], [120, 16]);
      const numericas: number[] = [];
      ws.eachRow((row: any) => row.eachCell((c: any) => { if (typeof c.value === 'number') numericas.push(c.value); }));
      check('XLSX do BM: nenhuma célula com 332,86, 180,89 ou 399,432', !numericas.some(x => [332.86, 180.89, 332.86 * 1.2].some(v => Math.abs(x - v) < 1e-6)));
    }
  }

  /* ── Recorte Sudeste: as outras turmas e os outros itens continuam ── */
  {
    const bm = buildBm(recorte, values, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
    const mina = (nome: string) => bm.minas.find(m => m.mina === nome)!;
    eq('Sudeste: três minas', bm.minas.map(m => m.mina), ['Brucutu', 'Cauê', 'Timbopeba']);

    const bru = mina('Brucutu');
    perto('Brucutu: despesas = (151,97 × 1,2) + (200 × 1,2) — a hospedagem da DEM-1303 continua', despesasDe(bru)!, 182.364 + 240);
    perto('Brucutu: fora = 180,89 + 30', bru.naoReembolsavelExcluido, 210.89);
    eq('Brucutu: as duas demandas na conferência', bru.turmasComNaoReembolsavel, ['DEM-1297', 'DEM-1303']);

    const tim = mina('Timbopeba');
    eq('todos fora (DEM-1298): a linha de treinamento continua, 16h a R$ 120', tim.linhas.filter(l => l.tipo === 'treinamento').map(l => [l.quantidade, l.preco]), [[16, 120]]);
    eq('todos fora: linha de despesas = 0', despesasDe(tim), 0);
    perto('todos fora: total do boletim = só a hora/aula', r2(tim.totalTreinamentos + tim.totalDespesas), 1920);
    perto('todos fora: conferência com R$ 332,86', tim.naoReembolsavelExcluido, 332.86);

    const caue = mina('Cauê');
    eq('híbrida: duas linhas de treinamento (presencial 8h, online 32h)', caue.linhas.filter(l => l.tipo === 'treinamento').map(l => [l.parte, l.quantidade]), [['PRESENCIAL', 8], ['ONLINE', 32]]);
    perto('híbrida: despesas uma vez só = 182,364', despesasDe(caue)!, 182.364);
    perto('híbrida: conferência R$ 180,89 uma vez (não 361,78)', caue.naoReembolsavelExcluido, 180.89);

    {
      const sigmaBm = r2(bm.minas.reduce((acc, m) => acc + m.totalTreinamentos + m.totalDespesas, 0));
      const sigmaVale = sigmaMedicaoVale(recorte, values).noBm;
      check('Σ BM (Sudeste) = Σ Medição Vale do mesmo recorte (até 1 centavo — arredondamento por turma do BM, ver ATE_UM_CENTAVO)',
        Math.abs(sigmaBm - sigmaVale) <= ATE_UM_CENTAVO, `BM ${sigmaBm}, Vale ${sigmaVale}`);
    }
    perto('barra: Σ fora nas minas', bm.naoReembolsavelExcluido, 210.89 + 332.86 + 180.89);
    eq('barra: quatro turmas afetadas', bm.turmasComNaoReembolsavel, 4);

    // A mesma tela mostra o aviso de linha da Medição Vale no painel do BM.
    check('painel do BM (mesmo buildPendencias, template da Vale) avisa a DEM-1297', textosPendencia(recorte, values, 'DEM-1297').includes(AVISO_1297));
  }

  /* ── Corredor "Todos" (zip): por mina, os mesmos números ── */
  {
    const todos = buildBm(recorteTodos, values, VALE_BM_TEMPLATE, {});
    const sudeste = buildBm(recorte, values, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
    eq('Todos: dois corredores, quatro minas', todos.minas.map(m => `${m.corredor}|${m.mina}`), ['Ferrovia/MG|Vitória', 'Sudeste|Brucutu', 'Sudeste|Cauê', 'Sudeste|Timbopeba']);
    eq('Todos: cada mina do Sudeste com a MESMA linha de despesas do BM por corredor',
      todos.minas.filter(m => m.corredor === 'Sudeste').map(despesasDe), sudeste.minas.map(despesasDe));
    const vit = todos.minas.find(m => m.mina === 'Vitória')!;
    perto('Todos: Vitória com 140 × 1,2 (Uber de 46,95 fora)', despesasDe(vit)!, 168);
    perto('Todos: conferência de Vitória = R$ 46,95', vit.naoReembolsavelExcluido, 46.95);
    perto('Todos: barra soma as quatro minas', todos.naoReembolsavelExcluido, r2(sudeste.naoReembolsavelExcluido + 46.95));
    eq('Todos: entrada do zip da DEM-1297 na pasta do corredor', bmZipEntryName(VALE_BM_TEMPLATE, todos.minas[1], '2026-08-01', '2026-08-31', true), 'sudeste/vale-bm-sudeste-brucutu-2026-08-01_2026-08-31.xlsx');
    {
      const sigmaBm = r2(todos.minas.reduce((acc, m) => acc + m.totalTreinamentos + m.totalDespesas, 0));
      const sigmaVale = sigmaMedicaoVale(recorteTodos, values).noBm;
      check('Todos: Σ BMs = Σ Medição Vale do recorte (até 1 centavo — ver ATE_UM_CENTAVO)',
        Math.abs(sigmaBm - sigmaVale) <= ATE_UM_CENTAVO, `BM ${sigmaBm}, Vale ${sigmaVale}`);
    }
  }

  /* ── Guardas de fonte ── */
  {
    const bmSrc = semComentarios(ler('domain/exports/datasets/medicaoValeBm.ts'));
    check('medicaoValeBm.ts não lê anexo nem a flag (herda a linha da Medição Vale)',
      !/attachments|isNaoReembolsavel|\.reembolsavel\b|computePanelExpenseBreakdown|computeClientMeasurementExpenses/.test(bmSrc));
    check('e soma a conferência a partir de naoReembolsavelExcluido da turma', bmSrc.includes('t.naoReembolsavelExcluido'));
    const view = semComentarios(ler('components/exportacoes/MedicaoTemplateView.tsx'));
    check('barra do BM mostra o aviso do domínio', view.includes('avisoBmNaoReembolsavel(bm.naoReembolsavelExcluido, bm.turmasComNaoReembolsavel)'));
    const secoes = semComentarios(ler('components/exportacoes/BmSecoes.tsx'));
    check('prévia da mina mostra o aviso do domínio', secoes.includes('avisoBmNaoReembolsavel(mina.naoReembolsavelExcluido, mina.turmasComNaoReembolsavel.length)'));
  }

  return falhas();
}
