/**
 * DATASET DESPESAS — uma linha por ITEM DE DESPESA da medição
 *
 * Cada linha é um elemento de `measurements.attachments` (notinha anexada ou
 * valor avulso), com a demanda, a PESSOA dona do item, a categoria (as seis do
 * painel), o valor, as duas flags e se há arquivo. É a visão item a item do
 * que o dataset Medições soma por pessoa.
 *
 * NADA É RECALCULADO, e a fonte da verdade é a mesma do painel:
 *   • DONO — `resolvePersonBlocks` (domain/measurementPersonBlocks.ts): a
 *     decisão v1/v2 num lugar só. Os itens de cada linha vêm dos `attachments`
 *     do BLOCO da pessoa; o objeto lido é `paraNormalizar`, nunca `m` cru.
 *     Item sem `instructorId`, ou com dono que saiu do cadastro, cai no
 *     titular principal — e a coluna "Dono — origem" diz que foi por isso.
 *     Medição sem ninguém no cadastro vira linhas "(sem instrutor)", como em
 *     Medições.
 *   • ÓRFÃO DE OUTROS — o MESMO predicado de `computePanelExpenseBreakdown`
 *     (`isOrfaoOutros`): anexo de Outros apontando para linha apagada. Sai
 *     listado, com "Órfão (fora do total)" ligada; fica fora do Σ do painel e
 *     por isso o smoke o exclui da conferência.
 *   • CATEGORIA/BUCKET — `EXPENSE_CATEGORY_LABELS` e `panelBucketOf` do
 *     domínio (6 categorias → 4 buckets, desconhecida → Outros).
 *   • FLAGS — `isNaoReembolsavel` / `isPagoPeloInstrutor`, as leituras únicas.
 *   • ANEXO — `resolveAttachmentLink` (o mesmo do item do painel): arquivo com
 *     referência (url, ou bucket+path), valor avulso, ou arquivo que perdeu a
 *     referência. Aqui só se pergunta "há arquivo?"; nenhuma URL é gerada.
 *
 * Σ dos valores das linhas não órfãs de uma medição, por pessoa e por bucket,
 * = `blockExpenseBreakdown`; de toda a medição = `computePanelExpenseBreakdown`
 * — com e sem `itemFilter` das flags. O smoke prende os quatro.
 */
import type {
  Demand,
  DemandStatus,
  Measurement,
  Training,
  InstructorAllocation,
  DemandParticipant,
  CompanionAllocation,
  Attachment,
} from '../../../types';
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
} from '../../measurementTotals';
import { resolveMeasurementPeople } from '../../measurementPeople';
import { resolvePersonBlocks } from '../../measurementPersonBlocks';
import { resolveAttachmentLink } from '../../measurementAttachment';
import { buildTrainingsById } from '../../modalityOptions';
import { getDemandTitle, getDemandCategoria } from '../../demandLabel';
import {
  resolveCalculatedStatus,
  resolveCompanyLabel,
  resolveModalityLabel,
  statusLabel,
  tipoLabel,
  toBrDate,
  round2,
} from '../shared';
import { PAPEL_LABELS } from '../filters';
import type { CellValue, ColumnDef, DatasetDef, FilterableRow } from '../types';

/* ────────────────────────────── entrada ────────────────────────────── */

export interface DespesasSource {
  demands: Demand[];
  measurements: Measurement[];
  trainings: Training[];
  instructors: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  instructorAllocations: InstructorAllocation[];
  participants: DemandParticipant[];
  companions: CompanionAllocation[];
  regionNameById?: Map<string, string>;
  now?: Date;
}

/* ─────────────────────────────── linha ─────────────────────────────── */

export type DonoOrigem = 'Gravado no item' | 'Titular (item sem dono)' | 'Titular (dono fora da lista)';
export type AnexoTipo = 'Arquivo' | 'Valor avulso' | 'Arquivo não vinculado';

