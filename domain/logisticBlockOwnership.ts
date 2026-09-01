/**
 * DONO DO BLOCO DE LOGÍSTICA — regra pura, fonte única
 *
 * A regra, igual para demanda INTERNA e de CLIENTE:
 *
 *   • Enquanto a demanda tem UMA pessoa (só o titular), o bloco de locomoção /
 *     hospedagem fica anônimo, como sempre foi. Ninguém precisa digitar nome
 *     para dizer "de quem é" quando só existe uma resposta possível.
 *
 *   • No instante em que entra uma SEGUNDA pessoa — participante (interna) ou
 *     acompanhante (cliente) — todo bloco passa a ser identificado: o da pessoa
 *     nova nasce com nome + `instructor_id`, e o bloco anônimo que estava lá
 *     passa a ser explicitamente do TITULAR.
 *
 * Sem isso, uma demanda com duas pessoas fica com um bloco identificado e um
 * anônimo — e "anônimo" deixa de significar "só tem um" para significar
 * "adivinhe". É a ambiguidade que a F1 introduziria se a regra parasse na
 * metade.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo NÃO faz
 * ---------------------------------------------------------------------------
 * Não apaga nem grava coisa alguma: só responde perguntas sobre a lista de
 * blocos que já existe, para o chamador decidir o que fazer. São três —
 *
 *   1. esta pessoa já tem bloco nesta demanda? (para não criar duas vezes —
 *      importa porque acompanhante é gravado UMA LINHA POR DIA, então o mesmo
 *      fluxo dispara N vezes para a mesma pessoa);
 *   2. qual bloco anônimo deve virar do titular?
 *   3. este bloco está vazio o bastante para poder ser apagado?
 *
 * ---------------------------------------------------------------------------
 * Duas travas deliberadas
 * ---------------------------------------------------------------------------
 * • SÓ O PRIMEIRO anônimo de cada tipo é preenchido. Se o usuário criou três
 *   blocos de locomoção à mão antes de haver segunda pessoa, atribuir todos ao
 *   titular seria inventar vínculo — os outros ficam anônimos e visíveis.
 *
 * • Bloco que JÁ TEM `instructorId` nunca é tocado, tenha dado ou não. Renomear
 *   o bloco de outra pessoa é pior do que deixar um anônimo.
 */

/** Só o que a regra lê de um bloco (vale para locomoção e hospedagem). */
export interface OwnableLogisticBlock {
  id: string;
  instructorId?: string | null;
  instructorName?: string | null;
}

/** Um preenchimento a aplicar: bloco `blockId` passa a ser de `instructorId`. */
export interface BlockOwnerFill {
  blockId: string;
  instructorId: string;
  instructorName: string;
}

/**
 * A pessoa já tem bloco nesta lista?
 *
 * É a guarda de idempotência dos fluxos de acompanhante: `AllocationDrawer` e
 * `Logistics` gravam uma linha de `companion_allocations` POR DIA, então um
 * acompanhante de 3 dias passa 3 vezes pelo mesmo caminho. Sem esta pergunta,
 * sairiam 6 blocos em vez de 2.
 */
export function hasBlocksFor(
  blocks: OwnableLogisticBlock[] | null | undefined,
  instructorId: string
): boolean {
  if (!instructorId) return false;
  return (blocks ?? []).some(b => b?.instructorId === instructorId);
}

/**
 * Qual bloco anônimo desta lista deve passar a ser do titular.
 *
 * Devolve `null` — ou seja, não mexe em nada — quando:
 *   • não há titular definido ("Não Alocado"). O preenchimento fica para o
 *     momento da alocação; ver `planTitularFills` nos chamadores;
 *   • o titular JÁ tem bloco aqui (nada a fazer, e não se cria um segundo);
 *   • não sobrou nenhum bloco anônimo.
 */
