/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — o que a planilha enviada tem (puro)
 *
 * A pessoa sobe o .xlsx que a empresa exige e o app tem de dizer, em
 * português: "achei a aba X, o cabeçalho na linha 3, e estas são as colunas —
 * confere?". Este arquivo faz a SUGESTÃO; quem lê o arquivo de verdade é
 * services/exports/templateFile.ts (que usa ExcelJS e não pode morar aqui —
 * guarda de fonte).
 *
 * A fronteira é o `WorkbookSnapshot`: uma fotografia burra da planilha
 * (abas, mesclagens, e as primeiras linhas com o TIPO de cada célula). Assim
 * a heurística é testável sem abrir arquivo nenhum, e trocar de biblioteca de
 * leitura um dia não mexe em regra nenhuma.
 *
 * A HEURÍSTICA, e por que cada parte existe (verificada contra o vale.xlsx
 * real e contra uma planilha com título mesclado no topo):
 *
 *   cabeçalho = a primeira linha que
 *     (1) tem 2+ células preenchidas          — uma célula só é título, não cabeçalho;
 *     (2) não TOCA MESCLAGEM, de nenhum dos dois lados:
 *           • não tem célula coberta por uma mesclagem, e
 *           • não tem a ÂNCORA de uma mesclagem que abrange outras células.
 *         Os dois importam. Num título mesclado de A1 a J1, A1 é a âncora e sai
 *         como texto comum — só B1..J1 vêm cobertas. Uma linha cuja única
 *         célula preenchida é uma âncora já cai em (1), mas quando o leitor
 *         propaga o valor do mestre para as cobertas ela tem 10 células e
 *         passaria; e o fallback, que não olhava mesclagem nenhuma, escolhia
 *         justamente essa linha. Ver o bloco do fallback, abaixo.
 *     (3) tem todas as células preenchidas em TEXTO — cabeçalho não é número;
 *     (4) é seguida por uma linha de dados com ao menos um número ou data —
 *         senão duas linhas de título seguidas enganariam a regra.
 *
 * (4) É PREFERÊNCIA, NÃO EXIGÊNCIA — e o motivo é o uso real: o manual manda
 * enviar a planilha EM BRANCO do cliente, que por definição não tem linha de
 * dados nenhuma. Exigindo (4), nenhuma linha qualificava num modelo em branco e
 * a sugestão caía no fallback. Então: vale a primeira linha que satisfaz (1) a
 * (4); não havendo, a primeira que satisfaz (1) a (3), com um aviso dizendo que
 * a planilha está vazia abaixo do cabeçalho e que é para conferir olhando.
 *
 * SUGESTÃO, NUNCA DECISÃO. O retorno traz `confianca` e os avisos; a tela
 * mostra as primeiras linhas e pede confirmação. Um palpite silencioso sobre
 * qual linha é o cabeçalho é exatamente o tipo de erro que só aparece na
 * medição do cliente.
 */

/** O que uma célula é, sem valor formatado — só o que a heurística precisa. */
export type SnapshotCellType =
  | 'vazio'
  | 'texto'
  | 'numero'
  | 'data'
  | 'booleano'
  | 'formula'
  /** Coberta por uma mesclagem (o valor mora na célula superior esquerda). */
  | 'mesclada'
  | 'erro';

export interface CellSnapshot {
  /** O texto visível, já como string. Vazio quando não há valor. */
  text: string;
  type: SnapshotCellType;
}

export interface SheetSnapshot {
  name: string;
  hidden: boolean;
  /** A aba tem proteção ligada no arquivo. */
  locked: boolean;
  /** Total de linhas que o arquivo declara (não só as lidas em `rows`). */
  rowCount: number;
  columnCount: number;
  /** Intervalos mesclados, como 'A1:E1'. */
  merges: string[];
  /** As primeiras linhas, em ordem, a partir da linha 1. */
  rows: CellSnapshot[][];
}

export interface WorkbookSnapshot {
  sheets: SheetSnapshot[];
}

/** Quantas linhas a leitura precisa trazer para a heurística ter o que olhar. */
export const INSPECT_ROWS = 25;

/* ────────────────────────────── letras ────────────────────────────── */

