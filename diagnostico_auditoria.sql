-- =====================================================================
-- DIAGNÓSTICO DA AUDITORIA — somente leitura, seguro de rodar.
-- Nada aqui altera dado. Rode no SQL Editor do Supabase e me mande a saída.
--
-- (A) Extensão do dano do LIKE por substring em demanda_excluida
-- (B) Realidade das policies de audit_logs vs. o que a migration 008 afirma
-- =====================================================================


-- ---------------------------------------------------------------------
-- (A.1) RESUMO — logs marcados como "demanda excluída" cuja demanda
-- AINDA EXISTE em `demands`. Se a demanda existe, ela não foi excluída:
-- a marcação veio do casamento por substring (excluir DEM-63 marcava
-- DEM-631, DEM-6301...). Esses logs estão escondidos da tela hoje.
--
-- Esperado se não houve dano: 0 linhas.
-- ---------------------------------------------------------------------
select
  substring(a.descricao from 'DEM-[0-9]+') as demanda_afetada,
  count(*)                                 as logs_marcados_indevidamente,
  min(a.created_at)::date                  as primeiro_log,
  max(a.created_at)::date                  as ultimo_log
from public.audit_logs a
where a.demanda_excluida = true
  and exists (
    select 1 from public.demands d
    where d.id = substring(a.descricao from 'DEM-[0-9]+')
  )
group by 1
order by 2 desc, 1;


-- ---------------------------------------------------------------------
-- (A.2) TOTAIS — dimensiona o estrago de uma vez só.
-- ---------------------------------------------------------------------
select
  count(*) filter (where a.demanda_excluida = true)                as total_marcados,
  count(*) filter (
    where a.demanda_excluida = true
      and exists (select 1 from public.demands d
                  where d.id = substring(a.descricao from 'DEM-[0-9]+'))
  )                                                                as marcados_indevidamente,
  count(distinct substring(a.descricao from 'DEM-[0-9]+')) filter (
    where a.demanda_excluida = true
      and exists (select 1 from public.demands d
                  where d.id = substring(a.descricao from 'DEM-[0-9]+'))
  )                                                                as demandas_afetadas
from public.audit_logs a;


-- ---------------------------------------------------------------------
-- (A.3) CULPADOS PROVÁVEIS — para cada demanda marcada indevidamente,
-- qual exclusão real a atingiu por prefixo. Confirma a causa raiz
-- (e não outra coisa) antes de qualquer reparo.
-- ---------------------------------------------------------------------
with afetadas as (
  select distinct substring(a.descricao from 'DEM-[0-9]+') as demanda
  from public.audit_logs a
  where a.demanda_excluida = true
    and exists (select 1 from public.demands d
                where d.id = substring(a.descricao from 'DEM-[0-9]+'))
),
excluidas as (
  -- Demandas que tiveram log de exclusão e realmente sumiram de `demands`
  select distinct substring(a.descricao from 'DEM-[0-9]+') as demanda
  from public.audit_logs a
  where a.descricao like '%excluída%'
    and not exists (select 1 from public.demands d
                    where d.id = substring(a.descricao from 'DEM-[0-9]+'))
)
select
  af.demanda        as marcada_indevidamente,
  ex.demanda        as exclusao_que_causou
from afetadas af
join excluidas ex
  on af.demanda like ex.demanda || '%'
 and af.demanda <> ex.demanda
order by 1;


-- ---------------------------------------------------------------------
-- (A.4) AMOSTRA — 20 logs concretos para inspeção manual.
-- ---------------------------------------------------------------------
select a.id, a.created_at, a.user_name, a.modulo, a.acao, a.descricao
from public.audit_logs a
where a.demanda_excluida = true
  and exists (select 1 from public.demands d
              where d.id = substring(a.descricao from 'DEM-[0-9]+'))
order by a.created_at desc
limit 20;


-- ---------------------------------------------------------------------
-- (B) POLICIES DE audit_logs — a migration 008 documenta a tabela como
-- write-once ("sem UPDATE/DELETE por design"), mas o app roda UPDATE nela
-- para marcar demanda_excluida. Ou a policy de UPDATE existe (e a
-- imutabilidade documentada não é real), ou o UPDATE falha em silêncio.
-- Esta query diz qual das duas.
-- ---------------------------------------------------------------------
select
  c.relrowsecurity as rls_ligada,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual        as using_expr,
  p.with_check  as with_check_expr
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relname = 'audit_logs'
order by p.cmd nulls last, p.policyname;
