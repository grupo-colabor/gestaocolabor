/**
 * SMOKE — Rankings por período do Dashboard (todas as abas)
 *
 * Rodar com:  npm run smoke:dashboard-volume
 *
 * A regra que este script prende: NENHUM ranking do Dashboard recalcula. Cada
 * célula (linha × período) é `computeVolume` sobre o sub-recorte daquela chave
 * — a mesma função que dá "Total de Demandas", "Total de Horas" e "Total em
 * Despesas" no topo. Logo "Volume por Local → Brucutu → P1" tem que ser igual
 * ao que o KPI mostraria com o filtro "Local = Brucutu" ligado; "Top
 * Instrutores por Custo → Bruno → P1" igual a "Total em Despesas" recortado
 * pelas demandas do Bruno; e assim por diante. Aqui isso deixa de ser
 * intenção: os dois caminhos são executados e comparados, cartão a cartão.
 *
 * Os dois rankings de horas MINISTRADAS (Instrutores e Internas) não somam
 * demandas: leem os mapas de computeInstructorHours (a fonte única do rateio)
 * por um adaptador sem aritmética, e só o ranqueamento é compartilhado. O
 * bloco [15] prende que o adaptador copia, não calcula.
 *
 * Fixture: 2 períodos (P1 = set/26, P2 = ago/26), 3 locais — um deles
 * (Itabira) só existe em P2 e tem que aparecer com P1 = 0, não sumir —, 3
 * instrutores, 2 empresas, medições com despesas e um lote de internas.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import {
  computeVolume,
  rankVolumeByPeriod,
  rankVolumeRows,
  volumeRowsFromInstructorHours,
  volumeValue,
  volumeVariation,
  ZERO_VOLUME,
  type VolumeMetric,
  type VolumeRanking,
} from '../domain/dashboardVolume';
import { demandIntersectsRange } from '../domain/demandDays';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

function checkEq(nome: string, atual: unknown, esperado: unknown) {
  const a = JSON.stringify(atual);
  const e = JSON.stringify(esperado);
  check(nome, a === e, `esperado ${e}, veio ${a}`);
}

const Z = { ...ZERO_VOLUME };
const T = (count: number, hours: number, cost = 0, distinct = 0) => ({ count, hours, cost, distinct });

/* ========================================================================== */
/* Fixture                                                                    */
/* ========================================================================== */

const trainings = [
  { id: 'T8',  name: 'NR 10 Básico', hours: 8 },
  { id: 'T16', name: 'NR 35 Altura', hours: 16 },
  { id: 'T40', name: 'NR 33 Espaço Confinado', hours: 40 },
];
const instructors = [
  { id: 'I-A', name: 'Ana Souza Lima', status: 'ATIVO' },
  { id: 'I-B', name: 'Bruno Costa', status: 'ATIVO' },
  { id: 'I-C', name: 'Carla Dias Mendes', status: 'ATIVO' },
];
const companies = [
  { id: 'E1', name: 'Vale' },
  { id: 'E2', name: 'Samarco' },
];
const hoursOf = (d: any) => trainings.find(t => t.id === d.trainingId)?.hours ?? 0;
const trainingName = (id: string) => trainings.find(t => t.id === id)?.name ?? 'N/A';
const instructorName = (id: string) => instructors.find(i => i.id === id)?.name ?? id;
const instructorShortName = (id: string) => instructorName(id).split(' ').slice(0, 2).join(' ');
const companyName = (id: string) => companies.find(c => c.id === id)?.name ?? 'N/A';

let seq = 0;
const dem = (trainingId: string, day: string, over: Record<string, any> = {}) => ({
  id: `DEM-${++seq}`,
  tipo: 'cliente',
  trainingId,
  dateMode: 'CONTINUO',
  startDate: day,
  endDate: day,
  trainingLocal: 'Brucutu',
  corredor: 'Corredor Sudeste',
  demandState: 'MG',
  companyId: 'E1',
  instructorId: 'I-A',
  status: 'CONCLUIDA',
  ...over,
});

const demands: any[] = [
  // Brucutu — P1: 3 demandas (40h); P2: 2 demandas (16h)
  dem('T8',  '2026-09-02'),                                                   // 1  I-A E1
  dem('T16', '2026-09-08'),                                                   // 2  I-A E1
  dem('T16', '2026-09-15', { instructorId: 'I-B' }),                          // 3  I-B E1
  dem('T8',  '2026-08-05'),                                                   // 4  I-A E1
  dem('T8',  '2026-08-12'),                                                   // 5  I-A E1
  // Carajás — P1: 1 demanda (40h, empata em horas com Brucutu); P2: 1 (8h)
  dem('T40', '2026-09-21', { trainingLocal: 'Carajás', corredor: 'Corredor Norte', demandState: 'PA', companyId: 'E2', instructorId: 'I-B' }), // 6
  dem('T8',  '2026-08-19', { trainingLocal: 'Carajás', corredor: 'Corredor Norte', demandState: 'PA', companyId: 'E2', instructorId: 'I-C' }), // 7
  // Itabira — SÓ em P2: 4 demandas (64h). É o maior valor em ambas as métricas.
  dem('T16', '2026-08-03', { trainingLocal: 'Itabira', corredor: 'N.A', instructorId: 'I-C' }),                        // 8
  dem('T16', '2026-08-10', { trainingLocal: 'Itabira', corredor: 'N.A', instructorId: 'I-C' }),                        // 9
  dem('T16', '2026-08-17', { trainingLocal: 'Itabira', corredor: 'N.A', instructorId: 'I-B' }),                        // 10
  dem('T16', '2026-08-24', { trainingLocal: 'Itabira', corredor: 'N.A', instructorId: undefined, status: 'ALOCADA' }), // 11
  // Sem local — ficam fora do ranking de Local, mas CONTAM no total do período.
  dem('T40', '2026-09-28', { trainingLocal: '',    corredor: 'Corredor Sudeste', demandState: 'ES', companyId: 'E2', instructorId: undefined, status: 'PENDENTE' }), // 12
  dem('T40', '2026-08-26', { trainingLocal: '   ', corredor: undefined,          demandState: 'ES', companyId: 'E2', status: 'ALOCADA' }),                           // 13 I-A
];

