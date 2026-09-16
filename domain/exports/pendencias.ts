/**
 * PAINEL "O QUE FALTA PARA FECHAR A MEDIÇÃO" — checagens (puro)
 *
 * Para cada demanda da empresa do template no recorte da tela, lista o que
 * a impede de entrar na medição ou o que merece olhar antes de gerar.
 *
 *   FATO  — bloqueia a linha na aba Turmas (vem do dataset, `bloqueios`):
 *           não concluída, cancelada, sem instrutor titular.
 *   AVISO — a linha sai, o painel avisa:
 *           sem ID SAP (célula B vazia e amarela), sem preço HH (H vazia e
 *           amarela), sem medição iniciada, medição não pronta, viagem sem
 *           despesa lançada (INFERÊNCIA), item não reembolsável excluído,
 *           ID SAP repetido em outra demanda do recorte, interna com empresa
 *           Vale (fora da aba, por decisão; avisada aqui).
 *
 * De onde vem cada checagem está no código de cada uma. A única inferência é
 * "viagem sem despesa": logística com carro (alugado, próprio, táxi,
 * aplicativo, outros) ou hotel — em `logistic_allocations` (a linha do
 * Controle Logístico) ou em qualquer bloco de `logistic_blocks` — e nenhum
 * item de despesa na medição. É aviso, nunca bloqueio.
 */
import type { MedicaoValeRow } from './datasets/medicaoVale';
import { resolveManualValue } from './templates/resolve';
import type { TemplateSheet } from './templates/types';
import type { TemplateValuesIndex } from './templates/values';
import type { ColumnDef, DatasetDef, FilterableRow } from './types';
import { statusLabel, toBrDate } from './shared';
import { MEDICAO_STATUS_OPTIONS } from './filters';

export type PendenciaTipo = 'fato' | 'aviso';

export interface Pendencia {
  tipo: PendenciaTipo;
  texto: string;
}

export interface PendenciaRow extends FilterableRow {
  demand: MedicaoValeRow['demand'];
  origem: MedicaoValeRow;
  pendencias: Pendencia[];
  fatos: number;
  avisos: number;
}

/** Só o que a inferência de viagem lê de `logistic_allocations`. */
export interface LogisticAllocationLike {
  demand_id: string;
  transport_mode?: string | null;
  lodging_mode?: string | null;
  has_car?: boolean | null;
  has_hotel?: boolean | null;
}

/** Só o que a inferência de viagem lê de `logistic_blocks`. */
export interface LogisticBlockTravelLike {
  demand_id: string;
  block_type: string;
  transport_mode?: string | null;
  lodging_mode?: string | null;
}

export interface PendenciasContext {
  /** A aba de linhas do template (para achar a coluna do preço HH). */
  sheet: TemplateSheet;
  templateValues: TemplateValuesIndex;
  logisticAllocations: LogisticAllocationLike[];
  logisticBlocks: LogisticBlockTravelLike[];
  /** Chave da coluna manual do preço (default 'precoHH'). */
  precoColumnKey?: string;
}

const MODOS_VIAGEM = new Set(['CARRO_ALUGADO', 'CARRO_PROPRIO', 'TAXI', 'CARRO_APLICATIVO', 'OUTROS']);
const PRONTAS = new Set(['PRONTA_FATURAMENTO', 'FATURADA']);

const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** A logística registrada diz que houve deslocamento ou hospedagem? (inferência) */
export function logisticaIndicaViagem(
  demandId: string,
  allocations: LogisticAllocationLike[],
  blocks: LogisticBlockTravelLike[]
): boolean {
  const alloc = allocations.find(a => a.demand_id === demandId);
  if (alloc) {
    if (alloc.has_car === true || MODOS_VIAGEM.has(upper(alloc.transport_mode))) return true;
    if (alloc.has_hotel === true || upper(alloc.lodging_mode) === 'PRECISA_HOTEL') return true;
  }
  return blocks.some(
    b =>
      b.demand_id === demandId &&
      (MODOS_VIAGEM.has(upper(b.transport_mode)) || upper(b.lodging_mode) === 'PRECISA_HOTEL')
  );
}

const medicaoLabel = (status: string) =>
  MEDICAO_STATUS_OPTIONS.find(o => o.value === status)?.label ?? status;

