/**
 * RECORTE DAS ALOCAÇÕES QUANDO O PERÍODO DA DEMANDA MUDA
 *
 * O bug que este módulo existe para matar: editar as datas de uma demanda
 * REESCREVIA todas as alocações dela para o período novo cheio. Três estragos
 * diferentes saíam da mesma linha de código:
 *
 *   1. ACOMPANHANTE. `companion_allocations` é UMA LINHA POR DIA, e a reescrita
 *      era um UPDATE em lote (`.in(ids)`) com o mesmo par de datas para todas.
 *      A DEM-1552 tinha 3 dias com acompanhante nos 3; virou 2 dias e as 3
 *      linhas ficaram apontando para o mesmo dia — três cards idênticos na
 *      segunda-feira. O dado do dia que saiu não foi removido: foi COPIADO por
 *      cima de um dia que ficou.
 *
 *   2. INSTRUTOR. Uma demanda de 16h dividida entre dois instrutores (8h + 8h
 *      pelo rateio de dias) tinha as DUAS alocações expandidas para o período
 *      inteiro. O rateio passa a ver dois instrutores cobrindo todos os dias e
 *      paga 16h a CADA um: 32h numa demanda de 16h. É a mesma classe de estrago
 *      que a medição multi-pessoa evita em domain/measurementOverrides.
 *
 *   3. PARTICIPANTE. O período próprio (`start_date`/`end_date` em
 *      `demand_participants`) ficava apontando para fora da demanda.
 *
 * A regra base é RECORTE, NUNCA CÓPIA: o que continua dentro do período novo
 * fica, o que saiu é removido. Sobre ela vale um princípio mais forte:
 *
 *   MUDAR DATA NÃO DESVINCULA NINGUÉM.
 *
 * Quem estava na demanda continua na demanda; o que muda são os DIAS. Por isso
 * três vínculos "acompanham" o período novo em vez de serem recortados até
 * sumir:
 *
 *   • a alocação de instrutor ÚNICA que cobria o período antigo inteiro — aí
 *     "a demanda mudou de dia" e "o instrutor foi junto" são a mesma coisa;
 *   • o ACOMPANHANTE que cobria o período inteiro — mesma leitura, e ele é uma
 *     linha por dia, então acompanhar significa criar/apagar linhas;
 *   • o PARTICIPANTE cujo período próprio ficou fora — volta a NULL, que já
 *     significa "a demanda inteira".
 *
 * A exceção à exceção é o SPLIT de instrutores. Ali expandir é o que dobra o
 * pagamento (duas alocações cobrindo todos os dias fazem o rateio pagar a carga
 * cheia a cada um), então split só recorta e os dias novos ficam descobertos
 * COM AVISO — a equipe aloca pela agenda em vez de descobrir o buraco no
 * fechamento. Acompanhante não tem esse risco: ele não entra no rateio.
 *
 * Função pura: nenhuma escrita, nenhum import de serviço. Ela devolve o PLANO,
 * e quem chama aplica e monta o aviso.
 */
import { getDemandDays } from './demandDays';

const dia = (v?: string | null): string => (v ?? '').slice(0, 10);

/** Linha de `companion_allocations` — uma por dia. */
export interface CompanionRowLike {
  id: string;
  instructorId: string;
  startDate: string;
  endDate: string;
}

/** Linha de `demand_participants` — período próprio, ou NULL nos dois. */
export interface ParticipantRowLike {
  id: string;
  instructorId: string;
  startDate?: string | null;
  endDate?: string | null;
}

/** Linha de `instructor_allocations`. */
export interface AllocationRowLike {
  id: string;
  instructorId: string;
  startDate: string;
  endDate: string;
}

export interface ReschedulePlanInput {
  /** Dias reais da demanda ANTES da edição ('YYYY-MM-DD'). */
  diasAntigos: string[];
  /** Dias reais da demanda DEPOIS da edição. */
  diasNovos: string[];
  /**
   * Horário ATUAL da demanda ('HH:mm'), já com o fallback de quem chama
   * (08:00 / 18:00 quando a demanda não tem horário). É ele que as linhas de
   * acompanhante passam a usar — ver a nota de HORÁRIO na passada delas.
   */
  horaInicio: string;
  horaFim: string;
  allocations: AllocationRowLike[];
  companions: CompanionRowLike[];
  participants: ParticipantRowLike[];
}

