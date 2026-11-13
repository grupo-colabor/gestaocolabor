/**
 * FOTO DAS SUPERFÍCIES — valores de despesa gravados como NÚMERO
 *
 * Regra do pacote do parser pt-BR (13/11/2026): nenhum valor já gravado como
 * número muda em superfície nenhuma. Este módulo calcula, sobre uma fixture
 * só com números (o formato real de produção: o Salvar sempre gravou número),
 * os valores que cada superfície mostra:
 *
 *   • Painel de Medição ...... computeMeasurementTotals (Subtotal, Não reembolsável, Hora/Aula)
 *   • quebras ................ computePanelExpenseBreakdown (todas / não reembolsa / pago pelo instrutor)
 *   • medição do cliente ..... computeClientMeasurementExpenses
 *   • Dashboard (cards) ...... aggregateMeasurements, aggregatePanelExpenseBreakdown,
 *                              listNonReimbursableByDemand, parseExpenseValue (o leitor
 *                              que substitui os toVal do Dashboard)
 *   • Medição Vale ........... células numéricas da aba Turmas resolvida
 *   • BM ..................... linhas (preço, quantidade) e totais por mina
 *   • Excel de pagamento ..... reembolsoDaPessoa por pessoa
 *   • datasets ............... colunas numéricas de Despesas e Medições
 *
 * A foto "antes" (scripts/fixtures/valor-monetario-antes.json) foi gravada com
 * o código ANTERIOR ao parser novo (commit bd0e1c7). O smoke:valor-monetario
 * recalcula com o código atual e exige igualdade campo a campo.
 *
 * Só NÚMEROS entram na foto — campos novos (avisos, destaques) não quebram a
 * comparação, e é exatamente o número que não pode mudar.
 */
import {
  aggregateMeasurements,
  aggregatePanelExpenseBreakdown,
  computeClientMeasurementExpenses,
  computeMeasurementTotals,
  computePanelExpenseBreakdown,
  isNaoReembolsavel,
  isPagoPeloInstrutor,
  parseExpenseValue,
} from '../domain/measurementTotals';
import { listNonReimbursableByDemand } from '../domain/nonReimbursableExpenses';
import { reembolsoDaPessoa } from '../domain/paymentRows';
import { resolveMeasurementPeople } from '../domain/measurementPeople';
import { buildMedicaoValeRows, toRowsSheetInput } from '../domain/exports/datasets/medicaoVale';
import { buildBm } from '../domain/exports/datasets/medicaoValeBm';
import { buildDespesasRows, DESPESAS_DATASET } from '../domain/exports/datasets/despesas';
import { buildMedicoesRows, MEDICOES_DATASET } from '../domain/exports/datasets/medicoes';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { VALE_BM_TEMPLATE } from '../domain/exports/templates/vale-bm';
import { resolveRowsSheet } from '../domain/exports/templates/resolve';
import { indexTemplateValues } from '../domain/exports/templates/values';
import { COMPANIES, HOJE, TRAININGS, demandaVale, medicao } from './smokeMedicaoValeDatasets';

const INSTRUCTORS = [
  { id: 'INS-T', name: 'Titular' },
  { id: 'INS-2', name: 'Segundo' },
  { id: 'INS-C', name: 'Acompanhante' },
];

/** Itens numéricos nos formatos que existem no banco (o Salvar grava número). */
const itensNumericos = () => [
  { id: 'f-loc', name: 'comb.jpg', url: 'https://storage/comb.jpg', category: 'LOCOMOCAO', value: 151.97 },
  { id: 'v-uber', name: 'Lançamento Avulso', url: '#', category: 'LOCOMOCAO', value: 46.95, reembolsavel: false, pagoPeloInstrutor: true },
  { id: 'f-zero', name: 'hotel.pdf', url: 'https://storage/hotel.pdf', category: 'HOSPEDAGEM', value: 0 },
  { id: 'f-3casas', name: 'almoco.jpg', url: 'https://storage/almoco.jpg', category: 'ALMOCO', value: 1.234 },
  { id: 'v-jantar', name: 'Lançamento Avulso', url: '#', category: 'JANTAR', value: 10.5, pagoPeloInstrutor: true },
  { id: 'f-null', name: 'cafe.jpg', url: 'https://storage/cafe.jpg', category: 'CAFE', value: null },
  { id: 'v-outros', name: 'Lançamento Avulso', url: '#', category: 'OUTROS', value: 25, otherId: 'O1' },
  { id: 'v-orfao', name: 'Lançamento Avulso', url: '#', category: 'OUTROS', value: 5, otherId: 'ZZ' },
  { id: 'f-sem-chave', name: 'taxi.jpg', url: 'https://storage/taxi.jpg', category: 'LOCOMOCAO' },
  { id: 'f-hosp', name: 'hotel2.pdf', url: 'https://storage/hotel2.pdf', category: 'HOSPEDAGEM', value: 1234.56, pagoPeloInstrutor: true },
  { id: 'v-avulso-zero', name: 'Lançamento Avulso', url: '#', category: 'ALMOCO', value: 0 },
];

