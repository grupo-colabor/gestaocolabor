/**
 * SMOKE — Despesas Não Reembolsáveis: lista por demanda, por item e Excel
 *
 * Rodar com:  npm run smoke:nao-reembolsaveis
 *
 * O card "Despesas Não Reembolsáveis" (Dashboard, aba CUSTOS) passou a ler de
 * `listNonReimbursableByDemand` (domain/nonReimbursableExpenses.ts); a lista
 * expansível e as duas abas do Excel leem o MESMO objeto. Este smoke prende:
 *
 *   [A] Σ dos itens = Σ das demandas = total do card = a conta ANTIGA do card
 *       (`aggregatePanelExpenseBreakdown` com `isNaoReembolsavel`), inclusive
 *       a quebra nos quatro buckets, a contagem de itens e a de medições.
 *   [B] Medição v2 com 2+ pessoas: cada item vai para o dono gravado; item sem
 *       dono e item de dono fora da lista caem no titular principal.
 *   [C] Item com "pago pelo instrutor" + "não reembolsa" aparece UMA vez, com
 *       o indicador ligado; item só "pago pelo instrutor" fica de fora.
 *   [D] Órfão de Outros marcado: fora dos itens, das demandas e do total, mas
 *       contado em `itensOrfaos`. Categoria desconhecida marcada cai em Outros.
 *   [E] Filtro reduz os três juntos: recortar as demandas de entrada reduz
 *       card, lista e abas na mesma medida (e o que sobra continua fechando
 *       com a conta antiga sobre o mesmo recorte).
 *   [F] Abas do Excel (linhas puras): Σ da aba por demanda = Σ da aba por
 *       item = total do card; Σ Qtd itens = contagem de itens; nº de linhas da
 *       aba por demanda = contagem de medições. Bloco da aba Custos:
 *       Café+Almoço+Jantar = Alimentação, e as quatro categorias somam o total.
 *   [G] Escritor (services/exports/dashboardXlsx.ts): o XLSX de verdade tem
 *       a linha de filtros, "Total visível" com SUBTOTAL(109) ACIMA do
 *       cabeçalho, congelamento e autofiltro a partir do cabeçalho, e as
 *       linhas nas posições esperadas. Grava o Excel das fixtures (abas
 *       Custos, por demanda e por item) em C:\tmp para conferência.
 *   [H] Guarda de fonte: os módulos de domínio não importam react, services
 *       nem exceljs; o escritor não importa react nem supabase.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import {
  aggregatePanelExpenseBreakdown,
  isNaoReembolsavel,
} from '../domain/measurementTotals';
import {
  listNonReimbursableByDemand,
  aggregateNonReimbursableByDemand,
  summarizeNonReimbursable,
  buildNonReimbursableByDemandRows,
  buildNonReimbursableByItemRows,
  buildNonReimbursableCustosRows,
  NR_BY_DEMAND_COLUMNS,
  NR_BY_ITEM_COLUMNS,
  type NonReimbursableSource,
} from '../domain/nonReimbursableExpenses';
import { MEASUREMENT_STATUS_LABELS } from '../domain/measurementStatus';
import { describeDashboardFilters } from '../domain/dashboardExportFilters';
import {
  addDashboardMeta,
  addNonReimbursableCustosSection,
  addNonReimbursableSheets,
  NR_SHEET_BY_DEMAND,
  NR_SHEET_BY_ITEM,
  NR_HEADER_ROW,
  NR_TOTAL_ROW,
} from '../services/exports/dashboardXlsx';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
const perto = (nome: string, atual: number, esperado: number) =>
  check(nome, Math.abs(atual - esperado) < 1e-6, `esperado ${esperado}, veio ${atual}`);
const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/* ────────────────────────────── fixtures ────────────────────────────── */

const INSTRUCTORS = [
  { id: 'INS-T', name: 'Titular Principal' },
  { id: 'INS-2', name: 'Segundo Titular' },
  { id: 'INS-A', name: 'Acompanhante Um' },
  { id: 'INS-B', name: 'Titular Solo' },
];
const COMPANIES = [{ id: 'C1', name: 'Vale' }, { id: 'C2', name: 'Outra Mineradora' }];
const TRAININGS = [{ id: 'T1', name: 'NR 35 — Trabalho em Altura' }, { id: 'T2', name: 'NR 10' }];

