/**
 * SMOKE — Medição v2: blocos por pessoa e override de horas
 *
 * Rodar com:  npm run smoke:medicao-blocos
 *
 * A F2 faz o participante de demanda interna gerar pagamento. O risco todo está
 * em duas propriedades, e este arquivo existe para prendê-las:
 *
 *   [A] SOMA DOS BLOCOS = TOTAL DA MEDIÇÃO. Os blocos são uma PARTIÇÃO dos
 *       mesmos `attachments`, indexada por um campo opcional cujo ausente cai
 *       no titular. Se algum item escapar da partição, o painel passa a mostrar
 *       um total que não fecha com a soma das seções — e ninguém confere isso a
 *       olho numa medição com 3 pessoas.
 *
 *   [B] `horas` AUSENTE ≠ ZERO. O default (`horas_previstas`) é de UI: aparece
 *       como placeholder e só vira valor gravado quando alguém digita. Gravar
 *       com avidez faria toda interna com bloco trocar rateio por
 *       horas-por-pessoa no dia do deploy — uma interna de 16h dividida entre 2
 *       instrutores saltaria para 32h. E um `?? 0` no lugar do fallback zera
 *       pagamento em silêncio. O bloco [5] exige que as duas versões erradas
 *       falhem.
 *
 * Padrão da casa: as implementações ANTIGA/ERRADA estão reproduzidas aqui e o
 * smoke exige que elas divirjam — sem isso o teste ficaria verde sobre qualquer
 * coisa (ver smokeLocalOnline.ts e smokeDatasDemanda.ts).
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import {
  normalizeMeasurementBlocks,
  blockHoraAula,
  blockExpenseBreakdown,
  computeMeasurementTotals,
  computePanelExpenseBreakdown,
  type TotalizableMeasurement,
} from '../domain/measurementTotals';
import {
  applyMeasurementOverrides,
  companionDefaultHours,
  companionDaysFromRows,
  type HoursRowLike,
} from '../domain/measurementOverrides';
import fs from 'fs';
import path from 'path';

const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

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

const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────── */
const TITULAR = 'INS-T';
const P2 = 'INS-2';
const P3 = 'INS-3';

/** Medição v1 — como TODA medição gravada até hoje. */
const V1: TotalizableMeasurement = {
  expenses: { classHours: 16, hourRate: 100 },
  otherExpenses: [{ id: 'O1' }],
  attachments: [
    { category: 'HOSPEDAGEM', value: 300 },
    { category: 'LOCOMOCAO', value: 120 },
    { category: 'ALMOCO', value: 45 },
    { category: 'OUTROS', value: 30, otherId: 'O1' },
  ],
};

/** Medição v2 — três pessoas, itens com dono. */
const V2: TotalizableMeasurement = {
  expenses: {
    classHours: 16,
    hourRate: 100,
    participantes: [
      { instructorId: TITULAR, papel: 'TITULAR', horas: 16, valorHH: 100 },
      { instructorId: P2, papel: 'PARTICIPANTE', horas: 8, valorHH: 90 },
      // sem `horas`: é o caso que o fallback resolve
      { instructorId: P3, papel: 'PARTICIPANTE', valorHH: 80 },
    ],
  },
  otherExpenses: [{ id: 'O1' }],
  attachments: [
    { category: 'HOSPEDAGEM', value: 300 },                       // sem dono -> titular
    { category: 'LOCOMOCAO', value: 120, instructorId: TITULAR },
    { category: 'ALMOCO', value: 45, instructorId: P2 },
    { category: 'HOSPEDAGEM', value: 280, instructorId: P2 },
    { category: 'OUTROS', value: 30, otherId: 'O1', instructorId: P3 },
  ],
};