export function buildPendencias(rows: MedicaoValeRow[], ctx: PendenciasContext): PendenciaRow[] {
  const precoKey = ctx.precoColumnKey ?? 'precoHH';
  const precoCol = (ctx.sheet.columns ?? []).find(c => c.key === precoKey);

  // ID SAP repetido: contado sobre o recorte recebido.
  const porIdSap = new Map<string, number>();
  for (const r of rows) {
    const id = r.input.clientDemandId;
    if (id) porIdSap.set(id, (porIdSap.get(id) ?? 0) + 1);
  }

  const out: PendenciaRow[] = [];
  for (const r of rows) {
    const p: Pendencia[] = [];

    // FATOS — vêm do dataset; a interna é decisão (fica fora), não defeito: aviso.
    for (const b of r.bloqueios) p.push({ tipo: r.interna && /interna/i.test(b) ? 'aviso' : 'fato', texto: b });

    // AVISOS
    if (!r.input.clientDemandId) p.push({ tipo: 'aviso', texto: 'Sem ID SAP / Pedido Cliente (célula B em branco)' });

    if (precoCol) {
      const preco = resolveManualValue(precoCol, r.refs, ctx.templateValues);
      if (preco.fonte === 'vazio') p.push({ tipo: 'aviso', texto: 'Sem preço unitário HH (célula H em branco)' });
    }

    if (!r.input.temMedicao || r.medicaoStatus === 'NAO_INICIADA') {
      p.push({ tipo: 'aviso', texto: r.input.temMedicao ? 'Medição não iniciada' : 'Sem medição aberta' });
    } else if (!PRONTAS.has(r.medicaoStatus)) {
      p.push({ tipo: 'aviso', texto: `Medição não pronta (${medicaoLabel(r.medicaoStatus)})` });
    }

    if (r.itensDespesa === 0 && logisticaIndicaViagem(r.demand.id, ctx.logisticAllocations, ctx.logisticBlocks)) {
      p.push({ tipo: 'aviso', texto: 'Logística indica viagem, mas não há despesa lançada (inferência)' });
    }

    if (r.naoReembolsavelExcluido > 0) {
      p.push({
        tipo: 'aviso',
        texto: `Item não reembolsável fora das colunas da Vale (R$ ${r.naoReembolsavelExcluido.toFixed(2).replace('.', ',')})`,
      });
    }

    const id = r.input.clientDemandId;
    if (id && (porIdSap.get(id) ?? 0) > 1) p.push({ tipo: 'aviso', texto: `ID SAP repetido em outra demanda do recorte (${id})` });

    if (p.length === 0) continue;
    out.push({
      demand: r.demand,
      medicaoStatus: r.medicaoStatus,
      origem: r,
      pendencias: p,
      fatos: p.filter(x => x.tipo === 'fato').length,
      avisos: p.filter(x => x.tipo === 'aviso').length,
    });
  }

  // Fatos primeiro, depois mais avisos, depois data.
  out.sort(
    (a, b) => b.fatos - a.fatos || b.avisos - a.avisos || a.origem.input.dataInicio.localeCompare(b.origem.input.dataInicio)
  );
  return out;
}

/**
 * Acrescenta avisos de outra origem (ex.: o BM — turma sem local, cabeçalho
 * não cadastrado, cadastro de treinamento duplicado) às pendências já
 * montadas, criando a linha da demanda quando ela não tinha nenhuma. Mantém a
 * ordem (fatos primeiro, depois mais avisos, depois data).
 */
export function mergePendencias(
  base: PendenciaRow[],
  extras: { row: MedicaoValeRow; pendencia: Pendencia }[]
): PendenciaRow[] {
  const porDemanda = new Map(base.map(p => [p.demand.id, { ...p, pendencias: [...p.pendencias] }]));
  for (const { row, pendencia } of extras) {
    const atual = porDemanda.get(row.demand.id) ?? {
      demand: row.demand,
      medicaoStatus: row.medicaoStatus,
      origem: row,
      pendencias: [],
      fatos: 0,
      avisos: 0,
    };
    if (!atual.pendencias.some(p => p.texto === pendencia.texto)) atual.pendencias.push(pendencia);
    porDemanda.set(row.demand.id, atual);
  }
  const out = [...porDemanda.values()].map(p => ({
    ...p,
    fatos: p.pendencias.filter(x => x.tipo === 'fato').length,
    avisos: p.pendencias.filter(x => x.tipo === 'aviso').length,
  }));
  out.sort(
    (a, b) => b.fatos - a.fatos || b.avisos - a.avisos || a.origem.input.dataInicio.localeCompare(b.origem.input.dataInicio)
  );
  return out;
}

/* ─────────────────────── export do painel pelo motor da F1 ─────────────────────── */

const col = (
  key: string,
  header: string,
  kind: ColumnDef<PendenciaRow>['kind'],
  get: ColumnDef<PendenciaRow>['get'],
  width?: number
): ColumnDef<PendenciaRow> => ({ key, header, kind, defaultOn: true, get, width });

export const PENDENCIAS_COLUMNS: ColumnDef<PendenciaRow>[] = [
  col('demandId', 'Demanda', 'text', r => r.demand.id, 12),
  col('idSap', 'ID SAP', 'text', r => r.origem.input.clientDemandId || null, 14),
  col('treinamento', 'Treinamento', 'text', r => r.origem.input.trainingName, 36),
  col('local', 'Local', 'text', r => r.origem.input.local, 18),
  col('corredor', 'Corredor', 'text', r => r.origem.input.corredor, 16),
  col('dataInicio', 'Data início', 'date', r => toBrDate(r.origem.input.dataInicio), 12),
  col('status', 'Status (calculado)', 'text', r => statusLabel(r.origem.statusCalculado), 16),
  col('medicao', 'Status da medição', 'text', r => (r.origem.input.temMedicao ? medicaoLabel(r.medicaoStatus ?? '') : 'Sem medição'), 22),
  col('consultor', 'Consultor', 'text', r => r.origem.input.titulares.join(' / '), 26),
  col('fatos', 'Bloqueios', 'number', r => r.fatos, 9),
  col('avisos', 'Avisos', 'number', r => r.avisos, 9),
  col('pendencias', 'Pendências', 'text', r => r.pendencias.map(p => `${p.tipo === 'fato' ? '⛔' : '⚠'} ${p.texto}`).join('\n'), 70),
];

export const PENDENCIAS_DATASET: DatasetDef<PendenciaRow> = {
  key: 'medicoes', // não entra no registry; é só o contrato de buildTable/xlsxWriter
  label: 'Pendências da medição',
  description: 'Demandas do recorte que não estão prontas para a medição, com o motivo.',
  requiredView: 'measurement',
  filters: ['corredor'],
  options: [],
  columns: PENDENCIAS_COLUMNS,
  fileBase: 'pendencias_medicao',
};