const demanda = (o: any) => ({
  tipo: 'cliente', companyId: 'C1', trainingId: 'T1', startDate: '2026-08-10', endDate: '2026-08-12',
  corredor: 'Corredor Sul', demandState: 'MG', ...o,
});

// D1 — v2: titular principal + acompanhante. Itens: do acompanhante, sem dono,
// de dono fora da lista, as duas flags juntas, só "pago pelo instrutor"
// (fica fora), órfão de OUTROS marcado, categoria desconhecida marcada.
const D1 = demanda({ id: 'DEM-100', instructorId: 'INS-T' });
const M1: any = {
  id: 'MEA-DEM-100', demandId: 'DEM-100', status: 'CONFERENCIA',
  expenses: {
    classHours: 16, hourRate: 100,
    participantes: [
      { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 },
      { instructorId: 'INS-A', papel: 'ACOMPANHANTE', valorHH: 50 },
    ],
  },
  attachments: [
    { id: 'a1', name: 'uber-locadora.pdf', url: 'https://x/u.pdf', category: 'LOCOMOCAO', value: '45,90', reembolsavel: false, date: '2026-08-10T12:00:00.000Z' },
    { id: 'a2', name: 'jantar.jpg', url: 'https://x/j.jpg', category: 'JANTAR', value: 80, instructorId: 'INS-A', reembolsavel: false, pagoPeloInstrutor: true, date: '2026-08-11T22:00:00.000Z' },
    { id: 'a3', name: 'almoco.jpg', url: 'https://x/a.jpg', category: 'ALMOCO', value: 35, instructorId: 'INS-9', reembolsavel: false, date: '2026-08-11' },
    { id: 'a4', name: 'hotel.pdf', url: 'https://x/h.pdf', category: 'HOSPEDAGEM', value: 300, reembolsavel: false },
    { id: 'a5', name: 'cafe.jpg', url: 'https://x/c.jpg', category: 'CAFE', value: 20, instructorId: 'INS-A', pagoPeloInstrutor: true },
    { id: 'a6', name: 'pedagio.pdf', url: 'https://x/p.pdf', category: 'OUTROS', value: 12.5, otherId: 'O1', reembolsavel: false },
    { id: 'a7', name: 'orfao.pdf', url: 'https://x/o.pdf', category: 'OUTROS', value: 999, otherId: 'APAGADA', reembolsavel: false },
    { id: 'a8', name: 'estranho.pdf', url: 'https://x/e.pdf', category: 'LAVANDERIA', value: 7, reembolsavel: false },
    { id: 'a9', name: 'hotel-ok.pdf', url: 'https://x/h2.pdf', category: 'HOSPEDAGEM', value: 500 },
  ],
  otherExpenses: [{ id: 'O1', description: 'Pedágio BR-040', value: '' }],
};

// D2 — v1 mono-pessoa, titular solo, dois itens marcados.
const D2 = demanda({ id: 'DEM-101', instructorId: 'INS-B', companyId: 'C2', trainingId: 'T2', startDate: '2026-08-20', endDate: '2026-08-20', corredor: 'Corredor Norte', demandState: 'ES' });
const M2: any = {
  id: 'MEA-DEM-101', demandId: 'DEM-101', status: 'LANCAMENTO',
  expenses: { classHours: 8, hourRate: 90 },
  attachments: [
    { id: 'b1', name: 'Valor avulso', category: 'LOCOMOCAO', value: 60, reembolsavel: false, date: '2026-08-20' },
    { id: 'b2', name: 'almoco.jpg', url: 'https://x/b2.jpg', category: 'ALMOCO', value: '18,00', reembolsavel: false },
    { id: 'b3', name: 'hotel.pdf', url: 'https://x/b3.pdf', category: 'HOSPEDAGEM', value: 250 },
  ],
  otherExpenses: [],
};

// D3 — dividida por dias entre dois titulares (v2 por quantidade de pessoas,
// medição mono): item do segundo titular, item sem dono (→ principal).
const D3 = demanda({ id: 'DEM-102', instructorId: 'INS-T', startDate: '2026-09-01', endDate: '2026-09-04' });
const M3: any = {
  id: 'MEA-DEM-102', demandId: 'DEM-102', status: 'PRONTA_FATURAMENTO',
  expenses: { classHours: 32, hourRate: 100 },
  attachments: [
    { id: 'c1', name: 'jantar2.jpg', url: 'https://x/c1.jpg', category: 'JANTAR', value: 55, instructorId: 'INS-2', reembolsavel: false },
    { id: 'c2', name: 'uber.pdf', url: 'https://x/c2.pdf', category: 'LOCOMOCAO', value: 30, reembolsavel: false },
  ],
  otherExpenses: [],
};