// Medições: duas na mesma demanda (DEM-2) para provar que o custo por demanda
// soma TODAS as medições dela; valores como texto com vírgula, como no banco.
const measurements: any[] = [
  { demandId: 'DEM-1',  attachments: [{ value: 100 }, { value: '50,5' }] },  // 150.5
  { demandId: 'DEM-2',  attachments: [{ value: 30 }] },
  { demandId: 'DEM-2',  attachments: [{ value: '20' }] },                     // DEM-2 = 50
  { demandId: 'DEM-6',  attachments: [{ value: 1000 }] },
  { demandId: 'DEM-8',  attachments: [{ value: 200 }] },
  { demandId: 'DEM-13', attachments: [{ value: 300 }, { value: 'abc' }] },    // 300 (inválido = 0)
];
// A MESMA leitura de valor do Dashboard (attachmentValue / toVal).
const attachmentValue = (v: any) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number(n) || 0; };
const costByDemandId = new Map<string, number>();
for (const m of measurements) {
  const itens = m.attachments.reduce((s: number, a: any) => s + attachmentValue(a.value), 0);
  costByDemandId.set(m.demandId, (costByDemandId.get(m.demandId) ?? 0) + itens);
}
const costOf = (d: any) => costByDemandId.get(d.id) ?? 0;

// O recorte por período é o do Dashboard: demandIntersectsRange sobre o filtro.
const recorte = (start: string, end: string) => demands.filter(d => demandIntersectsRange(d, start, end));
const P1 = recorte('2026-09-01', '2026-09-30');
const P2 = recorte('2026-08-01', '2026-08-31');
const periods = [P1, P2];

const local = (metric: VolumeMetric, limit?: number) =>
  rankVolumeByPeriod({ periods, keyOf: d => d.trainingLocal, hoursOf, metric, limit });

const todas = (r: VolumeRanking) => [...r.items, ...r.othersDetail];
const linha = (r: VolumeRanking, key: string) => todas(r).find(x => x.key === key);

/**
 * A igualdade central, genérica: para toda linha do ranking e todo período, o
 * valor da célula tem que ser computeVolume sobre "o recorte do período
 * filtrado pela chave" — exatamente o que o KPI do topo mostraria com esse
 * filtro ligado. `filtroDaTela` é como a tela compara a chave.
 */
function igualdadeCartaoKpi(
  nome: string,
  r: VolumeRanking,
  recortes: any[][],
  filtroDaTela: (d: any, key: string) => boolean,
  metric: VolumeMetric,
  extras: { costOf?: (d: any) => number; distinctOf?: (d: any) => string | null | undefined } = {},
  horas: (d: any) => number = hoursOf,
) {
  const divergencias: string[] = [];
  let celulas = 0;
  for (const row of todas(r)) {
    recortes.forEach((rec, i) => {
      const kpi = volumeValue(computeVolume(rec.filter(d => filtroDaTela(d, row.key)), horas, extras), metric);
      const cartao = volumeValue(row.periods[i], metric);
      celulas++;
      if (kpi !== cartao) divergencias.push(`${row.name} P${i + 1}: cartão ${cartao} ≠ KPI ${kpi}`);
    });
  }
  check(`${nome}: toda celula (${celulas}) bate com o KPI filtrado`, celulas > 0 && divergencias.length === 0, divergencias.join(' | ') || 'sem células');
}

/* ========================================================================== */
/* [1] computeVolume é a conta dos KPIs do topo                               */
/* ========================================================================== */
console.log('\n[1] computeVolume: contagem, horas, custo e distintos do recorte inteiro');

