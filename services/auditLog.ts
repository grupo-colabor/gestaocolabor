import { supabase } from '../lib/supabase';

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
export async function logAction(params: LogActionParams): Promise<void> {
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
    const { data, error } = await supabase.from('audit_logs').insert({
      id: entry.id,
      created_at: entry.created_at,
      user_id: entry.user_id ?? null,
      user_name: entry.user_name,
      modulo: entry.modulo,
      acao: entry.acao,
      descricao: entry.descricao,
      dados_antes: entry.dados_antes ?? null,
      dados_depois: entry.dados_depois ?? null,
    }).select();

    if (error) {
      // [DIAGNÓSTICO] — remover após confirmar
      console.error('[auditLog] INSERT falhou:', error.code, error.message, error.details);
      saveToLocalStorage(entry);
    } else {
      // [DIAGNÓSTICO] — remover após confirmar
      console.log('[auditLog] INSERT ok:', data);
    }
  } catch (e) {
    // [DIAGNÓSTICO] — remover após confirmar
    console.error('[auditLog] CATCH inesperado:', e);
    saveToLocalStorage(entry);
  }
}

/* --------------------------------------------------
   fetchAuditLogs — leitura dos registros
   Somente leitura: sem update/delete expostos.
-------------------------------------------------- */
export async function fetchAuditLogs(): Promise<AuditLog[]> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!error && data) {
      return data as AuditLog[];
    }
  } catch {
    // fall through para localStorage
  }

  return getLogsFromLocalStorage();
}
