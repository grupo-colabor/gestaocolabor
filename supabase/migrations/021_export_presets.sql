-- Migration 021: modelos de exportação salvos por usuário (export_presets)
--
-- Contexto (Exportações, 17/09/2026): a aba Exportações ganhou sete módulos
-- (Medições, Demandas, Logística, Instrutores, Despesas, Medição Vale, BM
-- Vale) e cada um tem filtros, colunas com ordem e opções marcáveis. Quem
-- exporta toda semana a mesma planilha precisa guardar essa escolha com um
-- nome — um "modelo" — e reaplicá-la ao abrir o módulo. Um modelo é:
--   dataset + filtros (SEM período) + colunas ligadas e ordem + opções.
--
-- O que muda:
--   1. tabela nova `export_presets`, uma linha por (usuário, módulo, nome);
--   2. `config jsonb` com o modelo (versão 1: { v, filters, options, columns });
--      o domínio (domain/exports/presets.ts) valida ao aplicar — coluna que
--      deixou de existir é ignorada com aviso, nunca em silêncio;
--   3. `is_default`: no máximo UM modelo padrão por (usuário, módulo), que a
--      aba aplica ao abrir o módulo — garantido por índice único parcial;
--   4. RLS POR DONO nas quatro operações.
--
-- PRIMEIRA TABELA DO APP COM RLS POR DONO — e por quê
-- ---------------------------------------------------------------------------
-- Todas as policies anteriores são "qualquer autenticado" (003, 007, 012,
-- 016, 017): as tabelas descrevem a operação da Colabor e todo perfil logado
-- lê e escreve. Um modelo salvo é diferente: é preferência PESSOAL. O nome
-- que o analista dá ao seu recorte não é dado da operação, e um usuário não
-- deve ver, aplicar, renomear ou apagar o modelo de outro. Por isso as
-- policies desta tabela usam `user_id = auth.uid()` em SELECT, INSERT (WITH
-- CHECK), UPDATE (USING e WITH CHECK) e DELETE. O único precedente de
-- `auth.uid()` é o de `profiles` (001, sobre `id`); a estrutura das policies
-- segue a 017 (TO authenticated, DROP antes de CREATE).
--
-- `user_id` tem DEFAULT auth.uid() (como `updated_by` na 017): o serviço não
-- precisa mandar o id do usuário, e o WITH CHECK recusa qualquer tentativa de
-- gravar em nome de outro. FK para auth.users com ON DELETE CASCADE: apagar o
-- usuário leva os modelos dele.
--
-- `updated_at` é gravado pelo serviço em cada UPDATE — este repositório não
-- tem trigger nenhum, de propósito (016:329), e esta migration não abre a
-- exceção.
--
-- `dataset_id` é TEXT: as chaves dos módulos vivem em código
-- (domain/exports/types.ts, DatasetKey). Um modelo cujo módulo o perfil não
-- vê (`requiredView`) é filtrado pela aba, não pelo banco — a mesma defesa de
-- UI do registry.
--
-- Numeração: a 020 continua reservada para a híbrida Nível 2 (nota da 019);
-- esta é a 021.
--
-- Idempotente: CREATE ... IF NOT EXISTS onde o Postgres aceita; DO blocks
-- para as constraints (ALTER TABLE ADD CONSTRAINT não tem IF NOT EXISTS);
-- policies derrubadas e recriadas (CREATE POLICY não aceita IF NOT EXISTS —
-- mesma nota da 007/012/016/017). Nenhuma linha existente é tocada: a tabela
-- nasce aqui.


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) a tabela ainda não existe (espera 0 linhas):
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'export_presets';
--
--   -- 2) auth.uid() e gen_random_uuid() disponíveis (espera 1 linha, sem erro;
--   --    no SQL Editor auth.uid() vem NULL, o que é normal fora de sessão):
--   select auth.uid() as uid, gen_random_uuid() as exemplo;
--
--   -- 3) a role `authenticated` existe (espera 1 linha):
--   select rolname from pg_roles where rolname = 'authenticated';
--
--   -- 4) dois usuários reais para o teste funcional da pós-migração:
--   select id, email from auth.users order by created_at limit 2;


-- ---------------------------------------------------------------------------
-- 1) Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.export_presets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  dataset_id  text        NOT NULL,
  name        text        NOT NULL,
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.export_presets            IS 'Modelos da aba Exportações, por usuário: dataset + filtros (sem período) + colunas/ordem + opções. RLS por dono (021).';
COMMENT ON COLUMN public.export_presets.dataset_id IS 'Chave do módulo (domain/exports/types.ts DatasetKey). Texto: os módulos vivem em código.';
COMMENT ON COLUMN public.export_presets.config     IS 'Versão 1: { "v": 1, "filters": {...sem dataInicio/dataFim}, "options": {...}, "columns": [chaves na ordem] }.';
COMMENT ON COLUMN public.export_presets.is_default IS 'No máximo um por (user_id, dataset_id) — índice único parcial export_presets_default_uq.';


