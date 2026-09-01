-- Migration 016: Participantes de demanda interna + DDL das tabelas de alocação
--
-- Duas partes num arquivo, com propósitos OPOSTOS de propósito:
--
--   PARTE A — versiona o que JÁ EXISTE em produção (`companion_allocations`,
--   `instructor_allocations`, `resource_allocations`), criadas à mão no
--   dashboard e nunca versionadas. Fidelidade absoluta: reproduz DDL criada
--   via dashboard, introspecção de 31/08/2026. ZERO mudança de comportamento
--   — inclusive as esquisitices (FKs duplicadas, dialetos de policy
--   divergentes, `text` onde as irmãs usam `timestamptz`). Corrigir qualquer
--   uma delas aqui transformaria "versionar" em "migrar", que é outra coisa
--   e merece outro arquivo.
--
--   Consequência prática: em produção a Parte A é inteiramente no-op (as três
--   tabelas já existem, e CREATE TABLE IF NOT EXISTS não toca em tabela
--   existente). Ela só produz efeito em ambiente NOVO — que é exatamente o
--   ponto: reproduzir produção do zero, coluna por coluna, sem depender de
--   alguém lembrar o que clicou no dashboard.
--
--   PARTE B — cria o que é NOVO: `demand_participants` (F1 da medição
--   multi-pessoa) e a coluna `logistic_blocks.instructor_id`.
--
-- Ordem importa: a Parte B referencia `demands (id, tipo)`, então o UNIQUE
-- dessa dupla é criado antes da tabela nova.
--
-- Idempotente por construção: rodar num banco que já tem tudo é no-op, exceto
-- pelas policies, que são derrubadas e recriadas idênticas (CREATE POLICY não
-- aceita IF NOT EXISTS no Postgres — mesma nota da 007 e da 012).


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
-- A Parte A foi escrita a partir da introspecção de `pg_constraint` e da
-- descrição de colunas/índices/policies. Duas conferências valem a pena:
--
--   -- 1) índices reais das três tabelas — deve devolver exatamente as 12
--   --    linhas que o bloco A.4 (mais os PKs e o único de A.3) reproduz
--   select tablename, indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename in ('companion_allocations', 'instructor_allocations',
--                        'resource_allocations')
--    order by tablename, indexname;
--
--   -- 2) policies reais, com predicado e with_check
--   select tablename, policyname, cmd, roles, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('companion_allocations', 'instructor_allocations',
--                        'resource_allocations')
--    order by tablename, cmd;


-- ###########################################################################
-- PARTE A — versionamento da DDL existente
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- A.1) companion_allocations
-- ---------------------------------------------------------------------------
-- Acompanhante (instrutor que acompanha uma demanda de CLIENTE sem ser o
-- titular). Alimentada pela Programação/agenda — `AllocationDrawer.tsx` e
-- `Logistics.tsx` — sempre com UMA LINHA POR DIA.
--
-- ⚠️ `start_date`/`end_date` são `text`, não `timestamptz`. É divergência real
-- em relação a `instructor_allocations` e `resource_allocations`, e está
-- reproduzida de propósito: o app grava aqui a string de parede
-- 'YYYY-MM-DDT08:00' (literal, ver AllocationDrawer.tsx:332-333) e a lê de
-- volta por fatia. Como `text`, ela NUNCA passou pela reinterpretação de fuso
-- que a coluna `timestamptz` impôs a `demands.start_date` (ver o cabeçalho de
-- domain/demandDateTime.ts). Trocar para timestamptz aqui seria uma
-- migração de dado disfarçada de versionamento — não é o escopo deste arquivo.
CREATE TABLE IF NOT EXISTS public.companion_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     text NOT NULL,
  instructor_id uuid NOT NULL,
  start_date    text NOT NULL,
  end_date      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT companion_allocations_demand_id_fkey
    FOREIGN KEY (demand_id) REFERENCES public.demands (id) ON DELETE CASCADE,
  CONSTRAINT companion_allocations_instructor_id_fkey
    FOREIGN KEY (instructor_id) REFERENCES public.instructors (id) ON DELETE RESTRICT
);


