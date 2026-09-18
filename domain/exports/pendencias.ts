/**
 * PAINEL "O QUE FALTA PARA FECHAR A MEDIÇÃO" — checagens (puro)
 *
 * Para cada demanda da empresa do template no recorte da tela, lista o que
 * a impede de entrar na medição ou o que merece olhar antes de gerar.
 *
 *   FATO  — bloqueia a linha na aba Turmas (vem do dataset, `bloqueios`):
 *           não concluída, cancelada, sem instrutor titular. Desde 18/09/2026,
 *           também os defeitos de CONFIGURAÇÃO do modelo (`avaliarConfiguracao`),
 *           que travam a geração inteira.
 *   AVISO — a linha sai, o painel avisa:
 *           identificador do cliente em branco, coluna digitada obrigatória
 *           vazia, sem medição iniciada, medição não pronta, viagem sem
 *           despesa lançada (INFERÊNCIA), item não reembolsável excluído,
 *           identificador repetido em outra demanda do recorte, interna com a
 *           empresa do modelo (fora da aba, por decisão; avisada aqui).
 *
 * As sete checagens são LISTA FECHADA (`TemplateCheckKey`): um modelo do banco
 * escolhe quais aplicar, nunca inventa uma nova. O default são as aplicáveis
 * ao mapeamento — sem coluna de identificador do cliente, as duas que falam
 * dele não entram.
 *
 * Os TEXTOS são derivados do template (cabeçalho da coluna, letra da posição,
 * rótulo do modelo) para os modelos do BANCO; o template em CÓDIGO mantém os
 * rótulos históricos, e o porquê está em `NOMES_HISTORICOS`, abaixo.
 *
 * De onde vem cada checagem está no código de cada uma. A única inferência é
 * "viagem sem despesa": logística com carro (alugado, próprio, táxi,
 * aplicativo, outros) ou hotel — em `logistic_allocations` (a linha do
 * Controle Logístico) ou em qualquer bloco de `logistic_blocks` — e nenhum
 * item de despesa na medição. É aviso, nunca bloqueio.
 */
import type { MedicaoValeRow } from './datasets/medicaoVale';
import { columnLetter, resolveManualValue } from './templates/resolve';
import { SOURCE_FIELDS, isSourceField } from './templates/sourceFields';
import type { MeasurementTemplate, TemplateColumn, TemplateSheet } from './templates/types';
import { validarTemplate, type ValidacaoDeModelo } from './templates/validate';
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

/**
 * As sete checagens que este painel faz. Lista FECHADA: um modelo do banco
 * escolhe quais aplicar, não inventa checagem nova.
 */
export type TemplateCheckKey =
  /** Célula do identificador do cliente em branco. */
  | 'semIdCliente'
  /** Coluna digitada e obrigatória (destacada quando vazia) sem valor. */
  | 'semValorManual'
  /** Demanda sem medição aberta, ou com a medição não iniciada. */
  | 'semMedicao'
  /** Medição aberta, mas ainda não pronta para faturar. */
  | 'medicaoNaoPronta'
  /** Logística indica viagem e não há despesa lançada (inferência). */
  | 'viagemSemDespesa'
  /** Item marcado como não reembolsável ficou fora das colunas. */
  | 'naoReembolsavelExcluido'
  /** O mesmo identificador do cliente em duas demandas do recorte. */
  | 'idClienteRepetido';

export const TEMPLATE_CHECKS: TemplateCheckKey[] = [
  'semIdCliente',
  'semValorManual',
  'semMedicao',
  'medicaoNaoPronta',
  'viagemSemDespesa',
  'naoReembolsavelExcluido',
  'idClienteRepetido',
];

/**
 * As checagens que fazem sentido PARA ESTE MAPEAMENTO. Sem coluna ligada ao
 * identificador do cliente, as duas que falam dele simplesmente não entram —
 * avisar "sem ID" num modelo que não tem essa coluna seria ruído.
 */
export function checksAplicaveis(sheet: TemplateSheet): TemplateCheckKey[] {
  const temIdCliente = (sheet.columns ?? []).some(c => c.source === 'demand.clientDemandId');
  return TEMPLATE_CHECKS.filter(k =>
    temIdCliente || (k !== 'semIdCliente' && k !== 'idClienteRepetido')
  );
}

