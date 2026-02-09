import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

type TableName = 'demands' | 'agenda_items' | 'instructor_allocations' | 'resource_allocations' | 'companion_allocations';

interface UseRealtimeSyncOptions {
  /** Nome da tabela para monitorar */
  table: TableName;
  /** Callback chamado quando há mudança na tabela */
  onSync: () => Promise<void>;
  /** Se o sync está habilitado (depende de auth estar pronto) */
  enabled: boolean;
  /** Debounce em ms para evitar múltiplos syncs (default: 500ms) */
  debounceMs?: number;
}

/**
 * Hook para sincronização em tempo real via Supabase Realtime
 *
 * Monitora mudanças em uma tabela e executa callback de sync.
 * Usa debounce para evitar múltiplas chamadas quando várias mudanças
 * acontecem em sequência rápida.
 */
export function useRealtimeSync({
  table,
  onSync,
  enabled,
  debounceMs = 500
}: UseRealtimeSyncOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventRef = useRef<string>('');

  // Wrapper com debounce para o onSync
  const debouncedSync = useCallback(() => {
    // Limpa timeout anterior se existir
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      console.log(`[Realtime] Sincronizando ${table}...`);
      try {
        await onSync();
        console.log(`[Realtime] ${table} sincronizado com sucesso`);
      } catch (err) {
        console.error(`[Realtime] Erro ao sincronizar ${table}:`, err);
      }
    }, debounceMs);
  }, [table, onSync, debounceMs]);

  useEffect(() => {
    if (!enabled || !supabase) {
      // Cleanup se desabilitado
      if (channelRef.current && supabase) {
        console.log(`[Realtime] Removendo subscription de ${table}`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    // Cria canal único para esta tabela
    const channelName = `realtime-${table}-${Date.now()}`;
    console.log(`[Realtime] Criando subscription para ${table}`);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: table
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          // Evita processar o mesmo evento duas vezes
          const eventKey = `${payload.eventType}-${payload.new?.id || payload.old?.id}-${Date.now()}`;
          if (eventKey === lastEventRef.current) return;
          lastEventRef.current = eventKey;

          console.log(`[Realtime] ${table} ${payload.eventType}`, {
            new: payload.new?.id,
            old: payload.old?.id
          });

          // Chama sync com debounce
          debouncedSync();
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] ${table} subscription status:`, status);
      });

    channelRef.current = channel;

    // Cleanup
    return () => {
      console.log(`[Realtime] Cleanup subscription de ${table}`);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, enabled, debouncedSync]);
}

/**
 * Hook simplificado para múltiplas tabelas
 */
export function useMultiTableRealtimeSync(
  tables: Array<{ table: TableName; onSync: () => Promise<void> }>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !supabase) return;

    const channels: RealtimeChannel[] = [];
    const debounceTimers: Record<string, NodeJS.Timeout> = {};

    tables.forEach(({ table, onSync }) => {
      const channelName = `multi-realtime-${table}-${Date.now()}`;

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: table
          },
          () => {
            // Debounce por tabela
            if (debounceTimers[table]) {
              clearTimeout(debounceTimers[table]);
            }
            debounceTimers[table] = setTimeout(async () => {
              console.log(`[Realtime] Multi-sync: ${table}`);
              try {
                await onSync();
              } catch (err) {
                console.error(`[Realtime] Multi-sync error ${table}:`, err);
              }
            }, 500);
          }
        )
        .subscribe();

      channels.push(channel);
    });

    console.log(`[Realtime] Multi-table subscription ativa para: ${tables.map(t => t.table).join(', ')}`);

    return () => {
      Object.values(debounceTimers).forEach(clearTimeout);
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [tables, enabled]);
}
