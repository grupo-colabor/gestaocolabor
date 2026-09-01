/**
 * ORDEM E DEDUPE DA CELULA DIVIDIDA DA AGENDA
 *
 * A grade mostra um card por celula (instrutor x dia). Quando a mesma pessoa
 * tem mais de um compromisso no mesmo dia, a celula divide e mostra um card
 * por compromisso — e quem alimenta essa divisao e o mapa `allocMulti` do
 * useMemo da agenda (CalendarView), preenchido por tres passadas: alocacao de
 * titular, acompanhante e participante de interna.
 *
 * Este modulo e o fechamento dessas passadas. Ele vive aqui fora, e nao dentro
 * do useMemo, porque e a unica parte da montagem que da para testar de
 * verdade: o resto depende de estado de componente.
 *
 * DUAS REGRAS, E elas nao sao a mesma coisa:
 *
 * 1. DEDUPE E POR DEMANDA, NAO POR INSTRUTOR+DIA. Duas demandas diferentes no
 *    mesmo dia DEVEM virar dois cards — e exatamente para isso que a celula
 *    divide. O que nao pode e a MESMA demanda aparecer duas vezes na mesma
 *    celula: quem ja esta na demanda (alocacao, participante) prevalece, e o
 *    registro de acompanhante da mesma demanda nao vira um segundo card.
 *
 * 2. ORDEM: quem trabalha na demanda primeiro, acompanhante depois. Sem isto a
 *    ordem seria a das passadas, e a de acompanhante roda ANTES da de
 *    participante — o acompanhante apareceria na frente por acidente de
 *    execucao. `sort` e estavel (ES2019+), entao entre iguais a ordem de
 *    insercao das passadas se mantem.
 */

export interface AgendaCellItemLike {
  id: string;
  demandId?: string;
  isCompanion?: boolean;
}

export function normalizeAgendaCell<T extends AgendaCellItemLike>(items: T[]): T[] {
  const demandasComTrabalho = new Set<string>();
  for (const item of items) {
    if (!item.isCompanion && item.demandId) demandasComTrabalho.add(item.demandId);
  }

  return items
    .filter(item => !(item.isCompanion && item.demandId && demandasComTrabalho.has(item.demandId)))
    .sort((a, b) => Number(!!a.isCompanion) - Number(!!b.isCompanion));
}