export interface PendenciasContext {
  /** A aba de linhas do template. */
  sheet: TemplateSheet;
  templateValues: TemplateValuesIndex;
  logisticAllocations: LogisticAllocationLike[];
  logisticBlocks: LogisticBlockTravelLike[];
  /**
   * Chave da coluna manual obrigatória. Ausente = todas as colunas digitadas
   * marcadas como "destacar quando vazia" (na Vale, exatamente o preço HH).
   */
  precoColumnKey?: string;
  /**
   * O template dono. Ausente = comportamento histórico (ver `NOMES_HISTORICOS`).
   * Presente e do BANCO: os textos nomeiam as colunas pelo cabeçalho do arquivo
   * do cliente e a letra vem da posição real.
   */
  template?: MeasurementTemplate;
  /** Só estas checagens. Ausente = as aplicáveis ao mapeamento. */
  checks?: TemplateCheckKey[];
}

/**
 * ⚠️ POR QUE OS TEXTOS DA VALE SÃO PRESERVADOS LITERALMENTE
 * ---------------------------------------------------------------------------
 * A regra desta fase é nomear a coluna pelo CABEÇALHO do arquivo do cliente e
 * tirar a letra da posição resolvida — é o certo para um modelo que a operação
 * configurou, porque é o nome que a pessoa vê na planilha dela.
 *
 * Aplicada à Vale, essa regra MUDARIA os três textos:
 *   'Sem ID SAP / Pedido Cliente (célula B…)' -> 'Sem ID da Turma (célula B…)'
 *      (o texto de hoje usa o rótulo do CATÁLOGO, não o cabeçalho 'ID da Turma')
 *   'Sem preço unitário HH (célula H…)'       -> 'Sem Preço unitário HH (…)'
 *      (o cabeçalho tem P maiúsculo)
 *   '…fora das colunas da Vale'               -> '…fora das colunas de Medição Vale'
 *
 * ISTO É CONGELAMENTO DELIBERADO, NÃO O PADRÃO PARA MODELO NOVO. Um modelo
 * configurado pela operação usa a derivação — cabeçalho e letra da posição — e
 * é assim que ele deve ser. O que está congelado aqui é só o texto da Vale.
 *
 * A Vale está gerando a medição real do mês e o smoke dela prende esses textos
 * caractere a caractere. Então a derivação vale para os modelos do BANCO, e o
 * template em CÓDIGO mantém os rótulos históricos. Não é exceção escondida: é
 * este bloco, e trocar é apagar `NOMES_HISTORICOS` e a linha que o consulta —
 * momento em que o smoke da Vale precisa ser atualizado junto, de propósito.
 */
const NOMES_HISTORICOS = {
  /** No aviso de célula em branco. */
  idCliente: 'ID SAP / Pedido Cliente',
  /** No aviso de repetição, onde o texto de hoje é mais curto. */
  idClienteCurto: 'ID SAP',
  valorManual: 'preço unitário HH',
  colunas: 'da Vale',
} as const;

/** A letra da coluna na ordem atual do template ('A', 'B', … 'AA'). */
function letraDaColuna(sheet: TemplateSheet, key: string): string | null {
  const i = (sheet.columns ?? []).findIndex(c => c.key === key);
  return i < 0 ? null : columnLetter(i);
}

/** "(célula H em branco)", ou "(em branco)" quando a coluna não está na aba. */
function sufixoCelula(sheet: TemplateSheet, key: string): string {
  const letra = letraDaColuna(sheet, key);
  return letra ? ` (célula ${letra} em branco)` : ' (em branco)';
}

/**
 * Como a pendência CHAMA a coluna: o cabeçalho do arquivo do cliente para
 * modelo do banco; o rótulo histórico para template em código (ver acima).
 */