// D4 — sem nada marcado: não entra em lugar nenhum.
const D4 = demanda({ id: 'DEM-103', instructorId: 'INS-B' });
const M4: any = {
  id: 'MEA-DEM-103', demandId: 'DEM-103', status: 'FATURADA',
  expenses: { classHours: 8, hourRate: 90 },
  attachments: [{ id: 'd1', name: 'hotel.pdf', url: 'https://x/d1.pdf', category: 'HOSPEDAGEM', value: 400 }],
  otherExpenses: [],
};

// Medição órfã (demanda fora do recorte): ignorada.
const M_ORFA: any = {
  id: 'MEA-DEM-999', demandId: 'DEM-999', status: 'LANCAMENTO',
  expenses: {}, attachments: [{ id: 'z1', name: 'x', category: 'LOCOMOCAO', value: 1000, reembolsavel: false }], otherExpenses: [],
};

const ALLOCATIONS = [
  { id: 'AL-1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10', endDate: '2026-08-12' },
  { id: 'AL-2', demandId: 'DEM-102', instructorId: 'INS-T', startDate: '2026-09-01', endDate: '2026-09-02' },
  { id: 'AL-3', demandId: 'DEM-102', instructorId: 'INS-2', startDate: '2026-09-03', endDate: '2026-09-04' },
];
const COMPANIONS = [{ id: 'CO-1', demandId: 'DEM-100', instructorId: 'INS-A', startDate: '2026-08-10', endDate: '2026-08-12' }];

export const SRC: NonReimbursableSource = {
  demands: [D1, D2, D3, D4] as any,
  measurements: [M1, M2, M3, M4, M_ORFA],
  instructorAllocations: ALLOCATIONS,
  participants: [],
  companions: COMPANIONS,
  instructors: INSTRUCTORS,
  companies: COMPANIES,
  trainings: TRAININGS,
};

// A conta ANTIGA do card: só as medições cuja demanda está no recorte.
const antiga = (ms: any[]) => aggregatePanelExpenseBreakdown(ms, { itemFilter: isNaoReembolsavel });

/* ────────────────────────────── [A] ────────────────────────────── */
console.log('\n[A] Σ itens = Σ demandas = card = conta antiga');
const lista = listNonReimbursableByDemand(SRC);
const cardAntigo = antiga([M1, M2, M3, M4]);
{
  perto('total da lista = total antigo do card', lista.total, cardAntigo.total);
  perto('Σ valor dos itens = total', soma(lista.itens.map(i => i.valor)), lista.total);
  perto('Σ total das demandas = total', soma(lista.demandas.map(d => d.total)), lista.total);
  for (const k of ['hospedagem', 'locomocao', 'alimentacao', 'outros'] as const) {
    perto(`quebra.${k} = antiga`, lista.quebra[k], cardAntigo[k]);
    perto(`Σ demandas.quebra.${k} = quebra.${k}`, soma(lista.demandas.map(d => d.quebra[k])), lista.quebra[k]);
  }
  perto('Σ quatro buckets = total', lista.quebra.hospedagem + lista.quebra.locomocao + lista.quebra.alimentacao + lista.quebra.outros, lista.total);
  perto('café + almoço + jantar = alimentação', lista.subQuebra.cafe + lista.subQuebra.almoco + lista.subQuebra.jantar, lista.quebra.alimentacao);
  eq('contagem de itens = antiga', lista.qtdItens, cardAntigo.itens);
  eq('contagem de medições = antiga', lista.medicoes, cardAntigo.medicoes);
  eq('órfãos contados = antiga', lista.itensOrfaos, cardAntigo.itensOrfaos);
  eq('Σ qtdItens das demandas = itens', soma(lista.demandas.map(d => d.qtdItens)), lista.qtdItens);
  eq('nº de demandas = medições', lista.demandas.length, lista.medicoes);
  eq('ordem: total desc', lista.demandas.map(d => d.demandId), ['DEM-100', 'DEM-102', 'DEM-101']);
  perto('DEM-100 total = 45,90 + 80 + 35 + 300 + 12,5 + 7', lista.demandas[0].total, 45.9 + 80 + 35 + 300 + 12.5 + 7);
  eq('lista.itens segue a ordem das demandas e valor desc', lista.itens.map(i => i.itemId), ['a4', 'a2', 'a1', 'a3', 'a6', 'a8', 'c1', 'c2', 'b1', 'b2']);
  eq('medição órfã (demanda fora do recorte) ignorada', lista.itens.some(i => i.demandId === 'DEM-999'), false);
  eq('demanda sem item marcado não aparece', lista.demandas.some(d => d.demandId === 'DEM-103'), false);
  eq('o resumo é derivado dos itens (mesma função)', summarizeNonReimbursable(lista.itens), {
    quebra: lista.quebra, subQuebra: lista.subQuebra, total: lista.total, qtdItens: lista.qtdItens, medicoes: lista.medicoes,
  });
  eq('a visão por demanda é derivada dos itens (mesma função)',
    aggregateNonReimbursableByDemand(lista.itens).map(d => [d.demandId, d.total, d.qtdItens]),
    lista.demandas.map(d => [d.demandId, d.total, d.qtdItens]));
}

