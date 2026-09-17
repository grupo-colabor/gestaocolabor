/**
 * BLOCOS POR PESSOA DE UMA MEDIÇÃO — a decisão v1/v2 num lugar só
 *
 * Quem é dono de cada item de despesa não é uma pergunta trivial: depende de
 * a medição ter `participantes` gravados, de a demanda ter uma segunda
 * categoria de pessoa (participante de interna, acompanhante de cliente) e do
 * titular de `demands.instructor_id`. Essa decisão vivia dentro do dataset
 * Medições (domain/exports/datasets/medicoes.ts) e o Excel de pagamento passou
 * a precisar da MESMA resposta para as colunas de despesa por instrutor. Duas
 * cópias divergiriam na primeira mudança — daí este módulo.
 *
 * Regra, espelhando o painel (`secoesPorPessoa` em Measurement.tsx):
 *
 *   • v2 — medição COM `participantes` gravados, OU demanda com MAIS DE UMA
 *     pessoa no cadastro (segunda categoria, ou 2+ titulares de demanda
 *     dividida) → um bloco por pessoa da LISTA DO CADASTRO
 *     (`resolveMeasurementPeople`), usando o bloco gravado quando existe e um
 *     bloco vazio quando não. Pessoa que saiu do cadastro perde o bloco e os
 *     itens dela caem no titular principal (`normalizeMeasurementBlocks`).
 *   • v1 — o resto (medição mono-pessoa de verdade): UM bloco, no titular
 *     principal, com TODOS os itens.
 *
 * Até 09/2026 a demanda dividida sem acompanhante ficava no v1 (item sem dono
 * e despesas inteiras em `instructor_id`, segundo titular sem bloco). Agora
 * ela é v2 como as demais: cada titular tem bloco, item sem dono continua no
 * PRINCIPAL (`titularPrincipal`), e o default de horas de cada um é a fatia do
 * rateio por dias (`horasRateio`, ver measurementTotals.ts).
 *
 * Item SEM `instructorId` (lançado no painel de uma pessoa só, ou antes da F2)
 * cai no titular nos dois caminhos. É a única regra de "dono desconhecido" do
 * sistema, e é por isso que o painel avisa quando um item assim é marcado como
 * pago pelo instrutor: o reembolso vai para o titular.
 *
 * Sem import de React, Supabase ou ExcelJS: roda no smoke em Node.
 */
import {
  normalizeMeasurementBlocks,
  type MeasurementPersonBlock,
  type MeasurementRole,
  type TotalizableMeasurement,
} from './measurementTotals';
import { rateioDaDemanda, type RateioAllocationLike } from './instructorHours';

/** Só o que esta regra lê de uma pessoa da demanda. */
export interface PersonLike {
  instructorId: string;
  papel: MeasurementRole;
}

export interface PersonBlocks {
  /** `true` = caminho multi-pessoa (um bloco por pessoa da lista). */
  v2: boolean;
  /** Quem absorve os itens sem dono. '' quando ninguém foi encontrado. */
  titularId: string;
  /**
   * A medição como foi NORMALIZADA (com `participantes` completados pela lista
   * do cadastro, no v2). É este objeto que deve ir para
   * `blockExpenseBreakdown` / `computePanelExpenseBreakdown`, e não `m` cru —
   * os blocos apontam para os itens DESTE objeto.
   */
  paraNormalizar: TotalizableMeasurement;
  blocos: MeasurementPersonBlock[];
  /** O bloco de uma pessoa, ou `undefined` quando ela não tem bloco (2º titular na v1). */
  blocoDe: (instructorId: string) => MeasurementPersonBlock | undefined;
  /**
   * Alguém informou as horas desta pessoa? É o critério único de "horas
   * digitadas" (o `horasInformadas` de `normalizeMeasurementBlocks`).
   *
   *   • v2: o bloco da pessoa; sem bloco (pessoa fora da lista) = não.
   *   • v1: a medição tem UM `classHours` para a demanda inteira, que o rateio
   *     divide entre os titulares — então vale para TODOS eles, inclusive o
   *     segundo titular que não tem bloco próprio.
   */
  horasInformadasDe: (instructorId: string) => boolean;
}

/**
 * Quem absorve os itens sem dono: `demands.instructor_id` quando ele está
 * entre as pessoas; senão o primeiro titular da lista (o primeiro por data de
 * início, na demanda dividida sem principal alocado); senão o próprio
 * `instructor_id` (medição sem ninguém no cadastro).
 */