export interface ReschedulePlan {
  allocations: {
    /** A alocação única que cobria tudo: acompanha o período novo. */
    paraPeriodoCheio: { id: string; instructorId: string; startDate: string; endDate: string }[];
    /** Split: cada uma clampada ao que sobrou dela dentro do período novo. */
    paraRecortar: { id: string; instructorId: string; startDate: string; endDate: string }[];
    /** Ficaram sem nenhum dia dentro do período novo. */
    paraRemover: { id: string; instructorId: string }[];
    /** Dias novos que ninguém cobre — viram aviso, nunca alocação inventada. */
    diasSemInstrutor: string[];
  };
  companions: {
    /** Ficam. Normalizadas para UM dia — linha que a reescrita antiga deixou
     *  cobrindo dois dias volta a ser de um só. */
    paraAtualizar: { id: string; instructorId: string; startDate: string; endDate: string }[];
    /** Dia saiu do período (ou é duplicata do mesmo dia da mesma pessoa). */
    paraRemover: { id: string; instructorId: string; dia: string }[];
    /** Dias novos de quem acompanhava a demanda inteira (ou foi recriado). */
    paraCriar: { instructorId: string; startDate: string; endDate: string }[];
    /** Recriado porque o recorte esvaziou: alguém tem de conferir os dias. */
    paraRevisar: { instructorId: string }[];
  };
  participants: {
    /** Período próprio recortado ao novo. */
    paraRecortar: { id: string; instructorId: string; startDate: string; endDate: string }[];
    /** Período ficou vazio: volta a NULL (= demanda inteira). */
    paraLimparPeriodo: { id: string; instructorId: string }[];
  };
}

const diasDeIntervalo = (startDate: string, endDate: string): string[] =>
  getDemandDays({ dateMode: 'CONTINUO', startDate, endDate } as any);

