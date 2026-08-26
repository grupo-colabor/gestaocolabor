/**
 * SMOKE — Disponibilidade de instrutor + Cobertura de Ociosidade
 *
 * Rodar com:  npm run smoke:ociosidade
 *
 * Duas coisas:
 *
 *  1) REGRESSAO DA EXTRACAO (a critica): `getAvailableInstructors` tem de
 *     devolver exatamente a mesma lista que o codigo que vivia solto dentro de
 *     `renderInstrutores` no Dashboard. A regra original esta reproduzida aqui
 *     literalmente em `regraOriginalDashboard` e e comparada nome a nome sobre
 *     um dataset com alocado, livre, de ferias e inativo.
 *
 *  2) O card novo "Cobertura de Ociosidade": "X de Y", quem entra na lista de
 *     acao, e os descartes (interna CANCELADA, fora do periodo, sem instrutor).
 *
 * Sai com codigo 1 se qualquer assercao falhar.
 */
import {
  getAvailableInstructors,
  computeIdleCoverage,
  defaultAvailabilityWindow,
} from '../domain/instructorAvailability';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
function checkEq(nome: string, atual: unknown, esperado: unknown) {
  check(nome, JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

const hoje = new Date('2026-03-10T00:00:00');
const janela = defaultAvailabilityWindow(hoje); // 10/03 -> 09/04

type D = {
  id: string; instructorId?: string | null; startDate: string; endDate: string;
  tipo?: 'cliente' | 'interna'; cancelada?: boolean; concluida?: boolean;
};

const instrutores = [
  { id: 'INST-A', name: 'Alice',   status: 'ATIVO'   }, // alocada em cliente na janela
  { id: 'INST-B', name: 'Bruno',   status: 'ATIVO'   }, // livre
  { id: 'INST-C', name: 'Carla',   status: 'ATIVO'   }, // livre (ferias NAO e vista)
  { id: 'INST-D', name: 'Daniel',  status: 'ATIVO'   }, // livre
  { id: 'INST-E', name: 'Eduardo', status: 'INATIVO' }, // inativo: fora da conta
];

const demandas: D[] = [
  { id: 'DEM-1', instructorId: 'INST-A', startDate: '2026-03-15', endDate: '2026-03-18', tipo: 'cliente' },
  // concluida nao ocupa
  { id: 'DEM-2', instructorId: 'INST-B', startDate: '2026-03-12', endDate: '2026-03-13', tipo: 'cliente', concluida: true },
  // cancelada nao ocupa
  { id: 'DEM-3', instructorId: 'INST-C', startDate: '2026-03-20', endDate: '2026-03-21', tipo: 'cliente', cancelada: true },
  // fora da janela nao ocupa
  { id: 'DEM-4', instructorId: 'INST-D', startDate: '2026-06-01', endDate: '2026-06-02', tipo: 'cliente' },
  // sem instrutor nao ocupa ninguem
  { id: 'DEM-5', instructorId: null, startDate: '2026-03-15', endDate: '2026-03-16', tipo: 'cliente' },
  // inativo continua fora mesmo livre
  { id: 'DEM-6', instructorId: 'INST-E', startDate: '2026-06-01', endDate: '2026-06-02', tipo: 'cliente' },
];

const statusOf = (d: D) => (d.cancelada ? 'CANCELADA' : d.concluida ? 'CONCLUIDA' : 'EM_ANDAMENTO');

console.log('\n— Extracao: helper === regra original do Dashboard');
{
  // Copia literal do que existia em renderInstrutores antes da extracao.
  const regraOriginalDashboard = (insts: typeof instrutores, ds: D[], today: Date, next30: Date) => {
    const activeInstructors = insts.filter(i => i.status === 'ATIVO');
    const busyNext30Ids = new Set(
      ds.filter(d => {
        const s = statusOf(d);
        if (s === 'CANCELADA' || s === 'CONCLUIDA') return false;
        if (!d.instructorId) return false;
        const start = new Date(d.startDate);
        const end = new Date(d.endDate);
        return end >= today && start <= next30;
      }).map(d => d.instructorId!)
    );
    return activeInstructors.filter(i => !busyNext30Ids.has(i.id));
  };

  const original = regraOriginalDashboard(instrutores, demandas, janela.from, janela.to);
  const extraido = getAvailableInstructors(instrutores, demandas, janela, { statusOf });

  checkEq('mesma lista, mesma ordem', extraido.map(i => i.name), original.map(i => i.name));
  checkEq('e a lista e a esperada', extraido.map(i => i.name), ['Bruno', 'Carla', 'Daniel']);
  check('alocado em cliente na janela fica FORA', !extraido.some(i => i.id === 'INST-A'));
  check('concluida nao ocupa (Bruno entra)', extraido.some(i => i.id === 'INST-B'));
  check('cancelada nao ocupa (Carla entra)', extraido.some(i => i.id === 'INST-C'));
  check('demanda fora da janela nao ocupa (Daniel entra)', extraido.some(i => i.id === 'INST-D'));
  check('INATIVO nunca entra', !extraido.some(i => i.id === 'INST-E'));
}

console.log('\n— Herdado: FERIAS na agenda NAO tira o instrutor de disponivel');
{
  // Documenta o comportamento existente: a regra so olha `demands`, nunca
  // `agenda_items`. Se um dia passar a olhar, este check falha de proposito.
  const disp = getAvailableInstructors(instrutores, demandas, janela, { statusOf });
  check('Carla, "de ferias", segue listada como disponivel', disp.some(i => i.id === 'INST-C'));
}

console.log('\n— Cobertura: 3 ociosos, 1 com interna -> "1 de 3"');
{
  const ociosos = getAvailableInstructors(instrutores, demandas, janela, {
    statusOf, countsAsBusy: d => d.tipo !== 'interna',
  });
  checkEq('os 3 ociosos', ociosos.map(i => i.name), ['Bruno', 'Carla', 'Daniel']);

  const internasNoPeriodo: D[] = [
    { id: 'INT-1', instructorId: 'INST-B', startDate: '2026-03-16', endDate: '2026-03-17', tipo: 'interna' },
  ];
  const cob = computeIdleCoverage(ociosos, internasNoPeriodo, { statusOf });

  checkEq('X = 1', cob.covered.length, 1);
  checkEq('Y = 3', cob.available.length, 3);
  checkEq('coberto e o Bruno', cob.covered.map(i => i.name), ['Bruno']);
  checkEq('lista de acao = os 2 certos', cob.uncovered.map(i => i.name), ['Carla', 'Daniel']);
}

console.log('\n— Cobertura: os descartes');
{
  const ociosos = getAvailableInstructors(instrutores, demandas, janela, {
    statusOf, countsAsBusy: d => d.tipo !== 'interna',
  });

  const internaCancelada: D[] = [
    { id: 'INT-2', instructorId: 'INST-B', startDate: '2026-03-16', endDate: '2026-03-17', tipo: 'interna', cancelada: true },
  ];
  const cobCancelada = computeIdleCoverage(ociosos, internaCancelada, { statusOf });
  checkEq('interna CANCELADA nao cobre ninguem', cobCancelada.covered.length, 0);
  checkEq('e os 3 vao para a lista de acao', cobCancelada.uncovered.length, 3);

  // "Fora do periodo" = a tela nem passa a demanda (filteredInternasByPeriod ja
  // recortou). Aqui isso e representado pela lista vazia.
  const cobForaDoPeriodo = computeIdleCoverage(ociosos, [], { statusOf });
  checkEq('interna fora do periodo nao cobre ninguem', cobForaDoPeriodo.covered.length, 0);

  const internaSemInstrutor: D[] = [
    { id: 'INT-3', instructorId: null, startDate: '2026-03-16', endDate: '2026-03-17', tipo: 'interna' },
  ];
  checkEq('interna sem instrutor nao cobre ninguem',
    computeIdleCoverage(ociosos, internaSemInstrutor, { statusOf }).covered.length, 0);
}

console.log('\n— Por que countsAsBusy existe: sem ele a metrica e sempre 0');
{
  // Contraprova do desvio documentado no modulo: se a interna tambem ocupasse,
  // quem recebeu interna sairia de "ocioso" e X seria zero por construcao.
  const internas: D[] = [
    { id: 'INT-4', instructorId: 'INST-B', startDate: '2026-03-16', endDate: '2026-03-17', tipo: 'interna' },
  ];
  const todas = [...demandas, ...internas];

  const semParametro = getAvailableInstructors(instrutores, todas, janela, { statusOf });
  check('com a regra crua, Bruno sai dos ociosos', !semParametro.some(i => i.id === 'INST-B'));
  checkEq('e a cobertura degenera para 0',
    computeIdleCoverage(semParametro, internas, { statusOf }).covered.length, 0);

  const comParametro = getAvailableInstructors(instrutores, todas, janela, {
    statusOf, countsAsBusy: d => d.tipo !== 'interna',
  });
  checkEq('com countsAsBusy, a cobertura mede o que deve',
    computeIdleCoverage(comParametro, internas, { statusOf }).covered.map(i => i.name), ['Bruno']);
}

console.log('');
if (falhas > 0) { console.log(`❌ ${falhas} check(s) falharam.`); process.exit(1); }
console.log('✅ Todos os checks passaram.');

