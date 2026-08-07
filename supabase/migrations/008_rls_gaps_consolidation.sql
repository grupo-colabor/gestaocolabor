-- Migration 008: Fecha os buracos de RLS achados na auditoria pós-007
-- (auditoria_rls.sql — 18 tabelas checadas, 6 com alerta).
--
-- companies sem UPDATE é o mais sério: mesma classe do bug de exclusão de
-- treinamento (007), só que em UPDATE — edições de empresa pelo app podiam
-- estar sendo "aceitas" sem nunca gravar (RLS casando 0 linhas, sem erro).
-- Isso já está coberto no código também (services/companies.ts agora lança
-- erro explícito se 0 linhas forem atualizadas), mas a causa raiz é a
-- policy que falta — sem ela o código correto nunca teria como funcionar.

-- =====================================================================
-- 1) companies — faltava UPDATE e DELETE
-- =====================================================================
CREATE POLICY "Authenticated update companies"
  ON companies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete companies"
  ON companies FOR DELETE TO authenticated USING (true);

-- =====================================================================
-- 2) evidences — faltava DELETE
-- (guarda para o futuro: hoje o app não deleta evidences por código)
-- =====================================================================
CREATE POLICY "Authenticated delete evidences"
  ON evidences FOR DELETE TO authenticated USING (true);

-- =====================================================================
-- 3) measurements — faltava DELETE
-- (guarda para o futuro: hoje o app não deleta measurements por código)
-- =====================================================================
CREATE POLICY "Authenticated delete measurements"
  ON measurements FOR DELETE TO authenticated USING (true);

-- =====================================================================
-- 4) companion_allocations — faltava UPDATE (consistência)
-- (guarda para o futuro: hoje services/companionAllocations.ts só tem
-- insert/delete, sem função de update — nada no código depende disso ainda)
-- =====================================================================
CREATE POLICY "Authenticated update companion_allocations"
  ON companion_allocations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 5) instructor_trainings — 7 policies duplicadas (mesmo padrão do
-- trainings antes da 007). PENDENTE: preciso dos nomes exatos antes de
-- gerar os DROPs.
--
-- Rode isto separado primeiro e me manda o resultado:
--
--   select polname, polcmd, polroles::regrole[]
--   from pg_policy
--   where polrelid = 'public.instructor_trainings'::regclass;
--
-- Assim que eu tiver os 7 nomes, devolvo o bloco DROP + CREATE (padrão
-- da 007) pra você colar aqui embaixo antes de rodar esta migração.
-- =====================================================================

-- =====================================================================
-- NÃO tocado nesta migração (intencional):
--
-- audit_logs — sem UPDATE/DELETE por design: log de auditoria é
-- write-once (só INSERT), imutabilidade é a garantia, não um buraco.
--
-- profiles — sem DELETE por design: exclusão de usuário acontece via
-- Supabase Auth Admin API (que remove o auth.users e casca em profiles
-- por FK/trigger), nunca por DELETE direto na tabela pelo app.
-- =====================================================================

-- Conferência pós-migração (companies, evidences, measurements,
-- companion_allocations — instructor_trainings fica de fora até a
-- consolidação):
-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('companies', 'evidences', 'measurements', 'companion_allocations')
-- order by tablename, cmd;