export function planAllocationReschedule(input: ReschedulePlanInput): ReschedulePlan {
  const { diasAntigos, diasNovos, horaInicio, horaFim, allocations, companions, participants } = input;

  const novos = new Set(diasNovos);
  const primeiroNovo = [...diasNovos].sort()[0];
  const ultimoNovo = [...diasNovos].sort().slice(-1)[0];

  const plan: ReschedulePlan = {
    allocations: { paraPeriodoCheio: [], paraRecortar: [], paraRemover: [], diasSemInstrutor: [] },
    companions: { paraAtualizar: [], paraRemover: [], paraCriar: [], paraRevisar: [] },
    participants: { paraRecortar: [], paraLimparPeriodo: [] },
  };

  /* ───────────────────────── ACOMPANHANTE ─────────────────────────
   *
   * Uma linha por dia, então "acompanhar o período" aqui é criar e apagar
   * linhas — não existe uma linha só para esticar. A decisão é POR PESSOA:
   *
   *   • cobria a demanda inteira  → passa a cobrir o período novo inteiro
   *                                 (cresce e encolhe junto com a demanda);
   *   • cobria só alguns dias     → recorte; dia novo NÃO é inventado;
   *   • o recorte esvaziou        → NÃO remove. Recria cobrindo o período novo
   *                                 e pede revisão dos dias.
   *
   * O último caso é o que impede o pior resultado possível: mudar a data de uma
   * demanda NUNCA pode desvincular alguém. Ele cobre tanto a demanda que foi
   * deslocada inteira quanto a linha corrompida pela reescrita antiga.
   *
   * HORÁRIO: toda linha que fica ou nasce assume o horário ATUAL DA DEMANDA —
   * o mesmo que o branch de "mudou só o horário" já aplicava. A demanda é a
   * fonte do horário do acompanhamento; se ela passou a ser 13h–19h, ninguém
   * acompanha das 8h às 18h.
   *
   * As duas telas que criam acompanhante gravam convenções diferentes na
   * CRIAÇÃO (o Drawer usa T08:00/T18:00 literais; a Logística usa o horário da
   * demanda), e isso continua intocado — nenhuma delas muda. O que esta função
   * decide é outra coisa: o que acontece com a linha quando a DEMANDA é
   * reagendada. O fallback 08–18 é de quem chama, para demanda sem horário.
   */
  const porPessoa = new Map<string, CompanionRowLike[]>();
  for (const c of companions) {
    const lista = porPessoa.get(c.instructorId) ?? [];
    lista.push(c);
    porPessoa.set(c.instructorId, lista);
  }

  const diasNovosOrdenados = [...diasNovos].sort();

  for (const [instructorId, linhasDaPessoa] of porPessoa) {
    const linhas = [...linhasDaPessoa].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const diasDela = [...new Set(linhas.map(l => dia(l.startDate)))].sort();

    const cobriaTudo =
      diasAntigos.length > 0 && diasAntigos.every(d => diasDela.includes(d));

    let alvo = cobriaTudo ? diasNovosOrdenados : diasDela.filter(d => novos.has(d));
    let recriado = false;
    if (alvo.length === 0) {
      alvo = diasNovosOrdenados;
      recriado = true;
    }
    const alvoSet = new Set(alvo);

    const hIni = horaInicio;
    const hFim = horaFim;

    const usados = new Set<string>();
    for (const l of linhas) {
      const d = dia(l.startDate);
      // Fora do alvo, ou segunda linha do mesmo dia (a dedupe é rede de
      // segurança para o dado que a reescrita antiga já corrompeu).
      if (!alvoSet.has(d) || usados.has(d)) {
        plan.companions.paraRemover.push({ id: l.id, instructorId, dia: d });
        continue;
      }
      usados.add(d);

      const novoStart = `${d}T${hIni}`;
      const novoFim = `${d}T${hFim}`;
      // Normaliza para UM dia: a reescrita antiga deixou linhas cobrindo o
      // período inteiro, e uma linha de dois dias vira card em dois dias.
      if (l.startDate !== novoStart || l.endDate !== novoFim) {
        plan.companions.paraAtualizar.push({ id: l.id, instructorId, startDate: novoStart, endDate: novoFim });
      }
    }

    for (const d of alvo) {
      if (usados.has(d)) continue;
      plan.companions.paraCriar.push({
        instructorId,
        startDate: `${d}T${hIni}`,
        endDate: `${d}T${hFim}`,
      });
    }

    if (recriado) plan.companions.paraRevisar.push({ instructorId });
  }

  /* ───────────────────────── PARTICIPANTE ─────────────────────────
   * NULL nos dois = "a demanda inteira", e isso continua verdade sozinho
   * (a agenda e o conflito resolvem por `assignmentDays`). Só o período
   * PRÓPRIO precisa de clamp. */
  for (const p of participants) {
    const pStart = dia(p.startDate);
    const pEnd = dia(p.endDate);
    if (!pStart || !pEnd) continue; // NULL: acompanha o período novo sozinho

    const novoStart = pStart > primeiroNovo ? pStart : primeiroNovo;
    const novoEnd = pEnd < ultimoNovo ? pEnd : ultimoNovo;

    if (novoStart > novoEnd) {
      // O período dele ficou inteiramente fora do novo. Um período vazio é
      // inválido (o CHECK do banco exige start <= end), e remover a pessoa
      // seria decidir por ela: volta a NULL — "participa da demanda inteira" —
      // e o aviso conta o que aconteceu para alguém revisar.
      plan.participants.paraLimparPeriodo.push({ id: p.id, instructorId: p.instructorId });
      continue;
    }

    if (novoStart !== pStart || novoEnd !== pEnd) {
      plan.participants.paraRecortar.push({
        id: p.id,
        instructorId: p.instructorId,
        startDate: novoStart,
        endDate: novoEnd,
      });
    }
  }

  /* ───────────────────────── INSTRUTOR ─────────────────────────
   * O caso comum (uma alocação cobrindo a demanda inteira) acompanha o período.
   * Qualquer outra coisa é split — e split só recorta. */
  const antigos = new Set(diasAntigos);
  const cobreTudo = (a: AllocationRowLike) => {
    const dias = new Set(diasDeIntervalo(a.startDate, a.endDate));
    for (const d of antigos) if (!dias.has(d)) return false;
    return true;
  };

  const unicaCobrindoTudo =
    allocations.length === 1 && diasAntigos.length > 0 && cobreTudo(allocations[0]);

  if (unicaCobrindoTudo) {
    const a = allocations[0];
    plan.allocations.paraPeriodoCheio.push({
      id: a.id,
      instructorId: a.instructorId,
      startDate: `${primeiroNovo}T${horaInicio}`,
      endDate: `${ultimoNovo}T${horaFim}`,
    });
    return plan;
  }

  const cobertos = new Set<string>();
  for (const a of allocations) {
    const dias = diasDeIntervalo(a.startDate, a.endDate).filter(d => novos.has(d));

    if (dias.length === 0) {
      plan.allocations.paraRemover.push({ id: a.id, instructorId: a.instructorId });
      continue;
    }

    for (const d of dias) cobertos.add(d);

    const novoStart = `${dias[0]}T${horaInicio}`;
    const novoFim = `${dias[dias.length - 1]}T${horaFim}`;
    if (a.startDate !== novoStart || a.endDate !== novoFim) {
      plan.allocations.paraRecortar.push({
        id: a.id,
        instructorId: a.instructorId,
        startDate: novoStart,
        endDate: novoFim,
      });
    }
  }

  // Só faz sentido falar em "dia sem instrutor" quando a demanda TEM instrutor
  // alocado: demanda sem alocação nenhuma não é um buraco novo, é o estado dela.
  if (allocations.length > 0) {
    plan.allocations.diasSemInstrutor = diasNovos.filter(d => !cobertos.has(d)).sort();
  }

  return plan;
}

