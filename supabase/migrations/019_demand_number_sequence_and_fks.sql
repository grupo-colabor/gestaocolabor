-- Migration 019: número de demanda por SEQUENCE + chaves estrangeiras que faltavam
--
-- Contexto (09/2026): o próximo "DEM-N" era "maior `number` no banco + 1",
-- lido pelo app a cada sync (App.tsx / services/demands.ts,
-- fetchMaxDemandNumber). Apagar a demanda de maior número fazia o próximo
-- cadastro REAPROVEITAR o número (DEM-1719 apagada → DEM-1719 criada de novo),
-- e dois navegadores abertos partiam do mesmo máximo. Pior que o número
-- repetido: `resource_allocations` não tem FK (documentado na 016) e a linha
-- de medição/CTM da demanda apagada sobrevivia com o MESMO demand_id — a
-- demanda nova herdava medição, anexos e alocação de CTM da antiga.
--
-- O que muda:
--   1. SEQUENCE `demands_number_seq`, iniciada em max(number). Uma sequence
--      NUNCA reaproveita número: não volta após exclusão nem após insert que
--      falhou (buracos são aceitáveis; repetição não).
--   2. Função `allocate_demand_number()` (security definer, search_path fixo,
--      grant a `authenticated`): o app chama por RPC antes do insert e monta
--      "DEM-N". O contador em estado do app fica só para o modo mock.
--   3. Índice ÚNICO em `demands.number`: o banco recusa duplicata mesmo que
--      alguém grave por fora.
--   4. FKs `ON DELETE CASCADE` para `demands` nas tabelas que não tinham
--      (`resource_allocations` com certeza; `measurements`,
--      `logistic_allocations`, `evidences` se a introspecção mostrar que
--      faltam — cada bloco só cria se não existir FK naquela coluna).
--      `agenda_items.related_demand_id` com `ON DELETE SET NULL`.
--
--      ⚠️ TODAS as FKs entram como NOT VALID: linhas órfãs EXISTENTES ficam
--      como estão (não são validadas nem apagadas). A FK vale para inserts e
--      updates novos e para exclusões daqui em diante. Decisão: começamos
--      limpos a partir de agora; o histórico fica. NÃO rodar
--      `VALIDATE CONSTRAINT` sem antes decidir o destino dos órfãos.
--
-- Órfãos existentes na data da migration (contagem rodada pelo Bernardo —
-- colar o resultado abaixo para quem ler saber que existem e por que ficaram):
--   resource_allocations : ____
--   measurements         : ____
--   logistic_allocations : ____
--   evidences            : ____
--   agenda_items         : ____
--
-- Nenhuma linha existente é apagada ou alterada por esta migration. Nenhuma
-- coluna nova. Idempotente: CREATE ... IF NOT EXISTS onde o Postgres aceita;
-- DO blocks com teste de existência onde não aceita (mesma nota da 007/012/
-- 016/017/018). RLS de `demands` não muda: a função lê a sequence, não a tabela.
--
-- Numeração: a híbrida Nível 2, antes reservada como 019, passa a 020.


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) FKs que apontam para demands hoje (decide quais blocos do passo 4 agem):
--   select c.conrelid::regclass as tabela, c.conname, pg_get_constraintdef(c.oid)
--     from pg_constraint c
--    where c.contype = 'f' and c.confrelid = 'public.demands'::regclass
--    order by 1;
--
--   -- 2) maior número e existência da sequence (espera: número atual / 0 linhas):
--   select max(number) from public.demands;
--   select 1 from pg_class where relkind = 'S' and relname = 'demands_number_seq';
--
--   -- 3) duplicatas de number (espera 0 linhas; se houver, o índice único do
--   --    passo 3 FALHA — corrigir à mão antes):
--   select number, count(*) from public.demands group by number having count(*) > 1;
--
--   -- 4) órfãos (só para registrar no cabeçalho; NÃO apagar):
--   select 'resource_allocations' t, count(*) from public.resource_allocations r where not exists (select 1 from public.demands d where d.id = r.demand_id)
--   union all select 'measurements', count(*) from public.measurements m where not exists (select 1 from public.demands d where d.id = m.demand_id)
--   union all select 'logistic_allocations', count(*) from public.logistic_allocations l where not exists (select 1 from public.demands d where d.id = l.demand_id)
--   union all select 'evidences', count(*) from public.evidences e where not exists (select 1 from public.demands d where d.id = e.demand_id)
--   union all select 'agenda_items', count(*) from public.agenda_items a where a.related_demand_id is not null and not exists (select 1 from public.demands d where d.id = a.related_demand_id);


-- ---------------------------------------------------------------------------
-- 1) SEQUENCE — iniciada em max(number) (ou 0 se a tabela estiver vazia)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.demands_number_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- setval só na PRIMEIRA aplicação (is_called = false significa que a sequence
-- nunca foi usada). Reexecutar a migration depois de o app já ter alocado
-- números NÃO pode rebobinar a sequence.
DO $$
DECLARE
  maior     bigint;
  ja_usada  boolean;