checkEq('P1: 5 demandas', computeVolume(P1, hoursOf).count, 5);
checkEq('P1: 8+16+16+40+40 = 120h', computeVolume(P1, hoursOf).hours, 120);
checkEq('P2: 8 demandas', computeVolume(P2, hoursOf).count, 8);
checkEq('P2: 8+8+8+64+40 = 128h', computeVolume(P2, hoursOf).hours, 128);
checkEq('recorte vazio: zero em tudo', computeVolume([], hoursOf), Z);
checkEq('sem costOf/distinctOf: cost e distinct ficam 0', computeVolume(P1, hoursOf), T(5, 120));
checkEq('carga inválida conta 0h, não NaN', computeVolume([{ trainingId: 'X' }], () => NaN as any).hours, 0);
checkEq('custo P1 = 150.5 + 50 + 1000 (DEM-1, DEM-2 com duas medições, DEM-6)', computeVolume(P1, hoursOf, { costOf }).cost, 1200.5);
checkEq('custo P2 = 200 + 300 (item "abc" vale 0)', computeVolume(P2, hoursOf, { costOf }).cost, 500);
checkEq('distintos: treinamentos distintos em P1 = 3', computeVolume(P1, hoursOf, { distinctOf: d => d.trainingId }).distinct, 3);
checkEq('distintos ignora vazio/nulo', computeVolume([{ k: '' }, { k: null }, { k: 'x' }, { k: 'x' }], () => 0, { distinctOf: (d: any) => d.k }).distinct, 1);

/* ========================================================================== */
/* [2] A igualdade: cartão × (filtro por local + KPI do topo)                 */
/* ========================================================================== */
console.log('\n[2] Volume por Local (Geral): cartao = KPI do topo com "Local = X" ligado');

for (const metric of ['count', 'hours'] as VolumeMetric[]) {
  igualdadeCartaoKpi(`[${metric}] Local`, local(metric), periods, (d, key) => (d.trainingLocal ?? '') === key, metric);
}

// Contraprova: a soma do ranking NÃO fecha com o total do período, porque as
// duas demandas sem local ficam fora do ranking mas dentro do KPI. Esse é o
// comportamento certo — e mostra que a igualdade acima é por célula, não é um
// "tudo soma igual" que passaria com qualquer conta.
{
  const r = local('count');
  const somaRanking = todas(r).reduce((s, x) => s + x.periods[0].count, 0);
  checkEq('contraprova: ranking de P1 soma 4 (a demanda sem local fica fora)', somaRanking, 4);
  checkEq('...enquanto o KPI do periodo P1 conta 5', computeVolume(P1, hoursOf).count, 5);
}

/* ========================================================================== */
/* [3] Linhas, valores e ordem                                                */
/* ========================================================================== */
console.log('\n[3] Qtd. Treinamentos: linhas, P1 = 0 para quem so existe em P2, ordem por P1');

{
  const r = local('count');
  checkEq('3 linhas, nenhuma oculta (limite 10)', [r.items.length, r.othersDetail.length], [3, 0]);
  checkEq('ordem por P1 desc: Brucutu, Carajás, Itabira', r.items.map(x => x.name), ['Brucutu', 'Carajás', 'Itabira']);
  checkEq('sem labelOf, name = key', r.items.every(x => x.name === x.key), true);
  checkEq('Brucutu: P1 = 3, P2 = 2', r.items[0].periods.map(p => p.count), [3, 2]);
  checkEq('Carajás: P1 = 1, P2 = 1', r.items[1].periods.map(p => p.count), [1, 1]);
  checkEq('Itabira APARECE com P1 = 0 e P2 = 4 (nao some)', r.items[2].periods, [Z, T(4, 64)]);
  checkEq('cada linha tem um VolumeTotals por periodo', r.items.every(x => x.periods.length === 2), true);
  checkEq('sem "Outros" quando cabe tudo', r.others, null);
  checkEq('max = 4: o maior valor esta em P2 (Itabira), nao em P1', r.max, 4);
  checkEq('locais vazio e so-espacos nao viram linha', todas(r).some(x => !x.name.trim()), false);
}

console.log('\n[4] Horas: mesma estrutura, empate em P1 desempata pelo nome');

{
  const r = local('hours');
  checkEq('Brucutu e Carajás empatam em P1 (40h) e Brucutu vem antes pelo nome', r.items.slice(0, 2).map(x => x.name), ['Brucutu', 'Carajás']);
  checkEq('Brucutu: 40h / 16h', r.items[0].periods.map(p => p.hours), [40, 16]);
  checkEq('Carajás: 40h / 8h', r.items[1].periods.map(p => p.hours), [40, 8]);
  checkEq('Itabira: 0h / 64h', r.items[2].periods.map(p => p.hours), [0, 64]);
  checkEq('max = 64 (Itabira em P2) — a escala e comum a todos os periodos', r.max, 64);
  // Local presente só em P2 aparece com P1 = 0 também em Horas; e um local cujo
  // treinamento tem 0h em todos os períodos continua listado (só Custo descarta).
  checkEq('local so em P2 (Itabira): P1 = 0h, nao some', linha(r, 'Itabira')?.periods[0].hours, 0);
  const comZeroHoras = rankVolumeByPeriod({ periods: [[dem('T0', '2026-09-03', { id: 'Z1', trainingLocal: 'Zerado' })], []], keyOf: d => d.trainingLocal, hoursOf, metric: 'hours' });
  checkEq('local com treinamento de 0h em todos os periodos fica, com 0h', comZeroHoras.items.map(x => [x.name, ...x.periods.map(p => p.hours)]), [['Zerado', 0, 0]]);
  const nomesCount = local('count').items.map(x => x.name).sort();
  const nomesHours = r.items.map(x => x.name).sort();
  checkEq('toggle Qtd/Horas: mesmas linhas, so a metrica muda', nomesHours, nomesCount);
}

