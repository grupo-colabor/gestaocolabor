-- Migration 007: Consolida RLS de `trainings`
--
-- Causa raiz do bug "não consigo excluir treinamento pelo app": RLS de
-- `trainings` foi montada à mão no dashboard, em gerações diferentes,
-- nunca versionada — resultou em 7 policies (triplicando SELECT/INSERT/
-- UPDATE com nomes diferentes) e NENHUMA de DELETE. O app não recebe erro
-- nesse caso (PostgREST responde sucesso com 0 linhas quando RLS filtra o
-- WHERE do DELETE) — só finge que excluiu.
--
-- Este arquivo derruba as 7 antigas e recria só as 4 canônicas, uma por
-- operação, no mesmo padrão de 002_location_associations.sql.
--
-- ⚠️ CREATE POLICY não aceita IF NOT EXISTS no Postgres (só CREATE TABLE/
-- INDEX/etc. aceitam). A versão anterior deste arquivo tinha esse erro de
-- sintaxe; corrigido aqui pra refletir exatamente o que foi rodado no banco
-- (seguro sem IF NOT EXISTS porque os DROPs acima já garantem que os nomes
-- não existem mais). Estado confirmado em produção: 4 policies (r/a/w/d).

DROP POLICY IF EXISTS "trainings_select_authenticated" ON trainings;
DROP POLICY IF EXISTS "trainings_insert_authenticated" ON trainings;
DROP POLICY IF EXISTS "trainings_update_authenticated" ON trainings;
DROP POLICY IF EXISTS "trainings_select" ON trainings;
DROP POLICY IF EXISTS "trainings_insert" ON trainings;
DROP POLICY IF EXISTS "trainings_update" ON trainings;
DROP POLICY IF EXISTS "trainings_select_auth" ON trainings;

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read trainings"
  ON trainings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert trainings"
  ON trainings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update trainings"
  ON trainings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete trainings"
  ON trainings FOR DELETE TO authenticated USING (true);

-- Conferência pós-migração — deve retornar exatamente 4 linhas (r/a/w/d):
-- select polname, polcmd from pg_policy where polrelid = 'public.trainings'::regclass;
