/**
 * HORAS POR INSTRUTOR — Fonte única de verdade
 *
 * Substitui o cálculo antigo do Dashboard, que usava `demands.instructor_id`
 * (campo único, dessincronizado quando a demanda é dividida entre instrutores
 * ou tem o instrutor trocado) × carga horária nominal do treinamento (nunca
 * fracionada).
 *
 * Aqui a fonte do vínculo instrutor↔demanda é SEMPRE `instructor_allocations`
 * — a tabela que registra, por instrutor, o(s) trecho(s) de dias que ele
 * efetivamente ministrou dentro da demanda. A carga horária é distribuída
 * proporcionalmente aos dias reais de cada instrutor (via `getDemandDays`),
 * usando a carga medida (`measurements.expenses.classHours`) quando existir,
 * com fallback para a carga nominal do treinamento (ou para as horas práticas
 * do treinamento, em demandas HÍBRIDAS — ver `effectiveDemandHours`).
 *
 * O denominador do split é a UNIÃO dos dias efetivamente alocados (a todos
 * os instrutores da demanda), não os dias do cadastro (`getDemandDays`
 * bruto). Em demandas HÍBRIDAS o cadastro cobre o período EAD + prática,
 * mas só a prática recebe alocação de instrutor — usar os dias do cadastro
 * como denominador diluiria as horas práticas pelos dias sem instrutor
 * (bug real: DEM-359, 12h/5 dias cadastrados, só 1 dia presencial alocado
 * — dava 1/5 × 12 = 2.4h e vazava 9.6h silenciosamente; correto é 4h,
 * as horas práticas do treinamento, já que o único dia alocado = a união
 * dos dias alocados da demanda).
 *
 * ESCOPO: este cálculo mede "horas ministradas por instrutor" (o que ele
 * efetivamente deu em sala/campo). "Horas entregues ao cliente" (carga
 * cheia do treinamento, incluindo a parte EAD sem instrutor em híbridos)
 * é um indicador DIFERENTE e não é o que este módulo calcula — se algum
 * dia for necessário, deve ser uma função separada.
 */
import { getDemandDays } from './demandDays';
import { calculateDemandStatus } from './demandStatus';
import type { Demand, InstructorAllocation, Training, Measurement } from '../types';

export interface ComputeInstructorHoursInput {
  demands: Demand[];
  instructorAllocations: InstructorAllocation[];
  trainings: Training[];
  measurements: Measurement[];
  /** Janela do filtro de período do Dashboard ('YYYY-MM-DD'). Omitidos = sem recorte. */
  periodStart?: string;
  periodEnd?: string;
}

export interface InstructorHoursEntry {
  /** Soma de horas atribuídas ao instrutor no período (pode ter fração, ex.: 75.5). */
  horas: number;
  /** Nº de demandas CONCLUIDA em que o instrutor deu ao menos 1 dia dentro do período. */
  nDemandas: number;
  /** Dessas, quantas foram divididas com 1+ outro instrutor (mesma demanda, dias diferentes). */
  nDivididas: number;
}

/**
 * Uma linha por par (instrutor, demanda) — a granularidade que o agregado
 * `InstructorHoursEntry` colapsa. Consumida pelo export de medição mensal,
 * que precisa detalhar demanda a demanda o que compõe o total do instrutor.
 */
export interface InstructorDemandHoursRow {
  instructorId: string;
  demandId: string;
  /** Horas do instrutor NESTA demanda, já recortadas pelo período. */
  horas: number;
  /** Dias ('YYYY-MM-DD') do instrutor nesta demanda dentro do período, ordenados. */
  dias: string[];
  /** A demanda foi dividida com 1+ outro instrutor dentro do período. */
  dividida: boolean;
}

const normalizeModality = (raw: any) =>
  String(raw ?? '').trim().toUpperCase().replaceAll('-', '').replaceAll(' ', '');

/** A modalidade do TREINAMENTO prevalece sobre a da demanda — igual ao resto do app. */
function resolveModality(demand: Demand, training: Training | undefined): string {
  return normalizeModality(training?.modality ?? demand.modality);
}

/**
 * Réplica do `getCalculatedStatus` do Dashboard: resolve o status real da
 * demanda. Não depende de `demand.instructorId` para decidir CONCLUIDA —
 * essa branch de `calculateDemandStatus` é puramente por data.
 */
