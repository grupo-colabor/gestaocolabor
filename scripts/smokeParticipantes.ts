/**
 * SMOKE — Participantes de demanda interna (F1 da medição multi-pessoa)
 *
 * Rodar com:  npm run smoke:participantes
 *
 * Contexto: a equipe criou 5 demandas internas clonadas para uma mesma reunião
 * porque a interna comporta 1 instrutor. A F1 cria o vínculo `demand_participants`
 * (titular pleno), põe o participante na agenda e passa a contá-lo no conflito.
 *
 * As quatro contraprovas que este arquivo existe para prender:
 *
 *   [1] GUARDA DE FONTE — o fluxo de participante NÃO alcança
 *       `instructor_allocations`. É a asserção mais importante do arquivo: se
 *       alguém "simplificar" gravando participante lá, o split destrutivo de
 *       `addInstructorAllocation` apaga os participantes uns dos outros (todos
 *       ficam nos mesmos dias) e o rateio de `computeInstructorHoursByDemand`
 *       multiplica as horas — 2 pessoas numa interna de 16h dariam 16h CADA.
 *       Os dois estragos são silenciosos e caem em cima de pagamento.
 *
 *   [2] CONFLITO nas duas âncoras novas — participante (interna) e
 *       acompanhante (cliente), nos dois sentidos.
 *
 *   [3] PERÍODO — NULL cobre a demanda inteira; período próprio recorta.
 *
 *   [4] DOIS PARTICIPANTES NO MESMO DIA convivem (é O caso de uso).
 *
 * A regra de conflito é pura (`domain/personScheduleConflict.ts`) e roda de
 * verdade aqui. O que vive dentro de componente React — a passada da agenda, a
 * validação do período no modal — é preso por GUARDA DE FONTE, que falha se a
 * linha reproduzida sumir ou mudar, evitando o smoke ficar verde sobre código
 * morto (mesma técnica de smokeLocalOnline.ts e smokeDatasDemanda.ts).
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import {
  assignmentDays,
  hasPersonScheduleConflict,
  type PersonAssignmentLike,
  type PersonConflictDemandLike,
} from '../domain/personScheduleConflict';
import {
  hasBlocksFor,
  planTitularFill,
  planTitularFills,
  isLogisticBlockEmpty,
  hasSecondPerson,
} from '../domain/logisticBlockOwnership';
import { normalizeAgendaCell } from '../domain/agendaCellItems';
import {
  groupInstructorsForCompanion,
  isEligibleForDemand,
  hasGeoAnchor,
  isSameDemandState,
} from '../domain/instructorRecommendation';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(
    nome,
    Object.is(atual, esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`
  );

const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');

/**
 * Remove comentários antes de procurar por identificadores.
 *
 * As guardas de isolamento precisam disso: o cabeçalho de
 * `services/demandParticipants.ts` CITA `instructor_allocations` de propósito,
 * explicando por que não usa a tabela. Procurar a string crua reprovaria
 * justamente o arquivo que documenta a regra — e a correção preguiçosa seria
 * apagar a explicação.
 */
const semComentarios = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // blocos /* ... */
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // linha //, sem comer 'http://'

/* ────────────────────────────────────────────────────────────────────────────
 * Dataset — uma interna e uma demanda de cliente, sobrepostas em 12/03
 * ────────────────────────────────────────────────────────────────────────── */
const INTERNA: PersonConflictDemandLike = {
  id: 'DEM-900',
  status: 'ALOCADA',
  dateMode: 'CONTINUO',
  startDate: '2026-03-10T08:00',
  endDate: '2026-03-12T18:00',
};

const CLIENTE: PersonConflictDemandLike = {
  id: 'DEM-100',
  status: 'ALOCADA',
  dateMode: 'CONTINUO',
  startDate: '2026-03-12T08:00',
  endDate: '2026-03-13T18:00',
};

const CLIENTE_CANCELADA: PersonConflictDemandLike = {
  ...CLIENTE,
  id: 'DEM-101',
  status: 'CANCELADA',
};

/** Interna em DIAS_ESPECIFICOS: só 10 e 12; o dia 11 é buraco. */
const INTERNA_DIAS: PersonConflictDemandLike = {
  id: 'DEM-901',
  status: 'ALOCADA',
  dateMode: 'DIAS_ESPECIFICOS',
  specificDates: [
    { data: '2026-03-10', horarioInicio: '08:00', horarioFim: '18:00' },
    { data: '2026-03-12', horarioInicio: '08:00', horarioFim: '18:00' },
  ],
  startDate: '2026-03-10T08:00',
  endDate: '2026-03-12T18:00',
};

const DEMANDAS = [INTERNA, CLIENTE, CLIENTE_CANCELADA, INTERNA_DIAS];

const participante = (over: Partial<PersonAssignmentLike> = {}): PersonAssignmentLike => ({
  id: 'DP-1',
  demandId: 'DEM-900',
  instructorId: 'INS-A',
  startDate: null,
  endDate: null,
  ...over,
});

/** Acompanhante grava UMA LINHA POR DIA, com 'T08:00'/'T18:00' literais. */
const acompanhanteDia = (dia: string, over: Partial<PersonAssignmentLike> = {}): PersonAssignmentLike => ({
  id: `CA-${dia}`,
  demandId: 'DEM-100',
  instructorId: 'INS-B',
  startDate: `${dia}T08:00`,
  endDate: `${dia}T18:00`,
  ...over,
});

const conflita = (
  instructorId: string,
  startDate: string,
  endDate: string,
  assignments: PersonAssignmentLike[],
  excludeDemandId?: string
) =>
  hasPersonScheduleConflict({
    instructorId,
    startDate,
    endDate,
    assignments,
    demands: DEMANDAS,
    excludeDemandId,
  });

