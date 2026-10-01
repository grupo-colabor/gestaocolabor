/**
 * LINHAS DE ACOMPANHANTE — a convenção de gravação e a leitura por pessoa
 *
 * `companion_allocations` é UMA LINHA POR DIA, e cada tela que cria
 * acompanhante montava essa linha na mão. Com o bloco Acompanhantes da
 * Visualização da Demanda seriam três cópias da mesma montagem — e a promessa
 * do bloco é justamente gravar a MESMA linha que a Orquestração Logística.
 *
 * A montagem mora aqui, uma vez. A Orquestração e o bloco chamam
 * `buildCompanionRow` para cada dia e passam o resultado para
 * `addCompanionAllocation` — a linha que chega ao banco é a mesma, venha de
 * qual das duas vier. É isso que `smoke:acompanhantes` prende.
 *
 * ⚠️ O AllocationDrawer da agenda ainda NÃO passa por aqui: ele grava
 * T08:00/T18:00 literais (o card do acompanhante mostra 08–18 até numa demanda
 * noturna). É a divergência registrada em domain/allocationReschedule.ts.
 *
 * ---------------------------------------------------------------------------
 * A convenção (a da Logística, que é a que o reagendamento também aplica)
 * ---------------------------------------------------------------------------
 *   • uma linha por dia escolhido;
 *   • o horário é o DA DEMANDA: a hora do `startDate` no início e a do
 *     `endDate` no fim, em todos os dias;
 *   • 08:00 / 18:00 só quando a demanda não tem hora gravada.
 *
 * É a mesma derivação que `planAllocationReschedule` recebe de quem edita as
 * datas (`horaInicio` / `horaFim`), então a linha que nasce aqui e a linha que
 * sobrevive a um reagendamento têm o mesmo formato.
 *
 * Função pura: nenhuma escrita, nenhum import de serviço.
 */
import { classifyAllocationAgainstDemand, type AllocationCoverage } from './demandInstructors';

export const COMPANION_FALLBACK_START = '08:00';
export const COMPANION_FALLBACK_END = '18:00';

/** Só o que a montagem lê de uma demanda. */
export interface CompanionDemandLike {
  id: string;
  /** 'YYYY-MM-DDTHH:mm' (ou só a data, e aí vale o fallback). */
  startDate?: string | null;
  endDate?: string | null;
}

/** O que vai para `addCompanionAllocation` — falta só o id provisório. */
export interface CompanionRowDraft {
  demandId: string;
  instructorId: string;
  startDate: string;
  endDate: string;
}

/** 'HH:mm' de 'YYYY-MM-DDTHH:mm[:ss]'; vazio quando não há hora. */
const horaDe = (v?: string | null): string => (String(v ?? '').split('T')[1] || '').slice(0, 5);

/** O horário que o acompanhante herda da demanda, já com o fallback. */
export function companionHoursOf(demand: CompanionDemandLike): { horaInicio: string; horaFim: string } {
  return {
    horaInicio: horaDe(demand.startDate) || COMPANION_FALLBACK_START,
    horaFim: horaDe(demand.endDate) || COMPANION_FALLBACK_END,
  };
}

/**
 * A linha de UM dia de acompanhamento.
 *
 * `dia` vem do CompanionPicker ('YYYY-MM-DD', sempre um dia da demanda). A
 * string é montada por concatenação, nunca por `Date`: `start_date` é TEXT no
 * banco e hora de parede — passar por `toISOString()` deslocaria o dia.
 */
