/**
 * CONFLITO DE RECURSO (CTM) — regra pura, fonte única
 *
 * Extraída de `App.tsx` (`hasResourceConflict`) sem alteração de comportamento,
 * pelo mesmo motivo dos outros módulos de `domain/`: a regra precisa ser
 * testável fora do React. O smoke `smoke:ctm` exercita justamente o caso que
 * não dá para verificar clicando — conflito entre uma demanda INTERNA e uma de
 * CLIENTE no mesmo CTM, nos dois sentidos.
 *
 * ⚠️ A regra é NEUTRA quanto a `tipo`: o Centro de Treinamento Móvel é recurso
 * único da Colabor. Se uma interna o reserva de 10 a 12, uma demanda de cliente
 * não pode reservá-lo no dia 11 — e vice-versa. Nenhum ramo aqui olha
 * `tipo`, `company_id` ou treinamento; se alguém adicionar um, quebrou o
 * bloqueio cruzado que é a razão de a função existir.
 */

export interface ResourceAllocationLike {
  id: string;
  demandId: string;
  startDate: string;
  endDate: string;
}

export interface ResourceConflictDemandLike {
  id: string;
  status?: string;
}

export interface ResourceConflictInput {
  startDate: string;
  endDate: string;
  allocations: ResourceAllocationLike[];
  demands: ResourceConflictDemandLike[];
  excludeDemandId?: string;
  excludeAllocationId?: string;
}

export function hasResourceOverlap({
  startDate,
  endDate,
  allocations,
  demands,
  excludeDemandId,
  excludeAllocationId,
}: ResourceConflictInput): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);

  return allocations.some(a => {
    if (excludeAllocationId && a.id === excludeAllocationId) return false;

    const d = demands.find(dm => dm.id === a.demandId);
    if (d) {
      // A própria demanda não conflita consigo mesma, e demanda cancelada
      // libera o recurso.
      if (excludeDemandId && d.id === excludeDemandId) return false;
      if (d.status === 'CANCELADA') return false;
    }
    // Alocação órfã (sem demanda correspondente) continua bloqueando — mesmo
    // comportamento do original; a limpeza de órfãos é responsabilidade do
    // sync, não da checagem.

    const aStart = new Date(a.startDate);
    const aEnd = new Date(a.endDate);
    return start <= aEnd && end >= aStart;
  });
}
