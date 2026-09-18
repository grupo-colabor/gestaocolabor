/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — orquestrações (puro)
 *
 * O que acontece ao criar, duplicar, ativar e excluir um modelo, SEM banco e
 * SEM storage. O acesso entra por INJEÇÃO (`TemplateStoreGateway`), como o
 * `PresetGateway` dos modelos de exportação (domain/exports/presets.ts) e o
 * `TemplateValueGateway` dos valores manuais: o smoke roda tudo com um
 * gateway em memória, o app com o de services/exports/templates.ts.
 *
 * DUAS REGRAS QUE MORAM AQUI, E NÃO NA TELA:
 *
 *   1. UM ATIVO POR EMPRESA, SEM JANELA. `ativarModelo` é UMA chamada ao
 *      gateway (`setActive`), nunca "desativa um, depois ativa outro" — pelo
 *      PostgREST isso seriam duas requisições, e entre elas a empresa ficaria
 *      SEM modelo ativo (o módulo dela sumiria da aba). No banco quem garante
 *      é a função `set_active_measurement_template` (migration 022), que faz
 *      as duas coisas numa transação. Aqui a regra é: o domínio nunca oferece
 *      o caminho de duas etapas.
 *
 *   2. REGISTRO INVÁLIDO NÃO DERRUBA A LISTA. Um modelo cujo `mapping` está
 *      ilegível ou aponta para campo que o app perdeu entra na lista COM
 *      aviso, para a tela poder mostrar "este modelo precisa de conserto".
 *      Sumir com ele esconderia o defeito de quem pode consertá-lo, e lançar
 *      tiraria do ar os modelos sadios das outras empresas junto.
 */
import {
  templateFromRecord,
  type BuiltTemplate,
  type TemplateRecord,
} from './mapping';
import type { MeasurementTemplate } from './types';
import { bloqueiosDe, validarTemplate } from './validate';

/** Um modelo carregado: o template pronto mais o que houve de errado ao ler. */
export interface LoadedTemplate {
  record: TemplateRecord;
  template: MeasurementTemplate;
  /** Vazio = mapeamento íntegro. Não vazio = a tela mostra "precisa de conserto". */
  avisos: string[];
}

export const modeloPrecisaConserto = (m: LoadedTemplate): boolean => m.avisos.length > 0;

/** Um modelo sem arquivo-base existe, mas não gera planilha nenhuma. */
export const modeloTemArquivo = (m: LoadedTemplate): boolean => !!m.record.storagePath;

/** Modelo pronto para virar módulo na aba: ativo, com arquivo e sem defeito. */
export const modeloUtilizavel = (m: LoadedTemplate): boolean =>
  m.record.isActive && modeloTemArquivo(m) && !modeloPrecisaConserto(m);

export interface NovoModelo {
  companyId: string;
  companyName: string;
  name: string;
}

export interface ModeloPatch {
  name?: string;
  mapping?: unknown;
  sheetName?: string | null;
  headerRow?: number | null;
  firstDataRow?: number | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  baseFingerprint?: unknown;
}

/**
 * A porta para o banco. Cada método lança em erro; `list` vazio é lista vazia,
 * não erro. `setActive` é UMA operação de propósito — ver a regra 1.
 */
export interface TemplateStoreGateway {
  /** Todos os modelos, ou só os de uma empresa. */
  list(companyId?: string): Promise<TemplateRecord[]>;
  insert(n: NovoModelo): Promise<TemplateRecord>;
  update(id: string, patch: ModeloPatch): Promise<TemplateRecord>;
  /** Ativa este e desativa o anterior da mesma empresa, ATOMICAMENTE. */
  setActive(id: string): Promise<TemplateRecord>;
  /** Desativa sem ativar outro — a empresa fica sem módulo, e é intencional. */
  deactivate(id: string): Promise<TemplateRecord>;
  remove(id: string): Promise<void>;
}

export const NOME_MAX = 120;

