/**
 * SMOKE — Recorte das alocações quando o período da demanda muda
 *
 * Rodar com:  npm run smoke:recorte-alocacoes
 *
 * O caso real: a DEM-1552 tinha 3 dias com acompanhante nos 3. Passou para 2
 * dias pela tela de Demandas e as 3 linhas de `companion_allocations` foram
 * reescritas para o MESMO dia — três cards idênticos na segunda-feira. A mesma
 * linha de código expandia alocação de SPLIT para o período cheio, e aí o
 * rateio pagava a carga inteira a cada instrutor.
 *
 * As três contraprovas que este arquivo existe para prender:
 *
 *   [A] RECORTE, NUNCA CÓPIA — mas MUDAR DATA NÃO DESVINCULA NINGUÉM. Dia que
 *       saiu é removido; dia novo não é inventado para quem acompanhava só
 *       parte. Quem acompanhava a demanda INTEIRA acompanha o período novo, e
 *       quem ficaria com zero dias é RECRIADO com aviso em vez de sumir da
 *       demanda. A reescrita antiga (que duplicava) e o recorte puro (que
 *       desvinculava) estão os dois reproduzidos aqui, e o smoke exige que os
 *       dois errem.
 *
 *   [B] O RATEIO NÃO DOBRA. Split de 2 instrutores numa demanda de 16h continua
 *       somando 16h depois da mudança de datas. A versão antiga (expandir as
 *       duas para o período cheio) tem de dar 32h — se não der, o teste não
 *       está medindo o que diz medir.
 *
 *   [C] O CASO COMUM CONTINUA FUNCIONANDO. Alocação única cobrindo a demanda
 *       inteira acompanha o período novo, que é o comportamento que a equipe
 *       espera ao arrastar uma demanda de semana.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import {
  planAllocationReschedule,
  describeReschedule,
  type AllocationRowLike,
  type CompanionRowLike,
  type ParticipantRowLike,
} from '../domain/allocationReschedule';
import { computeInstructorHoursByDemand } from '../domain/instructorHours';

const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);

const D1 = '2026-03-09'; // segunda
const D2 = '2026-03-10';
const D3 = '2026-03-11';

const plano = (over: Partial<Parameters<typeof planAllocationReschedule>[0]> = {}) =>
  planAllocationReschedule({
    diasAntigos: [D1, D2, D3],
    diasNovos: [D1, D2],
    horaInicio: '08:00',
    horaFim: '18:00',
    allocations: [],
    companions: [],
    participants: [],
    ...over,
  });

const acomp = (id: string, dia: string, instructorId = 'ACOMP'): CompanionRowLike => ({
  id, instructorId, startDate: `${dia}T08:00`, endDate: `${dia}T18:00`,
});

/* ────────────────────────────────────────────────────────────────────────────
 * [1] ACOMPANHANTE — o caso da DEM-1552
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Acompanhante INTEGRAL: acompanha o periodo (encolhe)');
{
  // Cobria os 3 dias da demanda. A demanda virou 2 dias.
  const linhas = [acomp('CA-1', D1), acomp('CA-2', D2), acomp('CA-3', D3)];
  const p = plano({ companions: linhas });

  eq('a linha do dia que saiu e REMOVIDA', p.companions.paraRemover.map(c => c.id), ['CA-3']);
  eq('e o dia removido e reportado', p.companions.paraRemover[0].dia, D3);
  eq('nenhum dia novo e criado (a demanda so encolheu)', p.companions.paraCriar.length, 0);

  const sobraram = linhas.filter(l => !p.companions.paraRemover.some(r => r.id === l.id));
  eq('sobram 2 linhas', sobraram.length, 2);
  eq(
    'uma por dia, sem duplicata',
    sobraram.map(l => l.startDate.slice(0, 10)).sort().join(','),
    [D1, D2].join(',')
  );
  eq('e ele NAO foi desvinculado', sobraram.length > 0, true);

  /* CONTRAPROVA: a reescrita antiga, reproduzida. */
  const reescritaAntiga = linhas.map(l => ({
    ...l,
    startDate: `${D1}T08:00`,   // period.start da demanda nova, para TODAS
    endDate: `${D2}T18:00`,
  }));
  const diasDepoisDaReescrita = reescritaAntiga.map(l => l.startDate.slice(0, 10));
  eq(
    '(contraprova) a reescrita antiga poe as 3 linhas no MESMO dia',
    new Set(diasDepoisDaReescrita).size,
    1
  );
  check(
    '...e e isso que virava 3 cards na segunda-feira',
    diasDepoisDaReescrita.filter(d => d === D1).length === 3
  );
}

