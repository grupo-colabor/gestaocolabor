/**
 * CARGA PADRÃO DA DEMANDA — a regra do PAINEL de medição
 *
 * É o número que o titular (e o participante) vale sem ninguém digitar horas:
 *   • interna  → `horasPrevistas` (a única carga que ela tem; CHECK > 0 no banco);
 *   • cliente  → `training.hours`, a carga nominal do treinamento.
 *
 * Espelha `getDemandDefaultHours` de `components/Measurement.tsx` — extraída
 * para o motor de Exportações resolver o bloco com o MESMO contexto que a
 * tela (`PanelHoursContext.demandDefaultHours`).
 *
 * ⚠️ NÃO é `effectiveDemandHours` de domain/instructorHours.ts. Aquela é a
 * carga do RATEIO (Excel de pagamento) e, em demanda HÍBRIDA, usa
 * `practicalHours`. O painel, de propósito, não herda default nenhum em
 * híbrida (`PanelHoursContext.hibrida`), então aqui a carga total continua
 * sendo a nominal — quem zera é o contexto, não esta função. As duas
 * resoluções coexistem e o export mostra ambas, rotuladas.
 */
export interface DefaultHoursDemandLike {
  tipo?: 'cliente' | 'interna' | string | null;
  horasPrevistas?: number | string | null;
}

export interface DefaultHoursTrainingLike {
  hours?: number | string | null;
}

export function panelDefaultHours(
  demand: DefaultHoursDemandLike | null | undefined,
  training: DefaultHoursTrainingLike | null | undefined
): number {
  if (!demand) return 0;
  if (demand.tipo === 'interna') {
    const previstas = Number(demand.horasPrevistas);
    return Number.isFinite(previstas) && previstas > 0 ? previstas : 0;
  }
  const h = typeof training?.hours === 'number' ? training.hours : Number(training?.hours);
  return Number.isFinite(h) && h > 0 ? h : 0;
}