export function buildCompanionRow(
  demand: CompanionDemandLike,
  instructorId: string,
  dia: string
): CompanionRowDraft {
  const { horaInicio, horaFim } = companionHoursOf(demand);
  const d = String(dia ?? '').slice(0, 10);

  return {
    demandId: demand.id,
    instructorId,
    startDate: `${d}T${horaInicio}`,
    endDate: `${d}T${horaFim}`,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * LEITURA POR PESSOA — o que o bloco Acompanhantes lista
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A tabela guarda dias; a tela mostra PESSOAS. Um acompanhante de 3 dias são 3
 * linhas e tem de aparecer uma vez só, com "3 de 5 dias" — e a lixeira dele
 * apaga as 3.
 *
 * A cobertura é a mesma pergunta do bloco Instrutores da demanda interna
 * (`classifyAllocationAgainstDemand`): quanto do que está gravado ainda cai nos
 * dias reais da demanda? Linha num dia que a demanda deixou é invisível na
 * agenda (o card só renderiza na interseção), mas continua bloqueando conflito
 * naquele dia — então aparece aqui COM AVISO, nunca em silêncio.
 */

/** Uma linha de `companion_allocations` como o estado do App a guarda. */
export interface CompanionRowLike {
  id: string;
  demandId?: string;
  instructorId: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface CompanionPersonSummary {
  instructorId: string;
  /** TODAS as linhas da pessoa na demanda — é o que a lixeira apaga. */
  rowIds: string[];
  /** Dias gravados que são dias da demanda. */
  diasDentro: string[];
  /** Dias gravados que a demanda não tem mais. */
  diasFora: string[];
  cobertura: AllocationCoverage;
  /** Acompanha todos os dias da demanda. */
  periodoTodo: boolean;
  /** "período todo" ou "2 de 5 dias". */
  rotuloDias: string;
}

export function summarizeCompanions(
  rows: CompanionRowLike[],
  diasDemanda: string[]
): CompanionPersonSummary[] {
  const porPessoa = new Map<string, CompanionRowLike[]>();
  for (const r of rows ?? []) {
    if (!r?.instructorId) continue;
    const lista = porPessoa.get(r.instructorId) ?? [];
    lista.push(r);
    porPessoa.set(r.instructorId, lista);
  }

  const total = diasDemanda.length;
  const resumo: CompanionPersonSummary[] = [];

  for (const [instructorId, linhas] of porPessoa) {
    const dentro = new Set<string>();
    const fora = new Set<string>();
    for (const l of linhas) {
      const c = classifyAllocationAgainstDemand(l, diasDemanda);
      c.diasDentro.forEach(d => dentro.add(d));
      c.diasFora.forEach(d => fora.add(d));
    }

    const diasDentro = [...dentro].sort();
    const diasFora = [...fora].sort();
    const periodoTodo = total > 0 && diasDentro.length === total;

    resumo.push({
      instructorId,
      rowIds: linhas.map(l => l.id),
      diasDentro,
      diasFora,
      cobertura: diasFora.length === 0 ? 'DENTRO' : diasDentro.length === 0 ? 'FORA' : 'PARCIAL',
      periodoTodo,
      rotuloDias: periodoTodo
        ? 'período todo'
        : `${diasDentro.length} de ${total} ${total === 1 ? 'dia' : 'dias'}`,
    });
  }

  return resumo;
}

/* ────────────────────────────────────────────────────────────────────────────
 * O BLOCO NA VISUALIZAÇÃO DA DEMANDA — aparece? escreve?
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   • demanda INTERNA  → o bloco não existe. Interna tem participantes
 *     (`demand_participants`), que são titulares plenos; acompanhante é vínculo
 *     de demanda de cliente.
 *   • CANCELADA / CONCLUIDA → só leitura: a lista aparece, o "+ Adicionar" e a
 *     lixeira não.
 *   • qualquer outro status, COM ou SEM instrutor alocado → escrita. Esse é o
 *     ponto do bloco: antes, acompanhante só entrava pela Orquestração, que só
 *     lista demanda sem instrutor.
 */
export type CompanionBlockMode = 'OCULTO' | 'LEITURA' | 'EDICAO';

export function companionBlockMode(
  demand: { tipo?: string | null },
  status: string,
  podeEditar: boolean
): CompanionBlockMode {
  if (demand?.tipo === 'interna') return 'OCULTO';
  if (!podeEditar) return 'LEITURA';
  return status === 'CANCELADA' || status === 'CONCLUIDA' ? 'LEITURA' : 'EDICAO';
}