/* ========================================================================== */
/* [5] "Outros" soma por período                                              */
/* ========================================================================== */
console.log('\n[5] "+N ocultos" e "Outros" somam periodo a periodo');

{
  const r = local('count', 1);
  checkEq('limite 1: 1 visivel, 2 ocultos', [r.items.length, r.othersDetail.length], [1, 2]);
  checkEq('visivel e Brucutu', r.items[0].name, 'Brucutu');
  checkEq('ocultos mantem a ordem do ranking', r.othersDetail.map(x => x.name), ['Carajás', 'Itabira']);
  checkEq('Outros: P1 = 1 (so Carajás), P2 = 1 + 4 = 5', r.others?.periods.map(p => p.count), [1, 5]);
  checkEq('Outros em horas: P1 = 40, P2 = 8 + 64 = 72', r.others?.periods.map(p => p.hours), [40, 72]);
  checkEq('max continua o das linhas individuais (4), nao o de Outros (5)', r.max, 4);
}

/* ========================================================================== */
/* [6] Um período só: fica como sempre foi                                    */
/* ========================================================================== */
console.log('\n[6] Um periodo so');

{
  const r = rankVolumeByPeriod({ periods: [P1], keyOf: d => d.trainingLocal, hoursOf, metric: 'count' });
  checkEq('2 linhas (Itabira nao existe em P1, entao nao ha o que mostrar)', r.items.map(x => x.name), ['Brucutu', 'Carajás']);
  checkEq('uma barra por linha', r.items.every(x => x.periods.length === 1), true);
  checkEq('valores', r.items.map(x => x.periods[0].count), [3, 1]);
  const vazio = rankVolumeByPeriod({ periods: [[]], keyOf: (d: any) => d.trainingLocal, hoursOf, metric: 'count' });
  checkEq('recorte vazio: sem linhas, max 0, sem Outros', [vazio.items.length, vazio.max, vazio.others], [0, 0, null]);
}

/* ========================================================================== */
/* [7] Corredor e UF passam pela MESMA função; "N.A" é dado, fica              */
/* ========================================================================== */
console.log('\n[7] Corredor e UF: mesma funcao, so muda a chave');

{
  const corredor = rankVolumeByPeriod({ periods, keyOf: d => d.corredor, hoursOf, metric: 'count' });
  checkEq('corredores: Sudeste (P1 4), Norte (P1 1), N.A (P1 0)', corredor.items.map(x => [x.name, x.periods[0].count, x.periods[1].count]),
    [['Corredor Sudeste', 4, 2], ['Corredor Norte', 1, 1], ['N.A', 0, 4]]);
  check('"N.A" NAO e filtrado nem renomeado (fora do escopo: e dado de demanda antiga)', corredor.items.some(x => x.name === 'N.A'));
  checkEq('corredor undefined fica fora (a demanda de ago sem corredor)', corredor.items.reduce((s, x) => s + x.periods[1].count, 0), 7);
  igualdadeCartaoKpi('Corredor', corredor, periods, (d, key) => (d.corredor ?? '') === key, 'count');

  const uf = rankVolumeByPeriod({ periods, keyOf: d => d.demandState, hoursOf, metric: 'hours' });
  checkEq('UF em horas: MG (40/80), PA (40/8), ES (40/40) — empate triplo em P1, ordem pelo nome', uf.items.map(x => [x.name, ...x.periods.map(p => p.hours)]),
    [['ES', 40, 40], ['MG', 40, 80], ['PA', 40, 8]]);
  igualdadeCartaoKpi('UF', uf, periods, (d, key) => (d.demandState ?? '') === key, 'hours');
}

/* ========================================================================== */
/* [8] Variação de P1 contra P2, no contrato dos KPIs                          */
/* ========================================================================== */
console.log('\n[8] Variacao P1 x P2');

checkEq('8 contra 11: -3 (-27%)', volumeVariation(8, 11), { delta: -3, pct: -27 });
checkEq('11 contra 8: +3 (+38%)', volumeVariation(11, 8), { delta: 3, pct: 38 });
checkEq('0 contra 4: -4 (-100%) — o local que so existe em P2', volumeVariation(0, 4), { delta: -4, pct: -100 });
checkEq('5 contra 0: +5, sem percentual (base zero)', volumeVariation(5, 0), { delta: 5, pct: null });
checkEq('0 contra 0: 0, sem percentual', volumeVariation(0, 0), { delta: 0, pct: null });
checkEq('horas fracionadas: 12.5 contra 10', volumeVariation(12.5, 10), { delta: 2.5, pct: 25 });

/* ========================================================================== */
/* [9] OPERACIONAL — Top Treinamentos (chave: trainingId, métrica: Qtd)        */
/* ========================================================================== */
console.log('\n[9] Operacional / Top Treinamentos: chave trainingId, rotulo = nome, Qtd');

