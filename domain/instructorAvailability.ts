/**
 * DISPONIBILIDADE DE INSTRUTOR — a regra única
 *
 * Extraído de `Dashboard.tsx` (card "Disponíveis (30d)" / lista "Disponíveis
 * nos Próximos 30 Dias" da aba INSTRUTORES), onde vivia solto dentro do
 * `renderInstrutores`. A regra é a MESMA, palavra por palavra; o que mudou é
 * ter um lugar só, verificável por execução (scripts/smokeDashboardInternas.ts).
 *
 * ---------------------------------------------------------------------------
 * A regra, exatamente como era
 * ---------------------------------------------------------------------------
 *  1. Instrutor entra na conta se `status === 'ATIVO'`.
 *  2. Uma demanda OCUPA o instrutor quando, ao mesmo tempo:
 *       - o status calculado não é 'CANCELADA' nem 'CONCLUIDA';
 *       - tem `instructorId`;
 *       - o intervalo [startDate, endDate] cruza a janela: `end >= from` e
 *         `start <= to`.
 *  3. Disponível = ativo que nenhuma demanda ocupa.
 *
 * ⚠️ O que a regra NÃO olha (e nunca olhou): registros de AGENDA. Férias,
 * folga e indisponibilidade em `agenda_items` são invisíveis aqui — um
 * instrutor de férias aparece como "disponível". Também não olha
 * `instructor_allocations`: a ocupação vem de `demands.instructor_id`, então
 * acompanhante alocado sem ser o instrutor principal não conta como ocupado.
 * Isso é herdado, não introduzido — está documentado para a decisão de mudar
 * (ou não) ser consciente.
 *
 * ---------------------------------------------------------------------------
 * `countsAsBusy`: por que existe
 * ---------------------------------------------------------------------------
 * O card "Cobertura de Ociosidade" (aba INTERNAS) pergunta: dos instrutores
 * OCIOSOS, quantos receberam demanda interna? Com a regra crua isso é sempre
 * ZERO — receber uma interna cria uma demanda com `instructorId` na janela, o
 * que por definição tira o instrutor de "disponível". A pergunta se anula.
 *
 * Então aquele card mede ociosidade contra o trabalho de CLIENTE
 * (`countsAsBusy: d => !isInternal(d)`) e depois conta quantos desses ociosos
 * receberam interna. A regra de disponibilidade continua uma só; o que o
 * chamador escolhe é o conjunto de demandas contra o qual ela é aplicada.
 * Sem o parâmetro, o comportamento é o histórico: toda demanda ocupa.
 */

/** Só o que a regra lê de um instrutor. */
export interface AvailabilityInstructor {
  id: string;
  status?: string | null;
}

/** Só o que a regra lê de uma demanda. */
export interface AvailabilityDemand {
  /** Usado só para citar a demanda na UI (ex.: "DEM-1513"). */
  id?: string;
  instructorId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** Janela fechada [from, to] contra a qual a ocupação é medida. */
export interface AvailabilityWindow {
  from: Date;
  to: Date;
}

export interface AvailabilityOptions<D> {
  /**
   * Status calculado da demanda. O Dashboard passa o próprio
   * `getCalculatedStatus` (que embrulha `calculateDemandStatus` com a
   * modalidade efetiva), para que a extração não mude nada.
   */
  statusOf: (demand: D) => string;
  /**
   * Quais demandas contam como ocupação. Default: todas — o comportamento
   * histórico. Ver o cabeçalho para o caso da Cobertura de Ociosidade.
   */
  countsAsBusy?: (demand: D) => boolean;
}

/** Janela padrão do card da aba INSTRUTORES: de hoje até 30 dias à frente. */
export function defaultAvailabilityWindow(today: Date): AvailabilityWindow {
  return { from: today, to: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) };
}

const STATUSES_THAT_FREE_THE_INSTRUCTOR = ['CANCELADA', 'CONCLUIDA'];

/** Ids dos instrutores ocupados por ao menos uma demanda na janela. */
export function getBusyInstructorIds<D extends AvailabilityDemand>(
  demands: D[],
  window: AvailabilityWindow,
  options: AvailabilityOptions<D>
): Set<string> {
  const countsAsBusy = options.countsAsBusy ?? (() => true);

  return new Set(
    (demands ?? [])
      .filter(d => {
        if (!countsAsBusy(d)) return false;
        if (STATUSES_THAT_FREE_THE_INSTRUCTOR.includes(options.statusOf(d))) return false;
        if (!d.instructorId) return false;
        const start = new Date(d.startDate as string);
        const end = new Date(d.endDate as string);
        return end >= window.from && start <= window.to;
      })
      .map(d => d.instructorId as string)
  );
}

/**
 * Instrutores ATIVOS sem nenhuma demanda ocupando a janela.
 * Preserva a ordem original de `instructors`.
 */
export function getAvailableInstructors<I extends AvailabilityInstructor, D extends AvailabilityDemand>(
  instructors: I[],
  demands: D[],
  window: AvailabilityWindow,
  options: AvailabilityOptions<D>
): I[] {
  const busy = getBusyInstructorIds(demands, window, options);
  return (instructors ?? []).filter(i => i.status === 'ATIVO' && !busy.has(i.id));
}

/** Resultado do card "Cobertura de Ociosidade". */
export interface IdleCoverage<I, D> {
  /** Y — ociosos na janela (sem demanda de cliente). */
  available: I[];
  /** X — dentre os ociosos, os que receberam ao menos uma interna no período. */
  covered: I[];
  /** Y − X — a lista de ação. */
  uncovered: I[];
  /**
   * As internas de cada instrutor COBERTO, na ordem em que apareceram na lista
   * recebida. Sai da mesma passada que monta `covered` — o card usa para citar
   * a demanda ao lado do nome em vez de mandar o usuário cruzar telas.
   * Instrutor não coberto não tem chave aqui.
   */
  internalsByInstructor: Map<string, D[]>;
}

/**
 * Dos instrutores ociosos na janela, quais receberam demanda interna no
 * período. `internalDemands` já vem filtrada pelo recorte da tela; aqui só se
 * descarta o que está CANCELADA e o que não tem instrutor.
 */
export function computeIdleCoverage<I extends AvailabilityInstructor, D extends AvailabilityDemand>(
  available: I[],
  internalDemands: D[],
  options: Pick<AvailabilityOptions<D>, 'statusOf'>
): IdleCoverage<I, D> {
  const byInstructor = new Map<string, D[]>();
  for (const d of internalDemands ?? []) {
    if (!d.instructorId) continue;
    if (options.statusOf(d) === 'CANCELADA') continue;
    const key = d.instructorId as string;
    const list = byInstructor.get(key);
    if (list) list.push(d);
    else byInstructor.set(key, [d]);
  }

  return {
    available,
    covered: available.filter(i => byInstructor.has(i.id)),
    uncovered: available.filter(i => !byInstructor.has(i.id)),
    internalsByInstructor: byInstructor,
  };
}
