/**
 * VOLUME POR PERÍODO — a conta ÚNICA de "quantas demandas / quantas horas /
 * quanto custou" do Dashboard.
 *
 * O Dashboard recorta as demandas em P1…PN (o filtro principal e os períodos
 * extras de comparação) e, sobre cada recorte, faz a mesma pergunta em vários
 * lugares: nos KPIs do topo ("Total de Demandas", "Total de Horas", "Total em
 * Despesas"), no gráfico "Volume por Região" e em TODOS os cartões de ranking
 * das seis abas (Local, Corredor, UF, Top Treinamentos, Demandas por
 * Instrutor, Clientes mais Ativos, Top Instrutores por Custo, Reaproveitamento,
 * Distribuição por Categoria das internas…).
 *
 * `computeVolume` é essa pergunta. Recebe um recorte já filtrado e devolve
 * contagem, horas, custo e nº de valores distintos. Só isso — quem filtra é
 * quem chama.
 *
 * `rankVolumeByPeriod` é o ranking dos cartões: agrupa cada recorte por uma
 * chave (local, treinamento, instrutor, empresa…) e, para cada grupo em cada
 * período, chama `computeVolume` sobre o sub-recorte. Não existe uma terceira
 * soma: o número de "Volume por Local → Brucutu → P1" é, por construção, o que
 * "Total de Demandas → P1" mostraria com o filtro "Local = Brucutu" ligado.
 * O smoke (scripts/smokeDashboardVolume.ts) prende essa igualdade, cartão a
 * cartão.
 *
 * `rankVolumeRows` é a metade de baixo de `rankVolumeByPeriod` (ordem, limite,
 * "Outros", escala) exposta à parte, para os cartões cuja célula NÃO é uma
 * soma de demandas: "Horas Ministradas por Instrutor" e "Top Instrutores em
 * Horas Internas" leem `computeInstructorHours` (domain/instructorHours.ts),
 * que já é a fonte única das horas rateadas por alocação. Reimplementar esse
 * rateio aqui seria exatamente a terceira conta que este módulo existe para
 * evitar; então essas linhas nascem de `volumeRowsFromInstructorHours`, um
 * adaptador sem aritmética, e passam pelo mesmo ranqueamento.
 *
 * POR QUE A CHAVE É O TEXTO CRU, SEM TRIM
 * ---------------------------------------------------------------------------
 * O filtro "Local" da tela compara `(d.trainingLocal ?? '') !== filtro`, letra
 * por letra, e as opções do select são os valores crus das demandas. Se o
 * ranking normalizasse ("Brucutu " → "Brucutu"), o cartão somaria duas grafias
 * num nome só e o filtro por esse nome mostraria menos — a igualdade acima
 * quebraria em silêncio. Então a chave é o texto como está; só o vazio (ou
 * só-espaços) fica de fora, porque não há como filtrar por ele.
 *
 * "N.A" NÃO É VAZIO. Demandas antigas gravaram o corredor como o texto "N.A";
 * isso é dado, aparece no ranking e no filtro, e não é papel desta função
 * esconder ou renomear.
 */
import type { InstructorHoursEntry } from './instructorHours';

export interface VolumeTotals {
  /** Quantidade de demandas do recorte. */
  count: number;
  /** Soma das horas do recorte (a carga que `hoursOf` devolve para cada demanda). */
  hours: number;
  /** Soma do custo do recorte (o que `costOf` devolve para cada demanda); 0 sem `costOf`. */
  cost: number;
  /**
   * Nº de valores DISTINTOS de `distinctOf` no recorte (ex.: treinamentos
   * distintos concluídos por um instrutor); 0 sem `distinctOf`. Em "Outros"
   * as linhas ocultas têm seus distintos SOMADOS — é "o total das linhas
   * escondidas", não "distintos da união".
   */
  distinct: number;
}

export type VolumeMetric = keyof VolumeTotals;

export const ZERO_VOLUME: Readonly<VolumeTotals> = Object.freeze({ count: 0, hours: 0, cost: 0, distinct: 0 });

export interface VolumeExtras<T> {
  /** Custo de uma demanda (ex.: soma dos itens das medições dela). */
  costOf?: (d: T) => number;
  /** Valor cujos distintos se contam (ex.: trainingId). Vazio/nulo não conta. */
  distinctOf?: (d: T) => string | null | undefined;
}

/**
 * Contagem, horas, custo e distintos de UM recorte já filtrado.
 *
 * `hoursOf` e `costOf` são injetados porque a carga e o custo de uma demanda
 * são decisão de quem chama (o Dashboard usa a carga nominal do treinamento,
 * a mesma de "Total de Horas", e a soma dos itens de medição, a mesma de
 * "Total em Despesas"); esta função não sabe o que é um treinamento nem uma
 * medição.
 */