{
  const r = rankVolumeByPeriod({ periods, keyOf: d => d.trainingId, labelOf: trainingName, hoursOf, metric: 'count', limit: 8 });
  igualdadeCartaoKpi('Top Treinamentos', r, periods, (d, key) => d.trainingId === key, 'count');
  checkEq('a chave e o id (o que um filtro compararia); o nome e so rotulo', r.items.map(x => [x.key, x.name]),
    [['T40', 'NR 33 Espaço Confinado'], ['T16', 'NR 35 Altura'], ['T8', 'NR 10 Básico']]);
  checkEq('valores P1/P2: NR 33 2/1, NR 35 2/4, NR 10 1/3', r.items.map(x => x.periods.map(p => p.count)), [[2, 1], [2, 4], [1, 3]]);
  check('NR 33 e NR 35 empatam em P1 (2) e a ordem e pelo NOME exibido ("NR 33" < "NR 35"), nao pela chave (T16 < T40)', r.items[0].name < r.items[1].name && r.items[0].key > r.items[1].key);
}

/* ========================================================================== */
/* [10] OPERACIONAL — Demandas por Instrutor (chave: instructorId, Qtd)        */
/* ========================================================================== */
console.log('\n[10] Operacional / Demandas por Instrutor: chave instructorId (da demanda), Qtd');

{
  const r = rankVolumeByPeriod({ periods, keyOf: d => d.instructorId, labelOf: instructorName, hoursOf, metric: 'count', limit: 8 });
  igualdadeCartaoKpi('Demandas por Instrutor', r, periods, (d, key) => d.instructorId === key, 'count');
  checkEq('demanda sem instrutor nao vira linha', todas(r).some(x => x.key === 'undefined' || !x.key), false);
  checkEq('Ana 2/3, Bruno 2/1, Carla 0/3 — Carla so em P2 e APARECE', r.items.map(x => [x.name, ...x.periods.map(p => p.count)]),
    [['Ana Souza Lima', 2, 3], ['Bruno Costa', 2, 1], ['Carla Dias Mendes', 0, 3]]);
  const top1 = rankVolumeByPeriod({ periods, keyOf: d => d.instructorId, labelOf: instructorName, hoursOf, metric: 'count', limit: 1 });
  checkEq('limite 8 como antes; abaixo dele, os demais somam em Outros (antes eram descartados)', top1.others?.periods.map(p => p.count), [2, 4]);
}

/* ========================================================================== */
/* [11] CLIENTES — Clientes mais Ativos (chave: companyId, Qtd)                */
/* ========================================================================== */
console.log('\n[11] Clientes / Clientes mais Ativos: chave companyId, Qtd');

{
  const r = rankVolumeByPeriod({ periods, keyOf: d => d.companyId, labelOf: companyName, hoursOf, metric: 'count', limit: 8 });
  igualdadeCartaoKpi('Clientes mais Ativos', r, periods, (d, key) => d.companyId === key, 'count');
  checkEq('Vale 3/6, Samarco 2/2', r.items.map(x => [x.name, ...x.periods.map(p => p.count)]), [['Vale', 3, 6], ['Samarco', 2, 2]]);
}

/* ========================================================================== */
/* [12] CUSTOS — Top Instrutores por Custo (chave: instructorId, métrica: custo) */
/* ========================================================================== */
console.log('\n[12] Custos / Top Instrutores por Custo: computeVolume(...).cost = "Total em Despesas" recortado');

{
  const r = rankVolumeByPeriod({ periods, keyOf: d => d.instructorId, labelOf: instructorShortName, hoursOf, costOf, metric: 'cost', limit: 8 });
  igualdadeCartaoKpi('Top Instrutores por Custo', r, periods, (d, key) => d.instructorId === key, 'cost', { costOf });

  // A conta do KPI "Total em Despesas" como sempre foi: soma dos itens das
  // MEDIÇÕES cujas demandas estão no recorte. Tem que dar o mesmo que
  // computeVolume(...).cost sobre as demandas — inclusive com duas medições
  // na mesma demanda.
  const kpiComoSempre = (rec: any[]) => {
    const ids = new Set(rec.map(d => d.id));
    return measurements.filter(m => ids.has(m.demandId))
      .reduce((acc, m) => acc + m.attachments.reduce((s: number, a: any) => s + attachmentValue(a.value), 0), 0);
  };
  checkEq('KPI pela medicao (como sempre) = computeVolume(...).cost pela demanda, P1', kpiComoSempre(P1), computeVolume(P1, hoursOf, { costOf }).cost);
  checkEq('idem P2', kpiComoSempre(P2), computeVolume(P2, hoursOf, { costOf }).cost);
  checkEq('Bruno 1000/0, Ana 200.5/300, Carla 0/200 — ordem por custo de P1', r.items.map(x => [x.name, ...x.periods.map(p => p.cost)]),
    [['Bruno Costa', 1000, 0], ['Ana Souza', 200.5, 300], ['Carla Dias', 0, 200]]);
  checkEq('rotulo compacto (duas primeiras palavras), como o cartao sempre mostrou', r.items[1].name, 'Ana Souza');
  checkEq('max = 1000 (Bruno P1)', r.max, 1000);
  // Instrutor com demanda mas sem despesa em NENHUM período não entra: não há
  // o que ranquear por custo (o cartão antigo já filtrava value > 0).
  const semDespesa = rankVolumeByPeriod({ periods: [[dem('T8', '2026-09-03', { id: 'X1', instructorId: 'I-Z' })]], keyOf: d => d.instructorId, hoursOf, costOf, metric: 'cost' });
  checkEq('instrutor sem despesa em periodo nenhum nao aparece em "por Custo"', semDespesa.items.length, 0);
}

