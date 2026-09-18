/**
 * TEMPLATES DE MEDIÇÃO — fórmula POR SELEÇÃO (puro)
 *
 * Quem monta a conta é a equipe de operação, escolhendo uma operação de uma
 * lista fechada e as colunas que ela usa — nunca digitando sintaxe de Excel.
 * O que a tela produz é uma `FormulaSpec`; `compileFormulaSpec` a traduz para
 * o MESMO texto com placeholders que os templates em código escrevem à mão
 * (`{col:chave}{row}`), e daí para frente o caminho é o de sempre
 * (`resolveFormula`, em resolve.ts, troca placeholder por letra).
 *
 * TRÊS DECISÕES QUE SUSTENTAM ISSO — não as desfaça por conveniência:
 *
 *   1. O JSONB GUARDA A SPEC, NUNCA O TEXTO COMPILADO. É a spec que a tela
 *      reabre para editar; o texto é derivado a cada resolução. Guardar o
 *      texto fecharia a porta de editar a conta sem reconstruí-la a partir de
 *      uma string.
 *
 *   2. REFERÊNCIA POR CHAVE DE COLUNA, nunca por letra — a mesma decisão nº 1
 *      de types.ts. Reordenar as colunas no mapeamento não pode quebrar a
 *      conta. O smoke prova que a mesma spec em outra ordem dá outras letras
 *      e o mesmo significado.
 *
 *   3. CONSTANTE ENTRA COMO LITERAL, não como referência a uma célula de
 *      parâmetro. `{const:pctDespesa}` com 0.2 vira `0.2` dentro da fórmula.
 *      É o que mantém a fórmula conferível pelo cliente sem uma aba de
 *      parâmetros escondida no arquivo dele.
 *
 * LISTA FECHADA, de propósito. As cinco operações abaixo reproduzem, caractere
 * a caractere, as DUAS fórmulas que o template da Vale escreve à mão
 * (`vale.ts`) — que é a evidência de que a lista basta para o caso real. Se
 * alguma empresa pedir algo que não cabe aqui, é pedido específico e a tela
 * diz isso; não é para abrir expressão livre por baixo.
 *
 * Porta aberta sem construir: `FormulaSpec` é união discriminada por `op`,
 * então uma operação nova (ou um `{ op: 'livre', texto }`) entra sem quebrar o
 * que existe. A tela de hoje não oferece nenhuma delas.
 */
import type { TemplateConstantValue } from './types';

/** Um operando: uma coluna do mapeamento ou uma constante do modelo. */
export type FormulaRef = { coluna: string } | { constante: string };

export type FormulaSpec =
  /** a × b — ex.: Carga horária × Preço unitário HH. */
  | { op: 'multiplicar'; a: FormulaRef; b: FormulaRef }
  /** a − b. */
  | { op: 'subtrair'; a: FormulaRef; b: FormulaRef }
  /** SUM de um intervalo CONTÍGUO de colunas, de `de` até `ate` (inclusive). */
  | { op: 'somarIntervalo'; de: string; ate: string }
  /** SUM(de:ate) + (SUM(de:ate) × pct) — o total de despesas da Vale. */
  | { op: 'somarComPercentual'; de: string; ate: string; pct: FormulaRef }
  /** a + constante do modelo. */
  | { op: 'somarConstante'; a: FormulaRef; constante: string };

export type FormulaOp = FormulaSpec['op'];

/** As operações que a tela oferece, na ordem em que devem aparecer. */
export const FORMULA_OPS: { op: FormulaOp; label: string; ajuda: string }[] = [
  {
    op: 'multiplicar',
    label: 'Multiplicar duas colunas',
    ajuda: 'Ex.: Carga horária × Preço unitário HH.',
  },
  {
    op: 'somarIntervalo',
    label: 'Somar um intervalo de colunas',
    ajuda: 'Soma da primeira até a última coluna escolhida, incluindo as do meio.',
  },
  {
    op: 'somarComPercentual',
    label: 'Somar um intervalo e acrescentar um percentual',
    ajuda: 'Ex.: soma das despesas reembolsáveis mais 20% sobre ela.',
  },
  {
    op: 'subtrair',
    label: 'Subtrair uma coluna de outra',
    ajuda: 'Ex.: Valor bruto menos Desconto.',
  },
  {
    op: 'somarConstante',
    label: 'Somar uma coluna com um valor fixo do modelo',
    ajuda: 'Ex.: Total mais Taxa administrativa.',
  },
];

