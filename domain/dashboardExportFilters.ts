/**
 * LINHA DE FILTROS DO EXPORT DO DASHBOARD — texto puro
 *
 * O Excel do Dashboard só dizia "Exportado em". Quem abria o arquivo uma
 * semana depois não sabia de que recorte os números eram. Esta função monta a
 * frase que vai na segunda linha de cada aba, a partir dos rótulos JÁ
 * resolvidos pela tela (nome da empresa, da região, do status…): o domínio
 * não conhece as listas do contexto, e assim o smoke confere o texto sem
 * montar nada.
 *
 * Só P1 — o export inteiro é do período principal (opção A do parecer das
 * despesas não reembolsáveis), e a linha diz isso explicitamente.
 */
export interface DashboardFilterLabels {
  /** Rótulo do período principal, como a tela mostra (ex.: "01/ago/26 – 31/ago/26" ou "Todo o período"). */
  periodo: string;
  empresa?: string;
  regiao?: string;
  status?: string;
  local?: string;
  corredor?: string;
  modalidade?: string;
  uf?: string;
}

const PARTES: { key: keyof Omit<DashboardFilterLabels, 'periodo'>; label: string }[] = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'regiao', label: 'Região' },
  { key: 'status', label: 'Status' },
  { key: 'local', label: 'Local' },
  { key: 'corredor', label: 'Corredor' },
  { key: 'modalidade', label: 'Modalidade' },
  { key: 'uf', label: 'UF' },
];

/** "P1: <período> · Empresa: Vale · UF: MG", ou "P1: <período> · Sem outros filtros". */
export function describeDashboardFilters(l: DashboardFilterLabels): string {
  const partes = PARTES
    .map(p => ({ label: p.label, value: String(l[p.key] ?? '').trim() }))
    .filter(p => p.value)
    .map(p => `${p.label}: ${p.value}`);
  const periodo = `P1: ${(l.periodo || '').trim() || 'Todo o período'}`;
  return [periodo, ...(partes.length ? partes : ['Sem outros filtros'])].join(' · ');
}
