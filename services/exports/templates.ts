/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — `measurement_templates` (migration 022), I/O
 *
 * O gateway Supabase do domínio (domain/exports/templates/store.ts,
 * `TemplateStoreGateway`). Mesmo contrato dos irmãos
 * (services/exports/presets.ts, templateValues.ts):
 *
 *   • Leitura: TUDO, paginado via `fetchAllPaginated`. Tabela vazia é
 *     resultado legítimo, não erro. Erro de banco PROPAGA — a tela mostra
 *     banner e bloqueia, nunca "nenhum modelo cadastrado" por falha.
 *   • Escrita: `updated_at` explícito (este repositório não tem trigger, de
 *     propósito). Endurecido como os irmãos: se o banco devolver ZERO linhas
 *     num update/delete, é RLS filtrando em silêncio — lança, nunca finge que
 *     gravou.
 *   • O nome da EMPRESA vem de um join com `companies`, porque é ele que vira
 *     o rótulo do módulo ("Medição Gerdau"). Empresa sem nome legível não
 *     derruba a linha: o modelo aparece com o id, e o domínio avisa.
 *
 * TROCAR O MODELO ATIVO É UMA CHAMADA SÓ
 * ---------------------------------------------------------------------------
 * `setActive` chama a FUNÇÃO `set_active_measurement_template` (seção 5 da
 * 022) por RPC, não dois UPDATEs. Pelo PostgREST, "desativa o antigo" e "ativa
 * o novo" seriam duas requisições, e entre elas a empresa ficaria SEM modelo
 * ativo — o módulo dela sumiria da aba; se a segunda falhasse, ficaria assim.
 * A função roda inteira numa transação: as duas linhas mudam juntas ou nenhuma
 * muda, e nenhuma outra sessão enxerga zero ativos nem dois.
 *
 * Se a função não existir (022 não aplicada), o erro é EXPLÍCITO e diz o que
 * fazer. Não há fallback para as duas chamadas: um fallback silencioso
 * reintroduziria exatamente a janela que a função existe para fechar.
 *
 * AS COLUNAS `sheet_name`, `header_row` E `first_data_row` SÃO DERIVADAS
 * ---------------------------------------------------------------------------
 * A fonte do mapeamento é o `mapping jsonb`. Essas três colunas existem para
 * dar para consultar um modelo sem abrir o json, e são escritas A PARTIR do
 * mapeamento, na mesma operação — nunca sozinhas. Por isso `salvarMapeamento`
 * passa pelo `derivarColunas` daqui.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPaginated } from '../pagination';
import { parseTemplateMapping } from '../../domain/exports/templates/mapping';
import type { TemplateRecord } from '../../domain/exports/templates/mapping';
import type {
  ModeloPatch,
  NovoModelo,
  TemplateStoreGateway,
} from '../../domain/exports/templates/store';

export const MEASUREMENT_TEMPLATES_BUCKET = 'measurement-templates';

export interface MeasurementTemplateRow {
  id: string;
  company_id: string;
  name: string;
  storage_bucket: string | null;
  storage_path: string | null;
  sheet_name: string | null;
  header_row: number | null;
  first_data_row: number | null;
  mapping: unknown;
  base_fingerprint: unknown;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  /**
   * Do join. O PostgREST devolve OBJETO quando reconhece a relação como
   * muitos-para-um e ARRAY quando não reconhece (FK recém-criada, cache de
   * schema velho). As duas formas são aceitas aqui de propósito: o rótulo do
   * módulo não pode depender de qual delas veio.
   */
  companies?: CompanyJoin | CompanyJoin[] | null;
}

interface CompanyJoin {
  id?: string | null;
  name?: string | null;
  razao_social?: string | null;
}

const SELECT_FIELDS = `
  id, company_id, name, storage_bucket, storage_path, sheet_name, header_row,
  first_data_row, mapping, base_fingerprint, is_active, created_at, updated_at,
  created_by, companies ( id, name, razao_social )
`;

/** Mesmo rótulo do resto do app: `name`, senão `razao_social`. */
export function companyNameOf(row: MeasurementTemplateRow): string {
  const c = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return String(c?.name || c?.razao_social || '').trim();
}

