/**
 * DATASET BM DA VALE — agregação por treinamento, um BM por (corredor, mina)
 *
 * Entrada: as turmas ELEGÍVEIS da Medição Vale para o mesmo filtro
 * (datasets/medicaoVale, `elegivelTurmas`), já recortadas pela tela por
 * período (data de início), corredor opcional, mina opcional, status da
 * medição e canceladas. Nada aqui refaz elegibilidade.
 *
 * Corredor: com um corredor no filtro, todas as turmas do recorte são dele
 * (a tela já filtrou) e sai um BM por mina. Com "Todos" (`corredor` vazio),
 * o corredor é lido de cada demanda e sai um BM por (corredor, mina); turma
 * com corredor vazio na demanda fica em `semCorredor` — fora do BM, com
 * aviso, como a turma sem local. O cabeçalho continua cadastrado por
 * corredor|mina (escopo 'context'), então nada muda no cadastro.
 *
 * Os números de cada turma NÃO são recalculados: vêm da MESMA resolução da
 * aba "Turmas Realizadas" (`resolveRowsSheet` do template vale-v1 com os
 * mesmos valores manuais) — carga horária, preço HH (com sobrescrita por
 * turma), despesas reembolsáveis J..N, combustível e % da turma. É isso que
 * faz Σ linhas 20 = Σ coluna I e quantidade da linha 70 = Σ coluna P por
 * construção.
 *
 * Agregação (decisão da rodada): chave = NOME do treinamento normalizado
 * (trim, caixa, acento) + preço efetivo. Mesmo nome e mesmo preço → uma linha
 * com as horas somadas, mesmo que os ids de cadastro difiram; preços
 * diferentes → linhas separadas. O BM sai limpo; o cadastro duplicado vira
 * aviso no painel (`nomesDuplicados`).
 *
 * Turma sem local (`trainingLocal` vazio) NÃO gera BM "sem local": fica em
 * `semLocal` para a tela mostrar em destaque e o painel avisar. Nunca
 * silencioso.
 */
import type { MeasurementTemplate } from '../templates/types';
import { VALE_TEMPLATE } from '../templates/vale';
import { VALE_BM_CONSTANTS } from '../templates/vale-bm';
import { resolveRowsSheet, type RegionRowInput } from '../templates/resolve';
import { contextKey, type TemplateValue, type TemplateValuesIndex } from '../templates/values';
import { toBrDate, round2 } from '../shared';
import { toRowsSheetInput, type MedicaoValeRow } from './medicaoVale';

export interface BmLinha {
  tipo: 'treinamento' | 'despesas';
  qqp: string;
  descricao: string;
  unidade: string | number;
  /** `null` = alguma turma sem preço HH (célula em branco e amarela). */
  preco: number | null;
  quantidade: number;
  /** Demandas que compõem a linha. */
  turmas: string[];
  trainingIds: string[];
}

export interface BmMina {
  corredor: string;
  mina: string;
  contextKey: string;
  /** Cadastro do cabeçalho desta mina (values.context), ou undefined na primeira vez. */
  contexto: Map<string, TemplateValue> | undefined;
  /** Campos do cabeçalho sem valor (só os que não têm default). */
  cabecalhoIncompleto: string[];
  turmas: MedicaoValeRow[];
  linhas: BmLinha[];
  /** Σ preço × quantidade das linhas de treinamento (preço em branco conta 0). */
  totalTreinamentos: number;
  /** Quantidade da linha de despesas (= Σ P das turmas). */
  totalDespesas: number;
}

export interface BmResult {
  /** Corredor do filtro, ou '' quando "Todos" (minas de vários corredores). */
  corredor: string;
  /** Corredores presentes em `minas`, na ordem em que aparecem (pt-BR). */
  corredores: string[];
  /** Ordenadas por corredor e depois mina. */
  minas: BmMina[];
  semLocal: MedicaoValeRow[];
  /** Só com "Todos": turmas com corredor vazio na demanda — fora do BM, nunca silencioso. */
  semCorredor: MedicaoValeRow[];
  nomesDuplicados: { nome: string; trainingIds: string[] }[];
}

export interface BuildBmOptions {
  /**
   * Corredor do filtro. Vazio/undefined = "Todos": um BM por (corredor, mina)
   * do recorte, corredor lido da demanda.
   */
  corredor?: string;
  /** Só esta mina (filtro de site). Vazio = todas as minas do recorte. */
  mina?: string;
}

/** Nome normalizado para agregar: trim, minúsculas, sem acento, espaços colapsados. */
export const normalizeTrainingName = (s: string): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const precoDe = (v: unknown): number | null =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