export const isColunaRef = (r: FormulaRef): r is { coluna: string } =>
  typeof (r as { coluna?: unknown }).coluna === 'string';

export const isConstanteRef = (r: FormulaRef): r is { constante: string } =>
  typeof (r as { constante?: unknown }).constante === 'string';

/* ────────────────────────────── compilação ────────────────────────────── */

/** `{coluna}` -> '{col:chave}{row}'; `{constante}` -> '{const:nome}'. */
function ref(r: FormulaRef): string {
  if (isColunaRef(r)) return '{col:' + r.coluna + '}{row}';
  return '{const:' + r.constante + '}';
}

/** 'SUM({col:de}{row}:{col:ate}{row})'. */
function somaIntervalo(de: string, ate: string): string {
  return 'SUM({col:' + de + '}{row}:{col:' + ate + '}{row})';
}

/**
 * Spec -> texto com placeholders, EXATAMENTE no formato que os templates em
 * código escrevem (com o '=' inicial). Quem resolve as letras é
 * `resolveFormula`.
 */
export function compileFormulaSpec(spec: FormulaSpec): string {
  switch (spec.op) {
    case 'multiplicar':
      return '=' + ref(spec.a) + '*' + ref(spec.b);
    case 'subtrair':
      return '=' + ref(spec.a) + '-' + ref(spec.b);
    case 'somarIntervalo':
      return '=' + somaIntervalo(spec.de, spec.ate);
    case 'somarComPercentual': {
      const soma = somaIntervalo(spec.de, spec.ate);
      return '=' + soma + '+(' + soma + '*' + ref(spec.pct) + ')';
    }
    case 'somarConstante':
      return '=' + ref(spec.a) + '+{const:' + spec.constante + '}';
    default: {
      // Exaustividade: uma `op` nova sem `case` vira erro de compilação aqui.
      const nunca: never = spec;
      throw new Error('Fórmula: operação desconhecida ' + JSON.stringify(nunca));
    }
  }
}

/* ───────────────────────────── descrição ───────────────────────────── */

export interface FormulaLabels {
  /** Rótulo de uma coluna pela chave (o cabeçalho do arquivo do cliente). */
  coluna?: (key: string) => string | undefined;
  /** Rótulo de uma constante pelo nome. */
  constante?: (nome: string) => string | undefined;
}

function rotuloRef(r: FormulaRef, labels: FormulaLabels): string {
  if (isColunaRef(r)) return labels.coluna?.(r.coluna) ?? r.coluna;
  return labels.constante?.(r.constante) ?? r.constante;
}

/**
 * A conta em português, para a tela mostrar sob a coluna calculada:
 * "Carga horária × Preço unitário HH". Sem rótulo conhecido, cai na chave.
 */
export function describeFormulaSpec(spec: FormulaSpec, labels: FormulaLabels = {}): string {
  const col = (key: string) => labels.coluna?.(key) ?? key;
  switch (spec.op) {
    case 'multiplicar':
      return rotuloRef(spec.a, labels) + ' × ' + rotuloRef(spec.b, labels);
    case 'subtrair':
      return rotuloRef(spec.a, labels) + ' − ' + rotuloRef(spec.b, labels);
    case 'somarIntervalo':
      return 'Soma de «' + col(spec.de) + '» até «' + col(spec.ate) + '»';
    case 'somarComPercentual':
      return (
        'Soma de «' + col(spec.de) + '» até «' + col(spec.ate) +
        '», mais ' + rotuloRef(spec.pct, labels) + ' sobre essa soma'
      );
    case 'somarConstante':
      return rotuloRef(spec.a, labels) + ' + ' + (labels.constante?.(spec.constante) ?? spec.constante);
    default: {
      const nunca: never = spec;
      throw new Error('Fórmula: operação desconhecida ' + JSON.stringify(nunca));
    }
  }
}

/* ───────────────────────────── validação ───────────────────────────── */

export interface FormulaScope {
  /** Chaves das colunas do modelo, NA ORDEM — o intervalo depende da ordem. */
  colunas: string[];
  /** Nomes das constantes declaradas no modelo. */
  constantes: string[];
}

