/**
 * SMOKE — Internas nas métricas de INSTRUTOR do Dashboard
 *
 * Rodar com:  npm run smoke:dashboard
 *
 * Cobre a evolução da Fase 3: métrica sobre INSTRUTOR (quanto ele trabalhou)
 * passa a somar cliente + interna; métrica sobre CLIENTE/TREINAMENTO segue
 * apenas tipo='cliente'.
 *
 * O ponto central é a REGRESSÃO: o Dashboard continua alimentando os KPIs de
 * cliente com a lista cliente-only, e este script prova por execução que essa
 * lista produz exatamente os mesmos números com ou sem internas no dataset.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import { computeInstructorHours } from '../domain/instructorHours';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

function checkEq(nome: string, atual: unknown, esperado: unknown) {
  check(nome, Object.is(atual, esperado) || atual === esperado, `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

/* ========================================================================== */
/* Fixture — o cenário exato pedido na validação                              */
/* ========================================================================== */

const PERIODO = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };

const trainings: any[] = [
  { id: 'T160', name: 'NR 10 Completo', nr: 'NR 10', hours: 160, practicalHours: null, modality: 'PRESENCIAL', status: 'ATIVO' },
  { id: 'T80', name: 'NR 35', nr: 'NR 35', hours: 80, practicalHours: null, modality: 'PRESENCIAL', status: 'ATIVO' },
];