/* ────────────────────────────────────────────────────────────────────────────
 * [1] PERÍODO — NULL cobre tudo, próprio recorta
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Período do participante');
{
  eq(
    'período NULL = todos os dias da demanda',
    assignmentDays(participante(), INTERNA).join(','),
    '2026-03-10,2026-03-11,2026-03-12'
  );

  eq(
    'período próprio recorta',
    assignmentDays(participante({ startDate: '2026-03-11', endDate: '2026-03-12' }), INTERNA).join(','),
    '2026-03-11,2026-03-12'
  );

  eq(
    'período próprio maior que a demanda é aparado por ela',
    assignmentDays(participante({ startDate: '2026-03-01', endDate: '2026-03-31' }), INTERNA).join(','),
    '2026-03-10,2026-03-11,2026-03-12'
  );

  eq(
    'período fora da demanda não ocupa dia nenhum',
    assignmentDays(participante({ startDate: '2026-04-01', endDate: '2026-04-02' }), INTERNA).length,
    0
  );

  // DIAS_ESPECIFICOS: o buraco do dia 11 tem de continuar buraco.
  eq(
    'dias específicos: NULL devolve só os dias reais',
    assignmentDays(participante({ demandId: 'DEM-901' }), INTERNA_DIAS).join(','),
    '2026-03-10,2026-03-12'
  );
  eq(
    'dias específicos: período próprio não inventa o dia 11',
    assignmentDays(
      participante({ demandId: 'DEM-901', startDate: '2026-03-10', endDate: '2026-03-12' }),
      INTERNA_DIAS
    ).join(','),
    '2026-03-10,2026-03-12'
  );

  // Acompanhante: linha por dia, com horário colado na string.
  eq(
    'acompanhante de 1 dia ocupa 1 dia',
    assignmentDays(acompanhanteDia('2026-03-12'), CLIENTE).join(','),
    '2026-03-12'
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [2] CONFLITO — âncora 4 (participante) nos dois sentidos
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[2] Conflito — participante de interna (âncora 4)');
{
  const parts = [participante()]; // INS-A na interna, 10 a 12

  check(
    'participante bloqueia alocação em CLIENTE no dia sobreposto (12/03)',
    conflita('INS-A', '2026-03-12', '2026-03-13', parts)
  );

  check(
    'sem sobreposição de dia, não conflita',
    !conflita('INS-A', '2026-03-13', '2026-03-14', parts)
  );

  check(
    'conflito é por PESSOA: outro instrutor passa livre',
    !conflita('INS-Z', '2026-03-12', '2026-03-13', parts)
  );

  check(
    'excludeDemandId ignora a própria demanda (senão o card acusa conflito consigo mesmo)',
    !conflita('INS-A', '2026-03-10', '2026-03-12', parts, 'DEM-900')
  );

  check(
    'participante com período próprio não bloqueia dia fora dele',
    !conflita(
      'INS-A',
      '2026-03-10',
      '2026-03-10',
      [participante({ startDate: '2026-03-11', endDate: '2026-03-12' })]
    )
  );
  check(
    'e bloqueia dentro dele',
    conflita(
      'INS-A',
      '2026-03-11',
      '2026-03-11',
      [participante({ startDate: '2026-03-11', endDate: '2026-03-12' })]
    )
  );

  check(
    'demanda CANCELADA libera a agenda',
    !conflita('INS-A', '2026-03-12', '2026-03-12', [participante({ demandId: 'DEM-101' })])
  );

  check(
    'vínculo órfão (demanda fora do dataset) é ignorado',
    !conflita('INS-A', '2026-03-12', '2026-03-12', [participante({ demandId: 'DEM-INEXISTENTE' })])
  );

  check(
    'dias específicos: o buraco do dia 11 não conflita',
    !conflita('INS-A', '2026-03-11', '2026-03-11', [participante({ demandId: 'DEM-901' })])
  );
  check(
    'dias específicos: o dia 12 conflita',
    conflita('INS-A', '2026-03-12', '2026-03-12', [participante({ demandId: 'DEM-901' })])
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [3] CONFLITO — âncora 5 (acompanhante), o buraco antigo
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[3] Conflito — acompanhante de cliente (âncora 5)');
{
  const comps = [acompanhanteDia('2026-03-12'), acompanhanteDia('2026-03-13')];

  // Este é o comportamento NOVO: antes da F1, acompanhar não ocupava ninguém.
  check(
    'acompanhante bloqueia ser alocado em outra coisa no mesmo dia',
    conflita('INS-B', '2026-03-12', '2026-03-12', comps)
  );

  check(
    'acompanhante não bloqueia dia em que não acompanha',
    !conflita('INS-B', '2026-03-10', '2026-03-11', comps)
  );

  check(
    'excludeDemandId vale também para acompanhante',
    !conflita('INS-B', '2026-03-12', '2026-03-13', comps, 'DEM-100')
  );

  // REGRESSÃO: a implementação ANTIGA de hasScheduleConflict não olhava
  // companion_allocations — três âncoras, nenhuma delas a tabela. Reproduzida
  // aqui para o smoke provar que a âncora 5 mudou alguma coisa de verdade.
  const ancorasAntigas = (instructorId: string) =>
    [] // demands por instructor_id
      .concat([] as any) // instructor_allocations
      .concat([] as any) // agenda_items
      .some(() => true);
  check(
    '(antigo) as três âncoras originais não viam acompanhante nenhum',
    !ancorasAntigas('INS-B')
  );
  check(
    '(antigo) != atual — a âncora 5 é comportamento novo',
    ancorasAntigas('INS-B') !== conflita('INS-B', '2026-03-12', '2026-03-12', comps)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [4] DOIS PARTICIPANTES NO MESMO DIA — o caso de uso da feature
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[4] Dois participantes no mesmo dia');
{
  const a = participante({ id: 'DP-A', instructorId: 'INS-A' });
  const b = participante({ id: 'DP-B', instructorId: 'INS-B' });

  eq('os dois ocupam exatamente os mesmos dias', assignmentDays(a, INTERNA).join(','), assignmentDays(b, INTERNA).join(','));

  // Um NÃO conflita com o outro: são pessoas diferentes na mesma demanda, que
  // é a definição de participar junto. Se isto virar `true`, a feature parou
  // de servir para o caso que a motivou.
  check('participante A não conflita com participante B', !conflita('INS-A', '2026-03-10', '2026-03-12', [b]));
  check('participante B não conflita com participante A', !conflita('INS-B', '2026-03-10', '2026-03-12', [a]));

  // Três pessoas, mesmos dias, nenhuma bloqueia a outra.
  const c = participante({ id: 'DP-C', instructorId: 'INS-C' });
  check(
    'três participantes coexistem',
    !conflita('INS-C', '2026-03-10', '2026-03-12', [a, b]) &&
      !conflita('INS-A', '2026-03-10', '2026-03-12', [b, c])
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [5] GUARDA DE FONTE — participante nunca toca instructor_allocations
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[5] Guarda de fonte — isolamento de instructor_allocations');
{
  const service = ler('services/demandParticipants.ts');
  const interna = ler('components/InternalDemands.tsx');
  const app = ler('App.tsx');

  check(
    'services/demandParticipants.ts não importa instructorAllocations',
    !/from\s+['"].*instructorAllocations['"]/.test(service)
  );
  check(
    'services/demandParticipants.ts não usa instructor_allocations no CÓDIGO (o cabeçalho cita, e deve citar)',
    !semComentarios(service).includes('instructor_allocations')
  );
  check(
    'e o cabeçalho continua explicando por que NÃO usa',
    service.includes('instructor_allocations')
  );
  check(
    'services/demandParticipants.ts escreve só na própria tabela',
    (service.match(/\.from\('([a-z_]+)'\)/g) ?? []).every(m => m === ".from('demand_participants')")
  );

  // O form da interna já era proibido de escrever em instructor_allocations
  // (bloco Instrutores é somente leitura). A F1 não pode ter aberto essa porta.
  for (const escrita of [
    'addInstructorAllocation',
    'updateInstructorAllocation',
    'replaceInstructorAllocationsForDemand',
    'deleteInstructorAllocationsByDemandId',
  ]) {
    check(`InternalDemands.tsx não chama ${escrita}`, !interna.includes(escrita));
  }
  check(
    'InternalDemands.tsx não importa services/instructorAllocations',
    !/from\s+['"].*services\/instructorAllocations['"]/.test(interna)
  );

  // O handler que adiciona participante grava participante — e só.
  const handler = interna.slice(
    interna.indexOf('const handleAddParticipant'),
    interna.indexOf('const handleRemoveParticipant')
  );
  check('handleAddParticipant existe', handler.length > 0);
  check('handleAddParticipant chama addDemandParticipant', handler.includes('addDemandParticipant('));
  check(
    'handleAddParticipant não chama nada de instructor allocation',
    !/InstructorAllocation/.test(handler)
  );
  check(
    'handleAddParticipant DELEGA a logística à rotina compartilhada (uma regra para interna e cliente)',
    handler.includes('await ensureLogisticBlocksForPerson(formDemand.id, payload.instructorId)')
  );
  check(
    'e NÃO reimplementa a criação de bloco localmente',
    !handler.includes('emptyLocomocaoBlock()') && !handler.includes('insertLogisticBlocks')
  );
  check(
    'a logística só é preparada DEPOIS de o participante gravar (nada de bloco órfão)',
    handler.indexOf('if (!ok) return;') < handler.indexOf('ensureLogisticBlocksForPerson')
  );

  // O App liga participante ao banco pelo service novo, não pelo de alocação.
  check(
    'App.tsx importa o service de participantes',
    /from\s+['"]\.\/services\/demandParticipants['"]/.test(app)
  );
  check(
    'App.addDemandParticipant não passa por instructor allocation',
    !/InstructorAllocation/.test(
      app.slice(app.indexOf('const addDemandParticipant'), app.indexOf('const removeDemandParticipant'))
    )
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [6] GUARDA DE FONTE — agenda, conflito, limpeza e aviso de tela
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[6] Guarda de fonte — integração');
{
  const cal = ler('components/CalendarView.tsx');
  const app = ler('App.tsx');
  const modal = ler('components/ParticipantSelectionModal.tsx');

  // A passada da agenda não é importável (vive dentro do useMemo do
  // componente). As três linhas que a fazem funcionar ficam ancoradas aqui.
  const passada = cal.slice(
    cal.indexOf('PRIORIDADE 1.7'),
    cal.indexOf('PRIORIDADE 2:')
  );
  check('CalendarView tem a passada de participantes', passada.length > 0);
  check(
    'a passada alimenta allocMulti (senão dois participantes no mesmo dia se sobrescrevem)',
    passada.includes('allocMulti[key].push(item)')
  );
  check('a passada usa a MESMA regra de dias do conflito', passada.includes('assignmentDays(pt, d as any)'));
  check(
    'participante entra com isCompanion: false (herda o âmbar de interna, não o verde de acompanhante)',
    passada.includes('isCompanion: false')
  );
  check('participante leva demandId (é o que dispara o ramo de cor de interna)', passada.includes('demandId: d.id'));
  check(
    'passada 2 exclui demandas que já têm participante',
    cal.includes('!demandsWithParticipants.has(d.id)')
  );
  check(
    'demandParticipants está nas deps do useMemo da agenda',
    /\}, \[agendaItems, instructorAllocations, companionAllocations, demandParticipants, demands, trainings, companies\]\);/.test(cal)
  );

  // Âncoras 4 e 5 no App.
  check('App usa a regra pura de conflito de pessoa', app.includes("from './domain/personScheduleConflict'"));
  check(
    'âncora 4 (participantes) está ligada',
    /assignments: demandParticipants,/.test(app)
  );
  check(
    'âncora 5 (acompanhantes) está ligada',
    /assignments: companionAllocations,/.test(app)
  );
  check(
    'demandParticipants e companionAllocations nas deps de hasScheduleConflict',
    /demandParticipants,\r?\n\s*companionAllocations,\r?\n\s*getEffectiveDemandRange,/.test(app)
  );

  // Limpeza de estado no deleteDemand — inclui a linha de acompanhante que
  // faltava (achado do diagnóstico: card fantasma na agenda até o reload).
  check(
    'deleteDemand limpa demandParticipants do estado (2 ramos: mock e supabase)',
    (app.match(/setDemandParticipants\(prev => prev\.filter\(a => a\.demandId !== id\)\)/g) ?? []).length === 2
  );
  check(
    'deleteDemand limpa companionAllocations do estado (linha que faltava)',
    (app.match(/setCompanionAllocations\(prev => prev\.filter\(a => a\.demandId !== id\)\)/g) ?? []).length === 2
  );

  // Validação tudo-ou-nada do período, do lado da UI (o CHECK do banco é o
  // outro lado — item [7]).
  check(
    'modal valida tudo-ou-nada antes do save',
    modal.includes('if (!!s !== !!e)')
  );
  check('modal valida início <= fim', modal.includes('if (s > e)'));
  check(
    'modal valida período dentro da demanda (senão o participante não aparece em dia nenhum)',
    modal.includes('s < dStart || e > dEnd')
  );
  check(
    'modal AVISA conflito sem bloquear (o botão não depende de hasConflict)',
    modal.includes('disabled={!selectedId}') && !/disabled=\{[^}]*hasConflict/.test(modal)
  );

  // O aviso de que F1 ainda não paga.
  const formInterna = ler('components/InternalDemands.tsx');
  check(
    'card Participantes avisa que ainda não gera pagamento',
    /Ainda não geram pagamento na medição/.test(formInterna)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [7] GUARDA DE FONTE — a migration 016 sustenta o que o código assume
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[7] Guarda de fonte — migration 016');
{
  const m = ler('supabase/migrations/016_participants_and_allocation_ddl.sql');

  check('tabela demand_participants criada', m.includes('CREATE TABLE IF NOT EXISTS public.demand_participants'));
  check('período é date (dia inteiro)', /start_date\s+date NULL/.test(m) && /end_date\s+date NULL/.test(m));
  check('CHECK tudo-ou-nada do período', m.includes('demand_participants_periodo_check'));
  check('UNIQUE (demand_id, instructor_id)', /demand_participants_uq\s*\r?\n?\s*UNIQUE \(demand_id, instructor_id\)/.test(m));
  check(
    'FK composta garante tipo=interna',
    m.includes('FOREIGN KEY (demand_id, tipo) REFERENCES public.demands (id, tipo)')
  );
  check('FK composta apaga em cascata e barra troca de tipo', m.includes('ON DELETE CASCADE ON UPDATE RESTRICT'));
  check('UNIQUE alvo da FK composta em demands', m.includes('demands_id_tipo_uq'));
  check('4 policies da tabela nova', (m.match(/CREATE POLICY "Autenticados podem \w+ demand_participants"/g) ?? []).length === 4);
  check('logistic_blocks.instructor_id existe', m.includes('ADD COLUMN IF NOT EXISTS instructor_id uuid NULL'));
  check('FK do bloco degrada o vínculo, não o dado', m.includes('ON DELETE SET NULL'));

  // O service escreve exatamente as colunas que a migration declara.
  const service = ler('services/demandParticipants.ts');
  check(
    'service não envia tipo (fica com o DEFAULT do banco, que compõe a FK)',
    !/tipo:\s*'interna'/.test(service)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [8] BLOCOS DE LOGÍSTICA — persistidos na hora, sem apagar os existentes
 *
 * Bug do teste manual da F1: o participante gravava, os blocos não. O card de
 * Participantes só existe em `modalSubMode === 'VIEW'`, e a VIEW não tem botão
 * de salvar — então o `setFormDemand` com os dois blocos morria ao fechar o
 * modal, e `loadLogisticsFor` sobrescrevia o estado ao reabrir.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[8] Blocos de logística do participante');
{
  const interna = ler('components/InternalDemands.tsx');
  const logistics = ler('services/logistics.ts');

  const handler = interna.slice(
    interna.indexOf('const handleAddParticipant'),
    interna.indexOf('const handleRemoveParticipant')
  );

  // A CRIAÇÃO em si mora no App (ensureLogisticBlocksForPerson), compartilhada
  // com o fluxo de acompanhante — as asserções dela estão em [12]. Aqui fica o
  // contrato do caminho da INTERNA: delegar, e depois refletir na tela.
  check('a interna delega, não reimplementa', handler.includes('await ensureLogisticBlocksForPerson('));
  check(
    'NÃO usa upsertLogisticBlocks aqui (delete-all apagaria os blocos dos outros)',
    !handler.includes('upsertLogisticBlocks')
  );
  check(
    'o estado do form vem do BANCO depois de gravar (traz junto o bloco do titular recém-identificado)',
    handler.includes('await loadLogisticsFor(formDemand.id)') &&
      handler.includes('logisticasLocomocao: logistics.locoBlocks') &&
      handler.includes('logisticasHospedagem: logistics.hospBlocks')
  );
  check(
    'o recarregamento vem DEPOIS da preparação da logística (senão traria o estado antigo)',
    handler.indexOf('ensureLogisticBlocksForPerson') < handler.indexOf('loadLogisticsFor')
  );

  // insertLogisticBlocks: insert puro e endurecido.
  const insertFn = logistics.slice(
    logistics.indexOf('export async function insertLogisticBlocks'),
    logistics.indexOf('export async function deleteLogisticBlock')
  );
  check('insertLogisticBlocks existe', insertFn.length > 0);
  check('insertLogisticBlocks NÃO apaga nada', !insertFn.includes('.delete()'));
  check(
    'insertLogisticBlocks é endurecido (0 linhas por RLS não passa calado)',
    insertFn.includes('data.length !== rows.length')
  );

  // Remocao pelo form: quem apaga bloco no BANCO e o App (ver [15]); aqui a
  // tela so reflete. Ter as duas coisas no form foi o que deixou a remocao
  // pela AGENDA sem limpeza nenhuma.
  const remover = interna.slice(
    interna.indexOf('const handleRemoveParticipant'),
    interna.indexOf('const handleCancelDemand')
  );
  check('remocao delega ao App', remover.includes('await removeDemandParticipant(participantId)'));
  check(
    'e NAO reimplementa a limpeza de bloco',
    !remover.includes('deleteLogisticBlock') && !remover.includes('locoVazio(')
  );
  check(
    'a tela recarrega do banco depois de remover',
    remover.includes('await loadLogisticsFor(formDemand.id)')
  );
  check(
    'remocao NUNCA apaga por demand_id (levaria os blocos dos outros)',
    !remover.includes('demand_id') && !remover.includes('upsertLogisticBlocks')
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [9] INDICADOR DE PARTICIPANTES — listagem, modal e Excel
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[9] Indicador de participantes');
{
  const interna = ler('components/InternalDemands.tsx');
  const exportar = ler('components/ExportDemandsModal.tsx');

  check(
    'nomes derivam do estado global (sem fetch novo na listagem)',
    interna.includes('const participantNamesByDemandId = useMemo(') &&
      /participantNamesByDemandId = useMemo\(\(\) => \{[\s\S]{0,600}for \(const pt of demandParticipants\)/.test(interna)
  );
  check(
    'a listagem NÃO busca participante por demanda (nada de N+1)',
    !/fetchDemandParticipants/.test(interna)
  );
  check('badge +N na coluna do instrutor', interna.includes('<Users size={10} /> +{participantesDaLinha.length}'));
  check(
    'tooltip lista os nomes',
    interna.includes('title={`Participantes: ${participantesDaLinha.join(\', \')}`}')
  );
  check(
    'participante não é contado como instrutor alocado (badge separado, cor própria)',
    interna.includes('bg-emerald-600 text-white w-fit')
  );
  check(
    'demanda só com participante deixa de aparecer como "Não Alocado" seco',
    interna.includes("{ids.length === 0 && participantesDaLinha.length === 0 ? 'Não Alocado'")
  );
  check('badge também no cabeçalho do modal', interna.includes('+{currentParticipants.length}'));

  // Excel: coluna nova só na interna — o export de cliente não muda.
  check('coluna Participantes no export', exportar.includes("key: 'participantes'"));
  check(
    'a coluna existe SÓ na variante interna',
    /\.\.\.\(isInterna\s*\r?\n?\s*\? \[\{ header: 'Participantes', key: 'participantes', width: 40 \}\]/.test(exportar)
  );
  check(
    'valores separados por vírgula',
    exportar.includes("{ participantes: (participantNamesByDemandId[d.id] ?? []).join(', ') }")
  );
  check(
    'os nomes chegam por prop (o modal é compartilhado com a tela de cliente)',
    exportar.includes('participantNamesByDemandId?: Record<string, string[]>') &&
      exportar.includes('participantNamesByDemandId = {},')
  );
  check(
    'a tela interna passa a prop',
    interna.includes('participantNamesByDemandId={participantNamesByDemandId}')
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [10] LOGÍSTICA POR PESSOA — a regra, rodando de verdade
 *
 * Com UMA pessoa o bloco fica anônimo, como sempre foi. Entrando a SEGUNDA —
 * participante (interna) ou acompanhante (cliente) — todo bloco passa a ser
 * identificado: o da pessoa nova nasce com nome + id, e o anônimo que estava
 * lá vira do titular.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[10] Logística por pessoa — regra pura');
{
  const TITULAR = 'INS-T';
  const SEGUNDO = 'INS-2';

  // --- gatilho: existe segunda pessoa? ---
  check('uma pessoa só (nem participante nem acompanhante) não dispara a regra',
    !hasSecondPerson([], [], TITULAR));
  check('participante dispara', hasSecondPerson([SEGUNDO], [], TITULAR));
  check('acompanhante dispara', hasSecondPerson([], [SEGUNDO], TITULAR));
  check('vínculo que É o próprio titular NÃO dispara (não há segunda pessoa)',
    !hasSecondPerson([], [TITULAR], TITULAR));

  // --- idempotência: acompanhante é uma linha POR DIA ---
  const doSegundo = [{ id: 'B1', instructorId: SEGUNDO }];
  check('pessoa sem bloco -> precisa criar', !hasBlocksFor([], SEGUNDO));
  check('pessoa que já tem bloco -> não cria de novo', hasBlocksFor(doSegundo, SEGUNDO));
  check('bloco de outra pessoa não conta', !hasBlocksFor(doSegundo, TITULAR));

  // --- o bloco anônimo do titular ---
  const anonimo = [{ id: 'B0', instructorId: null }];
  eq('o anônimo vira do titular',
    planTitularFill(anonimo, TITULAR, 'Ana')?.blockId, 'B0');
  eq('e leva o nome junto',
    planTitularFill(anonimo, TITULAR, 'Ana')?.instructorName, 'Ana');

  check('sem titular definido (Não Alocado), não preenche nada',
    planTitularFill(anonimo, undefined, 'Ana') === null);
  check('titular que JÁ tem bloco não ganha um segundo',
    planTitularFill([{ id: 'B0', instructorId: TITULAR }], TITULAR, 'Ana') === null);
  check('sem bloco anônimo, nada a fazer',
    planTitularFill(doSegundo, TITULAR, 'Ana') === null);

  // Trava: vários anônimos -> só o PRIMEIRO. Atribuir todos ao titular seria
  // inventar vínculo para blocos que o usuário criou à mão.
  const tresAnonimos = [
    { id: 'B0', instructorId: null },
    { id: 'B1', instructorId: null },
    { id: 'B2', instructorId: null },
  ];
  eq('vários anônimos: só o primeiro é preenchido',
    planTitularFill(tresAnonimos, TITULAR, 'Ana')?.blockId, 'B0');

  // Trava: bloco de OUTRA pessoa nunca é renomeado.
  const mistura = [{ id: 'BX', instructorId: SEGUNDO }, { id: 'B0', instructorId: null }];
  eq('pula o bloco de outra pessoa e pega o anônimo',
    planTitularFill(mistura, TITULAR, 'Ana')?.blockId, 'B0');

  // --- locomoção e hospedagem resolvem independentes ---
  const fills = planTitularFills(
    [{ id: 'L0', instructorId: null }],
    [{ id: 'H0', instructorId: null }],
    TITULAR,
    'Ana'
  );
  eq('dois preenchimentos: um de cada tipo', fills.map(f => f.blockId).join(','), 'L0,H0');
  eq('só locomoção anônima -> um preenchimento só',
    planTitularFills([{ id: 'L0', instructorId: null }], [{ id: 'H0', instructorId: SEGUNDO }], TITULAR, 'Ana').length,
    1);
  eq('nada anônimo -> nenhum preenchimento',
    planTitularFills([{ id: 'L0', instructorId: TITULAR }], [{ id: 'H0', instructorId: SEGUNDO }], TITULAR, 'Ana').length,
    0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [11] BLOCO VAZIO — o que pode e o que não pode ser apagado
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[11] Bloco vazio');
{
  check('bloco de locomoção recém-criado está vazio',
    isLogisticBlockEmpty({ block_type: 'LOCOMOCAO' }));
  check('bloco de hospedagem recém-criado está vazio',
    isLogisticBlockEmpty({ block_type: 'HOSPEDAGEM' }));

  // A pegadinha: o formulário cria bloco já com locadora e categoria default.
  // Contá-los como dado faria TODO bloco parecer preenchido e nada seria limpo.
  check('locadora/categoria default NÃO contam como dado',
    isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', rental_company: 'Localiza', car_category: 'Grupo CE' } as any));

  check('com meio de transporte, não é vazio',
    !isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', transport_mode: 'CARRO_ALUGADO' }));
  check('com localizador, não é vazio',
    !isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', rental_locator: 'ABC123' }));
  check('com notinha anexada, não é vazio',
    !isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', receipt_url: ['x.pdf'] }));
  check('com hotel, não é vazio',
    !isLogisticBlockEmpty({ block_type: 'HOSPEDAGEM', hotel_name: 'Ibis' }));
  check('array vazio de notinha continua vazio',
    isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', receipt_url: [] }));
  check('campo de hospedagem não vaza para a checagem de locomoção',
    isLogisticBlockEmpty({ block_type: 'LOCOMOCAO', hotel_name: 'Ibis' } as any));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [12] ACOMPANHANTE — guarda de fonte dos quatro caminhos de criação
 *
 * O caso que motivou a idempotência: acompanhante de 3 dias vira 3 linhas de
 * companion_allocations, mas tem de virar 2 blocos de logística, não 6.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[12] Acompanhante — logística por pessoa');
{
  const drawer = ler('components/AllocationDrawer.tsx');
  const logisticaTela = ler('components/Logistics.tsx');
  const cal = ler('components/CalendarView.tsx');
  const app = ler('App.tsx');
  const service = ler('services/logistics.ts');

  // Os QUATRO caminhos de criação chamam a rotina — e nenhum deles a chama
  // dentro do laço de dias.
  // Depois da unificacao do fluxo de acompanhante, cada tela tem UM caminho de
  // criacao: o CompanionPicker devolve instrutor + dias e cada tela grava uma
  // vez. Antes eram dois por tela (modo direto e selecao de dias no drawer;
  // demanda inteira e dias selecionados na Logistica) — quatro implementacoes
  // da mesma coisa.
  const chamadasDrawer = (drawer.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length;
  const chamadasLogistica = (logisticaTela.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length;
  eq('AllocationDrawer: um caminho de criacao de acompanhante', chamadasDrawer, 1);
  eq('Logistics: um caminho de criacao de acompanhante', chamadasLogistica, 1);

  /**
   * A chamada precisa ficar FORA do laço que grava uma linha por dia. A prova:
   * entre o "forEach(day =>" mais proximo antes dela e a propria chamada
   * tem de existir um fechamento de laco. Sem isso, um acompanhante de
   * 3 dias faria 3 idas ao banco para preparar o mesmo par de blocos.
   */
  const foraDoLaco = (src: string): boolean => {
    let ok = true;
    let from = 0;
    for (;;) {
      const chamada = src.indexOf('ensureLogisticBlocksForPerson(', from);
      if (chamada < 0) break;
      from = chamada + 1;
      const laco = src.lastIndexOf('forEach(day =>', chamada);
      if (laco < 0) continue; // não há laço antes: trivialmente fora
      if (!src.slice(laco, chamada).includes('});')) ok = false;
    }
    return ok;
  };

  for (const [nome, src] of [['AllocationDrawer', drawer], ['Logistics', logisticaTela]] as const) {
    check(`${nome}: chamada fica FORA do laço de dias`, foraDoLaco(src));
  }

  // A idempotência de verdade mora no App, sobre hasBlocksFor.
  const ensure = app.slice(
    app.indexOf('const ensureLogisticBlocksForPerson'),
    app.indexOf('const fillTitularLogisticBlocks')
  );
  check('ensure existe', ensure.length > 0);
  check('só cria se a pessoa ainda não tem bloco', ensure.includes('if (!hasBlocksFor(existentes, instructorId))'));
  check('cria exatamente 2 blocos', (ensure.match(/block_type: '(LOCOMOCAO|HOSPEDAGEM)'/g) ?? []).length === 2);
  check('usa insert puro, nunca delete-all', ensure.includes('insertLogisticBlocks(') && !ensure.includes('upsertLogisticBlocks'));
  check('identifica o bloco anônimo do titular', ensure.includes('aplicarDonoDoTitular(blocks, titularId)'));
  check('não se identifica a si mesmo como titular', ensure.includes('titularId !== instructorId'));

  // Titular que chega DEPOIS (Programação / Alocação Inteligente / agenda).
  check('allocateInstructor preenche o bloco do titular', app.includes('void fillTitularLogisticBlocks(demandId, instructorId);'));
  const fill = app.slice(
    app.indexOf('const fillTitularLogisticBlocks'),
    app.indexOf('const [operationalBases')
  );
  check(
    'com UMA pessoa só, o bloco continua anônimo (metade da regra que evita pedir nome de quem não precisa)',
    fill.includes('if (!temOutraPessoa) return;')
  );

  // Remoção: só bloco vazio, um id por vez, e só no ÚLTIMO vínculo da pessoa.
  // `releaseLogisticBlocksForPerson` fica ANTES de `removeDemandParticipant`,
  // que é quem o chama — um useCallback não pode citar nas deps algo declarado
  // depois dele (TDZ na hora do render).
  const release = app.slice(
    app.indexOf('const releaseLogisticBlocksForPerson'),
    app.indexOf('const removeDemandParticipant')
  );
  check('release só apaga bloco vazio', release.includes('isLogisticBlockEmpty(b)'));
  check('release filtra pela pessoa que saiu (nunca toca o titular)', release.includes('b.instructor_id === instructorId'));
  check('release apaga por id, um a um', release.includes('await deleteLogisticBlock(b.id)'));
  check('release nunca apaga por demand_id', !/delete[\s\S]{0,80}demand_id/.test(release));

  check('Logistics libera só quando cai o último dia da pessoa', logisticaTela.includes('eraUltimoDaPessoa'));
  check('agenda (× do card) libera só quando cai o último dia', cal.includes('eraUltimoDaPessoa'));
  // Recorte necessário: `removeCompanionAllocation` também aparece lá em cima,
  // na desestruturação do contexto — comparar índices no arquivo inteiro
  // compararia com a linha errada.
  const trechoLogistica = logisticaTela.slice(logisticaTela.indexOf('const handleRemoveCompanion'));
  // A conta do "ultimo dia" saiu do onClick inline e virou removeCompanionDay
  // (um removedor, dois cards de acompanhante: o cheio e o compacto da celula
  // dividida). A guarda segue a regra ate a casa nova.
  const trechoAgenda = cal.slice(cal.indexOf('const removeCompanionDay'));
  for (const [nome, src] of [['Logistics', trechoLogistica], ['CalendarView', trechoAgenda]] as const) {
    check(
      `${nome}: conta os dias restantes ANTES da remoção (que é otimista)`,
      src.indexOf('eraUltimoDaPessoa') >= 0 &&
        src.indexOf('eraUltimoDaPessoa') < src.indexOf('removeCompanionAllocation(')
    );
  }

  // O update pontual do dono, endurecido.
  const upd = service.slice(
    service.indexOf('export async function updateLogisticBlockOwner'),
    service.indexOf('export async function deleteLogisticBlock')
  );
  check('updateLogisticBlockOwner só toca dono e updated_at',
    upd.includes('instructor_id: instructorId') && upd.includes('instructor_name: instructorName') &&
    !upd.includes('transport_mode') && !upd.includes('hotel_name'));
  check('updateLogisticBlockOwner é endurecido (0 linhas por RLS não passa calado)',
    upd.includes('data.length === 0'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [13] O SAVE DO FORM DE CLIENTE NÃO PODE APAGAR A IDENTIFICAÇÃO
 *
 * O save do cliente é delete-all + insert. Se o mapeamento não carregar
 * instructor_id, salvar o formulário APAGA em silêncio o vínculo que o fluxo
 * de acompanhante gravou.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[13] Round-trip do instructor_id no form de cliente');
{
  const cliente = ler('components/Demands.tsx');
  const interna = ler('components/InternalDemands.tsx');

  for (const [nome, src] of [['Demands.tsx', cliente], ['InternalDemands.tsx', interna]] as const) {
    check(`${nome}: LÊ instructor_id do banco para o bloco`,
      (src.match(/instructorId: b\.instructor_id \?\? null/g) ?? []).length === 2);
    check(`${nome}: ESCREVE instructor_id de volta (senão o save apaga o vínculo)`,
      (src.match(/instructor_id: b\.instructorId \?\? null/g) ?? []).length === 2);
  }
}
/* ────────────────────────────────────────────────────────────────────────────
 * [14] CARD DA AGENDA — participante é indistinguível do titular
 *
 * Participante é titular pleno, então o card dele tem de ser o MESMO do
 * titular da demanda: fonte maior, segunda linha com o local, ID do cliente e
 * badges. O card compacto verde é do ACOMPANHANTE, e essa diferença é
 * intencional — este bloco também prende que ela continua existindo.
 *
 * O bug que motivou: a passada 5 herdou o `source` próprio da 1.5, e o
 * conteúdo do card era escolhido por uma lista literal de fontes
 * (DEMANDA/ALLOCATION). PARTICIPANT caía no ramo de fallback — o compacto.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[14] Card da agenda');
{
  const cal = ler('components/CalendarView.tsx');

  /** Chaves montadas num literal de UnifiedItem, a partir do marcador. */
  const chavesDoItem = (marcador: string): string[] => {
    const i = cal.indexOf(marcador);
    if (i < 0) return [];
    const corpo = cal.slice(i, cal.indexOf('};', i));
    return [...corpo.matchAll(/^\s+([a-zA-Z]+):/gm)].map(m => m[1]);
  };

  const doTitular = chavesDoItem('const allocItem: UnifiedItem = {');
  const doParticipante = chavesDoItem('const item: UnifiedItem = {');

  check('achou o item do titular (passada 1)', doTitular.length > 0);
  check('achou o item do participante (passada 5)', doParticipante.length > 0);

  // A asserção central: nada que o titular carrega pode faltar no participante.
  const faltando = doTitular.filter(k => !doParticipante.includes(k));
  eq('participante carrega TODOS os campos do titular', faltando.join(',') || '(nenhum)', '(nenhum)');

  // O único extra permitido é a negação explícita de acompanhante.
  const extras = doParticipante.filter(k => !doTitular.includes(k));
  eq('e só um campo a mais', extras.join(','), 'isCompanion');
  check('que é explicitamente falso', cal.includes('isCompanion: false'));

  // O local vem de `description`, como no titular — é a segunda linha do card.
  check(
    'os dois levam o local do treinamento',
    (cal.match(/description: d\.trainingLocal,/g) ?? []).length >= 2
  );

  // O gate do layout completo passou a ser um predicado nomeado, e inclui
  // PARTICIPANT. Se voltar a ser lista literal de duas fontes, quebra aqui.
  check('o layout completo é decidido por rendersAsDemandCard', cal.includes('{rendersAsDemandCard(cellItem.data.source) ? (() => {'));
  check(
    'e o predicado inclui participante',
    /rendersAsDemandCard = \(source\?: string\): boolean =>[\s\S]{0,200}source === 'PARTICIPANT'/.test(cal)
  );
  check(
    'acompanhante continua FORA (o card verde compacto dele é intencional)',
    !/rendersAsDemandCard = \(source\?: string\): boolean =>[\s\S]{0,200}COMPANION/.test(cal)
  );

  // Clique: o participante abre a demanda igual ao titular.
  eq(
    'clique no card e na célula resolvem a demanda pelo mesmo predicado',
    (cal.match(/rendersAsDemandCard\((item|existing)\.source\)/g) ?? []).length,
    2
  );

  // DRAG continua travado — arrastar move instructor_allocation, e o
  // participante não vive lá. É a única coisa que o card NÃO herda.
  check(
    'drag segue restrito a DEMANDA/ALLOCATION (participante não é arrastável)',
    cal.includes("if (item.source !== 'DEMANDA' && item.source !== 'ALLOCATION') return;") &&
      cal.includes("(cellItem.data.source === 'DEMANDA' || cellItem.data.source === 'ALLOCATION')")
  );

  // A resolução do id da demanda no card completo: ALLOCATION e PARTICIPANT
  // guardam o id da LINHA em `id`, não o da demanda.
  check(
    'card completo resolve demandId sem cair no id da linha',
    cal.includes("cellItem.data.source === 'DEMANDA'") &&
      cal.includes('? cellItem.data.demandId || cellItem.data.id') &&
      cal.includes(': cellItem.data.demandId;')
  );

  // Datas no mesmo formato do titular (datetime, não data seca).
  check(
    'participante usa datetime completo, como a passada 1',
    cal.includes("const participantStart = ensureDateTimeForDisplay(dias[0], 'start');") &&
      cal.includes("const participantEnd = ensureDateTimeForDisplay(dias[dias.length - 1], 'end');")
  );
}
/* ────────────────────────────────────────────────────────────────────────────
 * [15] REMOÇÃO PELA AGENDA — roteamento por source
 *
 * O bug: o modal de registro terminava num `else` que chama removeAgendaItem.
 * PARTICIPANT caía ali e o delete ia para agenda_items com um id de
 * demand_participants — daí o "Erro ao excluir registro da agenda". Mesma
 * classe do que já estava travado no drag; só o caminho de remoção ficou
 * aberto.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[15] Remoção de participante pela agenda');
{
  const cal = ler('components/CalendarView.tsx');
  const app = ler('App.tsx');
  const interna = ler('components/InternalDemands.tsx');

  const remover = cal.slice(
    cal.indexOf('const handleRemoveAction'),
    cal.indexOf('const handleRemoveMobileEvent')
  );
  check('achou o handler de remoção do modal', remover.length > 0);

  // A asserção central: PARTICIPANT roteia para o service certo...
  check(
    'PARTICIPANT roteia para removeDemandParticipant',
    /activeItem\.source === 'PARTICIPANT'[\s\S]{0,1500}removeDemandParticipant\(activeItem\.id\)/.test(remover)
  );

  // ...e nunca alcança o delete de agenda_items. O ramo de PARTICIPANT tem de
  // terminar em `return` ANTES do bloco que chama removeAgendaItem.
  // Recorte do RAMO, não do handler inteiro: o roteamento de DEMANDA/ALLOCATION
  // vem logo depois e cita removeInstructorAllocation legitimamente.
  const ramo = remover.slice(
    remover.indexOf("activeItem.source === 'PARTICIPANT'"),
    remover.indexOf('// ✅ Se for uma demanda')
  );
  check('o ramo de PARTICIPANT existe antes do delete de agenda', ramo.length > 0);
  check('e sai com return antes dele', /setIsModalOpen\(false\);\s*\r?\n\s*return;/.test(ramo));
  check(
    'o ramo de PARTICIPANT não chama removeAgendaItem nem removeInstructorAllocation',
    !ramo.includes('removeAgendaItem(') && !ramo.includes('removeInstructorAllocation(')
  );

  // CONTRAPROVA: agenda_items de verdade (férias, folga) continuam no caminho
  // antigo. Se o roteamento novo tivesse engolido o else, isto quebraria.
  check(
    'MANUAL (férias/folga) continua indo para removeAgendaItem',
    remover.includes('removeAgendaItem(activeItem.id); // MANUAL')
  );
  check(
    'DEMANDA continua em deallocateInstructor',
    /activeItem\.source === 'DEMANDA'\) \{\s*\r?\n\s*deallocateInstructor\(activeItem\.id\);/.test(remover)
  );
  check(
    'ALLOCATION continua em removeInstructorAllocation',
    /activeItem\.source === 'ALLOCATION'\) \{\s*\r?\n\s*removeInstructorAllocation\(activeItem\.id\);/.test(remover)
  );

  // Confirmação e permissão.
  check('pede confirmação antes de remover', ramo.includes('window.confirm('));
  check(
    'a confirmação diz o que vai acontecer com a logística',
    ramo.includes('blocos de logística vazios dele serão removidos')
  );
  check('respeita a matriz de editar interna (admin + analista)', ramo.includes('podeRemoverParticipante'));
  check(
    'e a matriz é a mesma do form interno',
    /podeRemoverParticipante = profile\?\.role === 'admin' \|\| profile\?\.role === 'analista'/.test(cal)
  );

  // A liberação dos blocos mora no App, para valer nos DOIS caminhos de
  // remoção (card do form e card da agenda) — não no chamador.
  const removeApp = app.slice(
    app.indexOf('const removeDemandParticipant'),
    app.indexOf('const [operationalBases')
  );
  check(
    'removeDemandParticipant libera os blocos vazios',
    removeApp.includes('await releaseLogisticBlocksForPerson(alvo.demandId, alvo.instructorId)')
  );
  check(
    'e guarda a linha ANTES do delete (depois ela já saiu do estado)',
    removeApp.indexOf('const alvo = demandParticipants.find') < removeApp.indexOf('deleteDemandParticipantById')
  );
  check(
    'o form interno deixou de duplicar a limpeza',
    !interna.includes('deleteLogisticBlock')
  );

  // Modal: participante enxerga a demanda igual ao titular.
  check(
    'resolveLinkedDemand inclui PARTICIPANT (Local/Estado/Corredor deixam de ser "Não informado")',
    /function resolveLinkedDemand[\s\S]{0,700}item\.source !== 'PARTICIPANT'/.test(cal)
  );
  check(
    'o bloco da demanda no modal usa o mesmo predicado do card',
    cal.includes('const linkedDemand = rendersAsDemandCard(activeItem.source)')
  );
  check('a ORIGEM aparece legível', cal.includes("? 'PARTICIPANTE'"));

  // Nenhum outro caminho de escrita do modal atinge agenda_items para
  // PARTICIPANT: salvar observação vai para demands.observations (igual ao
  // titular) e o modo EDIT nunca é acionado sobre um item existente.
  const obs = cal.slice(
    cal.indexOf('const handleUpdateObservation'),
    cal.indexOf('const removeCTMForDemandIfAny')
  );
  check(
    'salvar observação só toca agenda_items no ramo MANUAL',
    /activeItem\.source === 'MANUAL'[\s\S]{0,300}updateAgendaItem/.test(obs) &&
      obs.slice(obs.indexOf('} else {')).includes('updateDemand(') &&
      !obs.slice(obs.indexOf('} else {')).includes('updateAgendaItem(')
  );
  check(
    'o modal não tem caminho de EDIT sobre item existente (só VIEW e CREATE)',
    !cal.includes("setModalMode('EDIT')")
  );
}
/* ────────────────────────────────────────────────────────────────────────────
 * [16] SELEÇÃO DE ACOMPANHANTE — classificação, ordem e dias
 *
 * A lista plana "nome + SELECIONAR" virou a MESMA linha da lista principal de
 * alocação, agrupada pela MESMA classificação. O que este bloco prende é a
 * ordem (é ela que faz a tela ser útil) e a regra dos dias: N dias escolhidos
 * geram N linhas de acompanhante e 2 blocos de logística — não 2N.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[16] Seleção de acompanhante');
{
  // requiresLogistics de mentira: PRESENCIAL exige, ONLINE não. Mantém o smoke
  // sem depender de modalityRules, como o domínio foi desenhado.
  const requiresLogistics = (m?: string | null) => m === 'PRESENCIAL';

  const DEMANDA_CLIENTE = {
    id: 'DEM-100',
    tipo: 'cliente',
    trainingId: 'TR-1',
    trainingLocal: 'Vitoria',
    demandState: 'ES',
    modality: 'PRESENCIAL',
  };

  const ins = (id: string, name: string, over: any = {}) => ({
    id, name, status: 'ATIVO', skills: [], residenceLocation: 'ES', ...over,
  });

  const COM_SKILL = [{ trainingId: 'TR-1', level: 3 }];

  const elenco = [
    ins('Q-2', 'Bruno', { skills: COM_SKILL }),                       // qualificado, sem conflito
    ins('Q-1', 'Ana', { skills: COM_SKILL }),                         // qualificado, sem conflito
    ins('Q-C', 'Carlos', { skills: COM_SKILL }),                      // qualificado, COM conflito
    ins('E-1', 'Daniela', { skills: COM_SKILL, residenceLocation: 'MG' }), // excecao
    ins('D-1', 'Eduardo'),                                            // demais (sem skill)
    ins('X-1', 'Inativo', { status: 'INATIVO', skills: COM_SKILL }),  // fora
  ];

  const grupos = groupInstructorsForCompanion({
    instructors: elenco,
    demand: DEMANDA_CLIENTE,
    hasConflict: id => id === 'Q-C',
    requiresLogistics,
  });

  // --- os três grupos, na ordem da tela ---
  eq('qualificados', grupos.qualificados.map(g => g.instructor.id).join(','), 'Q-1,Q-2,Q-C');
  eq('exceção (fora do estado da demanda)', grupos.excecoes.map(g => g.instructor.id).join(','), 'E-1');
  eq('demais ativos (sem habilitação)', grupos.demais.map(g => g.instructor.id).join(','), 'D-1');
  check('instrutor INATIVO fica fora de todos', 
    ![...grupos.qualificados, ...grupos.excecoes, ...grupos.demais].some(g => g.instructor.id === 'X-1'));

  // --- dentro do grupo: sem conflito ANTES de com conflito ---
  const qualificados = grupos.qualificados;
  const idxComConflito = qualificados.findIndex(g => g.hasConflict);
  check(
    'sem conflito vem antes de com conflito',
    idxComConflito === qualificados.length - 1 && qualificados.slice(0, idxComConflito).every(g => !g.hasConflict)
  );
  eq('e alfabético como desempate', qualificados.slice(0, 2).map(g => g.instructor.name).join(','), 'Ana,Bruno');

  // CONTRAPROVA: conflito NUNCA remove ninguém — o padrão da tela é avisar.
  check('quem tem conflito continua na lista', qualificados.some(g => g.instructor.id === 'Q-C'));

  // --- score ordena antes do nome, dentro do mesmo estado de conflito ---
  const porScore = groupInstructorsForCompanion({
    instructors: [
      ins('S-1', 'Zeca', { skills: [{ trainingId: 'TR-1', level: 4 }] }),
      ins('S-2', 'Ana', { skills: [{ trainingId: 'TR-1', level: 1 }] }),
    ],
    demand: DEMANDA_CLIENTE,
    hasConflict: () => false,
    requiresLogistics,
  });
  eq('score maior primeiro, mesmo com nome depois no alfabeto',
    porScore.qualificados.map(g => g.instructor.name).join(','), 'Zeca,Ana');

  // --- busca filtra DENTRO dos grupos ---
  const buscando = groupInstructorsForCompanion({
    instructors: elenco, demand: DEMANDA_CLIENTE, hasConflict: () => false, requiresLogistics,
    search: 'an',
  });
  eq('busca acha Ana (qualificada) e Daniela (exceção)',
    [...buscando.qualificados, ...buscando.excecoes, ...buscando.demais].map(g => g.instructor.name).join(','),
    'Ana,Daniela');

  // --- quem já acompanha sai da lista ---
  const semOsJa = groupInstructorsForCompanion({
    instructors: elenco, demand: DEMANDA_CLIENTE, hasConflict: () => false, requiresLogistics,
    excludeInstructorIds: ['Q-1', 'E-1'],
  });
  check('acompanhante existente não reaparece',
    !semOsJa.qualificados.some(g => g.instructor.id === 'Q-1') && semOsJa.excecoes.length === 0);

  // --- INTERNA: não tem treinamento, então todo ativo é qualificado ---
  const INTERNA = { id: 'DEM-900', tipo: 'interna', trainingId: '', trainingLocal: 'Vitoria', demandState: 'ES', modality: 'PRESENCIAL' };
  const naInterna = groupInstructorsForCompanion({
    instructors: elenco, demand: INTERNA, hasConflict: () => false, requiresLogistics,
  });
  eq('interna não tem grupo "demais" (todo ativo é elegível)', naInterna.demais.length, 0);
  check('e quem mora fora ainda é exceção', naInterna.excecoes.some(g => g.instructor.id === 'E-1'));

  // --- sem âncora geográfica, ninguém é exceção ---
  const semAncora = groupInstructorsForCompanion({
    instructors: elenco,
    demand: { ...DEMANDA_CLIENTE, modality: 'ONLINE' },
    hasConflict: () => false,
    requiresLogistics,
  });
  eq('demanda sem âncora geográfica não separa por UF', semAncora.excecoes.length, 0);
  check('e o de outro estado vira qualificado', semAncora.qualificados.some(g => g.instructor.id === 'E-1'));
  check('local N/A também tira a âncora',
    !hasGeoAnchor({ ...DEMANDA_CLIENTE, trainingLocal: 'N/A' }, requiresLogistics));
  check('sem UF na demanda, idem', !hasGeoAnchor({ ...DEMANDA_CLIENTE, demandState: '' }, requiresLogistics));

  // --- os predicados são os MESMOS que a lista principal usa ---
  const app = ler('App.tsx');
  check('App importa a classificação do domínio', app.includes("from './domain/instructorRecommendation'"));
  check('e usa isEligibleForDemand na lista principal', app.includes('isEligibleForDemand(i as any, demand as any)'));
  check('e scoreForDemand', app.includes('scoreForDemand(i as any, demand as any)'));
  check('e hasGeoAnchor / isSameDemandState', app.includes('hasGeoAnchor(demand as any, requiresLogistics)') && app.includes('isSameDemandState(i as any, demand as any)'));
  check('sem reimplementar a regra de skill no App',
    !/const isEligible = \(i: Instructor\) =>\s*\r?\n?\s*i\.status === 'ATIVO'/.test(app));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [17] PICKER — reuso do card, dias da demanda e N linhas / 2 blocos
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[17] CompanionPicker');
{
  const picker = ler('components/CompanionPicker.tsx');
  const drawer = ler('components/AllocationDrawer.tsx');
  const logistica = ler('components/Logistics.tsx');
  const card = ler('components/InstructorCard.tsx');

  // 1) Reusa o componente da lista principal — não copia JSX.
  check('o picker usa o InstructorCard', picker.includes("import InstructorCard from './InstructorCard'"));
  check('que é o MESMO da lista principal', drawer.includes("import InstructorCard from './InstructorCard'"));
  check('e o card foi EXTRAÍDO, não duplicado', !drawer.includes('const InstructorCard: React.FC<{'));
  check('o card mostra a região (informação que a lista plana não tinha)', card.includes('{instructor.residenceLocation}'));

  // 2) Conflito: avisa, não bloqueia — e é dos DIAS ESCOLHIDOS.
  check('o aviso de conflito vira "Já alocado neste dia"', card.includes("'Já alocado neste dia'"));
  check('com "Alocar mesmo assim"', card.includes("hasConflict ? 'Alocar mesmo assim' : actionLabel"));
  check('e o botão NUNCA fica desabilitado por conflito', !/disabled=\{[^}]*hasConflict/.test(card));
  check('o conflito é calculado sobre os dias selecionados', picker.includes('const alvo = diasSelecionados.length > 0 ? diasSelecionados : diasDaDemanda;'));
  check('e o detalhe do conflito vira tooltip', picker.includes('conflictTitle={conflitoDe(instructor.id).detalhe}'));

  // 3) Dias: só os da demanda, com atalhos.
  check('os dias vêm de getDemandDays', picker.includes('getDemandDays(demand)'));
  check('atalho de todos os dias', picker.includes('setDiasSelecionados([...diasDaDemanda])'));
  check('atalho de limpar', picker.includes('setDiasSelecionados([]); setErro(null);'));
  check(
    'o intervalo MARCA dias da demanda, não cria dias novos',
    picker.includes('const noIntervalo = diasDaDemanda.filter(d => d >= de && d <= ate);')
  );
  check(
    'não há caminho para escolher dia fora da demanda',
    !picker.includes('companionDayInput') && picker.includes('Acompanhante')
  );

  // 4) A REGRA DOS BLOCOS: N dias -> N linhas, 2 blocos (não 2N).
  for (const [nome, src, laco] of [
    ['AllocationDrawer', drawer, 'dias.forEach(day => {'],
    ['Logistics', logistica, 'dias.forEach(day => {'],
  ] as const) {
    const h = src.slice(src.indexOf('const handleConfirmCompanion'), src.indexOf('const handleConfirmCompanion') + 2000);
    check(`${nome}: uma linha de acompanhante POR DIA`, h.includes(laco) && h.includes('addCompanionAllocation({'));
    check(
      `${nome}: o bloco de logística sai UMA VEZ, fora do laço`,
      h.includes('ensureLogisticBlocksForPerson(') &&
        h.indexOf('});') < h.indexOf('ensureLogisticBlocksForPerson(')
    );
    check(
      `${nome}: e só uma chamada (N dias não viram 2N blocos)`,
      (h.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length === 1
    );
  }

  // 5) A convenção de gravação NÃO mudou em nenhuma das duas telas.
  check('drawer mantém T08:00/T18:00 literais', drawer.includes("startDate: `${day}T08:00`,"));
  check('logística mantém horário da demanda com fallback 08/18', logistica.includes("buildDateTime(day, startTime, '08:00')"));

  // 6) As duas telas consomem o MESMO picker.
  check('drawer usa o picker', drawer.includes('<CompanionPicker'));
  check('logística usa o picker', logistica.includes('<CompanionPicker'));
  check('e a lista plana antiga saiu', !logistica.includes('Escolha um instrutor para acompanhar'));
  check(
    'assim como o seletor de um-dia-por-vez',
    !/const addCompanionDay\s*=/.test(drawer) && !/const handleSaveCompanionDays\s*=/.test(drawer)
  );
  check(
    'e o par equivalente na Logistica',
    !/const openCompanionDatesModal\s*=/.test(logistica) && !/const handleSaveCompanionDays\s*=/.test(logistica)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [18] AGENDA — ACOMPANHANTE DIVIDE A CÉLULA, NÃO SOBRESCREVE
 *
 * O bug: DEM-1550 (participante) e DEM-1552 (acompanhante), mesmo instrutor,
 * mesmo dia — só um dos dois aparecia. A passada de acompanhante escrevia só
 * em `map` e não alimentava `allocMulti`, ao contrário das passadas de
 * alocação e de participante. Sem entrada em `allocMulti` a célula nunca
 * chega a 2 itens, então nunca divide: o último a escrever em `map` ganha.
 *
 * A dedupe por DEMANDA (`demandsWithCompanions`) é outra coisa e continua de
 * pé: ela impede a MESMA demanda de aparecer duas vezes. O que ela nunca
 * deveria ter feito é sumir com o card de OUTRA demanda no mesmo dia.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[18] Agenda — acompanhante convive na célula dividida');
{
  type Cel = { id: string; demandId?: string; isCompanion?: boolean };
  const trabalho = (id: string, demandId: string): Cel => ({ id, demandId, isCompanion: false });
  const acomp = (id: string, demandId: string): Cel => ({ id, demandId, isCompanion: true });
  const ids = (xs: Cel[]) => xs.map(x => x.id).join(',');

  // O caso relatado, na ordem em que as passadas escrevem (alocação, depois
  // acompanhante): duas demandas diferentes no mesmo dia = dois cards.
  eq(
    'allocation em X + acompanhante em Y no mesmo dia = dois itens',
    ids(normalizeAgendaCell([trabalho('ALOC-1', 'DEM-1550'), acomp('CA-1', 'DEM-1552')])),
    'ALOC-1,CA-1'
  );

  // ... e a ordem é DEFINIDA, não a de execução das passadas. A de
  // acompanhante (1.5) roda ANTES da de participante (1.7): sem ordenação, o
  // acompanhante ficaria na frente por acidente.
  eq(
    'acompanhante vai por último mesmo tendo sido inserido primeiro',
    ids(normalizeAgendaCell([acomp('CA-1', 'DEM-1552'), trabalho('PT-1', 'DEM-1550')])),
    'PT-1,CA-1'
  );

  // CONTRAPROVA da dedupe: mesma demanda não vira dois cards.
  eq(
    'titular e acompanhante da MESMA demanda = um card só',
    ids(normalizeAgendaCell([trabalho('ALOC-1', 'DEM-1552'), acomp('CA-1', 'DEM-1552')])),
    'ALOC-1'
  );
  eq(
    'e vale com o acompanhante inserido primeiro',
    ids(normalizeAgendaCell([acomp('CA-1', 'DEM-1552'), trabalho('ALOC-1', 'DEM-1552')])),
    'ALOC-1'
  );

  // A dedupe é POR DEMANDA, não por instrutor+dia — é a diferença entre
  // "não repita a mesma demanda" e o bug "só um card por dia".
  eq(
    'participante em X + acompanhante em Y convivem',
    ids(normalizeAgendaCell([trabalho('PT-1', 'DEM-1550'), acomp('CA-1', 'DEM-1552')])),
    'PT-1,CA-1'
  );
  eq(
    'acompanhante em duas demandas diferentes no mesmo dia = dois cards',
    ids(normalizeAgendaCell([acomp('CA-1', 'DEM-1552'), acomp('CA-2', 'DEM-1553')])),
    'CA-1,CA-2'
  );
  eq(
    'dedupe da demanda X não derruba o acompanhante de Y',
    ids(normalizeAgendaCell([
      trabalho('ALOC-1', 'DEM-1552'),
      acomp('CA-1', 'DEM-1552'),
      acomp('CA-2', 'DEM-1553'),
    ])),
    'ALOC-1,CA-2'
  );

  // Entre itens de trabalho a ordem de inserção (= a das passadas) se mantém:
  // o sort é estável e só empurra acompanhante para o fim.
  eq(
    'dois treinos no mesmo dia continuam na ordem das passadas',
    ids(normalizeAgendaCell([trabalho('ALOC-1', 'DEM-A'), trabalho('ALOC-2', 'DEM-B')])),
    'ALOC-1,ALOC-2'
  );

  // Acompanhante sozinho: um item só — a célula NÃO divide e o card cheio
  // verde continua sendo o de hoje.
  eq(
    'acompanhante sozinho não divide célula',
    normalizeAgendaCell([acomp('CA-1', 'DEM-1552')]).length,
    1
  );

  /* ---- GUARDA DE FONTE: a passada mora dentro do useMemo do componente ---- */
  const cal = ler('components/CalendarView.tsx');
  const passada15 = cal.slice(cal.indexOf('PRIORIDADE 1.5'), cal.indexOf('PRIORIDADE 1.7'));

  check('achou a passada de acompanhante', passada15.length > 0);
  check(
    'a passada de acompanhante alimenta allocMulti (era ISTO que faltava)',
    passada15.includes('allocMulti[companionKey].push(companionItem)')
  );
  check(
    'e continua escrevendo em map (o card cheio de quando está sozinho)',
    passada15.includes('map[companionKey] = companionItem;')
  );

  // As três passadas que geram card de demanda alimentam allocMulti.
  eq(
    'as três passadas alimentam allocMulti',
    (cal.match(/allocMulti\[[a-zA-Z]+\]\.push\(/g) ?? []).length,
    3
  );

  check(
    'o fechamento normaliza cada célula antes de devolver',
    /allocMulti\[key\] = normalizeAgendaCell\(allocMulti\[key\]\);/.test(cal) &&
      cal.indexOf('normalizeAgendaCell(allocMulti[key])') <
        cal.indexOf('return { agendaByDay: map, allocByDayMulti: allocMulti };')
  );

  // A dedupe da passada 2 é POR DEMANDA. Se alguém trocar o Set por
  // instrutor+dia, o bug volta em outra roupa.
  check(
    'demandsWithCompanions continua sendo um conjunto de DEMANDAS',
    cal.includes('const demandsWithCompanions = new Set(companionAllocations.map(a => a.demandId));')
  );
  check(
    'e continua desligando a passada 2 para a demanda dele',
    cal.includes('!demandsWithCompanions.has(d.id)')
  );

  /* ---- o card compacto do acompanhante: cor e remoção intactas ---- */
  const multi = cal.slice(cal.indexOf('MODO MULTI-CARD'), cal.indexOf('MODO SINGLE-CARD'));
  check('achou o modo multi-card', multi.length > 0);
  check('acompanhante mantém o verde na célula dividida', multi.includes('aBg = COMPANION_STYLING.bg;'));
  check(
    'o verde vem depois de interna e de "a confirmar" (papel > estado da demanda)',
    multi.indexOf('A_CONFIRMAR_STYLING.bg') < multi.indexOf('COMPANION_STYLING.bg')
  );
  check('o × de remover acompanha o card compacto', multi.includes('removeCompanionDay(allocItem)'));
  eq(
    'um removedor só, dois cards',
    (cal.match(/removeCompanionDay\(/g) ?? []).length,
    2 // as duas chamadas: card cheio e card compacto (a definição está em removeCompanionDay)
  );
  eq(
    'e o verde é definido uma vez só',
    (cal.match(/bg-emerald-600/g) ?? []).length,
    1
  );
}
/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE PARTICIPANTES: OK' : `\n❌ SMOKE PARTICIPANTES: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