/** Referências de coluna e de constante que a spec usa. */
export function formulaRefs(spec: FormulaSpec): { colunas: string[]; constantes: string[] } {
  const colunas: string[] = [];
  const constantes: string[] = [];
  const push = (r: FormulaRef) => {
    if (isColunaRef(r)) colunas.push(r.coluna);
    else constantes.push(r.constante);
  };
  switch (spec.op) {
    case 'multiplicar':
    case 'subtrair':
      push(spec.a);
      push(spec.b);
      break;
    case 'somarIntervalo':
      colunas.push(spec.de, spec.ate);
      break;
    case 'somarComPercentual':
      colunas.push(spec.de, spec.ate);
      push(spec.pct);
      break;
    case 'somarConstante':
      push(spec.a);
      constantes.push(spec.constante);
      break;
  }
  return { colunas, constantes };
}

/**
 * O que impede esta conta de ser calculada, em português, pronto para o painel
 * de pendências. Lista vazia = a conta fecha.
 *
 * NUNCA lança: uma configuração velha apontando para coluna que a pessoa
 * apagou é configuração velha, não bug — a resposta certa é dizer qual coluna
 * e bloquear a geração, não uma exceção na cara de quem está usando a tela.
 */
export function validateFormulaSpec(
  spec: FormulaSpec,
  escopo: FormulaScope,
  rotuloColuna?: string
): string[] {
  const alvo = rotuloColuna ? 'A coluna «' + rotuloColuna + '»' : 'A conta';
  const problemas: string[] = [];
  const conhecidas = new Set(escopo.colunas);
  const constantes = new Set(escopo.constantes);

  const refs = formulaRefs(spec);
  for (const k of refs.colunas) {
    if (!conhecidas.has(k)) {
      problemas.push(alvo + ' usa a coluna «' + k + '», que não existe mais no modelo.');
    }
  }
  for (const c of refs.constantes) {
    if (!constantes.has(c)) {
      problemas.push(alvo + ' usa o valor fixo «' + c + '», que não está declarado no modelo.');
    }
  }

  // Intervalo: as duas pontas precisam existir E estar na ordem certa. Com as
  // pontas trocadas o Excel aceita o SUM, mas o cliente lê uma faixa que
  // ninguém quis — silencioso, então é problema aqui.
  if (spec.op === 'somarIntervalo' || spec.op === 'somarComPercentual') {
    const i = escopo.colunas.indexOf(spec.de);
    const j = escopo.colunas.indexOf(spec.ate);
    if (i >= 0 && j >= 0 && i > j) {
      problemas.push(
        alvo + ' soma de «' + spec.de + '» até «' + spec.ate + '», mas «' + spec.ate +
        '» vem antes no modelo — inverta as duas pontas.'
      );
    }
  }
  return problemas;
}

/* ───────────────────────── leitura do jsonb ───────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function parseRef(v: unknown): FormulaRef | null {
  if (!isRecord(v)) return null;
  if (typeof v.coluna === 'string' && v.coluna.trim()) return { coluna: v.coluna };
  if (typeof v.constante === 'string' && v.constante.trim()) return { constante: v.constante };
  return null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * jsonb desconhecido -> spec, ou `null` quando não dá para entender. Quem
 * chama transforma o `null` em aviso; aqui não se lança nem se adivinha.
 */
export function parseFormulaSpec(v: unknown): FormulaSpec | null {
  if (!isRecord(v)) return null;
  switch (v.op) {
    case 'multiplicar':
    case 'subtrair': {
      const a = parseRef(v.a);
      const b = parseRef(v.b);
      return a && b ? { op: v.op, a, b } : null;
    }
    case 'somarIntervalo': {
      const de = texto(v.de);
      const ate = texto(v.ate);
      return de && ate ? { op: 'somarIntervalo', de, ate } : null;
    }
    case 'somarComPercentual': {
      const de = texto(v.de);
      const ate = texto(v.ate);
      const pct = parseRef(v.pct);
      return de && ate && pct ? { op: 'somarComPercentual', de, ate, pct } : null;
    }
    case 'somarConstante': {
      const a = parseRef(v.a);
      const constante = texto(v.constante);
      return a && constante ? { op: 'somarConstante', a, constante } : null;
    }
    default:
      return null;
  }
}

/* ──────────────────── constantes na hora de resolver ──────────────────── */

/**
 * Uma constante dentro da fórmula vira LITERAL (decisão 3 do cabeçalho):
 *   • número   -> '0.2' (ponto decimal, que é o que o Excel espera na fórmula);
 *   • booleano -> 'TRUE' / 'FALSE';
 *   • texto    -> '"texto"', com aspas internas dobradas.
 */
export function formulaLiteral(v: TemplateConstantValue): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Fórmula: valor fixo não é um número finito');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return '"' + String(v).replace(/"/g, '""') + '"';
}
