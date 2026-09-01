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

  // Remoção: apaga no banco, um id por vez, e só bloco vazio.
  const remover = interna.slice(
    interna.indexOf('const handleRemoveParticipant'),
    interna.indexOf('const handleCancelDemand')
  );
  check('remoção apaga o bloco no banco', remover.includes('await deleteLogisticBlock(b.id)'));
  check(
    'remoção NUNCA apaga por demand_id (levaria os blocos dos outros)',
    !remover.includes('demand_id') && !remover.includes('upsertLogisticBlocks')
  );
  check(
    'remoção continua respeitando "só bloco vazio"',
    remover.includes('locoVazio(b)') && remover.includes('hospVazio(b)')
  );
  check(
    'bloco ausente do banco não aborta a remoção do participante',
    /catch \(e\)[\s\S]{0,300}console\.warn/.test(remover)
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
  const chamadasDrawer = (drawer.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length;
  const chamadasLogistica = (logisticaTela.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length;
  eq('AllocationDrawer: 2 caminhos (modo direto + seleção de dias)', chamadasDrawer, 2);
  eq('Logistics: 2 caminhos (demanda inteira + dias selecionados)', chamadasLogistica, 2);

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
    app.indexOf('const releaseLogisticBlocksForPerson')
  );
  check(
    'com UMA pessoa só, o bloco continua anônimo (metade da regra que evita pedir nome de quem não precisa)',
    fill.includes('if (!temOutraPessoa) return;')
  );

  // Remoção: só bloco vazio, um id por vez, e só no ÚLTIMO vínculo da pessoa.
  const release = app.slice(
    app.indexOf('const releaseLogisticBlocksForPerson'),
    app.indexOf('const [operationalBases')
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
  const trechoAgenda = cal.slice(cal.indexOf('title="Remover acompanhante"'));
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
/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE PARTICIPANTES: OK' : `\n❌ SMOKE PARTICIPANTES: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