/* ────────────────────────────── [B] ────────────────────────────── */
console.log('\n[B] dono do item: v2 com 2+ pessoas');
{
  const d1 = lista.demandas.find(d => d.demandId === 'DEM-100')!;
  const dono = (id: string) => d1.itens.find(i => i.itemId === id)!;
  eq('item do acompanhante vai para o acompanhante', [dono('a2').instructorId, dono('a2').papel], ['INS-A', 'ACOMPANHANTE']);
  eq('item sem dono cai no titular principal', [dono('a1').instructorId, dono('a1').papel], ['INS-T', 'TITULAR']);
  eq('item de dono fora da lista cai no titular principal', dono('a3').instructorId, 'INS-T');
  eq('pessoas distintas, principal primeiro', d1.pessoas.map(p => p.instructorId), ['INS-T', 'INS-A']);
  eq('rótulo das pessoas: titular sem sufixo, acompanhante com papel', d1.pessoasLabel, 'Titular Principal, Acompanhante Um (Acompanhante)');

  const d3 = lista.demandas.find(d => d.demandId === 'DEM-102')!;
  const dono3 = (id: string) => d3.itens.find(i => i.itemId === id)!;
  eq('dividida: item do segundo titular vai para ele', dono3('c1').instructorId, 'INS-2');
  eq('dividida: item sem dono vai para o principal (demands.instructor_id)', dono3('c2').instructorId, 'INS-T');
  eq('dividida: dois titulares, sem sufixo, principal primeiro', d3.pessoasLabel, 'Titular Principal, Segundo Titular');

  const d2 = lista.demandas.find(d => d.demandId === 'DEM-101')!;
  eq('v1 mono: tudo no titular solo', d2.itens.map(i => i.instructorId), ['INS-B', 'INS-B']);
  eq('rótulos de demanda: empresa, treinamento, corredor, UF', [d2.empresa, d2.treinamento, d2.corredor, d2.uf], ['Outra Mineradora', 'NR 10', 'Corredor Norte', 'ES']);
  eq('status da medição rotulado pelo mapa do domínio', [d1.medicaoStatusLabel, d2.medicaoStatusLabel, d3.medicaoStatusLabel], [MEASUREMENT_STATUS_LABELS.CONFERENCIA, MEASUREMENT_STATUS_LABELS.LANCAMENTO, MEASUREMENT_STATUS_LABELS.PRONTA_FATURAMENTO]);
}

/* ────────────────────────────── [C] ────────────────────────────── */
console.log('\n[C] as duas flags');
{
  const a2 = lista.itens.filter(i => i.itemId === 'a2');
  eq('"pago pelo instrutor" + "não reembolsa" aparece UMA vez', a2.length, 1);
  eq('…com o indicador ligado', a2[0].pagoPeloInstrutor, true);
  eq('só "pago pelo instrutor" fica de fora', lista.itens.some(i => i.itemId === 'a5'), false);
  eq('item reembolsável (sem flag) fica de fora', lista.itens.some(i => i.itemId === 'a9' || i.itemId === 'b3'), false);
  eq('subcategoria só em Alimentação', [a2[0].subcategoria, a2[0].categoriaLabel, lista.itens.find(i => i.itemId === 'a4')!.categoriaLabel], ['Jantar', 'Alimentação · Jantar', 'Hospedagem']);
  eq('descrição: Outros usa a linha; demais o nome do item', [lista.itens.find(i => i.itemId === 'a6')!.descricao, lista.itens.find(i => i.itemId === 'a1')!.descricao], ['Pedágio BR-040', 'uber-locadora.pdf']);
  eq('valor tolera "45,90"', lista.itens.find(i => i.itemId === 'a1')!.valor, 45.9);
}

