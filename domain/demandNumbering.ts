/**
 * NUMERAÇÃO DE DEMANDA — o "DEM-N" e de onde vem o N
 *
 * Até 09/2026 o app calculava N como "maior `number` no banco + 1", lido a
 * cada sync. Apagar a demanda de maior número fazia o próximo cadastro
 * REAPROVEITAR o número (e herdar medição/CTM órfãos com o mesmo id); dois
 * navegadores abertos partiam do mesmo máximo.
 *
 * Agora N vem de uma SEQUENCE no Postgres (migration 019), alocada por RPC
 * (`allocate_demand_number`) antes do insert. Uma sequence nunca devolve o
 * mesmo número duas vezes — nem após exclusão, nem após insert que falhou.
 * Buracos na numeração são aceitáveis; repetição não.
 *
 * Este módulo é a parte PURA: formatar/ler o id e a política de alocação
 * ("peça um número novo a cada cadastro; nunca reutilize um que falhou").
 * `allocate` é injetado: no app é a RPC; no smoke, uma sequence simulada.
 * No modo mock o contador continua em estado local (App.tsx).
 */

export const DEMAND_ID_PREFIX = 'DEM-';

export const formatDemandId = (n: number): string => `${DEMAND_ID_PREFIX}${n}`;

/** 'DEM-1719' → 1719; qualquer outra coisa → null. */
export function parseDemandNumber(id: string | null | undefined): number | null {
  const m = /^DEM-(\d+)$/.exec(String(id ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Aloca um número NOVO e devolve o id. Nunca reutiliza: se o chamador falhar
 * depois (insert recusado), o número fica consumido e o próximo cadastro pede
 * outro — é o que impede dois "DEM-1719".
 */
export async function allocateDemandId(allocate: () => Promise<number>): Promise<string> {
  const n = await allocate();
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Número de demanda inválido devolvido pela sequence: ${String(n)}`);
  }
  return formatDemandId(n);
}
