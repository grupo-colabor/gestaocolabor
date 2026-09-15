/**
 * SMOKE — Exportações: blocos [A] [B] [C] [D] [G] (datasets e registry)
 *
 * Chamado por smokeExportacoes.ts. Preenchido nos commits dos datasets.
 */
export interface SmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
  ler: (rel: string) => string;
  semComentarios: (src: string) => string;
  fixtures: any;
}

/** Devolve o nº de falhas acumuladas nos blocos de dataset. */
export function runDatasetChecks(_t: SmokeTools): number {
  console.log('\n[A-D, G] datasets — pendentes (entram com domain/exports/datasets)');
  return 0;
}
