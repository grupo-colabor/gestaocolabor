-- Migration 017: valores manuais dos templates de medição por empresa
--
-- Contexto (Exportações, Etapa 2): a "Medição Vale" gera o XLSX no layout do
-- cliente e precisa de campos que o app não tem — preço unitário da hora por
-- treinamento, preço sobrescrito numa demanda, combustível, % de despesa e
-- observação. Eles são digitados na prévia da aba Exportações e precisam
-- sobreviver entre sessões.
--
-- POR QUE UMA TABELA NOVA, E NÃO jsonb EM `measurements`
-- ---------------------------------------------------------------------------
--   • O painel de Medição salva o objeto `expenses` INTEIRO a partir do estado
--     da tela (App.tsx, mapMeasurementToDbPatch) e não assina realtime de
--     `measurements`: um valor gravado pela aba Exportações seria sobrescrito
--     pelo próximo salvar de um painel aberto antes.
--   • O preço por TREINAMENTO não pertence a nenhuma medição.
--   • Uma demanda sem medição aberta ainda precisa de observação.
--   • Excel de pagamento e painel de Medição nunca leem esta tabela — impacto
--     zero nos dois, que é a exigência da Etapa 2.
--
-- UMA tabela com `scope` em vez de duas: leitura e escrita são um caminho só,
-- e a unicidade cabe numa constraint. As duas referências (treinamento e
-- demanda) são colunas próprias, com FK, para o CASCADE limpar os valores de
-- uma demanda apagada — sem coluna polimórfica sem FK.
--
-- `template_id` é TEXT de propósito: o template da Vale vive em código
-- (domain/exports/templates/vale.ts, id 'vale-v1') e não tem linha no banco.
-- A Etapa 3 cria `measurement_templates` e adiciona a FK com NOT VALID, sem
-- reescrever esta tabela.
--
-- TIPO DE `trainings.id`
-- ---------------------------------------------------------------------------
-- A DDL de `trainings` não está versionada (só as policies, na 007), e o app
-- não envia `id` no INSERT (App.tsx, mapTrainingToDb) — o valor vem do
-- DEFAULT do banco, provavelmente uuid como nas tabelas irmãs. Em vez de
-- chutar, o bloco DO abaixo LÊ o tipo em pg_attribute e cria `training_id`
-- com exatamente esse tipo antes de declarar a FK. Aparece como NOTICE.
--
-- UNIQUE NULLS NOT DISTINCT (Postgres 15+; o projeto está em 17): um índice
-- só, com as duas referências nulas-mas-iguais tratadas como iguais. É o que
-- deixa `upsert(..., { onConflict: 'template_id,scope,column_key,
-- training_id,demand_id' })` funcionar pelo PostgREST — índice parcial não
-- serve para ON CONFLICT via API.
--
-- Idempotente: CREATE ... IF NOT EXISTS, e policies derrubadas e recriadas
-- (CREATE POLICY não aceita IF NOT EXISTS — mesma nota da 007/012/016).


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) tipo real de trainings.id (o bloco DO usa o mesmo valor):
--   select format_type(a.atttypid, a.atttypmod)
--     from pg_attribute a
--    where a.attrelid = 'public.trainings'::regclass and a.attname = 'id';
--
--   -- 2) demands.id é text (016 já depende disso):
--   select format_type(a.atttypid, a.atttypmod)
--     from pg_attribute a
--    where a.attrelid = 'public.demands'::regclass and a.attname = 'id';