-- ---------------------------------------------------------------------------
-- 2) Integridade: nome e módulo não vazios; nome único por (usuário, módulo)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'export_presets_name_check'
       AND conrelid = 'public.export_presets'::regclass
  ) THEN
    ALTER TABLE public.export_presets
      ADD CONSTRAINT export_presets_name_check
      CHECK (length(btrim(name)) BETWEEN 1 AND 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'export_presets_dataset_check'
       AND conrelid = 'public.export_presets'::regclass
  ) THEN
    ALTER TABLE public.export_presets
      ADD CONSTRAINT export_presets_dataset_check
      CHECK (length(btrim(dataset_id)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'export_presets_uq'
       AND conrelid = 'public.export_presets'::regclass
  ) THEN
    ALTER TABLE public.export_presets
      ADD CONSTRAINT export_presets_uq
      UNIQUE (user_id, dataset_id, name);
  END IF;
END $$;

-- Um único modelo padrão por (usuário, módulo): índice ÚNICO parcial. Um
-- índice parcial simples só aceleraria a busca; o único é o que impede dois
-- padrões ao mesmo tempo, seja qual for o caminho de escrita.
CREATE UNIQUE INDEX IF NOT EXISTS export_presets_default_uq
  ON public.export_presets USING btree (user_id, dataset_id)
  WHERE is_default;

-- Leitura da aba: os modelos do usuário, por módulo.
CREATE INDEX IF NOT EXISTS export_presets_user_idx
  ON public.export_presets USING btree (user_id, dataset_id);


-- ---------------------------------------------------------------------------
-- 3) RLS — POR DONO, nas quatro operações (ver cabeçalho)
-- ---------------------------------------------------------------------------
ALTER TABLE public.export_presets ENABLE ROW LEVEL SECURITY;

-- GRANT à role `authenticated` — aplicado em produção em 17/09/2026 junto com
-- esta migration. RLS só filtra linhas; sem o privilégio na tabela a role
-- nem chega às policies (permission denied). Idempotente: o Postgres aceita
-- reexecutar o GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_presets TO authenticated;

DROP POLICY IF EXISTS "Dono pode ler export_presets"       ON public.export_presets;
DROP POLICY IF EXISTS "Dono pode inserir export_presets"   ON public.export_presets;
DROP POLICY IF EXISTS "Dono pode atualizar export_presets" ON public.export_presets;
DROP POLICY IF EXISTS "Dono pode deletar export_presets"   ON public.export_presets;

CREATE POLICY "Dono pode ler export_presets"
  ON public.export_presets FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Dono pode inserir export_presets"
  ON public.export_presets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Dono pode atualizar export_presets"
  ON public.export_presets FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Dono pode deletar export_presets"
  ON public.export_presets FOR DELETE TO authenticated
  USING (user_id = auth.uid());


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
-- 1) Colunas (espera 8: id, user_id, dataset_id, name, config, is_default,
--    created_at, updated_at):
--    select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'export_presets'
--     order by ordinal_position;
--
-- 2) Constraints (espera 5: pkey, fkey para auth.users, 2 checks, unique):
--    select conname, contype, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.export_presets'::regclass
--     order by conname;
--
-- 3) Índices (espera 4: pkey, export_presets_uq, export_presets_default_uq
--    com "WHERE is_default", export_presets_user_idx):
--    select indexname, indexdef from pg_indexes
--     where schemaname = 'public' and tablename = 'export_presets'
--     order by indexname;
--
-- 4) RLS ligada e 4 policies (polcmd r/a/w/d), todas com user_id = auth.uid():
--    select relrowsecurity from pg_class where oid = 'public.export_presets'::regclass;
--    select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
--           pg_get_expr(polwithcheck, polrelid) as check_expr
--      from pg_policy
--     where polrelid = 'public.export_presets'::regclass
--     order by polcmd;
--
-- 5) TESTE FUNCIONAL DO ISOLAMENTO POR DONO. O SQL Editor roda como
--    `postgres`, que ignora RLS — por isso o teste assume a role
--    `authenticated` e injeta o `sub` do JWT que `auth.uid()` lê. Trocar
--    <UID_A> e <UID_B> pelos dois ids da conferência prévia 4. Tudo dentro
--    de uma transação com ROLLBACK: nada fica gravado.
--
--    begin;
--      set local role authenticated;
--
--      -- sessão do usuário A: grava e enxerga o próprio modelo
--      set local request.jwt.claims = '{"sub":"<UID_A>","role":"authenticated"}';
--      insert into public.export_presets (dataset_id, name, config)
--        values ('medicoes', 'teste-rls-021', '{"v":1,"filters":{},"options":{},"columns":["demandId"]}'::jsonb);
--      select count(*) as a_ve from public.export_presets where name = 'teste-rls-021';   -- espera 1
--
--      -- sessão do usuário B: não enxerga, não altera, não apaga o modelo de A
--      set local request.jwt.claims = '{"sub":"<UID_B>","role":"authenticated"}';
--      select count(*) as b_ve from public.export_presets where name = 'teste-rls-021';   -- espera 0
--      update public.export_presets set name = 'invadido' where name = 'teste-rls-021';   -- espera UPDATE 0
--      delete from public.export_presets where name = 'teste-rls-021';                    -- espera DELETE 0
--
--      -- B tentando gravar EM NOME de A: o WITH CHECK recusa
--      insert into public.export_presets (user_id, dataset_id, name, config)
--        values ('<UID_A>', 'medicoes', 'em-nome-de-a', '{}'::jsonb);
--      -- espera: ERROR new row violates row-level security policy for table "export_presets"
--    rollback;
--
--    Se `set local role authenticated` for recusado no seu SQL Editor
--    (depende dos grants da instância), o isolamento só dá para ser testado
--    pelo app: entrar com dois usuários, salvar um modelo com o primeiro e
--    confirmar que o segundo não o vê na lista da aba Exportações.
--
-- 6) Dois padrões no mesmo módulo devem FALHAR (transação com ROLLBACK,
--    como postgres — RLS não importa aqui):
--    begin;
--      insert into public.export_presets (user_id, dataset_id, name, is_default)
--        select id, 'demandas', 'padrao-1', true from auth.users limit 1;
--      insert into public.export_presets (user_id, dataset_id, name, is_default)
--        select id, 'demandas', 'padrao-2', true from auth.users limit 1;
--    rollback;
--    -- Esperado no segundo INSERT: ERROR duplicate key value violates unique
--    -- constraint "export_presets_default_uq".