/** 0 -> 'A', 25 -> 'Z', 26 -> 'AA'. Igual ao do resolvedor, sem importá-lo. */
export function columnLetterOf(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ────────────────────────────── sugestão ────────────────────────────── */

export interface SuggestedColumn {
  /** 1-based, como a coluna do Excel. */
  index: number;
  letter: string;
  /** O texto do cabeçalho, EXATO (com os espaços que o arquivo tem). */
  header: string;
  /** Chave estável sugerida — é o column_key da persistência. */
  key: string;
  /** Cabeçalho vazio no arquivo: a coluna existe, o nome é nosso. */
  semCabecalho: boolean;
}

export interface HeaderSuggestion {
  headerRow: number;
  firstDataRow: number;
  columns: SuggestedColumn[];
  /**
   * 'alta'  — a heurística fechou nas quatro condições;
   * 'baixa' — nenhuma linha fechou e a sugestão é a primeira linha com dados.
   */
  confianca: 'alta' | 'baixa';
  avisos: string[];
}

const PREENCHIDA = new Set<SnapshotCellType>(['texto', 'numero', 'data', 'booleano', 'formula', 'erro']);
const TEXTUAL = new Set<SnapshotCellType>(['texto']);
const DADO = new Set<SnapshotCellType>(['numero', 'data']);

const cheias = (row: CellSnapshot[]) => row.filter(c => PREENCHIDA.has(c.type));
const vazia = (row: CellSnapshot[] | undefined) => !row || cheias(row).length === 0;

/**
 * Chave estável a partir do cabeçalho: sem acento, minúscula, camelo por
 * palavra. Cabeçalho vazio ou repetido cai na letra da coluna, que é única.
 */
export function suggestColumnKey(header: string, letter: string, usadas: Set<string>): string {
  const limpo = header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base = limpo.length
    ? limpo
        .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
        .join('')
        .slice(0, 40)
    : `coluna${letter}`;
  if (/^\d/.test(base)) base = `c${base}`;

  let key = base;
  let n = 2;
  while (usadas.has(key)) key = `${base}${n++}`;
  usadas.add(key);
  return key;
}

/**
 * As colunas que são ÂNCORA de uma mesclagem que abrange mais de uma célula.
 *
 * A âncora é a superior esquerda: é ela que guarda o valor, e por isso ela NÃO
 * aparece como célula coberta nem vem com o tipo 'mesclada'. Num título
 * "RELATÓRIO DE MEDIÇÃO" mesclado de A1 a J1, A1 é texto comum — só B1..J1 são
 * cobertas. Uma linha que contém uma âncora dessas é título, nunca cabeçalho.
 */
export function mergeAnchorColumns(merges: string[], row: number): Set<number> {
  const out = new Set<number>();
  for (const m of merges) {
    const [de, ate] = m.split(':');
    const a = parseRef(de);
    const b = parseRef(ate);
    if (!a || !b) continue;
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);
    // Mesclagem de uma célula só não diz nada sobre a linha.
    if (c1 === c2 && r1 === r2) continue;
    if (row === r1) out.add(c1);
  }
  return out;
}

/** As células que alguma mesclagem COBRE (sem contar a superior esquerda). */
export function mergedCoveredColumns(merges: string[], row: number): Set<number> {
  const out = new Set<number>();
  for (const m of merges) {
    const [de, ate] = m.split(':');
    const a = parseRef(de);
    const b = parseRef(ate);
    if (!a || !b) continue;
    if (row < Math.min(a.row, b.row) || row > Math.max(a.row, b.row)) continue;
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);
    for (let c = c1; c <= c2; c++) {
      // A superior esquerda é a que tem o valor; ela não conta como "coberta".
      if (c === c1 && row === Math.min(a.row, b.row)) continue;
      out.add(c);
    }
  }
  return out;
}

function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/**
 * As colunas para uma linha de cabeçalho ESCOLHIDA (1-based), sem heurística
 * nenhuma.
 *
 * Existe separada de `suggestHeader` porque a tela deixa corrigir a linha: se a
 * correção passasse de novo pela heurística, o app poderia "discordar" da
 * pessoa e voltar para o palpite dele. Escolha manual é escolha manual.
 *
 * Coluna sem cabeçalho E sem nenhum dado abaixo não entra: é sobra de planilha,
 * não coluna do cliente.
 */