export function titularPrincipal(
  demand: { instructorId?: string | null },
  pessoas: PersonLike[]
): string {
  const principal = demand.instructorId ?? '';
  if (principal && pessoas.some(p => p.instructorId === principal)) return principal;
  return pessoas.find(p => p.papel === 'TITULAR')?.instructorId || principal || '';
}

export interface ResolvePersonBlocksOptions {
  /**
   * A FATIA VIVA do rateio por dias de cada titular (instructorId → horas),
   * calculada por `horasRateioPorTitular` com as alocações atuais. Quando
   * informada, sobrescreve o `horasRateio` gravado nos blocos de TITULAR — é
   * assim que o painel e o dataset mostram sempre a fatia viva, e o painel a
   * regrava ao salvar. Sem ela, vale o gravado (Dashboard).
   */
  horasRateio?: Record<string, number>;
}

export function resolvePersonBlocks(
  m: TotalizableMeasurement,
  demand: { instructorId?: string | null },
  pessoas: PersonLike[],
  opts: ResolvePersonBlocksOptions = {}
): PersonBlocks {
  const gravados = m.expenses?.participantes ?? [];
  const titularId = titularPrincipal(demand, pessoas);

  // v2 = há bloco gravado OU mais de uma pessoa no cadastro — inclusive a
  // demanda de cliente DIVIDIDA entre dois titulares sem acompanhante, que até
  // 09/2026 ficava no formato v1 (tudo em `instructor_id`).
  const v2 = gravados.length > 0 || pessoas.length > 1;

  // Medição v1 (sem bloco gravado) aberta em v2: cada titular NASCE com
  // `valorHH = hourRate` — a tarifa da v1 era a do titular, e sem isso a
  // conversão zeraria o hora/aula de quem já tinha tarifa. Participante e
  // acompanhante não herdam: a tarifa deles nunca esteve na v1.
  const tarifaLegada = gravados.length === 0 ? m.expenses?.hourRate : undefined;
  const temTarifaLegada = tarifaLegada !== undefined && tarifaLegada !== null && String(tarifaLegada).trim() !== '';

  const paraNormalizar: TotalizableMeasurement = v2
    ? {
        ...m,
        expenses: {
          ...(m.expenses ?? {}),
          participantes: pessoas.map(p => {
            const g = gravados.find(x => x?.instructorId === p.instructorId);
            const base = g ?? {
              instructorId: p.instructorId,
              papel: p.papel,
              ...(p.papel === 'TITULAR' && temTarifaLegada ? { valorHH: tarifaLegada } : {}),
            };
            const fatiaViva = opts.horasRateio?.[p.instructorId];
            return p.papel === 'TITULAR' && fatiaViva !== undefined
              ? { ...base, horasRateio: fatiaViva }
              : base;
          }),
        },
      }
    : m;

  const blocos = normalizeMeasurementBlocks(paraNormalizar, titularId);

  const blocoDe = (instructorId: string): MeasurementPersonBlock | undefined =>
    v2
      ? blocos.find(b => b.instructorId === instructorId)
      : blocos[0]?.instructorId === instructorId || (!blocos[0]?.instructorId && !instructorId)
        ? blocos[0]
        : undefined;

  const horasInformadasDe = (instructorId: string): boolean =>
    v2 ? !!blocoDe(instructorId)?.horasInformadas : !!blocos[0]?.horasInformadas;

  return { v2, titularId, paraNormalizar, blocos, blocoDe, horasInformadasDe };
}

/**
 * A fatia do rateio por dias de cada TITULAR (instructorId → horas), com a
 * MESMA conta do Excel (`rateioDaDemanda`, domain/instructorHours.ts) sobre a
 * carga do painel. Devolve mapa vazio quando não há o que ratear (demanda de
 * um titular só, sem alocação em dia real, carga zero): aí ninguém tem fatia
 * e `blockPanelHours` cai na carga cheia — o comportamento de sempre.
 *
 * Só faz sentido com 2+ titulares alocados: com um, a fatia é a carga inteira
 * e não precisa de campo. Por isso o mapa só é preenchido quando o rateio é
 * `dividida`.
 */
export function horasRateioPorTitular(
  demand: Parameters<typeof rateioDaDemanda>[0],
  allocations: RateioAllocationLike[],
  carga: number
): Record<string, number> {
  const r = rateioDaDemanda(demand, allocations, carga);
  if (!r || !r.dividida) return {};
  const out: Record<string, number> = {};
  for (const l of r.linhas) out[l.instructorId] = Math.round((l.horas + Number.EPSILON) * 100) / 100;
  return out;
}
