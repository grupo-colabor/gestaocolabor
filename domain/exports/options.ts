/**
 * MOTOR DE EXPORTAÇÃO — opções marcáveis
 *
 * Diferente dos FILTROS (que recortam linhas), uma opção muda o CONTEÚDO da
 * linha ou uma regra de inclusão que antes era silenciosa. Cada dataset
 * declara em `options` quais delas oferece; a UI só mostra essas.
 *
 *   • usarValorHH (Medições) — ligada: o Valor HH gravado na medição entra em
 *     Hora/aula e Total geral, como sempre. Desligada: Valor HH, as duas
 *     Hora/aula e Total geral saem EM BRANCO, e `Origem da tarifa` diz que a
 *     tarifa da medição está desativada. Existe porque a Colabor ainda não
 *     preenche o HH da medição; até preencher, um R$ 0,00 parece número.
 *
 *   • incluirCanceladas (todos) — desligada por padrão: a F1 incluía demanda
 *     cancelada em silêncio quando o filtro de status ficava em "Todos". O
 *     Excel de pagamento nunca as inclui (cancelamento ganha em
 *     calculateDemandStatus) e no dataset Demandas elas inflam contagens.
 *     `Status = Cancelada` no select FORÇA a inclusão, para nenhuma
 *     combinação devolver zero linhas sem explicação.
 */
export type OptionKey = 'usarValorHH' | 'incluirCanceladas';

export interface ExportOptions {
  usarValorHH: boolean;
  incluirCanceladas: boolean;
}

export const DEFAULT_OPTIONS: ExportOptions = {
  usarValorHH: true,
  incluirCanceladas: false,
};

export const OPTION_LABELS: Record<OptionKey, { label: string; help: string }> = {
  usarValorHH: {
    label: 'Usar Valor HH da medição',
    help: 'Desligado: Valor HH, Hora/aula e Total geral saem em branco; Origem da tarifa explica.',
  },
  incluirCanceladas: {
    label: 'Incluir canceladas',
    help: 'Desligado: demandas canceladas ficam fora, a menos que o filtro de status seja "Cancelada".',
  },
};
