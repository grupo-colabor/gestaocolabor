/**
 * SMOKE — Totais de medicao, flag nao reembolsavel e custo de interna
 *
 * Rodar com:  npm run smoke:custos
 *
 * Cobre as duas features de custo:
 *  A) o card "Custo das Demandas Internas" (Hora/Aula + Despesas)
 *  B) a flag `reembolsavel` por item de despesa
 *  C) a quebra das despesas nas quatro categorias do Painel de Medicao, que
 *     alimenta os mini-cards do card A (aba INTERNAS) e os do card
 *     "Despesas Nao Reembolsaveis" (aba CUSTOS)
 *  D) o recorte por predicado (`itemFilter`) que da a quebra do card de nao
 *     reembolsaveis sem duplicar o mapa 6->4 nem o tratamento de orfaos
 *
 * O ponto central e a REGRESSAO: `computeMeasurementTotals` tem de devolver
 * exatamente as mesmas somas por categoria que o `getMeasurementTotals`
 * original de Measurement.tsx — reproduzido aqui literalmente.
 *
 * Sai com codigo 1 se qualquer assercao falhar.
 */
import {
  computeMeasurementTotals,
  aggregateMeasurements,
  computePanelExpenseBreakdown,
  aggregatePanelExpenseBreakdown,
  PANEL_EXPENSE_LABELS,
  isNaoReembolsavel,
  parseExpenseValue,
} from '../domain/measurementTotals';
import fsCustos from 'fs';
import pathCustos from 'path';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
function checkEq(nome: string, atual: unknown, esperado: unknown) {
  check(nome, JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

const att = (o: any) => ({ id: o.id, category: o.cat, value: o.v, otherId: o.oid, reembolsavel: o.re });

console.log('\n— Default: item sem o campo e reembolsavel');
{
  check('sem o campo -> reembolsavel', !isNaoReembolsavel({ value: 10 } as any));
  check('undefined -> reembolsavel', !isNaoReembolsavel({ reembolsavel: undefined } as any));
  check('true -> reembolsavel', !isNaoReembolsavel({ reembolsavel: true } as any));
  check('false -> NAO reembolsavel', isNaoReembolsavel({ reembolsavel: false } as any));

  const legado = {
    attachments: [att({ id: 'a1', cat: 'ALMOCO', v: '50,00' }), att({ id: 'a2', cat: 'LOCOMOCAO', v: 30 })],
    otherExpenses: [], expenses: {},
  };
  const t = computeMeasurementTotals(legado as any);
  checkEq('medicao antiga (sem o campo) some 80 normal', t.total, 80);
  checkEq('e nao acusa nada de nao reembolsavel', t.naoReembolsavel, 0);
  checkEq('nem conta itens', t.itensNaoReembolsaveis, 0);
}

console.log('\n— Medicao mista: 2 itens, 1 marcado');
{
  const mista = {
    attachments: [
      att({ id: 'a1', cat: 'LOCOMOCAO', v: '120,00' }),                  // reembolsavel
      att({ id: 'a2', cat: 'LOCOMOCAO', v: '35,50', re: false }),        // Uber ate a locadora
    ],
    otherExpenses: [], expenses: { classHours: 8, hourRate: 100 },
  };
  const t = computeMeasurementTotals(mista as any);

  checkEq('subtotal de despesas soma os DOIS', t.total, 155.5);
  checkEq('o marcado CONTINUA na categoria (mix inalterado)', t.locomocao, 155.5);
  checkEq('subtotal nao reembolsavel isola o item', t.naoReembolsavel, 35.5);
  checkEq('1 item marcado', t.itensNaoReembolsaveis, 1);
  checkEq('hora/aula = 8 x 100', t.horaAula, 800);
  checkEq('total cheio = despesas + hora/aula', t.totalComHoraAula, 955.5);
  checkEq('quebra por categoria do nao reembolsavel', t.naoReembolsavelPorCategoria.LOCOMOCAO, 35.5);
  checkEq('categoria sem marcado fica zerada', t.naoReembolsavelPorCategoria.ALMOCO, 0);
}

console.log('\n— Regressao: mesmas somas do getMeasurementTotals original');
{
  // Copia literal do que existia em Measurement.tsx antes da extracao.
  const regraOriginal = (m: any) => {
    const sum = (cat: string, oid?: string) => m.attachments
      .filter((a: any) => a.category === cat && (oid ? a.otherId === oid : !a.otherId))
      .reduce((acc: number, curr: any) => {
        const val = typeof curr.value === 'string' ? parseFloat(curr.value.replace(',', '.')) : curr.value;
        return acc + (val || 0);
      }, 0);
    const h = sum('HOSPEDAGEM'), l = sum('LOCOMOCAO'), c = sum('CAFE');
    const alm = sum('ALMOCO'), j = sum('JANTAR');
    const o = m.otherExpenses.reduce((acc: number, curr: any) => acc + sum('OUTROS', curr.id), 0);
    return { hospedagem: h, locomocao: l, cafe: c, almoco: alm, jantar: j, outros: o, total: h + l + c + alm + j + o };
  };

  const completa = {
    attachments: [
      att({ id: 'h1', cat: 'HOSPEDAGEM', v: '450,00' }),
      att({ id: 'l1', cat: 'LOCOMOCAO', v: 120 }),
      att({ id: 'l2', cat: 'LOCOMOCAO', v: '35,50', re: false }),
      att({ id: 'c1', cat: 'CAFE', v: '18,90' }),
      att({ id: 'm1', cat: 'ALMOCO', v: '62,00', re: false }),
      att({ id: 'j1', cat: 'JANTAR', v: '0' }),
      att({ id: 'o1', cat: 'OUTROS', v: '80,00', oid: 'OE-1' }),
      att({ id: 'o2', cat: 'OUTROS', v: '15,00', oid: 'OE-2', re: false }),
      // anexo orfao: aponta para linha que nao existe mais
      att({ id: 'o3', cat: 'OUTROS', v: '999,00', oid: 'OE-APAGADA' }),
    ],
    otherExpenses: [{ id: 'OE-1' }, { id: 'OE-2' }],
    expenses: { classHours: 4, hourRate: 90 },
  };

  const orig = regraOriginal(completa);
  const novo = computeMeasurementTotals(completa as any);

  for (const k of ['hospedagem', 'locomocao', 'cafe', 'almoco', 'jantar', 'outros', 'total'] as const) {
    checkEq(`${k} bate com a regra original`, (novo as any)[k], (orig as any)[k]);
  }
  checkEq('anexo orfao de OUTROS continua fora do total (como antes)', novo.outros, 95);
  checkEq('e tambem fora do recorte nao reembolsavel', novo.naoReembolsavelPorCategoria.OUTROS, 15);
  checkEq('nao reembolsavel total = 35,50 + 62 + 15', novo.naoReembolsavel, 112.5);
  checkEq('3 itens marcados', novo.itensNaoReembolsaveis, 3);
  check('o recorte nunca passa do total', novo.naoReembolsavel <= novo.total);
}

console.log('\n— parseExpenseValue: tolerancias herdadas');
{
  checkEq('virgula decimal', parseExpenseValue('35,50'), 35.5);
  checkEq('ponto decimal', parseExpenseValue('12.5'), 12.5);
  checkEq('number direto', parseExpenseValue(7), 7);
  checkEq('vazio vira 0', parseExpenseValue(''), 0);
  checkEq('null vira 0', parseExpenseValue(null), 0);
  checkEq('lixo vira 0', parseExpenseValue('abc'), 0);
}

console.log('\n— Cards: interna fora de CUSTOS, dentro do card A');
{
  // O Dashboard corta o dataset na entrada: `demands` (usado por CUSTOS) e
  // cliente-only; a aba INTERNAS usa `internaDemands`. Aqui isso e reproduzido
  // pelo recorte das medicoes de cada lado.
  const demandas = [
    { id: 'DEM-1', tipo: 'cliente' },
    { id: 'DEM-2', tipo: 'cliente' },
    { id: 'INT-1', tipo: 'interna' },
  ];
  const medicoes = [
    { demandId: 'DEM-1', otherExpenses: [], expenses: { classHours: 8, hourRate: 100 },
      attachments: [att({ id: 'x1', cat: 'ALMOCO', v: 100 }), att({ id: 'x2', cat: 'LOCOMOCAO', v: 40, re: false })] },
    { demandId: 'DEM-2', otherExpenses: [], expenses: {},
      attachments: [att({ id: 'y1', cat: 'HOSPEDAGEM', v: 200 })] },
    { demandId: 'INT-1', otherExpenses: [], expenses: { classHours: 6, hourRate: 50 },
      attachments: [att({ id: 'z1', cat: 'LOCOMOCAO', v: 75 })] },
  ];

  const idsCliente = new Set(demandas.filter(d => d.tipo !== 'interna').map(d => d.id));
  const idsInterna = new Set(demandas.filter(d => d.tipo === 'interna').map(d => d.id));

  const custos = aggregateMeasurements(medicoes.filter(m => idsCliente.has(m.demandId)) as any);
  const cardA = aggregateMeasurements(medicoes.filter(m => idsInterna.has(m.demandId)) as any);

  checkEq('CUSTOS ve 2 medicoes (interna fora)', custos.medicoes, 2);
  checkEq('CUSTOS: despesas 100 + 40 + 200', custos.despesas, 340);
  check('os 75 da interna NAO entram em CUSTOS', custos.despesas === 340);
  checkEq('CUSTOS: nao reembolsavel = 40', custos.naoReembolsavel, 40);
  checkEq('CUSTOS: 1 medicao com item marcado', custos.medicoesComNaoReembolsavel, 1);

  checkEq('card A ve so a interna', cardA.medicoes, 1);
  checkEq('card A: despesas = 75', cardA.despesas, 75);
  checkEq('card A: hora/aula = 6 x 50', cardA.horaAula, 300);
  checkEq('card A: total = 375', cardA.total, 375);
  check('nenhuma despesa de cliente entra no card A', cardA.despesas === 75);
}

console.log('\n— Interna: sem toggle, custo integral');
{
  // A UI nao mostra o toggle na medicao de interna. Mesmo que um item viesse
  // marcado, o card A soma o custo INTEGRAL — ele nao subtrai nada.
  const internaComItemMarcado = {
    demandId: 'INT-9', otherExpenses: [], expenses: {},
    attachments: [att({ id: 'i1', cat: 'ALMOCO', v: 60, re: false }), att({ id: 'i2', cat: 'CAFE', v: 20 })],
  };
  const a = aggregateMeasurements([internaComItemMarcado] as any);
  checkEq('custo da interna e integral (60 + 20)', a.despesas, 80);
  checkEq('total tambem', a.total, 80);
}

console.log('\n— Agregacao: contadores');
{
  const semMarcado = { demandId: 'D1', otherExpenses: [], expenses: {}, attachments: [att({ id: 'p', cat: 'CAFE', v: 10 })] };
  const comMarcado = { demandId: 'D2', otherExpenses: [], expenses: {}, attachments: [att({ id: 'q', cat: 'CAFE', v: 10, re: false })] };
  const a = aggregateMeasurements([semMarcado, comMarcado, null, undefined] as any);
  checkEq('nulos sao ignorados', a.medicoes, 2);
  checkEq('so 1 medicao tem item marcado', a.medicoesComNaoReembolsavel, 1);
  checkEq('1 item marcado no total', a.itensNaoReembolsaveis, 1);
  checkEq('lista vazia nao quebra', aggregateMeasurements([]).total, 0);
}


console.log('\n— Quebra por categoria: os quatro buckets do Painel de Medicao');
{
  // As SEIS categorias do JSON caem nos QUATRO buckets que o painel exibe:
  // CAFE + ALMOCO + JANTAR viram "Alimentacao".
  const completa = {
    attachments: [
      att({ id: 'h1', cat: 'HOSPEDAGEM', v: '450,00' }),
      att({ id: 'l1', cat: 'LOCOMOCAO', v: 120 }),
      att({ id: 'c1', cat: 'CAFE', v: '18,90' }),
      att({ id: 'm1', cat: 'ALMOCO', v: '62,00' }),
      att({ id: 'j1', cat: 'JANTAR', v: 40 }),
      att({ id: 'o1', cat: 'OUTROS', v: '80,00', oid: 'OE-1' }),
    ],
    otherExpenses: [{ id: 'OE-1' }],
    expenses: { classHours: 4, hourRate: 90 },
  };
  const b = computePanelExpenseBreakdown(completa as any);

  checkEq('hospedagem', b.hospedagem, 450);
  checkEq('locomocao', b.locomocao, 120);
  checkEq('alimentacao = cafe + almoco + jantar', b.alimentacao, 120.9);
  checkEq('outros', b.outros, 80);
  checkEq('total = soma dos quatro', b.total, 770.9);
  checkEq('os 6 itens foram classificados', b.itens, 6);
  checkEq('nenhum orfao', b.itensOrfaos, 0);

  // CONTRAPROVA 1 — nada descartado: a soma bruta de TODO valor do JSON tem de
  // reaparecer nos quatro buckets. Se um item sumisse, isto quebraria.
  const somaBruta = completa.attachments.reduce((acc, a) => acc + parseExpenseValue(a.value), 0);
  checkEq('soma bruta do JSON reaparece inteira nos buckets', b.total, somaBruta);
  checkEq('e todo item do JSON foi contado', b.itens + b.itensOrfaos, completa.attachments.length);

  // CONTRAPROVA 2 — a quebra fecha com a conta compartilhada do painel.
  const t = computeMeasurementTotals(completa as any);
  checkEq('total da quebra bate com computeMeasurementTotals', b.total, t.total);
  checkEq('alimentacao bate com cafe+almoco+jantar do painel', b.alimentacao, t.cafe + t.almoco + t.jantar);
}

console.log('\n— Quebra: categoria desconhecida/ausente cai em Outros');
{
  const suja = {
    attachments: [
      att({ id: 'a1', cat: 'HOSPEDAGEM', v: 100 }),
      att({ id: 'a2', cat: 'ESTACIONAMENTO', v: 30 }),   // categoria fora das seis
      att({ id: 'a3', cat: null, v: 20 }),               // categoria nula
      { id: 'a4', value: 5 },                            // sem o campo category
    ],
    otherExpenses: [], expenses: {},
  };
  const b = computePanelExpenseBreakdown(suja as any);

  checkEq('conhecida vai pro bucket dela', b.hospedagem, 100);
  checkEq('desconhecida + nula + ausente caem em Outros', b.outros, 55);
  checkEq('nada foi parar em locomocao', b.locomocao, 0);
  checkEq('nada foi parar em alimentacao', b.alimentacao, 0);
  checkEq('total = 155 (nenhum item descartado)', b.total, 155);
  checkEq('os 4 itens foram classificados', b.itens, 4);

  // CONTRAPROVA — sem o fallback pra Outros, estes 55 sumiriam: e exatamente o
  // que `computeMeasurementTotals` faz, e por isso a quebra NAO deriva dele.
  const t = computeMeasurementTotals(suja as any);
  checkEq('a conta do painel de fato perde os 55', t.total, 100);
  check('a quebra resgata o que a conta do painel perde', b.total > t.total);
}

console.log('\n— Quebra: orfao de OUTROS fora do total, mas contado');
{
  // Anexo apontando pra linha de other_expenses apagada. Mesma exclusao do
  // painel (apagar a linha e apagar a despesa) — o que NAO pode e ser silencioso.
  const comOrfao = {
    attachments: [
      att({ id: 'o1', cat: 'OUTROS', v: 80, oid: 'OE-1' }),
      att({ id: 'o2', cat: 'OUTROS', v: 999, oid: 'OE-APAGADA' }),
      att({ id: 'o3', cat: 'OUTROS', v: 500 }),           // sem otherId nenhum
    ],
    otherExpenses: [{ id: 'OE-1' }], expenses: {},
  };
  const b = computePanelExpenseBreakdown(comOrfao as any);

  checkEq('so o anexo com linha viva entra em Outros', b.outros, 80);
  checkEq('total idem', b.total, 80);
  checkEq('2 orfaos contados, nao sumidos', b.itensOrfaos, 2);
  checkEq('todo item do JSON foi visto', b.itens + b.itensOrfaos, comOrfao.attachments.length);

  const t = computeMeasurementTotals(comOrfao as any);
  checkEq('mesma exclusao de computeMeasurementTotals', b.total, t.total);
}

console.log('\n— Quebra: estado zerado nao quebra');
{
  const casos: [string, any][] = [
    ['medicao null', null],
    ['medicao undefined', undefined],
    ['attachments ausente', { otherExpenses: [], expenses: {} }],
    ['attachments null', { attachments: null, otherExpenses: null, expenses: null }],
    ['attachments vazio', { attachments: [], otherExpenses: [], expenses: {} }],
    ['item null dentro do array', { attachments: [null], otherExpenses: [], expenses: {} }],
  ];
  for (const [nome, m] of casos) {
    const b = computePanelExpenseBreakdown(m);
    checkEq(`${nome} -> quatro zeros`,
      [b.hospedagem, b.locomocao, b.alimentacao, b.outros, b.total], [0, 0, 0, 0, 0]);
  }
  const vazio = aggregatePanelExpenseBreakdown([]);
  checkEq('lista vazia -> quatro zeros', [vazio.hospedagem, vazio.locomocao, vazio.alimentacao, vazio.outros], [0, 0, 0, 0]);
  checkEq('lista null -> quatro zeros', aggregatePanelExpenseBreakdown(null).total, 0);
  checkEq('lista so com nulos -> zero', aggregatePanelExpenseBreakdown([null, undefined]).total, 0);

  // E o estado de hoje: nenhuma interna tem despesa. Os quatro sublabels
  // precisam renderizar R$ 0,00, nao NaN nem undefined.
  const zerado = aggregatePanelExpenseBreakdown([]);
  for (const { key, label } of PANEL_EXPENSE_LABELS) {
    check(`sublabel "${label}" e 0 numerico`, zerado[key] === 0 && Number.isFinite(zerado[key]));
  }
  checkEq('os quatro rotulos, na ordem do card',
    PANEL_EXPENSE_LABELS.map(x => x.label), ['Hospedagem', 'Locomoção', 'Alimentação', 'Outros']);
}

console.log('\n— Card A: quebra agregada so das internas, e fechando com o valor principal');
{
  // Mesmo recorte que o Dashboard faz: ids das internas do periodo.
  const demandas = [
    { id: 'DEM-1', tipo: 'cliente' },
    { id: 'INT-1', tipo: 'interna' },
    { id: 'INT-2', tipo: 'interna' },
  ];
  const medicoes = [
    // Medicao de CLIENTE — valores grandes e distintos, pra denunciar vazamento.
    { demandId: 'DEM-1', otherExpenses: [{ id: 'OE-C' }], expenses: { classHours: 10, hourRate: 100 },
      attachments: [
        att({ id: 'c1', cat: 'HOSPEDAGEM', v: 9000 }),
        att({ id: 'c2', cat: 'LOCOMOCAO', v: 8000 }),
        att({ id: 'c3', cat: 'ALMOCO', v: 7000 }),
        att({ id: 'c4', cat: 'OUTROS', v: 6000, oid: 'OE-C' }),
      ] },
    { demandId: 'INT-1', otherExpenses: [{ id: 'OE-1' }], expenses: { classHours: 6, hourRate: 50 },
      attachments: [
        att({ id: 'i1', cat: 'HOSPEDAGEM', v: '250,00' }),
        att({ id: 'i2', cat: 'LOCOMOCAO', v: 75 }),
        att({ id: 'i3', cat: 'CAFE', v: '12,50' }),
        att({ id: 'i4', cat: 'JANTAR', v: 45 }),
        att({ id: 'i5', cat: 'OUTROS', v: 30, oid: 'OE-1' }),
        att({ id: 'i6', cat: 'PEDAGIO', v: 20 }),        // desconhecida -> Outros
      ] },
    { demandId: 'INT-2', otherExpenses: [], expenses: { classHours: 2, hourRate: 80 },
      attachments: [att({ id: 'i7', cat: 'ALMOCO', v: '37,50' })] },
  ];

  const idsInterna = new Set(demandas.filter(d => d.tipo === 'interna').map(d => d.id));
  const internas = medicoes.filter(m => idsInterna.has(m.demandId));

  const custo = aggregateMeasurements(internas as any);
  const quebra = aggregatePanelExpenseBreakdown(internas as any);

  checkEq('card A ve as 2 internas', custo.medicoes, 2);
  checkEq('hospedagem so das internas', quebra.hospedagem, 250);
  checkEq('locomocao so das internas', quebra.locomocao, 75);
  checkEq('alimentacao = 12,50 + 45 + 37,50', quebra.alimentacao, 95);
  checkEq('outros = 30 + os 20 da categoria desconhecida', quebra.outros, 50);
  checkEq('total das despesas internas', quebra.total, 470);

  // Nenhum valor do cliente vazou pra dentro de bucket nenhum.
  for (const { key, label } of PANEL_EXPENSE_LABELS) {
    check(`nada de cliente em ${label}`, quebra[key] < 1000);
  }
  checkEq('nenhum item de cliente contado', quebra.itens, 7);

  // CONTRAPROVA — a soma dos quatro sublabels tem de bater com o valor
  // principal do card menos a Hora/Aula. E a formula do Dashboard.
  const valorPrincipal = custo.horaAula + quebra.total;
  checkEq('hora/aula das internas = 6x50 + 2x80', custo.horaAula, 460);
  checkEq('valor principal do card', valorPrincipal, 930);
  checkEq('soma dos quatro = valor principal - hora/aula',
    quebra.hospedagem + quebra.locomocao + quebra.alimentacao + quebra.outros,
    valorPrincipal - custo.horaAula);

  // Cliente entrando no recorte por engano seria pego aqui.
  const comCliente = aggregatePanelExpenseBreakdown(medicoes as any);
  check('quebra do dataset inteiro e MAIOR — prova que o recorte filtra', comCliente.total > quebra.total);
  checkEq('e a diferenca e exatamente a medicao de cliente', comCliente.total - quebra.total, 30000);
}


console.log('\n— Quebra com predicado: recorte NAO REEMBOLSAVEL');
{
  // Itens mistos nas quatro categorias. So os marcados (`re: false`) contam.
  const mista = {
    demandId: 'DEM-1',
    attachments: [
      att({ id: 'h1', cat: 'HOSPEDAGEM', v: 400 }),                 // reembolsavel
      att({ id: 'h2', cat: 'HOSPEDAGEM', v: 100, re: false }),
      att({ id: 'l1', cat: 'LOCOMOCAO', v: '35,50', re: false }),
      att({ id: 'c1', cat: 'CAFE', v: 10, re: false }),
      att({ id: 'm1', cat: 'ALMOCO', v: 62, re: false }),
      att({ id: 'j1', cat: 'JANTAR', v: 28 }),                      // reembolsavel
      att({ id: 'o1', cat: 'OUTROS', v: 15, re: false, oid: 'OE-1' }),
      att({ id: 'x1', cat: 'ALMOCO', v: 999, re: true }),           // explicitamente reembolsavel
      { id: 'x2', category: 'CAFE', value: 777 },                   // SEM a flag -> default reembolsavel
    ],
    otherExpenses: [{ id: 'OE-1' }], expenses: { classHours: 4, hourRate: 90 },
  };

  const q = aggregatePanelExpenseBreakdown([mista] as any, { itemFilter: isNaoReembolsavel });

  checkEq('hospedagem: so os 100 marcados', q.hospedagem, 100);
  checkEq('locomocao marcada', q.locomocao, 35.5);
  checkEq('alimentacao = cafe 10 + almoco 62 (jantar 28 e reembolsavel)', q.alimentacao, 72);
  checkEq('outros marcado', q.outros, 15);
  checkEq('total = soma dos quatro', q.total, 222.5);
  checkEq('5 itens marcados', q.itens, 5);
  checkEq('1 medicao com item marcado', q.medicoes, 1);

  // DEFAULT DA FLAG — o ponto que mantem as medicoes antigas corretas.
  check('item sem o campo NAO entrou (default reembolsavel)', q.total === 222.5);
  check('os 777 do item sem flag ficaram fora', q.alimentacao === 72);
  check('os 999 do reembolsavel: true ficaram fora', q.alimentacao === 72);

  // AMARRACAO — o numero grande do card e a soma dos quatro mini-cards.
  checkEq('total do card = soma dos quatro buckets',
    q.total, q.hospedagem + q.locomocao + q.alimentacao + q.outros);

  // MESMA FONTE DE VERDADE — bate com o subtotal "NAO REEMB." do painel.
  const t = computeMeasurementTotals(mista as any);
  checkEq('total bate com o naoReembolsavel do painel', q.total, t.naoReembolsavel);
  checkEq('contagem de itens bate com a do painel', q.itens, t.itensNaoReembolsaveis);
  checkEq('hospedagem bate com a quebra do painel', q.hospedagem, t.naoReembolsavelPorCategoria.HOSPEDAGEM);
  checkEq('alimentacao bate com CAFE+ALMOCO+JANTAR do painel',
    q.alimentacao,
    t.naoReembolsavelPorCategoria.CAFE + t.naoReembolsavelPorCategoria.ALMOCO + t.naoReembolsavelPorCategoria.JANTAR);

  // O recorte nunca passa do gasto cheio da mesma medicao.
  const cheio = aggregatePanelExpenseBreakdown([mista] as any);
  check('o recorte marcado <= o gasto cheio', q.total < cheio.total);
  checkEq('gasto cheio soma tudo, marcado ou nao', cheio.total, 2426.5);
}

console.log('\n— Quebra com predicado: categoria desconhecida marcada cai em Outros');
{
  const suja = {
    attachments: [
      att({ id: 'a1', cat: 'HOSPEDAGEM', v: 100, re: false }),
      att({ id: 'a2', cat: 'ESTACIONAMENTO', v: 30, re: false }),  // fora das seis
      att({ id: 'a3', cat: null, v: 20, re: false }),              // categoria nula
      { id: 'a4', value: 5, reembolsavel: false },                 // sem category
      att({ id: 'a5', cat: 'ESTACIONAMENTO', v: 888 }),            // desconhecida mas reembolsavel
    ],
    otherExpenses: [], expenses: {},
  };
  const q = aggregatePanelExpenseBreakdown([suja] as any, { itemFilter: isNaoReembolsavel });

  checkEq('conhecida marcada vai pro bucket dela', q.hospedagem, 100);
  checkEq('desconhecida + nula + ausente, todas marcadas, caem em Outros', q.outros, 55);
  checkEq('a desconhecida REEMBOLSAVEL ficou fora', q.total, 155);
  checkEq('4 itens marcados classificados', q.itens, 4);
  checkEq('total = soma dos quatro', q.total, q.hospedagem + q.locomocao + q.alimentacao + q.outros);

  // Aqui a quebra e o `naoReembolsavel` do painel DIVERGEM de proposito: o
  // painel descarta categoria fora das seis, a quebra manda pra Outros. Por
  // isso o card exibe o total DA QUEBRA — senao os quatro nao fechariam.
  const t = computeMeasurementTotals(suja as any);
  checkEq('o painel perde os 55 da categoria desconhecida', t.naoReembolsavel, 100);
  check('a quebra resgata o que o painel perde', q.total > t.naoReembolsavel);
}

console.log('\n— Quebra com predicado: orfao de OUTROS marcado');
{
  const comOrfao = {
    attachments: [
      att({ id: 'o1', cat: 'OUTROS', v: 80, re: false, oid: 'OE-1' }),
      att({ id: 'o2', cat: 'OUTROS', v: 999, re: false, oid: 'OE-APAGADA' }),  // orfao marcado
      att({ id: 'o3', cat: 'OUTROS', v: 500, oid: 'OE-APAGADA' }),             // orfao reembolsavel
    ],
    otherExpenses: [{ id: 'OE-1' }], expenses: {},
  };
  const q = aggregatePanelExpenseBreakdown([comOrfao] as any, { itemFilter: isNaoReembolsavel });

  checkEq('so o marcado com linha viva entra', q.outros, 80);
  checkEq('total idem', q.total, 80);
  checkEq('orfao contado e o do recorte — o reembolsavel nem foi olhado', q.itensOrfaos, 1);

  const t = computeMeasurementTotals(comOrfao as any);
  checkEq('mesma exclusao do painel', q.total, t.naoReembolsavel);
}

console.log('\n— Card CUSTOS: cliente only, interna ignorada');
{
  // `filteredMeasurements` do Dashboard ja e cliente-only; aqui o recorte e
  // reproduzido pelos ids, como o componente faz.
  const demandas = [
    { id: 'DEM-1', tipo: 'cliente' },
    { id: 'DEM-2', tipo: 'cliente' },
    { id: 'INT-1', tipo: 'interna' },
  ];
  const medicoes = [
    { demandId: 'DEM-1', otherExpenses: [], expenses: {},
      attachments: [
        att({ id: 'a1', cat: 'HOSPEDAGEM', v: 200, re: false }),
        att({ id: 'a2', cat: 'LOCOMOCAO', v: 50 }),
      ] },
    { demandId: 'DEM-2', otherExpenses: [], expenses: {},
      attachments: [
        att({ id: 'b1', cat: 'ALMOCO', v: 40, re: false }),
        att({ id: 'b2', cat: 'JANTAR', v: 10, re: false }),
      ] },
    // Interna: NAO tem toggle na UI, mas mesmo que viesse marcada nao pode
    // entrar — o custo dela e integral e vive na aba INTERNAS.
    { demandId: 'INT-1', otherExpenses: [], expenses: {},
      attachments: [
        att({ id: 'z1', cat: 'HOSPEDAGEM', v: 5000, re: false }),
        att({ id: 'z2', cat: 'LOCOMOCAO', v: 3000, re: false }),
      ] },
  ];

  const idsCliente = new Set(demandas.filter(d => d.tipo !== 'interna').map(d => d.id));
  const cliente = medicoes.filter(m => idsCliente.has(m.demandId));
  const q = aggregatePanelExpenseBreakdown(cliente as any, { itemFilter: isNaoReembolsavel });

  checkEq('hospedagem so de cliente', q.hospedagem, 200);
  checkEq('locomocao: nada marcado em cliente', q.locomocao, 0);
  checkEq('alimentacao de cliente', q.alimentacao, 50);
  checkEq('total do card', q.total, 250);
  checkEq('3 itens marcados em cliente', q.itens, 3);
  checkEq('em 2 medicoes', q.medicoes, 2);
  check('os 5000 da interna NAO entram em hospedagem', q.hospedagem === 200);
  check('os 3000 da interna NAO entram em locomocao', q.locomocao === 0);

  // Se o recorte cliente-only quebrasse, isto denunciaria.
  const comInterna = aggregatePanelExpenseBreakdown(medicoes as any, { itemFilter: isNaoReembolsavel });
  checkEq('a interna sozinha valeria +8000', comInterna.total - q.total, 8000);

  checkEq('total = soma dos quatro mini-cards',
    q.total, q.hospedagem + q.locomocao + q.alimentacao + q.outros);
}

console.log('\n— Card CUSTOS: estado zerado renderiza os quatro em zero');
{
  // Producao hoje: ninguem marcou nada. Os mini-cards aparecem zerados.
  const semMarcado = [
    { demandId: 'D1', otherExpenses: [], expenses: { classHours: 8, hourRate: 100 },
      attachments: [att({ id: 'p', cat: 'HOSPEDAGEM', v: 300 }), att({ id: 'q', cat: 'ALMOCO', v: 40 })] },
    { demandId: 'D2', otherExpenses: [], expenses: {}, attachments: [] },
    null,
  ];
  const q = aggregatePanelExpenseBreakdown(semMarcado as any, { itemFilter: isNaoReembolsavel });

  checkEq('quatro zeros', [q.hospedagem, q.locomocao, q.alimentacao, q.outros], [0, 0, 0, 0]);
  checkEq('total zero', q.total, 0);
  checkEq('nenhum item', q.itens, 0);
  checkEq('nenhuma medicao', q.medicoes, 0);
  for (const { key, label } of PANEL_EXPENSE_LABELS) {
    check(`mini-card "${label}" e 0 numerico`, q[key] === 0 && Number.isFinite(q[key]));
  }
  checkEq('lista vazia com predicado', aggregatePanelExpenseBreakdown([], { itemFilter: isNaoReembolsavel }).total, 0);
  checkEq('lista null com predicado', aggregatePanelExpenseBreakdown(null, { itemFilter: isNaoReembolsavel }).total, 0);

  // O gasto cheio das mesmas medicoes segue existindo — o card de cima nao zera.
  checkEq('mas o total geral de despesas nao e zero', aggregatePanelExpenseBreakdown(semMarcado as any).total, 340);
}

console.log('\n— Predicado nao vaza: card das INTERNAS segue somando tudo');
{
  // Regressao do card da outra aba: sem `itemFilter`, nada muda.
  const interna = {
    demandId: 'INT-9', otherExpenses: [], expenses: { classHours: 6, hourRate: 50 },
    attachments: [att({ id: 'i1', cat: 'ALMOCO', v: 60, re: false }), att({ id: 'i2', cat: 'CAFE', v: 20 })],
  };
  const cheio = aggregatePanelExpenseBreakdown([interna] as any);
  checkEq('sem predicado soma marcado e nao marcado', cheio.total, 80);
  checkEq('alimentacao cheia', cheio.alimentacao, 80);
  checkEq('1 medicao contribuiu', cheio.medicoes, 1);
  checkEq('opcoes vazias equivalem a sem opcoes', aggregatePanelExpenseBreakdown([interna] as any, {}).total, 80);
}

console.log('\n— Dashboard: hora/aula de medicao MULTI-PESSOA (v2)');
{
  /*
   * O bug: o card "Custo das Demandas Internas" mostrava hora/aula ZERO para
   * toda medicao v2. A conta era `classHours x hourRate`, e numa medicao por
   * pessoa o valor mora em `participantes[].valorHH` — `hourRate` fica em
   * branco. A medicao aparecia salva na tela com R$ 40.500 e o Dashboard dizia
   * que a demanda nao custou nada de hora/aula.
   *
   * A correcao NAO e uma formula nova: e o Dashboard passar a consumir a mesma
   * resolucao do dominio que o painel usa (normalizeMeasurementBlocks +
   * blockHoraAula), atraves de computeMeasurementTotals.
   */

  // 16h de carga; o titular NAO tem horas gravadas (e o que protege o rateio
  // no Excel) e o participante digitou 10h.
  const v2: any = {
    demandId: 'DEM-1552',
    otherExpenses: [],
    attachments: [att({ id: 'x1', cat: 'ALMOCO', v: 100 })],
    expenses: {
      classHours: 16,
      hourRate: 0,
      participantes: [
        { instructorId: 'TITULAR', papel: 'TITULAR', valorHH: 100 },
        { instructorId: 'PART', papel: 'PARTICIPANTE', valorHH: 80, horas: 10 },
      ],
    },
  };

  const t = computeMeasurementTotals(v2);
  // titular: 16h (padrao da demanda) x 100 = 1600; participante: 10 x 80 = 800
  checkEq('hora/aula da v2 e a soma dos blocos', t.horaAula, 2400);
  checkEq('despesas nao mudam', t.total, 100);
  checkEq('e o total cheio soma os dois', t.totalComHoraAula, 2500);

  // CONTRAPROVA: a formula legada reproduzida aqui PERDE o titular inteiro.
  const legadoErrado =
    (Number(v2.expenses.classHours) || 0) * (Number(v2.expenses.hourRate) || 0);
  checkEq('(contraprova) a formula antiga daria zero', legadoErrado, 0);
  check('logo ela perdia os R$ 1.600 do titular', t.horaAula - legadoErrado === 2400);

  // O agregado do card e a soma das medicoes, com a mesma resolucao.
  const card = aggregateMeasurements([v2] as any);
  checkEq('o card das internas ve a hora/aula da v2', card.horaAula, 2400);
  checkEq('e o total dele fecha', card.total, 2500);

  /* --- ACOMPANHANTE: manual obrigatorio tambem aqui --- */
  const comAcomp: any = {
    demandId: 'DEM-C',
    otherExpenses: [],
    attachments: [],
    expenses: {
      classHours: 8,
      hourRate: 0,
      participantes: [
        { instructorId: 'TITULAR', papel: 'TITULAR', valorHH: 100 },
        { instructorId: 'ACOMP', papel: 'ACOMPANHANTE', valorHH: 90 },
      ],
    },
  };
  checkEq(
    'acompanhante sem horas nao entra na hora/aula do Dashboard',
    computeMeasurementTotals(comAcomp).horaAula,
    800
  );
  checkEq(
    'e entra quando alguem informa as horas',
    computeMeasurementTotals({
      ...comAcomp,
      expenses: {
        ...comAcomp.expenses,
        participantes: [
          { instructorId: 'TITULAR', papel: 'TITULAR', valorHH: 100 },
          { instructorId: 'ACOMP', papel: 'ACOMPANHANTE', valorHH: 90, horas: 4 },
        ],
      },
    } as any).horaAula,
    800 + 360
  );

  /* --- v1 continua identica a hoje --- */
  const v1: any = {
    demandId: 'DEM-900',
    otherExpenses: [],
    attachments: [att({ id: 'y1', cat: 'CAFE', v: 20 })],
    expenses: { classHours: 6, hourRate: 50 },
  };
  const t1 = computeMeasurementTotals(v1);
  checkEq('v1: hora/aula continua classHours x hourRate', t1.horaAula, 300);
  checkEq('v1: total cheio inalterado', t1.totalComHoraAula, 320);
  // `participantes` vazio tambem e v1 — a chave existir nao basta.
  checkEq(
    'lista de participantes VAZIA continua sendo v1',
    computeMeasurementTotals({ ...v1, expenses: { ...v1.expenses, participantes: [] } } as any).horaAula,
    300
  );

  /* --- guarda de fonte: nada de formula inline no Dashboard --- */
  const dash = fsCustos.readFileSync(pathCustos.join(process.cwd(), 'components/Dashboard.tsx'), 'utf8');
  check(
    'o Dashboard nao recalcula hora/aula na mao',
    !/classHours[\s\S]{0,40}\*[\s\S]{0,40}hourRate/.test(dash)
  );
  check(
    'ele le o agregado do dominio',
    dash.includes('aggregateMeasurements(medicoesInternas as any)') &&
      dash.includes('custoInterna.horaAula')
  );
}
console.log('');
if (falhas > 0) { console.log(`❌ ${falhas} check(s) falharam.`); process.exit(1); }
console.log('✅ Todos os checks passaram.');

