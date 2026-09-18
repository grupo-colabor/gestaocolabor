/**
 * SMOKE — Modelos de medição por empresa, Fases 1 e 2
 *
 * Rodar com:  npm run smoke:modelos-medicao
 *
 *   [F] Fórmula por seleção: as DUAS fórmulas da Vale reproduzidas CARACTERE A
 *       CARACTERE pelo compilador (o critério de aceite da Fase 1); reordenar
 *       colunas muda as letras e não o significado; validação nunca lança.
 *   [C] Constantes: `{const:}` vira literal (número, texto, booleano);
 *       `source: 'constant'` e `'blank'` nas colunas.
 *   [R] Modo tolerante: template do banco com campo extinto, conta sobre
 *       coluna removida e total órfão vira problema em português, célula em
 *       branco, geração bloqueada; o MESMO defeito em template de código
 *       continua lançando.
 *   [M] Mapeamento: jsonb -> template -> jsonb; config ilegível vira avisos,
 *       nunca exceção; rótulo do módulo vem da EMPRESA.
 *   [I] Inspeção (pura): título mesclado + linha vazia -> cabeçalho na 3;
 *       vale.xlsx real -> cabeçalho na 1.
 *   [A] Arquivo (I/O): .xls antigo recusado citando ".xlsx"; PDF recusado;
 *       aba oculta e protegida detectadas; fotografia do vale.xlsx real.
 *   [E] Guarda de fonte: os arquivos novos de domain/exports/templates
 *       continuam sem React, services, Supabase e ExcelJS.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import { VALE_TEMPLATE, VALE_TURMAS_COLUMNS } from '../domain/exports/templates/vale';
import {
  compileFormulaSpec,
  describeFormulaSpec,
  formulaLiteral,
  formulaRefs,
  parseFormulaSpec,
  validateFormulaSpec,
  type FormulaSpec,
} from '../domain/exports/templates/formula';
import {
  createProblemSink,
  resolveColumns,
  resolveFormula,
  resolveRowsSheet,
  resolveTemplate,
  resolveTemplateWithProblems,
} from '../domain/exports/templates/resolve';
import { emptyTemplateValuesIndex } from '../domain/exports/templates/values';
import {
  buildTemplateMapping,
  fileNameBaseOf,
  parseTemplateMapping,
  templateFromRecord,
  templateIdOf,
  type TemplateMapping,
  type TemplateRecord,
} from '../domain/exports/templates/mapping';
import { SOURCE_FIELDS } from '../domain/exports/templates/sourceFields';
import type { TemplateRowInput } from '../domain/exports/templates/sourceFields';
import type { MeasurementTemplate, TemplateSheet } from '../domain/exports/templates/types';
import { suggestHeader, suggestSheet, type SheetSnapshot } from '../domain/exports/templates/inspect';

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
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const linha = (over: Partial<TemplateRowInput> = {}): TemplateRowInput => ({
  demandId: 'DEM-100', clientDemandId: 'SAP-1', companyName: 'Cliente X', trainingId: 'T1',
  trainingName: 'NR 35', cargaHoraria: 16, local: 'Itabira', corredor: 'Sudeste', uf: 'MG',
  dataInicio: '2026-08-10', horarioInicio: '08:00', nDias: 2, statusCalculado: 'CONCLUIDA',
  titulares: ['Titular'], despesas: { locomocao: 80, alimentacao: 50, hospedagem: 200, outros: 30, total: 360 },
  medicaoStatus: 'PRONTA_FATURAMENTO', temMedicao: true, ...over,
});
const refs = (demandId: string, trainingId = 'T1') => ({ demandId, trainingId });
const umaLinha = [{ input: linha(), refs: refs('DEM-100') }];

/* ────────────────────────────────────────────────────────────────────────────
 * [F] Fórmula por seleção — o critério de aceite da Fase 1
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[F] Fórmula por seleção — as duas contas da Vale, caractere a caractere');
{
  const valorTotal = VALE_TURMAS_COLUMNS.find(c => c.key === 'valorTotal')!;
  const totalDespesas = VALE_TURMAS_COLUMNS.find(c => c.key === 'valorTotalDespesas')!;

  const specValorTotal: FormulaSpec = {
    op: 'multiplicar',
    a: { coluna: 'cargaHoraria' },
    b: { coluna: 'precoHH' },
  };
  const specDespesas: FormulaSpec = {
    op: 'somarComPercentual',
    de: 'locacao',
    ate: 'outros',
    pct: { coluna: 'pctDespesa' },
  };

  eq('valor total: compilado == o que vale.ts escreve à mão', compileFormulaSpec(specValorTotal), valorTotal.formula);
  eq('total de despesas: compilado == o que vale.ts escreve à mão', compileFormulaSpec(specDespesas), totalDespesas.formula);

  // E o texto compilado percorre o resolvedor produzindo as MESMAS letras.
  const turmas = VALE_TEMPLATE.sheets[0];
  const cols = resolveColumns(turmas);
  eq('valor total compilado -> I = G2*H2', resolveFormula(compileFormulaSpec(specValorTotal), cols, { row: 2 }), 'G2*H2');
  eq('despesas compilado -> P = SUM(J3:N3)+(SUM(J3:N3)*O3)',
    resolveFormula(compileFormulaSpec(specDespesas), cols, { row: 3 }),
    'SUM(J3:N3)+(SUM(J3:N3)*O3)');

  eq('subtrair', compileFormulaSpec({ op: 'subtrair', a: { coluna: 'a' }, b: { coluna: 'b' } }), '={col:a}{row}-{col:b}{row}');
  eq('somar intervalo', compileFormulaSpec({ op: 'somarIntervalo', de: 'j', ate: 'n' }), '=SUM({col:j}{row}:{col:n}{row})');
  eq('somar constante', compileFormulaSpec({ op: 'somarConstante', a: { coluna: 'a' }, constante: 'taxa' }), '={col:a}{row}+{const:taxa}');
  eq('operando constante no lugar de coluna',
    compileFormulaSpec({ op: 'multiplicar', a: { coluna: 'h' }, b: { constante: 'preco' } }),
    '={col:h}{row}*{const:preco}');

  eq('descrição em português usa os rótulos', describeFormulaSpec(specValorTotal, {
    coluna: k => ({ cargaHoraria: 'Carga horária', precoHH: 'Preço unitário HH' })[k],
  }), 'Carga horária × Preço unitário HH');
  eq('descrição sem rótulo cai na chave', describeFormulaSpec(specValorTotal), 'cargaHoraria × precoHH');

  eq('refs da spec: o percentual é coluna, e conta como coluna',
    formulaRefs(specDespesas), { colunas: ['locacao', 'outros', 'pctDespesa'], constantes: [] });
  eq('refs da spec: percentual vindo de constante cai em constantes',
    formulaRefs({ op: 'somarComPercentual', de: 'j', ate: 'n', pct: { constante: 'pct' } }),
    { colunas: ['j', 'n'], constantes: ['pct'] });

  // Ida e volta pelo jsonb.
  eq('parse(JSON(spec)) == spec', parseFormulaSpec(JSON.parse(JSON.stringify(specDespesas))), specDespesas);
  eq('jsonb torto -> null, sem lançar', parseFormulaSpec({ op: 'multiplicar', a: { coluna: 'x' } }), null);
  eq('operação inventada -> null', parseFormulaSpec({ op: 'exponenciar', a: 1 }), null);
  eq('nulo -> null', parseFormulaSpec(null), null);

  // Validação NUNCA lança; devolve português.
  const escopo = { colunas: ['cargaHoraria', 'precoHH', 'locacao', 'outros', 'pctDespesa'], constantes: ['taxa'] };
  eq('spec boa não tem problema', validateFormulaSpec(specValorTotal, escopo), []);
  const semColuna = validateFormulaSpec({ op: 'multiplicar', a: { coluna: 'cargaHoraria' }, b: { coluna: 'sumiu' } }, escopo, 'Valor total');
  check('coluna removida vira texto em português', semColuna.length === 1 && semColuna[0].includes('«sumiu»') && semColuna[0].includes('Valor total'), JSON.stringify(semColuna));
  const semConst = validateFormulaSpec({ op: 'somarConstante', a: { coluna: 'locacao' }, constante: 'inexistente' }, escopo);
  check('valor fixo não declarado vira texto', semConst.length === 1 && semConst[0].includes('«inexistente»'), JSON.stringify(semConst));
  const invertido = validateFormulaSpec({ op: 'somarIntervalo', de: 'outros', ate: 'locacao' }, escopo, 'Total');
  check('intervalo invertido é avisado', invertido.length === 1 && invertido[0].includes('inverta'), JSON.stringify(invertido));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [C] Constantes e as origens novas
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[C] Constantes na fórmula e nas colunas');
{
  eq('literal: número com ponto decimal', formulaLiteral(0.2), '0.2');
  eq('literal: booleano', [formulaLiteral(true), formulaLiteral(false)], ['TRUE', 'FALSE']);
  eq('literal: texto entre aspas', formulaLiteral('Colabor'), '"Colabor"');
  eq('literal: aspas internas dobradas', formulaLiteral('diz "oi"'), '"diz ""oi"""');

  const sheet: TemplateSheet = {
    name: 'T', kind: 'rows', headerRow: 1, firstDataRow: 2,
    columns: [
      { key: 'h', header: 'Carga', source: 'demand.cargaHoraria', format: 'hours' },
      { key: 'fixo', header: 'Contrato', source: 'constant', constantName: 'contrato', format: 'text' },
      { key: 'nada', header: 'Reservado', source: 'blank', format: 'text' },
      { key: 'v', header: 'Valor', source: 'formula', formula: '={col:h}{row}*{const:preco}', format: 'currency' },
    ],
  };
  const constants = { contrato: '4600012345', preco: 150 };
  const r = resolveRowsSheet(sheet, umaLinha, emptyTemplateValuesIndex(), { constants });

  eq('coluna constante emite o valor do modelo', r.rows[0][1].value, '4600012345');
  eq('coluna em branco sai vazia', r.rows[0][2].value, null);
  eq('{const:} vira literal dentro da fórmula', r.rows[0][3].formula, 'A2*150');

  // Constante em coluna sem `constantName` cai na própria chave.
  const porChave: TemplateSheet = {
    ...sheet,
    columns: [{ key: 'contrato', header: 'Contrato', source: 'constant', format: 'text' }],
  };
  eq('constante sem constantName usa a chave da coluna',
    resolveRowsSheet(porChave, umaLinha, emptyTemplateValuesIndex(), { constants }).rows[0][0].value,
    '4600012345');

  // Em template de código, constante que não existe LANÇA.
  let lancou = false;
  try {
    resolveRowsSheet(porChave, umaLinha, emptyTemplateValuesIndex(), { constants: {} });
  } catch { lancou = true; }
  check('constante desconhecida sem coletor é erro (código)', lancou);

  lancou = false;
  try { resolveFormula('={const:naoExiste}', resolveColumns(sheet), { row: 2, constants }); } catch { lancou = true; }
  check('{const:} desconhecido em resolveFormula é erro', lancou);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [R] Modo tolerante — banco coleta, código lança
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[R] Modo tolerante para template do banco');
{
  const quebrado: TemplateSheet = {
    name: 'Turmas', kind: 'rows', headerRow: 1, firstDataRow: 2,
    columns: [
      { key: 'trein', header: 'Treinamento', source: 'demand.inexistente' as any, format: 'text' },
      { key: 'h', header: 'Carga horária', source: 'demand.cargaHoraria', format: 'hours' },
      { key: 'v', header: 'Valor total', source: 'formula', formula: '={col:h}{row}*{col:precoQueSumiu}{row}', format: 'currency' },
      { key: 'x', header: 'Sem conta', source: 'formula', format: 'currency' },
    ],
    totals: { sumColumns: ['h', 'colunaOrfa'] },
  };

  // (a) CÓDIGO: lança, como sempre lançou.
  let lancou = false;
  try { resolveRowsSheet(quebrado, umaLinha, emptyTemplateValuesIndex()); } catch { lancou = true; }
  check('template de código: campo extinto continua lançando', lancou);

  // (b) BANCO: coleta.
  const sink = createProblemSink();
  const r = resolveRowsSheet(quebrado, umaLinha, emptyTemplateValuesIndex(), { problems: sink });
  const problemas = sink.list();

  check('campo extinto vira problema em português',
    problemas.some(p => p.texto.includes('«Treinamento»') && p.texto.includes('não existe mais no sistema')),
    JSON.stringify(problemas.map(p => p.texto)));
  check('conta sobre coluna removida vira problema',
    problemas.some(p => p.texto.includes('«Valor total»') && p.texto.includes('«precoQueSumiu»')),
    JSON.stringify(problemas.map(p => p.texto)));
  check('coluna calculada sem conta vira problema',
    problemas.some(p => p.texto.includes('«Sem conta»') && p.texto.includes('não tem conta configurada')));
  check('total sobre coluna órfã vira problema',
    problemas.some(p => p.texto.includes('«colunaOrfa»')));
  check('todo problema aponta a coluna e a aba',
    problemas.every(p => !!p.columnKey && p.sheet === 'Turmas'));

  eq('célula do campo extinto sai em branco', r.rows[0][0].value, null);
  eq('célula da conta quebrada sai em branco, sem fórmula', [r.rows[0][2].value, r.rows[0][2].formula ?? null], [null, null]);
  eq('a coluna sadia continua resolvendo', r.rows[0][1].value, 16);
  eq('o total órfão não entra; o sadio sim', r.totalsRow!.map(c => c?.formula ?? null), [null, 'SUM(B2:B2)', null, null]);

  // (c) Dedup: a conta quebrada dá UM problema, não um por linha.
  const sink2 = createProblemSink();
  const muitas = Array.from({ length: 50 }, (_, i) => ({ input: linha({ demandId: `DEM-${i}` }), refs: refs(`DEM-${i}`) }));
  resolveRowsSheet(quebrado, muitas, emptyTemplateValuesIndex(), { problems: sink2 });
  eq('50 linhas com o mesmo defeito -> os mesmos problemas de 1 linha', sink2.list().length, problemas.length);

  // (d) A porta certa por origem.
  const dbTemplate: MeasurementTemplate = {
    id: 'tpl:1', version: 1, origin: 'db', label: 'Medição Cliente X',
    company: { id: 'C1' }, fileNameBase: 'medicao_cliente_x', sheets: [quebrado],
  };
  const out = resolveTemplateWithProblems(dbTemplate, umaLinha, emptyTemplateValuesIndex());
  check('resolveTemplateWithProblems devolve os problemas do modelo do banco', out.problems.length === problemas.length);
  eq('e as abas mesmo assim', out.sheets.map(s => s.kind), ['rows']);

  lancou = false;
  try { resolveTemplate(dbTemplate, umaLinha, emptyTemplateValuesIndex()); } catch { lancou = true; }
  check('resolveTemplate RECUSA template do banco (os problemas não teriam para onde ir)', lancou);

  const vale = resolveTemplateWithProblems(VALE_TEMPLATE, umaLinha, emptyTemplateValuesIndex());
  eq('template de código sadio: zero problemas', vale.problems, []);
  eq('e as mesmas duas abas de sempre', vale.sheets.map(s => `${s.name}:${s.kind}`), ['Turmas Realizadas:rows', 'Plantas:static']);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [M] Mapeamento — jsonb <-> template
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[M] Mapeamento (jsonb <-> MeasurementTemplate)');
{
  const mapping: TemplateMapping = {
    v: 1,
    sheetName: 'Medição',
    headerRow: 3,
    firstDataRow: 4,
    columns: [
      { key: 'seq', header: 'Item', origem: 'sequencia', formato: 'integer' },
      { key: 'trein', header: 'Descrição do Serviço', origem: 'campo', campo: 'training.name', formato: 'text' },
      { key: 'modalidade', header: 'Modalidade', origem: 'campo', campo: 'training.modalidade', formato: 'text' },
      { key: 'qtd', header: 'Qtd', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
      { key: 'preco', header: 'Valor Unit.', origem: 'digitado', escopo: 'training', sobrescreverNaTurma: true, formato: 'currency', destacarVazio: true },
      { key: 'total', header: 'Total', origem: 'calculado', formato: 'currency', formula: { op: 'multiplicar', a: { coluna: 'qtd' }, b: { coluna: 'preco' } } },
      { key: 'contrato', header: 'Contrato', origem: 'constante', constante: 'contrato', formato: 'text' },
      { key: 'reservado', header: 'Uso do cliente', origem: 'branco' },
    ],
    constants: [{ nome: 'contrato', label: 'Número do contrato', valor: '4600012345', formato: 'text' }],
    totals: ['qtd', 'total'],
  };

  const jsonb = JSON.parse(JSON.stringify(buildTemplateMapping(mapping)));
  const { mapping: lido, avisos } = parseTemplateMapping(jsonb);
  eq('ida e volta pelo jsonb não perde nada', lido, buildTemplateMapping(mapping));
  eq('mapeamento bom não gera aviso', avisos, []);
  // Gravar o que se leu tem de dar o MESMO jsonb, campo a campo e na mesma
  // ordem — senão o diff no banco vira ruído a cada abertura da tela.
  eq('reler e regravar é operação nula (jsonb idêntico)',
    JSON.stringify(buildTemplateMapping(lido)), JSON.stringify(jsonb));

  const rec: TemplateRecord = {
    id: 'aaaa-bbbb', companyId: 'C1', companyName: 'Gerdau', name: 'orçamento 2027',
    storageBucket: 'measurement-templates', storagePath: 'templates/C1/aaaa-bbbb/modelo.xlsx',
    mapping: jsonb, isActive: true,
  };
  const { template, avisos: avisos2 } = templateFromRecord(rec);

  eq('rótulo do módulo vem da EMPRESA, não do nome do modelo', template.label, 'Medição Gerdau');
  eq('template_id é tpl:<uuid>', template.id, templateIdOf('aaaa-bbbb'));
  eq('empresa por id', template.company, { id: 'C1' });
  eq('nome do arquivo gerado', template.fileNameBase, 'medicao_gerdau');
  eq('arquivo-base aponta para o storage', [template.baseFileFrom, template.baseFile, template.baseFileBucket],
    ['storage', 'templates/C1/aaaa-bbbb/modelo.xlsx', 'measurement-templates']);
  eq('origem db (liga o modo tolerante)', template.origin, 'db');
  eq('uma aba de linhas, por demanda', template.sheets.map(s => `${s.name}:${s.kind}:${s.rowScope}`), ['Medição:rows:demand']);
  eq('cabeçalho e primeira linha de dados', [template.sheets[0].headerRow, template.sheets[0].firstDataRow], [3, 4]);
  eq('sem aviso no caminho feliz', avisos2, []);

  const cols = template.sheets[0].columns!;
  eq('origens traduzidas para o resolvedor', cols.map(c => c.source),
    ['sequence', 'training.name', 'training.modalidade', 'demand.cargaHoraria', 'manual', 'formula', 'constant', 'blank']);
  const preco = cols.find(c => c.key === 'preco')!;
  eq('digitado por treinamento com sobrescrita na turma',
    [preco.editable, preco.persistScope, preco.overrideScope, preco.highlightWhenEmpty],
    [true, 'training', 'demand', true]);
  eq('a conta viaja como spec, não como texto', cols.find(c => c.key === 'total')!.formulaSpec,
    { op: 'multiplicar', a: { coluna: 'qtd' }, b: { coluna: 'preco' } });
  eq('constante declarada para a tela', template.constantDefs, [{ name: 'contrato', label: 'Número do contrato', format: 'text' }]);
  eq('e o valor no mapa que o resolvedor usa', template.constants, { contrato: '4600012345' });
  eq('totais', template.sheets[0].totals, { sumColumns: ['qtd', 'total'] });

  // O template do banco resolve de ponta a ponta, sem problema nenhum.
  const out = resolveTemplateWithProblems(template, umaLinha, emptyTemplateValuesIndex());
  eq('modelo do banco bem configurado: zero problemas', out.problems, []);
  const rows = (out.sheets[0] as any).rows;
  eq('numeração', rows[0][0].value, 1);
  eq('campo do app', rows[0][1].value, 'NR 35');
  eq('total = D4*E4 (letras da ordem do mapeamento, começando na linha 4)', rows[0][5].formula, 'D4*E4');
  eq('constante em toda linha', rows[0][6].value, '4600012345');
  eq('coluna em branco', rows[0][7].value, null);

  // Modalidade: no catálogo, mas a linha ainda não a preenche (ver sourceFields.ts).
  check('Modalidade está no catálogo com rótulo de negócio', SOURCE_FIELDS['training.modalidade'].label === 'Modalidade');
  eq('sem a linha preencher, Modalidade resolve em branco (documentado)', rows[0][2].value, null);
  eq('com a linha preenchendo, resolve o valor',
    (resolveTemplateWithProblems(template, [{ input: linha({ modalidade: 'PRESENCIAL' }), refs: refs('DEM-100') }], emptyTemplateValuesIndex()).sheets[0] as any).rows[0][2].value,
    'PRESENCIAL');

  /* Configuração torta: avisos, nunca exceção. */
  const torto = parseTemplateMapping({
    v: 99,
    sheetName: 'X',
    headerRow: 5,
    firstDataRow: 2,
    columns: [
      { key: 'a', header: 'A', origem: 'campo', campo: 'demand.campoQueSumiu' },
      { key: 'a', header: 'A de novo', origem: 'branco' },
      { key: '', header: 'Sem chave', origem: 'branco' },
      { key: 'b', header: 'B', origem: 'inventada' },
      { key: 'c', header: 'C', origem: 'calculado', formula: { op: 'nada' } },
      { key: 'd', header: 'D', origem: 'constante', constante: 'naoDeclarada' },
      { key: 'e', header: 'E', origem: 'calculado', formula: { op: 'multiplicar', a: { coluna: 'b' }, b: { coluna: 'sumiu' } } },
    ],
    constants: [{ nome: '', valor: 1 }, { nome: 'ok', valor: 2 }, { nome: 'ok', valor: 3 }],
    totals: ['b', 'fantasma'],
    checks: ['semIdCliente'],
  });
  check('config torta não lança e devolve avisos', torto.avisos.length >= 8, JSON.stringify(torto.avisos));
  check('avisa campo extinto', torto.avisos.some(a => a.includes('«demand.campoQueSumiu»')));
  check('avisa coluna repetida', torto.avisos.some(a => a.includes('repetida')));
  check('avisa coluna sem identificação', torto.avisos.some(a => a.includes('sem identificação')));
  check('avisa origem desconhecida', torto.avisos.some(a => a.includes('origem desconhecida')));
  check('avisa conta ilegível', torto.avisos.some(a => a.includes('conta não pôde ser lida')));
  check('avisa valor fixo não declarado', torto.avisos.some(a => a.includes('«naoDeclarada»')));
  check('avisa conta sobre coluna inexistente', torto.avisos.some(a => a.includes('«sumiu»')));
  check('avisa total órfão', torto.avisos.some(a => a.includes('fantasma')));
  check('avisa versão diferente', torto.avisos.some(a => a.includes('outra versão')));
  eq('primeira linha de dados corrigida para depois do cabeçalho', torto.mapping.firstDataRow, 6);
  eq('coluna repetida e sem chave ficam de fora', torto.mapping.columns.map(c => c.key), ['a', 'b', 'c', 'd', 'e']);
  eq('total órfão removido', torto.mapping.totals, ['b']);
  eq('checks preservados para a fase que os usa', torto.mapping.checks, ['semIdCliente']);
  eq('constante sem nome fora, duplicada mantém a primeira', torto.mapping.constants.map(c => [c.nome, c.valor]), [['ok', 2]]);

  eq('config ilegível vira mapeamento vazio com o motivo', parseTemplateMapping('nada disso').mapping.columns, []);
  check('e o motivo é uma frase', parseTemplateMapping(null).avisos[0].includes('sem conteúdo legível'));

  eq('nome de arquivo sem acento nem símbolo', fileNameBaseOf('Açúcar & Cia. Ltda'), 'medicao_acucar_cia_ltda');
  eq('empresa sem nome não vira arquivo sem nome', fileNameBaseOf('   '), 'medicao');

  // Um modelo do banco com campo extinto: aviso ao ler E problema ao resolver.
  const recQuebrado: TemplateRecord = {
    ...rec,
    mapping: { ...jsonb, columns: [{ key: 'z', header: 'Treinamento', origem: 'campo', campo: 'demand.sumiu' }], totals: [] },
  };
  const quebrado2 = templateFromRecord(recQuebrado);
  check('ler avisa', quebrado2.avisos.some(a => a.includes('não existe mais no sistema')));
  const res = resolveTemplateWithProblems(quebrado2.template, umaLinha, emptyTemplateValuesIndex());
  check('e resolver bloqueia com o nome da coluna',
    res.problems.some(p => p.texto.includes('«Treinamento»')), JSON.stringify(res.problems));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [I] Inspeção — heurística pura
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[I] Inspeção: onde está o cabeçalho');
{
  const t = (text: string) => ({ text, type: 'texto' as const });
  const n = (v: number) => ({ text: String(v), type: 'numero' as const });
  const vaz = { text: '', type: 'vazio' as const };
  const mesc = (text: string) => ({ text, type: 'mesclada' as const });

  // Título mesclado em A1:E1, linha 2 vazia, cabeçalho na 3, dados na 4.
  const comTitulo: SheetSnapshot = {
    name: 'Medição', hidden: false, locked: false, rowCount: 5, columnCount: 5,
    merges: ['A1:E1'],
    rows: [
      [t('RELATÓRIO DE MEDIÇÃO — CLIENTE X'), mesc(''), mesc(''), mesc(''), mesc('')],
      [vaz, vaz, vaz, vaz, vaz],
      [t('Item'), t('Descrição do Serviço'), t('Qtd'), t('Valor Unit.'), t('Total')],
      [n(1), t('NR-35 Trabalho em Altura'), n(8), n(150), n(1200)],
      [n(2), t('NR-10 Básico'), n(40), n(150), n(6000)],
    ],
  };
  const s = suggestHeader(comTitulo);
  eq('título mesclado + linha vazia -> cabeçalho na linha 3', s.headerRow, 3);
  eq('dados na linha 4', s.firstDataRow, 4);
  eq('confiança alta', s.confianca, 'alta');
  eq('cinco colunas, com as letras', s.columns.map(c => `${c.letter}:${c.header}`),
    ['A:Item', 'B:Descrição do Serviço', 'C:Qtd', 'D:Valor Unit.', 'E:Total']);
  eq('chaves estáveis a partir do cabeçalho', s.columns.map(c => c.key),
    ['item', 'descricaoDoServico', 'qtd', 'valorUnit', 'total']);

  // A mesma planilha SEM o registro da mesclagem: a heurística ainda recusa a
  // linha 1, porque as células cobertas vêm com o tipo 'mesclada'.
  const semMerges: SheetSnapshot = { ...comTitulo, merges: [] };
  eq('sem o registro de mesclagem, o tipo da célula ainda salva', suggestHeader(semMerges).headerRow, 3);

  // Cabeçalho na linha 1 (o caso da Vale).
  const simples: SheetSnapshot = {
    name: 'Turmas', hidden: false, locked: false, rowCount: 3, columnCount: 3,
    merges: [],
    rows: [[t('ID'), t('Treinamento'), t('Carga')], [n(1), t('NR 35'), n(16)], [n(2), t('NR 10'), n(40)]],
  };
  eq('cabeçalho na linha 1', suggestHeader(simples).headerRow, 1);

  // Nada reconhecível: confiança baixa, com o motivo — nunca um palpite mudo.
  const soTexto: SheetSnapshot = {
    name: 'Notas', hidden: false, locked: false, rowCount: 2, columnCount: 2,
    merges: [], rows: [[t('observações'), t('gerais')], [t('linha'), t('de texto')]],
  };
  const baixa = suggestHeader(soTexto);
  eq('sem linha de dados numérica -> confiança baixa', baixa.confianca, 'baixa');
  check('e o motivo aparece', baixa.avisos.some(a => a.includes('não deu para identificar') || a.includes('Não deu para identificar')));

  const vazia: SheetSnapshot = { name: 'Vazia', hidden: false, locked: false, rowCount: 0, columnCount: 1, merges: [], rows: [] };
  check('aba vazia é dita, não adivinhada', suggestHeader(vazia).avisos.some(a => a.includes('nenhuma linha preenchida')));

  // Cabeçalho repetido e coluna sem nome.
  const tortas: SheetSnapshot = {
    name: 'T', hidden: false, locked: false, rowCount: 2, columnCount: 4, merges: [],
    rows: [[t('Valor'), t('Valor'), { text: '', type: 'vazio' as const }, t('Fim')], [n(1), n(2), n(3), n(4)]],
  };
  const st = suggestHeader(tortas);
  eq('cabeçalho repetido ganha chaves distintas', st.columns.map(c => c.key), ['valor', 'valor2', 'colunaC', 'fim']);
  check('e avisa a repetição', st.avisos.some(a => a.includes('aparece 2 vezes')));
  check('avisa a coluna sem nome', st.avisos.some(a => a.includes('sem nome no arquivo')));

  // Oculta e protegida entram como aviso, não como bloqueio.
  const oculta = suggestHeader({ ...simples, hidden: true, locked: true });
  check('aba oculta é avisada', oculta.avisos.some(a => a.includes('oculta')));
  check('aba protegida é avisada com a consequência', oculta.avisos.some(a => a.includes('protegida') && a.includes('sairá protegida')));

  // Escolha da aba: pula a que não fecha, prefere a visível.
  const escolha = suggestSheet({ sheets: [soTexto, comTitulo, { ...simples, hidden: true }] });
  eq('escolhe a aba cujo cabeçalho fecha', escolha.sheetName, 'Medição');
  check('lista todas para a pessoa trocar', escolha.disponiveis.length === 3);
  check('diz que as outras abas são preservadas', escolha.avisos.some(a => a.includes('exatamente como estão')));
  eq('sem aba nenhuma, diz isso', suggestSheet({ sheets: [] }).avisos, ['O arquivo não tem nenhuma aba.']);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [E] Guarda de fonte — os arquivos novos do domínio
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[E] Guarda de fonte — domain/exports/templates sem I/O');
{
  for (const rel of ['formula.ts', 'mapping.ts', 'inspect.ts'].map(f => `domain/exports/templates/${f}`)) {
    const src = semComentarios(ler(rel));
    check(`${rel} não importa services/`, !/from\s+['"][^'"]*\/services\//.test(src));
    check(`${rel} não importa react`, !/from\s+['"]react(-dom)?['"]/.test(src));
    check(`${rel} não importa exceljs`, !/exceljs/.test(src));
    check(`${rel} não toca supabase`, !/supabase/i.test(src));
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [A] Arquivo (I/O) — assinatura de bytes e fotografia
 * ────────────────────────────────────────────────────────────────────────── */
import { runArquivoChecks } from './smokeModelosMedicaoArquivo';
import { runStoreChecks } from './smokeModelosMedicaoStore';
import { runRegistryChecks, runSalvarChecks, runValeTextosChecks } from './smokeModelosMedicaoRegistry';

(async () => {
  // Os blocos abaixo usam o MESMO `check`, que já soma em `falhas`.
  await runArquivoChecks({ check, eq });
  await runStoreChecks({ check, eq });
  runRegistryChecks({ check, eq });
  await runSalvarChecks({ check, eq });
  runValeTextosChecks({ check, eq });

  console.log(falhas === 0 ? '\n✅ SMOKE MODELOS MEDICAO: OK' : `\n❌ SMOKE MODELOS MEDICAO: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