-- ---------------------------------------------------------------------------
-- 1) Tabela (sem training_id — entra no passo 2, com o tipo introspectado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measurement_template_values (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'vale-v1' hoje; uuid de measurement_templates na Etapa 3.
  template_id  text NOT NULL,
  -- 'training' = valor por treinamento (preço HH padrão);
  -- 'demand'   = valor por demanda (preço sobrescrito, combustível, %, observação).
  scope        text NOT NULL,
  -- Chave da coluna no template (TemplateColumn.key): 'precoHH', 'combustivel', ...
  column_key   text NOT NULL,
  demand_id    text NULL REFERENCES public.demands (id) ON DELETE CASCADE,
  -- jsonb aceita escalar: número para preço/percentual, string para observação.
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL DEFAULT auth.uid(),

  CONSTRAINT measurement_template_values_scope_check
    CHECK (scope IN ('training', 'demand'))
);

-- ---------------------------------------------------------------------------
-- 2) training_id com o tipo de trainings.id + FK, por introspecção
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tipo_id text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO tipo_id
    FROM pg_attribute a
   WHERE a.attrelid = 'public.trainings'::regclass
     AND a.attname  = 'id'
     AND NOT a.attisdropped;

  IF tipo_id IS NULL THEN
    RAISE EXCEPTION '017: não foi possível ler o tipo de public.trainings.id';
  END IF;

  RAISE NOTICE '017: trainings.id é %', tipo_id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.measurement_template_values'::regclass
       AND attname  = 'training_id'
       AND NOT attisdropped
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.measurement_template_values ADD COLUMN training_id %s NULL',
      tipo_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'measurement_template_values_training_fk'
       AND conrelid = 'public.measurement_template_values'::regclass
  ) THEN
    ALTER TABLE public.measurement_template_values
      ADD CONSTRAINT measurement_template_values_training_fk
      FOREIGN KEY (training_id) REFERENCES public.trainings (id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Integridade: escopo casa com a referência; unicidade por chave
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'measurement_template_values_scope_ref_check'
       AND conrelid = 'public.measurement_template_values'::regclass
  ) THEN
    ALTER TABLE public.measurement_template_values
      ADD CONSTRAINT measurement_template_values_scope_ref_check
      CHECK (
        (scope = 'training' AND training_id IS NOT NULL AND demand_id IS NULL) OR
        (scope = 'demand'   AND demand_id   IS NOT NULL AND training_id IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'measurement_template_values_uq'
       AND conrelid = 'public.measurement_template_values'::regclass
  ) THEN
    ALTER TABLE public.measurement_template_values
      ADD CONSTRAINT measurement_template_values_uq
      UNIQUE NULLS NOT DISTINCT (template_id, scope, column_key, training_id, demand_id);
  END IF;
END $$;

-- Leitura por template (a aba carrega tudo de um template de uma vez) e o lado
-- do CASCADE das duas FKs, para DELETE em trainings/demands não fazer seq scan.
CREATE INDEX IF NOT EXISTS measurement_template_values_template_idx
  ON public.measurement_template_values USING btree (template_id, scope);

CREATE INDEX IF NOT EXISTS measurement_template_values_training_idx
  ON public.measurement_template_values USING btree (training_id);

CREATE INDEX IF NOT EXISTS measurement_template_values_demand_idx
  ON public.measurement_template_values USING btree (demand_id);

-- ---------------------------------------------------------------------------
-- 4) RLS — 4 policies, formato da 012/016 (qualquer autenticado)
-- ---------------------------------------------------------------------------
-- Mesma abrangência das tabelas que a aba já lê. Restringir por papel é a
-- leva de segurança (ver domain/exports/registry.ts); não entra aqui.
ALTER TABLE public.measurement_template_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados podem ler measurement_template_values"       ON public.measurement_template_values;
DROP POLICY IF EXISTS "Autenticados podem inserir measurement_template_values"   ON public.measurement_template_values;
DROP POLICY IF EXISTS "Autenticados podem atualizar measurement_template_values" ON public.measurement_template_values;
DROP POLICY IF EXISTS "Autenticados podem deletar measurement_template_values"   ON public.measurement_template_values;

CREATE POLICY "Autenticados podem ler measurement_template_values"
  ON public.measurement_template_values FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir measurement_template_values"
  ON public.measurement_template_values FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem atualizar measurement_template_values"
  ON public.measurement_template_values FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar measurement_template_values"
  ON public.measurement_template_values FOR DELETE TO authenticated
  USING (auth.role() = 'authenticated');


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
-- 1) Colunas (espera 9: id, template_id, scope, column_key, demand_id, value,
--    updated_at, updated_by, training_id — esta com o tipo de trainings.id):
--    select column_name, data_type, is_nullable
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'measurement_template_values'
--     order by ordinal_position;
--
-- 2) Constraints (espera 6: pkey, 2 checks, unique, 2 fks):
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.measurement_template_values'::regclass
--     order by conname;
--
-- 3) Policies (espera 4 — r/a/w/d):
--    select polname, polcmd from pg_policy
--     where polrelid = 'public.measurement_template_values'::regclass;
--
-- 4) TESTE FUNCIONAL da unicidade com nulos — o segundo INSERT deve FALHAR.
--    Rodar dentro de uma transação e dar ROLLBACK:
--    begin;
--      insert into public.measurement_template_values (template_id, scope, column_key, training_id, value)
--      select 'teste', 'training', 'precoHH', id, '10'::jsonb from public.trainings limit 1;
--      insert into public.measurement_template_values (template_id, scope, column_key, training_id, value)
--      select 'teste', 'training', 'precoHH', id, '20'::jsonb from public.trainings limit 1;
--    rollback;
--    -- Esperado: ERROR duplicate key value violates unique constraint
--    -- "measurement_template_values_uq".