export function planTitularFill(
  blocks: OwnableLogisticBlock[] | null | undefined,
  titularId: string | null | undefined,
  titularName: string
): BlockOwnerFill | null {
  if (!titularId) return null;

  const lista = blocks ?? [];
  if (hasBlocksFor(lista, titularId)) return null;

  const anonimo = lista.find(b => b && !b.instructorId);
  if (!anonimo) return null;

  return { blockId: anonimo.id, instructorId: titularId, instructorName: titularName };
}

/**
 * O plano completo para os dois tipos de bloco de uma demanda.
 *
 * Locomoção e hospedagem são listas independentes: o titular pode ter bloco de
 * locomoção anônimo e nenhum de hospedagem, e cada uma resolve sozinha.
 */
export function planTitularFills(
  locomocao: OwnableLogisticBlock[] | null | undefined,
  hospedagem: OwnableLogisticBlock[] | null | undefined,
  titularId: string | null | undefined,
  titularName: string
): BlockOwnerFill[] {
  return [
    planTitularFill(locomocao, titularId, titularName),
    planTitularFill(hospedagem, titularId, titularName),
  ].filter((f): f is BlockOwnerFill => f !== null);
}

/**
 * A demanda tem uma segunda pessoa? É o gatilho da regra inteira.
 *
 * Recebe as duas listas já filtradas pela demanda. `titularId` é excluído da
 * contagem: participante nunca é o titular (o form não deixa escolhê-lo), mas
 * acompanhante pode coincidir em dado legado, e nesse caso não há segunda
 * pessoa de verdade.
 */
export function hasSecondPerson(
  participantInstructorIds: (string | null | undefined)[],
  companionInstructorIds: (string | null | undefined)[],
  titularId?: string | null
): boolean {
  const outros = new Set<string>();
  for (const id of [...participantInstructorIds, ...companionInstructorIds]) {
    if (id && id !== titularId) outros.add(id);
  }
  return outros.size > 0;
}


/**
 * O bloco esta VAZIO, ou seja: pode sumir sem levar trabalho de ninguem junto.
 *
 * Usado na remocao de participante e de acompanhante — bloco com dado NUNCA e
 * apagado, mesmo que a pessoa dona saia da demanda. Ele fica orfao e visivel na
 * aba de Logistica, que e menos ruim do que apagar locadora, localizador,
 * hotel ou notinha sem perguntar.
 *
 * `rental_company` e `car_category` sao IGNORADOS de proposito: o formulario
 * cria bloco novo ja com "Localiza" e "Grupo CE" preenchidos por default, entao
 * conta-los como dado faria todo bloco parecer preenchido e nada seria limpo.
 * O mesmo criterio da checagem em estado de formulario (InternalDemands).
 */
export function isLogisticBlockEmpty(row: {
  block_type?: string | null;
  transport_mode?: string | null;
  rental_agency_location?: string | null;
  rental_locator?: string | null;
  rental_check_in?: string | null;
  rental_check_out?: string | null;
  receipt_url?: string[] | null;
  transport_other_description?: string | null;
  lodging_mode?: string | null;
  hotel_city?: string | null;
  hotel_name?: string | null;
  hotel_check_in?: string | null;
  hotel_check_out?: string | null;
  hotel_receipt_urls?: string[] | null;
}): boolean {
  const vazio = (v: unknown) =>
    v == null || v === '' || (Array.isArray(v) && v.length === 0);

  if (row?.block_type === 'HOSPEDAGEM') {
    return (
      vazio(row.lodging_mode) &&
      vazio(row.hotel_city) &&
      vazio(row.hotel_name) &&
      vazio(row.hotel_check_in) &&
      vazio(row.hotel_check_out) &&
      vazio(row.hotel_receipt_urls)
    );
  }

  return (
    vazio(row?.transport_mode) &&
    vazio(row?.rental_agency_location) &&
    vazio(row?.rental_locator) &&
    vazio(row?.rental_check_in) &&
    vazio(row?.rental_check_out) &&
    vazio(row?.receipt_url) &&
    vazio(row?.transport_other_description)
  );
}
