/**
 * SMOKE — BM da Vale: blocos [Σ] dataset, [X] escritor, [Z] zip.
 * Chamado por smokeMedicaoValeBm.ts. Preenchido nos commits seguintes.
 */
export interface BmSmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
}

export async function runBmChecks(_t: BmSmokeTools): Promise<number> {
  console.log('\n[Σ] [X] [Z] — pendentes (dataset, escritor e zip)');
  return 0;
}