-- ---------------------------------------------------------------------------
-- A.2) instructor_allocations
-- ---------------------------------------------------------------------------
-- Alocação de instrutor por trecho de dias dentro da demanda. Fonte única das
-- horas ministradas (domain/instructorHours.ts) e, por consequência, da
-- planilha de pagamento.
--
-- ⚠️ `id` é `text` e vem GERADO NO APP (`ALOC-${Date.now()}`,
-- services/instructorAllocations.ts) — sem default no banco. É a única das
-- três tabelas com esse arranjo; as outras duas usam uuid com
-- gen_random_uuid(). Reproduzido como está.
--
-- ⚠️ AS QUATRO FKs ABAIXO SÃO DUAS, EM DUPLICATA. A introspecção de
-- 31/08/2026 devolveu `..._demand_fk` e `..._demand_id_fkey` com definição
-- IDÊNTICA, e o mesmo para o par de instrutor. É defeito herdado do cadastro
-- manual: cada INSERT/UPDATE paga a verificação duas vezes e cada DELETE em
-- `demands`/`instructors` percorre a checagem em dobro. Estão reproduzidas
-- porque a Parte A é fidelidade — a limpeza (dropar `..._demand_fk` e
-- `..._instructor_fk`, ficando com os nomes canônicos `_fkey`) é mudança de
-- schema e pertence a uma migration própria, com o app parado ou não,
-- decidido à parte.
CREATE TABLE IF NOT EXISTS public.instructor_allocations (
  id            text PRIMARY KEY,
  demand_id     text NOT NULL,
  instructor_id uuid NOT NULL,
  start_date    timestamptz NOT NULL,
  end_date      timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT instructor_allocations_demand_fk
    FOREIGN KEY (demand_id) REFERENCES public.demands (id) ON DELETE CASCADE,
  CONSTRAINT instructor_allocations_demand_id_fkey
    FOREIGN KEY (demand_id) REFERENCES public.demands (id) ON DELETE CASCADE,
  CONSTRAINT instructor_allocations_instructor_fk
    FOREIGN KEY (instructor_id) REFERENCES public.instructors (id) ON DELETE RESTRICT,
  CONSTRAINT instructor_allocations_instructor_id_fkey
    FOREIGN KEY (instructor_id) REFERENCES public.instructors (id) ON DELETE RESTRICT
);


-- ---------------------------------------------------------------------------
-- A.3) resource_allocations
-- ---------------------------------------------------------------------------
-- Alocação de recurso — hoje só `resource_type = 'CENTRO_TREINAMENTO_MOVEL'`.
--
-- ⚠️ SEM NENHUMA FK. A introspecção de `pg_constraint` devolveu APENAS
-- `resource_allocations_pkey` para esta tabela. Consequência real: apagar uma
-- demanda NÃO remove a alocação de CTM dela no banco — as irmãs têm
-- ON DELETE CASCADE, esta não. O app limpa o estado local
-- (App.tsx, deleteDemand) e a linha órfã sobrevive no banco, continuando a
-- ocupar o recurso na checagem de conflito (`hasResourceConflict` ignora
-- demanda CANCELADA, mas não sabe distinguir demanda APAGADA de inexistente).
-- Reproduzida sem FK por fidelidade; acrescentar a FK é correção de
-- comportamento e vai para migration própria.
CREATE TABLE IF NOT EXISTS public.resource_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     text NOT NULL,
  resource_type text NOT NULL,
  start_date    timestamptz NOT NULL,
  end_date      timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ ÍNDICE ÚNICO, não constraint UNIQUE — e a diferença é observável.
-- `resource_allocations_unique_ctm` NÃO apareceu na introspecção de
-- `pg_constraint` (que devolveu só o pkey), logo foi criado como
-- CREATE UNIQUE INDEX. Reproduzido do mesmo jeito, e não como
-- ADD CONSTRAINT ... UNIQUE, por dois motivos:
--   1. um ADD CONSTRAINT criaria uma linha em pg_constraint que hoje não
--      existe — deixaria de ser fidelidade;
--   2. `upsertResourceAllocation` usa onConflict: 'demand_id,resource_type',
--      e o PostgREST resolve o ON CONFLICT pelo ÍNDICE. Índice único basta —
--      é a mesma dependência que a 014 documenta para
--      location_associations_local_contexto_uq.
CREATE UNIQUE INDEX IF NOT EXISTS resource_allocations_unique_ctm
  ON public.resource_allocations USING btree (demand_id, resource_type);


