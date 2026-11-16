/**
 * SMOKE — valor monetário digitado (parser pt-BR único)
 *
 * Rodar com:  npm run smoke:valor-monetario
 *
 *   [T] A tabela do parecer, entrada a entrada, com o motivo de cada recusa.
 *   [I] O invólucro: parseExpenseValue (número intacto, texto pelo parser) e
 *       lerCampoNumerico (horas / valor HH no caminho numérico de sempre).
 *   [S] O Salvar extraído (prepararItensParaSalvar): value número +
 *       valorDigitado; vazio = rascunho; ilegível e 3+ casas bloqueiam.
 *   [C] O conversor dos Campos manuais: ilegível dá erro, nunca null.
 *   [V] O valor GRAVADO: sem valor / suspeito / ilegível (avisos das superfícies).
 *   [F] Foto antes/depois: nenhum valor gravado como número muda em
 *       superfície nenhuma (scripts/fixtures/valor-monetario-antes.json,
 *       gravada com o código anterior ao parser — commit bd0e1c7).
 *   [G] Guarda de fonte: nenhum replace(',', '.') fora do parser, a não ser
 *       os leitores que NÃO são valor de despesa, listados e justificados.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import { formatarValorParaEdicao, lerCampoNumerico, mensagemValorInvalido, parseMoneyBR } from '../domain/moneyBR';
import { parseExpenseValue } from '../domain/measurementTotals';
import { prepararItensParaSalvar } from '../domain/expenseItemSave';
import { converterCampoManual, converterValorFixo } from '../domain/exports/templates/manualInput';
import {
  avisosDeValor,
  expenseValueStatus,
  listExpenseValueIssues,
  notaItensSemValor,
  summarizeMeasurementsValueIssues,
  textoDeEdicao,
} from '../domain/expenseValueIssues';
import { capturarSuperficies } from './valorMonetarioSuperficies';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);

const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ────────────────────────────────────────────────────────────────────────────
 * [T] A tabela do parecer
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[T] parseMoneyBR — a tabela do parecer, com o motivo de cada recusa');
{
  const ok = (valor: number) => ({ ok: true, valor });
  const nao = (motivo: string) => ({ ok: false, motivo });
  const tabela: [unknown, object][] = [
    ['10', ok(10)],
    ['10,5', ok(10.5)],
    ['10,50', ok(10.5)],
    ['10.50', ok(10.5)],                 // decisão 2: ponto + até 2 casas é decimal
    ['1234,56', ok(1234.56)],
    ['1.234,56', ok(1234.56)],           // o caso do bug: antes 1,234
    ['1,234.56', nao('formatoAmericano')], // decisão 3
    ['1.234', nao('ambiguo')],            // decisão 1
    ['12.345,6', ok(12345.6)],
    ['R$ 10,00', ok(10)],                // decisão 4: antes 0, calado
    ['R$10', ok(10)],
    [' 10,00 ', ok(10)],
    ['10,00 reais', nao('letras')],       // decisão 4
    ['-10,00', nao('negativo')],          // decisão 5
    ['0', ok(0)],
    ['0,00', ok(0)],
    ['', nao('vazio')],                   // decisão 7: rascunho, não erro
    ['abc', nao('letras')],
    [null, nao('vazio')],
    [10.5, ok(10.5)],                     // número já numérico: intacto
  ];
  for (const [entrada, esperado] of tabela) {
    const r = parseMoneyBR(entrada);
    const comparavel = r.ok ? { ok: true, valor: r.valor } : { ok: false, motivo: r.motivo };
    eq(`${JSON.stringify(entrada)}`, comparavel, esperado);
  }
  // Bordas que não estavam na tabela, mas que a regra decide.
  eq('"10,505" → mais de 2 casas (decisão 6)', parseMoneyBR('10,505'), { ok: false, motivo: 'casasDemais' });
  eq('"1,234" → mais de 2 casas (pt-BR: 1 vírgula 234)', parseMoneyBR('1,234'), { ok: false, motivo: 'casasDemais' });
  eq('"1234.567" → mais de 2 casas', parseMoneyBR('1234.567'), { ok: false, motivo: 'casasDemais' });
  eq('"R$ 1.234.567,89" → 1234567,89', parseMoneyBR('R$ 1.234.567,89'), { ok: true, valor: 1234567.89 });
  eq('"R$" sozinho → vazio', parseMoneyBR('R$'), { ok: false, motivo: 'vazio' });
  eq('espaço inseparável nas pontas (colado de planilha)', parseMoneyBR(' 10,00 '), { ok: true, valor: 10 });
  eq('espaço NO MEIO → ilegível', parseMoneyBR('1 234,56'), { ok: false, motivo: 'ilegivel' });
  eq('",50" → ilegível (pede 0,50)', parseMoneyBR(',50'), { ok: false, motivo: 'ilegivel' });
  eq('NaN → ilegível', parseMoneyBR(NaN), { ok: false, motivo: 'ilegivel' });
  check('valor EXATO: "1.234,56" é o mesmo número que 1234.56 (sem arredondar)', (parseMoneyBR('1.234,56') as any).valor === 1234.56);
  check('valor EXATO: "151,97" === 151.97', (parseMoneyBR('151,97') as any).valor === 151.97);

  eq('mensagem do campo (base)', mensagemValorInvalido('letras'), 'Valor não reconhecido — use 1.234,56');
  eq('mensagem do ambíguo pede 1.234,00 (decisão 1)', mensagemValorInvalido('ambiguo'), 'Valor ambíguo — para milhar, use 1.234,00');
  eq('mensagem do americano', mensagemValorInvalido('formatoAmericano'), 'Valor não reconhecido — use 1.234,56');

  // Exibição do número salvo sem perder casas: ida e volta exata; 3+ casas falha.
  eq('1234.56 → "1234,56"', formatarValorParaEdicao(1234.56), '1234,56');
  eq('1.234 → "1,234" (falha na validação em vez de arredondar)', [formatarValorParaEdicao(1.234), parseMoneyBR(formatarValorParaEdicao(1.234)).ok], ['1,234', false]);
  eq('inteiro sem separador de milhar (1234 → "1234", não o ambíguo "1.234")', formatarValorParaEdicao(1234), '1234');
  for (const v of [0, 0.5, 10.5, 46.95, 151.97, 1234.56, 99999.99]) {
    check(`ida e volta exata: ${v}`, (parseMoneyBR(formatarValorParaEdicao(v)) as any).valor === v);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [I] Invólucro e caminho numérico
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[I] parseExpenseValue (invólucro) e lerCampoNumerico (horas / valor HH)');
{
  eq('texto "1.234,56" → 1234,56 (a leitura antiga dava 1,234)', parseExpenseValue('1.234,56'), 1234.56);
  eq('texto "R$ 10,00" → 10 (a antiga dava 0)', parseExpenseValue('R$ 10,00'), 10);
  eq('número com 3 casas passa INTACTO (gravado não muda)', parseExpenseValue(1.234), 1.234);
  eq('número 10.505 intacto', parseExpenseValue(10.505), 10.505);
  eq('número 0 intacto', parseExpenseValue(0), 0);
  eq('texto recusado soma 0 (o aviso sai por outro canal)', [parseExpenseValue('1.234'), parseExpenseValue('abc'), parseExpenseValue('')], [0, 0, 0]);
  eq('null / undefined → 0', [parseExpenseValue(null), parseExpenseValue(undefined)], [0, 0]);
  eq('NaN → 0', parseExpenseValue(NaN), 0);

  eq('horas: número intacto', [lerCampoNumerico(16), lerCampoNumerico(7.333), lerCampoNumerico(0)], [16, 7.333, 0]);
  eq('horas em texto: a leitura de sempre ("7.333" é 7,333 h — NÃO recusada como ambígua)', lerCampoNumerico('7.333'), 7.333);
  eq('horas em texto com vírgula', lerCampoNumerico('7,5'), 7.5);
  eq('horas ilegíveis → 0, como sempre', lerCampoNumerico('abc'), 0);

  const totais = semComentarios(ler('domain/measurementTotals.ts'));
  // classHours×hourRate (2), carga padrão (1), v1 horas/valorHH (2), v2 horas/horasRateio/valorHH (3).
  check('horas/HH em measurementTotals passam por lerCampoNumerico (8 leituras)', (totais.match(/lerCampoNumerico\(/g) ?? []).length === 8);
  check('e nenhuma hora passa por parseExpenseValue', !/parseExpenseValue\([^)]*(classHours|hourRate|horas|valorHH|horasRateio)/.test(totais));
  check('parseExpenseValue chama parseMoneyBR', /export function parseExpenseValue[\s\S]{0,200}parseMoneyBR\(v\)/.test(totais));
  check('dataset Medições lê classHours pelo caminho numérico', ler('domain/exports/datasets/medicoes.ts').includes('lerCampoNumerico(m.expenses?.classHours)'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [S] O Salvar extraído
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[S] prepararItensParaSalvar — o Salvar do Painel de Medição');
{
  const antigo = { id: 'n', category: 'HOSPEDAGEM', value: 200 };
  const antigoComDigitado = { id: 'nd', category: 'HOSPEDAGEM', value: 300, valorDigitado: '300,00' };
  const digitado = { id: 'd', category: 'LOCOMOCAO', value: '1.234,56' };
  const comReal = { id: 'r', category: 'ALMOCO', value: 'R$ 45,90' };
  const vazio = { id: 'v', category: 'JANTAR', value: '', valorDigitado: '30,00' };
  const nulo = { id: 'z', category: 'CAFE', value: null };
  const ok = prepararItensParaSalvar([antigo, antigoComDigitado, digitado, comReal, vazio, nulo] as any[]);
  check('sem ilegível: salva', ok.ok === true);
  const it = ok.itens ?? [];
  check('número que ninguém editou passa INTACTO (mesmo objeto)', it[0] === antigo);
  check('e mantém o valorDigitado de um salvar anterior', it[1] === antigoComDigitado);
  eq('"1.234,56" grava value 1234.56 (número) e valorDigitado com o texto', [it[2].value, (it[2] as any).valorDigitado], [1234.56, '1.234,56']);
  eq('"R$ 45,90" grava 45.9 e o texto', [it[3].value, (it[3] as any).valorDigitado], [45.9, 'R$ 45,90']);
  eq('vazio = rascunho: value 0, sem valorDigitado (o antigo sai)', [it[4].value, 'valorDigitado' in it[4]], [0, false]);
  eq('null fica null (intacto)', it[5].value, null);

  const bloqueado = prepararItensParaSalvar([antigo, { id: 'a', category: 'LOCOMOCAO', value: '1.234' }, { id: 'b', category: 'ALMOCO', value: '10,00 reais', instructorId: 'INS-2' }] as any[]);
  check('ilegível BLOQUEIA o salvar (decisão 8)', bloqueado.ok === false);
  eq('e lista os itens com motivo e mensagem', (bloqueado.invalidos ?? []).map(i => [i.id, i.categoria, i.texto, i.motivo, i.instructorId]), [
    ['a', 'LOCOMOCAO', '1.234', 'ambiguo', null],
    ['b', 'ALMOCO', '10,00 reais', 'letras', 'INS-2'],
  ]);
  eq('mensagem do ambíguo na lista', bloqueado.invalidos?.[0].mensagem, 'Valor ambíguo — para milhar, use 1.234,00');

  const suspeito = prepararItensParaSalvar([{ id: 's', category: 'ALMOCO', value: 1.234 }] as any[]);
  eq('número GRAVADO com 3+ casas falha na validação (não é arredondado)', [suspeito.ok, suspeito.invalidos?.[0].texto, suspeito.invalidos?.[0].motivo], [false, '1,234', 'casasDemais']);

  const painel = semComentarios(ler('components/Measurement.tsx'));
  check('o Salvar do painel usa o helper do domínio', painel.includes('prepararItensParaSalvar(selectedMeasurement.attachments)') && painel.includes('attachments: preparo.itens'));
  check('e bloqueia antes de gravar quando há ilegível', /if \(preparo\.ok === false\) \{[\s\S]{0,400}return;/.test(painel));
  check('o campo do item mostra o número sem perder casas', ler('components/measurement/ExpenseItemRow.tsx').includes('const textoValor = textoDeEdicao(a.value);'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [C] Campos manuais
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[C] converterCampoManual — Campos manuais da Medição Vale / BM');
{
  const moeda = { format: 'currency' as const };
  const pct = { format: 'percent' as const };
  const texto = { format: 'text' as const };
  eq('preço "1.234,56" → 1234.56 (antes: null, que APAGAVA o salvo)', converterCampoManual(moeda, '1.234,56'), { ok: true, value: 1234.56 });
  eq('combustível "R$ 45" → 45 (antes: null → caía em 0)', converterCampoManual(moeda, 'R$ 45'), { ok: true, value: 45 });
  eq('% "20" → 0.2', converterCampoManual(pct, '20'), { ok: true, value: 0.2 });
  eq('% "12,5" → 0.125', converterCampoManual(pct, '12,5'), { ok: true, value: 0.125 });
  // Percentual aceita "%" no fim (16/11/2026); "R$" num percentual é erro.
  eq('% "20%" → 0.2 (antes: null → apagava e caía em 20% calado)', converterCampoManual(pct, '20%'), { ok: true, value: 0.2 });
  eq('% "20 %" → 0.2', converterCampoManual(pct, '20 %'), { ok: true, value: 0.2 });
  eq('% "12,5%" → 0.125', converterCampoManual(pct, '12,5%'), { ok: true, value: 0.125 });
  eq('% "R$ 20" → erro (R$ não é percentual)', converterCampoManual(pct, 'R$ 20').ok, false);
  eq('% "20%%" → erro', converterCampoManual(pct, '20%%').ok, false);
  eq('% "%" sozinho → erro, nunca null', [converterCampoManual(pct, '%').ok, converterCampoManual(pct, '%').value], [false, undefined]);
  // Os demais formatos continuam recusando o símbolo.
  eq('moeda "20%" → erro (símbolo recusado fora do percentual)', converterCampoManual(moeda, '20%').ok, false);
  eq('inteiro "20%" → erro', converterCampoManual({ format: 'integer' }, '20%').ok, false);
  eq('inteiro "1.000" → ambíguo (antes virava 1 calado)', converterCampoManual({ format: 'integer' }, '1.000').motivo, 'ambiguo');
  // Horas não são dinheiro: 7,333 (7h20) é legítimo.
  const horas = { format: 'hours' as const };
  eq('horas "7,333" → 7.333 (não recusa 3 casas)', converterCampoManual(horas, '7,333'), { ok: true, value: 7.333 });
  eq('horas "7.333" → 7.333 (não é milhar)', converterCampoManual(horas, '7.333'), { ok: true, value: 7.333 });
  eq('horas "8" e "7,5"', [converterCampoManual(horas, '8').value, converterCampoManual(horas, '7,5').value], [8, 7.5]);
  eq('horas "abc" / "-2" / "7h" → erro com mensagem de horas, nunca 0',
    ['abc', '-2', '7h'].map(x => converterCampoManual(horas, x)).map(c => [c.ok, c.mensagem]),
    [[false, 'Horas não reconhecidas — use 7,5 ou 7,333'], [false, 'Horas não reconhecidas — use 7,5 ou 7,333'], [false, 'Horas não reconhecidas — use 7,5 ou 7,333']]);
  const amb = converterCampoManual(moeda, '1.234');
  eq('"1.234" ambíguo → erro com a mensagem', [amb.ok, amb.mensagem], [false, 'Valor ambíguo — para milhar, use 1.234,00']);
  eq('"abc" → erro', converterCampoManual(moeda, 'abc').ok, false);
  eq('em branco → null (limpar de propósito continua apagando)', converterCampoManual(moeda, '   '), { ok: true, value: null });
  eq('texto → como digitado', converterCampoManual(texto, ' Turma extra '), { ok: true, value: ' Turma extra ' });

  // Valor fixo do modelo por empresa (ModeloMapeamento) — vai para a medição do cliente.
  const fixos: [string, unknown][] = [
    ['20%', { ok: true, valor: 0.2 }],
    ['12,5 %', { ok: true, valor: 0.125 }],
    ['1.234,56', { ok: true, valor: 1234.56 }],          // antes: texto
    ['R$ 10,00', { ok: true, valor: 10 }],               // antes: texto
    ['5900123435', { ok: true, valor: 5900123435 }],     // número do contrato: número, como antes
    ['Contrato 4600/2026', { ok: true, valor: 'Contrato 4600/2026' }],
    ['4600012345/2026', { ok: true, valor: '4600012345/2026' }],
    ['1.234', { ok: false, mensagem: 'Valor ambíguo — para milhar, use 1.234,00' }], // antes: 1,234 calado
    ['1,234.56', { ok: false, mensagem: 'Valor não reconhecido — use 1.234,56' }],
    ['-5', { ok: false, mensagem: 'Valor negativo não é aceito — use 1.234,56' }],
    ['10,505', { ok: false, mensagem: 'Mais de 2 casas decimais — use 1.234,56' }],
    ['R$ 20%', { ok: false, mensagem: 'Percentual não reconhecido — use 20 ou 20%' }],
  ];
  for (const [entrada, esperado] of fixos) eq(`valor fixo do modelo ${JSON.stringify(entrada)}`, converterValorFixo(entrada), esperado);
  const modelo = semComentarios(ler('components/exportacoes/modelos/ModeloMapeamento.tsx'));
  check('ModeloMapeamento converte o valor fixo pelo domínio e mostra o erro (a constante não entra)',
    modelo.includes('const conv = converterValorFixo(novaConst.valor);') && /if \(conv\.ok === false\) \{\s*setErroConst\(conv\.mensagem\);\s*return;/.test(modelo));

  const grade = semComentarios(ler('components/exportacoes/GradeEditavel.tsx'));
  check('a grade converte pelo domínio', grade.includes('converterCampoManual(col, raw)'));
  check('ilegível: erro no campo e NENHUMA edição (onErro + return antes de onEdit)', /if \(c\.ok === false\) \{\s*onErro\?\.\(chave, \{ raw, mensagem: c\.mensagem \}\);\s*return;/.test(grade));
  check('nenhum onBlur chama onEdit direto (todos passam por aoSair)', !/onBlur=\{e => onEdit\(/.test(grade));
  const tela = semComentarios(ler('components/exportacoes/MedicaoTemplateView.tsx'));
  check('Gerar travado com campo em erro', /const podeGerar = !temPendente && !temErroCampo/.test(tela));
  check('Salvar travado com campo em erro', tela.includes('if (!temPendente || temErroCampo) return;'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [V] O valor gravado: avisos
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[V] expenseValueStatus / listExpenseValueIssues — o que as superfícies avisam');
{
  const notinhaZero = { id: 'f0', category: 'HOSPEDAGEM', value: 0, url: 'https://s/h.pdf', type: 'application/pdf' };
  const avulsoZero = { id: 'v0', category: 'ALMOCO', value: 0, url: '#', type: 'text/plain' };
  const zeroDigitado = { id: 'd0', category: 'ALMOCO', value: 0, url: '#', type: 'text/plain', valorDigitado: '0,00' };
  const semChave = { id: 'sc', category: 'LOCOMOCAO', url: 'https://s/t.jpg' };
  const tresCasas = { id: 't3', category: 'ALMOCO', value: 1.234 };
  const negativo = { id: 'ng', category: 'JANTAR', value: -10 };
  const textoRuim = { id: 'tx', category: 'OUTROS', value: 'abc', otherId: 'O1' };
  const orfao = { id: 'or', category: 'OUTROS', value: 0, otherId: 'ZZ' };
  const bom = { id: 'b', category: 'LOCOMOCAO', value: 151.97 };
  eq('status', [notinhaZero, avulsoZero, zeroDigitado, semChave, tresCasas, negativo, textoRuim, bom].map(a => expenseValueStatus(a as any)),
    ['semValor', 'semValor', 'ok', 'semValor', 'suspeito', 'suspeito', 'ilegivel', 'ok']);
  eq('texto de edição: número gravado sem perder casas', [textoDeEdicao(1.234), textoDeEdicao(1234.56), textoDeEdicao(null)], ['1,234', '1234,56', '']);

  const m = { otherExpenses: [{ id: 'O1' }], attachments: [notinhaZero, avulsoZero, zeroDigitado, semChave, tresCasas, negativo, textoRuim, orfao, bom] };
  const issues = listExpenseValueIssues(m as any);
  eq('itens com aviso (órfão de Outros fora — nenhuma superfície o soma)', issues.map(i => `${i.itemId}:${i.status}:${i.temArquivo ? 'arquivo' : 'avulso'}`),
    ['f0:semValor:arquivo', 'v0:semValor:avulso', 'sc:semValor:arquivo', 't3:suspeito:avulso', 'ng:suspeito:avulso', 'tx:ilegivel:avulso']);
  // Almoço (1,234) e Jantar (-10) são os dois Alimentação: um aviso, os dois valores no detalhe.
  eq('avisos da Alimentação', avisosDeValor(issues.filter(i => i.bucket === 'alimentacao'), 'Alimentação'), [
    { texto: 'Lançamento sem valor em Alimentação', detalhe: '1 item' },
    { texto: 'Valor suspeito em Alimentação', detalhe: '1,234 — 3+ casas decimais; -10 — negativo' },
  ]);
  eq('aviso do ilegível', avisosDeValor(issues.filter(i => i.status === 'ilegivel'), 'Outros'), [{ texto: 'Valor ilegível em Outros — fora da soma', detalhe: '"abc"' }]);
  const resumo = summarizeMeasurementsValueIssues([m as any]);
  eq('nota do Dashboard: fora da soma = sem valor + ilegível (suspeito soma)', [resumo.semValor, resumo.suspeitos, resumo.ilegiveis, resumo.foraDaSoma], [3, 2, 1, 4]);
  eq('texto da nota', [notaItensSemValor(1), notaItensSemValor(4)], ['1 item sem valor fora da soma', '4 itens sem valor fora da soma']);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [F] Foto antes/depois
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[F] Nenhum valor gravado como número muda — foto antes (bd0e1c7) × agora');
{
  const antes = JSON.parse(ler('scripts/fixtures/valor-monetario-antes.json'));
  const agora = JSON.parse(JSON.stringify(capturarSuperficies()));
  const dif: string[] = [];
  // Compara só o que a foto ANTES tem: campo novo (avisos, destaques) não é mudança de número.
  const cmp = (a: any, b: any, p: string) => {
    if (a && typeof a === 'object') { for (const k of Object.keys(a)) cmp(a[k], b?.[k], `${p}.${k}`); return; }
    if (!Object.is(a, b)) dif.push(`${p}: antes ${JSON.stringify(a)}, agora ${JSON.stringify(b)}`);
  };
  cmp(antes, agora, '');
  for (const sup of Object.keys(antes)) {
    const doSup = dif.filter(d => d.startsWith(`.${sup}`));
    check(`superfície ${sup} igual`, doSup.length === 0, doSup.slice(0, 3).join(' | '));
  }
  check('a foto cobre painel, quebras, cliente, Dashboard, Vale, BM, pagamento e datasets',
    ['painel:DEM-2001', 'quebra:DEM-2001', 'cliente:DEM-2001', 'dashboardAgregado', 'dashboardQuebra', 'dashboardNaoReembolsaveis', 'medicaoVale', 'bm', 'pagamento', 'datasetDespesas', 'datasetMedicoes']
      .every(k => k in antes));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [G] Guarda de fonte
 * ────────────────────────────────────────────────────────────────────────── */
