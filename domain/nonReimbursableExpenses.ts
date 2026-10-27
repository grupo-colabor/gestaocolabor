/**
 * DESPESAS NÃO REEMBOLSÁVEIS — a lista por demanda e por item, fonte única
 *
 * O card "Despesas Não Reembolsáveis" (Dashboard, aba CUSTOS) mostrava só o
 * agregado: total, "N itens em M medições" e a quebra nos quatro buckets do
 * Painel de Medição. A lista expansível do card e as abas do Excel precisam
 * dos ITENS por trás desse número, com dono, descrição e data — e os três
 * (card, lista, Excel) não podem divergir.
 *
 * Por isso a ordem aqui é: primeiro os ITENS (`collectNonReimbursableItems`),
 * depois tudo o mais DERIVADO deles por função pura — a visão por demanda
 * (`aggregateNonReimbursableByDemand`) e o resumo do card
 * (`summarizeNonReimbursable`). Nenhuma soma é feita à parte: o total do card
 * é Σ dos itens, a linha da demanda é Σ dos itens dela, e a aba por demanda do
 * Excel é a aba por item agrupada. O smoke (`npm run smoke:nao-reembolsaveis`)
 * prende as três igualdades contra `aggregatePanelExpenseBreakdown`, que era
 * a conta antiga do card.
 *
 * ---------------------------------------------------------------------------
 * Regras copiadas da quebra do card (computePanelExpenseBreakdown)
 * ---------------------------------------------------------------------------
 *   • o recorte é `isNaoReembolsavel` (`reembolsavel === false`; ausente =
 *     reembolsável, item antigo fica de fora);
 *   • ÓRFÃO DE OUTROS (anexo de Outros apontando para linha apagada de
 *     `other_expenses`) fica FORA do total e dos itens — como no painel e no
 *     card — mas é CONTADO em `itensOrfaos`, para a tela avisar "N itens
 *     órfãos fora do total" em vez de sumir com ele;
 *   • categoria desconhecida ou ausente cai em OUTROS (`panelBucketOf`), não
 *     evapora — é o que faz a soma dos quatro buckets fechar com o total;
 *   • valor lido por `parseExpenseValue`, a mesma tolerância do card.
 *
 * ---------------------------------------------------------------------------
 * Dono do item
 * ---------------------------------------------------------------------------
 * A MESMA regra do painel e do dataset Despesas: `resolvePersonBlocks`
 * (domain/measurementPersonBlocks.ts) decide v1/v2, e item sem `instructorId`
 * — ou com dono que saiu do cadastro — cai no titular principal. Os blocos são
 * uma PARTIÇÃO dos anexos, então atribuir dono não muda total nenhum: todo
 * item marcado aparece exatamente uma vez, no bloco de alguém. Medição sem
 * ninguém no cadastro vira "(sem instrutor)", como em Despesas.
 *
 * Só as medições que TÊM item marcado passam por `resolvePersonBlocks`: o
 * Dashboard chama isto a cada mudança de filtro sobre todas as medições do
 * recorte, e resolver pessoa em medição sem item marcado seria trabalho à toa.
 *
 * ---------------------------------------------------------------------------
 * Por que um arquivo irmão, e não dentro de measurementTotals.ts
 * ---------------------------------------------------------------------------
 * `measurementTotals.ts` não tem import nenhum, de propósito, e
 * `measurementPersonBlocks.ts` importa dele. A lista precisa de
 * `resolvePersonBlocks` — colocá-la lá fecharia um ciclo de import. Aqui ela
 * importa dos dois e continua sem React, Supabase ou ExcelJS: roda no smoke.
 */
import {
  EXPENSE_CATEGORY_LABELS,
  PANEL_EXPENSE_LABELS,
  isNaoReembolsavel,
  isPagoPeloInstrutor,
  isOrfaoOutros,
  panelBucketOf,
  parseExpenseValue,
  type ExpenseCategoryKey,
  type MeasurementRole,
  type PanelExpenseBucket,
  type TotalizableAttachment,
  type TotalizableMeasurement,
} from './measurementTotals';
import { resolveMeasurementPeople, type ParticipantLike, type CompanionLike, type PeopleDemandLike } from './measurementPeople';
import { resolvePersonBlocks } from './measurementPersonBlocks';
import type { InstructorAllocationLike } from './demandInstructors';
import { resolveAttachmentLink, type AttachmentLike } from './measurementAttachment';
import { getDemandTitle, getDemandCompanyLabel } from './demandLabel';
import { measurementStatusLabel } from './measurementStatus';
import { toBrDate } from './exports/shared';