-- ---------------------------------------------------------------------------
-- A.4) Índices secundários das três tabelas
-- ---------------------------------------------------------------------------
-- Nomes LITERAIS, tirados do `pg_indexes` de produção (introspecção de
-- 31/08/2026). O nome importa mais do que parece: `CREATE INDEX IF NOT EXISTS`
-- casa por NOME, não por definição — um nome chutado num banco onde o índice
-- já existe com outro nome não seria no-op, criaria um índice DUPLICADO e
-- dobraria o custo de escrita em silêncio.
--
-- E os nomes reais NÃO seguem um padrão único: `companion_allocations` usa
-- prefixo `idx_` e abrevia a coluna (`..._demand`, não `..._demand_id`;
-- `..._start`, não `..._start_date`), enquanto as outras duas usam sufixo
-- `..._idx` com o nome cheio. Foi por isso que a versão anterior deste bloco
-- testava por coluna em vez de por nome — chutar teria errado quatro dos oito.
--
-- Os `_pkey` não aparecem aqui: nascem junto com o PRIMARY KEY declarado nas
-- tabelas acima. O índice único `resource_allocations_unique_ctm` está em A.3,
-- ao lado da explicação de por que é ÍNDICE e não constraint.

-- companion_allocations — prefixo `idx_`, coluna abreviada
CREATE INDEX IF NOT EXISTS idx_companion_allocations_demand
  ON public.companion_allocations USING btree (demand_id);

CREATE INDEX IF NOT EXISTS idx_companion_allocations_instructor
  ON public.companion_allocations USING btree (instructor_id);

-- Índices em start_date/end_date, que aqui são `text` (ver A.1). Ordenação e
-- comparação saem em ordem lexicográfica — o que funciona porque o app grava
-- 'YYYY-MM-DDTHH:mm', formato em que a ordem de string é a ordem cronológica.
CREATE INDEX IF NOT EXISTS idx_companion_allocations_start
  ON public.companion_allocations USING btree (start_date);

CREATE INDEX IF NOT EXISTS idx_companion_allocations_end
  ON public.companion_allocations USING btree (end_date);

-- instructor_allocations — sufixo `_idx`, coluna sem o `_id`
CREATE INDEX IF NOT EXISTS instructor_allocations_demand_idx
  ON public.instructor_allocations USING btree (demand_id);

CREATE INDEX IF NOT EXISTS instructor_allocations_instructor_idx
  ON public.instructor_allocations USING btree (instructor_id);

-- resource_allocations — sufixo `_idx`, nome cheio da coluna
CREATE INDEX IF NOT EXISTS resource_allocations_demand_id_idx
  ON public.resource_allocations USING btree (demand_id);

CREATE INDEX IF NOT EXISTS resource_allocations_resource_type_idx
  ON public.resource_allocations USING btree (resource_type);


-- ---------------------------------------------------------------------------
-- A.5) RLS das três tabelas — três dialetos, reproduzidos como estão
-- ---------------------------------------------------------------------------
-- As três tabelas foram configuradas em momentos diferentes e cada uma ficou
-- com um dialeto. Nenhum é inseguro; a divergência é de estilo e de metadado.
-- Uniformizar é tentador e fica para depois — aqui o objetivo é que um
-- ambiente novo reproduza produção linha a linha.
--
-- Duas notas de leitura, para ninguém "consertar" o que não está quebrado:
--
--   • `TO public` com predicado `auth.role() = 'authenticated'` é
--     funcionalmente equivalente a `TO authenticated` com `true`: a policy é
--     AVALIADA para o papel anon e o predicado a reprova. Muda o plano, não o
--     resultado.
--
--   • UPDATE sem WITH CHECK não é buraco: o Postgres usa a expressão de USING
--     também como verificação da linha nova quando WITH CHECK é omitido. A
--     assimetria em `resource_allocations` é cosmética.