export interface DespesaRow extends FilterableRow {
  demand: Demand;
  measurement: Measurement;
  item: Attachment;

  instructorId: string;
  instructorName: string;
  papel: MeasurementRole;
  donoOrigem: DonoOrigem;

  empresa: string;
  titulo: string;
  categoriaInterna: string;
  tipo: string;
  modalidade: string;
  statusCalculado: DemandStatus;
  uf: string;
  regiao: string;

  /** Chave crua da categoria ('' quando ausente). Alimenta o filtro. */
  categoriaDespesa: string;
  categoriaLabel: string;
  bucket: PanelExpenseBucket;
  descricao: string;
  arquivo: string;
  valor: number;
  naoReembolsa: boolean;
  pagoPeloInstrutor: boolean;
  temAnexo: boolean;
  anexoTipo: AnexoTipo;
  orfao: boolean;

  medicaoStatus: string;
  medicaoAtualizadaEm: string;
  v2: boolean;
}

/* ─────────────────────────── construção ─────────────────────────── */

const ORDEM_CATEGORIA: Record<string, number> = { HOSPEDAGEM: 0, LOCOMOCAO: 1, CAFE: 2, ALMOCO: 3, JANTAR: 4, OUTROS: 5 };

export function buildDespesasRows(src: DespesasSource): DespesaRow[] {
  const now = src.now ?? new Date();
  const trainingsById = buildTrainingsById(src.trainings);
  const demandsById = new Map(src.demands.map(d => [d.id, d]));
  const instructorName = (id: string) =>
    id ? (src.instructors.find(i => i.id === id)?.name ?? `Instrutor ${id}`) : '(sem instrutor)';

  const rows: DespesaRow[] = [];

  for (const m of src.measurements) {
    const demand = demandsById.get(m.demandId);
    if (!demand) continue; // medição órfã: sem demanda não há linha a montar

    const pessoas = resolveMeasurementPeople(demand, src.instructorAllocations, src.participants, src.companions);
    const { v2, paraNormalizar, blocos } = resolvePersonBlocks(m as any, demand, pessoas);
    const donosConhecidos = new Set(blocos.map(b => b.instructorId).filter(Boolean));
    const outrasLinhas = new Map((m.otherExpenses ?? []).map(o => [o.id, o]));

    const base = {
      demand,
      measurement: m,
      empresa: resolveCompanyLabel(demand, src.companies),
      titulo: getDemandTitle(demand, src.trainings as any, '—'),
      categoriaInterna: getDemandCategoria(demand),
      tipo: tipoLabel(demand),
      modalidade: resolveModalityLabel(demand, trainingsById),
      statusCalculado: resolveCalculatedStatus(demand, trainingsById, now),
      uf: (demand.demandState ?? '').trim().toUpperCase(),
      regiao: src.regionNameById?.get(demand.regionId) ?? demand.regionId ?? '',
      medicaoStatus: m.status ?? '',
      medicaoAtualizadaEm: toBrDate(m.updatedAt),
      v2,
    };

    for (const bloco of blocos) {
      // O papel da LISTA manda (o JSON pode ter sido gravado antes de a pessoa mudar de papel).
      const papel: MeasurementRole = pessoas.find(p => p.instructorId === bloco.instructorId)?.papel ?? bloco.papel;
      for (const a of bloco.attachments as (TotalizableAttachment & Attachment)[]) {
        if (!a) continue;
        const cat = String(a.category ?? '');
        const orfao = isOrfaoOutros(paraNormalizar, a);
        const link = resolveAttachmentLink(a, { resolveStorageUrl: (b, p) => `${b}/${p}` });
        const donoGravado = a.instructorId ?? '';
        const donoOrigem: DonoOrigem = !donoGravado
          ? 'Titular (item sem dono)'
          : donoGravado === bloco.instructorId
            ? 'Gravado no item'
            : donosConhecidos.has(donoGravado)
              ? 'Gravado no item'
              : 'Titular (dono fora da lista)';
        const linhaOutros = cat === 'OUTROS' && a.otherId ? outrasLinhas.get(a.otherId) : undefined;
        rows.push({
          ...base,
          item: a,
          instructorId: bloco.instructorId,
          instructorName: instructorName(bloco.instructorId),
          papel,
          donoOrigem,
          categoriaDespesa: cat,
          categoriaLabel: (EXPENSE_CATEGORY_LABELS as Record<string, string>)[cat] ?? (cat || '(sem categoria)'),
          bucket: panelBucketOf(cat),
          descricao: cat === 'OUTROS' ? (linhaOutros?.description ?? '') : link.label,
          arquivo: (a.name ?? '').trim(),
          valor: round2(parseExpenseValue(a.value)),
          naoReembolsa: isNaoReembolsavel(a),
          pagoPeloInstrutor: isPagoPeloInstrutor(a),
          temAnexo: link.kind === 'link',
          anexoTipo: link.kind === 'link' ? 'Arquivo' : link.kind === 'plain' ? 'Valor avulso' : 'Arquivo não vinculado',
          orfao,
        });
      }
    }
  }

  rows.sort(
    (a, b) =>
      (b.demand.startDate ?? '').localeCompare(a.demand.startDate ?? '') ||
      a.demand.id.localeCompare(b.demand.id) ||
      a.instructorName.localeCompare(b.instructorName, 'pt-BR') ||
      (ORDEM_CATEGORIA[a.categoriaDespesa] ?? 9) - (ORDEM_CATEGORIA[b.categoriaDespesa] ?? 9) ||
      a.item.id.localeCompare(b.item.id)
  );
  return rows;
}

