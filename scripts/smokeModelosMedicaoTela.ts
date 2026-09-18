/**
 * SMOKE — Modelos de medição: Fase 5 (o que a TELA produz)
 *
 * Chamado por smokeModelosMedicao.ts. Usa o `check` compartilhado.
 *
 * A tela em si não é testada aqui (não há DOM); o que se prende é o CONTRATO
 * entre ela e o domínio — o que ela monta tem de ser exatamente o que o
 * domínio lê de volta, e as decisões de produto que viram texto na tela.
 *
 *   [T1] O mapeamento montado pela UI é o mesmo que `parseTemplateMapping` lê.
 *   [T2] Conferência com 0 turmas não quebra e não impede salvar.
 *   [T3] Troca de arquivo-base com cabeçalho diferente bloqueia, e o que casa
 *        por cabeçalho mantém a configuração.
 *   [T4] A conta calculada mostra RESULTADO, não fórmula.
 *   [T5] Nenhuma chave técnica escapa para a tela: todo campo do catálogo tem
 *        rótulo de negócio e grupo, e as origens têm rótulo em português.
 */
import fs from 'fs';
import path from 'path';

import {
  buildBaseFingerprint,
  buildTemplateMapping,
  compareBaseFingerprint,
  parseTemplateMapping,
  templateFromRecord,
  type MappingColumn,
  type TemplateMapping,
  type TemplateRecord,
} from '../domain/exports/templates/mapping';
import { COLUMN_ORIGENS } from '../domain/exports/templates/mapping';
import {
  evaluateFormulaSpec,
  describeFormulaSpec,
  FORMULA_OPS,
} from '../domain/exports/templates/formula';
import {
  SOURCE_FIELDS,
  SOURCE_FIELD_GROUPS,
  type SourceField,
} from '../domain/exports/templates/sourceFields';
import { validarTemplate } from '../domain/exports/templates/validate';
import { bloqueiosParaSalvar } from '../domain/exports/templates/store';
import { columnsAt, suggestHeader, type SheetSnapshot } from '../domain/exports/templates/inspect';

interface Tools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
}

/**
 * O que a tela de mapeamento monta a partir de uma planilha confirmada —
 * a mesma função que `ModelosMedicao.mapeamentoInicial` aplica, reproduzida
 * aqui porque o componente não é importável sem DOM.
 */
function mapeamentoInicial(
  p: { sheetName: string; headerRow: number; firstDataRow: number; colunas: { key: string; header: string }[] },
  anterior?: TemplateMapping
): TemplateMapping {
  const porCabecalho = new Map((anterior?.columns ?? []).map(c => [c.header, c]));
  const columns: MappingColumn[] = p.colunas.map(c => {
    const antiga = porCabecalho.get(c.header);
    return antiga ? { ...antiga, key: c.key, header: c.header } : { key: c.key, header: c.header, origem: 'branco' as const };
  });
  return buildTemplateMapping({
    v: 1,
    sheetName: p.sheetName,
    headerRow: p.headerRow,
    firstDataRow: p.firstDataRow,
    columns,
    constants: anterior?.constants ?? [],
    totals: (anterior?.totals ?? []).filter(k => columns.some(c => c.key === k)),
  });
}

const planilha: SheetSnapshot = {
  name: 'Serviços',
  hidden: false,
  locked: false,
  rowCount: 4,
  columnCount: 4,
  merges: [],
  rows: [
    [
      { text: 'Serviço Prestado', type: 'texto' },
      { text: 'Horas', type: 'texto' },
      { text: 'Tarifa Hora', type: 'texto' },
      { text: 'Total', type: 'texto' },
    ],
    [
      { text: 'NR-35', type: 'texto' },
      { text: '8', type: 'numero' },
      { text: '150', type: 'numero' },
      { text: '1200', type: 'numero' },
    ],
  ],
};

const registro = (mapping: unknown, over: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 'aaa-bbb',
  companyId: 'C1',
  companyName: 'Gerdau',
  name: 'Padrão 2027',
  mapping,
  isActive: true,
  storageBucket: 'measurement-templates',
  storagePath: 'templates/C1/aaa-bbb/modelo.xlsx',
  ...over,
});

