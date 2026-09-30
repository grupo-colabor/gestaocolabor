/**
 * SMOKE — Volume por período nos cartões Local / Corredor / UF do Dashboard
 *
 * Rodar com:  npm run smoke:dashboard-volume
 *
 * A regra que este script prende: os cartões de ranking NÃO recalculam. Cada
 * célula (linha × período) é `computeVolume` sobre o sub-recorte daquela chave
 * — a mesma função que dá "Total de Demandas" e "Total de Horas" no topo. Logo
 * "Volume por Local → Brucutu → P1" tem que ser igual ao que o KPI mostraria
 * com o filtro "Local = Brucutu" ligado. Aqui isso deixa de ser intenção: os
 * dois caminhos são executados e comparados, para as duas métricas.
 *
 * Fixture: 2 períodos (P1 = set/26, P2 = ago/26) e 3 locais — um deles
 * (Itabira) só existe em P2 e tem que aparecer com P1 = 0, não sumir.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import { computeVolume, rankVolumeByPeriod, volumeValue, volumeVariation, type VolumeMetric } from '../domain/dashboardVolume';
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

/* ========================================================================== */
/* Fixture                                                                    */
/* ========================================================================== */

const trainings = [
  { id: 'T8',  hours: 8 },
  { id: 'T16', hours: 16 },
  { id: 'T40', hours: 40 },
];
const hoursOf = (d: any) => trainings.find(t => t.id === d.trainingId)?.hours ?? 0;

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
  ...over,
});

const demands: any[] = [
  // Brucutu — P1: 3 demandas (40h); P2: 2 demandas (16h)
  dem('T8',  '2026-09-02'),
  dem('T16', '2026-09-08'),
  dem('T16', '2026-09-15'),
  dem('T8',  '2026-08-05'),
  dem('T8',  '2026-08-12'),
  // Carajás — P1: 1 demanda (40h, empata em horas com Brucutu); P2: 1 (8h)
  dem('T40', '2026-09-21', { trainingLocal: 'Carajás', corredor: 'Corredor Norte', demandState: 'PA' }),
  dem('T8',  '2026-08-19', { trainingLocal: 'Carajás', corredor: 'Corredor Norte', demandState: 'PA' }),
  // Itabira — SÓ em P2: 4 demandas (64h). É o maior valor em ambas as métricas.
  dem('T16', '2026-08-03', { trainingLocal: 'Itabira', corredor: 'N.A', demandState: 'MG' }),
  dem('T16', '2026-08-10', { trainingLocal: 'Itabira', corredor: 'N.A', demandState: 'MG' }),
  dem('T16', '2026-08-17', { trainingLocal: 'Itabira', corredor: 'N.A', demandState: 'MG' }),
  dem('T16', '2026-08-24', { trainingLocal: 'Itabira', corredor: 'N.A', demandState: 'MG' }),
  // Sem local — ficam fora do ranking de Local, mas CONTAM no total do período.
  dem('T40', '2026-09-28', { trainingLocal: '',    corredor: 'Corredor Sudeste', demandState: 'ES' }),
  dem('T40', '2026-08-26', { trainingLocal: '   ', corredor: undefined,          demandState: 'ES' }),
];

// O recorte por período é o do Dashboard: demandIntersectsRange sobre o filtro.
const recorte = (start: string, end: string) => demands.filter(d => demandIntersectsRange(d, start, end));
const P1 = recorte('2026-09-01', '2026-09-30');
const P2 = recorte('2026-08-01', '2026-08-31');
const periods = [P1, P2];

const local = (metric: VolumeMetric, limit?: number) =>
  rankVolumeByPeriod({ periods, keyOf: d => d.trainingLocal, hoursOf, metric, limit });

const linha = (r: ReturnType<typeof local>, name: string) =>
  [...r.items, ...r.othersDetail].find(x => x.name === name);

/* ========================================================================== */
/* [1] computeVolume é a conta dos KPIs do topo                               */
/* ========================================================================== */
console.log('\n[1] computeVolume: contagem e horas do recorte inteiro (os KPIs do topo)');

checkEq('P1: 5 demandas', computeVolume(P1, hoursOf).count, 5);
checkEq('P1: 8+16+16+40+40 = 120h', computeVolume(P1, hoursOf).hours, 120);
checkEq('P2: 8 demandas', computeVolume(P2, hoursOf).count, 8);
checkEq('P2: 8+8+8+64+40 = 128h', computeVolume(P2, hoursOf).hours, 128);
checkEq('recorte vazio: zero', computeVolume([], hoursOf), { count: 0, hours: 0 });
checkEq('carga inválida conta 0h, não NaN', computeVolume([{ trainingId: 'X' }], () => NaN as any).hours, 0);

/* ========================================================================== */
/* [2] A igualdade: cartão × (filtro por local + KPI do topo)                 */
/* ========================================================================== */
console.log('\n[2] Cartao = KPI do topo com o filtro "Local = X" ligado, para toda celula');