console.log("\n[G] Nenhum replace(',', '.') fora do parser");
{
  /**
   * Os ÚNICOS replace(',', '.') permitidos no app, cada um com o motivo. Não
   * leem valor de item de despesa nem Campo manual:
   */
  const PERMITIDOS: Record<string, { n: number; motivo: string; linha: RegExp }> = {
    'domain/moneyBR.ts': { n: 1, motivo: 'lerCampoNumerico — horas / valor HH (type="number"), a leitura de sempre', linha: /const n = parseFloat\(v\.replace\(',', '\.'\)\);/ },
    'components/Dashboard.tsx': { n: 1, motivo: 'KPICard.toNum — texto de KPI já formatado ("R$ 1.234,56", "85%", "12h"), tira os pontos antes', linha: /replace\(\/\[R\$\\s\.\]\/g, ''\)\.replace\(',', '\.'\)/ },
    'utils/exportPDF.ts': { n: 1, motivo: 'toNum do relatório — o mesmo texto de KPI', linha: /replace\(',', '\.'\)/ },
    'utils/exportXLSX.ts': { n: 1, motivo: 'toNum do relatório — o mesmo texto de KPI', linha: /replace\(',', '\.'\)/ },
    'App.tsx': { n: 1, motivo: 'cleanNumberOrNull — horas_previstas da demanda (horas)', linha: /replace\(',', '\.'\)/ },
    'components/InternalDemands.tsx': { n: 1, motivo: 'horasPrevistas da interna (horas)', linha: /replace\(',', '\.'\)/ },
  };
  const listar = (dir: string): string[] => {
    const abs = path.join(raiz, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs).flatMap(f => {
      const rel = `${dir}/${f}`;
      return fs.statSync(path.join(raiz, rel)).isDirectory() ? listar(rel) : /\.(ts|tsx)$/.test(f) ? [rel] : [];
    });
  };
  const arquivos = ['App.tsx', ...['components', 'domain', 'services', 'utils', 'hooks', 'contexts'].flatMap(listar)];
  const achados = new Map<string, number>();
  for (const f of arquivos) {
    const n = (semComentarios(ler(f)).match(/replace\(\s*['"],['"]\s*,\s*['"]\.['"]\s*\)/g) ?? []).length;
    if (n > 0) achados.set(f, n);
  }
  for (const [f, n] of achados) {
    const p = PERMITIDOS[f];
    check(`${f}: ${p ? `permitido (${p.motivo})` : 'NÃO permitido — use parseMoneyBR / parseExpenseValue'}`, !!p && p.n === n, `achei ${n}`);
    if (p) check(`${f}: é o leitor permitido, não uma cópia nova`, p.linha.test(semComentarios(ler(f))));
  }
  check('valor fixo do modelo por empresa NÃO está mais na lista (passa pelo parseMoneyBR)', !achados.has('components/exportacoes/modelos/ModeloMapeamento.tsx'));
  check('as 12 cópias da leitura de item sumiram (Painel, Dashboard, Campos manuais)',
    !achados.has('components/Measurement.tsx') && !achados.has('components/exportacoes/GradeEditavel.tsx') && achados.get('components/Dashboard.tsx') === 1);
  check('parseFloat sobre valor de item não voltou ao Dashboard', !/parseFloat\(\s*(v|a\.value)\.replace/.test(semComentarios(ler('components/Dashboard.tsx'))));
  check('moneyBR.ts não importa nada', !/^import /m.test(ler('domain/moneyBR.ts')));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [P] Gravação da medição: falha visível, sem estado otimista, sem sobrescrever
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[P] Gravação da medição — todos os pontos que gravam');
{
  const app = semComentarios(ler('App.tsx'));
  const corpo = app.slice(app.indexOf('const updateMeasurement = useCallback'), app.indexOf('const addInstructor = useCallback'));
  check('updateMeasurement REJEITA quando o upsert falha (não só console.error)', /if \(error \|\| !data\) \{[\s\S]{0,200}throw new Error\(/.test(corpo));
  check('sem atualização otimista: a lista só muda DEPOIS do upsert', corpo.indexOf('await upsertMeasurementByDemandId') > -1
    && corpo.indexOf('setMeasurements(prev => {') > corpo.indexOf('await upsertMeasurementByDemandId'));
  check('o tipo no contexto é Promise<void>', app.includes('updateMeasurement: (m: Measurement) => Promise<void>;'));

  // Os chamadores. O único que grava a medição INTEIRA é o Painel (inclui a troca de etapa, que é o select do modal).
  const listar = (dir: string): string[] => fs.readdirSync(path.join(raiz, dir)).flatMap(f => {
    const rel = `${dir}/${f}`;
    return fs.statSync(path.join(raiz, rel)).isDirectory() ? listar(rel) : /\.(ts|tsx)$/.test(f) ? [rel] : [];
  });
  const fontes = ['App.tsx', ...['components', 'hooks', 'contexts'].flatMap(listar)];
  const chamadores = fontes.filter(f => /updateMeasurement\(/.test(semComentarios(ler(f))));
  eq('updateMeasurement( só é chamado pelo Painel de Medição', chamadores, ['components/Measurement.tsx']);
  const painel = semComentarios(ler('components/Measurement.tsx'));
  check('o Painel aguarda dentro de try/catch e mostra o erro (sem rejeição não tratada)',
    /try \{\s*await updateMeasurement\(cleaned\);\s*\} catch \(e\) \{[\s\S]{0,300}setErroSalvarMedicao\([\s\S]{0,200}setNotification\(\{[\s\S]{0,120}type: 'error'[\s\S]{0,60}return;/.test(painel));

  // "Garantir medição" no salvar da demanda (cliente e interna): só cria se faltar, e avisa a falha.
  const svc = semComentarios(ler('services/measurements.ts'));
  check('ensureMeasurementForDemand é ON CONFLICT DO NOTHING (ignoreDuplicates)', /export async function ensureMeasurementForDemand[\s\S]{0,600}ignoreDuplicates: true/.test(svc));
  const diretos = fontes.filter(f => /upsertMeasurementByDemandId\(/.test(semComentarios(ler(f))));
  eq('o upsert que SOBRESCREVE só é chamado pelo updateMeasurement (App)', diretos, ['App.tsx']);
  for (const f of ['components/Demands.tsx', 'components/InternalDemands.tsx']) {
    const src = semComentarios(ler(f));
    check(`${f}: garante a medição sem sobrescrever e mostra a falha`,
      /await ensureMeasurementForDemand\(demandId\);\s*if \(error\) throw new Error\(error\.message\);\s*\} catch \(e: any\) \{[\s\S]{0,120}setNotification\(\{\s*type: 'error'/.test(src));
  }
}

console.log(falhas === 0 ? '\n✅ SMOKE VALOR MONETARIO: OK' : `\n❌ SMOKE VALOR MONETARIO: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