console.log('\n[2] Acompanhante INTEGRAL: acompanha o periodo (cresce)');
{
  // Cobria os 2 dias da demanda; a demanda ganhou um terceiro.
  const p = planAllocationReschedule({
    diasAntigos: [D1, D2],
    diasNovos: [D1, D2, D3],
    horaInicio: '08:00',
    horaFim: '18:00',
    allocations: [],
    companions: [acomp('CA-1', D1), acomp('CA-2', D2)],
    participants: [],
  });

  eq('ninguem e removido', p.companions.paraRemover.length, 0);
  eq('e o dia novo e criado para ele', p.companions.paraCriar.map(c => c.startDate.slice(0, 10)), [D3]);
  eq('somando 3 linhas', 2 - p.companions.paraRemover.length + p.companions.paraCriar.length, 3);
  eq('com o horario ATUAL da demanda', p.companions.paraCriar[0].startDate, `${D3}T08:00`);
}

console.log('\n[3] Acompanhante PARCIAL: recorte, e dia novo NAO e inventado');
{
  // So acompanhava 1 dos 3 dias — e esse dia continua no periodo novo.
  const p = plano({ diasNovos: [D1, D2], companions: [acomp('CA-1', D2)] });
  eq('o dia dele fica', p.companions.paraRemover.length, 0);
  eq('e nenhum dia novo e inventado', p.companions.paraCriar.length, 0);

  // A demanda cresce: quem era parcial continua parcial.
  const q = planAllocationReschedule({
    diasAntigos: [D1, D2],
    diasNovos: [D1, D2, D3],
    horaInicio: '08:00', horaFim: '18:00',
    allocations: [], participants: [],
    companions: [acomp('CA-1', D1)],
  });
  eq('parcial nao ganha o dia novo da demanda', q.companions.paraCriar.length, 0);
  eq('nem perde o que tinha', q.companions.paraRemover.length, 0);
}

console.log('\n[4] Acompanhante cujo recorte ESVAZIA: recriado, nunca removido');
{
  // A demanda foi deslocada inteira: nenhum dia dele sobrevive.
  const p = planAllocationReschedule({
    diasAntigos: [D1, D2, D3],
    diasNovos: ['2026-03-16', '2026-03-17'],
    horaInicio: '09:00', horaFim: '17:00',
    allocations: [], participants: [],
    companions: [acomp('CA-1', D2)],   // parcial: so o dia do meio
  });

  eq('a linha antiga sai', p.companions.paraRemover.map(c => c.id), ['CA-1']);
  eq('mas ele e RECRIADO no periodo novo inteiro', p.companions.paraCriar.map(c => c.startDate.slice(0, 10)), ['2026-03-16', '2026-03-17']);
  eq('e marcado para revisao', p.companions.paraRevisar.map(c => c.instructorId), ['ACOMP']);
  check(
    'NUNCA fica com zero linhas — mudar data nao desvincula ninguem',
    p.companions.paraCriar.length > 0
  );
  check(
    'o aviso pede revisao dos dias',
    describeReschedule(p, id => id).some(a => a.includes('Revise os dias'))
  );
  check(
    'e nao acusa "dias removidos" para quem foi recriado (seria mentira)',
    !describeReschedule(p, id => id).some(a => a.includes('foram removidos'))
  );
  eq('e com o horario ATUAL da demanda (09-17), nao o da linha antiga', p.companions.paraCriar[0].startDate, '2026-03-16T09:00');
  eq('nas duas pontas', p.companions.paraCriar[0].endDate, '2026-03-16T17:00');

  /* CONTRAPROVA: o recorte PURO (a versao anterior deste modulo) desvinculava. */
  const recortePuro = [acomp('CA-1', D2)].filter(l =>
    ['2026-03-16', '2026-03-17'].includes(l.startDate.slice(0, 10))
  );
  eq('(contraprova) o recorte puro deixaria ZERO linhas', recortePuro.length, 0);
  check(
    '...que e exatamente o acompanhante sumindo da demanda',
    recortePuro.length === 0 && p.companions.paraCriar.length === 2
  );
}

