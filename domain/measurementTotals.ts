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
}

/** Só o que a conta lê de uma medição. */
export interface TotalizableMeasurement {
  attachments?: TotalizableAttachment[] | null;
  otherExpenses?: { id: string }[] | null;
  expenses?: { classHours?: number | string | null; hourRate?: number | string | null } | null;
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