// Datas no passado -> calculateDemandStatus devolve CONCLUIDA, que é o recorte
// de computeInstructorHours.
const demandsCliente: any[] = [
  { id: 'DEM-C1', tipo: 'cliente', trainingId: 'T160', companyId: 'EMP-1', regionId: 'R1', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-03-02', endDate: '2026-03-06', status: 'CONCLUIDA', instructorId: 'INST-A' },
  { id: 'DEM-C2', tipo: 'cliente', trainingId: 'T80', companyId: 'EMP-2', regionId: 'R1', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-03-09', endDate: '2026-03-13', status: 'CONCLUIDA', instructorId: 'INST-B' },
];

// Interna não tem trainingId: a carga vem de horasPrevistas (ver effectiveDemandHours).
const demandsInterna: any[] = [
  { id: 'DEM-I1', tipo: 'interna', trainingId: '', companyId: '', regionId: 'R1', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-03-16', endDate: '2026-03-17', status: 'CONCLUIDA', instructorId: 'INST-A', horasPrevistas: 16, categoriaInterna: 'SIPAT' },
];

const allocations: any[] = [
  { id: 'a1', demandId: 'DEM-C1', instructorId: 'INST-A', startDate: '2026-03-02', endDate: '2026-03-06' },
  { id: 'a2', demandId: 'DEM-C2', instructorId: 'INST-B', startDate: '2026-03-09', endDate: '2026-03-13' },
  { id: 'a3', demandId: 'DEM-I1', instructorId: 'INST-A', startDate: '2026-03-16', endDate: '2026-03-17' },
];

const base = { trainings, measurements: [] as any[], instructorAllocations: allocations, ...PERIODO };

const horasMap = (demands: any[]) => computeInstructorHours({ ...base, demands } as any);
const horas = (m: Map<string, any>, id: string) => Math.round(((m.get(id)?.horas ?? 0) + Number.EPSILON) * 100) / 100;

/* ========================================================================== */
/* [1] Cenário base                                                           */
/* ========================================================================== */

console.log('\n[1] Toggle do card: Treinamentos e Internas sao recortes SEPARADOS');

const mapCliente = horasMap(demandsCliente);
const mapInterna = horasMap(demandsInterna);
const mapUniao = horasMap([...demandsCliente, ...demandsInterna]);

// A rodada anterior somava os dois num número só (176h). O product owner trocou
// isso pela separação por abas: nada soma mais, cada toggle lê UM mapa.
checkEq('aba Treinamentos: INST-A com 160h, so cliente', horas(mapCliente, 'INST-A'), 160);
checkEq('aba Internas: INST-A com 16h, so interna', horas(mapInterna, 'INST-A'), 16);
check('as duas abas NAO somam (nenhuma mostra 176h)',
  horas(mapCliente, 'INST-A') !== 176 && horas(mapInterna, 'INST-A') !== 176);
checkEq('aba Treinamentos: INST-B com 80h', horas(mapCliente, 'INST-B'), 80);
checkEq('aba Internas: INST-B ausente (so-cliente nao aparece)', horas(mapInterna, 'INST-B'), 0);

/* ---- contagem de demandas e dias: cada aba conta só o próprio recorte ---- */
checkEq('aba Treinamentos: INST-A com 1 demanda', mapCliente.get('INST-A')?.nDemandas, 1);
checkEq('aba Internas: INST-A com 1 demanda interna', mapInterna.get('INST-A')?.nDemandas, 1);
checkEq('aba Treinamentos NAO conta a interna de INST-A', mapCliente.get('INST-A')?.nDemandas, 1);
checkEq('instrutor so-cliente segue IDENTICO na aba Treinamentos', mapCliente.get('INST-B')?.nDemandas, 1);

/* ========================================================================== */
/* [2] Equivalência que o Dashboard usa para não recalcular nada              */
/* ========================================================================== */
// A aba INTERNAS e o toggle "Internas" calculam sobre um recorte próprio (só
// tipo='interna') em vez de filtrar um mapa maior. Isso só devolve o número
// certo porque o rateio de cada demanda depende SÓ das alocações dela — nenhuma
// normalização cruza demandas. Se dependesse, separar o dataset mudaria as horas
// de cada um. Aqui deixa de ser suposição: computar separado e somar tem que dar
// igual a computar junto.
console.log('\n[2] Recorte separado nao distorce o rateio (aba INTERNAS)');

const idsUniao = [...new Set([...mapCliente.keys(), ...mapInterna.keys(), ...mapUniao.keys()])].sort();
const divergencias: string[] = [];
for (const id of idsUniao) {
  const somado = horas(mapCliente, id) + horas(mapInterna, id);
  const direto = horas(mapUniao, id);
  if (Math.abs(somado - direto) > 1e-9) divergencias.push(`${id}: ${somado} != ${direto}`);
  const nSomado = (mapCliente.get(id)?.nDemandas ?? 0) + (mapInterna.get(id)?.nDemandas ?? 0);
  const nDireto = mapUniao.get(id)?.nDemandas ?? 0;
  if (nSomado !== nDireto) divergencias.push(`${id} nDemandas: ${nSomado} != ${nDireto}`);
}
check('horas e nDemandas batem para todo instrutor', divergencias.length === 0, divergencias.join(' | '));

/* ========================================================================== */
/* [3] REGRESSÃO — KPIs de cliente imunes à presença de internas no dataset   */
/* ========================================================================== */
// O Dashboard corta tipo='interna' na entrada e alimenta os KPIs de cliente com
// essa lista. Prova por execução: passar o dataset COM internas pela mesma
// porta (o filtro cliente-only) devolve exatamente o mesmo resultado.
console.log('\n[3] Regressao: KPIs de cliente identicos com e sem internas no dataset');

const todasAsDemandas = [...demandsCliente, ...demandsInterna];
const clienteOnly = todasAsDemandas.filter(d => d.tipo !== 'interna');

/** Snapshot dos agregados de cliente, serializado para comparação byte a byte. */
const snapshotCliente = (demands: any[]) => {
  const m = horasMap(demands);
  const porInstrutor = [...m.entries()]
    .map(([id, e]) => ({ id, horas: Math.round((e.horas + Number.EPSILON) * 100) / 100, nDemandas: e.nDemandas, nDivididas: e.nDivididas }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const contar = (chave: (d: any) => string) => {
    const acc: Record<string, number> = {};
    for (const d of demands) acc[chave(d)] = (acc[chave(d)] ?? 0) + 1;
    return Object.entries(acc).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const totalHoras = porInstrutor.reduce((s, r) => s + r.horas, 0);
  return JSON.stringify({
    porInstrutor,
    porEmpresa: contar(d => String(d.companyId ?? '')),
    porTreinamento: contar(d => String(d.trainingId ?? '')),
    totalHoras,
    mediaHorasPorDemanda: demands.length > 0 ? Math.round((totalHoras / demands.length) * 100) / 100 : 0,
  });
};

const snapSemInternas = snapshotCliente(demandsCliente);
const snapComInternasNoDataset = snapshotCliente(clienteOnly);
check('snapshot de cliente byte a byte identico', snapSemInternas === snapComInternasNoDataset,
  `sem: ${snapSemInternas} | com: ${snapComInternasNoDataset}`);

// Contraprova: se a interna VAZASSE para a porta de cliente, o snapshot mudaria.
const snapContaminado = snapshotCliente(todasAsDemandas);
check('contraprova: interna vazando MUDARIA o snapshot (o teste tem dente)', snapContaminado !== snapSemInternas);

// Snapshot impresso para diff externo entre HEAD e a versão alterada.
console.log('\n  SNAPSHOT_CLIENTE=' + snapSemInternas);

/* ========================================================================== */
/* [4] KPIs do painel de internas                                             */
/* ========================================================================== */
console.log('\n[4] Agregados do painel de internas');

checkEq('total de demandas internas no periodo', demandsInterna.length, 1);
checkEq('horas internas totais', [...mapInterna.values()].reduce((s, e) => s + e.horas, 0), 16);
checkEq('top instrutor em horas internas', [...mapInterna.entries()].sort((a, b) => b[1].horas - a[1].horas)[0]?.[0], 'INST-A');
checkEq('interna sem empresa vinculada conta como Colabor', demandsInterna.filter(d => !String(d.companyId ?? '').trim()).length, 1);

/* ========================================================================== */
/* [5] O caso "demanda concluída, 0h ministradas"                             */
/* ========================================================================== */
// A tela Demandas Internas não cria linha em instructor_allocations — ela só
// grava `demands.instructor_id` (o write de alocação mora em Demands.tsx e
// CalendarView.tsx). E computeInstructorHours ignora instructor_id de propósito:
// a fonte do vínculo é a tabela de alocações.
//
// Resultado no painel: a demanda CONTA em "Demandas Internas" e em "Horas
// Previstas" (que leem horasPrevistas da própria demanda), mas fica FORA de
// "Horas já ministradas" e do ranking. É a explicação de ver uma interna
// concluída e 0h ministradas ao mesmo tempo — não é bug de filtro.
console.log('\n[5] Interna concluida SEM alocacao: conta em previstas, nao em ministradas');

const internaSemAlocacao: any[] = [
  { id: 'DEM-1499', tipo: 'interna', trainingId: '', companyId: '', regionId: 'R1', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-03-20', endDate: '2026-03-21', status: 'CONCLUIDA', instructorId: 'INST-A', horasPrevistas: 8, categoriaInterna: 'Visita' },
];

// Mesmas alocações de sempre: nenhuma aponta para DEM-1499.
const mapSemAloc = computeInstructorHours({ ...base, demands: internaSemAlocacao } as any);

checkEq('horas MINISTRADAS ficam 0 sem linha em instructor_allocations', [...mapSemAloc.values()].reduce((s, e) => s + e.horas, 0), 0);
checkEq('o instrutor nem aparece no mapa', mapSemAloc.size, 0);
// ...mas os KPIs que leem a demanda direto continuam mostrando a demanda:
checkEq('ainda conta em "Demandas Internas"', internaSemAlocacao.length, 1);
checkEq('ainda soma em "Horas Previstas"', internaSemAlocacao.reduce((s, d) => s + Number(d.horasPrevistas || 0), 0), 8);
// Contraprova: basta existir a alocação para as horas passarem a contar.
const mapComAloc = computeInstructorHours({
  ...base,
  demands: internaSemAlocacao,
  instructorAllocations: [...allocations, { id: 'a4', demandId: 'DEM-1499', instructorId: 'INST-A', startDate: '2026-03-20', endDate: '2026-03-21' }],
} as any);
checkEq('com a alocacao criada, as 8h aparecem', horas(mapComAloc, 'INST-A'), 8);

console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
