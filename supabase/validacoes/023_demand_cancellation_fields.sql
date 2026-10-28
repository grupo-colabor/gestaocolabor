-- =====================================================================
-- VALIDAÇÃO da migration 023 (cancelamento: data, observação, status anterior)
-- Rodar no SQL editor DEPOIS de aplicar supabase/migrations/023_demand_cancellation_fields.sql.
-- Só SELECT: não altera nada.
-- =====================================================================

-- 1) As três colunas existem, com os tipos certos e nullable (espera 3 linhas).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'demands'
  and column_name in ('cancelled_at', 'cancel_note', 'status_before_cancel')
order by column_name;
-- esperado:
--   cancel_note          | text                     | YES
--   cancelled_at         | timestamp with time zone | YES
--   status_before_cancel | text                     | YES

-- 2) Uma cancelada antiga: colunas novas nulas (sem backfill), cancel_reason como estava.
select id, status, cancel_reason, cancelled_at, cancel_note, status_before_cancel
from public.demands
where status = 'CANCELADA'
order by number desc
limit 1;

-- 3) Contagem: canceladas no total e quantas já têm status anterior
--    (0 logo após a migration; cresce a cada cancelamento feito pelo app novo).
select
  count(*) filter (where status = 'CANCELADA')                                   as canceladas,
  count(*) filter (where status = 'CANCELADA' and cancelled_at is not null)      as com_data,
  count(*) filter (where status = 'CANCELADA' and status_before_cancel is not null) as com_status_anterior
from public.demands;

-- 4) Opcional, depois do primeiro cancelamento pelo app novo: a trilha de
--    auditoria tem o status anterior na descrição ("Status anterior: …").
select created_at, user_name, descricao
from public.audit_logs
where modulo = 'Demandas' and acao in ('Cancelar', 'Reativar')
order by created_at desc
limit 5;