function nomeDaColuna(ctx: PendenciasContext, col: TemplateColumn | undefined, historico: string): string {
  if (ctx.template?.origin !== 'db') return historico;
  if (!col) return historico;
  if (col.header) return col.header;
  return isSourceField(col.source) ? SOURCE_FIELDS[col.source].label : col.key;
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
  const colunas = ctx.sheet.columns ?? [];
  const liga = new Set<TemplateCheckKey>(ctx.checks ?? checksAplicaveis(ctx.sheet));
  const on = (k: TemplateCheckKey) => liga.has(k);

  /**
   * As colunas DIGITADAS e obrigatórias — as que o template marcou para
   * destacar quando saem vazias. Com `precoColumnKey` explícito, só ela.
   * Na Vale isso dá exatamente o preço HH, que é o que o painel sempre olhou.
   */
  const manuaisObrigatorias: TemplateColumn[] = ctx.precoColumnKey
    ? colunas.filter(c => c.key === ctx.precoColumnKey)
    : colunas.filter(c => c.source === 'manual' && c.highlightWhenEmpty);

  /** A coluna do identificador do cliente, quando o mapeamento tem uma. */
  const idClienteCol = colunas.find(c => c.source === 'demand.clientDemandId');

  const nomeIdCliente = nomeDaColuna(ctx, idClienteCol, NOMES_HISTORICOS.idCliente);
  const nomeIdCurto = nomeDaColuna(ctx, idClienteCol, NOMES_HISTORICOS.idClienteCurto);
  const nomeDasColunas = ctx.template?.origin === 'db' ? `de ${ctx.template.label}` : NOMES_HISTORICOS.colunas;

  // Identificador do cliente repetido: contado sobre o recorte recebido.
  const porIdCliente = new Map<string, number>();
  for (const r of rows) {
    const id = r.input.clientDemandId;
    if (id) porIdCliente.set(id, (porIdCliente.get(id) ?? 0) + 1);
  }

  const out: PendenciaRow[] = [];
  for (const r of rows) {
    const p: Pendencia[] = [];

    // FATOS — vêm do dataset; a interna é decisão (fica fora), não defeito: aviso.
    for (const b of r.bloqueios) p.push({ tipo: r.interna && /interna/i.test(b) ? 'aviso' : 'fato', texto: b });

    // AVISOS
    if (on('semIdCliente') && !r.input.clientDemandId) {
      const sufixo = idClienteCol ? sufixoCelula(ctx.sheet, idClienteCol.key) : ' (em branco)';
      p.push({ tipo: 'aviso', texto: `Sem ${nomeIdCliente}${sufixo}` });
    }

    if (on('semValorManual')) {
      for (const col of manuaisObrigatorias) {
        const valor = resolveManualValue(col, r.refs, ctx.templateValues);
        if (valor.fonte !== 'vazio') continue;
        const nome = nomeDaColuna(ctx, col, NOMES_HISTORICOS.valorManual);
        p.push({ tipo: 'aviso', texto: `Sem ${nome}${sufixoCelula(ctx.sheet, col.key)}` });
      }
    }

    if (!r.input.temMedicao || r.medicaoStatus === 'NAO_INICIADA') {
      if (on('semMedicao')) {
        p.push({ tipo: 'aviso', texto: r.input.temMedicao ? 'Medição não iniciada' : 'Sem medição aberta' });
      }
    } else if (!PRONTAS.has(r.medicaoStatus) && on('medicaoNaoPronta')) {
      p.push({ tipo: 'aviso', texto: `Medição não pronta (${medicaoLabel(r.medicaoStatus)})` });
    }

    if (on('viagemSemDespesa') && r.itensDespesa === 0 && logisticaIndicaViagem(r.demand.id, ctx.logisticAllocations, ctx.logisticBlocks)) {
      p.push({ tipo: 'aviso', texto: 'Logística indica viagem, mas não há despesa lançada (inferência)' });
    }

    if (on('naoReembolsavelExcluido') && r.naoReembolsavelExcluido > 0) {
      p.push({
        tipo: 'aviso',
        texto: `Item não reembolsável fora das colunas ${nomeDasColunas} (R$ ${r.naoReembolsavelExcluido.toFixed(2).replace('.', ',')})`,
      });
    }

    const id = r.input.clientDemandId;
    if (on('idClienteRepetido') && id && (porIdCliente.get(id) ?? 0) > 1) {
      p.push({ tipo: 'aviso', texto: `${nomeIdCurto} repetido em outra demanda do recorte (${id})` });
    }

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

/* ───────────────── bloqueios de CONFIGURAÇÃO do modelo ───────────────── */

/**
 * Os defeitos do MODELO, não das demandas: coluna ligada a campo que o app
 * perdeu, conta sobre coluna removida, valor fixo não declarado, total órfão.
 *
 * São FATOS, não avisos: cada um produziria célula errada ou vazia numa
 * planilha que vai para o cliente. Enquanto houver um, `podeGerar` é falso e a
 * tela trava o botão — o modelo não pode aparecer funcionando e falhar na
 * geração.
 *
 * Não são por demanda: aparecem UMA vez, no topo do painel, porque o defeito é
 * do modelo e repeti-lo por turma esconderia as pendências de verdade.
 */
export interface ConfiguracaoDoModelo {
  pendencias: Pendencia[];
  /** Falso enquanto houver bloqueio. */
  podeGerar: boolean;
  /** A validação crua, para quem quiser a severidade e a coluna. */
  validacao: ValidacaoDeModelo;
}

export function avaliarConfiguracao(template: MeasurementTemplate): ConfiguracaoDoModelo {
  const validacao = validarTemplate(template);
  return {
    pendencias: validacao.problemas.map(p => ({
      tipo: p.severidade === 'bloqueio' ? 'fato' : 'aviso',
      texto: p.texto,
    })),
    podeGerar: validacao.podeGerar,
    validacao,
  };
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
