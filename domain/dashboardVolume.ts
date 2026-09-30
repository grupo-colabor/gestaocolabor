/**
 * VOLUME POR PERÍODO — a conta ÚNICA de "quantas demandas / quantas horas" do
 * Dashboard Gerencial.
 *
 * O Dashboard recorta as demandas em P1…PN (o filtro principal e os períodos
 * extras de comparação) e, sobre cada recorte, mostra a mesma pergunta em três
 * lugares: nos KPIs do topo ("Total de Demandas", "Total de Horas"), no gráfico
 * "Volume por Região" e nos três cartões de ranking (Local, Corredor, UF).
 *
 * `computeVolume` é essa pergunta. Recebe um recorte já filtrado e devolve
 * contagem e horas. Só isso — quem filtra é quem chama.
 *
 * `rankVolumeByPeriod` é o ranking dos cartões: agrupa cada recorte por uma
 * chave (local, corredor, UF) e, para cada grupo em cada período, chama
 * `computeVolume` sobre o sub-recorte do grupo. Não existe uma terceira soma:
 * o número de "Volume por Local → Brucutu → P1" é, por construção, o que
 * "Total de Demandas → P1" mostraria com o filtro "Local = Brucutu" ligado.
 * O smoke (scripts/smokeDashboardVolume.ts) prende essa igualdade.
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

export interface VolumeTotals {
  /** Quantidade de demandas do recorte. */
  count: number;
  /** Soma das horas do recorte (a carga que `hoursOf` devolve para cada demanda). */
  hours: number;
}

export type VolumeMetric = 'count' | 'hours';

/**
 * Contagem e horas de UM recorte já filtrado.
 *
 * `hoursOf` é injetado porque a carga de uma demanda é decisão de quem chama
 * (hoje o Dashboard usa a carga nominal do treinamento, a mesma de
 * "Total de Horas"); esta função não sabe o que é um treinamento.
 */
export function computeVolume<T>(demands: readonly T[], hoursOf: (d: T) => number): VolumeTotals {
  let hours = 0;
  for (const d of demands) hours += Number(hoursOf(d)) || 0;
  return { count: demands.length, hours };
}

/** Lê a métrica pedida de um VolumeTotals. */
export function volumeValue(t: VolumeTotals, metric: VolumeMetric): number {
  return metric === 'count' ? t.count : t.hours;
}

export interface VolumeRankRow {
  name: string;
  /** Um VolumeTotals por período, na ordem de entrada (P1 primeiro). */
  periods: VolumeTotals[];
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

export interface RankVolumeOptions<T> {
  /** Os recortes P1…PN, já filtrados (P1 = filtro principal). */
  periods: readonly (readonly T[])[];
  /** A chave de agrupamento (local, corredor, UF). Vazio/só-espaços é descartado. */
  keyOf: (d: T) => string | null | undefined;
  /** A carga de cada demanda — a mesma que os KPIs do topo usam. */
  hoursOf: (d: T) => number;
  /** Métrica que ordena, define `max` e é a que a tela mostra. */
  metric: VolumeMetric;
  /** Quantas linhas ficam fora de "Outros". Padrão 10, como o cartão sempre teve. */
  limit?: number;
}

/**
 * Ranking por chave, com um VolumeTotals por período em cada linha.
 *
 * - Uma chave que aparece em QUALQUER período vira linha; nos períodos em que
 *   não aparece, a linha traz {count: 0, hours: 0}. Um local que só existe em
 *   P2 aparece com P1 = 0 — não some.
 * - Ordem: métrica de P1 decrescente; empate pelo nome (pt-BR).
 * - `others` soma `othersDetail` período a período.
 */
export function rankVolumeByPeriod<T>(opts: RankVolumeOptions<T>): VolumeRanking {
  const { periods, keyOf, hoursOf, metric } = opts;
  const limit = opts.limit ?? 10;
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
  const rows: VolumeRankRow[] = [...buckets.entries()].map(([name, porPeriodo]) => ({
    name,
    periods: porPeriodo.map(sub => computeVolume(sub, hoursOf)),
  }));

  const p1 = (r: VolumeRankRow) => volumeValue(r.periods[0], metric);
  rows.sort((a, b) => (p1(b) - p1(a)) || a.name.localeCompare(b.name, 'pt-BR'));

  const items = rows.slice(0, limit);
  const othersDetail = rows.slice(limit);

  const others: VolumeRankRow | null = othersDetail.length === 0
    ? null
    : {
        name: 'Outros',
        periods: Array.from({ length: nPeriods }, (_, i) => othersDetail.reduce<VolumeTotals>(
          (acc, r) => ({ count: acc.count + r.periods[i].count, hours: acc.hours + r.periods[i].hours }),
          { count: 0, hours: 0 },
        )),
      };

  let max = 0;
  for (const r of rows) for (const t of r.periods) max = Math.max(max, volumeValue(t, metric));

  return { items, othersDetail, others, max };
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