/* ========================================================================== */
/* [13] INSTRUTORES — Reaproveitamento (chave: instructorId, métrica: distintos) */
/* ========================================================================== */
console.log('\n[13] Instrutores / Reaproveitamento: treinamentos DISTINTOS concluidos, por periodo');

{
  // O recorte é o do KPI "Reaproveitamento": concluída e com instrutor.
  const concluidas = periods.map(rec => rec.filter(d => d.instructorId && d.status === 'CONCLUIDA'));
  const distinctOf = (d: any) => d.trainingId;
  const r = rankVolumeByPeriod({ periods: concluidas, keyOf: d => d.instructorId, labelOf: instructorShortName, hoursOf, distinctOf, metric: 'distinct', limit: 8 });
  igualdadeCartaoKpi('Reaproveitamento', r, concluidas, (d, key) => d.instructorId === key, 'distinct', { distinctOf });
  // ...e contra a definição literal do KPI (tamanho do Set), não só contra computeVolume.
  const setSize = (rec: any[], id: string) => new Set(rec.filter(d => d.instructorId === id).map(d => d.trainingId)).size;
  const divergentes = todas(r).flatMap(row => concluidas.map((rec, i) => setSize(rec, row.key) === row.periods[i].distinct ? null : `${row.key} P${i + 1}`)).filter(Boolean);
  check('cada celula = new Set(trainingIds).size, a definicao do KPI', divergentes.length === 0, divergentes.join(', '));
  checkEq('Ana 2/1, Bruno 2/1, Carla 0/2 — empate em P1 desempata pelo nome', r.items.map(x => [x.name, ...x.periods.map(p => p.distinct)]),
    [['Ana Souza', 2, 1], ['Bruno Costa', 2, 1], ['Carla Dias', 0, 2]]);
  const top1 = rankVolumeByPeriod({ periods: concluidas, keyOf: d => d.instructorId, hoursOf, distinctOf, metric: 'distinct', limit: 1 });
  checkEq('"Outros" SOMA os distintos das linhas ocultas (Bruno 2 + Carla 0 em P1) — e o total das escondidas, nao distintos da uniao', top1.others?.periods.map(p => p.distinct), [2, 3]);
}

/* ========================================================================== */
/* [14] INTERNAS — Distribuição por Categoria (chave: categoria, horas previstas) */
/* ========================================================================== */
console.log('\n[14] Internas / Distribuicao por Categoria: hoursOf = horasPrevistas, "Sem categoria" para vazio');

{
  const interna = (day: string, categoriaInterna: any, horasPrevistas: any, id: string) =>
    ({ id, tipo: 'interna', trainingId: '', dateMode: 'CONTINUO', startDate: day, endDate: day, categoriaInterna, horasPrevistas });
  const internas = [
    interna('2026-09-03', 'SIPAT', 16, 'INT-1'),
    interna('2026-09-10', 'SIPAT', 8, 'INT-2'),
    interna('2026-09-17', 'Visita', 4, 'INT-3'),
    interna('2026-09-24', '', 2, 'INT-4'),            // vazio → "Sem categoria"
    interna('2026-08-05', 'Visita', 4, 'INT-5'),
    interna('2026-08-12', 'Visita', 'x', 'INT-6'),    // horasPrevistas inválida = 0h, mas CONTA
    interna('2026-08-19', 'Evento', 40, 'INT-7'),
  ];
  const horasPrevistasOf = (d: any) => { const h = Number(d.horasPrevistas); return Number.isFinite(h) && h > 0 ? h : 0; };
  const keyOf = (d: any) => (d.categoriaInterna || '').trim() || 'Sem categoria';
  const recI = (s: string, e: string) => internas.filter(d => demandIntersectsRange(d, s, e));
  const periodsI = [recI('2026-09-01', '2026-09-30'), recI('2026-08-01', '2026-08-31')];
  const r = rankVolumeByPeriod({ periods: periodsI, keyOf, hoursOf: horasPrevistasOf, metric: 'hours', limit: Number.POSITIVE_INFINITY });
  igualdadeCartaoKpi('Distribuicao por Categoria (horas previstas)', r, periodsI, (d, key) => keyOf(d) === key, 'hours', {}, horasPrevistasOf);
  checkEq('SIPAT 24h/0, Visita 4h/4h, Sem categoria 2h/0, Evento 0/40h', r.items.map(x => [x.name, ...x.periods.map(p => p.hours)]),
    [['SIPAT', 24, 0], ['Visita', 4, 4], ['Sem categoria', 2, 0], ['Evento', 0, 40]]);
  checkEq('em Demandas (count) Visita conta INT-6 mesmo com 0h previstas', linha(r, 'Visita')?.periods.map(p => p.count), [1, 2]);
  checkEq('limite infinito: sem Outros', r.others, null);
  checkEq('o KPI "Horas Previstas" do periodo e a mesma conta: 30h em P1', computeVolume(periodsI[0], horasPrevistasOf).hours, 30);
}

/* ========================================================================== */
/* [15] Horas MINISTRADAS por instrutor: adaptador sem conta + ranqueamento     */
/* ========================================================================== */
console.log('\n[15] Instrutores e Internas / horas ministradas: volumeRowsFromInstructorHours copia, nao calcula');

