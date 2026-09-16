/**
 * LINHAS DO EXCEL DE PAGAMENTO — o que a montagem acrescenta ao rateio
 *
 * `computeInstructorHoursByDemand` + `applyMeasurementOverrides` continuam
 * sendo a fonte das HORAS, intocados. Este módulo cobre o que a planilha passou
 * a mostrar além das horas, e que não é conta de hora nenhuma:
 *
 *   1. A LINHA DO ACOMPANHANTE SEM HORAS. O override se recusa a inventar horas
 *      para quem acompanha (measurementOverrides.ts:337) e por isso não gera
 *      linha. A planilha passa a mostrar a pessoa mesmo assim — com Horas em
 *      branco e amarela, hora/aula em texto "horas não informadas" e as
 *      despesas dela — para ninguém ficar de fora em silêncio. A fonte é o
 *      CADASTRO (`companion_allocations`), não a medição: acompanhante alocado
 *      em demanda elegível aparece com ou sem medição salva.
 *
 *      Quem digitou horas > 0 já veio do override e NÃO duplica. Quem digitou
 *      ZERO continua fora: zero é decisão de alguém, não ausência (mesma regra
 *      do override, presa em smokeMedicaoBlocos [8]).
 *
 *   2. O REEMBOLSO POR PESSOA: os itens da pessoa marcados como pagos pelo
 *      instrutor, nos quatro buckets do painel. Dono do item resolvido por
 *      `resolvePersonBlocks` (a mesma regra do dataset Medições) e recorte por
 *      `blockExpenseBreakdown` com `isPagoPeloInstrutor` (o mesmo laço do
 *      painel). Nenhuma soma nova.
 *
 * Sem import de React, Supabase ou ExcelJS: roda no smoke em Node.
 */
import { getDemandDays } from './demandDays';
import { companionDaysFromRows, type OverrideCompanionRowLike } from './measurementOverrides';
import { resolveMeasurementPeople, type MeasurementPerson } from './measurementPeople';
import { resolvePersonBlocks } from './measurementPersonBlocks';
import {
  blockExpenseBreakdown,
  isPagoPeloInstrutor,
  type MeasurementRole,
  type TotalizableMeasurement,
} from './measurementTotals';
import type { InstructorAllocationLike } from './demandInstructors';

/** As despesas que a Colabor deve ao instrutor numa linha da planilha. */
export interface MedicaoReembolso {
  hospedagem: number;
  locomocao: number;
  alimentacao: number;
  outros: number;
  /** Soma dos quatro. */
  total: number;
}

export const REEMBOLSO_ZERO: MedicaoReembolso = Object.freeze({
  hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0, total: 0,
});

/** Só o que este módulo lê de uma demanda. */
export interface PaymentDemandLike {
  id: string;
  tipo?: 'cliente' | 'interna' | string | null;
  instructorId?: string | null;
  dateMode?: string;
  specificDates?: { data: string; horarioInicio: string; horarioFim: string }[];
  startDate: string;
  endDate: string;
}

/** Uma linha de pagamento SEM horas: o acompanhante que ninguém informou. */
export interface CompanionRowWithoutHours {
  instructorId: string;
  demandId: string;
  /** Sempre `null` aqui — a planilha imprime a célula vazia e amarela. */
  horas: null;
  horasInformadas: false;
  dias: string[];
  dividida: true;
  papel: 'ACOMPANHANTE';
}

export interface CompanionRowsInput {
  demands: PaymentDemandLike[];
  /** Mesmo recorte do rateio (status + período). Ver `eligibleDemandIdsForPayment`. */
  eligibleDemandIds: Set<string>;
  instructorAllocations: InstructorAllocationLike[];
  participants: { demandId: string; instructorId: string }[];
  /** Uma linha POR DIA, como em `companion_allocations`. */
  companions: OverrideCompanionRowLike[];
  measurements: (TotalizableMeasurement & { demandId: string })[];
  /** (demandId, instructorId) que JÁ têm linha — do rateio ou do override. */
  covered: { demandId: string; instructorId: string }[];
  periodStart?: string;
  periodEnd?: string;
}

