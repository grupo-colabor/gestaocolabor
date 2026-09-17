/**
 * MODELOS DE EXPORTAÇÃO SALVOS — regras puras (migration 021, `export_presets`)
 *
 * Um MODELO é a escolha que o usuário faz na aba Exportações, com nome:
 *   dataset + filtros + colunas ligadas (na ordem) + opções marcáveis.
 *
 * Decisões (17/09/2026):
 *   • O PERÍODO NUNCA ENTRA NO MODELO. `buildPresetConfig` descarta
 *     dataInicio/dataFim e `applyPreset` preserva o período que está na tela.
 *     Um modelo com período fixo envelheceria; "último mês fechado" é
 *     seguimento (V1.1).
 *   • V1 só para datasets de TABELA (os que têm colunas). Medição Vale e BM
 *     guardam filtros em outro componente; entram quando esse estado subir.
 *   • Coluna que deixou de existir: aplica o que existe e AVISA (a UI de
 *     colunas ignora chave desconhecida em silêncio; o modelo não herda isso).
 *     Filtro ou opção desconhecidos: idem. Config ilegível: defaults + aviso,
 *     nunca exceção — um modelo velho não pode travar a aba.
 *   • Um modelo PADRÃO por (usuário, módulo), aplicado ao abrir o módulo.
 *     Marcar um novo padrão desmarca o anterior ANTES de gravar, porque o
 *     banco tem índice único parcial (021) e recusaria dois.
 *   • Nome: 1..80 após trim, único por módulo sem diferenciar caixa.
 *
 * O acesso ao banco entra por INJEÇÃO (`PresetGateway`), como o
 * `TemplateValueGateway` dos valores manuais: as orquestrações (salvar,
 * renomear, excluir, definir padrão) rodam no smoke com um gateway em memória
 * e no app com o de services/exports/presets.ts. Sem import de React,
 * Supabase ou ExcelJS.
 */
import { DEFAULT_OPTIONS, type ExportOptions } from './options';
import { EMPTY_FILTERS, type DatasetDef, type ExportFilters, type FilterableRow } from './types';
import { defaultColumnKeys } from './buildRows';

export const PRESET_CONFIG_VERSION = 1 as const;
export const PRESET_NAME_MAX = 80;

/** Filtros SEM o período — o que o modelo guarda. */
export type PresetFilters = Omit<ExportFilters, 'dataInicio' | 'dataFim'>;

export interface PresetConfig {
  v: typeof PRESET_CONFIG_VERSION;
  filters: Partial<PresetFilters>;
  options: Partial<ExportOptions>;
  /** Chaves das colunas ligadas, na ordem de saída. */
  columns: string[];
}

export interface ExportPreset {
  id: string;
  datasetId: string;
  name: string;
  config: PresetConfig;
  isDefault: boolean;
  updatedAt?: string;
}

export interface NewPreset {
  datasetId: string;
  name: string;
  config: PresetConfig;
  isDefault: boolean;
}

export type PresetPatch = Partial<Pick<ExportPreset, 'name' | 'config' | 'isDefault'>>;

/** A porta para o banco. Cada método lança em erro de banco; `list` vazio é lista vazia, não erro. */
export interface PresetGateway {
  list(): Promise<ExportPreset[]>;
  insert(p: NewPreset): Promise<ExportPreset>;
  update(id: string, patch: PresetPatch): Promise<ExportPreset>;
  remove(id: string): Promise<void>;
}

/* ─────────────────────────── config ─────────────────────────── */

