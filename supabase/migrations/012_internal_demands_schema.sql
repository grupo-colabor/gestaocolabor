-- Migration 012: Demandas Internas (schema)
--
-- Demanda interna = trabalho da própria Colabor para um instrutor (visita técnica,
-- SIPAT, apoio logístico, evento). Não tem cliente nem treinamento — por isso
-- `company_id` e `training_id` ficam null nessas linhas. Ambas as colunas JÁ são
-- nullable no banco (conferido em information_schema.columns), então esta migration
-- NÃO precisa de ALTER COLUMN ... DROP NOT NULL.
--
-- ⚠️ `demands.modality` é NOT NULL e SEM default: todo insert de demanda interna
-- precisa mandar modality explicitamente (o app manda 'PRESENCIAL').
--
-- Fase 2 de 5: só schema + camada de dados. Nada de UI, form ou medição aqui.

-- ---------------------------------------------------------------------------
-- 1) Colunas novas
-- ---------------------------------------------------------------------------
-- O DEFAULT 'cliente' já faz o backfill das linhas existentes no próprio ALTER —
-- não existe demanda interna anterior a esta migration, então toda linha atual
-- é, por definição, de cliente.
ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'cliente',
  ADD COLUMN IF NOT EXISTS categoria_interna text NULL,
  ADD COLUMN IF NOT EXISTS horas_previstas numeric NULL;

-- ---------------------------------------------------------------------------
-- 2) Constraints
-- ---------------------------------------------------------------------------

-- Domínio fechado de `tipo`.
ALTER TABLE demands
  DROP CONSTRAINT IF EXISTS demands_tipo_check;
ALTER TABLE demands
  ADD CONSTRAINT demands_tipo_check
  CHECK (tipo IN ('cliente', 'interna'));

-- Interna exige categoria e carga horária positiva (é o que a medição da Fase 4
-- vai consumir no lugar de training.hours). Validada normalmente: nenhuma linha
-- existente tem tipo='interna', então não há como violar no backfill.
ALTER TABLE demands
  DROP CONSTRAINT IF EXISTS demands_interna_requires_fields;
ALTER TABLE demands
  ADD CONSTRAINT demands_interna_requires_fields
  CHECK (tipo <> 'interna' OR (categoria_interna IS NOT NULL AND horas_previstas > 0));

-- Cliente exige empresa e treinamento — mas as FKs company_id/training_id são
-- ON DELETE SET NULL, então pode existir demanda antiga de cliente com um desses
-- campos nulo por exclusão de empresa/treinamento. Conferir ANTES de aplicar:
--
--   select count(*) from demands where company_id is null or training_id is null;
--
-- Se retornar > 0, essas linhas violariam a constraint e o ALTER falharia,
-- travando o deploy por dado legado. Por isso a constraint entra NOT VALID:
-- passa a valer para todo INSERT/UPDATE novo, sem varrer o passado.
--
-- Para validar o histórico depois de limpar as órfãs (opcional, fase futura):
--   ALTER TABLE demands VALIDATE CONSTRAINT demands_cliente_requires_refs;
ALTER TABLE demands
  DROP CONSTRAINT IF EXISTS demands_cliente_requires_refs;
ALTER TABLE demands
  ADD CONSTRAINT demands_cliente_requires_refs
  CHECK (tipo <> 'cliente' OR (company_id IS NOT NULL AND training_id IS NOT NULL))
  NOT VALID;

-- ---------------------------------------------------------------------------
-- 3) RLS de `demands` — versionamento de dívida técnica
-- ---------------------------------------------------------------------------
-- As 4 policies abaixo JÁ existem no banco: foram criadas à mão no dashboard e
-- nunca versionadas. Policies idênticas às criadas manualmente no dashboard;
-- esta migration apenas as versiona (padrão da 007).
--
-- Comportamento reproduzido exatamente como está em produção (conferido em
-- pg_policies): todas TO authenticated, predicado `auth.role() = 'authenticated'`,
-- nenhuma filtra por coluna — ou seja, demanda interna não muda nada de acesso.
--
-- CREATE POLICY não aceita IF NOT EXISTS no Postgres; os DROPs acima garantem
-- que os nomes estão livres.

ALTER TABLE demands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados podem ler demands" ON demands;
DROP POLICY IF EXISTS "Autenticados podem inserir demands" ON demands;
DROP POLICY IF EXISTS "Autenticados podem atualizar demands" ON demands;
DROP POLICY IF EXISTS "Autenticados podem deletar demands" ON demands;

CREATE POLICY "Autenticados podem ler demands"
  ON demands FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir demands"
  ON demands FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem atualizar demands"
  ON demands FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar demands"
  ON demands FOR DELETE TO authenticated
  USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Conferência pós-migração
-- ---------------------------------------------------------------------------
-- Colunas novas (espera 3 linhas: tipo/categoria_interna/horas_previstas):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'demands'
--      and column_name in ('tipo', 'categoria_interna', 'horas_previstas');
--
-- Backfill (espera 0 linhas com tipo distinto de 'cliente'):
--   select tipo, count(*) from demands group by tipo;
--
-- Constraints (espera as 3, com demands_cliente_requires_refs convalidated=false):
--   select conname, convalidated from pg_constraint
--    where conrelid = 'public.demands'::regclass and contype = 'c';
--
-- Policies (espera exatamente 4 — r/a/w/d):
--   select polname, polcmd from pg_policy where polrelid = 'public.demands'::regclass;
