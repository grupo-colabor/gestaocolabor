/**
 * TOTAIS DE MEDIÇÃO — fonte única
 *
 * Extraído do `getMeasurementTotals` que vivia solto dentro de
 * `Measurement.tsx`. O card "Custo das Demandas Internas" (Dashboard, aba
 * INTERNAS) e o card "Despesas Não Reembolsáveis" (aba CUSTOS) precisam da
 * mesma conta — reimplementá-la em três lugares era pedir divergência, do
 * mesmo jeito que aconteceu com a prontidão logística.
 *
 * ---------------------------------------------------------------------------
 * Como uma despesa é armazenada (o achado do diagnóstico)
 * ---------------------------------------------------------------------------
 * NÃO existe tabela de despesas nem "valor avulso" separado da notinha. TODO
 * item de despesa é um elemento de `measurements.attachments` (jsonb), com
 * `category`, `value` e — nas despesas de OUTROS — um `otherId` ligando à linha
 * correspondente em `other_expenses`.
 *
 * `measurements.expenses` guarda apenas campos legados (breakfast, lunch, ...)
 * mais `classHours`/`hourRate`, que formam a parcela de Hora/Aula. As linhas de
 * `other_expenses` são rótulos: o `value` delas é referência e NÃO entra na
 * soma — quem soma são os attachments com aquele `otherId`. Preservado como
 * estava.
 *
 * ---------------------------------------------------------------------------
 * `reembolsavel`
 * ---------------------------------------------------------------------------
 * A medição existe porque o cliente reembolsa as despesas; algumas ele não
 * reembolsa (Uber do instrutor até a locadora, almoço acima do teto) e a
 * Colabor absorve. A flag mora no próprio item, em jsonb — sem migration.
 *
 * Ausente = reembolsável. Todo item já gravado continua valendo como
 * reembolsável sem backfill: a leitura é `!== false`, nunca `=== true`.
 *
 * O item marcado CONTINUA no total e na sua categoria — ele foi gasto de
 * verdade. "Não reembolsável" é um recorte à parte, não uma subtração.
 */

export type ExpenseCategoryKey = 'HOSPEDAGEM' | 'LOCOMOCAO' | 'CAFE' | 'ALMOCO' | 'JANTAR' | 'OUTROS';

/** Só o que a conta lê de um item de despesa. */
export interface TotalizableAttachment {
  category?: string | null;
  value?: number | string | null;
  otherId?: string | null;
  /** Ausente = reembolsável. Ver cabeçalho. */
  reembolsavel?: boolean | null;
  /**
   * Dono do item (v2 — medição multi-pessoa). AUSENTE = item do TITULAR.
   *
   * É um ÍNDICE sobre o array plano, não um aninhamento: todos os leitores de
   * hoje percorrem `attachments` direto, e mover os itens para dentro de cada
   * bloco quebraria os sete de uma vez. Como campo opcional, `computeMeasurementTotals`
   * simplesmente o ignora e continua devolvendo o total da demanda.
   */
  instructorId?: string | null;
}

/** Papel da pessoa dentro da medição. Ver `MeasurementParticipant`. */
export type MeasurementRole = 'TITULAR' | 'PARTICIPANTE' | 'ACOMPANHANTE';

/**
 * Uma pessoa no bloco de pagamento da medição (v2).
 *
 * ⚠️ `horas` é OPCIONAL e a ausência dele NÃO é zero — é "não informado", e
 * resolve diferente conforme quem é a pessoa (ver `normalizeMeasurementBlocks`
 * e o cabeçalho de `applyMeasurementOverrides`). Gravar o default aqui faria
 * toda interna com bloco trocar rateio por horas-por-pessoa no dia do deploy.
 */
export interface MeasurementParticipant {
  instructorId: string;
  papel?: MeasurementRole | null;
  /** Ausente = não informado. NUNCA confundir com 0. */
  horas?: number | string | null;
  valorHH?: number | string | null;
}

