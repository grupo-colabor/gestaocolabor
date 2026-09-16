-- Migration 018: escopo 'context' em measurement_template_values (cabeçalho do BM)
--
-- Contexto (Exportações, BM da Vale): o Boletim de Medição tem um cabeçalho
-- fixo por (corredor, mina) — gerência executiva, gerência, contrato,
-- contratada/CNPJ, objeto, gestor, local, números de linha do QQP. Não é por
-- treinamento nem por demanda: é um CONTEXTO, preenchido uma vez e reusado em
-- toda geração daquele corredor/mina.
--
-- A 017 previu dois escopos ('training', 'demand'), cada um com a sua FK. O
-- contexto não referencia tabela nenhuma: a chave é texto, montada pela
-- aplicação como "<corredor>|<mina>" (domain/exports/templates/values.ts,
-- `contextKey`). Por isso entra como coluna própria `context_key`, e não como
-- um terceiro FK.
--
-- O que muda:
--   1. CHECK de `scope` aceita 'context';
--   2. coluna `context_key text NULL`;
--   3. CHECK escopo↔referência ganha a terceira alternativa;
--   4. a UNIQUE NULLS NOT DISTINCT passa a incluir `context_key` — o upsert do
--      PostgREST (services/exports/templateValues.ts, onConflict) lista as
--      seis colunas;
--   5. índice para a leitura por contexto.
--
-- ⚠️ Recriar a UNIQUE é DROP + ADD (constraint não tem ALTER). A tabela nasceu
-- na 017, tem poucas linhas (preços por treinamento e campos por turma
-- digitados na prévia) e nenhuma FK aponta para ela, então o custo é
-- desprezível e não há janela de inconsistência relevante. Se um dia ela
-- crescer, a troca seria índice novo + swap.
--
-- Numeração: a 019 fica reservada para a híbrida Nível 2.
--
-- Idempotente: cada passo testa a existência por nome (CREATE ... IF NOT
-- EXISTS onde o Postgres aceita; DO blocks onde não aceita — mesma nota da
-- 007/012/016/017). RLS não muda: as 4 policies da 017 continuam valendo.


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) as constraints que serão recriadas existem com estes nomes (espera 3):
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.measurement_template_values'::regclass
--      and conname in ('measurement_template_values_scope_check',
--                      'measurement_template_values_scope_ref_check',
--                      'measurement_template_values_uq');
--
--   -- 2) volume (contexto para o DROP + ADD da unique):
--   select scope, count(*) from public.measurement_template_values group by scope;


-- ---------------------------------------------------------------------------
-- 1) scope aceita 'context'
-- ---------------------------------------------------------------------------
ALTER TABLE public.measurement_template_values
  DROP CONSTRAINT IF EXISTS measurement_template_values_scope_check;
ALTER TABLE public.measurement_template_values
  ADD CONSTRAINT measurement_template_values_scope_check
  CHECK (scope IN ('training', 'demand', 'context'));

-- ---------------------------------------------------------------------------
-- 2) context_key
-- ---------------------------------------------------------------------------
-- "<corredor>|<mina>", montada e normalizada pela aplicação. Sem FK: não
-- referencia tabela (corredor é base operacional, mina é texto da demanda).
ALTER TABLE public.measurement_template_values
  ADD COLUMN IF NOT EXISTS context_key text NULL;

-- ---------------------------------------------------------------------------
-- 3) escopo casa com exatamente uma referência
-- ---------------------------------------------------------------------------
ALTER TABLE public.measurement_template_values
  DROP CONSTRAINT IF EXISTS measurement_template_values_scope_ref_check;
