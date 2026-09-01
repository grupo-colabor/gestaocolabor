/**
 * HORAS DE PAGAMENTO — rateio das alocações × blocos da medição
 *
 * Este é o ponto mais delicado do desenho da medição multi-pessoa, e a regra
 * cabe numa frase: **os blocos são OVERRIDE por pessoa, nunca soma**.
 *
 * ---------------------------------------------------------------------------
 * O estado de fato, antes desta função
 * ---------------------------------------------------------------------------
 * A planilha de pagamento tira horas EXCLUSIVAMENTE de
 * `computeInstructorHoursByDemand` (domain/instructorHours.ts), cuja fonte é
 * `instructor_allocations`. Demanda sem linha lá não gera linha nenhuma.
 *
 * Participante de interna (e acompanhante de cliente, na F3) NÃO estão em
 * `instructor_allocations` — de propósito: aquela tabela modela DIVISÃO de
 * dias, o `addInstructorAllocation` faz split destrutivo e o rateio
 * `dias / união dos dias` multiplicaria a carga de quem trabalha nos MESMOS
 * dias (2 pessoas numa interna de 16h dariam 16h cada). Consequência: hoje
 * essas pessoas valem ZERO na planilha.
 *
 * Logo, para elas não existe dupla contagem a reconciliar — o bloco da medição
 * é a única fonte. A sobreposição existe só para o TITULAR, que aparece nos
 * dois lados. É essa sobreposição que a tabela abaixo resolve.
 *
 * ---------------------------------------------------------------------------
 * Precedência
 * ---------------------------------------------------------------------------
 * | tem linha de rateio? | bloco com `horas`? | resultado                      |
 * |----------------------|--------------------|--------------------------------|
 * | sim                  | presente           | SUBSTITUI as horas do rateio;  |
 * |                      |                    | os `dias` continuam do rateio  |
 * | sim                  | ausente            | rateio inalterado              |
 * | não                  | presente/ausente   | INSERE linha nova (participante)|
 * | não                  | (sem bloco)        | nada                           |
 *
 * Nunca soma, nunca as duas coisas. O rateio continua sendo a fonte única de
 * `computeInstructorHoursByDemand` — cinco leitores dependem dele além do
 * Excel (ranking do Dashboard, alerta de "concluída sem alocação") e trocar a
 * fonte mudaria o número de toda demanda de cliente que nunca terá bloco.
 * Override é aditivo e reversível: apagar o bloco devolve o rateio.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `horas` ausente ≠ zero — a guarda que sustenta tudo
 * ---------------------------------------------------------------------------
 * O default de horas do participante (`horas_previstas`) é de UI: ele aparece
 * como placeholder e só vira valor gravado quando alguém digita. Se fosse
 * gravado com avidez, no dia do deploy TODA interna com bloco trocaria o rateio
 * por horas-por-pessoa, e uma interna de 16h dividida entre 2 instrutores
 * saltaria de 16h para 32h — a linha "✖" da análise, agora pela porta da
 * frente.
 *
 * Por isso o campo ausente resolve de formas DIFERENTES, distinguidas pela
 * existência da linha de rateio, nunca por adivinhação:
 *
 *   • quem TEM rateio (o titular)        → ausente = "mantenha o rateio";
 *   • quem NÃO tem (o participante)      → ausente = `horas_previstas`.
 *
 * Um `?? 0` em qualquer um dos dois zera pagamento em silêncio.
 */
import { getDemandDays } from './demandDays';
import {
  normalizeMeasurementBlocks,
  type TotalizableMeasurement,
  type MeasurementRole,
} from './measurementTotals';

/** Uma linha de horas, no formato de `InstructorDemandHoursRow`. */
export interface HoursRowLike {
  instructorId: string;
  demandId: string;
  horas: number;
  dias: string[];
  dividida: boolean;
  /**
   * Papel de quem recebe a linha (F3, decisão D4). Ausente = TITULAR — é o que
   * mantém toda linha vinda do rateio, que não conhece papel, do lado certo da
   * chave de tarifa. Participante de interna também é TITULAR aqui: ele
   * ministra, e a F1 o definiu como titular pleno. O único papel que muda a
   * tarifa é ACOMPANHANTE, que não ministra.
   */
  papel?: MeasurementRole;
}

