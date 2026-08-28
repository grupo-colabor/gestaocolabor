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
