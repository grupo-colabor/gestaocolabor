/**
 * HELPER CENTRAL — Dias da Demanda
 *
 * Fonte única de verdade para obter os dias reais de uma demanda.
 * TODOS os componentes que iteram sobre dias de demanda devem usar estas funções.
 */

interface DemandLike {
  dateMode?: 'CONTINUO' | 'DIAS_ESPECIFICOS' | string;
  specificDates?: string[];  // ['2026-02-12', '2026-02-13', ...]
  startDate: string;         // 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm'
  endDate: string;
}

/** Extrai 'YYYY-MM-DD' de qualquer formato de data */
const toDateKey = (v: string | Date): string => {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v ?? '').trim();
  return s.slice(0, 10); // 'YYYY-MM-DD'
};

/** Gera todos os dias entre duas datas (inclusive), retornando ['YYYY-MM-DD', ...] */
const generateContinuousDays = (startStr: string, endStr: string): string[] => {
  const start = toDateKey(startStr);
  const end = toDateKey(endStr);
  if (!start || !end || start > end) return [];

  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00`); // meio-dia para evitar DST
  const endDate = new Date(`${end}T12:00:00`);

  while (cursor <= endDate) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

/**
 * Retorna array de 'YYYY-MM-DD' com os dias reais da demanda.
 * - CONTINUO: gera todos os dias entre startDate e endDate
 * - DIAS_ESPECIFICOS: retorna specificDates (ordenado, sem duplicatas)
 */
export function getDemandDays(demand: DemandLike): string[] {
  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0) {
    return [...new Set(demand.specificDates)].sort();
  }
  return generateContinuousDays(demand.startDate, demand.endDate);
}

/**
 * Retorna os limites min/max da demanda como { startKey, endKey } (strings 'YYYY-MM-DD').
 * Sempre derivados de startDate/endDate (que são auto-calculados no save).
 */
export function getDemandBounds(demand: DemandLike): { startKey: string; endKey: string } {
  return {
    startKey: toDateKey(demand.startDate),
    endKey: toDateKey(demand.endDate),
  };
}

/**
 * Verifica se um dia específico faz parte da demanda.
 */
export function isDemandDay(demand: DemandLike, date: Date | string): boolean {
  const key = toDateKey(date);
  if (!key) return false;

  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0) {
    return demand.specificDates.includes(key);
  }

  // CONTINUO: verifica se está dentro do range
  const start = toDateKey(demand.startDate);
  const end = toDateKey(demand.endDate);
  return key >= start && key <= end;
}

/**
 * Verifica se a demanda intersecta um range de filtro [from, to].
 * - CONTINUO: range overlap padrão
 * - DIAS_ESPECIFICOS: true se QUALQUER dia específico cair no range
 */
export function demandIntersectsRange(demand: DemandLike, from?: string, to?: string): boolean {
  const fromKey = from ? toDateKey(from) : '';
  const toKey = to ? toDateKey(to) : '';

  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0) {
    return demand.specificDates.some(d => {
      const dk = toDateKey(d);
      if (fromKey && dk < fromKey) return false;
      if (toKey && dk > toKey) return false;
      return true;
    });
  }

  // CONTINUO: overlap padrão
  const dStart = toDateKey(demand.startDate);
  const dEnd = toDateKey(demand.endDate);
  if (fromKey && dEnd < fromKey) return false;
  if (toKey && dStart > toKey) return false;
  return true;
}

/**
 * Verifica se dois conjuntos de dias têm sobreposição (pelo menos 1 dia em comum).
 * Usado para detecção de conflitos na agenda.
 *
 * @param demandA — a demanda existente
 * @param startB / endB — limites do período B
 * @param dateModeB / specificDatesB — modo e datas do período B (opcional: se não vier, assume CONTINUO)
 */
export function demandDaysOverlap(
  demandA: DemandLike,
  startB: string,
  endB: string,
  dateModeB?: string,
  specificDatesB?: string[]
): boolean {
  const daysA = new Set(getDemandDays(demandA));
  const daysB = getDemandDays({
    dateMode: dateModeB || 'CONTINUO',
    specificDates: specificDatesB,
    startDate: startB,
    endDate: endB,
  });

  return daysB.some(day => daysA.has(day));
}

/**
 * Cria o Set de dias para lookup O(1), útil nos loops de agenda.
 */
export function getDemandDaySet(demand: DemandLike): Set<string> {
  return new Set(getDemandDays(demand));
}

// Re-export toDateKey para uso em outros componentes
export { toDateKey };
