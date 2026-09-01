/**
 * CONFLITO DE AGENDA DE PESSOA VINCULADA À DEMANDA — regra pura, fonte única
 *
 * Cobre as duas fontes de ocupação que `hasScheduleConflict` (App.tsx) NÃO
 * enxergava:
 *
 *   • PARTICIPANTE de demanda interna (`demand_participants`) — vínculo novo,
 *     criado na F1 da medição multi-pessoa;
 *   • ACOMPANHANTE de demanda de cliente (`companion_allocations`) — vínculo
 *     que existe desde sempre e nunca ocupou a agenda de ninguém. Achado do
 *     diagnóstico: acompanhar não tornava o instrutor ocupado, então ele podia
 *     ser alocado como titular em outra demanda no mesmo dia, sem aviso. A
 *     assimetria era completa — o drawer CHECAVA conflito para criar o
 *     acompanhante, mas nada checava CONTRA acompanhantes já existentes.
 *
 * As duas entram pela mesma função porque a pergunta é a mesma: "esta pessoa
 * já está comprometida com alguma demanda nestes dias?". O que muda é só a
 * lista de linhas.
 *
 * ---------------------------------------------------------------------------
 * Por que comparação por CONJUNTO DE DIAS, e não por intervalo de Date
 * ---------------------------------------------------------------------------
 * As âncoras 1-3 de `hasScheduleConflict` normalizam para Date de meia-noite e
 * comparam intervalos, com um ramo separado para `DIAS_ESPECIFICOS`. Aqui a
 * conta é feita sobre chaves 'YYYY-MM-DD' produzidas por `getDemandDays` — o
 * mesmo gerador que a agenda e a medição usam. Três ganhos:
 *
 *   1. `DIAS_ESPECIFICOS` deixa de ser um ramo: `getDemandDays` já devolve só
 *      os dias reais da demanda nos dois modos;
 *   2. some o `toDateOnly(cursor.toISOString())` das âncoras 1-2, que converte
 *      um Date local para UTC antes de fatiar a data — inofensivo em
 *      America/Sao_Paulo (offset negativo), errado a leste de Greenwich;
 *   3. a regra fica testável sem montar React — é o que `smoke:participantes`
 *      exercita.
 *
 * ---------------------------------------------------------------------------
 * Divergência deliberada da âncora 2 (`instructor_allocations`)
 * ---------------------------------------------------------------------------
 * A âncora 2 IGNORA `excludeDemandId` — ela só sabe excluir por
 * `excludeAllocationId`. Consequência: checar um instrutor contra a própria
 * demanda em que ele já está alocado devolve conflito consigo mesmo.
 *
 * Aqui `excludeDemandId` É honrado, como na âncora 1. Sem isso o card de
 * Participantes acusaria conflito em todo mundo que já tem vínculo com a
 * demanda que está aberta na tela — um falso positivo garantido, logo no fluxo
 * principal da feature.
 */
import { getDemandDays } from './demandDays';

/** Uma linha de vínculo pessoa↔demanda (participante ou acompanhante). */
export interface PersonAssignmentLike {
  id?: string;
  demandId: string;
  instructorId?: string | null;
  /**
   * Período próprio. Participante usa 'YYYY-MM-DD' (dia inteiro, tudo-ou-nada);
   * acompanhante usa 'YYYY-MM-DDTHH:mm' — os dois são fatiados por
   * `getDemandDays`, então o formato não importa aqui.
   *
   * AUSENTE nos dois = a pessoa acompanha o PERÍODO INTEIRO da demanda.
   */
  startDate?: string | null;
  endDate?: string | null;
}

/** Só o que a regra lê de uma demanda. */
export interface PersonConflictDemandLike {
  id: string;
  status?: string;
  dateMode?: string;
  specificDates?: { data: string; horarioInicio: string; horarioFim: string }[];
  startDate: string;
  endDate: string;
}

export interface PersonScheduleConflictInput {
  instructorId: string;
  /** Período consultado — 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm'. */
  startDate: string;
  endDate: string;
  assignments: PersonAssignmentLike[];
  demands: PersonConflictDemandLike[];
  /** Demanda a ignorar (a que está sendo editada). Ver nota no cabeçalho. */
  excludeDemandId?: string;
  /** Linha a ignorar (ao reeditar o período de um vínculo já existente). */
  excludeAssignmentId?: string;
}

/** Dias 'YYYY-MM-DD' de um intervalo contínuo, via o gerador do domínio. */
const rangeDays = (startDate: string, endDate: string): string[] =>
  getDemandDays({ dateMode: 'CONTINUO', startDate, endDate });

/**
 * Dias em que a pessoa está comprometida por causa DESTE vínculo.
 *
 * Sem período próprio, são todos os dias reais da demanda. Com período
 * próprio, é o recorte dele INTERSECTADO com os dias reais — o que faz a
 * conta certa também em demanda de dias específicos, onde um vínculo que
 * atravessa o intervalo não ocupa os buracos entre os dias cadastrados.
 */
export function assignmentDays(
  assignment: PersonAssignmentLike,
  demand: PersonConflictDemandLike
): string[] {
  const demandDays = getDemandDays(demand);
  if (!assignment.startDate || !assignment.endDate) return demandDays;

  const own = new Set(rangeDays(assignment.startDate, assignment.endDate));
  return demandDays.filter(d => own.has(d));
}

/**
 * `true` se a pessoa já está comprometida em algum dia do período consultado.
 *
 * Demanda CANCELADA libera a agenda, e vínculo órfão (demanda inexistente no
 * dataset) é ignorado — mesmo par de guardas da âncora 2, que espelha o filtro
 * da própria grade da agenda.
 */
export function hasPersonScheduleConflict({
  instructorId,
  startDate,
  endDate,
  assignments,
  demands,
  excludeDemandId,
  excludeAssignmentId,
}: PersonScheduleConflictInput): boolean {
  if (!instructorId) return false;

  const reqDays = new Set(rangeDays(startDate, endDate));
  if (reqDays.size === 0) return false;

  const demandById = new Map(demands.map(d => [d.id, d]));

  return (assignments ?? []).some(a => {
    if (excludeAssignmentId && a.id === excludeAssignmentId) return false;
    if (a.instructorId !== instructorId) return false;
    if (excludeDemandId && a.demandId === excludeDemandId) return false;

    const demand = demandById.get(a.demandId);
    if (!demand || demand.status === 'CANCELADA') return false;

    return assignmentDays(a, demand).some(day => reqDays.has(day));
  });
}