-- --- companion_allocations ---
-- Três policies no padrão "Autenticados podem ..." (TO public + auth.role())
-- e UMA no dialeto da 008 (TO authenticated + true) — a de UPDATE, que foi
-- acrescentada depois pela consolidação de buracos de RLS
-- (008_rls_gaps_consolidation.sql:39-40) e por isso destoa das outras três.
-- Reproduzidas exatamente assim.
ALTER TABLE public.companion_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados podem ler companion_allocations"      ON public.companion_allocations;
DROP POLICY IF EXISTS "Autenticados podem inserir companion_allocations"  ON public.companion_allocations;
DROP POLICY IF EXISTS "Autenticados podem deletar companion_allocations"  ON public.companion_allocations;
DROP POLICY IF EXISTS "Authenticated update companion_allocations"        ON public.companion_allocations;

CREATE POLICY "Autenticados podem ler companion_allocations"
  ON public.companion_allocations FOR SELECT TO public
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir companion_allocations"
  ON public.companion_allocations FOR INSERT TO public
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar companion_allocations"
  ON public.companion_allocations FOR DELETE TO public
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update companion_allocations"
  ON public.companion_allocations FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- --- instructor_allocations ---
-- Dialeto curto (ia_*), TO authenticated, predicado `true`.
ALTER TABLE public.instructor_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ia_select" ON public.instructor_allocations;
DROP POLICY IF EXISTS "ia_insert" ON public.instructor_allocations;
DROP POLICY IF EXISTS "ia_update" ON public.instructor_allocations;
DROP POLICY IF EXISTS "ia_delete" ON public.instructor_allocations;

CREATE POLICY "ia_select"
  ON public.instructor_allocations FOR SELECT TO authenticated USING (true);

CREATE POLICY "ia_insert"
  ON public.instructor_allocations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "ia_update"
  ON public.instructor_allocations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "ia_delete"
  ON public.instructor_allocations FOR DELETE TO authenticated USING (true);

-- --- resource_allocations ---
-- Quatro no padrão "Autenticados podem ..." (TO public + auth.role()), com o
-- UPDATE sem WITH CHECK. Ver a nota sobre a assimetria acima.
ALTER TABLE public.resource_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados podem ler resource_allocations"       ON public.resource_allocations;
DROP POLICY IF EXISTS "Autenticados podem inserir resource_allocations"   ON public.resource_allocations;
DROP POLICY IF EXISTS "Autenticados podem atualizar resource_allocations" ON public.resource_allocations;
DROP POLICY IF EXISTS "Autenticados podem deletar resource_allocations"   ON public.resource_allocations;

CREATE POLICY "Autenticados podem ler resource_allocations"
  ON public.resource_allocations FOR SELECT TO public
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir resource_allocations"
  ON public.resource_allocations FOR INSERT TO public
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem atualizar resource_allocations"
  ON public.resource_allocations FOR UPDATE TO public
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar resource_allocations"
  ON public.resource_allocations FOR DELETE TO public
  USING (auth.role() = 'authenticated');


-- ###########################################################################
-- PARTE B — o novo
-- ###########################################################################

-- ---------------------------------------------------------------------------
-- B.1) demands (id, tipo) UNIQUE — alvo da FK composta da Parte B.2
-- ---------------------------------------------------------------------------
-- `id` já é PK, então este UNIQUE é redundante para unicidade. Ele existe por
-- um motivo só: uma FK só pode apontar para colunas cobertas por UNIQUE ou PK,
-- e a validação "participante só existe em demanda interna" é feita por FK
-- composta (demand_id, tipo) -> demands (id, tipo). Ver B.2.
--
-- Custo: um índice B-tree a mais em `demands`. Em troca, a regra vira
-- declarativa e vale para qualquer caminho de escrita — app, dashboard ou
-- script de correção —, sem trigger (este repositório não tem nenhum) e sem
-- depender de validação em TypeScript.
--
-- Idempotência: ADD CONSTRAINT não aceita IF NOT EXISTS, e um
-- `DROP CONSTRAINT IF EXISTS` antes FALHARIA numa segunda execução, porque a
-- FK de `demand_participants` passa a depender deste UNIQUE. Daí o teste
-- explícito em pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname   = 'demands_id_tipo_uq'
       AND conrelid  = 'public.demands'::regclass
  ) THEN
    ALTER TABLE public.demands ADD CONSTRAINT demands_id_tipo_uq UNIQUE (id, tipo);
    RAISE NOTICE '016/B.1: constraint demands_id_tipo_uq criada';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- B.2) demand_participants