const chave = (demandId: string, instructorId: string) => `${demandId} ${instructorId}`;

function clip(days: string[], from?: string, to?: string): string[] {
  const f = from ? from.slice(0, 10) : null;
  const t = to ? to.slice(0, 10) : null;
  return days.filter(d => (!f || d >= f) && (!t || d <= t));
}

/**
 * Os acompanhantes alocados em demandas elegíveis que NÃO receberam linha de
 * horas — nem do rateio (acompanhante nunca está lá) nem do override (não
 * digitaram horas para ele). Um por (demanda, pessoa), com os dias dele dentro
 * do período.
 */
export function buildCompanionRowsWithoutHours(input: CompanionRowsInput): CompanionRowWithoutHours[] {
  const {
    demands, eligibleDemandIds, instructorAllocations, participants, companions,
    measurements, covered, periodStart, periodEnd,
  } = input;

  const jaCoberto = new Set(covered.map(c => chave(c.demandId, c.instructorId)));
  const measurementByDemand = new Map(measurements.map(m => [m.demandId, m]));

  const companionsByDemand = new Map<string, OverrideCompanionRowLike[]>();
  for (const c of companions) {
    const lista = companionsByDemand.get(c.demandId) ?? [];
    lista.push(c);
    companionsByDemand.set(c.demandId, lista);
  }

  const resultado: CompanionRowWithoutHours[] = [];

  for (const demand of demands) {
    if (!eligibleDemandIds.has(demand.id)) continue;

    const pessoas = resolveMeasurementPeople(demand, instructorAllocations, participants, companions);
    const acompanhantes = pessoas.filter(p => p.papel === 'ACOMPANHANTE');
    if (acompanhantes.length === 0) continue;

    const m = measurementByDemand.get(demand.id);
    // Blocos só importam para saber se ALGUÉM DIGITOU horas: > 0 já virou linha
    // pelo override (está em `covered`); 0 é decisão e fica fora daqui também.
    const blocos = m && (m.expenses?.participantes?.length ?? 0) > 0
      ? resolvePersonBlocks(m, demand, pessoas)
      : null;

    const diasDaDemanda = getDemandDays(demand as any);

    for (const p of acompanhantes) {
      if (jaCoberto.has(chave(demand.id, p.instructorId))) continue;
      if (blocos?.blocoDe(p.instructorId)?.horasInformadas) continue;

      const dias = clip(
        companionDaysFromRows(
          (companionsByDemand.get(demand.id) ?? []).filter(c => c.instructorId === p.instructorId),
          diasDaDemanda
        ),
        periodStart,
        periodEnd
      );
      if (dias.length === 0) continue; // fora da janela do export

      resultado.push({
        instructorId: p.instructorId,
        demandId: demand.id,
        horas: null,
        horasInformadas: false,
        dias,
        dividida: true,
        papel: 'ACOMPANHANTE',
      });
    }
  }

  return resultado;
}

/**
 * O reembolso de UMA pessoa numa medição: os itens dela marcados como pagos
 * pelo instrutor, nos quatro buckets do painel. Pessoa sem bloco (2º titular
 * de uma medição v1) recebe zero — os itens sem dono são do titular principal.
 */
export function reembolsoDaPessoa(
  m: TotalizableMeasurement | null | undefined,
  demand: { instructorId?: string | null },
  pessoas: { instructorId: string; papel: MeasurementRole }[],
  instructorId: string
): MedicaoReembolso {
  if (!m) return REEMBOLSO_ZERO;
  const { paraNormalizar, blocoDe } = resolvePersonBlocks(m, demand, pessoas);
  const bloco = blocoDe(instructorId);
  if (!bloco) return REEMBOLSO_ZERO;
  const b = blockExpenseBreakdown(paraNormalizar, bloco, { itemFilter: isPagoPeloInstrutor });
  return {
    hospedagem: b.hospedagem,
    locomocao: b.locomocao,
    alimentacao: b.alimentacao,
    outros: b.outros,
    total: b.total,
  };
}

export type { MeasurementPerson };