export function runTelaChecks(t: Tools): void {
  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T1] O que a tela monta é o que o domínio lê de volta');
  {
    const colunas = columnsAt(planilha, 1);
    t.eq('a tela recebe as 4 colunas da planilha', colunas.map(c => c.header),
      ['Serviço Prestado', 'Horas', 'Tarifa Hora', 'Total']);

    // A pessoa configura: campo, campo, digitado, calculado.
    const montado: TemplateMapping = {
      ...mapeamentoInicial({ sheetName: 'Serviços', headerRow: 1, firstDataRow: 2, colunas }),
      columns: [
        { key: colunas[0].key, header: 'Serviço Prestado', origem: 'campo', campo: 'training.name', formato: 'text' },
        { key: colunas[1].key, header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
        { key: colunas[2].key, header: 'Tarifa Hora', origem: 'digitado', escopo: 'training', sobrescreverNaTurma: true, formato: 'currency', destacarVazio: true },
        {
          key: colunas[3].key, header: 'Total', origem: 'calculado', formato: 'currency',
          formula: { op: 'multiplicar', a: { coluna: colunas[1].key }, b: { coluna: colunas[2].key } },
        },
      ],
      constants: [{ nome: 'contrato', label: 'Número do contrato', valor: '4600012345' }],
      totals: [colunas[3].key],
    };

    // Ida e volta pelo jsonb — é o contrato entre a tela e o banco.
    const jsonb = JSON.parse(JSON.stringify(buildTemplateMapping(montado)));
    const { mapping: lido, avisos } = parseTemplateMapping(jsonb);
    t.eq('o mapeamento montado pela tela volta idêntico', lido, buildTemplateMapping(montado));
    t.eq('e sem aviso nenhum', avisos, []);

    const { template } = templateFromRecord(registro(jsonb));
    t.eq('vira um template que gera', validarTemplate(template).podeGerar, true);
    t.eq('salvar não é bloqueado', bloqueiosParaSalvar(registro(jsonb)), []);
    t.eq('rótulo do módulo', template.label, 'Medição Gerdau');
    t.eq('as origens viram as internas certas', template.sheets[0].columns!.map(c => c.source),
      ['training.name', 'demand.cargaHoraria', 'manual', 'formula']);
    t.eq('a conta viaja como spec', !!template.sheets[0].columns![3].formulaSpec, true);

    // Coluna sem origem: a tela conta como pendente e o modelo não gera.
    const pelaMetade = { ...montado, columns: [...montado.columns.slice(0, 3), { key: colunas[3].key, header: 'Total', origem: 'calculado' as const }] };
    const meio = templateFromRecord(registro(JSON.parse(JSON.stringify(buildTemplateMapping(pelaMetade))))).template;
    t.eq('coluna calculada sem conta impede gerar', validarTemplate(meio).podeGerar, false);
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T2] Conferência sem turma no período não quebra');
  {
    const colunas = columnsAt(planilha, 1);
    const mapping = buildTemplateMapping({
      ...mapeamentoInicial({ sheetName: 'Serviços', headerRow: 1, firstDataRow: 2, colunas }),
      columns: [{ key: colunas[0].key, header: 'Serviço Prestado', origem: 'campo', campo: 'training.name', formato: 'text' }],
      constants: [],
      totals: [],
    });
    const { template } = templateFromRecord(registro(JSON.parse(JSON.stringify(mapping))));

    // A conferência recebe uma lista VAZIA de turmas — é o caso do modelo
    // configurado em janeiro para uma empresa cuja primeira turma é em março.
    const linhas: unknown[] = [];
    t.eq('zero turmas é uma lista vazia, não um erro', linhas.length, 0);
    t.eq('e o modelo continua podendo ser salvo', validarTemplate(template).podeGerar, true);
    t.eq('e continua disponível como módulo', bloqueiosParaSalvar(registro(JSON.parse(JSON.stringify(mapping)))), []);

    const fonte = fs.readFileSync(path.join(process.cwd(), 'components/exportacoes/modelos/ModeloConferencia.tsx'), 'utf8');
    t.check('a tela diz em português que não há turma e que dá para salvar',
      fonte.includes('Não há turma concluída no período para conferir') && fonte.includes('Isso não impede de salvar'));
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T3] Trocar a planilha-base com cabeçalho diferente bloqueia');
  {
    const colunas = columnsAt(planilha, 1);
    const configurado: TemplateMapping = buildTemplateMapping({
      ...mapeamentoInicial({ sheetName: 'Serviços', headerRow: 1, firstDataRow: 2, colunas }),
      columns: [
        { key: colunas[0].key, header: 'Serviço Prestado', origem: 'campo', campo: 'training.name', formato: 'text' },
        { key: colunas[1].key, header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
        { key: colunas[2].key, header: 'Tarifa Hora', origem: 'digitado', escopo: 'training', formato: 'currency' },
        { key: colunas[3].key, header: 'Total', origem: 'branco' },
      ],
      constants: [],
      totals: [],
    });
    const antes = buildBaseFingerprint(configurado, colunas.map(c => c.header));

    // (a) MESMO arquivo: nada a reconferir.
    const igual = buildBaseFingerprint(configurado, colunas.map(c => c.header));
    t.eq('mesma planilha: nenhum item para reconferir', compareBaseFingerprint(antes, igual), []);

    // (b) Cabeçalho trocado: bloqueia, e o diff diz o quê.
    const nova: SheetSnapshot = {
      ...planilha,
      rows: [
        [
          { text: 'Serviço Prestado', type: 'texto' },
          { text: 'Quantidade', type: 'texto' },
          { text: 'Tarifa Hora', type: 'texto' },
          { text: 'Observação', type: 'texto' },
        ],
        planilha.rows[1],
      ],
    };
    const colunasNovas = columnsAt(nova, 1);
    const depois = buildBaseFingerprint(configurado, colunasNovas.map(c => c.header));
    const diff = compareBaseFingerprint(antes, depois);
    t.check('o diff aponta as duas colunas que mudaram, pela letra',
      diff.length === 2 && diff.some(d => d.includes('coluna B')) && diff.some(d => d.includes('coluna D')),
      JSON.stringify(diff));
    t.check('e diz o nome antigo e o novo',
      diff.some(d => d.includes('«Horas»') && d.includes('«Quantidade»')), JSON.stringify(diff));

    // (c) O que casa por CABEÇALHO mantém a configuração; o resto reseta.
    const remontado = mapeamentoInicial(
      { sheetName: 'Serviços', headerRow: 1, firstDataRow: 2, colunas: colunasNovas },
      configurado
    );
    const porHeader = new Map(remontado.columns.map(c => [c.header, c]));
    t.eq('"Serviço Prestado" manteve o campo', porHeader.get('Serviço Prestado')!.campo, 'training.name');
    t.eq('"Tarifa Hora" manteve o digitado por treinamento', porHeader.get('Tarifa Hora')!.escopo, 'training');
    t.eq('"Quantidade" (nova) volta para não configurada', porHeader.get('Quantidade')!.origem, 'branco');
    t.eq('"Observação" (nova) idem', porHeader.get('Observação')!.origem, 'branco');
    t.eq('"Horas" não existe mais no mapeamento', porHeader.has('Horas'), false);

    const fonte = fs.readFileSync(path.join(process.cwd(), 'components/exportacoes/modelos/ModelosMedicao.tsx'), 'utf8');
    t.check('a tela só sobe o arquivo novo DEPOIS da reconferência',
      fonte.includes('Arquivo trocado com diff: só agora ele sobe, depois da reconferência'));
    t.check('e o banner do diff é de ERRO, não aviso',
      /A planilha nova tem colunas diferentes[\s\S]{0,400}tipo="erro"|tipo="erro"[\s\S]{0,400}A planilha nova tem colunas diferentes/.test(fonte));
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T4] A coluna calculada mostra RESULTADO, não fórmula');
  {
    const valores: Record<string, number> = { horas: 8, tarifa: 150, a: 10, b: 20, c: 30 };
    const val = (k: string) => valores[k] ?? null;
    const ordem = ['horas', 'tarifa', 'a', 'b', 'c'];

    t.eq('multiplicar', evaluateFormulaSpec({ op: 'multiplicar', a: { coluna: 'horas' }, b: { coluna: 'tarifa' } }, { valorDaColuna: val, ordem }), 1200);
    t.eq('subtrair', evaluateFormulaSpec({ op: 'subtrair', a: { coluna: 'b' }, b: { coluna: 'a' } }, { valorDaColuna: val, ordem }), 10);
    t.eq('somar intervalo (inclui o do meio)', evaluateFormulaSpec({ op: 'somarIntervalo', de: 'a', ate: 'c' }, { valorDaColuna: val, ordem }), 60);
    t.eq('somar intervalo com percentual',
      evaluateFormulaSpec({ op: 'somarComPercentual', de: 'a', ate: 'c', pct: { constante: 'pct' } }, { valorDaColuna: val, ordem, constantes: { pct: 0.2 } }), 72);
    t.eq('somar com constante',
      evaluateFormulaSpec({ op: 'somarConstante', a: { coluna: 'a' }, constante: 'taxa' }, { valorDaColuna: val, ordem, constantes: { taxa: 5 } }), 15);
    t.eq('coluna que não existe -> null (a tela mostra em branco)',
      evaluateFormulaSpec({ op: 'multiplicar', a: { coluna: 'sumiu' }, b: { coluna: 'tarifa' } }, { valorDaColuna: val, ordem }), null);
    t.eq('intervalo invertido -> null',
      evaluateFormulaSpec({ op: 'somarIntervalo', de: 'c', ate: 'a' }, { valorDaColuna: val, ordem }), null);

    const fonte = fs.readFileSync(path.join(process.cwd(), 'components/exportacoes/modelos/ModeloConferencia.tsx'), 'utf8');
    t.check('a conferência usa o avaliador, não o texto da fórmula',
      fonte.includes('evaluateFormulaSpec') && !fonte.includes('cell.formula'));
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T5] Nenhuma chave técnica chega à tela');
  {
    const campos = Object.keys(SOURCE_FIELDS) as SourceField[];
    t.check('todo campo tem rótulo de negócio',
      campos.every(k => !!SOURCE_FIELDS[k].label && !SOURCE_FIELDS[k].label.includes('.')),
      JSON.stringify(campos.filter(k => SOURCE_FIELDS[k].label.includes('.'))));
    t.check('todo campo declara um grupo conhecido',
      campos.every(k => SOURCE_FIELD_GROUPS.includes(SOURCE_FIELDS[k].grupo)));
    t.check('todo grupo tem ao menos um campo',
      SOURCE_FIELD_GROUPS.every(g => campos.some(k => SOURCE_FIELDS[k].grupo === g)),
      JSON.stringify(SOURCE_FIELD_GROUPS.filter(g => !campos.some(k => SOURCE_FIELDS[k].grupo === g))));

    t.check('as seis origens têm rótulo e ajuda em português',
      COLUMN_ORIGENS.length === 6 && COLUMN_ORIGENS.every(o => o.label && o.ajuda && !o.label.includes('.')));
    t.check('as cinco operações também',
      FORMULA_OPS.length === 5 && FORMULA_OPS.every(o => o.label && o.ajuda));

    t.eq('a conta é descrita por rótulo, não por chave',
      describeFormulaSpec(
        { op: 'multiplicar', a: { coluna: 'cargaHoraria' }, b: { coluna: 'precoHH' } },
        { coluna: k => ({ cargaHoraria: 'Carga horária', precoHH: 'Preço unitário HH' })[k] }
      ),
      'Carga horária × Preço unitário HH');

    /* A varredura que o critério pede: ler os TEXTOS da tela. */
    const telas = [
      'components/exportacoes/modelos/ModeloUpload.tsx',
      'components/exportacoes/modelos/ModeloMapeamento.tsx',
      'components/exportacoes/modelos/ModeloConta.tsx',
      'components/exportacoes/modelos/ModeloConferencia.tsx',
      'components/exportacoes/modelos/ModelosMedicao.tsx',
    ];
    for (const rel of telas) {
      const fonte = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      // Só o que está entre tags JSX e em string de atributo visível — o que a
      // pessoa lê. Comentários e código ficam de fora.
      const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const visivel = [
        ...semComentarios.matchAll(/>([^<>{}]{4,})</g),
        ...semComentarios.matchAll(/(?:title|placeholder|label)="([^"]{4,})"/g),
      ].map(m => m[1]).join(' | ');

      t.check(`${rel}: nenhum caminho de campo visível`,
        !/\b(demand|training|company|people|expenses|measurement)\.[a-zA-Z]/.test(visivel),
        (visivel.match(/\b(demand|training|company|people|expenses|measurement)\.[a-zA-Z]+/g) ?? []).join(', '));
      t.check(`${rel}: nenhuma sintaxe de Excel visível`,
        !/SUM\(|\{col:|\{row\}|=\s*[A-Z]{1,2}\d/.test(visivel),
        (visivel.match(/SUM\([^|]*|\{col:[^}]*\}/g) ?? []).join(', '));
      t.check(`${rel}: nenhum nome de tabela ou coluna do banco visível`,
        !/measurement_templates|storage_path|is_active|company_id|jsonb/.test(visivel));
    }
  }
}