/* ────────────────────────────── entrada ────────────────────────────── */

/** Só o que a lista lê de uma demanda (aceita `Demand` e qualquer subconjunto). */
export interface NonReimbursableDemandLike extends PeopleDemandLike {
  id: string;
  tipo: 'cliente' | 'interna';
  companyId: string;
  trainingId: string;
  categoriaInterna?: string | null;
  descricaoInterna?: string | null;
  startDate: string;
  endDate: string;
  corredor?: string | null;
  demandState?: string | null;
  instructorId?: string | null;
}

/** Só o que a lista lê de uma medição: os campos da conta mais id, status e descrições de Outros. */
export interface NonReimbursableMeasurementLike extends TotalizableMeasurement {
  id?: string;
  demandId: string;
  status?: string | null;
  attachments?: (TotalizableAttachment & AttachmentLike & { id?: string; date?: string | null })[] | null;
  otherExpenses?: { id: string; description?: string | null }[] | null;
}

export interface NonReimbursableSource {
  /** Demandas JÁ recortadas pelos filtros do Dashboard (cliente, P1). */
  demands: NonReimbursableDemandLike[];
  /** Medições JÁ recortadas (as das demandas acima). Medição órfã é ignorada. */
  measurements: NonReimbursableMeasurementLike[];
  instructorAllocations: InstructorAllocationLike[];
  participants: ParticipantLike[];
  companions: CompanionLike[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  trainings: { id: string; name: string }[];
}

/* ─────────────────────────────── saída ─────────────────────────────── */

export const PAPEL_LABELS: Record<MeasurementRole, string> = {
  TITULAR: 'Titular',
  PARTICIPANTE: 'Participante',
  ACOMPANHANTE: 'Acompanhante',
};

/** Subcategoria só existe dentro de Alimentação; as demais ficam em branco. */
const SUBCATEGORIA: Partial<Record<ExpenseCategoryKey, string>> = {
  CAFE: EXPENSE_CATEGORY_LABELS.CAFE,
  ALMOCO: EXPENSE_CATEGORY_LABELS.ALMOCO,
  JANTAR: EXPENSE_CATEGORY_LABELS.JANTAR,
};

export const bucketLabel = (b: PanelExpenseBucket): string =>
  PANEL_EXPENSE_LABELS.find(x => x.key === b)?.label ?? b;

export interface NonReimbursableItem {
  demandId: string;
  measurementId: string;
  itemId: string;
  empresa: string;
  treinamento: string;
  /** 'YYYY-MM-DD…' crus da demanda; `toBrDate` formata na hora de exibir. */
  dataInicio: string;
  dataFim: string;
  corredor: string;
  uf: string;
  instructorId: string;
  pessoa: string;
  papel: MeasurementRole;
  papelLabel: string;
  medicaoStatus: string;
  medicaoStatusLabel: string;
  /** Categoria crua do JSON ('' quando ausente). */
  categoria: string;
  /** O bucket do card (4) — é o que soma na coluna da demanda. */
  bucket: PanelExpenseBucket;
  bucketLabel: string;
  /** Café da manhã / Almoço / Jantar dentro de Alimentação; '' nas demais. */
  subcategoria: string;
  /** "Alimentação · Almoço" ou só "Hospedagem". */
  categoriaLabel: string;
  /** Outros: descrição da linha; demais: nome do item (arquivo ou valor avulso). */
  descricao: string;
  /** Data crua do item (ISO), '' quando ausente. */
  dataItem: string;
  pagoPeloInstrutor: boolean;
  valor: number;
}

export interface NonReimbursablePerson {
  instructorId: string;
  nome: string;
  papel: MeasurementRole;
}

export interface NonReimbursableDemand {
  demandId: string;
  measurementId: string;
  empresa: string;
  treinamento: string;
  dataInicio: string;
  dataFim: string;
  corredor: string;
  uf: string;
  /** Donos dos itens marcados (distintos, na ordem em que aparecem). */
  pessoas: NonReimbursablePerson[];
  /** "Fulano, Beltrano (Acompanhante)" — titular sem sufixo, os demais com o papel. */
  pessoasLabel: string;
  medicaoStatus: string;
  medicaoStatusLabel: string;
  quebra: Record<PanelExpenseBucket, number>;
  total: number;
  qtdItens: number;
  /** Os itens desta demanda, em ordem de valor desc. */
  itens: NonReimbursableItem[];
}

export interface NonReimbursableSummary {
  quebra: Record<PanelExpenseBucket, number>;
  /** A quebra de Alimentação nas três refeições — Σ = quebra.alimentacao. */
  subQuebra: { cafe: number; almoco: number; jantar: number };
  total: number;
  qtdItens: number;
  /** Medições (= demandas, 1:1) com ao menos um item marcado. */
  medicoes: number;
}

export interface NonReimbursableList extends NonReimbursableSummary {
  /** Todos os itens, na ordem das demandas (total desc) e valor desc dentro da demanda. */
  itens: NonReimbursableItem[];
  /** Uma linha por demanda com item marcado, ordenada por total desc. */
  demandas: NonReimbursableDemand[];
  /** Anexos de Outros marcados que apontam para linha apagada: fora de tudo acima, mas contados. */
  itensOrfaos: number;
}

/* ─────────────────────────── construção ─────────────────────────── */

const zeroQuebra = (): Record<PanelExpenseBucket, number> =>
  ({ hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0 });

export interface CollectedItems {
  itens: NonReimbursableItem[];
  itensOrfaos: number;
}

/**
 * Os itens marcados como não reembolsáveis, um por anexo, com o dono resolvido.
 * É a ÚNICA passagem pelos anexos deste módulo; tudo o mais deriva daqui.
 */
export function collectNonReimbursableItems(src: NonReimbursableSource): CollectedItems {
  const demandsById = new Map(src.demands.map(d => [d.id, d]));
  const instructorName = (id: string) =>
    id ? (src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`) : '(sem instrutor)';

  const itens: NonReimbursableItem[] = [];
  let itensOrfaos = 0;

  for (const m of src.measurements) {
    if (!m) continue;
    const demand = demandsById.get(m.demandId);
    if (!demand) continue; // medição órfã: sem demanda não há linha a montar

    // Caminho rápido: nada marcado, nada a resolver.
    const anexos = m.attachments ?? [];
    if (!anexos.some(a => a && isNaoReembolsavel(a))) continue;

    const pessoas = resolveMeasurementPeople(demand, src.instructorAllocations, src.participants, src.companions);
    const { paraNormalizar, blocos } = resolvePersonBlocks(m as any, demand, pessoas);
    const outrasLinhas = new Map((m.otherExpenses ?? []).map(o => [o.id, o]));

    const base = {
      demandId: demand.id,
      measurementId: m.id ?? `MEA-${demand.id}`,
      empresa: getDemandCompanyLabel(demand, src.companies),
      treinamento: getDemandTitle(demand, src.trainings, '—'),
      dataInicio: demand.startDate ?? '',
      dataFim: demand.endDate ?? '',
      corredor: (demand.corredor ?? '').trim(),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      medicaoStatus: m.status ?? '',
      medicaoStatusLabel: measurementStatusLabel(m.status),
    };

    for (const bloco of blocos) {
      // O papel da LISTA manda (o JSON pode ter sido gravado antes de a pessoa mudar de papel).
      const papel: MeasurementRole = pessoas.find(p => p.instructorId === bloco.instructorId)?.papel ?? bloco.papel;
      for (const a of bloco.attachments as NonNullable<NonReimbursableMeasurementLike['attachments']>) {
        if (!a || !isNaoReembolsavel(a)) continue;
        if (isOrfaoOutros(paraNormalizar, a)) { itensOrfaos += 1; continue; }

        const cat = String(a.category ?? '');
        const bucket = panelBucketOf(cat);
        const sub = SUBCATEGORIA[cat as ExpenseCategoryKey] ?? '';
        const linhaOutros = cat === 'OUTROS' && a.otherId ? outrasLinhas.get(a.otherId) : undefined;
        const link = resolveAttachmentLink(a, { resolveStorageUrl: (b, p) => `${b}/${p}` });

        itens.push({
          ...base,
          itemId: a.id ?? '',
          instructorId: bloco.instructorId,
          pessoa: instructorName(bloco.instructorId),
          papel,
          papelLabel: PAPEL_LABELS[papel] ?? papel,
          categoria: cat,
          bucket,
          bucketLabel: bucketLabel(bucket),
          subcategoria: sub,
          categoriaLabel: sub ? `${bucketLabel(bucket)} · ${sub}` : bucketLabel(bucket),
          descricao: cat === 'OUTROS' ? (linhaOutros?.description ?? '').trim() : link.label,
          dataItem: String(a.date ?? ''),
          pagoPeloInstrutor: isPagoPeloInstrutor(a),
          valor: parseExpenseValue(a.value),
        });
      }
    }
  }

  return { itens, itensOrfaos };
}

const porValorDesc = (a: NonReimbursableItem, b: NonReimbursableItem) =>
  b.valor - a.valor || a.pessoa.localeCompare(b.pessoa, 'pt-BR') || a.itemId.localeCompare(b.itemId);

/**
 * A visão por demanda, AGREGADA dos itens: uma linha por demanda, quebra nos
 * quatro buckets, pessoas distintas, ordenada por total desc (empate: DEM).
 */
export function aggregateNonReimbursableByDemand(itens: NonReimbursableItem[]): NonReimbursableDemand[] {
  const porDemanda = new Map<string, NonReimbursableDemand>();

  for (const it of itens) {
    let d = porDemanda.get(it.demandId);
    if (!d) {
      d = {
        demandId: it.demandId,
        measurementId: it.measurementId,
        empresa: it.empresa,
        treinamento: it.treinamento,
        dataInicio: it.dataInicio,
        dataFim: it.dataFim,
        corredor: it.corredor,
        uf: it.uf,
        pessoas: [],
        pessoasLabel: '',
        medicaoStatus: it.medicaoStatus,
        medicaoStatusLabel: it.medicaoStatusLabel,
        quebra: zeroQuebra(),
        total: 0,
        qtdItens: 0,
        itens: [],
      };
      porDemanda.set(it.demandId, d);
    }
    d.quebra[it.bucket] += it.valor;
    d.total += it.valor;
    d.qtdItens += 1;
    d.itens.push(it);
    if (!d.pessoas.some(p => p.instructorId === it.instructorId && p.papel === it.papel)) {
      d.pessoas.push({ instructorId: it.instructorId, nome: it.pessoa, papel: it.papel });
    }
  }

  const demandas = [...porDemanda.values()];
  for (const d of demandas) {
    d.itens.sort(porValorDesc);
    d.pessoasLabel = d.pessoas
      .map(p => (p.papel === 'TITULAR' ? p.nome : `${p.nome} (${PAPEL_LABELS[p.papel] ?? p.papel})`))
      .join(', ');
  }
  demandas.sort((a, b) => b.total - a.total || a.demandId.localeCompare(b.demandId));
  return demandas;
}

/** O resumo do card, Σ dos itens — o que antes vinha de `aggregatePanelExpenseBreakdown`. */
export function summarizeNonReimbursable(itens: NonReimbursableItem[]): NonReimbursableSummary {
  const quebra = zeroQuebra();
  const subQuebra = { cafe: 0, almoco: 0, jantar: 0 };
  const demandas = new Set<string>();
  let total = 0;

  for (const it of itens) {
    quebra[it.bucket] += it.valor;
    total += it.valor;
    demandas.add(it.demandId);
    if (it.categoria === 'CAFE') subQuebra.cafe += it.valor;
    else if (it.categoria === 'ALMOCO') subQuebra.almoco += it.valor;
    else if (it.categoria === 'JANTAR') subQuebra.jantar += it.valor;
  }

  return { quebra, subQuebra, total, qtdItens: itens.length, medicoes: demandas.size };
}

/**
 * A lista completa: itens, demandas e resumo, de UMA passagem pelos anexos.
 * Card, lista expansível e as abas do Excel leem este objeto.
 */
export function listNonReimbursableByDemand(src: NonReimbursableSource): NonReimbursableList {
  const { itens: coletados, itensOrfaos } = collectNonReimbursableItems(src);
  const demandas = aggregateNonReimbursableByDemand(coletados);
  // Itens na ordem das demandas (total desc), valor desc dentro de cada uma —
  // a ordem padrão da visão "Por item" e da aba do Excel.
  const itens = demandas.flatMap(d => d.itens);
  return { ...summarizeNonReimbursable(itens), itens, demandas, itensOrfaos };
}

/* ─────────────────────── linhas das abas do Excel ─────────────────────── */

export type NonReimbursableCellKind = 'text' | 'currency' | 'int';

export interface NonReimbursableColumn {
  header: string;
  kind: NonReimbursableCellKind;
  width: number;
}

export const NR_BY_DEMAND_COLUMNS: NonReimbursableColumn[] = [
  { header: 'Demanda', kind: 'text', width: 12 },
  { header: 'Empresa', kind: 'text', width: 28 },
  { header: 'Treinamento', kind: 'text', width: 36 },
  { header: 'Data início', kind: 'text', width: 12 },
  { header: 'Data fim', kind: 'text', width: 12 },
  { header: 'Corredor', kind: 'text', width: 16 },
  { header: 'UF', kind: 'text', width: 6 },
  { header: 'Pessoa(s)', kind: 'text', width: 34 },
  { header: 'Status medição', kind: 'text', width: 18 },
  { header: 'Hospedagem', kind: 'currency', width: 14 },
  { header: 'Locomoção', kind: 'currency', width: 14 },
  { header: 'Alimentação', kind: 'currency', width: 14 },
  { header: 'Outros', kind: 'currency', width: 14 },
  { header: 'Total', kind: 'currency', width: 14 },
  { header: 'Qtd itens', kind: 'int', width: 10 },
];

export const NR_BY_ITEM_COLUMNS: NonReimbursableColumn[] = [
  { header: 'Demanda', kind: 'text', width: 12 },
  { header: 'Empresa', kind: 'text', width: 28 },
  { header: 'Treinamento', kind: 'text', width: 36 },
  { header: 'Data início', kind: 'text', width: 12 },
  { header: 'Data fim', kind: 'text', width: 12 },
  { header: 'Corredor', kind: 'text', width: 16 },
  { header: 'UF', kind: 'text', width: 6 },
  { header: 'Pessoa', kind: 'text', width: 28 },
  { header: 'Papel', kind: 'text', width: 14 },
  { header: 'Status medição', kind: 'text', width: 18 },
  { header: 'Categoria', kind: 'text', width: 14 },
  { header: 'Subcategoria', kind: 'text', width: 16 },
  { header: 'Descrição', kind: 'text', width: 36 },
  { header: 'Data do item', kind: 'text', width: 12 },
  { header: 'Pago pelo instrutor', kind: 'text', width: 12 },
  { header: 'Valor', kind: 'currency', width: 14 },
];

export type NonReimbursableRow = (string | number)[];

/** Aba "Não reemb. por demanda": uma linha por demanda, na ordem da lista (total desc). */
export function buildNonReimbursableByDemandRows(list: NonReimbursableList): NonReimbursableRow[] {
  return list.demandas.map(d => [
    d.demandId,
    d.empresa,
    d.treinamento,
    toBrDate(d.dataInicio),
    toBrDate(d.dataFim),
    d.corredor,
    d.uf,
    d.pessoasLabel,
    d.medicaoStatusLabel,
    d.quebra.hospedagem,
    d.quebra.locomocao,
    d.quebra.alimentacao,
    d.quebra.outros,
    d.total,
    d.qtdItens,
  ]);
}

/** Aba "Não reemb. por item": uma linha por item, na ordem da lista. */
export function buildNonReimbursableByItemRows(list: NonReimbursableList): NonReimbursableRow[] {
  return list.itens.map(it => [
    it.demandId,
    it.empresa,
    it.treinamento,
    toBrDate(it.dataInicio),
    toBrDate(it.dataFim),
    it.corredor,
    it.uf,
    it.pessoa,
    it.papelLabel,
    it.medicaoStatusLabel,
    it.bucketLabel,
    it.subcategoria,
    it.descricao,
    toBrDate(it.dataItem),
    it.pagoPeloInstrutor ? 'Sim' : 'Não',
    it.valor,
  ]);
}

export interface NonReimbursableCustosRow {
  label: string;
  value: number;
  kind: 'currency' | 'int';
  /** Café / Almoço / Jantar: indentadas sob Alimentação. */
  sub?: boolean;
}

/**
 * O bloco "Despesas Não Reembolsáveis" da aba Custos: as MESMAS quatro
 * categorias do card, com as três refeições indentadas sob Alimentação
 * (Σ das três = Alimentação). A seção "Despesas por Categoria", de seis
 * categorias, segue intocada ao lado.
 */
export function buildNonReimbursableCustosRows(list: NonReimbursableList): NonReimbursableCustosRow[] {
  return [
    { label: 'Total não reembolsável', value: list.total, kind: 'currency' },
    { label: 'Itens', value: list.qtdItens, kind: 'int' },
    { label: 'Medições', value: list.medicoes, kind: 'int' },
    { label: 'Hospedagem', value: list.quebra.hospedagem, kind: 'currency' },
    { label: 'Locomoção', value: list.quebra.locomocao, kind: 'currency' },
    { label: 'Alimentação', value: list.quebra.alimentacao, kind: 'currency' },
    { label: EXPENSE_CATEGORY_LABELS.CAFE, value: list.subQuebra.cafe, kind: 'currency', sub: true },
    { label: EXPENSE_CATEGORY_LABELS.ALMOCO, value: list.subQuebra.almoco, kind: 'currency', sub: true },
    { label: EXPENSE_CATEGORY_LABELS.JANTAR, value: list.subQuebra.jantar, kind: 'currency', sub: true },
    { label: 'Outros', value: list.quebra.outros, kind: 'currency' },
  ];
}