/** O que a tela tem agora → o que o modelo guarda (sem período). */
export function buildPresetConfig(filters: ExportFilters, options: ExportOptions, columns: string[]): PresetConfig {
  const { dataInicio: _di, dataFim: _df, ...semPeriodo } = filters;
  void _di; void _df;
  return {
    v: PRESET_CONFIG_VERSION,
    filters: { ...semPeriodo, statusMedicao: [...(semPeriodo.statusMedicao ?? [])] },
    options: { ...options },
    columns: [...columns],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface AppliedPreset {
  filters: ExportFilters;
  options: ExportOptions;
  columns: string[];
  /** O que foi ignorado ou substituído — a tela mostra em banner amarelo. */
  avisos: string[];
}

/**
 * Aplica um `config` (jsonb do banco, tratado como desconhecido) ao dataset,
 * preservando o período da tela. Nunca lança: o pior caso é "tudo default"
 * com avisos.
 */
export function applyPreset<Row extends FilterableRow>(
  dataset: DatasetDef<Row>,
  config: unknown,
  atual: { filters: ExportFilters; options: ExportOptions }
): AppliedPreset {
  const avisos: string[] = [];
  const c = isRecord(config) ? config : {};
  if (!isRecord(config)) avisos.push('Modelo sem conteúdo legível; aplicadas as colunas e opções padrão.');

  // Colunas: só as que existem, na ordem gravada, sem repetição.
  const conhecidas = new Set(dataset.columns.map(col => col.key));
  const gravadas = Array.isArray(c.columns) ? c.columns.filter((k): k is string => typeof k === 'string') : [];
  const columns: string[] = [];
  const desconhecidas: string[] = [];
  for (const k of gravadas) {
    if (!conhecidas.has(k)) { if (!desconhecidas.includes(k)) desconhecidas.push(k); continue; }
    if (!columns.includes(k)) columns.push(k);
  }
  if (desconhecidas.length > 0) {
    avisos.push(`Coluna(s) que não existe(m) mais em ${dataset.label}: ${desconhecidas.join(', ')} — ignorada(s).`);
  }
  if (columns.length === 0) {
    columns.push(...defaultColumnKeys(dataset));
    avisos.push(gravadas.length > 0 ? 'Nenhuma coluna do modelo existe mais; usando as colunas padrão.' : 'Modelo sem colunas; usando as colunas padrão.');
  }

  // Filtros: os campos conhecidos com o tipo certo; o período fica o da tela.
  const filters: ExportFilters = { ...EMPTY_FILTERS, dataInicio: atual.filters.dataInicio, dataFim: atual.filters.dataFim };
  const f = isRecord(c.filters) ? c.filters : {};
  const filtrosDesconhecidos: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'dataInicio' || k === 'dataFim') {
      if (v) avisos.push('O período nunca vem do modelo; mantido o período da tela.');
      continue;
    }
    if (!(k in EMPTY_FILTERS)) { filtrosDesconhecidos.push(k); continue; }
    const esperado = (EMPTY_FILTERS as unknown as Record<string, unknown>)[k];
    if (Array.isArray(esperado)) {
      if (Array.isArray(v)) (filters as unknown as Record<string, unknown>)[k] = v.filter(x => typeof x === 'string');
      else filtrosDesconhecidos.push(k);
    } else if (typeof v === typeof esperado) {
      (filters as unknown as Record<string, unknown>)[k] = v;
    } else {
      filtrosDesconhecidos.push(k);
    }
  }
  if (filtrosDesconhecidos.length > 0) avisos.push(`Filtro(s) do modelo ignorado(s) (desconhecido ou inválido): ${filtrosDesconhecidos.join(', ')}.`);

  // Opções: booleanos conhecidos; o resto é default.
  const options: ExportOptions = { ...DEFAULT_OPTIONS };
  const o = isRecord(c.options) ? c.options : {};
  const opcoesDesconhecidas: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k in DEFAULT_OPTIONS && typeof v === 'boolean') (options as unknown as Record<string, boolean>)[k] = v;
    else opcoesDesconhecidas.push(k);
  }
  if (opcoesDesconhecidas.length > 0) avisos.push(`Opção(ões) do modelo ignorada(s): ${opcoesDesconhecidas.join(', ')}.`);

  return { filters, options, columns, avisos };
}

/* ─────────────────────────── nome ─────────────────────────── */

export const normalizePresetName = (name: string): string => String(name ?? '').replace(/\s+/g, ' ').trim();

/**
 * Mensagem de erro, ou `null` quando o nome serve. `outros` são os modelos do
 * MESMO módulo; `selfId` exclui o próprio ao renomear.
 */
export function validatePresetName(name: string, outros: { id: string; name: string }[], selfId?: string): string | null {
  const n = normalizePresetName(name);
  if (!n) return 'Dê um nome ao modelo.';
  if (n.length > PRESET_NAME_MAX) return `Nome com mais de ${PRESET_NAME_MAX} caracteres.`;
  const igual = outros.some(p => p.id !== selfId && normalizePresetName(p.name).toLowerCase() === n.toLowerCase());
  if (igual) return 'Já existe um modelo com esse nome neste módulo.';
  return null;
}

/* ─────────────────────────── seleção ─────────────────────────── */