-- ---------------------------------------------------------------------------
-- Participante de demanda INTERNA: titular pleno, no mesmo nível do instrutor
-- principal — não é acompanhante de ninguém. Motivação: a equipe vinha
-- clonando uma interna por pessoa (5 demandas para uma reunião) porque a
-- interna comporta um instrutor só.
--
-- ⚠️ Esta tabela NÃO é `instructor_allocations` de propósito. Aquela modela
-- DIVISÃO de dias — `addInstructorAllocation` faz split destrutivo (o novo
-- alocado apaga os dias de quem já estava) e `computeInstructorHoursByDemand`
-- rateia a carga por (dias do instrutor / união dos dias alocados). Os dois
-- comportamentos são errados para participante: o split apagaria os
-- participantes uns dos outros (todos nos mesmos dias) e o rateio multiplicaria
-- as horas (2 pessoas no mesmo período de uma interna de 16h dariam 16h cada).
-- O pagamento virá dos blocos da medição (F2), nunca daqui.
--
-- PERÍODO: `start_date`/`end_date` são `date` — participação é por DIA. O
-- horário do card na agenda sai de getDayHorarioInicio/Fim (domain/demandDays),
-- que lê o horário real da demanda dia a dia. É deliberadamente diferente de
-- `companion_allocations`, que grava 'T08:00'/'T18:00' literais e por isso
-- mostra 08–18 até em demanda noturna. Usar `date` numa tabela que nasce agora
-- também mantém fora dela a classe inteira de bug de fuso.
--
-- NULL nos dois = participa do PERÍODO TODO da demanda.
CREATE TABLE IF NOT EXISTS public.demand_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     text NOT NULL,
  -- Discriminador redundante: existe só para compor a FK abaixo. O DEFAULT
  -- evita que o app precise mandá-lo, e o CHECK garante que ninguém o use
  -- como coluna de dado.
  tipo          text NOT NULL DEFAULT 'interna',
  instructor_id uuid NOT NULL,
  start_date    date NULL,
  end_date      date NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT demand_participants_tipo_check
    CHECK (tipo = 'interna'),

  -- Período é tudo-ou-nada (aprovado na revisão): meio período ("tem início,
  -- não tem fim") não tem significado definido para a agenda nem para o recorte
  -- de dias, e deixar a ambiguidade passar obrigaria cada leitor a adivinhar.
  -- O formulário valida antes do save, para o erro chegar amigável em vez de
  -- vir como violação de CHECK.
  CONSTRAINT demand_participants_periodo_check
    CHECK (
      (start_date IS NULL AND end_date IS NULL)
      OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date)
    ),

  CONSTRAINT demand_participants_uq
    UNIQUE (demand_id, instructor_id),

  -- ✅ A regra "participante só existe em demanda interna", declarativa.
  -- CHECK não cruza tabela (é o que a 012:36-43 já registra); trigger seria o
  -- primeiro do repositório. A FK composta resolve os dois sentidos:
  --   • inserir participante em demanda de cliente     -> falha;
  --   • virar uma demanda COM participantes para
  --     tipo='cliente'                                 -> falha (ON UPDATE RESTRICT).
  -- É a extensão natural do padrão discriminador que a 014 usou em
  -- location_associations.
  CONSTRAINT demand_participants_demand_fk
    FOREIGN KEY (demand_id, tipo) REFERENCES public.demands (id, tipo)
    ON DELETE CASCADE ON UPDATE RESTRICT,

  -- RESTRICT é a convenção das três tabelas irmãs (confirmado na introspecção
  -- de pg_constraint). Aqui ela também protege pagamento: o bloco da medição
  -- guardará `instructorId` em jsonb, sem FK — se o instrutor pudesse sumir,
  -- o bloco viraria órfão silencioso.
  CONSTRAINT demand_participants_instructor_fk
    FOREIGN KEY (instructor_id) REFERENCES public.instructors (id)
    ON DELETE RESTRICT
);

-- Índice em demand_id: leitura por demanda (form, agenda, listagem).
-- Índice em instructor_id: leitura por pessoa (conflito de agenda, cobertura
-- de ociosidade) — não é decorativo, é o lado que varre por instrutor.
-- O UNIQUE (demand_id, instructor_id) já cobre demand_id como prefixo, mas o
-- índice dedicado é mantido por simetria com as tabelas irmãs, que têm os dois.
CREATE INDEX IF NOT EXISTS demand_participants_demand_id_idx
  ON public.demand_participants USING btree (demand_id);