export function fixtureNumerica() {
  const demands = [
    demandaVale({ id: 'DEM-2001' }),
    demandaVale({ id: 'DEM-2002', trainingLocal: 'Timbopeba', startDate: '2026-08-12T08:00', endDate: '2026-08-13T17:00' }),
    demandaVale({ id: 'DEM-2003', trainingId: 'T_HIB', startDate: '2026-08-14T08:00', endDate: '2026-08-15T17:00' }),
    demandaVale({ id: 'DEM-2004', tipo: 'interna', trainingId: '', categoriaInterna: 'SIPAT', descricaoInterna: 'Palestra', horasPrevistas: 4 }),
  ];
  const measurements = [
    medicao('DEM-2001', { attachments: itensNumericos(), otherExpenses: [{ id: 'O1', description: 'Pedágio', value: '' }] }),
    medicao('DEM-2002', {
      expenses: {
        classHours: 16,
        participantes: [
          { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100, horasRateio: 8 },
          { instructorId: 'INS-2', papel: 'TITULAR', valorHH: 90.5, horasRateio: 8 },
        ],
      },
      attachments: [
        { id: 'p1', category: 'HOSPEDAGEM', value: 200, instructorId: 'INS-2', pagoPeloInstrutor: true },
        { id: 'p2', category: 'ALMOCO', value: 40.1, instructorId: 'INS-2', reembolsavel: false },
        { id: 'p3', category: 'LOCOMOCAO', value: 0, instructorId: 'INS-T', url: 'https://storage/x.jpg' },
        { id: 'p4', category: 'LOCOMOCAO', value: 12.345, instructorId: 'INS-T' },
      ],
    }),
    medicao('DEM-2003', { attachments: itensNumericos().slice(0, 5) }),
    medicao('DEM-2004', { expenses: { classHours: 4, hourRate: 75.25 }, attachments: [{ id: 'i1', category: 'LOCOMOCAO', value: 33.33 }, { id: 'i2', category: 'CAFE', value: 0 }] }),
  ];
  const instructorAllocations: any[] = [
    { id: 'A1', demandId: 'DEM-2001', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A2', demandId: 'DEM-2002', instructorId: 'INS-T', startDate: '2026-08-12T08:00', endDate: '2026-08-12T17:00' },
    { id: 'A3', demandId: 'DEM-2002', instructorId: 'INS-2', startDate: '2026-08-13T08:00', endDate: '2026-08-13T17:00' },
    { id: 'A4', demandId: 'DEM-2003', instructorId: 'INS-T', startDate: '2026-08-14T08:00', endDate: '2026-08-15T17:00' },
    { id: 'A5', demandId: 'DEM-2004', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
  ];
  const companions: any[] = [];
  const participants: any[] = [];
  const templateValues = indexTemplateValues([
    { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120.5 },
    { scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
    { scope: 'training', column_key: 'precoHHOnline', training_id: 'T_HIB', demand_id: null, value: 200.75 },
    { scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-2001', value: 45.5 },
    { scope: 'demand', column_key: 'pctDespesa', training_id: null, demand_id: 'DEM-2002', value: 0.15 },
  ]);
  return {
    template: VALE_TEMPLATE,
    demands, measurements, trainings: TRAININGS, instructors: INSTRUCTORS, companies: COMPANIES,
    instructorAllocations, participants, companions, templateValues, now: HOJE,
  };
}

const NUMERICOS = new Set(['currency', 'number', 'hours', 'integer', 'percent']);

/** Só as colunas numéricas de um dataset de tabela, por linha. */
function colunasNumericas(table: { columns: { key: string; kind: string }[]; rows: unknown[][] }) {
  return table.rows.map(row => {
    const o: Record<string, unknown> = {};
    table.columns.forEach((c, i) => { if (NUMERICOS.has(c.kind)) o[c.key] = row[i] ?? null; });
    return o;
  });
}

/** A foto: só números, chave por superfície. */
export function capturarSuperficies() {
  const src: any = fixtureNumerica();
  const ms = src.measurements;
  const foto: Record<string, unknown> = {};

  foto.parseExpenseValue = itensNumericos().map(a => parseExpenseValue((a as any).value));

  for (const m of ms) {
    const t = computeMeasurementTotals(m);
    foto[`painel:${m.demandId}`] = {
      hospedagem: t.hospedagem, locomocao: t.locomocao, cafe: t.cafe, almoco: t.almoco, jantar: t.jantar, outros: t.outros,
      total: t.total, horaAula: t.horaAula, totalComHoraAula: t.totalComHoraAula,
      naoReembolsavel: t.naoReembolsavel, itensNaoReembolsaveis: t.itensNaoReembolsaveis,
    };
    const q = (b: any) => ({ hospedagem: b.hospedagem, locomocao: b.locomocao, alimentacao: b.alimentacao, outros: b.outros, total: b.total, itens: b.itens, itensOrfaos: b.itensOrfaos });
    foto[`quebra:${m.demandId}`] = {
      todas: q(computePanelExpenseBreakdown(m)),
      naoReembolsa: q(computePanelExpenseBreakdown(m, { itemFilter: isNaoReembolsavel })),
      pagoInstrutor: q(computePanelExpenseBreakdown(m, { itemFilter: isPagoPeloInstrutor })),
    };
    const c = computeClientMeasurementExpenses(m);
    foto[`cliente:${m.demandId}`] = { entram: q(c.entram), naoReembolsavelExcluido: c.naoReembolsavelExcluido, itensExcluidos: c.itensExcluidos };
  }

  const ag = aggregateMeasurements(ms);
  foto.dashboardAgregado = { despesas: ag.despesas, horaAula: ag.horaAula, total: ag.total, naoReembolsavel: ag.naoReembolsavel, itensNaoReembolsaveis: ag.itensNaoReembolsaveis };
  const ab = aggregatePanelExpenseBreakdown(ms);
  foto.dashboardQuebra = { hospedagem: ab.hospedagem, locomocao: ab.locomocao, alimentacao: ab.alimentacao, outros: ab.outros, total: ab.total, medicoes: ab.medicoes };
  const nr = listNonReimbursableByDemand(src);
  foto.dashboardNaoReembolsaveis = { total: nr.total, qtdItens: nr.qtdItens, quebra: nr.quebra, itens: nr.itens.map(i => [i.demandId, i.itemId, i.valor]) };

  // Medição Vale: células numéricas da aba Turmas, linha a linha (híbrida em duas).
  const rows = buildMedicaoValeRows(src);
  const sheet = resolveRowsSheet(VALE_TEMPLATE.sheets[0], toRowsSheetInput(rows, VALE_TEMPLATE), src.templateValues);
  foto.medicaoVale = sheet.rows.map(cells => {
    const o: Record<string, unknown> = {};
    sheet.columns.forEach((col, i) => { if (typeof cells[i].value === 'number') o[col.key] = cells[i].value; });
    return o;
  });
  foto.medicaoValeLinhas = rows.map(r => ({ demanda: r.demand.id, despesas: r.input.despesas, excluido: r.naoReembolsavelExcluido, todas: r.despesasTotalTodas, itens: r.itensDespesa }));

  // BM: por mina, linhas e totais.
  const bm = buildBm(rows.filter(r => r.elegivelTurmas), src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
  foto.bm = bm.minas.map(m => ({
    mina: m.mina,
    linhas: m.linhas.map(l => [l.descricao, l.preco, l.quantidade]),
    totalTreinamentos: m.totalTreinamentos,
    totalDespesas: m.totalDespesas,
    naoReembolsavelExcluido: m.naoReembolsavelExcluido,
  }));

  // Excel de pagamento: reembolso por pessoa.
  const pagamento: Record<string, unknown> = {};
  for (const m of ms) {
    const d = src.demands.find((x: any) => x.id === m.demandId);
    const pessoas = resolveMeasurementPeople(d, src.instructorAllocations, src.participants, src.companions);
    for (const p of pessoas) pagamento[`${m.demandId}:${p.instructorId}`] = reembolsoDaPessoa(m, d, pessoas, p.instructorId);
  }
  foto.pagamento = pagamento;

  // Datasets da aba Exportações.
  foto.datasetDespesas = colunasNumericas(buildTable(DESPESAS_DATASET, buildDespesasRows(src), DESPESAS_DATASET.columns.map(c => c.key)) as any);
  foto.datasetMedicoes = colunasNumericas(buildTable(MEDICOES_DATASET, buildMedicoesRows(src), MEDICOES_DATASET.columns.map(c => c.key)) as any);
  void defaultColumnKeys;

  return foto;
}