/** Nome válido: 1..120 após trim. Devolve o motivo, ou null quando serve. */
export function problemaNoNome(nome: string): string | null {
  const limpo = (nome ?? '').trim();
  if (!limpo) return 'Dê um nome ao modelo.';
  if (limpo.length > NOME_MAX) return `O nome do modelo passa de ${NOME_MAX} caracteres.`;
  return null;
}

/** Nome já usado na empresa? A comparação é a do índice: sem caixa, sem pontas. */
export function nomeRepetido(nome: string, existentes: TemplateRecord[], ignorarId?: string): boolean {
  const alvo = (nome ?? '').trim().toLowerCase();
  return existentes.some(r => r.id !== ignorarId && r.name.trim().toLowerCase() === alvo);
}

/**
 * "Orçamento 2027" -> "Orçamento 2027 (cópia)" -> "… (cópia 2)".
 *
 * O índice único por (empresa, nome normalizado) da 022 recusaria a cópia com
 * o mesmo nome; em vez de devolver um erro de banco cru para quem clicou em
 * "Duplicar", o nome novo sai pronto daqui.
 */
export function nomeDaCopia(original: string, existentes: TemplateRecord[]): string {
  const base = (original ?? '').trim() || 'Modelo';
  let candidato = `${base} (cópia)`;
  let n = 2;
  while (nomeRepetido(candidato, existentes)) {
    candidato = `${base} (cópia ${n})`;
    n += 1;
  }
  // O banco corta em 120; corta aqui também, para o erro não vir de lá.
  return candidato.length > NOME_MAX ? candidato.slice(0, NOME_MAX).trim() : candidato;
}

/* ─────────────────────────────── leitura ─────────────────────────────── */

/**
 * Registros do banco -> modelos carregados. Um registro inválido vira
 * `LoadedTemplate` com avisos; nunca some da lista e nunca derruba os outros.
 */
export function loadTemplates(records: TemplateRecord[]): LoadedTemplate[] {
  return records.map(record => {
    let built: BuiltTemplate;
    try {
      built = templateFromRecord(record);
    } catch (e: any) {
      // `templateFromRecord` não lança por desenho (mapping.ts). Se um dia
      // lançar, a lista continua de pé e o modelo aparece como quebrado — o
      // contrário de "a aba inteira não abre por causa de um registro".
      return {
        record,
        template: {
          id: `tpl:${record.id}`,
          version: 1,
          origin: 'db',
          label: `Medição ${record.companyName}`.trim(),
          company: { id: record.companyId },
          fileNameBase: 'medicao',
          sheets: [],
        },
        avisos: [`Não foi possível ler a configuração deste modelo: ${e?.message || e}`],
      };
    }
    const avisos = [...built.avisos];
    if (!record.storagePath) {
      avisos.push('Este modelo ainda não tem planilha-base enviada — envie o arquivo do cliente antes de gerar a medição.');
    }
    return { record, template: built.template, avisos };
  });
}

/** O modelo ativo de cada empresa, indexado por `companyId`. */
export function activeByCompany(modelos: LoadedTemplate[]): Map<string, LoadedTemplate> {
  const out = new Map<string, LoadedTemplate>();
  for (const m of modelos) {
    if (!m.record.isActive) continue;
    out.set(m.record.companyId, m);
  }
  return out;
}

/* ───────────────────────────── orquestrações ───────────────────────────── */

export interface StoreResult {
  modelos: LoadedTemplate[];
  /** Uma frase para a notificação da tela. */
  mensagem: string;
}

const recarregar = async (g: TemplateStoreGateway, companyId?: string): Promise<LoadedTemplate[]> =>
  loadTemplates(await g.list(companyId));

export async function listarModelos(g: TemplateStoreGateway, companyId?: string): Promise<LoadedTemplate[]> {
  return recarregar(g, companyId);
}

/** Só os que a aba pode oferecer como módulo — a Fase 4 consome isto. */
export async function listarModelosAtivos(g: TemplateStoreGateway): Promise<LoadedTemplate[]> {
  return (await recarregar(g)).filter(m => m.record.isActive);
}

