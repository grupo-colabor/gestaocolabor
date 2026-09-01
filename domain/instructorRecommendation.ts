/**
 * CLASSIFICAÇÃO DE INSTRUTOR PARA UMA DEMANDA — regras puras, fonte única
 *
 * Extraído de `recommendInstructors` (App.tsx) para que a seleção de
 * ACOMPANHANTE use exatamente os mesmos critérios da lista principal de
 * alocação, em vez de uma cópia que diverge no primeiro ajuste. O App passa a
 * importar os predicados daqui; nenhum comportamento da lista principal muda.
 *
 * ---------------------------------------------------------------------------
 * O que "exceção" significa nesta tela (não é o que o nome sugere)
 * ---------------------------------------------------------------------------
 * Exceção NÃO é habilitação parcial. Habilitação é binária: numa demanda de
 * CLIENTE, instrutor sem a skill do treinamento não aparece em lista nenhuma.
 * Exceção é o instrutor QUALIFICADO que mora em outro estado — a demanda tem
 * âncora geográfica e ele viria de fora. É por isso que ele aparece separado e
 * em âmbar: dá para alocar, mas custa deslocamento.
 *
 * Em demanda INTERNA não existe treinamento, então todo instrutor ATIVO é
 * elegível (senão a lista sairia vazia — `skills.some(s => s.trainingId === '')`
 * é sempre falso).
 *
 * ---------------------------------------------------------------------------
 * Por que o ACOMPANHANTE tem um agrupamento próprio
 * ---------------------------------------------------------------------------
 * A lista principal DESCARTA quem não tem a skill: alocar um titular sem
 * habilitação não é uma opção. Acompanhante não ministra — ele acompanha —,
 * então excluir os não-qualificados esconderia justamente quem mais costuma
 * acompanhar (o instrutor em formação). Por isso `groupInstructorsForCompanion`
 * devolve TRÊS grupos e o terceiro são os demais ativos, que a lista principal
 * nunca mostra.
 */

export interface RecommendableInstructor {
  id: string;
  name: string;
  status?: string;
  residenceLocation?: string | null;
  skills?: { trainingId: string; level: number }[];
}

export interface RecommendableDemand {
  id: string;
  tipo?: string | null;
  trainingId?: string | null;
  trainingLocal?: string | null;
  demandState?: string | null;
  modality?: string | null;
}

/** Interna não tem treinamento; a qualificação por skill não se aplica. */
export const isInternaDemand = (demand: RecommendableDemand): boolean =>
  demand?.tipo === 'interna';

/**
 * O instrutor pode ser TITULAR desta demanda?
 *
 * Cliente: precisa ter a skill do treinamento. Interna: basta estar ATIVO.
 */
export function isEligibleForDemand(
  instructor: RecommendableInstructor,
  demand: RecommendableDemand
): boolean {
  if (instructor?.status !== 'ATIVO') return false;
  if (isInternaDemand(demand)) return true;
  return !!instructor.skills?.some(s => s.trainingId === demand.trainingId);
}

/** Nível da skill do treinamento — o número que ordena a lista. Interna: 0. */
export function scoreForDemand(
  instructor: RecommendableInstructor,
  demand: RecommendableDemand
): number {
  if (isInternaDemand(demand)) return 0;
  return instructor.skills?.find(s => s.trainingId === demand.trainingId)?.level ?? 0;
}

/**
 * A demanda tem âncora geográfica?
 *
 * Sem ela, a UF de residência não separa ninguém — e o grupo de exceção fica
 * vazio por construção. `requiresLogistics` é passado de fora para este módulo
 * não importar `modalityRules` e continuar exercitável isolado.
 */
export function hasGeoAnchor(
  demand: RecommendableDemand,
  requiresLogistics: (modality?: string | null) => boolean
): boolean {
  if (!(demand.demandState || '').trim()) return false;
  if (demand.trainingLocal === 'N/A') return false;
  return requiresLogistics(demand.modality);
}

/** Mora no mesmo estado da demanda? Comparação por UF normalizada. */
export function isSameDemandState(
  instructor: RecommendableInstructor,
  demand: RecommendableDemand
): boolean {
  const uf = (demand.demandState || '').trim().toUpperCase();
  if (!uf) return false;
  return (instructor.residenceLocation || '').trim().toUpperCase() === uf;
}

/** Um instrutor já classificado, pronto para renderizar. */
export interface ClassifiedInstructor<I> {
  instructor: I;
  score: number;
  hasConflict: boolean;
}

export interface CompanionGroups<I> {
  /** Habilitados para este treinamento e no estado da demanda. */
  qualificados: ClassifiedInstructor<I>[];
  /** Habilitados, mas de outro estado — o "exceção" da tela. */
  excecoes: ClassifiedInstructor<I>[];
  /** Ativos sem a habilitação. A lista principal não mostra; acompanhante sim. */
  demais: ClassifiedInstructor<I>[];
}

export interface CompanionGroupsInput<I extends RecommendableInstructor> {
  instructors: I[];
  demand: RecommendableDemand;
  /** `hasScheduleConflict` do App — já inclui participante e acompanhante. */
  hasConflict: (instructorId: string) => boolean;
  requiresLogistics: (modality?: string | null) => boolean;
  /** Quem já é acompanhante desta demanda: sai da lista. */
  excludeInstructorIds?: (string | null | undefined)[];
  /** Filtro de busca por nome. */
  search?: string;
}

/**
 * Os três grupos, na ordem em que a tela os mostra.
 *
 * Dentro de cada grupo: SEM CONFLITO primeiro (é quem se pode alocar sem
 * pensar duas vezes), depois score decrescente, e nome como desempate — assim
 * a lista é estável entre renders, sem depender da ordem do cadastro.
 *
 * Conflito NUNCA remove ninguém da lista: o padrão da tela é avisar, não
 * bloquear. Quem monta a equipe às vezes sabe de um remanejamento que o
 * sistema ainda não viu.
 */
export function groupInstructorsForCompanion<I extends RecommendableInstructor>({
  instructors,
  demand,
  hasConflict,
  requiresLogistics,
  excludeInstructorIds = [],
  search = '',
}: CompanionGroupsInput<I>): CompanionGroups<I> {
  const excluidos = new Set(excludeInstructorIds.filter(Boolean) as string[]);
  const termo = search.trim().toLowerCase();
  const comAncora = hasGeoAnchor(demand, requiresLogistics);

  const ordenar = (a: ClassifiedInstructor<I>, b: ClassifiedInstructor<I>) =>
    Number(a.hasConflict) - Number(b.hasConflict) ||
    b.score - a.score ||
    (a.instructor.name || '').localeCompare(b.instructor.name || '', 'pt-BR');

  const grupos: CompanionGroups<I> = { qualificados: [], excecoes: [], demais: [] };

  for (const instructor of instructors ?? []) {
    if (instructor?.status !== 'ATIVO') continue;
    if (excluidos.has(instructor.id)) continue;
    if (termo && !(instructor.name || '').toLowerCase().includes(termo)) continue;

    const classificado: ClassifiedInstructor<I> = {
      instructor,
      score: scoreForDemand(instructor, demand),
      hasConflict: hasConflict(instructor.id),
    };

    if (!isEligibleForDemand(instructor, demand)) {
      grupos.demais.push(classificado);
    } else if (comAncora && !isSameDemandState(instructor, demand)) {
      grupos.excecoes.push(classificado);
    } else {
      grupos.qualificados.push(classificado);
    }
  }

  grupos.qualificados.sort(ordenar);
  grupos.excecoes.sort(ordenar);
  grupos.demais.sort(ordenar);
  return grupos;
}