/** Só o que a conta lê de uma medição. */
export interface TotalizableMeasurement {
  attachments?: TotalizableAttachment[] | null;
  otherExpenses?: { id: string }[] | null;
  expenses?: {
    classHours?: number | string | null;
    hourRate?: number | string | null;
    /** v2 — ausente/vazio = medição mono-pessoa (todo o histórico). */
    participantes?: MeasurementParticipant[] | null;
  } | null;
}

/**
 * Item marcado como NÃO reembolsável? Ausência do campo significa
 * reembolsável — é o que mantém os itens antigos corretos sem backfill.
 */
export const isNaoReembolsavel = (a: TotalizableAttachment): boolean => a?.reembolsavel === false;

/** Aceita `"1.234,56"`, `"12.5"` e number. Mesma tolerância do código original. */
export function parseExpenseValue(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export interface MeasurementTotals {
  hospedagem: number;
  locomocao: number;
  cafe: number;
  almoco: number;
  jantar: number;
  outros: number;
  /** Soma das despesas (sem Hora/Aula) — o que o `total` antigo devolvia. */
  total: number;
  /** classHours × hourRate. */
  horaAula: number;
  /** despesas + Hora/Aula: o custo cheio da medição. */
  totalComHoraAula: number;
  /** Recorte: quanto das despesas o cliente NÃO reembolsa. */
  naoReembolsavel: number;
  /** Quantos itens de despesa estão marcados. */
  itensNaoReembolsaveis: number;
  /** O não reembolsável quebrado por categoria. */
  naoReembolsavelPorCategoria: Record<ExpenseCategoryKey, number>;
}

const CATEGORIAS: ExpenseCategoryKey[] = ['HOSPEDAGEM', 'LOCOMOCAO', 'CAFE', 'ALMOCO', 'JANTAR', 'OUTROS'];

const zeroPorCategoria = (): Record<ExpenseCategoryKey, number> =>
  CATEGORIAS.reduce((acc, c) => { acc[c] = 0; return acc; }, {} as Record<ExpenseCategoryKey, number>);

/**
 * Os totais de uma medição. As somas por categoria são idênticas às do
 * `getMeasurementTotals` original, incluindo a regra de OUTROS: só entram os
 * attachments cujo `otherId` bate com uma linha existente em `otherExpenses`
 * (um anexo órfão, apontando para linha apagada, continua fora da conta).
 */
export function computeMeasurementTotals(m: TotalizableMeasurement | null | undefined): MeasurementTotals {
  const attachments = m?.attachments ?? [];
  const outrosIds = new Set((m?.otherExpenses ?? []).map(o => o.id));

  const sum = (cat: ExpenseCategoryKey, oid?: string) =>
    attachments
      .filter(a => a?.category === cat && (oid ? a.otherId === oid : !a?.otherId))
      .reduce((acc, a) => acc + parseExpenseValue(a?.value), 0);

  const hospedagem = sum('HOSPEDAGEM');
  const locomocao = sum('LOCOMOCAO');
  const cafe = sum('CAFE');
  const almoco = sum('ALMOCO');
  const jantar = sum('JANTAR');
  const outros = [...outrosIds].reduce((acc, id) => acc + sum('OUTROS', id), 0);

  const total = hospedagem + locomocao + cafe + almoco + jantar + outros;

  const horaAula =
    parseExpenseValue(m?.expenses?.classHours as any) * parseExpenseValue(m?.expenses?.hourRate as any);

  // Recorte do não reembolsável. Percorre os MESMOS itens que entraram acima:
  // um anexo de OUTROS órfão não conta aqui também, senão o recorte poderia
  // ficar maior que o total.
  const naoReembolsavelPorCategoria = zeroPorCategoria();
  let naoReembolsavel = 0;
  let itensNaoReembolsaveis = 0;

  for (const a of attachments) {
    if (!a || !isNaoReembolsavel(a)) continue;
    const cat = a.category as ExpenseCategoryKey;
    if (!CATEGORIAS.includes(cat)) continue;
    if (cat === 'OUTROS') { if (!a.otherId || !outrosIds.has(a.otherId)) continue; }
    else if (a.otherId) continue;

    const v = parseExpenseValue(a.value);
    naoReembolsavelPorCategoria[cat] += v;
    naoReembolsavel += v;
    itensNaoReembolsaveis += 1;
  }

  return {
    hospedagem, locomocao, cafe, almoco, jantar, outros,
    total,
    horaAula,
    totalComHoraAula: total + horaAula,
    naoReembolsavel,
    itensNaoReembolsaveis,
    naoReembolsavelPorCategoria,
  };
}

export interface MeasurementsAggregate {
  /** Nº de medições consideradas. */
  medicoes: number;
  despesas: number;
  horaAula: number;
  total: number;
  naoReembolsavel: number;
  itensNaoReembolsaveis: number;
  /** Medições que têm ao menos um item não reembolsável. */
  medicoesComNaoReembolsavel: number;
  naoReembolsavelPorCategoria: Record<ExpenseCategoryKey, number>;
}

/** Agrega várias medições. Usado pelos dois cards do Dashboard. */
export function aggregateMeasurements(ms: (TotalizableMeasurement | null | undefined)[]): MeasurementsAggregate {
  const acc: MeasurementsAggregate = {
    medicoes: 0, despesas: 0, horaAula: 0, total: 0,
    naoReembolsavel: 0, itensNaoReembolsaveis: 0, medicoesComNaoReembolsavel: 0,
    naoReembolsavelPorCategoria: zeroPorCategoria(),
  };

  for (const m of ms ?? []) {
    if (!m) continue;
    const t = computeMeasurementTotals(m);
    acc.medicoes += 1;
    acc.despesas += t.total;
    acc.horaAula += t.horaAula;
    acc.total += t.totalComHoraAula;
    acc.naoReembolsavel += t.naoReembolsavel;
    acc.itensNaoReembolsaveis += t.itensNaoReembolsaveis;
    if (t.itensNaoReembolsaveis > 0) acc.medicoesComNaoReembolsavel += 1;
    for (const c of CATEGORIAS) acc.naoReembolsavelPorCategoria[c] += t.naoReembolsavelPorCategoria[c];
  }

  return acc;
}


/* ───────────────────────── QUEBRA POR CATEGORIA DO PAINEL ─────────────────────────
 *
 * O JSON guarda SEIS categorias (ver `ExpenseCategoryKey`), mas o Painel de
 * Medição sempre mostrou QUATRO: as três de comida aparecem somadas como
 * "Alimentação" (Measurement.tsx — resumo por demanda, resumo WhatsApp e o
 * quadro de totais, todos com `cafe + almoco + jantar`). O card "Custo das
 * Demandas Internas" discrimina as despesas com o MESMO agrupamento, para o
 * gestor não ver quatro linhas no painel e outras seis no Dashboard.
 *
 * ---------------------------------------------------------------------------
 * Por que esta função re-percorre os attachments em vez de somar os campos de
 * `computeMeasurementTotals`
 * ---------------------------------------------------------------------------
 * Porque `h + l + (c+a+j) + o` daquela função NÃO cobre todo o JSON: um item
 * com `category` ausente ou fora das seis não casa com nenhum `sum()` e some
 * da conta sem deixar rastro. Aqui ele cai em OUTROS — a quebra é uma
 * PARTIÇÃO dos itens, e `total` é a soma das quatro por construção. É o que
 * permite o card afirmar que os quatro sublabels fecham com o valor principal.
 *
 * A ÚNICA exclusão preservada é o anexo de OUTROS órfão (aponta para linha de
 * `other_expenses` apagada). Ela não é uma perda: no painel, apagar a linha É
 * apagar a despesa, e o mesmo anexo já está fora de `computeMeasurementTotals`.
 * Trazê-lo para cá faria a interna divergir do próprio painel. Para não ser
 * silencioso, ele volta contado em `itensOrfaos`.
 */

/** Os quatro buckets que o Painel de Medição exibe. */
export type PanelExpenseBucket = 'hospedagem' | 'locomocao' | 'alimentacao' | 'outros';

/** 6 categorias do JSON → 4 buckets do painel. Sem strings soltas nos componentes. */
const BUCKET_POR_CATEGORIA: Record<ExpenseCategoryKey, PanelExpenseBucket> = {
  HOSPEDAGEM: 'hospedagem',
  LOCOMOCAO: 'locomocao',
  CAFE: 'alimentacao',
  ALMOCO: 'alimentacao',
  JANTAR: 'alimentacao',
  OUTROS: 'outros',
};

/** Rótulos como aparecem no painel — a ordem é a de exibição no card. */
export const PANEL_EXPENSE_LABELS: { key: PanelExpenseBucket; label: string }[] = [
  { key: 'hospedagem', label: 'Hospedagem' },
  { key: 'locomocao', label: 'Locomoção' },
  { key: 'alimentacao', label: 'Alimentação' },
  { key: 'outros', label: 'Outros' },
];

export interface PanelExpenseBreakdown extends Record<PanelExpenseBucket, number> {
  /** Soma dos quatro buckets. É o total de despesas da quebra. */
  total: number;
  /** Itens de despesa que entraram em algum bucket. */
  itens: number;
  /**
   * Anexos de OUTROS apontando para linha de `other_expenses` inexistente:
   * fora do total, como no painel — mas contados, nunca silenciosos.
   */
  itensOrfaos: number;
}

/** Agregado de várias medições: a quebra mais quantas medições contribuíram. */
export interface AggregatedPanelExpenseBreakdown extends PanelExpenseBreakdown {
  /** Medições com ao menos um item dentro do recorte (ver `itemFilter`). */
  medicoes: number;
}

export interface PanelExpenseBreakdownOptions {
  /**
   * Recorte por item. Ausente = todo item entra (o caso do card "Custo das
   * Demandas Internas", que quer o gasto cheio).
   *
   * O card "Despesas Não Reembolsáveis" passa `isNaoReembolsavel` e recebe a
   * MESMA quebra, restrita aos itens marcados. É o que evita uma segunda
   * função com o mapa 6→4 e o tratamento de órfão copiados — os dois cards
   * percorrem exatamente este laço.
   *
   * O filtro roda ANTES do teste de órfão, de propósito: assim `itensOrfaos`
   * conta os órfãos DO RECORTE, e não órfãos que nem pertenciam a ele.
   */
  itemFilter?: (a: TotalizableAttachment) => boolean;
}

const zeroBreakdown = (): PanelExpenseBreakdown => ({
  hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0,
  total: 0, itens: 0, itensOrfaos: 0,
});

/**
 * Quebra as despesas de UMA medição nos quatro buckets do painel.
 *
 * Todo item do JSON cai em exatamente um bucket; `category` ausente ou fora
 * das seis conhecidas vai para OUTROS. Único fora da partição: o órfão de
 * OUTROS descrito no cabeçalho, devolvido em `itensOrfaos`.
 *
 * Com `opts.itemFilter`, tudo isso vale igual — só que sobre o subconjunto de
 * itens que passam no predicado.
 */
export function computePanelExpenseBreakdown(
  m: TotalizableMeasurement | null | undefined,
  opts: PanelExpenseBreakdownOptions = {}
): PanelExpenseBreakdown {
  const acc = zeroBreakdown();
  const outrosIds = new Set((m?.otherExpenses ?? []).map(o => o.id));
  const { itemFilter } = opts;

  for (const a of m?.attachments ?? []) {
    if (!a) continue;
    if (itemFilter && !itemFilter(a)) continue;

    const cat = a.category as ExpenseCategoryKey;
    const conhecida = Object.prototype.hasOwnProperty.call(BUCKET_POR_CATEGORIA, cat);

    // Órfão de OUTROS: mesma exclusão de `computeMeasurementTotals`, para a
    // interna não divergir do painel. Contado, não sumido.
    if (conhecida && cat === 'OUTROS' && (!a.otherId || !outrosIds.has(a.otherId))) {
      acc.itensOrfaos += 1;
      continue;
    }

    // Categoria desconhecida/ausente cai em OUTROS em vez de evaporar.
    const bucket: PanelExpenseBucket = conhecida ? BUCKET_POR_CATEGORIA[cat] : 'outros';
    acc[bucket] += parseExpenseValue(a.value);
    acc.itens += 1;
  }

  acc.total = acc.hospedagem + acc.locomocao + acc.alimentacao + acc.outros;
  return acc;
}

/**
 * Soma a quebra de várias medições, já recortadas pelos filtros do Dashboard.
 * Lista vazia / null / medição sem attachments devolvem os quatro zerados.
 *
 * Dois consumidores, o mesmo percurso:
 *   • "Custo das Demandas Internas" (aba INTERNAS) — sem `itemFilter`.
 *   • "Despesas Não Reembolsáveis" (aba CUSTOS) — `itemFilter: isNaoReembolsavel`.
 */
export function aggregatePanelExpenseBreakdown(
  ms: (TotalizableMeasurement | null | undefined)[] | null | undefined,
  opts: PanelExpenseBreakdownOptions = {}
): AggregatedPanelExpenseBreakdown {
  const acc: AggregatedPanelExpenseBreakdown = { ...zeroBreakdown(), medicoes: 0 };

  for (const m of ms ?? []) {
    if (!m) continue;
    const b = computePanelExpenseBreakdown(m, opts);
    acc.hospedagem += b.hospedagem;
    acc.locomocao += b.locomocao;
    acc.alimentacao += b.alimentacao;
    acc.outros += b.outros;
    acc.itens += b.itens;
    acc.itensOrfaos += b.itensOrfaos;
    // Medição só conta se contribuiu com item DO RECORTE. Sem o filtro isso é
    // "tem despesa"; com `isNaoReembolsavel`, é "tem item marcado" — que é o
    // "em N medições" do card.
    if (b.itens > 0) acc.medicoes += 1;
  }

  acc.total = acc.hospedagem + acc.locomocao + acc.alimentacao + acc.outros;
  return acc;
}


/* ─────────────────────── BLOCOS POR PESSOA (medição v2) ─────────────────────
 *
 * Toda medição gravada até aqui é implicitamente MONO-PESSOA: uma linha por
 * demanda, um par classHours × hourRate. A v2 acrescenta
 * `expenses.participantes` (um bloco por pessoa) e `attachments[].instructorId`
 * (o dono do item) — os dois OPCIONAIS, sem migração de dado e sem backfill,
 * no mesmo espírito do `reembolsavel`.
 *
 * ---------------------------------------------------------------------------
 * Por que ÍNDICE e não ANINHAMENTO
 * ---------------------------------------------------------------------------
 * O instinto seria `participantes: [{ ..., attachments: [...] }]`. Não: todo
 * leitor de hoje percorre o array plano — as duas somas deste arquivo, o
 * CategoryBlock do painel, o Word, o upload. Com o dono no ITEM, as funções
 * antigas ignoram um campo que não conhecem e continuam devolvendo o total da
 * demanda; a fatia por pessoa sai pelo `itemFilter` que já existe, sem
 * traversal novo. E a soma dos blocos fecha com o total POR CONSTRUÇÃO, porque
 * os blocos são uma partição dos mesmos itens.
 *
 * ---------------------------------------------------------------------------
 * `horas` ausente ≠ zero
 * ---------------------------------------------------------------------------
 * A ausência é preservada aqui de propósito (`horasInformadas: false`) em vez
 * de virar um número. Quem decide o fallback é quem tem o contexto:
 *
 *   • TITULAR sem horas  → mantém o rateio de instructor_allocations;
 *   • PARTICIPANTE sem horas → `horas_previstas` da demanda.
 *
 * São fallbacks DIFERENTES para o mesmo campo vazio, então resolvê-lo aqui com
 * um `?? 0` (ou com qualquer default único) quebraria um dos dois em silêncio,
 * em cima de pagamento. Ver `applyMeasurementOverrides`.
 *
 * ---------------------------------------------------------------------------
 * DUAS resoluções do mesmo ausente: PAINEL e EXCEL
 * ---------------------------------------------------------------------------
 * Não são a mesma conta, e a diferença é deliberada:
 *
 *   | papel        | PAINEL (esta função)        | EXCEL (applyMeasurementOverrides) |
 *   |--------------|-----------------------------|-----------------------------------|
 *   | TITULAR      | carga padrão da demanda     | mantém o rateio da alocação       |
 *   | PARTICIPANTE | carga padrão da demanda     | `horas_previstas` (carga cheia)   |
 *   | ACOMPANHANTE | ZERO (manual obrigatório)   | não gera linha nenhuma            |
 *
 * O painel PRECISA mostrar um número: uma medição de titular sem horas digitadas
 * exibindo "R$ 0,00" é a v1 quebrada — lá o valor sempre foi
 * `classHours × hourRate`, e classHours abre preenchido com a carga da demanda.
 *
 * O Excel NÃO pode usar esse mesmo default: a demanda dividida por dias tem
 * rateio de 8h + 8h numa carga de 16h, e resolver o ausente para a carga faria
 * cada um valer 16h — 32h numa demanda de 16h. Por isso lá o ausente do titular
 * é "mantenha o rateio", que é o único lugar que conhece a divisão.
 *
 * E o ACOMPANHANTE é o oposto dos dois: ninguém sabe quantas horas ele fez, só
 * quantos dias acompanhou. Inventar horas para ele erra na direção cara, então
 * o painel mostra a sugestão proporcional como TEXTO e o Excel se recusa a
 * gerar linha até alguém digitar.
 *
 * A carga entra por INJEÇÃO (`PanelHoursContext`) e não por leitura de campo:
 * este módulo não tem nenhum import, e é isso que deixa os smokes rodarem sem
 * montar React nem cliente de banco.
 * ────────────────────────────────────────────────────────────────────────── */

/** Um bloco de pagamento já resolvido: a pessoa, o que ela recebe e os itens dela. */
export interface MeasurementPersonBlock {
  instructorId: string;
  papel: MeasurementRole;
  /** Ausente no JSON = não informado. Ver `horasInformadas`. */
  horas?: number;
  /** `false` quando o JSON não trazia `horas` — o chamador decide o fallback. */
  horasInformadas: boolean;
  valorHH: number;
  /** Itens deste bloco: uma partição de `m.attachments`. */
  attachments: TotalizableAttachment[];
  /** `true` no bloco que absorve os itens sem `instructorId`. */
  titular: boolean;
}

/**
 * Os blocos de pagamento de uma medição, v1 e v2 pela mesma porta.
 *
 * SEM `participantes` (todo o histórico) devolve UM bloco de titular com
 * `classHours`/`hourRate` e TODOS os attachments — cujo `horas × valorHH` é
 * exatamente o `classHours × hourRate` que `computeMeasurementTotals` calcula
 * hoje. É esse o contrato de compatibilidade, e ele é verificável.
 *
 * `titularInstructorId` entra por PARÂMETRO, e não por import de `Demand`:
 * este módulo não tem nenhum import, e é isso que deixa os smokes rodarem sem
 * montar React nem cliente de banco.
 */
export function normalizeMeasurementBlocks(
  m: TotalizableMeasurement | null | undefined,
  titularInstructorId?: string | null
): MeasurementPersonBlock[] {
  const attachments = m?.attachments ?? [];
  const participantes = m?.expenses?.participantes ?? [];

  // ---- v1: mono-pessoa ----
  if (participantes.length === 0) {
    const classHours = m?.expenses?.classHours;
    return [
      {
        instructorId: titularInstructorId || '',
        papel: 'TITULAR',
        horas: naoInformado(classHours) ? undefined : parseExpenseValue(classHours),
        horasInformadas: !naoInformado(classHours),
        valorHH: parseExpenseValue(m?.expenses?.hourRate),
        attachments: [...attachments],
        titular: true,
      },
    ];
  }

  // ---- v2: um bloco por entrada ----
  //
  // O bloco TITULAR é quem absorve os itens sem dono. Se nenhuma entrada for
  // titular (dado torto, ou uma medição só de acompanhantes na F3), o primeiro
  // bloco assume o papel — assim nenhum item de despesa evapora da conta, que é
  // a propriedade que faz "soma dos blocos = total" valer sempre.
  const idxTitular = (() => {
    const porPapel = participantes.findIndex(p => p?.papel === 'TITULAR');
    if (porPapel >= 0) return porPapel;
    if (titularInstructorId) {
      const porId = participantes.findIndex(p => p?.instructorId === titularInstructorId);
      if (porId >= 0) return porId;
    }
    return 0;
  })();

  const donosConhecidos = new Set(
    participantes.map(p => p?.instructorId).filter((id): id is string => !!id)
  );

  return participantes.map((p, i) => {
    const ehTitular = i === idxTitular;

    // Item entra no bloco do dono; sem dono — ou com um dono que não está mais
    // na lista (participante removido depois do lançamento) — cai no titular.
    // Órfão nenhum fica de fora: o total tem de continuar fechando.
    const doBloco = attachments.filter(a => {
      const dono = a?.instructorId;
      if (!dono) return ehTitular;
      if (!donosConhecidos.has(dono)) return ehTitular;
      return dono === p?.instructorId;
    });

    return {
      instructorId: p?.instructorId || '',
      papel: (p?.papel as MeasurementRole) || (ehTitular ? 'TITULAR' : 'PARTICIPANTE'),
      horas: naoInformado(p?.horas) ? undefined : parseExpenseValue(p?.horas),
      horasInformadas: !naoInformado(p?.horas),
      valorHH: parseExpenseValue(p?.valorHH),
      attachments: doBloco,
      titular: ehTitular,
    };
  });
}

/**
 * Ausente de verdade: `undefined`, `null` ou string vazia.
 *
 * `0` NÃO é ausente — alguém pode ter digitado zero de propósito, e tratar isso
 * como "não informado" faria o fallback sobrescrever uma decisão do usuário.
 */
function naoInformado(v: number | string | null | undefined): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** O que o painel precisa injetar para resolver um bloco sem `horas`. */
export interface PanelHoursContext {
  /**
   * Carga padrão da demanda — o que o titular vale sem ninguém digitar.
   * Cliente: horas do treinamento (ou o `classHours` já informado na medição).
   * Interna: `horas_previstas`.
   */
  demandDefaultHours: number;
}

/**
 * As horas que o PAINEL conta para um bloco. Ver a tabela no cabeçalho da
 * seção: o Excel resolve o mesmo ausente de outro jeito, e de propósito.
 *
 * Horas informadas sempre vencem — inclusive um 0 digitado, que é decisão de
 * alguém e não ausência.
 */
export function blockPanelHours(b: MeasurementPersonBlock, ctx: PanelHoursContext): number {
  if (b.horasInformadas && b.horas !== undefined) return b.horas;
  // Acompanhante é manual obrigatório: a sugestão proporcional é texto na tela,
  // nunca um número que entra na conta sem alguém ter olhado.
  if (b.papel === 'ACOMPANHANTE') return 0;
  return ctx.demandDefaultHours;
}

/**
 * A parcela de Hora/Aula de um bloco NO PAINEL.
 *
 * O contexto é OBRIGATÓRIO — e um objeto, não um número solto, justamente para
 * que `blocos.map(blockHoraAula)` não compile: o índice do `map` entraria como
 * carga da demanda e o erro seria silencioso, em cima de pagamento.
 */
export function blockHoraAula(b: MeasurementPersonBlock, ctx: PanelHoursContext): number {
  return blockPanelHours(b, ctx) * b.valorHH;
}

/**
 * As despesas de um bloco, nos quatro buckets do painel.
 *
 * Reusa `computePanelExpenseBreakdown` com o `itemFilter` que já existia — sem
 * percurso novo, e com o mesmo tratamento de órfão de OUTROS. É por isso que a
 * soma dos blocos fecha com o total da medição.
 */
export function blockExpenseBreakdown(
  m: TotalizableMeasurement | null | undefined,
  block: MeasurementPersonBlock
): PanelExpenseBreakdown {
  const doBloco = new Set(block.attachments);
  return computePanelExpenseBreakdown(m, { itemFilter: a => doBloco.has(a) });
}