{
  // Dois mapas como computeInstructorHours devolve (P1, P2). Nada aqui é
  // recalculado: horas → hours, nDemandas → count, nDivididas de P1 → note.
  const P1map = new Map([
    ['I-A', { horas: 24.5, nDemandas: 2, nDivididas: 1 }],
    ['I-B', { horas: 8, nDemandas: 1, nDivididas: 0 }],
    ['I-D', { horas: 0, nDemandas: 0, nDivididas: 0 }],   // entrada zerada nos dois → some
  ]);
  const P2map = new Map([
    ['I-C', { horas: 16, nDemandas: 1, nDivididas: 0 }],
    ['I-A', { horas: 0, nDemandas: 0, nDivididas: 0 }],
    ['I-D', { horas: 0, nDemandas: 0, nDivididas: 0 }],
  ]);
  const rows = volumeRowsFromInstructorHours([P1map, P2map], { labelOf: instructorName });
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  checkEq('Ana: hours = horas, count = nDemandas, cost/distinct 0; ausente em P2 = zero', byKey['I-A'].periods, [T(2, 24.5), Z]);
  checkEq('Carla: so em P2 → P1 zero, P2 copiado', byKey['I-C'].periods, [Z, T(1, 16)]);
  checkEq('a nota e o "N div." de P1', [byKey['I-A'].note, byKey['I-B'].note, byKey['I-C'].note], ['1 div.', undefined, undefined]);
  checkEq('sem labelOf o nome e o id', volumeRowsFromInstructorHours([P1map])[0].name, 'I-A');

  checkEq('entrada zerada (0h, 0 demandas) em todos os periodos nao vira linha — o "horas > 0" de sempre, no adaptador', rows.some(x => x.key === 'I-D'), false);
  const r = rankVolumeRows(rows, 'hours', Number.POSITIVE_INFINITY);
  checkEq('ranqueado por horas de P1: Ana, Bruno, Carla', r.items.map(x => x.key), ['I-A', 'I-B', 'I-C']);
  checkEq('max = 24.5', r.max, 24.5);
  checkEq('toggle Demandas: mesma lista, ordem por nDemandas', rankVolumeRows(rows, 'count', 8).items.map(x => x.periods[0].count), [2, 1, 0]);
  // `include` é o recorte "só instrutor ATIVO" do card da aba Instrutores.
  const soAtivos = volumeRowsFromInstructorHours([P1map, P2map], { include: id => id !== 'I-C' });
  checkEq('include tira quem a tela nao quer (inativo)', soAtivos.some(x => x.key === 'I-C'), false);
  // Coerência com o KPI "Horas Concluídas": a soma das células de P1 é a soma do mapa.
  const somaMapa = [...P1map.values()].reduce((s, e) => s + e.horas, 0);
  const somaCartao = rankVolumeRows(rows, 'hours', Number.POSITIVE_INFINITY).items.reduce((s, x) => s + x.periods[0].hours, 0);
  checkEq('soma das linhas de P1 = soma do mapa de P1 (o KPI "Horas Concluidas")', somaCartao, somaMapa);
  // Top 8 das internas: limite 8 com Outros.
  const top1 = rankVolumeRows(rows, 'hours', 1);
  checkEq('limite 1: Outros soma Bruno + Carla por periodo', top1.others?.periods.map(p => p.hours), [8, 16]);
}

/* ========================================================================== */
/* [16] rankVolumeRows: regras comuns a todos os cartões                       */
/* ========================================================================== */
console.log('\n[16] rankVolumeRows');

{
  const rows = [
    { key: 'b', name: 'Beta', periods: [T(2, 10), T(1, 5)] },
    { key: 'a', name: 'Alfa', periods: [T(2, 20), T(0, 0)] },
    { key: 'z', name: 'Zero', periods: [Z, Z] },
  ];
  const r = rankVolumeRows(rows, 'count');
  checkEq('empate em P1 (2 e 2): ordem pelo nome; a zerada fica, por ultimo', r.items.map(x => x.name), ['Alfa', 'Beta', 'Zero']);
  checkEq('linha zerada em TODOS os periodos NAO sai (a chave existe, entao aparece com 0)', r.items.some(x => x.key === 'z'), true);
  checkEq('zero em P1 com valor em P2 fica', rankVolumeRows([{ key: 'p2', name: 'P2', periods: [Z, T(1, 1)] }], 'count').items.length, 1);
  checkEq('idem em Horas: treinamento de 0h continua listado com 0h', rankVolumeRows(rows, 'hours').items.map(x => x.name), ['Alfa', 'Beta', 'Zero']);
  checkEq('EXCECAO, so Custo: zero em todos os periodos sai (todas zeram → nenhuma)', rankVolumeRows(rows, 'cost').items.length, 0);
  checkEq('Custo: zero em P1 com custo em P2 fica', rankVolumeRows([{ key: 'c', name: 'C', periods: [Z, T(1, 1, 10)] }], 'cost').items.length, 1);
  checkEq('limite infinito: sem Outros mesmo com muitas linhas', rankVolumeRows(rows, 'hours', Number.POSITIVE_INFINITY).others, null);
  checkEq('lista vazia', rankVolumeRows([], 'count'), { items: [], othersDetail: [], others: null, max: 0 });
}

