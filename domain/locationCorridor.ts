/**
 * LOCAL → CORREDOR — a regra ÚNICA de casamento de nome sobre `location_associations`
 *
 * O cadastro Cadastros → Associações → Locais — Demandas guarda, para cada
 * local, o corredor / UF / região dele. Quem LÊ a tabela continua sendo um só:
 * `services/locationAssociations.fetchLocationAssociations`. O que mora aqui é
 * a outra metade — COMO se acha a linha do local — e ela é única de propósito.
 *
 * ⚠️ SÓ O CONJUNTO 'cliente'. São dois conjuntos independentes (migration 014):
 * a cascata do formulário de demanda de CLIENTE lê 'cliente', a da demanda
 * INTERNA lê 'interna', e um local criado num não aparece no outro. Quem chama
 * já pede o conjunto certo ao service; `findLocationAssociation` ainda assim
 * descarta linha de outro contexto quando o campo vem preenchido, porque
 * misturar os dois é exatamente o bug que a 014 existe para evitar — e um
 * filtro que some com a associação certa é muito mais difícil de enxergar do
 * que um que não acha nenhuma.
 *
 * POR QUE UMA FUNÇÃO E NÃO UM `find` EM CADA TELA
 * ---------------------------------------------------------------------------
 * Até 23/09/2026 o casamento era `a.local === value`, escrito dentro de
 * `components/Demands.tsx`. Duas telas com o mesmo `find` copiado divergem no
 * primeiro dia em que uma delas precisa ignorar acento — e aí o formulário
 * preenche o corredor de "Cauê" e o filtro da medição não, sem que nada
 * pareça quebrado. Uma função só: as duas acertam ou as duas erram junto.
 *
 * A COMPARAÇÃO IGNORA CAIXA, ACENTO E ESPAÇO REPETIDO, mas o EXATO vence.
 * O cadastro é digitado por gente, e "CAUE", "Cauê" e "cauê " são o mesmo
 * lugar. O índice único do banco é por texto exato (`local, contexto`), então
 * nada impede duas linhas que só diferem em acento; quando isso acontece, a
 * que bate LETRA POR LETRA é a escolhida, e só depois a normalizada. Assim um
 * local com cadastro próprio nunca é atendido pelo quase-homônimo.
 */

/** O mínimo que este domínio lê de `location_associations`. */
export interface LocationAssociationLike {
  local: string;
  corredor: string;
  uf?: string;
  regiao?: string;
  /** 'cliente' | 'interna'. Ausente = a lista já veio filtrada pelo service. */
  contexto?: string;
}

/** Caixa, acento e espaço repetido fora — a chave de comparação de nome. */
export function normalizeLocationName(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Linha do conjunto 'cliente'? (sem contexto declarado, assume que sim) */
const doCliente = (a: LocationAssociationLike): boolean => !a.contexto || a.contexto === 'cliente';

/**
 * A associação do local, ou null. Exato primeiro, normalizado depois — ver o
 * cabeçalho. 'N/A' nunca casa: é o valor de "sem local", não um lugar.
 */
export function findLocationAssociation<A extends LocationAssociationLike>(
  local: string,
  associacoes: A[]
): A | null {
  const bruto = String(local ?? '').trim();
  if (!bruto || bruto === 'N/A') return null;
  const doConjunto = associacoes.filter(doCliente);
  const exato = doConjunto.find(a => String(a.local ?? '').trim() === bruto);
  if (exato) return exato;
  const chave = normalizeLocationName(bruto);
  return doConjunto.find(a => normalizeLocationName(a.local) === chave) ?? null;
}

/** O corredor associado ao local, ou '' quando o local não está no cadastro. */
export function resolveCorredorDoLocal(local: string, associacoes: LocationAssociationLike[]): string {
  return String(findLocationAssociation(local, associacoes)?.corredor ?? '').trim();
}

/**
 * O local pertence a este corredor SEGUNDO O CADASTRO?
 *
 * Local SEM associação devolve `false` — ele não pertence a corredor nenhum.
 * Quem usa isso para DESCARTAR algo (limpar um filtro, esconder uma opção)
 * precisa tratar o "sem associação" à parte: ausência de cadastro não é prova
 * de que o local seja de outro corredor.
 */
export function localPertenceAoCorredor(
  local: string,
  corredor: string,
  associacoes: LocationAssociationLike[]
): boolean {
  const alvo = normalizeLocationName(corredor);
  if (!alvo) return false;
  const doLocal = resolveCorredorDoLocal(local, associacoes);
  return !!doLocal && normalizeLocationName(doLocal) === alvo;
}

/**
 * Separa uma lista de locais em "os deste corredor" e "os demais", na ordem em
 * que chegaram. NENHUM local é descartado: a soma dos dois grupos é a lista de
 * entrada. Sem corredor, tudo cai em `outros` e quem exibe mostra lista única.
 */
export function separarLocaisPorCorredor(
  locais: string[],
  corredor: string,
  associacoes: LocationAssociationLike[]
): { associados: string[]; outros: string[] } {
  if (!corredor) return { associados: [], outros: [...locais] };
  const associados: string[] = [];
  const outros: string[] = [];
  for (const l of locais) {
    (localPertenceAoCorredor(l, corredor, associacoes) ? associados : outros).push(l);
  }
  return { associados, outros };
}