export async function criarModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  novo: NovoModelo
): Promise<StoreResult> {
  const problema = problemaNoNome(novo.name);
  if (problema) throw new Error(problema);
  const nome = novo.name.trim();
  const daEmpresa = atuais.filter(r => r.companyId === novo.companyId);
  if (nomeRepetido(nome, daEmpresa)) {
    throw new Error(`Já existe um modelo chamado "${nome}" em ${novo.companyName}.`);
  }
  await g.insert({ ...novo, name: nome });
  return { modelos: await recarregar(g, novo.companyId), mensagem: `Modelo "${nome}" criado.` };
}

export async function renomearModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string,
  nome: string
): Promise<StoreResult> {
  const problema = problemaNoNome(nome);
  if (problema) throw new Error(problema);
  const atual = atuais.find(r => r.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');
  const limpo = nome.trim();
  const daEmpresa = atuais.filter(r => r.companyId === atual.companyId);
  if (nomeRepetido(limpo, daEmpresa, id)) {
    throw new Error(`Já existe um modelo chamado "${limpo}" em ${atual.companyName}.`);
  }
  await g.update(id, { name: limpo });
  return { modelos: await recarregar(g, atual.companyId), mensagem: 'Modelo renomeado.' };
}

/**
 * O que impede ESTE mapeamento de ser salvo. Lista vazia = pode gravar.
 *
 * A validação roda no SALVAR, não só no gerar: um modelo que já nasce com uma
 * conta apontando para coluna apagada seria gravado, viraria módulo e só
 * quebraria semanas depois, no fechamento — quando quem o configurou não está
 * mais com o assunto na cabeça. Barrar na hora custa um banner.
 */
export function bloqueiosParaSalvar(rec: TemplateRecord): string[] {
  const { template } = templateFromRecord(rec);
  return bloqueiosDe(validarTemplate(template)).map(p => p.texto);
}

export async function salvarMapeamento(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string,
  patch: ModeloPatch
): Promise<StoreResult> {
  const atual = atuais.find(r => r.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');

  // Valida o que SERIA gravado, não o que está no banco.
  const bloqueios = bloqueiosParaSalvar({ ...atual, ...patchToRecord(atual, patch) });
  if (bloqueios.length > 0) {
    throw new Error(
      `O mapeamento não pode ser salvo assim:\n• ${bloqueios.join('\n• ')}`
    );
  }

  await g.update(id, patch);
  return { modelos: await recarregar(g, atual.companyId), mensagem: 'Mapeamento salvo.' };
}

/** O patch aplicado sobre o registro, sem gravar — para validar antes. */
function patchToRecord(atual: TemplateRecord, patch: ModeloPatch): Partial<TemplateRecord> {
  const out: Partial<TemplateRecord> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.mapping !== undefined) out.mapping = patch.mapping;
  if (patch.sheetName !== undefined) out.sheetName = patch.sheetName;
  if (patch.headerRow !== undefined) out.headerRow = patch.headerRow;
  if (patch.firstDataRow !== undefined) out.firstDataRow = patch.firstDataRow;
  if (patch.storageBucket !== undefined) out.storageBucket = patch.storageBucket ?? undefined;
  if (patch.storagePath !== undefined) out.storagePath = patch.storagePath ?? undefined;
  if (patch.baseFingerprint !== undefined) out.baseFingerprint = patch.baseFingerprint;
  void atual;
  return out;
}

/**
 * Duplicar: mesmo mapeamento, mesmo arquivo-base, nome novo e SEMPRE inativo.
 *
 * Inativo de propósito: duplicar é para experimentar uma mudança sem mexer no
 * modelo que está medindo o mês. Se a cópia nascesse ativa, ela tomaria o
 * lugar do original no instante do clique.
 */
export async function duplicarModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string
): Promise<StoreResult> {
  const origem = atuais.find(r => r.id === id);
  if (!origem) throw new Error('Modelo não encontrado.');
  const daEmpresa = atuais.filter(r => r.companyId === origem.companyId);
  const nome = nomeDaCopia(origem.name, daEmpresa);

  const criado = await g.insert({ companyId: origem.companyId, companyName: origem.companyName, name: nome });
  // O arquivo-base é COMPARTILHADO com o original de propósito: são a mesma
  // planilha do cliente, e copiar o arquivo no storage criaria dois objetos
  // que envelhecem separados. Quem excluir um modelo compartilhado NÃO apaga
  // o arquivo — ver `podeApagarArquivo`.
  await g.update(criado.id, {
    mapping: origem.mapping,
    sheetName: origem.sheetName ?? null,
    headerRow: origem.headerRow ?? null,
    firstDataRow: origem.firstDataRow ?? null,
    storageBucket: origem.storageBucket ?? null,
    storagePath: origem.storagePath ?? null,
    baseFingerprint: origem.baseFingerprint,
  });
  await g.deactivate(criado.id);

  return { modelos: await recarregar(g, origem.companyId), mensagem: `Modelo duplicado como "${nome}".` };
}

