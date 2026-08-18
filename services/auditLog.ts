import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

export type AuditModulo =
  | 'Demandas'
  | 'Agendamento'
  | 'Programação'
  | 'Medição'
  | 'Evidências';

export type AuditAcao =
  | 'Criar'
  | 'Editar'
  | 'Cancelar'
  | 'Confirmar'
  | 'Registrar'
  | 'Enviar'
  | 'Aprovar'
  | 'Reprovar'
  | 'Reativar';

export interface AuditLog {
  id: string;
  created_at: string;
  user_id?: string;
  user_name: string;
  modulo: AuditModulo;
  acao: AuditAcao;
  descricao: string;
  dados_antes?: unknown;
  dados_depois?: unknown;
  demanda_excluida?: boolean;
}

export interface LogActionParams {
  modulo: AuditModulo;
  acao: AuditAcao;
  descricao: string;
  dadosAntes?: unknown;
  dadosDepois?: unknown;
}

/**
 * Resultado de logAction.
 *
 * Falha de auditoria NUNCA aborta a operação de negócio que a originou —
 * mas também não pode ser silenciosa. Callers que queiram avisar o usuário
 * devem dar `await` e checar `ok`; os que não derem seguem funcionando como
 * fire-and-forget (o erro ainda vai pro console e o registro pro localStorage).
 */
export interface LogActionResult {
  ok: boolean;
  error?: unknown;
}

/* --------------------------------------------------
   Fallback: localStorage
-------------------------------------------------- */
const STORAGE_KEY = 'colabor_audit_logs';

function saveToLocalStorage(entry: AuditLog): void {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AuditLog[];
    existing.unshift(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 1000)));
  } catch {
    // storage cheio ou indisponível — ignorar silenciosamente
  }
}

function getLogsFromLocalStorage(): AuditLog[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AuditLog[];
  } catch {
    return [];
  }
}

/* --------------------------------------------------
   Cache de perfil (evita round-trips repetidos)
-------------------------------------------------- */
let _cachedUser: { id: string; name: string } | null = null;

async function resolveCurrentUser(): Promise<{ id: string; name: string }> {
  if (_cachedUser) return _cachedUser;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return { id: '', name: 'Usuário desconhecido' };

    const userId = session.user.id;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const name =
      profileData?.full_name ||
      profileData?.email ||
      session.user.email ||
      'Usuário desconhecido';

    _cachedUser = { id: userId, name };
    return _cachedUser;
  } catch {
    return { id: '', name: 'Usuário desconhecido' };
  }
}

// Invalida cache ao trocar de sessão
supabase.auth.onAuthStateChange(() => {
  _cachedUser = null;
});

const generateId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

/* --------------------------------------------------
   logAction — principal ponto de entrada
   Registros são somente leitura: sem update/delete.
-------------------------------------------------- */
export async function logAction(params: LogActionParams): Promise<LogActionResult> {
  const { modulo, acao, descricao, dadosAntes, dadosDepois } = params;

  const currentUser = await resolveCurrentUser();

  const entry: AuditLog = {
    id: generateId(),
    created_at: new Date().toISOString(),
    user_id: currentUser.id || undefined,
    user_name: currentUser.name,
    modulo,
    acao,
    descricao,
    dados_antes: dadosAntes,
    dados_depois: dadosDepois,
  };

  // Tenta persistir no Supabase; em caso de falha, usa localStorage
  try {
    const { error } = await supabase.from('audit_logs').insert({
      id: entry.id,
      created_at: entry.created_at,
      user_id: entry.user_id ?? null,
      user_name: entry.user_name,
      modulo: entry.modulo,
      acao: entry.acao,
      descricao: entry.descricao,
      dados_antes: entry.dados_antes ?? null,
      dados_depois: entry.dados_depois ?? null,
    });

    if (error) {
      console.error('[auditLog] INSERT falhou:', error.code, error.message, error.details);
      saveToLocalStorage(entry);
      return { ok: false, error };
    }

    return { ok: true };
  } catch (e) {
    console.error('[auditLog] exceção ao gravar:', e);
    saveToLocalStorage(entry);
    return { ok: false, error: e };
  }
}

/* --------------------------------------------------
   fetchAuditLogs — leitura dos registros
   Somente leitura: sem update/delete expostos.

   Pagina via fetchAllPaginated. O `.limit(500)` anterior escondia toda a
   cauda da trilha: o PostgREST ainda corta em ~1000 linhas por padrão, e
   com o backfill de criação retroativa (migration 010) os eventos antigos
   ficariam todos fora da janela mais recente — invisíveis na tela.

   O desempate por `id` é necessário porque `created_at` vem do cliente e
   repete entre registros do backfill; sem ele a paginação pode duplicar
   ou pular linhas na fronteira das páginas.
-------------------------------------------------- */
export async function fetchAuditLogs(): Promise<AuditLog[]> {
  try {
    return await fetchAllPaginated<AuditLog>((from, to) =>
      supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    );
  } catch (error) {
    console.error('fetchAuditLogs error:', error);
    return getLogsFromLocalStorage();
  }
}