export function columnsAt(sheet: SheetSnapshot, headerRow: number): SuggestedColumn[] {
  const i = headerRow - 1;
  const headerCells = sheet.rows[i] ?? [];
  const abaixo = sheet.rows.slice(i + 1);
  const largura = Math.max(headerCells.length, ...sheet.rows.slice(i).map(r => r.length), 0);

  const usadas = new Set<string>();
  const columns: SuggestedColumn[] = [];
  for (let c = 0; c < largura; c++) {
    const cell = headerCells[c];
    const header = cell && PREENCHIDA.has(cell.type) ? cell.text : '';
    const letter = columnLetterOf(c);
    const temDado = abaixo.some(r => r[c] && PREENCHIDA.has(r[c].type));
    if (!header && !temDado) continue;
    columns.push({
      index: c + 1,
      letter,
      header,
      key: suggestColumnKey(header, letter, usadas),
      semCabecalho: !header,
    });
  }
  return columns;
}

/** O que merece ser dito sobre as colunas de uma linha de cabeçalho escolhida. */
export function avisosDasColunas(columns: SuggestedColumn[]): string[] {
  const avisos: string[] = [];
  const repetidos = new Map<string, number>();
  for (const c of columns) {
    if (c.header) repetidos.set(c.header, (repetidos.get(c.header) ?? 0) + 1);
  }
  for (const [texto, n] of repetidos) {
    if (n > 1) avisos.push(`O cabeçalho «${texto}» aparece ${n} vezes; as colunas foram diferenciadas pela letra.`);
  }
  const sem = columns.filter(c => c.semCabecalho);
  if (sem.length > 0) {
    avisos.push(`${sem.length} coluna(s) sem nome no arquivo (${sem.map(c => c.letter).join(', ')}) — dê um nome a elas.`);
  }
  if (columns.length === 0) avisos.push('Nenhuma coluna encontrada nessa linha de cabeçalho.');
  return avisos;
}

/**
 * A linha do cabeçalho e as colunas, sugeridas. Ver a heurística no cabeçalho
 * do arquivo. Nunca lança: aba sem nada devolve confiança baixa e o motivo.
 */
export function suggestHeader(sheet: SheetSnapshot): HeaderSuggestion {
  const avisos: string[] = [];
  if (sheet.hidden) avisos.push(`A aba «${sheet.name}» está oculta no arquivo.`);
  if (sheet.locked) {
    avisos.push(
      `A aba «${sheet.name}» está protegida no arquivo. Dá para ler, mas a planilha gerada sairá protegida para quem receber.`
    );
  }

  const linhas = sheet.rows;

  /** A linha toca alguma mesclagem — como coberta OU como âncora? */
  const tocaMesclagem = (i: number): boolean => {
    const linha1 = i + 1;
    const cobertas = mergedCoveredColumns(sheet.merges, linha1);
    const ancoras = mergeAnchorColumns(sheet.merges, linha1);
    return linhas[i].some((c, j) => c.type === 'mesclada' || cobertas.has(j + 1) || ancoras.has(j + 1));
  };

  /** Candidata: 2+ células, nenhuma mesclagem, tudo texto. Condições 1 a 3. */
  const ehCandidata = (i: number): boolean => {
    const preenchidas = cheias(linhas[i]);
    if (preenchidas.length < 2) return false;
    if (tocaMesclagem(i)) return false;
    return preenchidas.every(c => TEXTUAL.has(c.type));
  };

  let escolhida = -1;
  /** Candidata sem linha de dados abaixo — o caso do MODELO EM BRANCO. */
  let semDados = -1;

  for (let i = 0; i < linhas.length; i++) {
    if (!ehCandidata(i)) continue;

    // Condição 4: a próxima linha com algum conteúdo tem de parecer dado.
    let j = i + 1;
    while (j < linhas.length && vazia(linhas[j])) j++;
    const temDadoAbaixo = j < linhas.length && linhas[j].some(c => DADO.has(c.type));

    if (temDadoAbaixo) {
      escolhida = i;
      break;
    }
    if (semDados < 0) semDados = i;
  }

  let confianca: HeaderSuggestion['confianca'] = 'alta';

  if (escolhida < 0 && semDados >= 0) {
    // SEM LINHA DE DADOS — o caso NORMAL, não a exceção: o manual manda enviar
    // a planilha vazia do cliente, e aí não existe dado para confirmar o
    // cabeçalho. Sem este ramo, nenhuma linha qualificava e a sugestão caía no
    // fallback, que apontava a linha 1 (a âncora do título mesclado).
    //
    // A confiança fica BAIXA de propósito, e não é pessimismo: é exatamente
    // aqui que a pessoa mais precisa olhar, porque não houve dado nenhum para
    // cruzar. Dizer "alta" numa suposição que ninguém conferiu seria mentir com
    // a cor do banner.
    escolhida = semDados;
    confianca = 'baixa';
    avisos.push(
      `Não há linhas de dados abaixo da linha ${escolhida + 1} para confirmar o cabeçalho — o que é o normal num modelo em branco. Confira olhando as linhas acima.`
    );
  }

  if (escolhida < 0) {
    confianca = 'baixa';
    // O fallback TAMBÉM pula linha mesclada: sem isso, um arquivo com título
    // mesclado no topo sempre cairia nele — que é como este defeito apareceu.
    escolhida = linhas.findIndex((r, i) => cheias(r).length > 0 && !tocaMesclagem(i));
    if (escolhida < 0) escolhida = linhas.findIndex(r => cheias(r).length > 0);
    if (escolhida < 0) {
      return {
        headerRow: 1,
        firstDataRow: 2,
        columns: [],
        confianca: 'baixa',
        avisos: [...avisos, `A aba «${sheet.name}» não tem nenhuma linha preenchida.`],
      };
    }
    avisos.push(
      'Não deu para identificar o cabeçalho com segurança; sugerida a primeira linha com conteúdo. Confira antes de seguir.'
    );
  }

  const headerRow = escolhida + 1;
  // Primeira linha com conteúdo depois do cabeçalho; sem nenhuma, a de baixo.
  let dados = escolhida + 1;
  while (dados < linhas.length && vazia(linhas[dados])) dados++;
  const firstDataRow = dados < linhas.length ? dados + 1 : headerRow + 1;
  if (firstDataRow > headerRow + 1) {
    avisos.push(`Entre o cabeçalho (linha ${headerRow}) e os dados (linha ${firstDataRow}) há linhas em branco.`);
  }

  const columns = columnsAt(sheet, headerRow);
  avisos.push(...avisosDasColunas(columns));

  return { headerRow, firstDataRow, columns, confianca, avisos };
}