/* ========================================================================== */
/* [17] Guardas de fonte: a tela chama o domínio, nenhum ranking soma no render */
/* ========================================================================== */
// A igualdade de [2] e [9]–[14] só vale na tela se a tela passar pela mesma
// porta. Estas guardas leem o código e falham no dia em que alguém reescrever
// um buildTop dentro do render ou fizer um cartão somar por conta própria.
console.log('\n[17] Guardas de fonte');

{
  const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const dash = ler('components/Dashboard.tsx');
  check('Dashboard importa computeVolume, rankVolumeByPeriod e rankVolumeRows de domain/dashboardVolume',
    /import \{[^}]*computeVolume[^}]*rankVolumeByPeriod[^}]*rankVolumeRows[^}]*\} from '\.\.\/domain\/dashboardVolume'/.test(dash));

  // Cada <VolumeRankingCard ranking={X}> tem que ter um `const X = rankVolumeByPeriod(` ou `rankVolumeRows(`.
  const cartoes = [...dash.matchAll(/<VolumeRankingCard[\s\S]*?ranking=\{(\w+)\}/g)].map(m => m[1]);
  checkEq('11 cartoes de ranking nas seis abas (3 Geral, 2 Operacional, 2 Instrutores, 1 Clientes, 1 Custos, 2 Internas)', cartoes.length, 11);
  const semDominio = cartoes.filter(v => !new RegExp(`const ${v}\\s*=\\s*(rankVolumeByPeriod|rankVolumeRows)\\(`).test(dash));
  check('todo ranking= vem de rankVolumeByPeriod/rankVolumeRows', semDominio.length === 0, semDominio.join(', '));
  checkEq('cada aba tem os cartoes esperados (por titulo)',
    ['Volume por Local', 'Volume por Corredor', 'Volume por Estado (UF)', 'Top Treinamentos', 'Demandas por Instrutor',
      'Horas Ministradas por Instrutor', 'Reaproveitamento de Instrutores', 'Clientes mais Ativos (Volume)',
      'Top Instrutores por Custo Gerado', 'Distribuição por Categoria', 'Top Instrutores em Horas Internas']
      .filter(t => !dash.includes(`title="${t}"`)), []);

  check('"Total de Demandas", "Total de Horas" e "Total em Despesas" leem computeVolume (a mesma funcao)',
    /title="Total de Demandas"[^\n]*computeVolume\(/.test(dash) && /title="Total de Horas"[^\n]*computeVolume\(/.test(dash) && /title="Total em Despesas"[^\n]*computeVolume\(/.test(dash));
  check('"Volume por Regiao" tambem', /regionalData[\s\S]{0,400}computeVolume\(filteredDemands\.filter\(d => d\.regionId === r\.id\)/.test(dash));
  check('"Total em Despesas" e o cartao de custo usam o MESMO costOf', /const costOf = \(d: Demand\) => costByDemandId\.get\(d\.id\) \?\? 0;/.test(dash) && (dash.match(/costOf, metric: 'cost'/g) ?? []).length === 1);

  const render = dash.slice(dash.indexOf('const renderGeral = () => {'), dash.indexOf('// ─── Excel Export'));
  check('o render nao tem mais soma propria de ranking (RankedListChart, buildTop, counts[], Object.entries(...).sort)',
    render.length > 0 && !/RankedListChart|buildTop|buildTrainingTop|buildInstructorTop|instructorCostItems|topReuseItems|clientData|counts\[|sums\[|Object\.entries\([a-zA-Z]+\)\.sort/.test(render));
  check('o componente RankedListChart foi removido do arquivo', !dash.includes('RankedListChart'));

  const card = ler('components/dashboard/VolumeRankingCard.tsx');
  check('o cartao nao soma nada: so le volumeValue/volumeVariation do ranking pronto',
    !/\.reduce\(/.test(card) && !/\.filter\(/.test(card) && card.includes('volumeValue(') && card.includes('volumeVariation('));
  check('variacao so de P1 contra P2 — nunca contra P3/P4', card.includes('row.periods[1]') && !/row\.periods\[[2-9]\]/.test(card));
  check('escala das barras e ranking.max (comum a todos os periodos)', card.includes('Math.max(ranking.max, 1)'));
  check('altura maxima com rolagem: > 3 periodos ou > 8 linhas, lista rola e cabecalho fica',
    card.includes('MAX_PERIODS_WITHOUT_CAP = 3') && card.includes('MAX_ROWS_WITHOUT_CAP = 8') && /capped \? 'max-h-\[24rem\]'/.test(card));
  check('toggle de metrica so quando a tela passa onMetricChange', /\{onMetricChange && \(/.test(card));

  const dominio = ler('domain/dashboardVolume.ts');
  check('rankVolumeByPeriod termina em rankVolumeRows (um ranqueamento so)', /return rankVolumeRows\(rows, metric, opts\.limit \?\? 10\);/.test(dominio));
  check('volumeRowsFromInstructorHours nao faz aritmetica (copia horas/nDemandas)',
    /count: e\.nDemandas, hours: e\.horas, cost: 0, distinct: 0/.test(dominio) && !/horas\s*[+\-*\/]/.test(dominio.slice(dominio.indexOf('export function volumeRowsFromInstructorHours'))));
}

console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