console.log('\n[4b] Acompanhante: dedupe e rede de seguranca do dado ja corrompido');
{
  // Exatamente o estado que a reescrita antiga deixou no banco: tres linhas da
  // mesma pessoa no mesmo dia. Sem a dedupe, a correcao nao conserta a DEM-1552.
  const p = plano({
    diasNovos: [D1, D2],
    companions: [acomp('CA-1', D1), acomp('CA-2', D1), acomp('CA-3', D1)],
  });
  eq('duas das tres saem', p.companions.paraRemover.map(c => c.id), ['CA-2', 'CA-3']);
  eq('e sobra uma linha, no dia dela', p.companions.paraCriar.length, 0);

  // Pessoas DIFERENTES no mesmo dia continuam sendo duas linhas legitimas.
  const q = plano({
    diasNovos: [D1, D2],
    companions: [acomp('CA-1', D1, 'ANA'), acomp('CA-2', D1, 'BRUNO')],
  });
  eq('mas duas pessoas no mesmo dia ficam', q.companions.paraRemover.length, 0);
}

console.log('\n[4c] Acompanhante: linha corrompida de DOIS dias volta a ser de um');
{
  // A reescrita antiga gravava start=D1 e end=D2 na MESMA linha — e a agenda
  // itera do inicio ao fim, entao uma linha rendia card em dois dias.
  const corrompida: CompanionRowLike = {
    id: 'CA-X', instructorId: 'ACOMP', startDate: `${D1}T08:00`, endDate: `${D2}T18:00`,
  };
  const p = plano({ diasNovos: [D1, D2], companions: [corrompida] });
  eq('a linha e normalizada para um dia so', p.companions.paraAtualizar[0]?.endDate, `${D1}T18:00`);
  eq('mantendo o dia dela', p.companions.paraAtualizar[0]?.startDate, `${D1}T08:00`);
}

console.log('\n[4d] Acompanhante: o horario e o da DEMANDA, em qualquer reagendamento');
{
  // A demanda passou a ser 13h-19h. Toda linha que fica ou nasce vai junto —
  // e o mesmo que o branch de "mudou so o horario" ja fazia. Ninguem acompanha
  // das 8h as 18h uma demanda que virou 13h-19h.
  const antiga: CompanionRowLike = {
    id: 'CA-1', instructorId: 'ANA', startDate: `${D1}T08:00`, endDate: `${D1}T18:00`,
  };
  const p = planAllocationReschedule({
    diasAntigos: [D1],
    diasNovos: [D1, D2],
    horaInicio: '13:00', horaFim: '19:00',
    allocations: [], participants: [],
    companions: [antiga],
  });
  eq('a linha que fica assume o horario novo', p.companions.paraAtualizar[0]?.startDate, `${D1}T13:00`);
  eq('nas duas pontas', p.companions.paraAtualizar[0]?.endDate, `${D1}T19:00`);
  eq('e o dia novo nasce com ele', p.companions.paraCriar[0]?.startDate, `${D2}T13:00`);

  // Linha sem hora nenhuma cai no mesmo lugar — nao existe caminho que devolva
  // uma linha sem horario.
  const semHora: CompanionRowLike = {
    id: 'CA-2', instructorId: 'BRUNO', startDate: D1, endDate: D1,
  };
  const q = planAllocationReschedule({
    diasAntigos: [D1],
    diasNovos: [D1, D2],
    horaInicio: '13:00', horaFim: '19:00',
    allocations: [], participants: [],
    companions: [semHora],
  });
  eq('linha sem hora tambem recebe o da demanda', q.companions.paraCriar[0]?.startDate, `${D2}T13:00`);

  // O 08-18 e fallback de QUEM CHAMA (demanda sem horario), nao uma convencao
  // que este modulo escolhe.
  const semHorarioNaDemanda = planAllocationReschedule({
    diasAntigos: [D1],
    diasNovos: [D1, D2],
    horaInicio: '08:00', horaFim: '18:00',   // o que a tela passa quando nao ha
    allocations: [], participants: [],
    companions: [antiga],
  });
  eq('demanda sem horario cai em 08-18', semHorarioNaDemanda.companions.paraCriar[0]?.startDate, `${D2}T08:00`);

  // Guarda de fonte: o fallback vive na tela, e nas duas pontas.
  const dem = ler('components/Demands.tsx');
  check(
    'a tela passa o horario da demanda com fallback 08-18',
    dem.includes("horaInicio: (sanitizedDemand.startDate ?? '').slice(11) || '08:00'") &&
      dem.includes("horaFim: (sanitizedDemand.endDate ?? '').slice(11) || '18:00'")
  );
}


