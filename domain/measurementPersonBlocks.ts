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
 *   • v2 — medição COM `participantes` gravados, OU demanda com segunda
 *     categoria de pessoa → um bloco por pessoa da LISTA DO CADASTRO
 *     (`resolveMeasurementPeople`), usando o bloco gravado quando existe e um
 *     bloco vazio quando não. Pessoa que saiu do cadastro perde o bloco e os
 *     itens dela caem no titular (`normalizeMeasurementBlocks`).
 *   • v1 — o resto (todo o histórico mono-pessoa): UM bloco, no titular de
 *     `demands.instructor_id` (ou o primeiro titular da lista), com TODOS os
 *     itens. O segundo titular de uma demanda dividida por dias NÃO tem bloco:
 *     item sem dono é do titular principal, nunca rateado.
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

export function resolvePersonBlocks(
  m: TotalizableMeasurement,
  demand: { instructorId?: string | null },
  pessoas: PersonLike[]
): PersonBlocks {
  const temSegundaCategoria = pessoas.some(p => p.papel !== 'TITULAR');
  const gravados = m.expenses?.participantes ?? [];
  const titularId = demand.instructorId || pessoas.find(p => p.papel === 'TITULAR')?.instructorId || '';

  const v2 = gravados.length > 0 || temSegundaCategoria;
  const paraNormalizar: TotalizableMeasurement = v2
    ? {
        ...m,
        expenses: {
          ...(m.expenses ?? {}),
          participantes: pessoas.map(p => {
            const g = gravados.find(x => x?.instructorId === p.instructorId);
            return g ?? { instructorId: p.instructorId, papel: p.papel };
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