/* ─────────────────────────── escolha da aba ─────────────────────────── */

export interface SheetSuggestion {
  /** Nome da aba sugerida; vazio quando não há nenhuma utilizável. */
  sheetName: string;
  header: HeaderSuggestion;
  /** Todas as abas, para a pessoa trocar. */
  disponiveis: { name: string; hidden: boolean; locked: boolean; linhas: number }[];
  avisos: string[];
}

/**
 * Qual aba usar: a primeira VISÍVEL cujo cabeçalho a heurística fecha com
 * confiança alta; sem nenhuma, a primeira visível com conteúdo; sem nenhuma
 * visível, a primeira do arquivo (com aviso). Aba oculta nunca é escolhida
 * sozinha — se é a única, a pessoa confirma sabendo disso.
 */
export function suggestSheet(wb: WorkbookSnapshot): SheetSuggestion {
  const disponiveis = wb.sheets.map(s => ({
    name: s.name,
    hidden: s.hidden,
    locked: s.locked,
    linhas: s.rowCount,
  }));
  const avisos: string[] = [];

  if (wb.sheets.length === 0) {
    return {
      sheetName: '',
      header: { headerRow: 1, firstDataRow: 2, columns: [], confianca: 'baixa', avisos: [] },
      disponiveis,
      avisos: ['O arquivo não tem nenhuma aba.'],
    };
  }

  const visiveis = wb.sheets.filter(s => !s.hidden);
  const candidatas = visiveis.length > 0 ? visiveis : wb.sheets;
  if (visiveis.length === 0) avisos.push('Todas as abas do arquivo estão ocultas.');

  let escolhida = candidatas[0];
  let header = suggestHeader(escolhida);
  for (const s of candidatas) {
    const h = suggestHeader(s);
    if (h.confianca === 'alta' && h.columns.length > 0) {
      escolhida = s;
      header = h;
      break;
    }
  }

  if (candidatas.length > 1) {
    avisos.push(
      `O arquivo tem ${wb.sheets.length} abas; a medição será escrita em «${escolhida.name}». As demais saem no arquivo gerado exatamente como estão.`
    );
  }

  return { sheetName: escolhida.name, header, disponiveis, avisos };
}
