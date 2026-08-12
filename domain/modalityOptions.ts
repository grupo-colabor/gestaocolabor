/**
 * FONTE ÚNICA — MODALIDADES (opções de filtro)
 *
 * Usado pelos filtros de Modalidade da Gestão de Demandas, do modal de
 * Exportação e do Dashboard Gerencial. Nenhuma das três telas monta sua
 * própria lista.
 *
 * A lista de opções NÃO é chumbada: `buildModalityOptions` deriva os valores
 * realmente presentes nos dados carregados (que já vêm completos — veja
 * `fetchAllPaginated` em services/pagination.ts). O mapa canônico abaixo só
 * define rótulo e ordem de exibição; qualquer valor novo que apareça no banco
 * entra na lista automaticamente, no fim.
 *
 * Regra de negócio: a modalidade do TREINAMENTO prevalece sobre a da demanda
 * (mesma regra de domain/instructorHours.ts e do Dashboard).
 */

/** Sentinela para demandas sem modalidade preenchida (base legada). */
export const MODALITY_UNSET = '__SEM_MODALIDADE__';

/** Rótulo exibido para cada chave canônica. */
export const MODALITY_LABELS: Record<string, string> = {
  PRESENCIAL: 'Presencial',
  HIBRIDO: 'Híbrido',
  ONLINE: 'Online (EAD)',
  ONLINE_AO_VIVO: 'Online (Ao Vivo)',
  TUTORIA: 'Tutoria',
};

/** Ordem de exibição das chaves conhecidas. */
export const MODALITY_ORDER = [
  'PRESENCIAL',
  'HIBRIDO',
  'ONLINE',
  'ONLINE_AO_VIVO',
  'TUTORIA',
] as const;

/**
 * Variações legadas → chave canônica.
 * A base tem registros com acento e no feminino ("HÍBRIDO"/"HÍBRIDA") e com
 * "EAD" no lugar de "ONLINE" — sem isso o mesmo treinamento apareceria
 * repetido no select e as contagens ficariam divididas.
 */
const MODALITY_ALIASES: Record<string, string> = {
  HIBRIDA: 'HIBRIDO',
  EAD: 'ONLINE',
  ONLINEEAD: 'ONLINE',
  ONLINEAOVIVO: 'ONLINE_AO_VIVO',
  AOVIVO: 'ONLINE_AO_VIVO',
};

/**
 * Superset do normalizador já usado no app (trim + upper + sem hífen/espaço),
 * acrescido de remoção de acentos. Underscore é preservado — ONLINE_AO_VIVO
 * é chave canônica.
 */
const strip = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replaceAll('-', '')
    .replaceAll(' ', '');

/** Valor bruto → chave canônica (ou MODALITY_UNSET se vazio/nulo). */
export function canonicalModality(raw: unknown): string {
  const v = strip(raw);
  if (!v) return MODALITY_UNSET;
  return MODALITY_ALIASES[v] ?? v;
}

/** Rótulo de uma chave canônica; valores desconhecidos viram "Online Ao Vivo"-style. */
export function getModalityLabel(key: string): string {
  if (key === MODALITY_UNSET) return 'Não informada';
  if (MODALITY_LABELS[key]) return MODALITY_LABELS[key];
  return key
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

type DemandLike = { trainingId?: string | null; modality?: unknown };
type TrainingLike = { id: string; modality?: unknown };

/** Índice de treinamentos por id — monte uma vez por render (useMemo) e reaproveite. */
export function buildTrainingsById<T extends TrainingLike>(trainings: T[]): Map<string, T> {
  return new Map(trainings.map(t => [String(t.id), t]));
}

/**
 * Modalidade efetiva de uma demanda.
 * O treinamento prevalece; cai para a modalidade da própria demanda quando o
 * treinamento não foi encontrado ou está sem modalidade.
 */
export function resolveDemandModality(
  demand: DemandLike,
  trainingsById: Map<string, TrainingLike>
): string {
  const fromTraining = canonicalModality(trainingsById.get(String(demand.trainingId))?.modality);
  if (fromTraining !== MODALITY_UNSET) return fromTraining;
  return canonicalModality(demand.modality);
}

export interface ModalityOption {
  value: string;
  label: string;
}

/**
 * Opções do select, derivadas dos valores realmente presentes nas demandas.
 * "Não informada" só aparece se existir ao menos uma demanda sem modalidade.
 */
export function buildModalityOptions(
  demands: DemandLike[],
  trainings: TrainingLike[]
): ModalityOption[] {
  const trainingsById = buildTrainingsById(trainings);

  const present = new Set<string>();
  demands.forEach(d => present.add(resolveDemandModality(d, trainingsById)));

  const known = (MODALITY_ORDER as readonly string[])
    .filter(k => present.has(k))
    .map(k => ({ value: k, label: getModalityLabel(k) }));

  const extras = [...present]
    .filter(v => v !== MODALITY_UNSET && !(MODALITY_ORDER as readonly string[]).includes(v))
    .sort()
    .map(v => ({ value: v, label: getModalityLabel(v) }));

  const options = [...known, ...extras];
  if (present.has(MODALITY_UNSET)) {
    options.push({ value: MODALITY_UNSET, label: getModalityLabel(MODALITY_UNSET) });
  }
  return options;
}

/**
 * Predicado de filtro. `selected` vazio = "Todas as Modalidades" (não exclui
 * nada, inclusive demandas sem modalidade — as contagens só mudam com o
 * filtro ativo).
 */
export function matchesModality(
  demand: DemandLike,
  trainingsById: Map<string, TrainingLike>,
  selected: string
): boolean {
  if (!selected) return true;
  return resolveDemandModality(demand, trainingsById) === selected;
}
