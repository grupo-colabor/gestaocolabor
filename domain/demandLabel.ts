/**
 * RÓTULO DE EXIBIÇÃO DA DEMANDA — fonte única
 *
 * Demanda de cliente é identificada por empresa + treinamento. Demanda interna
 * não tem treinamento (e a empresa é opcional), então precisa de outro par:
 * `categoriaInterna — descricaoInterna` no lugar do treinamento, e o nome da
 * empresa quando houver, senão "Colabor (Interna)".
 *
 * Isto vive aqui, e não em cada tela, porque o mesmo par aparece em Logística,
 * Controle Logístico, Agenda, Medição e nos exports — antes de existir este
 * módulo cada uma delas resolvia `companies.find(...)?.name || 'Empresa N/A'`
 * por conta própria, e a interna aparecia como "Empresa N/A / Treinamento N/A".
 */
import type { Demand } from '../types';

/** Empresa exibida para interna SEM empresa vinculada. */
export const INTERNAL_COMPANY_LABEL = 'Colabor (Interna)';

/** Só o necessário para rotular — aceita `Demand` e qualquer subconjunto dela. */
type LabelableDemand = Pick<Demand, 'tipo'> &
  Partial<Pick<Demand, 'companyId' | 'trainingId' | 'categoriaInterna' | 'descricaoInterna'>>;

type NamedRow = { id: string; name: string };

export const isInternalDemand = (d?: { tipo?: Demand['tipo'] } | null): boolean =>
  d?.tipo === 'interna';

/**
 * Título da demanda: nome do treinamento (cliente) ou `categoria — descrição`
 * (interna). Se a interna tiver só um dos dois, usa o que existir.
 */
export function getDemandTitle(
  demand: LabelableDemand | undefined | null,
  trainings: NamedRow[],
  fallback = 'Treinamento N/A'
): string {
  if (!demand) return fallback;

  if (!isInternalDemand(demand)) {
    return trainings.find(t => t.id === demand.trainingId)?.name || fallback;
  }

  const categoria = (demand.categoriaInterna || '').trim();
  const descricao = (demand.descricaoInterna || '').trim();
  if (categoria && descricao) return `${categoria} — ${descricao}`;
  return categoria || descricao || 'Demanda interna';
}

/**
 * Empresa da demanda. Interna pode ter empresa vinculada (o CHECK
 * demands_cliente_requires_refs só exige as refs para tipo='cliente'); quando
 * não tem, ou quando a empresa foi excluída, cai em "Colabor (Interna)".
 */
export function getDemandCompanyLabel(
  demand: LabelableDemand | undefined | null,
  companies: NamedRow[],
  fallback = 'Empresa N/A'
): string {
  if (!demand) return fallback;

  const companyName = companies.find(c => c.id === demand.companyId)?.name;

  if (!isInternalDemand(demand)) return companyName || fallback;
  return companyName || INTERNAL_COMPANY_LABEL;
}

/** Categoria da interna, para colunas dedicadas (ex.: Excel de pagamento). */
export function getDemandCategoria(demand: LabelableDemand | undefined | null): string {
  if (!demand || !isInternalDemand(demand)) return '';
  return (demand.categoriaInterna || '').trim();
}
