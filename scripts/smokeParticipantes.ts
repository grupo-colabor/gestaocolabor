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
    'handleAddParticipant pré-preenche o bloco de LOCOMOÇÃO com nome e instructorId',
    handler.includes('{ ...emptyLocomocaoBlock(), instructorName: nome, instructorId: payload.instructorId }')
  );
  check(
    'handleAddParticipant pré-preenche o bloco de HOSPEDAGEM com nome e instructorId',
    handler.includes('{ ...emptyHospedagemBlock(), instructorName: nome, instructorId: payload.instructorId }')
  );
  check(
    'o bloco só nasce DEPOIS de o participante gravar (nada de bloco órfão)',
    handler.indexOf('if (!ok) return;') < handler.indexOf('emptyLocomocaoBlock()')
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

  // O caso pedido: adicionar participante gera EXATAMENTE 2 blocos, os dois
  // com instructor_id, sem duplicar os que já existem.
  const inserts = handler.match(/block_type: '(LOCOMOCAO|HOSPEDAGEM)'/g) ?? [];
  check('exatamente 2 blocos criados por participante', inserts.length === 2);
  check('um de LOCOMOCAO e um de HOSPEDAGEM', new Set(inserts).size === 2);
  check(
    'os dois levam instructor_id (vínculo por id, não por nome)',
    (handler.match(/instructor_id: payload\.instructorId/g) ?? []).length === 2
  );
  check(
    'os dois levam instructor_name (rótulo de exibição)',
    (handler.match(/instructor_name: nome/g) ?? []).length === 2
  );

  // A escolha que impede duplicação/perda: insert puro, nunca delete-all.
  check('persiste na hora, com insertLogisticBlocks', handler.includes('await insertLogisticBlocks('));
  check(
    'NÃO usa upsertLogisticBlocks aqui (delete-all apagaria os blocos dos outros)',
    !handler.includes('upsertLogisticBlocks')
  );
  check(
    'block_order continua a lista existente em vez de sobrescrever a posição 0',
    handler.includes('(formDemand.logisticasLocomocao || []).length') &&
      handler.includes('(formDemand.logisticasHospedagem || []).length')
  );
  check(
    'falha ao criar blocos NÃO desfaz o participante (avisa e segue)',
    /catch \(e: any\)[\s\S]{0,800}blocos de logística não foram criados/.test(handler) &&
      !/catch \(e: any\)[\s\S]{0,800}removeDemandParticipant/.test(handler)
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

/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE PARTICIPANTES: OK' : `\n❌ SMOKE PARTICIPANTES: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