export function computeVolume<T>(
  demands: readonly T[],
  hoursOf: (d: T) => number,
  extras: VolumeExtras<T> = {},
): VolumeTotals {
  let hours = 0;
  let cost = 0;
  const distintos = extras.distinctOf ? new Set<string>() : null;
  for (const d of demands) {
    hours += Number(hoursOf(d)) || 0;
    if (extras.costOf) cost += Number(extras.costOf(d)) || 0;
    if (distintos) {
      const v = extras.distinctOf!(d);
      if (v !== null && v !== undefined && String(v) !== '') distintos.add(String(v));
    }
  }
  return { count: demands.length, hours, cost, distinct: distintos ? distintos.size : 0 };
}

/** Lê a métrica pedida de um VolumeTotals. */
export function volumeValue(t: VolumeTotals, metric: VolumeMetric): number {
  return t[metric];
}

export interface VolumeRankRow {
  /** A chave de agrupamento (o que o filtro compararia: trainingId, instructorId, texto do local…). */
  key: string;
  /** O que a tela mostra (nome do treinamento, do instrutor…; igual à chave quando não há `labelOf`). */
  name: string;
  /** Um VolumeTotals por período, na ordem de entrada (P1 primeiro). */
  periods: VolumeTotals[];
  /** Texto curto que a tela pode pendurar na linha (ex.: "2 div."). Só apresentação. */
  note?: string;
}

export interface VolumeRanking {
  /** As `limit` primeiras linhas, ordenadas por P1 (desc) e nome. */
  items: VolumeRankRow[];
  /** As demais, na mesma ordem — o conteúdo de "Outros" quando expandido. */
  othersDetail: VolumeRankRow[];
  /** Soma de `othersDetail` por período; null quando não há o que agrupar. */
  others: VolumeRankRow | null;
  /**
   * Maior valor da métrica entre TODAS as linhas (items + othersDetail) em
   * TODOS os períodos. É o 100% das barras, para uma barra de P2 numa linha
   * ser comparável a uma barra de P1 em outra.
   */
  max: number;
}

const somaTotais = (a: VolumeTotals, b: VolumeTotals): VolumeTotals => ({
  count: a.count + b.count,
  hours: a.hours + b.hours,
  cost: a.cost + b.cost,
  distinct: a.distinct + b.distinct,
});

/**
 * Ordem, limite, "Outros" e escala sobre linhas já prontas.
 *
 * - Linha com a métrica ZERO em todos os períodos sai: não há o que ranquear
 *   (um instrutor com demandas mas sem despesa não aparece em "por Custo").
 * - Ordem: métrica de P1 decrescente; empate pelo nome (pt-BR).
 * - `others` soma `othersDetail` período a período; `limit` infinito = sem "Outros".
 */
export function rankVolumeRows(rows: readonly VolumeRankRow[], metric: VolumeMetric, limit = 10): VolumeRanking {
  const vivas = rows.filter(r => r.periods.some(t => volumeValue(t, metric) !== 0));
  const p1 = (r: VolumeRankRow) => volumeValue(r.periods[0] ?? ZERO_VOLUME, metric);
  const ordenadas = [...vivas].sort((a, b) => (p1(b) - p1(a)) || a.name.localeCompare(b.name, 'pt-BR'));

  const items = ordenadas.slice(0, limit);
  const othersDetail = ordenadas.slice(limit);
  const nPeriods = rows[0]?.periods.length ?? 0;

  const others: VolumeRankRow | null = othersDetail.length === 0
    ? null
    : {
        key: '__outros__',
        name: 'Outros',
        periods: Array.from({ length: nPeriods }, (_, i) =>
          othersDetail.reduce<VolumeTotals>((acc, r) => somaTotais(acc, r.periods[i] ?? ZERO_VOLUME), { ...ZERO_VOLUME }),
        ),
      };

  let max = 0;
  for (const r of ordenadas) for (const t of r.periods) max = Math.max(max, volumeValue(t, metric));

  return { items, othersDetail, others, max };
}

export interface RankVolumeOptions<T> extends VolumeExtras<T> {
  /** Os recortes P1…PN, já filtrados (P1 = filtro principal). */
  periods: readonly (readonly T[])[];
  /** A chave de agrupamento (local, trainingId, instructorId…). Vazio/só-espaços é descartado. */
  keyOf: (d: T) => string | null | undefined;
  /** O rótulo da chave para a tela (nome do treinamento, do instrutor…). Padrão: a própria chave. */
  labelOf?: (key: string) => string;
  /** A carga de cada demanda — a mesma que os KPIs do topo usam. */
  hoursOf: (d: T) => number;
  /** Métrica que ordena, define `max` e é a que a tela mostra. */
  metric: VolumeMetric;
  /** Quantas linhas ficam fora de "Outros". Padrão 10, como o cartão de Local sempre teve. */
  limit?: number;
}

