-- =====================================================================
-- 010 — BACKFILL: evento "Demanda criada" na trilha de auditoria
--
-- Contexto: o módulo de auditoria entrou em 2026-03-26 (commit 3ffdfbe).
-- Toda demanda criada antes disso tem os eventos posteriores (Editar,
-- Cancelar, Programação, Medição...) mas não tem o evento de criação —
-- a trilha começa no meio da história.
--
-- Esta migração insere retroativamente um log 'Criar' por demanda,
-- usando `demands.created_at` como timestamp original.
--
-- Autoria: `demands` NÃO tem coluna `created_by` (nenhuma referência ao
-- usuário criador é gravada hoje). Por isso os registros retroativos vão
-- com user_id NULL e user_name 'Sistema (registro retroativo)' — honesto
-- quanto ao que se sabe, em vez de atribuir a alguém por chute.
--
-- IDEMPOTENTE: reexecutar não duplica (guarda NOT EXISTS por demanda).
-- =====================================================================

insert into public.audit_logs (
  id, created_at, user_id, user_name, modulo, acao, descricao, dados_antes, dados_depois
)
select
  gen_random_uuid(),
  d.created_at,
  null,
  'Sistema (registro retroativo)',
  'Demandas',
  'Criar',
  -- Mesmo formato das descrições geradas pelo app em Demands.tsx:
  -- "Demanda DEM-NNNN criada | Empresa: X | Treinamento: Y | Início: ... | Local: Z"
  concat_ws(' | ',
    'Demanda ' || d.id || ' criada',
    'Empresa: '     || coalesce(nullif(c.name, ''), 'N/A'),
    'Treinamento: ' || coalesce(nullif(t.name, ''), 'N/A'),
    'Início: '      || coalesce(
                         to_char(d.start_date at time zone 'UTC', 'DD/MM/YYYY HH24:MI'),
                         '---'
                       ),
    -- Local só entra quando preenchido, igual ao app (.filter(Boolean))
    case when nullif(btrim(d.training_local), '') is not null
         then 'Local: ' || btrim(d.training_local)
    end
  ),
  null,
  -- dados_depois em camelCase, igual ao que o app grava (o objeto de
  -- domínio, não a linha do banco). Só os campos essenciais: o payload
  -- histórico completo não existe mais, e inventá-lo seria pior que omitir.
  jsonb_build_object(
    'id',            d.id,
    'companyId',     d.company_id,
    'trainingId',    d.training_id,
    'startDate',     d.start_date,
    'endDate',       d.end_date,
    'modality',      d.modality,
    'status',        d.status,
    'trainingLocal', d.training_local,
    '_backfill',     true
  )
from public.demands d
left join public.companies c on c.id = d.company_id
left join public.trainings t on t.id = d.training_id
where d.created_at is not null
  and not exists (
    -- Prefixo exato + espaço: 'Demanda DEM-63 criada%' não casa com
    -- 'Demanda DEM-631 criada'. Cobre tanto logs gerados pelo app
    -- quanto reexecuções desta própria migração.
    select 1
    from public.audit_logs a
    where a.modulo = 'Demandas'
      and a.acao   = 'Criar'
      and a.descricao like 'Demanda ' || d.id || ' criada%'
  );

-- =====================================================================
-- Conferência pós-migração
--
-- 1) Demandas sem evento de criação (esperado: 0, exceto created_at NULL):
--
-- select count(*) as demandas_sem_evento_criacao
-- from public.demands d
-- where not exists (
--   select 1 from public.audit_logs a
--   where a.modulo = 'Demandas' and a.acao = 'Criar'
--     and a.descricao like 'Demanda ' || d.id || ' criada%'
-- );
--
-- 2) Demandas que ficaram de fora por não terem created_at:
--
-- select count(*) as sem_created_at from public.demands where created_at is null;
--
-- 3) Total de eventos retroativos inseridos:
--
-- select count(*) from public.audit_logs
-- where acao = 'Criar' and modulo = 'Demandas'
--   and user_name = 'Sistema (registro retroativo)';
-- =====================================================================
