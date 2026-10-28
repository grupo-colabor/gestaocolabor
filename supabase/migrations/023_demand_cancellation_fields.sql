-- =====================================================================
-- 023 — CANCELAMENTO DE DEMANDA: data, observação e status anterior
--
-- Contexto: cancelar passou a valer em QUALQUER status (NOVA, ALOCADA,
-- EM ANDAMENTO, CONCLUÍDA) e a reativação virou o inverso exato do
-- cancelamento. Até aqui só `cancel_reason` persistia: a data e a observação
-- do modal viviam só em memória (sumiam no F5) e não havia para onde voltar.
--
--   cancelled_at          instante do cancelamento (o app grava ISO/UTC)
--   cancel_note           observação livre do modal (pedida só em "Outro")
--   status_before_cancel  status GRAVADO na coluna antes do cancelamento
--                         (NOVA/PENDENTE/ALOCADA…). Nunca o calculado:
--                         CONCLUIDA e EM_ANDAMENTO só existem calculados pela
--                         data, então uma concluída reativada volta como
--                         CONCLUIDA sozinha. A reativação devolve este valor;
--                         nulo (cancelada antiga) cai no fallback do app:
--                         ALOCADA se tem instrutor, NOVA se não.
--
-- Todas nullable, SEM backfill (canceladas antigas ficam nulas de propósito).
-- Sem policy nova: colunas em tabela existente, cobertas pelas policies de
-- `demands` (migration 012).
--
-- ⚠️ APLICAR ANTES DO DEPLOY: o app passa a escrever estas três colunas em
-- todo update de demanda (mapDemandToDb, App.tsx). Sem elas, o PostgREST
-- recusa o update inteiro ("column does not exist") — toda edição de demanda
-- falha, não só o cancelamento.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS.
-- Validação: supabase/validacoes/023_demand_cancellation_fields.sql
-- Regras do app: domain/demandCancellation.ts
-- =====================================================================

alter table public.demands
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancel_note text null,
  add column if not exists status_before_cancel text null;

comment on column public.demands.cancelled_at is
  'Instante do cancelamento (migration 023). Nulo = demanda ativa, ou cancelada antes da 023.';
comment on column public.demands.cancel_note is
  'Observação livre do modal de cancelamento (migration 023).';
comment on column public.demands.status_before_cancel is
  'Status GRAVADO antes do cancelamento; a reativação volta para ele. Nulo = fallback do app (ALOCADA se tem instrutor, NOVA se não).';