/** Só o que esta regra lê de uma demanda. */
export interface OverrideDemandLike {
  id: string;
  tipo?: string | null;
  horasPrevistas?: number | string | null;
  instructorId?: string | null;
  dateMode?: string;
  specificDates?: { data: string; horarioInicio: string; horarioFim: string }[];
  startDate: string;
  endDate: string;
}

/** Vínculo pessoa↔demanda, para recortar os dias de quem entra novo. */
export interface OverrideParticipantLike {
  demandId: string;
  instructorId: string;
  /** 'YYYY-MM-DD'; ausente nos dois = período inteiro da demanda. */
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Uma linha de `companion_allocations` — UMA POR DIA.
 *
 * Não é um recorte de período como o do participante: um acompanhante de 3
 * dias são 3 linhas, e é a contagem delas que dá os dias dele.
 */
export interface OverrideCompanionRowLike {
  demandId: string;
  instructorId: string;
  /** 'YYYY-MM-DDTHH:mm' ou 'YYYY-MM-DD' — só a data importa aqui. */
  startDate?: string | null;
}

/**
 * Os dias de um acompanhante, a partir das linhas dele.
 *
 * Interseção com os dias reais da demanda de propósito: linha antiga pode
 * apontar para um dia fora do período (o seletor de hoje não deixa mais, mas o
 * dado histórico pode ter), e um dia fora da demanda não é dia de trabalho — ele
 * inflaria a proporção de horas.
 */
export function companionDaysFromRows(
  rows: OverrideCompanionRowLike[],
  demandDays: string[]
): string[] {
  const daDemanda = new Set(demandDays);
  const dias = new Set<string>();
  for (const r of rows) {
    const dia = (r.startDate ?? '').slice(0, 10);
    if (dia && daDemanda.has(dia)) dias.add(dia);
  }
  return [...dias].sort();
}

/**
 * A SUGESTÃO de horas do acompanhante: proporcional aos dias que ele acompanha.
 * 1 dia numa demanda de 2 dias e 8h = 4h.
 *
 * ⚠️ É SÓ SUGESTÃO — texto na tela, ao lado do campo. NÃO é fallback de nada:
 * acompanhante sem horas digitadas não gera linha na planilha (ver a inserção
 * em `applyMeasurementOverrides`), e não vale nem a proporção nem zero: vale
 * "ninguém informou ainda".
 *
 * A razão é que ninguém sabe quantas HORAS o acompanhante fez — só quantos DIAS
 * ele acompanhou. A proporção é um palpite razoável para quem for digitar, e um
 * palpite razoável ainda é um palpite: transformá-lo em pagamento automático
 * erraria na direção cara, sem ninguém ter olhado.
 *
 * Devolve 0 quando não dá para calcular (sem carga conhecida, sem dias): 0 aqui
 * é "não sei sugerir", e quem chama esconde a sugestão em vez de exibir "0h".
 */
export function companionDefaultHours(
  horasDaDemanda: number,
  diasDaDemanda: number,
  diasDoAcompanhante: number
): number {
  if (!(horasDaDemanda > 0) || !(diasDaDemanda > 0) || !(diasDoAcompanhante > 0)) return 0;
  // Acompanhar mais dias do que a demanda tem não faz a conta passar de 100%.
  const proporcao = Math.min(diasDoAcompanhante, diasDaDemanda) / diasDaDemanda;
  return Math.round((horasDaDemanda * proporcao + Number.EPSILON) * 100) / 100;
}

export interface ApplyOverridesInput {
  rows: HoursRowLike[];
  measurements: (TotalizableMeasurement & { demandId: string })[];
  demands: OverrideDemandLike[];
  /** Participantes de interna, para os dias da linha inserida. */
  participants?: OverrideParticipantLike[];
  /** Linhas de acompanhante (uma por dia), para os dias da linha inserida. */
  companions?: OverrideCompanionRowLike[];
  /**
   * As demandas que o export considera elegíveis — status e período, o mesmo
   * filtro de `computeInstructorHoursByDemand` (ver `eligibleDemandIdsForPayment`).
   *
   * Sem ele, a INSERÇÃO abaixo varre TODAS as medições com blocos e põe na
   * planilha gente de demanda que nem entrou no recorte: uma medição salva numa
   * demanda ALOCADA colocava o participante e o acompanhante no mês, enquanto o
   * titular dos mesmos — que passa pelo rateio — ficava de fora. Duas regras de
   * elegibilidade para a mesma planilha.
   *
   * Omitido = todas as demandas recebidas em `demands` são elegíveis (é o que
   * os testes de unidade querem, com fixtures montadas à mão).
   */
  eligibleDemandIds?: Set<string>;
  /** Recorte do período do export, igual ao do rateio ('YYYY-MM-DD'). */
  periodStart?: string;
  periodEnd?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Recorta dias pela janela do período, como `clipToPeriod` do rateio. */
function clip(days: string[], from?: string, to?: string): string[] {
  const f = from ? from.slice(0, 10) : null;
  const t = to ? to.slice(0, 10) : null;
  return days.filter(d => (!f || d >= f) && (!t || d <= t));
}

/**
 * Aplica a tabela de precedência sobre as linhas do rateio.
 *
 * Devolve uma lista NOVA; não muta `rows`.
 */
export function applyMeasurementOverrides({
  rows,
  measurements,
  demands,
  participants = [],
  companions = [],
  eligibleDemandIds,
  periodStart,
  periodEnd,
}: ApplyOverridesInput): HoursRowLike[] {
  const demandById = new Map(demands.map(d => [d.id, d]));
  const measurementByDemand = new Map(measurements.map(m => [m.demandId, m]));

  const participantsByDemand = new Map<string, OverrideParticipantLike[]>();
  for (const p of participants) {
    const lista = participantsByDemand.get(p.demandId) ?? [];
    lista.push(p);
    participantsByDemand.set(p.demandId, lista);
  }

  const companionsByDemand = new Map<string, OverrideCompanionRowLike[]>();
  for (const c of companions) {
    const lista = companionsByDemand.get(c.demandId) ?? [];
    lista.push(c);
    companionsByDemand.set(c.demandId, lista);
  }

  // Blocos por (demanda, pessoa), resolvidos uma vez.
  const blocosPorDemanda = new Map<string, ReturnType<typeof normalizeMeasurementBlocks>>();
  for (const [demandId, m] of measurementByDemand) {
    const demand = demandById.get(demandId);
    // Medição v1 devolve sempre 1 bloco de titular; só interessa aqui se ela
    // tiver `participantes` de verdade — senão não há override nenhum a fazer
    // e o rateio segue intacto, que é o comportamento de hoje.
    if (!m?.expenses?.participantes?.length) continue;
    blocosPorDemanda.set(demandId, normalizeMeasurementBlocks(m, demand?.instructorId ?? undefined));
  }

  const resultado: HoursRowLike[] = [];
  const jaCoberto = new Set<string>();
  const chave = (demandId: string, instructorId: string) => `${demandId} ${instructorId}`;

  // 1) As linhas do rateio, com override de horas quando o bloco informou.
  for (const row of rows) {
    const blocos = blocosPorDemanda.get(row.demandId);
    const bloco = blocos?.find(b => b.instructorId === row.instructorId);

    jaCoberto.add(chave(row.demandId, row.instructorId));

    // Papel do bloco, quando existe. Quem tem linha de rateio é titular na
    // prática (o rateio sai de instructor_allocations, onde acompanhante não
    // entra), mas o papel gravado manda — é ele que a chave de tarifa lê.
    const papel = bloco?.papel;

    if (bloco?.horasInformadas && bloco.horas !== undefined) {
      // SUBSTITUI, não soma. Os `dias` continuam vindo do rateio: o bloco não
      // tem dias, e são eles que a planilha imprime na coluna Data.
      resultado.push({ ...row, horas: bloco.horas, ...(papel ? { papel } : {}) });
    } else {
      resultado.push({ ...row, ...(papel ? { papel } : {}) });
    }
  }

  // 2) Blocos de quem NÃO tem linha de rateio — o participante. Sem isto ele
  //    continuaria valendo zero na planilha, que é o problema que a F2 resolve.
  for (const [demandId, blocos] of blocosPorDemanda) {
    const demand = demandById.get(demandId);
    if (!demand) continue;
    // Fora do recorte do export (status ou período): a medição pode estar
    // salva, mas ninguém dessa demanda entra na planilha deste mês.
    if (eligibleDemandIds && !eligibleDemandIds.has(demandId)) continue;

    for (const bloco of blocos) {
      if (!bloco.instructorId) continue;
      if (jaCoberto.has(chave(demandId, bloco.instructorId))) continue;

      const ehAcompanhante = bloco.papel === 'ACOMPANHANTE';
      const diasDaDemanda = getDemandDays(demand as any);

      // Dias da pessoa. As duas fontes são diferentes porque os dois vínculos
      // são diferentes: participante tem um PERÍODO (start/end, nulos = demanda
      // inteira); acompanhante tem UMA LINHA POR DIA.
      const dias = (() => {
        if (ehAcompanhante) {
          const proprios = companionDaysFromRows(
            (companionsByDemand.get(demandId) ?? []).filter(
              c => c.instructorId === bloco.instructorId
            ),
            diasDaDemanda
          );
          // Sem linha nenhuma (bloco gravado à mão, acompanhante removido depois)
          // o acompanhamento não tem dias — e sem dias não há proporção nem o que
          // imprimir na coluna Data.
          return proprios;
        }

        const vinculo = participantsByDemand
          .get(demandId)
          ?.find(p => p.instructorId === bloco.instructorId);

        // Período próprio do participante, recortado pelos dias reais da demanda
        // (mesma regra da agenda e do conflito); sem período próprio, os dias da
        // demanda inteira.
        if (!vinculo?.startDate || !vinculo?.endDate) return diasDaDemanda;
        const proprio = new Set(
          getDemandDays({
            dateMode: 'CONTINUO',
            startDate: vinculo.startDate,
            endDate: vinculo.endDate,
          } as any)
        );
        return diasDaDemanda.filter(d => proprio.has(d));
      })();

      const diasNoPeriodo = clip(dias, periodStart, periodEnd);
      if (diasNoPeriodo.length === 0) continue; // fora da janela do export

      // ⚠️ AQUI mora a metade do "ausente ≠ zero" que vale para quem não tem
      // rateio — e ela é DIFERENTE por papel:
      //
      //   • participante de interna → `horas_previstas` (carga cheia: ele
      //     ministra a demanda inteira, como o titular);
      //   • acompanhante de cliente → NÃO GERA LINHA. Ninguém sabe quantas horas
      //     ele fez, só quantos dias acompanhou; a planilha não inventa isso.
      //     A sugestão proporcional (`companionDefaultHours`) é texto de tela,
      //     e o painel avisa quem esqueceu de preencher.
      if (ehAcompanhante && !(bloco.horasInformadas && bloco.horas !== undefined)) continue;

      const horas = bloco.horasInformadas && bloco.horas !== undefined
        ? bloco.horas
        : num(demand.horasPrevistas);

      if (horas <= 0) continue; // nada a pagar e nada a imprimir

      resultado.push({
        instructorId: bloco.instructorId,
        demandId,
        horas,
        dias: diasNoPeriodo,
        // A demanda tem mais de uma pessoa por definição, se chegou aqui.
        dividida: true,
        papel: bloco.papel,
      });
    }
  }

  return resultado;
}