/* ─────────────────────────────── colunas ─────────────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<DespesaRow>['kind'],
  defaultOn: boolean,
  get: (r: DespesaRow) => CellValue,
  extra: Partial<Pick<ColumnDef<DespesaRow>, 'width' | 'help'>> = {}
): ColumnDef<DespesaRow> => ({ key, header, kind, defaultOn, get, ...extra });

const bucketLabel = (b: PanelExpenseBucket) => PANEL_EXPENSE_LABELS.find(x => x.key === b)?.label ?? b;

/** Opções do filtro de categoria — as seis do painel, na ordem do card. */
export const CATEGORIA_DESPESA_OPTIONS: { value: ExpenseCategoryKey; label: string }[] = (
  ['HOSPEDAGEM', 'LOCOMOCAO', 'CAFE', 'ALMOCO', 'JANTAR', 'OUTROS'] as ExpenseCategoryKey[]
).map(value => ({ value, label: EXPENSE_CATEGORY_LABELS[value] }));

export const DESPESAS_COLUMNS: ColumnDef<DespesaRow>[] = [
  col('demandId', 'Demanda', 'text', true, r => r.demand.id, { width: 12 }),
  col('clientDemandId', 'ID Cliente', 'text', false, r => r.demand.clientDemandId ?? '', { width: 14 }),
  col('tipo', 'Tipo', 'text', true, r => r.tipo, { width: 10 }),
  col('empresa', 'Empresa', 'text', true, r => r.empresa, { width: 30 }),
  col('titulo', 'Treinamento / Descrição', 'text', true, r => r.titulo, { width: 40 }),
  col('categoriaInterna', 'Categoria (interna)', 'text', false, r => r.categoriaInterna, { width: 18 }),
  col('modalidade', 'Modalidade', 'text', false, r => r.modalidade, { width: 16 }),
  col('status', 'Status (calculado)', 'text', false, r => statusLabel(r.statusCalculado), { width: 16 }),
  col('dataInicio', 'Data início', 'date', true, r => toBrDate(r.demand.startDate), { width: 12 }),
  col('dataFim', 'Data fim', 'date', false, r => toBrDate(r.demand.endDate), { width: 12 }),
  col('uf', 'UF', 'text', false, r => r.uf, { width: 6 }),
  col('regiao', 'Região', 'text', false, r => r.regiao, { width: 16 }),
  col('local', 'Local', 'text', false, r => r.demand.trainingLocal ?? '', { width: 22 }),

  col('pessoa', 'Pessoa', 'text', true, r => r.instructorName, { width: 28, help: 'Dona do item pelo painel: o dono gravado, ou o titular principal quando o item não tem dono (ou o dono saiu do cadastro).' }),
  col('papel', 'Papel', 'text', true, r => PAPEL_LABELS[r.papel] ?? r.papel, { width: 14 }),
  col('donoOrigem', 'Dono — origem', 'text', false, r => r.donoOrigem, { width: 26 }),

  col('categoria', 'Categoria', 'text', true, r => r.categoriaLabel, { width: 16, help: 'As seis do painel: Hospedagem, Locomoção, Café da manhã, Almoço, Jantar, Outras despesas.' }),
  col('bucket', 'Bucket (painel)', 'text', false, r => bucketLabel(r.bucket), { width: 14, help: 'Os quatro do card: Café/Almoço/Jantar viram Alimentação.' }),
  col('descricao', 'Descrição', 'text', true, r => r.descricao, { width: 36, help: 'Outras despesas: a descrição da linha; demais: o nome do item (arquivo ou valor avulso).' }),
  col('arquivo', 'Arquivo', 'text', false, r => r.arquivo, { width: 30 }),
  col('valor', 'Valor (R$)', 'currency', true, r => r.valor, { width: 12 }),
  col('naoReembolsa', 'Vale não reembolsa', 'boolean', true, r => r.naoReembolsa, { width: 10, help: 'Flag "Não reembolsa": fora da Medição Vale / BM; continua no total da medição.' }),
  col('pagoPeloInstrutor', 'Pago pelo instrutor', 'boolean', true, r => r.pagoPeloInstrutor, { width: 10, help: 'Flag "Pago pelo instrutor": entra no Excel de pagamento (a Colabor reembolsa a pessoa).' }),
  col('temAnexo', 'Tem anexo', 'boolean', true, r => r.temAnexo, { width: 8, help: 'Arquivo com referência (url ou bucket+path). Valor avulso e arquivo não vinculado = Não.' }),
  col('anexoTipo', 'Tipo do item', 'text', false, r => r.anexoTipo, { width: 20 }),
  col('orfao', 'Órfão (fora do total)', 'boolean', true, r => r.orfao, { width: 10, help: 'Anexo de Outras despesas apontando para linha apagada: o painel não soma, como computeMeasurementTotals. Listado para não sumir.' }),
  col('dataItem', 'Data do item', 'text', false, r => toBrDate(r.item.date) || String(r.item.date ?? ''), { width: 12 }),

  col('medicaoStatus', 'Status da medição', 'text', true, r => r.medicaoStatus, { width: 18 }),
  col('medicaoAtualizadaEm', 'Medição atualizada em', 'date', false, r => r.medicaoAtualizadaEm, { width: 12 }),
  col('formato', 'Formato da medição', 'text', false, r => r.v2 ? 'v2 (por pessoa)' : 'v1 (mono-pessoa)', { width: 14 }),
];

export const DESPESAS_DATASET: DatasetDef<DespesaRow> = {
  key: 'despesas',
  label: 'Despesas',
  description: 'Uma linha por item de despesa da medição (notinha ou valor avulso): pessoa dona, categoria, valor, flags e anexo.',
  requiredView: 'measurement',
  filters: ['periodo', 'cliente', 'instrutor', 'categoriaDespesa', 'flagNaoReembolsa', 'flagPagoInstrutor'],
  options: ['incluirCanceladas'],
  columns: DESPESAS_COLUMNS,
  fileBase: 'despesas',
};