/* ────────────────────────────────────────────────────────────────────────────
 * [5] INSTRUTOR — o caso comum acompanha; o split só recorta
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[5] Instrutor: alocação única cobrindo tudo acompanha o período');
{
  const unica: AllocationRowLike = {
    id: 'AL-1', instructorId: 'ANA', startDate: `${D1}T08:00`, endDate: `${D3}T18:00`,
  };
  const p = plano({ allocations: [unica] });

  eq('vai para o período novo', p.allocations.paraPeriodoCheio.length, 1);
  eq('do primeiro ao último dia novo', p.allocations.paraPeriodoCheio[0].startDate, `${D1}T08:00`);
  eq('idem', p.allocations.paraPeriodoCheio[0].endDate, `${D2}T18:00`);
  eq('nada é recortado', p.allocations.paraRecortar.length, 0);
  eq('nem removido', p.allocations.paraRemover.length, 0);
  eq('e não sobra dia sem instrutor', p.allocations.diasSemInstrutor.length, 0);

  // Esticar também vale para o caso único: a demanda ganhou um dia e ele foi
  // junto — é o que a equipe espera ao mover a demanda de semana.
  const q = planAllocationReschedule({
    diasAntigos: [D1, D2],
    diasNovos: [D1, D2, D3],
    horaInicio: '08:00', horaFim: '18:00',
    allocations: [{ id: 'AL-1', instructorId: 'ANA', startDate: `${D1}T08:00`, endDate: `${D2}T18:00` }],
    companions: [], participants: [],
  });
  eq('demanda que cresce leva a alocação única junto', q.allocations.paraPeriodoCheio[0]?.endDate, `${D3}T18:00`);
}

console.log('\n[6] Instrutor: split só recorta — e o rateio NÃO dobra');
{
  const split: AllocationRowLike[] = [
    { id: 'AL-1', instructorId: 'ANA', startDate: `${D1}T08:00`, endDate: `${D1}T18:00` },
    { id: 'AL-2', instructorId: 'BRUNO', startDate: `${D2}T08:00`, endDate: `${D3}T18:00` },
  ];
  const p = plano({ allocations: split });

  eq('nenhuma vira período cheio', p.allocations.paraPeriodoCheio.length, 0);
  eq('a de fora do recorte é clampada', p.allocations.paraRecortar.map(a => a.id), ['AL-2']);
  eq('para o que sobrou dela', p.allocations.paraRecortar[0].endDate, `${D2}T18:00`);
  eq('e ninguém é removido', p.allocations.paraRemover.length, 0);
  eq('nem sobra dia descoberto', p.allocations.diasSemInstrutor.length, 0);

  /* --- A conta que importa: o rateio antes e depois --- */
  const demandaBase: any = {
    id: 'DEM-X', tipo: 'cliente', dateMode: 'CONTINUO', modality: 'PRESENCIAL',
    trainingLocal: 'BH - MG', instructorId: 'ANA', trainingId: 'T1',
    status: 'ATIVA',
  };
  const training: any = { id: 'T1', name: 'NR 35', hours: 16, modality: 'PRESENCIAL' };

  const horasDe = (demanda: any, allocs: AllocationRowLike[]) =>
    computeInstructorHoursByDemand({
      demands: [demanda],
      instructorAllocations: allocs.map(a => ({ ...a, demandId: 'DEM-X' })) as any,
      trainings: [training],
      measurements: [],
    }).reduce((acc, r) => acc + r.horas, 0);

  // ANTES: 3 dias, 16h, dois instrutores — a soma é a carga.
  const antes: any = { ...demandaBase, startDate: `${D1}T08:00`, endDate: `${D3}T18:00` };
  eq('antes: a soma do rateio é a carga da demanda', Math.round(horasDe(antes, split)), 16);

  // DEPOIS, com o plano aplicado: continua sendo a carga.
  const depois: any = { ...demandaBase, startDate: `${D1}T08:00`, endDate: `${D2}T18:00` };
  const recortadas = split.map(a => {
    const novo = p.allocations.paraRecortar.find(x => x.id === a.id);
    return novo ? { ...a, startDate: novo.startDate, endDate: novo.endDate } : a;
  });
  eq('depois do recorte: continua sendo a carga', Math.round(horasDe(depois, recortadas)), 16);

  /* CONTRAPROVA: a reescrita antiga expandia as DUAS para o período cheio. */
  const comoEraAntes = split.map(a => ({
    ...a, startDate: `${D1}T08:00`, endDate: `${D2}T18:00`,
  }));
  eq(
    '(contraprova) a reescrita antiga paga a carga a CADA instrutor: 32h',
    Math.round(horasDe(depois, comoEraAntes)),
    32
  );
}