function isDemandConcluida(demand: Demand, trainingsById: Map<string, Training>): boolean {
  const training = trainingsById.get(String(demand.trainingId));
  const status = calculateDemandStatus({
    startDate: demand.startDate,
    endDate: demand.endDate,
    instructorId: demand.instructorId,
    cancelled: demand.status === 'CANCELADA',
    trainingLocal: demand.trainingLocal,
    modality: resolveModality(demand, training),
  });
  return status === 'CONCLUIDA';
}

/** Recorta uma lista de dias 'YYYY-MM-DD' pela janela [from, to] (ambos opcionais, inclusive). */
function clipToPeriod(days: string[], periodStart?: string, periodEnd?: string): string[] {
  if (!periodStart && !periodEnd) return days;
  const from = periodStart ? periodStart.slice(0, 10) : null;
  const to = periodEnd ? periodEnd.slice(0, 10) : null;
  return days.filter(d => (!from || d >= from) && (!to || d <= to));
}

/**
 * Carga horária "real" da demanda, em ordem de prioridade:
 *  1. `measurements.expenses.classHours` — override medido, se > 0.
 *  2. Demanda INTERNA: `demand.horasPrevistas` — interna não tem treinamento,
 *     a carga é a que foi prevista no cadastro da própria demanda.
 *  3. Se a demanda é HÍBRIDA: `training.practicalHours` — só a parte
 *     presencial (a EAD não tem instrutor, não deve contar aqui).
 *  4. `training.hours` — carga nominal (demais modalidades, ou híbrido
 *     sem `practicalHours` cadastrado).
 */
function effectiveDemandHours(
  demand: Demand,
  trainingsById: Map<string, Training>,
  measurementByDemandId: Map<string, Measurement>
): number {
  const override = Number((measurementByDemandId.get(demand.id)?.expenses as any)?.classHours);
  if (Number.isFinite(override) && override > 0) return override;

  // Interna: sem training_id, os fallbacks abaixo devolveriam 0 e o
  // `if (horasTotais <= 0) continue` lá embaixo derrubaria a demanda inteira —
  // ela sumiria da planilha de pagamento sem nenhum erro. `horasPrevistas` é a
  // única fonte de carga que uma interna tem (CHECK no banco garante > 0).
  if (demand.tipo === 'interna') {
    const previstas = Number(demand.horasPrevistas);
    return Number.isFinite(previstas) && previstas > 0 ? previstas : 0;
  }

  const training = trainingsById.get(String(demand.trainingId));

  if (resolveModality(demand, training) === 'HIBRIDO') {
    const practical = training?.practicalHours;
    if (typeof practical === 'number' && Number.isFinite(practical) && practical > 0) return practical;
  }

  return training?.hours || 0;
}

/**
 * As demandas ELEGÍVEIS para a planilha de pagamento no período.
 *
 * Mesmo par de regras que `computeInstructorHoursByDemand` aplica na entrada:
 * status CONCLUÍDA e ao menos um dia dentro da janela. Existe como função
 * separada porque o override da medição (domain/measurementOverrides) precisa
 * do MESMO conjunto: sem ele, o bloco de uma medição salva numa demanda ainda
 * ALOCADA inseria linha na planilha, e o participante/acompanhante aparecia
 * num mês em que o titular dele — corretamente — não aparecia.
 *
 * Deliberadamente NÃO é "demandas que geraram linha de rateio": a interna sem
 * `instructor_allocations` não gera rateio nenhum e mesmo assim é elegível —
 * os participantes dela são a única fonte de pagamento que ela tem.
 */
export function eligibleDemandIdsForPayment(input: {
  demands: Demand[];
  trainings: Training[];
  periodStart?: string;
  periodEnd?: string;
}): Set<string> {
  const { demands, trainings, periodStart, periodEnd } = input;
  const trainingsById = new Map(trainings.map(t => [String(t.id), t]));

  const ids = new Set<string>();
  for (const demand of demands) {
    if (!isDemandConcluida(demand, trainingsById)) continue;
    const dias = clipToPeriod(getDemandDays(demand), periodStart, periodEnd);
    if (dias.length === 0) continue;
    ids.add(demand.id);
  }
  return ids;
}

/**
 * FONTE ÚNICA do cálculo — devolve as linhas (instrutor × demanda) que
 * compõem as horas do período. `computeInstructorHours` é só a agregação
 * destas linhas por instrutor; nenhuma das duas duplica a regra de rateio.
 */
