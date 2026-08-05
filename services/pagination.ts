import type { PostgrestError } from '@supabase/supabase-js';

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Busca TODAS as linhas de uma query Supabase, paginando via .range() em
 * lotes de `pageSize` até vir uma página incompleta (fim dos dados).
 *
 * Necessário porque o PostgREST/Supabase corta silenciosamente o
 * resultado de um select() sem .range() em ~1000 linhas por padrão —
 * sem erro, sem aviso. Foi a causa raiz do bug em que DEM-1059/DEM-725
 * sumiam do Controle Logístico assim que logistic_allocations passou de
 * 1000 linhas (e do mesmo problema em demands/instructor_allocations).
 *
 * `buildPage(from, to)` deve devolver a MESMA query que o caller usaria
 * sem paginação, só acrescentando `.range(from, to)` — preservando
 * select/filtros/order originais. O `.order()` é necessário para a
 * paginação ser estável entre páginas.
 */
export async function fetchAllPaginated<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await buildPage(from, to);

    if (error) throw error;

    const page = data || [];
    all.push(...page);

    // Página veio menor que o tamanho pedido (ou vazia) => acabaram as linhas.
    if (page.length < pageSize) break;

    from += pageSize;
  }

  return all;
}