/** Os números de UMA turma, lidos da resolução da aba Turmas (mesma fonte do XLSX). */
export interface TurmaNumeros {
  demandId: string;
  trainingId: string;
  trainingName: string;
  cargaHoraria: number;
  preco: number | null;
  /** Σ J..N (locação, combustível, alimentação, hospedagem, outros). */
  despesas: number;
  pct: number;
  /** Coluna P: despesas × (1 + %). */
  p: number;
}

export function turmasNumeros(elegiveis: MedicaoValeRow[], values: TemplateValuesIndex): TurmaNumeros[] {
  const turmasSheet = VALE_TEMPLATE.sheets[0];
  const resolved = resolveRowsSheet(turmasSheet, toRowsSheetInput(elegiveis), values);
  const idx = (key: string) => resolved.columns.findIndex(c => c.key === key);
  const iCarga = idx('cargaHoraria');
  const iPreco = idx('precoHH');
  const iDesp = ['locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros'].map(idx);
  const iPct = idx('pctDespesa');
  const soElegiveis = elegiveis.filter(r => r.elegivelTurmas);

  return resolved.rows.map((cells, i) => {
    const r = soElegiveis[i];
    const despesas = iDesp.reduce((acc, j) => acc + num(cells[j].value), 0);
    const pct = num(cells[iPct].value);
    return {
      demandId: r.demand.id,
      trainingId: r.trainingId,
      trainingName: r.input.trainingName,
      cargaHoraria: num(cells[iCarga].value),
      preco: precoDe(cells[iPreco].value),
      despesas: round2(despesas),
      pct,
      p: round2(despesas + despesas * pct),
    };
  });
}

