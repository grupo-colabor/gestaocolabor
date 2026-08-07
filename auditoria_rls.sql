-- =====================================================================
-- AUDITORIA RLS — todas as tabelas que o app grava (services/ + App.tsx)
-- Read-only, seguro de rodar. Lista, por tabela, se falta policy de
-- SELECT/INSERT/UPDATE/DELETE para o role authenticated.
-- =====================================================================

with rls_status as (
  select c.relname as tablename, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
policy_cmds as (
  select tablename, cmd
  from pg_policies
  where schemaname = 'public'
),
resumo as (
  select
    r.tablename,
    r.rls_enabled,
    coalesce(bool_or(p.cmd in ('SELECT', 'ALL')), false) as tem_select,
    coalesce(bool_or(p.cmd in ('INSERT', 'ALL')), false) as tem_insert,
    coalesce(bool_or(p.cmd in ('UPDATE', 'ALL')), false) as tem_update,
    coalesce(bool_or(p.cmd in ('DELETE', 'ALL')), false) as tem_delete,
    count(p.cmd) as n_policies
  from rls_status r
  left join policy_cmds p on p.tablename = r.tablename
  where r.tablename in (
    'agenda_items', 'audit_logs', 'companies', 'companion_allocations', 'demand_documents',
    'demands', 'evidences', 'instructor_allocations', 'instructor_trainings', 'instructors',
    'location_associations', 'logistic_allocations', 'logistic_blocks', 'measurements',
    'operational_bases_items', 'profiles', 'resource_allocations', 'trainings'
  )
  group by r.tablename, r.rls_enabled
)
select
  tablename,
  rls_enabled,
  tem_select, tem_insert, tem_update, tem_delete,
  n_policies,
  case
    when not rls_enabled then 'RLS desligada — tabela sem controle por linha'
    when n_policies = 0 then '🚨 RLS ligada e SEM NENHUMA POLICY — tudo bloqueado pro app'
    when not tem_delete and not tem_update then '🚨 SEM DELETE e SEM UPDATE'
    when not tem_delete then '🚨 SEM POLICY DE DELETE (mesmo bug do trainings)'
    when not tem_update then '🚨 SEM POLICY DE UPDATE'
    when not tem_insert then '🚨 SEM POLICY DE INSERT'
    when not tem_select then '🚨 SEM POLICY DE SELECT'
    when n_policies > 4 then 'ok, mas com policies duplicadas/redundantes (' || n_policies || ') — vale limpar'
    else 'ok'
  end as alerta
from resumo
order by (case when not rls_enabled or n_policies = 0 or not tem_delete or not tem_update or not tem_insert or not tem_select then 0 else 1 end), tablename;