for (const metric of ['count', 'hours'] as VolumeMetric[]) {
  const r = local(metric);
  const nomes = ['Brucutu', 'Carajás', 'Itabira'];
  const divergencias: string[] = [];
  for (const name of nomes) {
    const row = linha(r, name);
    if (!row) { divergencias.push(`${name}: sem linha`); continue; }
    periods.forEach((rec, i) => {
      // O que a tela faz quando o usuário liga o filtro "Local = name":
      const filtrado = rec.filter(d => (d.trainingLocal ?? '') === name);
      const kpi = volumeValue(computeVolume(filtrado, hoursOf), metric);
      const cartao = volumeValue(row.periods[i], metric);
      if (kpi !== cartao) divergencias.push(`${name} P${i + 1} (${metric}): cartão ${cartao} ≠ KPI ${kpi}`);
    });
  }
  check(`[${metric}] toda celula bate com o KPI filtrado`, divergencias.length === 0, divergencias.join(' | '));
}

// Contraprova: a soma do ranking NÃO fecha com o total do período, porque as
// duas demandas sem local ficam fora do ranking mas dentro do KPI. Esse é o
// comportamento certo — e mostra que a igualdade acima é por célula, não é um
// "tudo soma igual" que passaria com qualquer conta.
{
  const r = local('count');
  const somaRanking = [...r.items, ...r.othersDetail].reduce((s, x) => s + x.periods[0].count, 0);
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
  checkEq('Brucutu: P1 = 3, P2 = 2', r.items[0].periods.map(p => p.count), [3, 2]);
  checkEq('Carajás: P1 = 1, P2 = 1', r.items[1].periods.map(p => p.count), [1, 1]);
  checkEq('Itabira APARECE com P1 = 0 e P2 = 4 (nao some)', r.items[2].periods, [{ count: 0, hours: 0 }, { count: 4, hours: 64 }]);
  checkEq('cada linha tem um VolumeTotals por periodo', r.items.every(x => x.periods.length === 2), true);
  checkEq('sem "Outros" quando cabe tudo', r.others, null);
  checkEq('max = 4: o maior valor esta em P2 (Itabira), nao em P1', r.max, 4);
  checkEq('locais vazio e so-espacos nao viram linha', [...r.items, ...r.othersDetail].some(x => !x.name.trim()), false);
}

console.log('\n[4] Horas: mesma estrutura, empate em P1 desempata pelo nome');

{
  const r = local('hours');
  checkEq('Brucutu e Carajás empatam em P1 (40h) e Brucutu vem antes pelo nome', r.items.slice(0, 2).map(x => x.name), ['Brucutu', 'Carajás']);
  checkEq('Brucutu: 40h / 16h', r.items[0].periods.map(p => p.hours), [40, 16]);
  checkEq('Carajás: 40h / 8h', r.items[1].periods.map(p => p.hours), [40, 8]);
  checkEq('Itabira: 0h / 64h', r.items[2].periods.map(p => p.hours), [0, 64]);
  checkEq('max = 64 (Itabira em P2) — a escala e comum a todos os periodos', r.max, 64);
  // O toggle troca a métrica, não o conjunto de linhas.
  const nomesCount = [...local('count').items].map(x => x.name).sort();
  const nomesHours = [...r.items].map(x => x.name).sort();
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

  const uf = rankVolumeByPeriod({ periods, keyOf: d => d.demandState, hoursOf, metric: 'hours' });
  checkEq('UF em horas: MG (40/80), PA (40/8), ES (40/40) — empate triplo em P1, ordem pelo nome', uf.items.map(x => [x.name, ...x.periods.map(p => p.hours)]),
    [['ES', 40, 40], ['MG', 40, 80], ['PA', 40, 8]]);
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
/* [9] Guardas de fonte: a tela chama a função do domínio, não soma sozinha    */
/* ========================================================================== */
// A igualdade de [2] só vale na tela se a tela passar pela mesma porta. Estas
// guardas leem o código e falham no dia em que alguém reescrever um buildTop
// dentro do render ou fizer o cartão somar por conta própria.
console.log('\n[9] Guardas de fonte');

{
  const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const dash = ler('components/Dashboard.tsx');
  check('Dashboard importa computeVolume e rankVolumeByPeriod de domain/dashboardVolume',
    /import \{[^}]*computeVolume[^}]*rankVolumeByPeriod[^}]*\} from '\.\.\/domain\/dashboardVolume'/.test(dash));
  checkEq('os tres cartoes (Local, Corredor, UF) passam por rankVolumeByPeriod sobre allFilteredDemandsList',
    (dash.match(/rankVolumeByPeriod\(\{ periods: allFilteredDemandsList/g) ?? []).length, 3);
  check('"Total de Demandas" e "Total de Horas" leem computeVolume (a mesma funcao)',
    /title="Total de Demandas"[^\n]*computeVolume\(/.test(dash) && /title="Total de Horas"[^\n]*computeVolume\(/.test(dash));
  check('"Volume por Regiao" tambem', /regionalData[\s\S]{0,400}computeVolume\(filteredDemands\.filter\(d => d\.regionId === r\.id\)/.test(dash));
  check('nao sobrou soma propria (buildTop / buildTopHours) na aba Geral', !dash.includes('buildTop(') && !dash.includes('buildTopHours('));

  const card = ler('components/dashboard/VolumeRankingCard.tsx');
  check('o cartao nao soma nada: so le volumeValue/volumeVariation do ranking pronto',
    !/\.reduce\(/.test(card) && !/\.filter\(/.test(card) && card.includes('volumeValue(') && card.includes('volumeVariation('));
  check('variacao so de P1 contra P2 — nunca contra P3/P4', card.includes('row.periods[1]') && !/row\.periods\[[2-9]\]/.test(card));
  check('escala das barras e ranking.max (comum a todos os periodos)', card.includes('Math.max(ranking.max, 1)'));
}

console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