/**
 * Ranking por chave, com um VolumeTotals por período em cada linha.
 *
 * Uma chave que aparece em QUALQUER período vira linha; nos períodos em que
 * não aparece, a linha traz ZERO_VOLUME. Um local que só existe em P2
 * aparece com P1 = 0 — não some. O resto (ordem, limite, Outros, escala) é
 * `rankVolumeRows`.
 */
export function rankVolumeByPeriod<T>(opts: RankVolumeOptions<T>): VolumeRanking {
  const { periods, keyOf, hoursOf, metric, costOf, distinctOf } = opts;
  const labelOf = opts.labelOf ?? ((key: string) => key);
  const nPeriods = periods.length;

  // Um balde por (chave, período): o sub-recorte do grupo naquele período.
  const buckets = new Map<string, T[][]>();
  periods.forEach((recorte, i) => {
    for (const d of recorte) {
      const key = String(keyOf(d) ?? '');
      if (!key.trim()) continue;
      let porPeriodo = buckets.get(key);
      if (!porPeriodo) {
        porPeriodo = Array.from({ length: nPeriods }, () => [] as T[]);
        buckets.set(key, porPeriodo);
      }
      porPeriodo[i].push(d);
    }
  });

  // A conta de cada célula é computeVolume sobre o sub-recorte — a mesma
  // função dos KPIs, aplicada ao que o filtro por essa chave devolveria.
  const rows: VolumeRankRow[] = [...buckets.entries()].map(([key, porPeriodo]) => ({
    key,
    name: labelOf(key),
    periods: porPeriodo.map(sub => computeVolume(sub, hoursOf, { costOf, distinctOf })),
  }));

  return rankVolumeRows(rows, metric, opts.limit ?? 10);
}

export interface InstructorHoursRowsOptions {
  /** Nome do instrutor para a tela. Padrão: o próprio id. */
  labelOf?: (instructorId: string) => string;
  /** Quais instrutores entram (ex.: só ATIVO). Padrão: todos que têm entrada em algum período. */
  include?: (instructorId: string) => boolean;
}

/**
 * Linhas de ranking a partir dos mapas de `computeInstructorHours`, um por
 * período (P1 primeiro) — os mesmos mapas que dão "Horas Concluídas" e
 * "Produtividade Global". Adaptador SEM aritmética: `hours` é `horas`,
 * `count` é `nDemandas`, e a nota é o "N div." de P1. Um instrutor presente
 * em qualquer período vira linha; onde falta, ZERO_VOLUME.
 */
export function volumeRowsFromInstructorHours(
  mapsByPeriod: ReadonlyArray<ReadonlyMap<string, InstructorHoursEntry>>,
  opts: InstructorHoursRowsOptions = {},
): VolumeRankRow[] {
  const labelOf = opts.labelOf ?? ((id: string) => id);
  const ids = new Set<string>();
  for (const m of mapsByPeriod) for (const id of m.keys()) ids.add(id);

  const rows: VolumeRankRow[] = [];
  for (const id of ids) {
    if (opts.include && !opts.include(id)) continue;
    const periods = mapsByPeriod.map(m => {
      const e = m.get(id);
      return e ? { count: e.nDemandas, hours: e.horas, cost: 0, distinct: 0 } : { ...ZERO_VOLUME };
    });
    const divididas = mapsByPeriod[0]?.get(id)?.nDivididas ?? 0;
    rows.push({ key: id, name: labelOf(id), periods, note: divididas > 0 ? `${divididas} div.` : undefined });
  }
  return rows;
}

export interface VolumeVariation {
  /** P1 − P2. */
  delta: number;
  /** delta / P2, em % inteiro; null quando P2 é zero (não há base). */
  pct: number | null;
}

/**
 * Variação de P1 contra P2, no mesmo contrato dos KPIs do topo: diferença
 * absoluta e percentual sobre a base, sem percentual quando a base é zero.
 * Só P2 — contra P3/P4 vira poluição e a tela não mostra.
 */
export function volumeVariation(p1: number, p2: number): VolumeVariation {
  const delta = p1 - p2;
  const pct = p2 !== 0 ? Math.round((delta / p2) * 100) : null;
  return { delta, pct };
}