/**
 * O aviso de tela, em uma frase por tipo de mudança. Vazio quando o plano não
 * mexeu em nada — e aí a UI não avisa coisa nenhuma.
 *
 * Fica aqui, e não na tela, porque as duas telas que editam datas (cliente e
 * interna) precisam do MESMO texto: um aviso diferente em cada uma faria o
 * mesmo recorte parecer dois comportamentos.
 */
export function describeReschedule(
  plan: ReschedulePlan,
  nomeDe: (instructorId: string) => string
): string[] {
  const avisos: string[] = [];
  const nomes = (ids: string[]) => [...new Set(ids.map(nomeDe))].join(', ');

  // Os avisos de acompanhante são por EFEITO, não por pessoa: quem acompanhava
  // a demanda inteira some daqui (ele apenas seguiu o período, que é o
  // esperado), e quem precisa de conferência aparece com o motivo.
  const soRemovidos = plan.companions.paraRemover.filter(
    c => !plan.companions.paraRevisar.some(r => r.instructorId === c.instructorId) &&
         !plan.companions.paraCriar.some(n => n.instructorId === c.instructorId)
  );
  if (soRemovidos.length > 0) {
    const dias = soRemovidos.map(c => c.dia).filter(Boolean);
    avisos.push(
      `Acompanhante: ${soRemovidos.length} dia(s) fora do novo período foram removidos ` +
      `(${nomes(soRemovidos.map(c => c.instructorId))}${dias.length ? ` — ${[...new Set(dias)].join(', ')}` : ''}).`
    );
  }

  if (plan.companions.paraRevisar.length > 0) {
    avisos.push(
      `Acompanhante: nenhum dia de ${nomes(plan.companions.paraRevisar.map(c => c.instructorId))} ` +
      `sobreviveu ao novo período — ele foi mantido na demanda cobrindo todos os dias. Revise os dias.`
    );
  }

  if (plan.allocations.paraRemover.length > 0) {
    avisos.push(
      `Instrutor: alocação removida por ficar inteiramente fora do novo período ` +
      `(${nomes(plan.allocations.paraRemover.map(a => a.instructorId))}).`
    );
  }

  if (plan.allocations.paraRecortar.length > 0) {
    avisos.push(
      `Instrutor: alocação recortada ao novo período ` +
      `(${nomes(plan.allocations.paraRecortar.map(a => a.instructorId))}).`
    );
  }

  if (plan.allocations.diasSemInstrutor.length > 0) {
    avisos.push(
      `O período mudou; ${plan.allocations.diasSemInstrutor.length} dia(s) sem instrutor ` +
      `(${plan.allocations.diasSemInstrutor.join(', ')}) — aloque pela agenda.`
    );
  }

  if (plan.participants.paraRecortar.length > 0) {
    avisos.push(
      `Participante: período próprio recortado ao novo ` +
      `(${nomes(plan.participants.paraRecortar.map(p => p.instructorId))}).`
    );
  }

  if (plan.participants.paraLimparPeriodo.length > 0) {
    avisos.push(
      `Participante: o período próprio ficou fora da demanda e voltou a valer para todos os dias ` +
      `(${nomes(plan.participants.paraLimparPeriodo.map(p => p.instructorId))}) — revise.`
    );
  }

  return avisos;
}