BEGIN
  SELECT is_called INTO ja_usada FROM public.demands_number_seq;
  IF NOT ja_usada THEN
    SELECT COALESCE(MAX(number), 0) INTO maior FROM public.demands;
    IF maior > 0 THEN
      -- is_called = true: o próximo nextval devolve maior + 1.
      PERFORM setval('public.demands_number_seq', maior, true);
      RAISE NOTICE '019: sequence posicionada em % (próximo = %)', maior, maior + 1;
    ELSE
      RAISE NOTICE '019: tabela vazia; sequence começa em 1';
    END IF;
  ELSE
    RAISE NOTICE '019: sequence já em uso; setval NÃO reaplicado';
  END IF;
END $$;

COMMENT ON SEQUENCE public.demands_number_seq IS
  'Número da demanda (DEM-N). Nunca reaproveita número: não volta após exclusão nem após insert falho. Alocado por allocate_demand_number().';

-- ---------------------------------------------------------------------------
-- 2) allocate_demand_number() — RPC chamada pelo app antes do insert
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para o usuário autenticado poder avançar a sequence sem
-- grant direto nela; search_path fixo (regra de segurança para definer).
-- Cada chamada consome um número, mesmo que o insert seguinte falhe — é o
-- preço de nunca repetir.
CREATE OR REPLACE FUNCTION public.allocate_demand_number()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT nextval('public.demands_number_seq');
$$;

COMMENT ON FUNCTION public.allocate_demand_number() IS
  'Próximo número de demanda (DEM-N) via sequence. Nunca reaproveita número, mesmo após exclusão ou insert falho.';

REVOKE ALL ON FUNCTION public.allocate_demand_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_demand_number() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) number único
-- ---------------------------------------------------------------------------
-- Falha se houver duplicata hoje (ver conferência prévia 3) — de propósito:
-- duplicata de number é exatamente o que esta migration existe para impedir.
CREATE UNIQUE INDEX IF NOT EXISTS demands_number_uq
  ON public.demands (number);

-- ---------------------------------------------------------------------------
-- 4) FKs para demands que faltavam — NOT VALID (órfãos existentes ficam)
-- ---------------------------------------------------------------------------
-- Um bloco por tabela. Cada um só age se (a) a tabela existir, (b) a coluna
-- existir e (c) NÃO houver nenhuma FK partindo daquela coluna para demands —
-- assim a migration é segura seja qual for o resultado da conferência 1.
DO $$
DECLARE
  alvo record;
  existe_fk boolean;
  nome text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('resource_allocations', 'demand_id',         'CASCADE'),
      ('measurements',         'demand_id',         'CASCADE'),
      ('logistic_allocations', 'demand_id',         'CASCADE'),
      ('evidences',            'demand_id',         'CASCADE'),
      ('agenda_items',         'related_demand_id', 'SET NULL')
    ) AS t(tabela, coluna, acao)
  LOOP
    -- (a) tabela e (b) coluna existem?
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = alvo.tabela AND column_name = alvo.coluna
    ) THEN
      RAISE NOTICE '019: % .% não existe — bloco ignorado', alvo.tabela, alvo.coluna;
      CONTINUE;
    END IF;

    -- (c) já existe FK desta coluna para demands?
    SELECT EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f'
         AND c.conrelid  = format('public.%I', alvo.tabela)::regclass
         AND c.confrelid = 'public.demands'::regclass
         AND a.attname   = alvo.coluna
    ) INTO existe_fk;

    IF existe_fk THEN
      RAISE NOTICE '019: %.% já tem FK para demands — mantida como está', alvo.tabela, alvo.coluna;
      CONTINUE;
    END IF;

    nome := alvo.tabela || '_' || alvo.coluna || '_demands_fkey';
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.demands (id) ON DELETE %s NOT VALID',
      alvo.tabela, nome, alvo.coluna, alvo.acao
    );
    RAISE NOTICE '019: FK % criada NOT VALID (ON DELETE %)', nome, alvo.acao;
  END LOOP;
END $$;


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
--   -- 1) sequence posicionada (last_value = max(number), is_called = true):
--   select last_value, is_called from public.demands_number_seq;
--   select max(number) from public.demands;
--
--   -- 2) a função existe, é definer e o authenticated pode executar:
--   select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'allocate_demand_number';
--   select has_function_privilege('authenticated', 'public.allocate_demand_number()', 'EXECUTE');
--
--   -- 3) índice único:
--   select indexname, indexdef from pg_indexes where tablename = 'demands' and indexname = 'demands_number_uq';
--
--   -- 4) FKs novas, NOT VALID (convalidated = false) — órfãos intocados:
--   select c.conrelid::regclass, c.conname, c.convalidated, pg_get_constraintdef(c.oid)
--     from pg_constraint c
--    where c.contype = 'f' and c.confrelid = 'public.demands'::regclass
--    order by 1;
--
--   -- 5) NÃO rodar: ALTER TABLE ... VALIDATE CONSTRAINT ... (decisão: histórico fica).
--
--   -- 6) teste funcional (consome 1 número; fazer só uma vez):
--   select public.allocate_demand_number();
