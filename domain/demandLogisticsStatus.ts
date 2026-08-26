/**
 * PRONTIDÃO LOGÍSTICA — a regra única das duas telas
 *
 * "Logística pronta" era calculada em DOIS lugares com regras diferentes:
 *
 *  - `LogisticsControl.tsx` RECALCULAVA o checklist (Hotel, Carro, Material,
 *    Liberação, Lista) e escrevia o resultado de volta em
 *    `logistic_allocations.overall_status`.
 *  - `notificationAlerts.hasPendingLogistics` LIA esse `overall_status` — ou
 *    seja, dependia de alguém ter aberto o Controle Logístico para o valor
 *    estar correto.
 *
 * As duas convergem agora neste módulo: o Controle Logístico o usa para pintar
 * as colunas e para persistir o `overall_status`, e a Central de Notificações o
 * usa para decidir a pendência a partir da MESMA linha de `logistic_allocations`
 * (as colunas `has_release_pdf` / `has_class_list_pdf` são mantidas em dia pelo
 * write-back do Controle). Uma regra, dois consumidores.
 *
 * ---------------------------------------------------------------------------
 * DEMANDA INTERNA — o que muda e por quê
 * ---------------------------------------------------------------------------
 * O checklist nasceu para treinamento de cliente e exigia as cinco colunas de
 * toda demanda. Duas delas não existem no mundo da interna:
 *
 *  - MATERIAL é o material didático da turma. Interna (visita, SIPAT, apoio
 *    logístico, evento) não tem turma nem material — a coluna é um toggle
 *    manual que ninguém tem motivo para marcar, e ficava travando o PRONTO
 *    para sempre.
 *  - LISTA é o "Documento de Apoio" no formulário interno, OPCIONAL por decisão
 *    de produto (Fase 3). Exigi-lo contradiz o próprio formulário.
 *
 * As duas viram `NAO_APLICA` na interna: estado neutro, não conta como
 * pendência. Hotel, Carro e Liberação seguem valendo — alguém se desloca,
 * alguém se hospeda, e a liberação do instrutor faz sentido em qualquer
 * demanda.
 *
 * Para demanda de CLIENTE nenhuma coluna é `NAO_APLICA`, então o resultado é
 * idêntico ao da regra antiga (ver scripts/smokeLogistica.ts, que prova isso
 * por execução comparando com a implementação original).
 */

/** Estado de uma coluna do checklist. `NAO_APLICA` não bloqueia o PRONTO. */
export type ChecklistState = 'OK' | 'PENDENTE' | 'NAO_APLICA';

/**
 * Modos de transporte que contam como "carro resolvido" mesmo sem `has_car`.
 * Vem da regra original do Controle Logístico e é mantida como estava.
 */
const TRANSPORT_MODES_OK = ['NAO_NECESSARIO', 'CARRO_ALUGADO', 'CARRO_PROPRIO'];
const LODGING_MODES_OK = ['NAO_NECESSARIO', 'PRECISA_HOTEL'];

const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();

/**
 * Tudo o que a regra lê. O chamador resolve as buscas (linha de
 * `logistic_allocations`, PDFs em `demand_documents`) e entrega pronto.
 */
export interface LogisticsChecklistInput {
  /** `tipo === 'interna'`. É o que liga o tratamento de MATERIAL e LISTA. */
  isInternal: boolean;
  /** `false` quando não existe linha em `logistic_allocations`. */
  hasAlloc: boolean;

  hasCar?: boolean | null;
  transportMode?: string | null;
  hasHotel?: boolean | null;
  lodgingMode?: string | null;
  hasMaterial?: boolean | null;

  /** LIBERACAO_INSTRUTOR: PDF anexado ou marcado N/A. */
  hasReleasePdf?: boolean | null;
  /** LISTA_TURMA (na interna, "Documento de Apoio"). */
  hasClassListPdf?: boolean | null;

  /**
   * Campos antigos da própria demanda, usados só quando não há linha de
   * logística. Preservado da implementação original para não quebrar registros
   * anteriores à tabela `logistic_allocations`.
   */
  legacy?: {
    logisticsHotel?: string | null;
    logisticsTransport?: string | null;
    materialReady?: boolean | null;
  };
}

export interface LogisticsChecklist {
  hotel: ChecklistState;
  car: ChecklistState;
  material: ChecklistState;
  release: ChecklistState;
  list: ChecklistState;
  /** true quando nenhuma coluna está PENDENTE. */
  ready: boolean;
}

const ok = (v: boolean): ChecklistState => (v ? 'OK' : 'PENDENTE');

export function buildLogisticsChecklist(input: LogisticsChecklistInput): LogisticsChecklist {
  const legacy = input.legacy ?? {};

  const car: ChecklistState = input.hasAlloc
    ? ok(input.hasCar === true || TRANSPORT_MODES_OK.includes(upper(input.transportMode)))
    : ok(['CONFIRMADO', 'NAO_NECESSARIO'].includes(upper(legacy.logisticsTransport)));

  const hotel: ChecklistState = input.hasAlloc
    ? ok(input.hasHotel === true || LODGING_MODES_OK.includes(upper(input.lodgingMode)))
    : ok(['CONFIRMADO', 'NAO_NECESSARIO'].includes(upper(legacy.logisticsHotel)));

  // Interna não tem material didático — ver cabeçalho.
  const material: ChecklistState = input.isInternal
    ? 'NAO_APLICA'
    : input.hasAlloc
      ? ok(input.hasMaterial === true)
      : ok(legacy.materialReady === true);

  // Liberação do instrutor vale para interna também (decisão da Fase 3).
  const release: ChecklistState = ok(input.hasReleasePdf === true);

  // "Documento de Apoio" é opcional na interna — ver cabeçalho.
  const list: ChecklistState = input.isInternal ? 'NAO_APLICA' : ok(input.hasClassListPdf === true);

  const states = [hotel, car, material, release, list];
  return { hotel, car, material, release, list, ready: states.every(s => s !== 'PENDENTE') };
}

/** Atalho para quem só quer o booleano. */
export const isLogisticsReady = (input: LogisticsChecklistInput): boolean =>
  buildLogisticsChecklist(input).ready;

/** O valor gravado em `logistic_allocations.overall_status`. */
export const overallStatusFor = (input: LogisticsChecklistInput): 'CONCLUIDA' | 'PENDENTE' =>
  isLogisticsReady(input) ? 'CONCLUIDA' : 'PENDENTE';
