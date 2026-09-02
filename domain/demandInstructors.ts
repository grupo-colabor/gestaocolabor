/**
 * INSTRUTORES DE UMA DEMANDA — leitura com fallback, fonte única
 *
 * `demands.instructor_id` e `instructor_allocations` divergem por construção:
 * a alocação principal (Programação / Alocação Inteligente) escreve os dois,
 * mas o botão "Adicionar" do modal de cliente só escreve a tabela. Quem lê
 * precisa, portanto, de uma regra explícita — e ela estava escrita direto
 * dentro de `InternalDemands.tsx` (`allInstructorsByDemandId`).
 *
 * A regra: se existe linha em `instructor_allocations` para a demanda, ela
 * manda; senão, cai para `demands.instructor_id`. Extraída para cá porque o
 * bloco INSTRUTORES do modal de interna precisa da MESMA leitura, só que com
 * os períodos junto — e duas cópias da regra divergiriam no primeiro ajuste.
 *
 * ⚠️ Só leitura. Nada aqui escreve em `instructor_allocations`.
 */
import { getDemandDays } from './demandDays';

export interface InstructorAllocationLike {
  id?: string;
  demandId: string;
  instructorId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ResolvedInstructorEntry {
  /** id da linha em instructor_allocations; ausente quando veio do fallback */
  allocationId?: string;
  instructorId: string;
  startDate?: string;
  endDate?: string;
  /** 'allocation' = linha real na tabela · 'principal' = fallback de demands.instructor_id */
  source: 'allocation' | 'principal';
}

/**
 * Alocações da demanda, ordenadas por data de início, com fallback para o
 * instrutor principal quando não há nenhuma linha na tabela.
 */
export function resolveDemandInstructors(
  demandId: string,
  principalInstructorId: string | undefined,
  allocations: InstructorAllocationLike[]
): ResolvedInstructorEntry[] {
  const rows = allocations
    .filter(a => a.demandId === demandId && a.instructorId)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  if (rows.length > 0) {
    return rows.map(a => ({
      allocationId: a.id,
      instructorId: a.instructorId as string,
      startDate: a.startDate,
      endDate: a.endDate,
      source: 'allocation' as const,
    }));
  }

  return principalInstructorId
    ? [{ instructorId: principalInstructorId, source: 'principal' as const }]
    : [];
}

/** Só os ids, sem repetição — o que a listagem precisa. */
export function resolveDemandInstructorIds(
  demandId: string,
  principalInstructorId: string | undefined,
  allocations: InstructorAllocationLike[]
): string[] {
  return [
    ...new Set(
      resolveDemandInstructors(demandId, principalInstructorId, allocations).map(e => e.instructorId)
    ),
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
 * COBERTURA DA ALOCAÇÃO FRENTE AOS DIAS DA DEMANDA
 * ──────────────────────────────────────────────────────────────────────────
 *
 * O caso real (DEM-1551): a interna tinha alocação de instrutor 04–08/09 criada
 * pela agenda; o form interno mudou a demanda para 09–10/09 SEM passar pelo
 * plano de reagendamento, e a linha de `instructor_allocations` ficou onde
 * estava. Resultado: uma ALOCAÇÃO-FANTASMA — invisível na agenda (o card só
 * renderiza na interseção com os dias da demanda), mas bloqueando conflito nos
 * dias antigos, e exibida no modal com as datas velhas sem nenhum aviso.
 *
 * Esta função responde, sem escrever nada, "quanto desta alocação cai dentro
 * da demanda?", para o bloco Instrutores do modal marcar o que está fora e
 * para o smoke provar que o save antigo (sem plano) produz fantasma.
 */
export type AllocationCoverage = 'DENTRO' | 'PARCIAL' | 'FORA';

export interface AllocationCoverageResult {
  cobertura: AllocationCoverage;
  /** Dias da alocação que caem nos dias da demanda. */
  diasDentro: string[];
  /** Dias da alocação fora da demanda — o que a agenda não mostra. */
  diasFora: string[];
}

export function classifyAllocationAgainstDemand(
  allocation: { startDate?: string | null; endDate?: string | null },
  diasDemanda: string[]
): AllocationCoverageResult {
  const start = (allocation.startDate ?? '').slice(0, 10);
  const end = (allocation.endDate ?? '').slice(0, 10);
  if (!start || !end) return { cobertura: 'DENTRO', diasDentro: [], diasFora: [] };

  const diasAlocacao = getDemandDays({ dateMode: 'CONTINUO', startDate: start, endDate: end } as any);
  const demanda = new Set(diasDemanda);
  const diasDentro = diasAlocacao.filter(d => demanda.has(d));
  const diasFora = diasAlocacao.filter(d => !demanda.has(d));

  const cobertura: AllocationCoverage =
    diasFora.length === 0 ? 'DENTRO' : diasDentro.length === 0 ? 'FORA' : 'PARCIAL';

  return { cobertura, diasDentro, diasFora };
}

/* ────────────────────────────────────────────────────────────────────────────
 * ROTEAMENTO DA LIXEIRA DO BLOCO INSTRUTORES
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A linha exibida pode ter duas origens, e a remoção de cada uma é um caminho
 * DIFERENTE que nunca pode cruzar:
 *
 *   • 'allocation' → apagar a linha de `instructor_allocations` (pelo caminho
 *     existente do App, que recalcula quem sobra e volta a demanda para
 *     PENDENTE quando não sobra ninguém);
 *   • 'principal'  → limpar `demands.instructor_id` (a demanda vira
 *     "Não Alocado"). Não existe linha para apagar.
 *
 * Apagar allocation quando a linha veio do fallback não faz nada; limpar o
 * instructor_id quando havia linha deixa a linha órfã. Por isso a decisão é
 * pura e testada, e a tela só executa o que ela devolve.
 */
export type InstructorRemovalRoute =
  | { kind: 'DELETE_ALLOCATION'; allocationId: string; instructorId: string }
  | { kind: 'CLEAR_PRINCIPAL'; instructorId: string };

export function routeInstructorRemoval(entry: ResolvedInstructorEntry): InstructorRemovalRoute {
  if (entry.source === 'allocation' && entry.allocationId) {
    return { kind: 'DELETE_ALLOCATION', allocationId: entry.allocationId, instructorId: entry.instructorId };
  }
  return { kind: 'CLEAR_PRINCIPAL', instructorId: entry.instructorId };
}