export function mapMeasurementTemplate(row: MeasurementTemplateRow): TemplateRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: companyNameOf(row),
    name: row.name ?? '',
    storageBucket: row.storage_bucket ?? undefined,
    storagePath: row.storage_path ?? undefined,
    sheetName: row.sheet_name,
    headerRow: row.header_row,
    firstDataRow: row.first_data_row,
    mapping: row.mapping ?? {},
    baseFingerprint: row.base_fingerprint ?? undefined,
    isActive: row.is_active === true,
  };
}

/* ─────────────────────────────── leitura ─────────────────────────────── */

export async function fetchMeasurementTemplates(companyId?: string): Promise<TemplateRecord[]> {
  const rows = await fetchAllPaginated<MeasurementTemplateRow>((from, to) => {
    let q = supabase
      .from('measurement_templates')
      .select(SELECT_FIELDS)
      .order('company_id', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (companyId) q = q.eq('company_id', companyId);
    return q as any;
  });
  return rows.map(mapMeasurementTemplate);
}

/**
 * Só os ativos — o que a Fase 4 usa para montar os módulos da aba. Filtrado no
 * BANCO (e não em memória) porque o índice parcial da 022 o atende, e porque
 * uma instalação com muitos modelos históricos não precisa trafegar todos.
 */
export async function fetchActiveMeasurementTemplates(): Promise<TemplateRecord[]> {
  const rows = await fetchAllPaginated<MeasurementTemplateRow>((from, to) =>
    supabase
      .from('measurement_templates')
      .select(SELECT_FIELDS)
      .eq('is_active', true)
      .order('company_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as any
  );
  return rows.map(mapMeasurementTemplate);
}

/* ─────────────────────────────── escrita ─────────────────────────────── */

function umaLinha(data: unknown, acao: string): MeasurementTemplateRow {
  const row = ((data ?? []) as MeasurementTemplateRow[])[0];
  if (!row) {
    throw new Error(
      `Modelo não ${acao}: o banco não devolveu a linha — não existe ou não há permissão (RLS).`
    );
  }
  return row;
}

export async function insertMeasurementTemplate(n: NovoModelo): Promise<TemplateRecord> {
  const { data, error } = await supabase
    .from('measurement_templates')
    .insert({ company_id: n.companyId, name: n.name })
    .select(SELECT_FIELDS);
  if (error) {
    console.error('[measurement_templates] insert error', error);
    throw error;
  }
  return mapMeasurementTemplate(umaLinha(data, 'criado'));
}

/**
 * `sheet_name`, `header_row` e `first_data_row` a partir do mapeamento — ver o
 * cabeçalho. Quando o patch não traz mapeamento, as colunas não são tocadas.
 */
function derivarColunas(patch: ModeloPatch): Record<string, unknown> {
  if (patch.mapping === undefined) return {};
  const { mapping } = parseTemplateMapping(patch.mapping);
  return {
    sheet_name: mapping.sheetName || null,
    header_row: mapping.headerRow,
    first_data_row: mapping.firstDataRow,
  };
}

export async function updateMeasurementTemplate(id: string, patch: ModeloPatch): Promise<TemplateRecord> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.mapping !== undefined) {
    payload.mapping = patch.mapping;
    Object.assign(payload, derivarColunas(patch));
  }
  // Um patch pode sobrescrever a derivação de propósito (duplicar copia a
  // linha inteira); por isso estes vêm DEPOIS.
  if (patch.sheetName !== undefined) payload.sheet_name = patch.sheetName;
  if (patch.headerRow !== undefined) payload.header_row = patch.headerRow;
  if (patch.firstDataRow !== undefined) payload.first_data_row = patch.firstDataRow;
  if (patch.storageBucket !== undefined) payload.storage_bucket = patch.storageBucket;
  if (patch.storagePath !== undefined) payload.storage_path = patch.storagePath;
  if (patch.baseFingerprint !== undefined) payload.base_fingerprint = patch.baseFingerprint;

  const { data, error } = await supabase
    .from('measurement_templates')
    .update(payload)
    .eq('id', id)
    .select(SELECT_FIELDS);
  if (error) {
    console.error('[measurement_templates] update error', error);
    throw error;
  }
  return mapMeasurementTemplate(umaLinha(data, 'atualizado'));
}