export function computeInstructorHoursByDemand(
  input: ComputeInstructorHoursInput
): InstructorDemandHoursRow[] {
  const { demands, instructorAllocations, trainings, measurements, periodStart, periodEnd } = input;

  const trainingsById = new Map(trainings.map(t => [String(t.id), t]));
  const measurementByDemandId = new Map(measurements.map(m => [m.demandId, m]));

  const allocationsByDemandId = new Map<string, InstructorAllocation[]>();
  for (const alloc of instructorAllocations) {
    const list = allocationsByDemandId.get(alloc.demandId) ?? [];
    list.push(alloc);
    allocationsByDemandId.set(alloc.demandId, list);
  }

  const rows: InstructorDemandHoursRow[] = [];

  for (const demand of demands) {
    if (!isDemandConcluida(demand, trainingsById)) continue;

    const allocsForDemand = allocationsByDemandId.get(demand.id);
    if (!allocsForDemand || allocsForDemand.length === 0) continue; // sem instructor_allocations: fonte é a tabela, não demand.instructor_id

    const demandDaySetAll = new Set(getDemandDays(demand));
    if (demandDaySetAll.size === 0) continue; // guarda contra divisão por zero

    // Dias de cada instrutor, interseccionados com os dias reais do cadastro
    // (ainda SEM recorte de período — precisamos disso para o denominador,
    // que é a união entre todos os instrutores da demanda).
    const diasPorInstrutorTotal = new Map<string, Set<string>>();
    for (const alloc of allocsForDemand) {
      if (!alloc.instructorId) continue;
      const allocDays = getDemandDays({
        dateMode: 'CONTINUO',
        startDate: alloc.startDate,
        endDate: alloc.endDate,
      });
      const set = diasPorInstrutorTotal.get(alloc.instructorId) ?? new Set<string>();
      for (const day of allocDays) {
        if (demandDaySetAll.has(day)) set.add(day);
      }
      diasPorInstrutorTotal.set(alloc.instructorId, set);
    }

    // Denominador = união dos dias EFETIVAMENTE alocados (a qualquer
    // instrutor), não os dias do cadastro — ver comentário no topo do
    // arquivo (caso DEM-359 / híbridos).
    const unionAllocatedDays = new Set<string>();
    for (const dias of diasPorInstrutorTotal.values()) {
      for (const day of dias) unionAllocatedDays.add(day);
    }
    const totalDiasDemanda = unionAllocatedDays.size;
    if (totalDiasDemanda === 0) continue; // guarda contra divisão por zero (nenhuma alocação cai em dia real)

    const horasTotais = effectiveDemandHours(demand, trainingsById, measurementByDemandId);
    if (horasTotais <= 0) continue;

    // Numerador (por instrutor): dias dele, recortados pela janela do
    // período — uma demanda que atravessa a borda do filtro só contribui
    // com a fração de dias que caem dentro dele.
    const diasAlocadosNoPeriodo = new Set(clipToPeriod([...unionAllocatedDays], periodStart, periodEnd));
    if (diasAlocadosNoPeriodo.size === 0) continue; // demanda inteira fora do período após recorte

    const participantes: Array<[string, string[]]> = [];
    for (const [instructorId, diasTotal] of diasPorInstrutorTotal) {
      const diasNoPeriodo = [...diasTotal].filter(d => diasAlocadosNoPeriodo.has(d)).sort();
      if (diasNoPeriodo.length > 0) participantes.push([instructorId, diasNoPeriodo]);
    }
    if (participantes.length === 0) continue;

    const dividida = participantes.length > 1;

    for (const [instructorId, dias] of participantes) {
      rows.push({
        instructorId,
        demandId: demand.id,
        horas: (dias.length / totalDiasDemanda) * horasTotais,
        dias,
        dividida,
      });
    }
  }

  return rows;
}

export function computeInstructorHours(
  input: ComputeInstructorHoursInput
): Map<string, InstructorHoursEntry> {
  const result = new Map<string, InstructorHoursEntry>();

  // Cada par (instrutor, demanda) aparece no máximo uma vez nas linhas, então
  // somar 1 em nDemandas por linha reproduz exatamente a contagem anterior.
  for (const row of computeInstructorHoursByDemand(input)) {
    let entry = result.get(row.instructorId);
    if (!entry) {
      entry = { horas: 0, nDemandas: 0, nDivididas: 0 };
      result.set(row.instructorId, entry);
    }
    entry.horas += row.horas;
    entry.nDemandas += 1;
    if (row.dividida) entry.nDivididas += 1;
  }

  return result;
}