/**
 * Ativar: UMA chamada ao gateway. Ver a regra 1 do cabeçalho — o domínio não
 * oferece o caminho de duas etapas nem por engano.
 */
export async function ativarModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string
): Promise<StoreResult> {
  const atual = atuais.find(r => r.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');
  await g.setActive(id);
  return {
    modelos: await recarregar(g, atual.companyId),
    mensagem: `"${atual.name}" é o modelo de medição de ${atual.companyName}.`,
  };
}

/**
 * Desativar sem ativar outro: a empresa fica SEM módulo de medição. É uma
 * escolha legítima (parar de usar aquele cliente), então não se inventa um
 * substituto — mas a mensagem diz o que aconteceu, para ninguém descobrir
 * pela ausência.
 */
export async function desativarModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string
): Promise<StoreResult> {
  const atual = atuais.find(r => r.id === id);
  if (!atual) throw new Error('Modelo não encontrado.');
  await g.deactivate(id);
  return {
    modelos: await recarregar(g, atual.companyId),
    mensagem: `"${atual.name}" desativado. ${atual.companyName} fica sem módulo de medição até outro modelo ser ativado.`,
  };
}

/**
 * O arquivo-base deste modelo pode ser apagado do storage ao excluí-lo?
 *
 * Não, quando OUTRO modelo aponta para o mesmo caminho — é o caso de um modelo
 * duplicado. Apagar o objeto deixaria o irmão apontando para o vazio.
 */
export function podeApagarArquivo(alvo: TemplateRecord, todos: TemplateRecord[]): boolean {
  if (!alvo.storagePath) return false;
  return !todos.some(r => r.id !== alvo.id && r.storagePath === alvo.storagePath);
}

export interface ExclusaoPlano {
  /** Caminho a remover do storage, ou null quando o arquivo é compartilhado. */
  storagePath: string | null;
  storageBucket: string | null;
}

/**
 * O que excluir um modelo implica. A ORDEM de execução (registro primeiro,
 * arquivo depois) está no serviço — ver services/exports/templates.ts.
 */
export function planejarExclusao(alvo: TemplateRecord, todos: TemplateRecord[]): ExclusaoPlano {
  return podeApagarArquivo(alvo, todos)
    ? { storagePath: alvo.storagePath ?? null, storageBucket: alvo.storageBucket ?? null }
    : { storagePath: null, storageBucket: null };
}

export async function excluirModelo(
  g: TemplateStoreGateway,
  atuais: TemplateRecord[],
  id: string,
  apagarArquivo?: (bucket: string, path: string) => Promise<void>
): Promise<StoreResult> {
  const alvo = atuais.find(r => r.id === id);
  if (!alvo) throw new Error('Modelo não encontrado.');
  const plano = planejarExclusao(alvo, atuais);

  // REGISTRO PRIMEIRO, ARQUIVO DEPOIS — ver o comentário no serviço.
  await g.remove(id);
  if (plano.storagePath && plano.storageBucket && apagarArquivo) {
    await apagarArquivo(plano.storageBucket, plano.storagePath);
  }

  return { modelos: await recarregar(g, alvo.companyId), mensagem: `Modelo "${alvo.name}" excluído.` };
}