/** Ver o cabeçalho: uma transação, sem janela, sem fallback. */
export async function setActiveMeasurementTemplate(id: string): Promise<TemplateRecord> {
  const { data, error } = await supabase.rpc('set_active_measurement_template', { p_id: id });
  if (error) {
    console.error('[measurement_templates] setActive error', error);
    if (/set_active_measurement_template/i.test(error.message ?? '') && /does not exist|not find|schema cache/i.test(error.message ?? '')) {
      throw new Error(
        'A troca do modelo ativo depende da migration 022, que ainda não foi aplicada neste banco. Aplique-a antes de ativar modelos.'
      );
    }
    throw error;
  }
  // A função devolve a linha da tabela (sem o join); relê para trazer a empresa.
  const row = (Array.isArray(data) ? data[0] : data) as MeasurementTemplateRow | null;
  if (!row?.id) throw new Error('Modelo não ativado: o banco não devolveu a linha — verifique permissões (RLS).');
  const recarregado = await fetchMeasurementTemplateById(row.id);
  if (!recarregado) throw new Error('Modelo ativado, mas não foi possível relê-lo.');
  return recarregado;
}

export async function fetchMeasurementTemplateById(id: string): Promise<TemplateRecord | null> {
  const { data, error } = await supabase.from('measurement_templates').select(SELECT_FIELDS).eq('id', id);
  if (error) {
    console.error('[measurement_templates] fetchById error', error);
    throw error;
  }
  const row = ((data ?? []) as MeasurementTemplateRow[])[0];
  return row ? mapMeasurementTemplate(row) : null;
}

export async function deactivateMeasurementTemplate(id: string): Promise<TemplateRecord> {
  const { data, error } = await supabase
    .from('measurement_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT_FIELDS);
  if (error) {
    console.error('[measurement_templates] deactivate error', error);
    throw error;
  }
  return mapMeasurementTemplate(umaLinha(data, 'desativado'));
}

export async function deleteMeasurementTemplate(id: string): Promise<void> {
  const { data, error } = await supabase.from('measurement_templates').delete().eq('id', id).select('id');
  if (error) {
    console.error('[measurement_templates] delete error', error);
    throw error;
  }
  if ((data ?? []).length === 0) {
    throw new Error('Modelo não excluído: nenhuma linha afetada — não existe ou não há permissão (RLS).');
  }
}

export const supabaseTemplateStoreGateway: TemplateStoreGateway = {
  list: fetchMeasurementTemplates,
  insert: insertMeasurementTemplate,
  update: updateMeasurementTemplate,
  setActive: setActiveMeasurementTemplate,
  deactivate: deactivateMeasurementTemplate,
  remove: deleteMeasurementTemplate,
};

/* ───────────────────── exclusão: registro + arquivo-base ───────────────────── */

/**
 * Exclui o modelo e, quando o arquivo-base é só dele, remove o objeto do
 * Storage.
 *
 * ORDEM: REGISTRO PRIMEIRO, ARQUIVO DEPOIS. E o porquê, que é o que importa —
 * uma das duas etapas vai falhar algum dia:
 *
 *   • registro apagado e arquivo sobrando  = lixo no bucket. Custa alguns KB,
 *     não aparece para ninguém, e a mensagem diz onde ele ficou para quem
 *     quiser limpar depois. Recuperável a qualquer momento.
 *   • arquivo apagado e registro sobrando  = um modelo que a tela LISTA, que a
 *     empresa pode ter como ATIVO, e que estoura na hora de gerar a medição —
 *     possivelmente no fechamento do mês. Estado ambíguo, e o pior dos dois.
 *
 * Então a ordem escolhida é a que falha do lado barato. É a mesma lógica do
 * `deleteDemandDocumentsByDemandId` invertida de propósito: lá os arquivos são
 * do registro e saem antes; aqui o arquivo pode ser COMPARTILHADO com um
 * modelo duplicado, e é o domínio (`planejarExclusao`) que decide se ele pode
 * sair — por isso a decisão vem de fora, já tomada.
 *
 * Falha na remoção do arquivo NÃO é engolida: sobe com o caminho, para ficar
 * registrado que o modelo saiu e o arquivo não.
 */
export async function excluirTemplateComArquivo(
  id: string,
  arquivo: { bucket: string | null; path: string | null },
  removerArquivo: (bucket: string, path: string) => Promise<void>
): Promise<void> {
  await deleteMeasurementTemplate(id);
  if (arquivo.path && arquivo.bucket) {
    await removerArquivo(arquivo.bucket, arquivo.path);
  }
}