/* ────────────────────────────────────────────────────────────────────────────
 * [1] SOMA DOS BLOCOS = TOTAL DA MEDIÇÃO
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Partição: a soma dos blocos fecha com o total');
{
  const blocos = normalizeMeasurementBlocks(V2, TITULAR);
  eq('três blocos', blocos.length, 3);

  const totalMedicao = computePanelExpenseBreakdown(V2).total;
  const somaBlocos = soma(blocos.map(b => blockExpenseBreakdown(V2, b).total));
  eq('Σ despesas dos blocos = total da medição', somaBlocos, totalMedicao);
  eq('e o número é o esperado', totalMedicao, 300 + 120 + 45 + 280 + 30);

  // Nenhum item pode aparecer em dois blocos nem sumir.
  eq(
    'os itens são particionados, sem repetir nem perder',
    soma(blocos.map(b => b.attachments.length)),
    (V2.attachments ?? []).length
  );

  const horaAulaMedicao = soma(blocos.map(blockHoraAula));
  eq('Σ hora/aula dos blocos', horaAulaMedicao, 16 * 100 + 8 * 90);
  check('o bloco sem horas não inventa valor', blockHoraAula(blocos[2]) === 0);

  // --- item com dono DESCONHECIDO (participante removido depois do lançamento)
  const comOrfaoDeDono: TotalizableMeasurement = {
    ...V2,
    attachments: [...(V2.attachments ?? []), { category: 'JANTAR', value: 60, instructorId: 'INS-QUE-SAIU' }],
  };
  const blocosOrfao = normalizeMeasurementBlocks(comOrfaoDeDono, TITULAR);
  eq(
    'item de dono desconhecido cai no titular, não evapora',
    soma(blocosOrfao.map(b => blockExpenseBreakdown(comOrfaoDeDono, b).total)),
    computePanelExpenseBreakdown(comOrfaoDeDono).total
  );
  check(
    'e é o bloco titular que o recebe',
    blocosOrfao[0].attachments.some(a => a.instructorId === 'INS-QUE-SAIU')
  );

  // --- órfão de OUTROS (aponta para linha de other_expenses apagada) ---
  // Fica fora do total, como já ficava — mas a exclusão tem de valer igual nos
  // dois lados, senão a soma dos blocos deixa de bater.
  const comOrfaoDeOutros: TotalizableMeasurement = {
    ...V2,
    attachments: [...(V2.attachments ?? []), { category: 'OUTROS', value: 999, otherId: 'APAGADO', instructorId: P2 }],
  };
  const blocosOO = normalizeMeasurementBlocks(comOrfaoDeOutros, TITULAR);
  eq(
    'órfão de OUTROS fica fora dos dois lados',
    soma(blocosOO.map(b => blockExpenseBreakdown(comOrfaoDeOutros, b).total)),
    computePanelExpenseBreakdown(comOrfaoDeOutros).total
  );
  check('e continua contado como órfão', computePanelExpenseBreakdown(comOrfaoDeOutros).itensOrfaos === 1);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [2] COMPATIBILIDADE v1 — regressão ancorada
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[2] Medição v1 lê idêntico ao comportamento de hoje');
{
  const blocos = normalizeMeasurementBlocks(V1, TITULAR);
  eq('exatamente 1 bloco', blocos.length, 1);
  eq('papel TITULAR', blocos[0].papel, 'TITULAR');
  check('e ele é o titular', blocos[0].titular);
  eq('com TODOS os attachments', blocos[0].attachments.length, (V1.attachments ?? []).length);

  // A implementação ANTIGA da parcela de hora/aula, reproduzida.
  const horaAulaV1Antiga = Number(V1.expenses?.classHours) * Number(V1.expenses?.hourRate);
  eq('hora/aula do bloco = classHours × hourRate', blockHoraAula(blocos[0]), horaAulaV1Antiga);
  eq('e bate com computeMeasurementTotals', computeMeasurementTotals(V1).horaAula, horaAulaV1Antiga);

  // computeMeasurementTotals NÃO pode ter mudado de resultado.
  const t = computeMeasurementTotals(V1);
  eq('hospedagem', t.hospedagem, 300);
  eq('locomoção', t.locomocao, 120);
  eq('almoço', t.almoco, 45);
  eq('outros', t.outros, 30);
  eq('total de despesas', t.total, 495);
  eq('total com hora/aula', t.totalComHoraAula, 495 + 1600);

  // ...nem sobre uma medição v2: ela continua devolvendo o total da DEMANDA,
  // ignorando um campo que não conhece.
  const t2 = computeMeasurementTotals(V2);
  eq('v2: computeMeasurementTotals segue somando a demanda inteira', t2.total, 775);

  // Medição vazia / sem expenses não pode explodir.
  eq('medição vazia -> 1 bloco', normalizeMeasurementBlocks({}, TITULAR).length, 1);
  eq('medição nula -> 1 bloco', normalizeMeasurementBlocks(null).length, 1);
  check('sem classHours, horas fica NÃO INFORMADA', !normalizeMeasurementBlocks({}, TITULAR)[0].horasInformadas);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [3] EXPORT — override, nunca soma
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[3] Override de horas no export');

const INTERNA = {
  id: 'DEM-900',
  tipo: 'interna',
  horasPrevistas: 16,
  instructorId: TITULAR,
  dateMode: 'CONTINUO',
  startDate: '2026-03-10T08:00',
  endDate: '2026-03-11T18:00',
};

const rateioDoTitular = (horas = 16): HoursRowLike[] => [
  { instructorId: TITULAR, demandId: 'DEM-900', horas, dias: ['2026-03-10', '2026-03-11'], dividida: false },
];

{
  // Titular com rateio + participante com bloco -> DUAS linhas, e a soma é a
  // carga da demanda, não o dobro.
  const medicao = {
    demandId: 'DEM-900',
    expenses: {
      participantes: [
        { instructorId: TITULAR, papel: 'TITULAR' as const, horas: 8, valorHH: 100 },
        { instructorId: P2, papel: 'PARTICIPANTE' as const, horas: 8, valorHH: 90 },
      ],
    },
  };

  const out = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [medicao],
    demands: [INTERNA],
    participants: [{ demandId: 'DEM-900', instructorId: P2 }],
  });

  eq('duas linhas no export', out.length, 2);
  eq('soma = carga da demanda, não o dobro', soma(out.map(r => r.horas)), 16);
  eq('titular teve as horas SUBSTITUÍDAS pelo bloco', out.find(r => r.instructorId === TITULAR)?.horas, 8);
  eq('participante entrou com as horas do bloco', out.find(r => r.instructorId === P2)?.horas, 8);
  eq(
    'os dias do titular continuam vindo do rateio',
    out.find(r => r.instructorId === TITULAR)?.dias.join(','),
    '2026-03-10,2026-03-11'
  );

  // A implementação ERRADA (somar em vez de substituir), reproduzida.
  const somaErrada = 16 + 8 + 8;
  check('(errado) somar rateio + blocos daria 32h', somaErrada !== soma(out.map(r => r.horas)));
}

{
  // Bloco SEM horas não pode mexer no rateio do titular.
  const medicao = {
    demandId: 'DEM-900',
    expenses: {
      participantes: [
        { instructorId: TITULAR, papel: 'TITULAR' as const, valorHH: 100 },
        { instructorId: P2, papel: 'PARTICIPANTE' as const, valorHH: 90 },
      ],
    },
  };

  const out = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [medicao],
    demands: [INTERNA],
    participants: [{ demandId: 'DEM-900', instructorId: P2 }],
  });

  eq('titular mantém as 16h do rateio', out.find(r => r.instructorId === TITULAR)?.horas, 16);
  eq('participante cai no default de horas_previstas', out.find(r => r.instructorId === P2)?.horas, 16);
}

{
  // Sem `participantes`, o rateio passa intocado — é a garantia de que toda
  // demanda de cliente (que nunca terá bloco) sai exatamente como hoje.
  const out = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [{ demandId: 'DEM-900', expenses: { classHours: 16, hourRate: 100 } }],
    demands: [INTERNA],
  });
  eq('medição v1 não altera o rateio', out.length, 1);
  eq('e as horas continuam as mesmas', out[0].horas, 16);

  eq('sem medição nenhuma, idem', applyMeasurementOverrides({ rows: rateioDoTitular(), measurements: [], demands: [INTERNA] })[0].horas, 16);
}

{
  // Participante com período próprio: os dias da linha nova são o recorte.
  const medicao = {
    demandId: 'DEM-900',
    expenses: {
      participantes: [
        { instructorId: TITULAR, papel: 'TITULAR' as const, valorHH: 100 },
        { instructorId: P2, papel: 'PARTICIPANTE' as const, horas: 4, valorHH: 90 },
      ],
    },
  };
  const out = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [medicao],
    demands: [INTERNA],
    participants: [{ demandId: 'DEM-900', instructorId: P2, startDate: '2026-03-11', endDate: '2026-03-11' }],
  });
  eq('dias do participante saem do período próprio', out.find(r => r.instructorId === P2)?.dias.join(','), '2026-03-11');

  // ...e o recorte do período do export continua valendo.
  const fora = applyMeasurementOverrides({
    rows: [],
    measurements: [medicao],
    demands: [INTERNA],
    participants: [{ demandId: 'DEM-900', instructorId: P2, startDate: '2026-03-11', endDate: '2026-03-11' }],
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
  });
  eq('participante fora da janela do export não gera linha', fora.length, 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [4] O RATEIO CONTINUA SENDO A FONTE — nada de trocar a origem
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[4] O rateio segue intacto para quem não tem bloco');
{
  const CLIENTE = { ...INTERNA, id: 'DEM-100', tipo: 'cliente', horasPrevistas: null };
  const rows: HoursRowLike[] = [
    { instructorId: TITULAR, demandId: 'DEM-100', horas: 12, dias: ['2026-03-10'], dividida: false },
    { instructorId: P2, demandId: 'DEM-100', horas: 4, dias: ['2026-03-11'], dividida: true },
  ];
  const out = applyMeasurementOverrides({ rows, measurements: [], demands: [CLIENTE] });
  eq('demanda de cliente sai idêntica', out.map(r => `${r.instructorId}:${r.horas}`).join('|'), `${TITULAR}:12|${P2}:4`);
  check('e a lista devolvida é nova (não muta a entrada)', out !== rows && out[0] !== rows[0]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [5] `horas` AUSENTE ≠ ZERO — as duas versões erradas têm de falhar
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[5] Ausente não é zero');
{
  const semHoras = { instructorId: P2, papel: 'PARTICIPANTE' as const, valorHH: 90 };
  const medicao = {
    demandId: 'DEM-900',
    expenses: { participantes: [{ instructorId: TITULAR, papel: 'TITULAR' as const, valorHH: 100 }, semHoras] },
  };

  const out = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [medicao],
    demands: [INTERNA],
    participants: [{ demandId: 'DEM-900', instructorId: P2 }],
  });

  const doParticipante = out.find(r => r.instructorId === P2)?.horas;
  const doTitular = out.find(r => r.instructorId === TITULAR)?.horas;

  // (a) ERRADO: `?? 0` no participante -> pagamento zerado em silêncio.
  const comCoalesceZero = Number((semHoras as any).horas ?? 0);
  eq('(errado) ?? 0 daria zero', comCoalesceZero, 0);
  check('o correto é horas_previstas, não zero', doParticipante === 16 && doParticipante !== comCoalesceZero);

  eq('com o campo ausente, o titular mantém o rateio', doTitular, 16);

  // (b) ERRADO: gravar o default com avidez. O estrago NÃO aparece numa demanda
  //     com participante — lá 32h é o número certo, porque são duas pessoas que
  //     trabalharam 16h cada. Ele aparece na demanda DIVIDIDA entre dois
  //     instrutores por dias, onde o rateio dá 8h + 8h = as 16h da carga. Se o
  //     default `horas_previstas` = 16 fosse gravado nos dois blocos, cada um
  //     viraria 16h e a demanda pagaria 32h — o dobro do que ela vale. É o
  //     cenário "16h vira 32h" da análise, e é por isso que o campo tem de
  //     chegar ausente no JSON.
  const rateioDividido: HoursRowLike[] = [
    { instructorId: TITULAR, demandId: 'DEM-900', horas: 8, dias: ['2026-03-10'], dividida: true },
    { instructorId: P2, demandId: 'DEM-900', horas: 8, dias: ['2026-03-11'], dividida: true },
  ];

  const blocosSemHoras = {
    demandId: 'DEM-900',
    expenses: {
      participantes: [
        { instructorId: TITULAR, papel: 'TITULAR' as const, valorHH: 100 },
        { instructorId: P2, papel: 'PARTICIPANTE' as const, valorHH: 90 },
      ],
    },
  };
  const blocosComDefaultGravado = {
    demandId: 'DEM-900',
    expenses: {
      participantes: [
        { instructorId: TITULAR, papel: 'TITULAR' as const, horas: 16, valorHH: 100 },
        { instructorId: P2, papel: 'PARTICIPANTE' as const, horas: 16, valorHH: 90 },
      ],
    },
  };

  const dividida = (medicao: any) =>
    soma(
      applyMeasurementOverrides({
        rows: rateioDividido,
        measurements: [medicao],
        demands: [INTERNA],
      }).map(r => r.horas)
    );

  eq('ausente: a demanda dividida continua valendo 16h', dividida(blocosSemHoras), 16);
  eq('(errado) com o default gravado ela passaria a valer 32h', dividida(blocosComDefaultGravado), 32);
  check('ou seja: gravar o default DOBRA o pagamento', dividida(blocosSemHoras) !== dividida(blocosComDefaultGravado));

  // `0` DIGITADO é diferente de ausente: é uma decisão do usuário e vale.
  const comZeroDigitado = applyMeasurementOverrides({
    rows: rateioDoTitular(),
    measurements: [{
      demandId: 'DEM-900',
      expenses: { participantes: [{ instructorId: TITULAR, papel: 'TITULAR' as const, horas: 0, valorHH: 100 }] },
    }],
    demands: [INTERNA],
  });
  eq('zero digitado zera as horas do titular (é escolha, não ausência)', comZeroDigitado[0].horas, 0);

  // String vazia (input limpo na tela) conta como AUSENTE, não como zero.
  const blocoVazio = normalizeMeasurementBlocks(
    { expenses: { participantes: [{ instructorId: P2, horas: '', valorHH: 90 }] } },
    TITULAR
  )[0];
  check('input limpo ("") é ausente, não zero', !blocoVazio.horasInformadas);
  const blocoZero = normalizeMeasurementBlocks(
    { expenses: { participantes: [{ instructorId: P2, horas: 0, valorHH: 90 }] } },
    TITULAR
  )[0];
  check('zero digitado é informado', blocoZero.horasInformadas && blocoZero.horas === 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [6] PAINEL — o que é novo fica ATRÁS DO GATE (item 7 do escopo)
 *
 * Medição de CLIENTE e de interna SEM participante têm de sair visual e
 * funcionalmente idênticas ao que eram. Tudo o que a F2 acrescenta na tela
 * está atrás de `temBlocosPorPessoa`, e é isso que este bloco prende — se
 * alguém remover o gate, a interna de uma pessoa passa a mostrar seção de
 * pessoa e o JSON de cliente ganha uma chave que nunca teve.
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[6] Painel: o novo fica atrás do gate');
{
  const painel = ler('components/Measurement.tsx');

  // O gate: só existe bloco por pessoa quando há MAIS DE UMA pessoa.
  check(
    'o gate é a contagem de pessoas, não o tipo da demanda',
    painel.includes('const temBlocosPorPessoa = pessoasDaMedicao.length > 1;')
  );
  // A F3 abriu o painel para CLIENTE COM ACOMPANHANTE. O corte deixou de ser
  // "cliente nunca" e passou a ser "sem uma SEGUNDA CATEGORIA de pessoa" —
  // interna sem participante e cliente sem acompanhante continuam do lado de
  // fora, e é isso que mantém a medição de cliente de hoje intacta.
  check(
    'interna sem participante sai vazia',
    /const participantes = demandParticipants\.filter[\s\S]{0,120}if \(participantes\.length === 0\) return \[\];/.test(painel)
  );
  check(
    'cliente sem acompanhante sai vazia',
    /if \(acompanhantes\.length === 0\) return \[\];/.test(painel)
  );
  // O caso que NÃO pode mudar: cliente dividido entre dois titulares e sem
  // acompanhante nenhum. Ele tem 2 pessoas e passaria no `length > 1` — o que o
  // segura é a lista sair vazia antes disso.
  check(
    'e o corte vem ANTES de montar a lista de titulares do cliente',
    painel.indexOf('if (acompanhantes.length === 0) return [];') <
      painel.indexOf("for (const id of titulares) lista.push({ instructorId: id, papel: 'TITULAR' });")
  );

  // As seções por pessoa e o bloco de uma pessoa são MUTUAMENTE exclusivos —
  // dois lugares editando a mesma coisa seria pior que nenhum.
  check('as seções por pessoa só renderizam com o gate', painel.includes('{temBlocosPorPessoa && secoesPorPessoa.map(secao => ('));
  check('e o painel de uma pessoa some quando elas aparecem', painel.includes('{!temBlocosPorPessoa && ('));

  // A partição vem do domínio, não de um filtro reescrito na tela.
  check(
    'as seções usam a partição do domínio',
    painel.includes('normalizeMeasurementBlocks(paraNormalizar as any, titularId)') &&
      painel.includes('blockExpenseBreakdown(paraNormalizar as any, b)')
  );
  check(
    'o CategoryBlock recebe a lista JÁ particionada (não refiltra por dono)',
    painel.includes('attachments={secao.attachments as Attachment[]} ownerId={secao.instructorId}') &&
      !/relevantAttachments[\s\S]{0,200}instructorId/.test(painel)
  );

  // A lista de pessoas vem da DEMANDA, não do JSON — senão participante
  // adicionado depois do primeiro save nunca apareceria.
  check(
    'titular vem de demands.instructor_id com fallback de allocations',
    /resolveDemandInstructors\(\s*_selDemand\.id,\s*_selDemand\.instructorId,\s*instructorAllocations\s*\)/.test(painel)
  );
  check(
    'e os acompanhantes, de companionAllocations (uma linha POR DIA, deduplicada)',
    painel.includes('for (const ca of companionAllocations || []) {') &&
      painel.includes('if (vistos.has(ca.instructorId)) continue;')
  );
  check('e os participantes, de demandParticipants', painel.includes('demandParticipants.filter(p => p.demandId === _selDemand.id)'));

  // O default de horas é PLACEHOLDER, nunca valor.
  check(
    'o campo de horas usa placeholder para o default',
    painel.includes('placeholder={String(secao.horasPadrao)}')
  );
  check(
    'e o default é POR PESSOA (acompanhante tem carga proporcional)',
    painel.includes('horasPadrao: horasPadraoDaPessoa(b.instructorId, papel)') &&
      painel.includes('companionDefaultHours(cargaDaDemanda, diasDaDemanda.length, dias.length)') &&
      // A base é a mesma precedência do rateio: classHours informado manda.
      painel.includes('const cargaDaDemanda = classHours || trainingDefaultHours;')
  );
  check(
    'campo limpo volta a NÃO INFORMADO, não a zero',
    painel.includes("setCampoDoBloco(secao.instructorId, 'horas', raw === '' ? undefined : Number(raw))")
  );
  check(
    'e o setter APAGA a chave em vez de gravar 0',
    /if \(valor === undefined\) delete novo\[campo\];/.test(painel)
  );

  // Save: a chave `participantes` só existe quando há mais de uma pessoa.
  check(
    'o save só grava participantes atrás do gate',
    painel.includes('if (!temBlocosPorPessoa) return undefined;')
  );
  check(
    'e a chave nem aparece no JSON quando não há blocos',
    painel.includes('...(participantesParaGravar ? { participantes: participantesParaGravar } : {}),')
  );
  check(
    'horas só é gravada se estiver presente no estado',
    painel.includes('if (g && g.horas !== undefined && g.horas !== null) bloco.horas = Number(g.horas);')
  );

  // Itens novos só ganham dono no caminho multi-pessoa.
  check(
    'upload e lançamento avulso só marcam o dono quando ele existe',
    (painel.match(/\.\.\.\(instructorId \? \{ instructorId \} : \{\}\)/g) ?? []).length === 2
  );

  // Auditoria por bloco — sem isso o log fica cego na medição multi-pessoa.
  check('o diff de auditoria compara bloco a bloco', painel.includes('const _blocosB: any[] = _expB.participantes ?? [];'));
  check(
    'e distingue ausente de zero no log',
    painel.includes("const _h = (v: any) => (v === undefined || v === null ? '—' : String(v));")
  );

  // Word e WhatsApp.
  check('Word ganha uma seção por pessoa', painel.includes('💰 PAGAMENTO POR PESSOA'));
  check(
    'e o recibo diz "não informado" em vez de imprimir zero',
    painel.includes('b.horasInformadas ? String(b.horas) : "não informado"')
  );
  check('Word sem blocos mantém o parágrafo de sempre', painel.includes('💰 HORA/AULA'));
  check('WhatsApp ganha uma linha por pessoa', painel.includes('const porPessoa = temBlocosPorPessoa'));
  check("e sai vazio sem blocos (mensagem idêntica à de hoje)", /porPessoa = temBlocosPorPessoa[\s\S]{0,300}: '';/.test(painel));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [7] EXCEL — o override entra entre o rateio e o workbook
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[7] Fio do export de medição');
{
  const svc = ler('services/medicaoExportService.ts');

  check('o rateio continua sendo calculado primeiro', svc.includes('const hoursRowsDoRateio = computeInstructorHoursByDemand({'));
  check('e o override é aplicado sobre ele', svc.includes('const hoursRows = applyMeasurementOverrides({'));
  check(
    'nessa ordem (override DEPOIS do rateio, ANTES do workbook)',
    svc.indexOf('computeInstructorHoursByDemand({') < svc.indexOf('applyMeasurementOverrides({') &&
      svc.indexOf('applyMeasurementOverrides({') < svc.indexOf('for (const row of hoursRows)')
  );
  check(
    'os participantes são buscados para recortar os dias da linha nova',
    svc.includes('fetchDemandParticipants()') && svc.includes('participants: (participantRows ?? []).map')
  );
  check('o período do export é repassado ao override', svc.includes('periodStart: dataInicio,') && svc.includes('periodEnd: dataFim,'));

  check(
    'os acompanhantes também (é deles que saem os dias e a proporção)',
    svc.includes('fetchCompanionAllocations()') && svc.includes('companions: (companionRows ?? []).map')
  );
  check(
    'a carga da demanda vem da MESMA função do rateio',
    svc.includes('effectiveDemandHours(d, trainingsById, measurementByDemandId)')
  );

  // D4: a chave de tarifa GANHOU o papel — é a única mudança de chave da F3.
  const workbook = ler('services/medicaoWorkbook.ts');
  check(
    'a chave de tarifa ganhou o papel (D4)',
    workbook.includes("const chave = [linha.empresa, linha.tipo, linha.noturno ? '1' : '0', linha.papel].join('\\u0000');")
  );
  check(
    'e o SUMIFS cruza a coluna nova',
    workbook.includes('${TARIFA_COL_PAPEL}:$${TARIFA_COL_PAPEL},${DETAIL_COL_PAPEL}${rowIdx})')
  );
  check(
    'papel é obrigatório na linha de detalhe (chave vazia zera o valor em silêncio)',
    /papel: TarifaPapel;/.test(workbook) && !/papel\?: TarifaPapel/.test(workbook)
  );

  // D5: a aba Tarifas continua MANUAL — valorHH do bloco NÃO alimenta a planilha.
  check('e o valorHH do bloco não vaza para o workbook', !workbook.includes('valorHH') && !svc.includes('valorHH'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [8] F3 — ACOMPANHANTE DE CLIENTE NA MEDIÇÃO
 *
 * Acompanhante não está em `instructor_allocations` (de propósito: aquela
 * tabela modela DIVISÃO de dias e o rateio dividiria a carga entre quem
 * trabalha nos mesmos dias). Consequência: hoje ele vale ZERO na planilha.
 *
 * A F3 o insere pela mesma porta do participante, com UMA diferença que é a
 * regra inteira: o default de horas é PROPORCIONAL aos dias que ele acompanha
 * (1 dia numa demanda de 2 dias e 8h = 4h), porque acompanhante quase nunca
 * acompanha a demanda inteira.
 *
 * As duas direções do erro estão cobertas: pagar a carga cheia por um dia
 * (caro) e pagar zero (o de hoje).
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[8] F3 — acompanhante de cliente');
{
  const DEMANDA_CLIENTE: any = {
    id: 'DEM-C',
    tipo: 'cliente',
    dateMode: 'CONTINUO',
    startDate: '2026-07-06T08:00',
    endDate: '2026-07-07T18:00',
    instructorId: 'TITULAR',
  };
  const D1 = '2026-07-06';
  const D2 = '2026-07-07';

  /** Demanda de 2 dias e 8h — o exemplo do enunciado. */
  const CARGA = () => 8;

  const medicao = (participantes: any[]) => ({
    demandId: 'DEM-C',
    attachments: [],
    expenses: { classHours: 8, hourRate: 100, participantes },
  });

  const rateioTitular: HoursRowLike[] = [
    { instructorId: 'TITULAR', demandId: 'DEM-C', horas: 8, dias: [D1, D2], dividida: false },
  ];

  /* ---- a regra pura ---- */
  eq('1 dia de 2, demanda de 8h -> 4h', companionDefaultHours(8, 2, 1), 4);
  eq('os 2 dias de 2 -> a carga cheia', companionDefaultHours(8, 2, 2), 8);
  eq('1 dia de 3, demanda de 10h -> 3.33 (2 casas)', companionDefaultHours(10, 3, 1), 3.33);
  // Nenhuma das bordas vira um número inventado: sem carga, sem dias de
  // demanda ou sem dias acompanhados, não há proporção — e 0 aqui significa
  // "não sei", que a inserção trata como "não insere linha".
  eq('sem carga conhecida não inventa horas', companionDefaultHours(0, 2, 1), 0);
  eq('sem dia acompanhado idem', companionDefaultHours(8, 2, 0), 0);
  // Dado torto não faz a conta passar de 100%.
  eq('mais dias que a demanda não paga mais que a carga', companionDefaultHours(8, 2, 5), 8);

  /* ---- os dias vêm das linhas dele (uma por dia) ---- */
  eq(
    'acompanhante de 1 dia tem 1 dia',
    companionDaysFromRows([{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' }], [D1, D2]).join(','),
    D1
  );
  eq(
    'linha fora dos dias da demanda não conta (dado histórico)',
    companionDaysFromRows([{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: '2026-07-20T08:00' }], [D1, D2]).length,
    0
  );
  eq(
    'e dois registros do mesmo dia contam UM dia',
    companionDaysFromRows(
      [{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' },
       { demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T13:00' }],
      [D1, D2]
    ).length,
    1
  );

  /* ---- ponta a ponta: 1 dia de 2 vira 4h ---- */
  {
    const rows = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [medicao([
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE' },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      companions: [{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' }],
      demandHours: CARGA,
    });

    const titular = rows.find(r => r.instructorId === 'TITULAR');
    const acomp = rows.find(r => r.instructorId === 'ACOMP');

    eq('o titular continua com o rateio intacto', titular?.horas, 8);
    eq('e continua com os dias do rateio', titular?.dias.join(','), [D1, D2].join(','));
    eq('o acompanhante entra com 4h (8h x 1/2)', acomp?.horas, 4);
    eq('e só com o dia dele', acomp?.dias.join(','), D1);
    eq('marcado como ACOMPANHANTE (a 5a chave de tarifa)', acomp?.papel, 'ACOMPANHANTE');

    // CONTRAPROVA do estado de hoje: sem a F3 o acompanhante não existe na
    // planilha. É o bug que esta fase resolve.
    const semF3 = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [medicao([
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE' },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      // sem `companions`: nenhuma linha, logo nenhum dia, logo nada a pagar
      demandHours: CARGA,
    });
    eq(
      '(contraprova) sem as linhas de acompanhante ele não entra',
      semF3.filter(r => r.instructorId === 'ACOMP').length,
      0
    );

    // CONTRAPROVA da direção CARA: pagar a carga cheia por um dia.
    check('e 4h não é a carga cheia (o erro caro)', acomp!.horas !== 8);
  }

  /* ---- override manual manda ---- */
  {
    const rows = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [medicao([
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE', horas: 6 },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      companions: [{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' }],
      demandHours: CARGA,
    });
    eq('horas digitadas vencem o proporcional', rows.find(r => r.instructorId === 'ACOMP')?.horas, 6);

    // E o zero digitado é um zero de verdade: some da planilha em vez de
    // reviver o default (mesma regra do participante).
    const comZero = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [medicao([
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE', horas: 0 },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      companions: [{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' }],
      demandHours: CARGA,
    });
    eq('zero digitado é decisão, não ausência', comZero.filter(r => r.instructorId === 'ACOMP').length, 0);
  }

  /* ---- ITEM 7: cliente SEM acompanhante não muda nada ---- */
  {
    const rows = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [{
        demandId: 'DEM-C',
        attachments: [],
        expenses: { classHours: 8, hourRate: 100 },   // v1: sem `participantes`
      }] as any,
      demands: [DEMANDA_CLIENTE],
      demandHours: CARGA,
    });
    eq('cliente sem acompanhante: uma linha só', rows.length, 1);
    eq('com as horas do rateio', rows[0].horas, 8);
    eq('e sem papel (a chave de tarifa continua a de sempre)', rows[0].papel, undefined);

    const blocos = normalizeMeasurementBlocks(
      { attachments: [], expenses: { classHours: 8, hourRate: 100 } } as any, 'TITULAR'
    );
    eq('e o painel dela continua com UM bloco', blocos.length, 1);
    eq('que é o classHours x hourRate de sempre', blockHoraAula(blocos[0]), 800);
  }

  /* ---- dois titulares por split + um acompanhante ---- */
  {
    // Demanda de 16h dividida por dias: cada titular 8h. A soma dos titulares
    // TEM de continuar sendo a carga — é a propriedade que o rateio garante e
    // que a inserção do acompanhante não pode contaminar.
    const rateioSplit: HoursRowLike[] = [
      { instructorId: 'T1', demandId: 'DEM-C', horas: 8, dias: [D1], dividida: true },
      { instructorId: 'T2', demandId: 'DEM-C', horas: 8, dias: [D2], dividida: true },
    ];

    const rows = applyMeasurementOverrides({
      rows: rateioSplit,
      measurements: [medicao([
        { instructorId: 'T1', papel: 'TITULAR' },
        { instructorId: 'T2', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE' },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      companions: [{ demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D2 + 'T08:00' }],
      demandHours: () => 16,
    });

    const dosTitulares = rows.filter(r => r.instructorId.startsWith('T'));
    eq('os dois titulares continuam na planilha', dosTitulares.length, 2);
    eq(
      'e a soma deles continua sendo a carga (16h, não 32h)',
      dosTitulares.reduce((acc, r) => acc + r.horas, 0),
      16
    );
    const acomp = rows.find(r => r.instructorId === 'ACOMP');
    eq('o acompanhante entra À PARTE, com 1 dia de 2 de uma demanda de 16h', acomp?.horas, 8);
    eq('e no dia dele', acomp?.dias.join(','), D2);
    eq('total de linhas: 2 titulares + 1 acompanhante', rows.length, 3);
  }

  /* ---- D4: a mesma pessoa em dois papéis vira duas linhas distintas ---- */
  {
    const OUTRA: any = { ...DEMANDA_CLIENTE, id: 'DEM-D' };
    const rows = applyMeasurementOverrides({
      rows: [
        { instructorId: 'P', demandId: 'DEM-C', horas: 8, dias: [D1, D2], dividida: false },
        { instructorId: 'OUTRO', demandId: 'DEM-D', horas: 8, dias: [D1, D2], dividida: false },
      ],
      measurements: [
        medicao([{ instructorId: 'P', papel: 'TITULAR' }]),
        {
          demandId: 'DEM-D',
          attachments: [],
          expenses: {
            classHours: 8, hourRate: 100,
            participantes: [{ instructorId: 'OUTRO', papel: 'TITULAR' }, { instructorId: 'P', papel: 'ACOMPANHANTE' }],
          },
        },
      ] as any,
      demands: [DEMANDA_CLIENTE, OUTRA],
      companions: [{ demandId: 'DEM-D', instructorId: 'P', startDate: D1 + 'T08:00' }],
      demandHours: CARGA,
    });

    const daPessoa = rows.filter(r => r.instructorId === 'P');
    eq('a mesma pessoa aparece nas duas demandas', daPessoa.length, 2);
    eq(
      'com papéis diferentes — é o que separa as duas tarifas (D4)',
      daPessoa.map(r => r.papel ?? 'TITULAR').sort().join('|'),
      'ACOMPANHANTE|TITULAR'
    );
    eq(
      'e ministrando ela mantém a carga cheia',
      daPessoa.find(r => r.demandId === 'DEM-C')?.horas,
      8
    );
    eq(
      'acompanhando, o proporcional',
      daPessoa.find(r => r.demandId === 'DEM-D')?.horas,
      4
    );
  }

  /* ---- recorte de período: o acompanhante é cortado como o titular ---- */
  {
    const rows = applyMeasurementOverrides({
      rows: rateioTitular,
      measurements: [medicao([
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE' },
      ])] as any,
      demands: [DEMANDA_CLIENTE],
      companions: [
        { demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D1 + 'T08:00' },
        { demandId: 'DEM-C', instructorId: 'ACOMP', startDate: D2 + 'T08:00' },
      ],
      demandHours: CARGA,
      periodStart: D2,
      periodEnd: D2,
    });
    const acomp = rows.find(r => r.instructorId === 'ACOMP');
    eq('fora do período sobra 1 dia', acomp?.dias.join(','), D2);
    eq('e as horas acompanham o recorte', acomp?.horas, 4);
  }
}
/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE MEDICAO BLOCOS: OK' : `\n❌ SMOKE MEDICAO BLOCOS: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