/* ────────────────────────────── [D] ────────────────────────────── */
console.log('\n[D] órfão e categoria desconhecida');
{
  eq('órfão de OUTROS marcado fora dos itens', lista.itens.some(i => i.itemId === 'a7'), false);
  eq('…e contado', lista.itensOrfaos, 1);
  const a8 = lista.itens.find(i => i.itemId === 'a8')!;
  eq('categoria desconhecida marcada cai em Outros', [a8.bucket, a8.bucketLabel, a8.subcategoria], ['outros', 'Outros', '']);
  perto('Outros = pedágio + desconhecida', lista.quebra.outros, 12.5 + 7);
}

/* ────────────────────────────── [E] ────────────────────────────── */
console.log('\n[E] filtro reduz os três juntos');
{
  const recorte = { ...SRC, demands: [D2, D3] as any, measurements: [M2, M3, M1 /* fora do recorte de demandas */] };
  const l2 = listNonReimbursableByDemand(recorte);
  const antigo2 = antiga([M2, M3]);
  perto('card recortado = conta antiga sobre o recorte', l2.total, antigo2.total);
  eq('lista recortada só com as demandas do recorte', l2.demandas.map(d => d.demandId), ['DEM-102', 'DEM-101']);
  perto('aba por demanda recortada = card recortado', soma(buildNonReimbursableByDemandRows(l2).map(r => r[13] as number)), l2.total);
  perto('aba por item recortada = card recortado', soma(buildNonReimbursableByItemRows(l2).map(r => r[15] as number)), l2.total);
  check('recorte é menor que o total', l2.total < lista.total && l2.qtdItens < lista.qtdItens && l2.medicoes < lista.medicoes);
  const vazio = listNonReimbursableByDemand({ ...SRC, demands: [], measurements: [] });
  eq('recorte vazio: zeros, sem linhas', [vazio.total, vazio.qtdItens, vazio.medicoes, vazio.demandas.length, vazio.itens.length, vazio.itensOrfaos], [0, 0, 0, 0, 0, 0]);
}

/* ────────────────────────────── [F] ────────────────────────────── */
console.log('\n[F] linhas das abas do Excel');
export const porDemanda = buildNonReimbursableByDemandRows(lista);
export const porItem = buildNonReimbursableByItemRows(lista);
const custos = buildNonReimbursableCustosRows(lista);
{
  const iTotal = NR_BY_DEMAND_COLUMNS.findIndex(c => c.header === 'Total');
  const iQtd = NR_BY_DEMAND_COLUMNS.findIndex(c => c.header === 'Qtd itens');
  const iValor = NR_BY_ITEM_COLUMNS.findIndex(c => c.header === 'Valor');
  perto('Σ aba por demanda (Total) = total do card', soma(porDemanda.map(r => r[iTotal] as number)), lista.total);
  perto('Σ aba por item (Valor) = total do card', soma(porItem.map(r => r[iValor] as number)), lista.total);
  eq('Σ Qtd itens = contagem de itens do card', soma(porDemanda.map(r => r[iQtd] as number)), lista.qtdItens);
  eq('nº de linhas da aba por demanda = medições do card', porDemanda.length, lista.medicoes);
  eq('nº de linhas da aba por item = itens do card', porItem.length, lista.qtdItens);
  eq('largura das linhas = nº de colunas', [new Set(porDemanda.map(r => r.length)).size, porDemanda[0].length, porItem[0].length], [1, NR_BY_DEMAND_COLUMNS.length, NR_BY_ITEM_COLUMNS.length]);
  for (const k of ['Hospedagem', 'Locomoção', 'Alimentação', 'Outros'] as const) {
    const i = NR_BY_DEMAND_COLUMNS.findIndex(c => c.header === k);
    const key = ({ Hospedagem: 'hospedagem', Locomoção: 'locomocao', Alimentação: 'alimentacao', Outros: 'outros' } as const)[k];
    perto(`Σ coluna ${k} = quebra do card`, soma(porDemanda.map(r => r[i] as number)), lista.quebra[key]);
  }
  eq('datas em dd/mm/aaaa', [porDemanda[0][3], porDemanda[0][4], porItem[0][13]], ['10/08/2026', '12/08/2026', '']);
  eq('data do item ISO → dd/mm/aaaa', porItem.find(r => r[12] === 'jantar.jpg')![13], '11/08/2026');
  eq('Pago pelo instrutor Sim/Não', [porItem.find(r => r[12] === 'jantar.jpg')![14], porItem[0][14]], ['Sim', 'Não']);

  const val = (label: string) => custos.find(r => r.label === label)!.value;
  perto('bloco Custos: Café + Almoço + Jantar = Alimentação', val('Café da manhã') + val('Almoço') + val('Jantar'), val('Alimentação'));
  perto('bloco Custos: quatro categorias = total', val('Hospedagem') + val('Locomoção') + val('Alimentação') + val('Outros'), val('Total não reembolsável'));
  eq('bloco Custos: itens e medições', [val('Itens'), val('Medições')], [lista.qtdItens, lista.medicoes]);
  eq('bloco Custos: as três refeições indentadas', custos.filter(r => r.sub).map(r => r.label), ['Café da manhã', 'Almoço', 'Jantar']);
}

