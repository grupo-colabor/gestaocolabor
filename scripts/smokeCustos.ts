/**
 * SMOKE — Totais de medicao, flag nao reembolsavel e custo de interna
 *
 * Rodar com:  npm run smoke:custos
 *
 * Cobre as duas features de custo:
 *  A) o card "Custo das Demandas Internas" (Hora/Aula + Despesas)
 *  B) a flag `reembolsavel` por item de despesa
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
  isNaoReembolsavel,
  parseExpenseValue,
} from '../domain/measurementTotals';

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

console.log('');
if (falhas > 0) { console.log(`❌ ${falhas} check(s) falharam.`); process.exit(1); }
console.log('✅ Todos os checks passaram.');