CREATE INDEX IF NOT EXISTS demand_participants_instructor_id_idx
  ON public.demand_participants USING btree (instructor_id);


-- ---------------------------------------------------------------------------
-- B.3) RLS de demand_participants — 4 policies, formato da 012
-- ---------------------------------------------------------------------------
-- Mesmo predicado das policies de `demands` (012:85-99): todas TO authenticated,
-- `auth.role() = 'authenticated'`, nenhuma filtra por coluna. Participante não
-- introduz nível de acesso novo — quem enxerga a demanda interna enxerga seus
-- participantes.
ALTER TABLE public.demand_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados podem ler demand_participants"       ON public.demand_participants;
DROP POLICY IF EXISTS "Autenticados podem inserir demand_participants"   ON public.demand_participants;
DROP POLICY IF EXISTS "Autenticados podem atualizar demand_participants" ON public.demand_participants;
DROP POLICY IF EXISTS "Autenticados podem deletar demand_participants"   ON public.demand_participants;

CREATE POLICY "Autenticados podem ler demand_participants"
  ON public.demand_participants FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir demand_participants"
  ON public.demand_participants FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem atualizar demand_participants"
  ON public.demand_participants FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar demand_participants"
  ON public.demand_participants FOR DELETE TO authenticated
  USING (auth.role() = 'authenticated');


-- ---------------------------------------------------------------------------
-- B.4) logistic_blocks.instructor_id
-- ---------------------------------------------------------------------------
-- Hoje o vínculo entre a pessoa e o bloco de logística é `instructor_name`,
-- coluna `text` preenchida à mão no formulário (003:10). Com participantes
-- vindos do cadastro, o bloco passa a ser criado JÁ associado a alguém — e
-- associar por nome quebra em silêncio quando o instrutor é renomeado, além
-- de não distinguir dois homônimos.
--
-- `instructor_name` continua existindo como rótulo de exibição e como fallback
-- das linhas legadas, que nunca terão `instructor_id`. Mesmo padrão de
-- "ausente = comportamento antigo" do `reembolsavel` na medição: nullable, sem
-- backfill, sem NOT NULL.
--
-- FK COM ON DELETE SET NULL (aprovado na revisão). `logistic_blocks` não tem
-- nenhuma FK hoje (003) — esta é a primeira, e é deliberadamente a mais
-- branda das três semânticas possíveis:
--
--   • RESTRICT bloquearia excluir um instrutor por causa de um bloco de
--     logística antigo — desproporcional, o bloco não é dado financeiro;
--   • CASCADE apagaria o bloco de logística junto com o instrutor, levando
--     embora locadora, localizador, hotel e notas fiscais anexadas;
--   • SET NULL preserva o bloco e devolve o vínculo ao estado legado — o
--     registro continua íntegro e `instructor_name` volta a ser o único
--     rótulo, exatamente como nas linhas anteriores a esta migration.
--
-- Ou seja: a exclusão de instrutor degrada o vínculo, nunca o dado.
ALTER TABLE public.logistic_blocks
  ADD COLUMN IF NOT EXISTS instructor_id uuid NULL;

-- Idempotência: ADD CONSTRAINT não aceita IF NOT EXISTS (mesma nota de B.1).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'logistic_blocks_instructor_fk'
       AND conrelid = 'public.logistic_blocks'::regclass
  ) THEN
    ALTER TABLE public.logistic_blocks
      ADD CONSTRAINT logistic_blocks_instructor_fk
      FOREIGN KEY (instructor_id) REFERENCES public.instructors (id)
      ON DELETE SET NULL;
    RAISE NOTICE '016/B.4: constraint logistic_blocks_instructor_fk criada';
  END IF;
END $$;

