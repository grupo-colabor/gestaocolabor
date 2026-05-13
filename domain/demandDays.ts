/**
 * HELPER CENTRAL — Dias da Demanda
 *
 * Fonte única de verdade para obter os dias reais de uma demanda.
 * TODOS os componentes que iteram sobre dias de demanda devem usar estas funções.
 */

interface DemandLike {
  dateMode?: 'CONTINUO' | 'DIAS_ESPECIFICOS' | string;
  specificDates?: { data: string; horarioInicio: string; horarioFim: string }[];
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
    return [...new Set(demand.specificDates.map(e => e.data))].sort();
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
    return demand.specificDates.some(e => e.data === key);
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
    return demand.specificDates.some(e => {
      const dk = e.data;
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
  specificDatesB?: { data: string; horarioInicio: string; horarioFim: string }[]
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

/**
 * Retorna o horarioInicio para um dia específico da demanda.
 * - DIAS_ESPECIFICOS: usa o horarioInicio do specificDate correspondente
 * - CONTINUO: todos os dias herdam a hora do startDate (turno único)
 */
export function getDayHorarioInicio(demand: DemandLike, dayKey: string): string {
  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates)) {
    const entry = demand.specificDates.find(e => e.data === dayKey);
    if (entry?.horarioInicio) return entry.horarioInicio;
  }
  const s = String(demand.startDate ?? '');
  const timePart = s.length >= 16 ? s.slice(11, 16) : '';
  return timePart || '08:00';
}

/**
 * Monta o label do card da agenda para um dia específico.
 * Fonte única de verdade — usar em todos os caminhos de renderização.
 *
 * Formato: "DEM-XXX • EMPRESA • TREINAMENTO (N)"
 * O sufixo (N) é adicionado quando hora_inicio >= 18:00 ou < 06:00.
 */
export function buildCardLabel(
  demand: DemandLike & { id: string },
  dayKey: string,
  opts: { companyName?: string; trainingNr?: string }
): string {
  const base = [demand.id, opts.companyName, opts.trainingNr]
    .filter(Boolean)
    .join(' • ');
  const h = getDayHorarioInicio(demand, dayKey);
  const nightTag = (h >= '18:00' || h < '06:00') ? ' (N)' : '';
  return `${base}${nightTag}`;
}

/**
 * Verifica se um dia específico da demanda tem turno noturno:
 * início >= 18:00 ou término > 22:00.
 */
export function isDayNight(demand: DemandLike, dayKey: string): boolean {
  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates)) {
    const entry = demand.specificDates.find(e => e.data === dayKey);
    if (entry) return entry.horarioInicio >= '18:00' || entry.horarioFim > '22:00';
  }
  // CONTINUO: todos os dias herdam o turno do start/end da demanda
  const s = String(demand.startDate ?? '');
  const e = String(demand.endDate ?? '');
  const st = s.length >= 16 ? s.slice(11, 16) : '';
  const et = e.length >= 16 ? e.slice(11, 16) : '';
  return (!!st && st >= '18:00') || (!!et && et > '22:00');
}

/**
 * Retorna true se a demanda tem qualquer dia/turno noturno:
 * início >= 18:00 ou término > 22:00.
 * Para cards de lista e cabeçalho de detalhe.
 */
export function isNightDemand(demand: DemandLike): boolean {
  if (demand.dateMode === 'DIAS_ESPECIFICOS' && Array.isArray(demand.specificDates) && demand.specificDates.length > 0) {
    return demand.specificDates.some(e => e.horarioInicio >= '18:00' || e.horarioFim > '22:00');
  }
  return isDayNight(demand, '');
}

// Re-export toDateKey para uso em outros componentes
export { toDateKey };