export function buildBm(
  elegiveis: MedicaoValeRow[],
  values: TemplateValuesIndex,
  template: MeasurementTemplate,
  opts: BuildBmOptions
): BmResult {
  const c = { ...VALE_BM_CONSTANTS, ...(template.constants ?? {}) } as typeof VALE_BM_CONSTANTS;
  const numeros = new Map(turmasNumeros(elegiveis, values).map(n => [n.demandId, n]));

  // Nomes duplicados (ids diferentes, mesmo nome) — aviso, não muda o BM.
  const idsPorNome = new Map<string, Set<string>>();
  for (const r of elegiveis) {
    if (!r.elegivelTurmas || !r.trainingId) continue;
    const k = normalizeTrainingName(r.input.trainingName);
    const s = idsPorNome.get(k) ?? new Set<string>();
    s.add(r.trainingId);
    idsPorNome.set(k, s);
  }
  const nomesDuplicados = [...idsPorNome.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([nome, ids]) => ({ nome, trainingIds: [...ids].sort() }));

  const corredorFiltro = (opts.corredor ?? '').trim();
  const todos = corredorFiltro === '';
  const semLocal: MedicaoValeRow[] = [];
  const semCorredor: MedicaoValeRow[] = [];
  const grupos = new Map<string, { corredor: string; mina: string; turmas: MedicaoValeRow[] }>();
  for (const r of elegiveis) {
    if (!r.elegivelTurmas) continue;
    const mina = r.input.local.trim();
    if (!mina) {
      semLocal.push(r);
      continue;
    }
    if (opts.mina && mina !== opts.mina.trim()) continue;
    const corredor = todos ? String(r.input.corredor ?? '').trim() : corredorFiltro;
    if (!corredor) {
      semCorredor.push(r);
      continue;
    }
    const key = contextKey(corredor, mina);
    const g = grupos.get(key) ?? { corredor, mina, turmas: [] };
    g.turmas.push(r);
    grupos.set(key, g);
  }

  const semDefault = new Set((template.contextFields ?? []).filter(f => f.defaultValue === undefined).map(f => f.key));

  const minas: BmMina[] = [...grupos.values()]
    .sort((a, b) => a.corredor.localeCompare(b.corredor, 'pt-BR') || a.mina.localeCompare(b.mina, 'pt-BR'))
    .map(({ corredor, mina, turmas }) => {
      const key = contextKey(corredor, mina);
      const contexto = values.context.get(key);
      const ctxValor = (k: string): string | number | null => {
        const v = contexto?.get(k);
        return v === undefined || v === null || v === '' ? null : v;
      };
      const qqpTreinamento = String(ctxValor('qqpTreinamento') ?? c.qqpTreinamento);
      const qqpDespesas = String(ctxValor('qqpDespesas') ?? c.qqpDespesas);

      // Agregação por nome normalizado + preço efetivo.
      const grupos = new Map<string, BmLinha>();
      let totalDespesas = 0;
      for (const t of turmas) {
        const n = numeros.get(t.demand.id)!;
        const chave = `${normalizeTrainingName(n.trainingName)}|${n.preco === null ? '' : n.preco}`;
        const g = grupos.get(chave) ?? {
          tipo: 'treinamento' as const,
          qqp: qqpTreinamento,
          descricao: `${c.prefixoTreinamento}${n.trainingName.trim()}`,
          unidade: c.unidadeTreinamento,
          preco: n.preco,
          quantidade: 0,
          turmas: [],
          trainingIds: [],
        };
        g.quantidade = round2(g.quantidade + n.cargaHoraria);
        g.turmas.push(n.demandId);
        if (!g.trainingIds.includes(n.trainingId)) g.trainingIds.push(n.trainingId);
        grupos.set(chave, g);
        totalDespesas = round2(totalDespesas + (c.despesasComAcrescimo ? n.p : n.despesas));
      }
      const linhasTreino = [...grupos.values()].sort(
        (a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR') || (a.preco ?? -1) - (b.preco ?? -1)
      );
      const linhas: BmLinha[] = [
        ...linhasTreino,
        {
          tipo: 'despesas',
          qqp: qqpDespesas,
          descricao: c.descricaoDespesas,
          unidade: c.unidadeDespesas,
          preco: c.precoDespesas,
          quantidade: totalDespesas,
          turmas: turmas.map(t => t.demand.id),
          trainingIds: [],
        },
      ];
      const totalTreinamentos = round2(linhasTreino.reduce((acc, l) => acc + (l.preco ?? 0) * l.quantidade, 0));
      const cabecalhoIncompleto = [...semDefault].filter(k => ctxValor(k) === null);

      return { corredor, mina, contextKey: key, contexto, cabecalhoIncompleto, turmas, linhas, totalTreinamentos, totalDespesas };
    });

  const corredores = [...new Set(minas.map(m => m.corredor))];
  return { corredor: corredorFiltro, corredores, minas, semLocal, semCorredor, nomesDuplicados };
}

/** As linhas de uma mina no formato da região da folha form. */
export function bmRegionRows(mina: BmMina): RegionRowInput[] {
  return mina.linhas.map(l => ({
    qqp: l.qqp,
    descricao: l.descricao,
    unidade: l.unidade,
    preco: l.preco,
    quantidade: l.quantidade,
  }));
}

/** 'dd/mm/yyyy a dd/mm/yyyy'; sem período, ''. */
export function periodoLabel(dataInicio: string, dataFim: string): string {
  if (!dataInicio && !dataFim) return '';
  return `${dataInicio ? toBrDate(dataInicio) : '…'} a ${dataFim ? toBrDate(dataFim) : '…'}`;
}

/** Trecho seguro para nome de arquivo: sem acento, minúsculas, '-' entre palavras. */
export const slug = (s: string): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sem-nome';

const periodoSlug = (dataInicio: string, dataFim: string) =>
  dataInicio || dataFim ? `${dataInicio || 'inicio'}_${dataFim || 'fim'}` : 'todo-periodo';

export function bmFileName(template: MeasurementTemplate, corredor: string, mina: string, dataInicio: string, dataFim: string): string {
  return `${template.fileNameBase}-${slug(corredor)}-${slug(mina)}-${periodoSlug(dataInicio, dataFim)}.xlsx`;
}

/** Nome do zip: por corredor, ou `-todos-` quando o corredor do filtro é "Todos". */
export function bmZipName(template: MeasurementTemplate, corredor: string, dataInicio: string, dataFim: string): string {
  const trecho = String(corredor ?? '').trim() ? slug(corredor) : 'todos';
  return `${template.fileNameBase}-${trecho}-${periodoSlug(dataInicio, dataFim)}.zip`;
}

/**
 * Caminho de um BM dentro do zip. Com "Todos" (`pastaPorCorredor`), uma pasta
 * por corredor (slug) e, dentro dela, o MESMO nome de arquivo de sempre
 * (`bmFileName`); sem, o arquivo na raiz, como o zip de um corredor só.
 */
export function bmZipEntryName(
  template: MeasurementTemplate,
  mina: Pick<BmMina, 'corredor' | 'mina'>,
  dataInicio: string,
  dataFim: string,
  pastaPorCorredor: boolean
): string {
  const arquivo = bmFileName(template, mina.corredor, mina.mina, dataInicio, dataFim);
  return pastaPorCorredor ? `${slug(mina.corredor)}/${arquivo}` : arquivo;
}