console.log('\n[7] Instrutor: alocação inteiramente fora sai, e o buraco vira aviso');
{
  const split: AllocationRowLike[] = [
    { id: 'AL-1', instructorId: 'ANA', startDate: `${D1}T08:00`, endDate: `${D1}T18:00` },
    { id: 'AL-2', instructorId: 'BRUNO', startDate: `${D3}T08:00`, endDate: `${D3}T18:00` },
  ];
  const p = plano({ allocations: split });

  eq('a de fora é removida', p.allocations.paraRemover.map(a => a.id), ['AL-2']);
  eq('o dia que ficou descoberto é reportado', p.allocations.diasSemInstrutor, [D2]);
  check(
    'e NUNCA vira uma alocação nova inventada',
    p.allocations.paraPeriodoCheio.length === 0 &&
      p.allocations.paraRecortar.every(a => a.id !== 'AL-2')
  );

  const avisos = describeReschedule(p, id => id);
  check('o aviso diz o que sumiu', avisos.some(a => a.includes('BRUNO')));
  check('e quantos dias ficaram sem instrutor', avisos.some(a => a.includes('sem instrutor')));
  check('mandando alocar pela agenda', avisos.some(a => a.includes('aloque pela agenda')));
}

console.log('\n[8] Demanda sem alocação nenhuma não vira "buraco"');
{
  const p = plano({ allocations: [] });
  eq('nenhum dia é reportado como sem instrutor', p.allocations.diasSemInstrutor.length, 0);
  eq('e o aviso sai vazio', describeReschedule(p, id => id).length, 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [9] PARTICIPANTE — NULL segue sozinho; período próprio é clampado
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[9] Participante: NULL x período próprio');
{
  const nulo: ParticipantRowLike = { id: 'PT-1', instructorId: 'ANA', startDate: null, endDate: null };
  const p = plano({ participants: [nulo] });
  eq('NULL não é tocado (já significa "a demanda inteira")', p.participants.paraRecortar.length, 0);
  eq('nem limpo', p.participants.paraLimparPeriodo.length, 0);

  const proprio: ParticipantRowLike = { id: 'PT-2', instructorId: 'BRUNO', startDate: D2, endDate: D3 };
  const q = plano({ participants: [proprio] });
  eq('período próprio é clampado ao novo', q.participants.paraRecortar[0]?.endDate, D2);
  eq('e o início dele é preservado', q.participants.paraRecortar[0]?.startDate, D2);

  const dentro: ParticipantRowLike = { id: 'PT-3', instructorId: 'CARLA', startDate: D1, endDate: D2 };
  eq('período que já cabe não é tocado', plano({ participants: [dentro] }).participants.paraRecortar.length, 0);

  // Inteiramente fora: volta a NULL (= demanda inteira) e avisa. Período vazio
  // seria inválido, e remover a pessoa seria decidir por ela.
  const fora: ParticipantRowLike = { id: 'PT-4', instructorId: 'DANI', startDate: D3, endDate: D3 };
  const r = plano({ participants: [fora] });
  eq('período inteiramente fora volta a NULL', r.participants.paraLimparPeriodo.map(x => x.id), ['PT-4']);
  eq('e não é recortado', r.participants.paraRecortar.length, 0);
  check('com aviso para revisar', describeReschedule(r, id => id).some(a => a.includes('revise')));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [10] GUARDA DE FONTE — a reescrita inline não voltou
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[10] Guarda de fonte');
{
  const dem = ler('components/Demands.tsx');
  const interna = ler('components/InternalDemands.tsx');

  check('Demands usa o plano do domínio', dem.includes('planAllocationReschedule({'));
  check('e o aviso único do domínio', dem.includes('describeReschedule(plano, getInstructorName)'));

  // As duas linhas que causavam o estrago, cada uma prendida pelo que tinha de
  // característico: o UPDATE em lote de acompanhante e a expansão da alocação
  // para o período da demanda.
  check(
    'o UPDATE em lote de acompanhante sumiu',
    !/\.from\('companion_allocations'\)[\s\S]{0,200}\.in\(/.test(dem)
  );
  check(
    'e a expansão da alocação para o período da demanda também',
    !/updateInstructorAllocation\(\{[\s\S]{0,120}startDate: sanitizedDemand\.startDate/.test(dem)
  );
  check(
    'o recorte lê os dias reais da demanda (não o par start/end cru)',
    dem.includes('diasAntigos: activeDemand ? getDemandDays(activeDemand as any) : []') &&
      dem.includes('diasNovos: getDemandDays(sanitizedDemand as any)')
  );
  check(
    'e as remoções passam pelas funções de estado (não por SQL solto)',
    dem.includes('removeCompanionAllocation(ca.id)') && dem.includes('removeInstructorAllocation(a.id)')
  );
  check(
    'os dias de acompanhante que o plano manda criar são criados',
    /for \(const ca of plano\.companions\.paraCriar\)[\s\S]{0,200}addCompanionAllocation\(\{/.test(dem)
  );
  check(
    'e a criação vem DEPOIS da remoção (para não colidir com linha que ainda vai sair)',
    dem.indexOf('plano.companions.paraRemover') < dem.indexOf('plano.companions.paraCriar')
  );

  check('a interna aplica o MESMO plano', interna.includes('planAllocationReschedule({'));
  check(
    'nos participantes dela',
    interna.includes('participants: demandParticipants.filter(pt => pt.demandId === sanitized.id)')
  );

  // O update de acompanhante ficou endurecido como os outros da casa.
  const svc = ler('services/companionAllocations.ts');
  check(
    'updateCompanionAllocationDates é endurecido (0 linhas por RLS não passa calado)',
    svc.includes('export async function updateCompanionAllocationDates') &&
      svc.includes('data.length === 0')
  );
  const svcPart = ler('services/demandParticipants.ts');
  check(
    'updateDemandParticipantPeriod idem',
    svcPart.includes('export async function updateDemandParticipantPeriod') &&
      svcPart.includes('data.length === 0')
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [11] CARD DO ACOMPANHANTE — a demanda é a informação principal
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[11] Card do acompanhante na agenda');
{
  const cal = ler('components/CalendarView.tsx');

  check(
    'a tag ACOMPANHANTE é pequena (9px)',
    /text-\[9px\][^>]{0,120}>\s*ACOMPANHANTE/.test(cal.replace(/\s+/g, ' '))
  );
  check(
    'e a linha da demanda tem o corpo do card de titular',
    cal.includes("isCompanionItem(cellItem.data) ? 'text-[11px]' : 'text-[9px]'")
  );
  // O que NÃO pode mudar: cor e remoção.
  check('o verde continua o mesmo', cal.includes("bg: 'bg-emerald-600'"));
  check('e o × de remover continua no card', cal.includes('removeCompanionDay(cellItem.data)'));
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE RECORTE DE ALOCACOES: OK' : `\n❌ SMOKE RECORTE DE ALOCACOES: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