/* ────────────────────────────── [G] ────────────────────────────── */
const colLetter = (n: number): string => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

async function escritor() {
  console.log('\n[G] escritor XLSX: filtros, SUBTOTAL acima do cabeçalho, congelamento, autofiltro');
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;
  const wb = new ExcelJS.Workbook();

  const filtros = describeDashboardFilters({ periodo: 'Todo o período', empresa: 'Vale', regiao: '', status: '', local: '', corredor: '', modalidade: '', uf: 'MG' });
  eq('linha de filtros', filtros, 'P1: Todo o período · Empresa: Vale · UF: MG');
  eq('linha de filtros sem nada', describeDashboardFilters({ periodo: '' }), 'P1: Todo o período · Sem outros filtros');
  const exportadoEm = '27/10/2026';

  const wsCustos = wb.addWorksheet('Custos');
  wsCustos.columns = [{ width: 28 }, { width: 20 }, { width: 20 }, { width: 20 }];
  addDashboardMeta(wsCustos, 'Custos', filtros, exportadoEm);
  addNonReimbursableCustosSection(wsCustos, lista);
  addNonReimbursableSheets(wb, lista, { filtros, exportadoEm });

  const buffer = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);

  const num = (v: any): number => (v && typeof v === 'object' && 'result' in v ? Number(v.result) : Number(v));
  const texto = (v: any): string => (v && typeof v === 'object' && 'richText' in v ? v.richText.map((r: any) => r.text).join('') : String(v ?? ''));

  // Custos: meta + filtros + bloco
  const c = wb2.getWorksheet('Custos')!;
  eq('Custos: título na A1', texto(c.getCell('A1').value), 'Dashboard Colabor — Custos');
  eq('Custos: "Exportado em" na C1', texto(c.getCell('C1').value), `Exportado em: ${exportadoEm}`);
  eq('Custos: filtros na A2', texto(c.getCell('A2').value), `Filtros: ${filtros}`);
  const rotulos: string[] = [];
  c.eachRow((row: any, n: number) => { rotulos[n] = texto(row.getCell(1).value); });
  check('Custos: bloco "Despesas Não Reembolsáveis" presente', rotulos.includes('Despesas Não Reembolsáveis'));
  const iTotalRow = rotulos.indexOf('Total não reembolsável');
  perto('Custos: total do bloco é número = card', num(c.getRow(iTotalRow).getCell(2).value), lista.total);
  eq('Custos: refeições indentadas sob Alimentação', [rotulos[iTotalRow + 5], rotulos[iTotalRow + 6], rotulos[iTotalRow + 7], rotulos[iTotalRow + 8]], ['Alimentação', '   Café da manhã', '   Almoço', '   Jantar']);
  perto('Custos: Café + Almoço + Jantar no arquivo = Alimentação', [6, 7, 8].reduce((s, k) => s + num(c.getRow(iTotalRow + k).getCell(2).value), 0), num(c.getRow(iTotalRow + 5).getCell(2).value));

  for (const [nome, cols, linhas, iSum] of [
    [NR_SHEET_BY_DEMAND, NR_BY_DEMAND_COLUMNS, porDemanda, 13],
    [NR_SHEET_BY_ITEM, NR_BY_ITEM_COLUMNS, porItem, 15],
  ] as const) {
    const ws = wb2.getWorksheet(nome)!;
    check(`${nome}: aba existe`, !!ws);
    eq(`${nome}: cabeçalho na linha ${NR_HEADER_ROW}`, cols.map((_, i) => texto(ws.getRow(NR_HEADER_ROW).getCell(i + 1).value)), cols.map(x => x.header));
    eq(`${nome}: filtros na A2`, texto(ws.getCell('A2').value), `Filtros: ${filtros}`);
    eq(`${nome}: "Total visível" na linha ${NR_TOTAL_ROW}, acima do cabeçalho`, texto(ws.getRow(NR_TOTAL_ROW).getCell(1).value), 'Total visível');
    const f = ws.getRow(NR_TOTAL_ROW).getCell(iSum + 1).value as any;
    const formula = f && typeof f === 'object' && 'formula' in f ? String(f.formula) : '';
    const ultima = NR_HEADER_ROW + linhas.length;
    const L = colLetter(iSum + 1);
    eq(`${nome}: SUBTOTAL(109) sobre as linhas de dados`, formula, `SUBTOTAL(109,${L}${NR_HEADER_ROW + 1}:${L}${Math.max(NR_HEADER_ROW + 1, ultima)})`);
    eq(`${nome}: congelado a partir do cabeçalho`, (ws.views ?? [])[0]?.ySplit, NR_HEADER_ROW);
    // Lido de volta, o autofiltro vem como intervalo A1 ("A4:O7").
    eq(`${nome}: autofiltro do cabeçalho à última linha`, ws.autoFilter, `A${NR_HEADER_ROW}:${colLetter(cols.length)}${Math.max(NR_HEADER_ROW, ultima)}`);
    eq(`${nome}: ${linhas.length} linhas de dados a partir da ${NR_HEADER_ROW + 1}`, linhas.map((_, i) => texto(ws.getRow(NR_HEADER_ROW + 1 + i).getCell(1).value)), linhas.map(r => String(r[0])));
    perto(`${nome}: Σ da coluna somada no arquivo = card`, soma(linhas.map((_, i) => num(ws.getRow(NR_HEADER_ROW + 1 + i).getCell(iSum + 1).value))), lista.total);
    eq(`${nome}: nada abaixo da última linha`, ws.getRow(ultima + 1).getCell(1).value ?? null, null);
  }
  const qtdCol = NR_BY_DEMAND_COLUMNS.findIndex(x => x.header === 'Qtd itens') + 1;
  const fq = wb2.getWorksheet(NR_SHEET_BY_DEMAND)!.getRow(NR_TOTAL_ROW).getCell(qtdCol).value as any;
  check('por demanda: "Qtd itens" também tem SUBTOTAL', fq && typeof fq === 'object' && String(fq.formula).startsWith('SUBTOTAL(109,'));

  // Excel das fixtures para conferência (abas Custos, por demanda, por item).
  const TMP = 'C:\\tmp';
  try { fs.mkdirSync(TMP, { recursive: true }); } catch { /* sem permissão: pula a gravação */ }
  if (fs.existsSync(TMP)) {
    const arquivo = path.join(TMP, 'dashboard-custos_fixtures-nao-reembolsaveis.xlsx');
    fs.writeFileSync(arquivo, Buffer.from(buffer));
    check(`XLSX das fixtures gravado em ${arquivo}`, fs.statSync(arquivo).size > 5_000);
  } else {
    check('XLSX das fixtures (C:\\tmp ausente — pulado)', true);
  }
}

/* ────────────────────────────── [H] ────────────────────────────── */
function guardaDeFonte() {
  console.log('\n[H] guarda de fonte');
  // O bundle roda de node_modules/.cache: a raiz do projeto é o cwd, não __dirname.
  const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const rel of ['domain/nonReimbursableExpenses.ts', 'domain/measurementStatus.ts', 'domain/dashboardExportFilters.ts']) {
    const src = semComentarios(ler(rel));
    check(`${rel} não importa react/services/exceljs/supabase`, !/from\s+['"](react|exceljs|@supabase)|\/services\//.test(src));
  }
  const svc = semComentarios(ler('services/exports/dashboardXlsx.ts'));
  check('services/exports/dashboardXlsx.ts não importa react nem supabase', !/from\s+['"](react|@supabase)/.test(svc));
}

escritor()
  .then(() => {
    guardaDeFonte();
    console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch(e => { console.error(e); process.exit(1); });