ALTER TABLE public.measurement_template_values
  ADD CONSTRAINT measurement_template_values_scope_ref_check
  CHECK (
    (scope = 'training' AND training_id IS NOT NULL AND demand_id IS NULL AND context_key IS NULL) OR
    (scope = 'demand'   AND demand_id   IS NOT NULL AND training_id IS NULL AND context_key IS NULL) OR
    (scope = 'context'  AND context_key IS NOT NULL AND training_id IS NULL AND demand_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 4) unicidade com a chave nova (DROP + ADD — ver cabeçalho)
-- ---------------------------------------------------------------------------
-- Só recria se a constraint atual NÃO tiver context_key, para a migration ser
-- reexecutável sem dropar e recriar à toa.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname  = 'measurement_template_values_uq'
     AND conrelid = 'public.measurement_template_values'::regclass;

  IF def IS NOT NULL AND def NOT LIKE '%context_key%' THEN
    ALTER TABLE public.measurement_template_values
      DROP CONSTRAINT measurement_template_values_uq;
    def := NULL;
    RAISE NOTICE '018: unique antiga removida (sem context_key)';
  END IF;

  IF def IS NULL THEN
    ALTER TABLE public.measurement_template_values
      ADD CONSTRAINT measurement_template_values_uq
      UNIQUE NULLS NOT DISTINCT (template_id, scope, column_key, training_id, demand_id, context_key);
    RAISE NOTICE '018: unique recriada com context_key';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) leitura por contexto
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS measurement_template_values_context_idx
  ON public.measurement_template_values USING btree (template_id, scope, context_key);


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
-- 1) Coluna nova (espera 1 linha: context_key, text, YES):
--    select column_name, data_type, is_nullable
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'measurement_template_values'
--       and column_name = 'context_key';
--
-- 2) Constraints (espera 6, com a unique citando context_key e o scope_check
--    citando 'context'):
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.measurement_template_values'::regclass
--     order by conname;
--
-- 3) Policies continuam 4 (r/a/w/d):
--    select polname, polcmd from pg_policy
--     where polrelid = 'public.measurement_template_values'::regclass;
--
-- 4) TESTE FUNCIONAL da unicidade nos TRÊS escopos — cada segundo INSERT deve
--    FALHAR com "duplicate key value violates unique constraint
--    "measurement_template_values_uq"". Rodar cada bloco em transação com
--    ROLLBACK:
--
--    -- (a) training
--    begin;
--      insert into public.measurement_template_values (template_id, scope, column_key, training_id, value)
--      select 'teste', 'training', 'precoHH', id, '10'::jsonb from public.trainings limit 1;
--      insert into public.measurement_template_values (template_id, scope, column_key, training_id, value)
--      select 'teste', 'training', 'precoHH', id, '20'::jsonb from public.trainings limit 1;
--    rollback;
--
--    -- (b) demand
--    begin;
--      insert into public.measurement_template_values (template_id, scope, column_key, demand_id, value)
--      select 'teste', 'demand', 'observacao', id, '"a"'::jsonb from public.demands limit 1;
--      insert into public.measurement_template_values (template_id, scope, column_key, demand_id, value)
--      select 'teste', 'demand', 'observacao', id, '"b"'::jsonb from public.demands limit 1;
--    rollback;
--
--    -- (c) context
--    begin;
--      insert into public.measurement_template_values (template_id, scope, column_key, context_key, value)
--      values ('teste', 'context', 'contrato', 'Sudeste|Brucutu', '"5900123435"'::jsonb);
--      insert into public.measurement_template_values (template_id, scope, column_key, context_key, value)
--      values ('teste', 'context', 'contrato', 'Sudeste|Brucutu', '"outro"'::jsonb);
--    rollback;
--
--    -- (d) o CHECK de referência recusa contexto com demanda junto:
--    begin;
--      insert into public.measurement_template_values (template_id, scope, column_key, context_key, demand_id, value)
--      select 'teste', 'context', 'contrato', 'Sudeste|Brucutu', id, '"x"'::jsonb from public.demands limit 1;
--    rollback;
--    -- Esperado: ERROR new row violates check constraint
--    -- "measurement_template_values_scope_ref_check".
