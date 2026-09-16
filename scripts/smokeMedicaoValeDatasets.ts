/**
 * SMOKE — Medição Vale: blocos [D] dataset, [X] escritor, [P] painel.
 * Chamado por smokeMedicaoVale.ts. Preenchido nos commits 4 a 6.
 */
export interface ValeSmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
  ler: (rel: string) => string;
  semComentarios: (src: string) => string;
  fixtures: any;
}

export function runValeDatasetChecks(_t: ValeSmokeTools): number {
  console.log('\n[D] [X] [P] — pendentes (entram com dataset, escritor e painel)');
  return 0;
}