-- Índice necessário para o SET NULL: sem ele, todo DELETE em `instructors`
-- faz seq scan em `logistic_blocks` para achar as linhas a anular.
CREATE INDEX IF NOT EXISTS logistic_blocks_instructor_id_idx
  ON public.logistic_blocks USING btree (instructor_id);


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
--
-- 1) Tabela nova e suas colunas (espera 8 linhas):
--    select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'demand_participants'
--     order by ordinal_position;
--
-- 2) Constraints de demand_participants (espera 6: pkey, 2 checks, 1 unique,
--    2 fks — e a FK de demanda deve sair com "(demand_id, tipo)"):
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.demand_participants'::regclass
--     order by conname;
--
-- 3) O UNIQUE novo em demands (espera 1 linha):
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.demands'::regclass and conname = 'demands_id_tipo_uq';
--
-- 4) Policies das QUATRO tabelas (espera 4 + 4 + 4 + 4 = 16):
--    select tablename, policyname, cmd, roles
--      from pg_policies
--     where schemaname = 'public'
--       and tablename in ('demand_participants', 'companion_allocations',
--                         'instructor_allocations', 'resource_allocations')
--     order by tablename, cmd;
--
-- 5) Nenhum índice DUPLICADO foi criado pelo bloco A.4 (compare com o
--    pg_indexes da conferência prévia — a contagem por tabela deve ser a mesma):
--    select tablename, count(*) from pg_indexes
--     where schemaname = 'public'
--       and tablename in ('companion_allocations', 'instructor_allocations',
--                         'resource_allocations')
--     group by 1 order by 1;
--
-- 6) Coluna nova em logistic_blocks (espera 1 linha, uuid, YES):
--    select column_name, data_type, is_nullable
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'logistic_blocks'
--       and column_name = 'instructor_id';
--
--    -- e a FK dela (espera 1 linha, com ON DELETE SET NULL):
--    select conname, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.logistic_blocks'::regclass;
--
-- 7) TESTE FUNCIONAL da FK composta — as duas devem FALHAR.
--    Rodar dentro de uma transação e dar ROLLBACK:
--
--    begin;
--      -- (a) participante em demanda de CLIENTE -> erro de FK
--      insert into public.demand_participants (demand_id, instructor_id)
--      select d.id, i.id
--        from public.demands d, public.instructors i
--       where d.tipo = 'cliente' limit 1;
--    rollback;
--
--    -- (b) virar interna COM participante para cliente -> erro de FK
--    --
--    -- ⚠️ A ORDEM DAS VALIDAÇÕES IMPORTA, e derrubou a primeira versão deste
--    -- teste: um `update ... set tipo = 'cliente'` cru é barrado ANTES pelo
--    -- CHECK `demands_cliente_requires_refs` (012:57-62), que exige
--    -- company_id e training_id quando tipo='cliente'. O teste "falhava" e
--    -- parecia verde, mas pelo motivo errado — a FK composta nunca chegava a
--    -- ser avaliada. Por isso o UPDATE preenche as duas refs no mesmo
--    -- comando: aí o CHECK passa e quem barra é a FK, que é o que se quer
--    -- provar.
--    --
--    -- Os `order by id limit 1` deixam as duas etapas escolherem a MESMA
--    -- demanda (o INSERT não altera `demands`, então a subquery repetida
--    -- devolve a mesma linha). Pressupõe a tabela de participantes vazia ou
--    -- sem esse par instrutor+demanda — senão o INSERT bate no UNIQUE antes.
--    begin;
--      insert into public.demand_participants (demand_id, instructor_id)
--      select d.id, i.id
--        from (select id from public.demands
--               where tipo = 'interna' order by id limit 1) d,
--             (select id from public.instructors order by id limit 1) i;
--
--      update public.demands
--         set tipo        = 'cliente',
--             company_id  = (select id from public.companies order by id limit 1),
--             training_id = (select id from public.trainings order by id limit 1)
--       where id = (select id from public.demands
--                    where tipo = 'interna' order by id limit 1);
--    rollback;
--
--    -- Esperado em (b):
--    --   ERROR: update or delete on table "demands" violates foreign key
--    --   constraint "demand_participants_demand_fk" on table
--    --   "demand_participants"
--    --   DETAIL: Key (id, tipo)=(DEM-xxxx, interna) is still referenced
--    --   from table "demand_participants".
--    --
--    -- Esperado em (a): ERROR de insert or update on table
--    --   "demand_participants" violates foreign key constraint
--    --   "demand_participants_demand_fk" — DETAIL: Key (demand_id,
--    --   tipo)=(DEM-xxxx, interna) is not present in table "demands".
--    --   (a chave impressa é a da LINHA NOVA: tipo vem do DEFAULT 'interna',
--    --   e o par não existe porque aquela demanda é de cliente.)