/** Modelos de um módulo, por nome. */
export const presetsOf = (presets: ExportPreset[], datasetId: string): ExportPreset[] =>
  presets.filter(p => p.datasetId === datasetId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

/** Modelo cujo módulo o perfil não vê (`requiredView`) não aparece. */
export const visiblePresets = (presets: ExportPreset[], datasetsVisiveis: Set<string>): ExportPreset[] =>
  presets.filter(p => datasetsVisiveis.has(p.datasetId));

export const defaultPresetOf = (presets: ExportPreset[], datasetId: string): ExportPreset | undefined =>
  presets.find(p => p.datasetId === datasetId && p.isDefault);

/* ─────────────────────────── ações ─────────────────────────── */

const substitui = (presets: ExportPreset[], p: ExportPreset): ExportPreset[] =>
  presets.some(x => x.id === p.id) ? presets.map(x => (x.id === p.id ? p : x)) : [...presets, p];

/** Desmarca o padrão atual do módulo (se houver e não for `exceto`) — antes de gravar outro. */
async function limparPadrao(gw: PresetGateway, presets: ExportPreset[], datasetId: string, exceto?: string): Promise<ExportPreset[]> {
  let lista = presets;
  for (const p of presets) {
    if (p.datasetId === datasetId && p.isDefault && p.id !== exceto) {
      lista = substitui(lista, await gw.update(p.id, { isDefault: false }));
    }
  }
  return lista;
}

export async function salvarModelo(gw: PresetGateway, presets: ExportPreset[], novo: NewPreset): Promise<{ presets: ExportPreset[]; salvo: ExportPreset }> {
  const name = normalizePresetName(novo.name);
  const erro = validatePresetName(name, presetsOf(presets, novo.datasetId));
  if (erro) throw new Error(erro);
  let lista = presets;
  if (novo.isDefault) lista = await limparPadrao(gw, lista, novo.datasetId);
  const salvo = await gw.insert({ ...novo, name });
  return { presets: substitui(lista, salvo), salvo };
}

export async function renomearModelo(gw: PresetGateway, presets: ExportPreset[], id: string, nome: string): Promise<ExportPreset[]> {
  const atual = presets.find(p => p.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');
  const name = normalizePresetName(nome);
  const erro = validatePresetName(name, presetsOf(presets, atual.datasetId), id);
  if (erro) throw new Error(erro);
  return substitui(presets, await gw.update(id, { name }));
}

export async function excluirModelo(gw: PresetGateway, presets: ExportPreset[], id: string): Promise<ExportPreset[]> {
  if (!presets.some(p => p.id === id)) throw new Error('Modelo não encontrado.');
  await gw.remove(id);
  return presets.filter(p => p.id !== id);
}

export async function definirPadrao(gw: PresetGateway, presets: ExportPreset[], id: string, isDefault: boolean): Promise<ExportPreset[]> {
  const atual = presets.find(p => p.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');
  let lista = presets;
  if (isDefault) lista = await limparPadrao(gw, lista, atual.datasetId, id);
  return substitui(lista, await gw.update(id, { isDefault }));
}

/** Regrava o conteúdo de um modelo existente com o que está na tela. */
export async function atualizarModelo(gw: PresetGateway, presets: ExportPreset[], id: string, config: PresetConfig): Promise<ExportPreset[]> {
  if (!presets.some(p => p.id === id)) throw new Error('Modelo não encontrado.');
  return substitui(presets, await gw.update(id, { config }));
}

/* ─────────────────────── gateway em memória (smoke) ─────────────────────── */

/**
 * Gateway em memória com as MESMAS recusas do banco (nome único por módulo,
 * um padrão por módulo, linha inexistente), para os smokes exercitarem as
 * orquestrações sem cliente de banco.
 */
export function createMemoryPresetGateway(seed: ExportPreset[] = []): PresetGateway & { rows: ExportPreset[]; chamadas: string[] } {
  const rows: ExportPreset[] = seed.map(p => ({ ...p }));
  const chamadas: string[] = [];
  let seq = rows.length;
  const clone = (p: ExportPreset): ExportPreset => ({ ...p, config: JSON.parse(JSON.stringify(p.config)) });
  const checar = (candidato: ExportPreset) => {
    if (rows.some(r => r.id !== candidato.id && r.datasetId === candidato.datasetId && r.name === candidato.name)) {
      throw new Error('duplicate key value violates unique constraint "export_presets_uq"');
    }
    if (candidato.isDefault && rows.some(r => r.id !== candidato.id && r.datasetId === candidato.datasetId && r.isDefault)) {
      throw new Error('duplicate key value violates unique constraint "export_presets_default_uq"');
    }
  };
  return {
    rows,
    chamadas,
    async list() { chamadas.push('list'); return rows.map(clone); },
    async insert(p) {
      chamadas.push(`insert:${p.name}`);
      const novo: ExportPreset = { id: `p${++seq}`, datasetId: p.datasetId, name: p.name, config: p.config, isDefault: p.isDefault, updatedAt: new Date().toISOString() };
      checar(novo);
      rows.push(clone(novo));
      return clone(novo);
    },
    async update(id, patch) {
      chamadas.push(`update:${id}:${Object.keys(patch).join(',')}`);
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) throw new Error('Modelo não encontrado ou sem permissão (RLS).');
      const novo: ExportPreset = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
      checar(novo);
      rows[i] = clone(novo);
      return clone(novo);
    },
    async remove(id) {
      chamadas.push(`remove:${id}`);
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) throw new Error('Modelo não encontrado ou sem permissão (RLS).');
      rows.splice(i, 1);
    },
  };
}
