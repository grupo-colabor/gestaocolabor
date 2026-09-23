-- Migration 022: modelos de medição por empresa (measurement_templates)
--
-- Contexto (Exportações, Etapa 3): até aqui, o layout de medição que um
-- cliente exige vivia em CÓDIGO (domain/exports/templates/vale.ts). Cada
-- cliente novo era um commit. Esta tabela guarda o que a equipe de operação
-- configura sozinha na tela: qual planilha é o arquivo-base, qual aba, onde
-- está o cabeçalho, e o que cada coluna recebe (`mapping jsonb`, montado e
-- validado por domain/exports/templates/mapping.ts).
--
-- Uma linha = um MODELO de uma EMPRESA. O modelo ativo da empresa é o que a
-- aba Exportações oferece como módulo de medição dela.
--
--
-- ⚠️ A FK PARA `measurement_template_values` FOI DELIBERADAMENTE NÃO CRIADA
-- ===========================================================================
-- A nota da migration 017 (linhas 26-28) diz: "A Etapa 3 cria
-- `measurement_templates` e adiciona a FK com NOT VALID, sem reescrever esta
-- tabela." ESSA FK NÃO EXISTE. Ela foi DELIBERADAMENTE NÃO CRIADA, por decisão
-- de 18/09/2026. Se você chegou aqui vindo da 017 procurando a FK, a resposta
-- é esta seção — a 017 não está desatualizada, o plano é que mudou.
--
-- POR QUE NÃO:
--   1. O ganho hoje é NULO. Nenhum problema atual se resolve com ela:
--      `measurement_template_values` já é limpa pelo CASCADE de `demands` e
--      `trainings` (017), que são as referências que importam. A FK para o
--      template só protegeria contra um template apagado deixando valores
--      órfãos — linhas que ninguém lê, porque a leitura é sempre por
--      `template_id` de um template que existe.
--   2. O risco não se paga. Para a FK valer, os templates de CÓDIGO
--      ('vale-v1', 'vale-bm-v1') precisariam de uma linha nesta tabela antes
--      dela ser criada. Se esse seed falhar ou for esquecido, o próximo
--      "Salvar" do preço HH da Vale quebra EM PRODUÇÃO — e a Vale gera a
--      medição real do mês. Trocar um ganho nulo por esse risco é mau
--      negócio, ainda mais num app prestes a receber ~60 commits de uma vez.
--   3. Consequência aceita: `measurement_template_values.template_id` segue
--      TEXT solto, como desde a 017. Os templates de código continuam
--      existindo APENAS em código, sem linha fantasma aqui — esta tabela
--      guarda só os modelos do banco. Não existe `origin` nem `code_id`
--      justamente porque não há o que distinguir: tudo aqui é 'db'.
--      O id que vai para `template_id` é 'tpl:<uuid>' (mapping.ts,
--      `templateIdOf`), que não colide com 'vale-v1'.
--
-- COMO CRIAR A FK NO FUTURO, se algum dia ela pagar:
--   a) acrescentar `code_id text UNIQUE` e `origin text` a esta tabela;
--   b) INSERIR as linhas dos templates de código (code_id 'vale-v1' e
--      'vale-bm-v1'), com company_id nulo — o que exige afrouxar o NOT NULL
--      de company_id, hoje proposital;
--   c) só então ALTER TABLE measurement_template_values ADD CONSTRAINT ...
--      FOREIGN KEY (template_id) REFERENCES measurement_templates (code_id)
--      NOT VALID;
--   d) conferir que nenhuma linha de measurement_template_values ficou órfã
--      ANTES de qualquer VALIDATE CONSTRAINT.
-- A ordem (b) antes de (c) não é negociável: invertida, a FK recusa o seed.
--
--
-- ON DELETE RESTRICT EM `company_id`, NÃO CASCADE
-- ---------------------------------------------------------------------------
-- Apagar uma empresa não pode levar o modelo de medição dela em silêncio: é o
-- desenho do faturamento daquele cliente, e quem apaga a empresa quase nunca
-- quer isso. Que o banco RECUSE e a pessoa decida — mesmo espírito do
-- RESTRICT de `instructor_allocations.instructor_id` (016).
--
--
-- UM MODELO ATIVO POR EMPRESA
-- ---------------------------------------------------------------------------
-- Índice ÚNICO PARCIAL `(company_id) WHERE is_active`, o mesmo mecanismo de
-- `export_presets_default_uq` (021): um índice parcial simples só aceleraria a
-- busca; o único é o que IMPEDE dois ativos, seja qual for o caminho de
-- escrita.
--
-- Consequência: trocar o modelo ativo é desativar um e ativar outro, e pelo
-- PostgREST isso seriam duas chamadas — com uma janela entre elas em que a
-- empresa fica SEM modelo ativo (o módulo dela sumiria da aba). Por isso esta
-- migration também cria a função `set_active_measurement_template`, que faz as
-- duas coisas numa transação só. Ver a seção 5.
--
--
-- RLS: "QUALQUER AUTENTICADO", COMO A 017 — E ONDE ESTÁ O GATE DE VERDADE
-- ---------------------------------------------------------------------------
-- Modelo de medição é DADO DA OPERAÇÃO, não preferência pessoal: o modelo da
-- Gerdau é o mesmo para toda a equipe, e quem o configurou não é dono dele.
-- Por isso as policies são as da 012/016/017 (qualquer autenticado), e NÃO as
-- de dono da 021 (`export_presets`), onde o nome que o analista dá ao recorte
-- dele é preferência pessoal de verdade.
--
-- O GATE REAL é de UI: o módulo de medição por empresa exige
-- `requiredView: 'measurement'` (domain/exports/registry.ts), que o analista
-- não tem. O banco não sabe disso — a mesma ressalva do cabeçalho do registry:
-- RLS por papel é a leva de segurança e continua pendente.
--
-- GRANT explícito à role `authenticated`, como a 021 acabou precisando: RLS só
-- filtra linhas; sem o privilégio na tabela a role nem chega às policies
-- (permission denied).
--
-- O BUCKET TEM POLÍTICA PRÓPRIA, SEPARADA DESTA RLS. `storage_bucket` e
-- `storage_path` aqui são só texto: quem protege o ARQUIVO é a policy do
-- Storage sobre `storage.objects`, que não se escreve nesta migration (o
-- bucket é criado no painel do Supabase — ver a conferência prévia 3).
-- Tabela liberada não significa arquivo liberado, e vice-versa.
--
-- AS POLICIES DO BUCKET ESTÃO VERSIONADAS, EM OUTRO ARQUIVO:
--   supabase/policies/022_measurement_templates_storage.sql
-- São as quatro aplicadas em produção em 23/09/2026 pelo SQL Editor. Ficam
-- fora desta migration porque vivem em `storage.objects`, do schema `storage`
-- — juntá-las aqui faria a migration falhar por permissão onde quem aplica
-- não é dono dessa tabela, e a tabela da aplicação nem chegaria a nascer.
-- APLICAR A 022 NÃO BASTA: o arquivo de policies é o segundo passo, e a
-- conferência prévia 4 abaixo é onde se descobre que ele falta.
--
--
-- TIPO DE `companies.id`
-- ---------------------------------------------------------------------------
-- A DDL de `companies` não está versionada (só os índices de unicidade, na
-- 009). Em vez de chutar uuid, o bloco DO da seção 2 LÊ o tipo em pg_attribute
-- e cria `company_id` com exatamente esse tipo antes de declarar a FK —
-- mesma técnica que a 017 usou para `trainings.id`. Aparece como NOTICE.
--
-- `updated_at` é gravado pelo SERVIÇO em cada UPDATE: este repositório não tem
-- trigger nenhum, de propósito (016:329, reafirmado na 021), e esta migration
-- não abre a exceção.
--
-- Numeração: a 020 continua reservada para a híbrida Nível 2 (nota da 019);
-- 021 é `export_presets`; esta é a 022.
--
-- Idempotente: CREATE ... IF NOT EXISTS onde o Postgres aceita; DO blocks para
-- as constraints (ALTER TABLE ADD CONSTRAINT não tem IF NOT EXISTS); policies
-- derrubadas e recriadas (CREATE POLICY não aceita IF NOT EXISTS — mesma nota
-- da 007/012/016/017/021); função com CREATE OR REPLACE. Nenhuma linha
-- existente é tocada: a tabela nasce aqui.


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) a tabela ainda não existe (espera 0 linhas):
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'measurement_templates';
--
--   -- 2) tipo real de companies.id (o bloco DO da seção 2 usa o mesmo valor):
--   select format_type(a.atttypid, a.atttypmod)
--     from pg_attribute a
--    where a.attrelid = 'public.companies'::regclass and a.attname = 'id';
--
--   -- 3) O BUCKET `measurement-templates` EXISTE E É PRIVADO.
--   --    Esta migration NÃO cria bucket: buckets são criados no painel do
--   --    Supabase (Storage > New bucket), com "Public bucket" DESMARCADO.
--   --    Espera 1 linha com public = false:
--   select id, name, public, file_size_limit, created_at
--     from storage.buckets
--    where id = 'measurement-templates';
--   --    Se vier 0 linhas: crie o bucket antes de aplicar. Se vier
--   --    public = true: o arquivo-base de todo cliente ficaria acessível por
--   --    URL adivinhável — torne-o privado antes de seguir.
--
--   -- 4) AS POLICIES DO BUCKET EXISTEM (o app lê por URL assinada e escreve
--   --    autenticado). Espera 4 linhas — SELECT, INSERT, UPDATE e DELETE:
--   select polname, polcmd from pg_policy
--    where polrelid = 'storage.objects'::regclass
--      and polname ilike '%measurement-templates%'
--    order by polcmd;
--   --    SE VOLTAR 0 POLICIES, PARE e aplique
--   --    supabase/policies/022_measurement_templates_storage.sql ANTES.
--   --    Sem elas a tabela nasce certa e o app continua quebrado: o envio da
--   --    planilha falha com "new row violates row-level security policy", e
--   --    todo modelo por empresa fica sem arquivo-base — isto é, sem gerar.
--   --    (Filtrar pelo NOME e não pela expressão é de propósito: a policy de
--   --    INSERT não tem USING, só WITH CHECK, e sumiria de uma busca por
--   --    `polqual`.)
--
--   -- 5) a role `authenticated` existe (espera 1 linha):
--   select rolname from pg_roles where rolname = 'authenticated';
--
--   -- 6) uma empresa real para os testes funcionais da pós-migração:
--   select id, name from public.companies order by name limit 2;


-- ---------------------------------------------------------------------------
-- 1) Tabela (sem company_id — entra na seção 2, com o tipo introspectado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measurement_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nome do MODELO ("orçamento 2027"), para a lista de gerenciamento. O rótulo
  -- do módulo na aba vem da EMPRESA ("Medição Gerdau"), não daqui.
  name             text        NOT NULL,
  -- Onde está o arquivo-base enviado. NULL enquanto ninguém subiu planilha:
  -- o modelo existe, mas ainda não gera (o escritor exige o arquivo).
  storage_bucket   text        NULL,
  storage_path     text        NULL,
  -- Aba de dados e o recorte dela, confirmados por quem configurou. NULL
  -- enquanto o mapeamento não foi feito.
  sheet_name       text        NULL,
  header_row       integer     NULL,
  first_data_row   integer     NULL,
  -- O mapeamento: { v, sheetName, headerRow, firstDataRow, columns[],
  -- constants[], totals[], checks? }. Quem valida é o domínio ao ler —
  -- config ilegível vira aviso na tela, nunca exceção.
  mapping          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Impressão digital do arquivo-base no momento do mapeamento (aba, linha do
  -- cabeçalho e os textos exatos dos cabeçalhos). Serve para detectar TROCA do
  -- arquivo: com colunas diferentes, o mapeamento continuaria "funcionando" e
  -- escreveria na coluna errada. A tela compara e exige reconfirmação.
  base_fingerprint jsonb       NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NULL DEFAULT auth.uid()
);

COMMENT ON TABLE  public.measurement_templates                  IS 'Modelos de medição por empresa, configurados pela operação (Etapa 3, 022). Só modelos do banco; vale-v1 e vale-bm-v1 seguem em código.';
COMMENT ON COLUMN public.measurement_templates.name             IS 'Nome do modelo para a lista de gerenciamento. O rótulo do módulo vem da empresa.';
COMMENT ON COLUMN public.measurement_templates.mapping          IS 'Mapeamento coluna->origem (domain/exports/templates/mapping.ts). Versão 1: { v, sheetName, headerRow, firstDataRow, columns[], constants[], totals[] }.';
COMMENT ON COLUMN public.measurement_templates.base_fingerprint IS 'Aba + linha do cabeçalho + textos dos cabeçalhos no momento do mapeamento, para detectar troca do arquivo-base.';
COMMENT ON COLUMN public.measurement_templates.is_active        IS 'No máximo um ativo por empresa — índice único parcial measurement_templates_ativo_uq.';


-- ---------------------------------------------------------------------------
-- 2) company_id com o tipo de companies.id + FK RESTRICT, por introspecção
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tipo_id text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO tipo_id
    FROM pg_attribute a
   WHERE a.attrelid = 'public.companies'::regclass
     AND a.attname  = 'id'
     AND NOT a.attisdropped;

  IF tipo_id IS NULL THEN
    RAISE EXCEPTION '022: não foi possível ler o tipo de public.companies.id';
  END IF;

  RAISE NOTICE '022: companies.id é %', tipo_id;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.measurement_templates'::regclass
       AND attname  = 'company_id'
       AND NOT attisdropped
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.measurement_templates ADD COLUMN company_id %s NOT NULL',
      tipo_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'measurement_templates_company_fk'
       AND conrelid = 'public.measurement_templates'::regclass
  ) THEN
    ALTER TABLE public.measurement_templates
      ADD CONSTRAINT measurement_templates_company_fk
      FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.measurement_templates.company_id IS 'Empresa cujas demandas o modelo mede. RESTRICT: apagar a empresa não leva o modelo em silêncio.';


-- ---------------------------------------------------------------------------
-- 3) Integridade
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'measurement_templates_name_check'
       AND conrelid = 'public.measurement_templates'::regclass
  ) THEN
    ALTER TABLE public.measurement_templates
      ADD CONSTRAINT measurement_templates_name_check
      CHECK (length(btrim(name)) BETWEEN 1 AND 120);
  END IF;

  -- header_row e first_data_row são NULL enquanto o mapeamento não foi feito;
  -- CHECK com NULL resulta em NULL, que o Postgres aceita. Quando têm valor,
  -- os dados vêm DEPOIS do cabeçalho — um modelo com a ordem invertida
  -- escreveria por cima do cabeçalho do cliente.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'measurement_templates_header_row_check'
       AND conrelid = 'public.measurement_templates'::regclass
  ) THEN
    ALTER TABLE public.measurement_templates
      ADD CONSTRAINT measurement_templates_header_row_check
      CHECK (header_row >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'measurement_templates_first_data_row_check'
       AND conrelid = 'public.measurement_templates'::regclass
  ) THEN
    ALTER TABLE public.measurement_templates
      ADD CONSTRAINT measurement_templates_first_data_row_check
      CHECK (first_data_row > header_row);
  END IF;
END $$;

-- Nome único por empresa, sem diferenciar caixa nem espaço das pontas — mesma
-- ideia dos índices de expressão da 009 em `companies`, e o mesmo espírito do
-- `export_presets_uq` (021), que é UNIQUE (user_id, dataset_id, name). Feito
-- como ÍNDICE e não como constraint porque UNIQUE de coluna não normaliza, e
-- "Orçamento 2027" vs "orçamento 2027 " seriam dois modelos na mesma lista.
-- Consequência para quem duplica um modelo: o serviço tem de dar um nome novo
-- ("… (cópia)"), e dá.
CREATE UNIQUE INDEX IF NOT EXISTS measurement_templates_nome_uq
  ON public.measurement_templates (company_id, lower(btrim(name)));

-- UM ATIVO POR EMPRESA. Único, não só parcial: é o que impede dois, venha a
-- escrita de onde vier. Mesmo mecanismo de export_presets_default_uq (021).
CREATE UNIQUE INDEX IF NOT EXISTS measurement_templates_ativo_uq
  ON public.measurement_templates USING btree (company_id)
  WHERE is_active;

-- Leitura da aba: os modelos de uma empresa, e a varredura dos ativos que o
-- registro dinâmico faz ao montar os módulos.
CREATE INDEX IF NOT EXISTS measurement_templates_company_idx
  ON public.measurement_templates USING btree (company_id, is_active);


-- ---------------------------------------------------------------------------
-- 4) RLS — 4 policies, formato da 012/016/017 (qualquer autenticado)
-- ---------------------------------------------------------------------------
-- Ver o cabeçalho: dado da operação, não preferência pessoal. O gate por papel
-- é de UI (requiredView 'measurement'), e o ARQUIVO é protegido pela policy do
-- bucket, não por esta.
ALTER TABLE public.measurement_templates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_templates TO authenticated;

DROP POLICY IF EXISTS "Autenticados podem ler measurement_templates"       ON public.measurement_templates;
DROP POLICY IF EXISTS "Autenticados podem inserir measurement_templates"   ON public.measurement_templates;
DROP POLICY IF EXISTS "Autenticados podem atualizar measurement_templates" ON public.measurement_templates;
DROP POLICY IF EXISTS "Autenticados podem deletar measurement_templates"   ON public.measurement_templates;

CREATE POLICY "Autenticados podem ler measurement_templates"
  ON public.measurement_templates FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem inserir measurement_templates"
  ON public.measurement_templates FOR INSERT TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem atualizar measurement_templates"
  ON public.measurement_templates FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Autenticados podem deletar measurement_templates"
  ON public.measurement_templates FOR DELETE TO authenticated
  USING (auth.role() = 'authenticated');


-- ---------------------------------------------------------------------------
-- 5) Trocar o modelo ativo SEM JANELA — função, porque o PostgREST não tem
--    transação de várias chamadas
-- ---------------------------------------------------------------------------
-- Pelo PostgREST, "desativar o antigo" e "ativar o novo" seriam duas
-- requisições. Entre elas a empresa fica SEM modelo ativo, e o módulo dela
-- some da aba Exportações; se a segunda falhar, fica assim. Invertendo a
-- ordem é pior: o índice único recusaria o segundo ativo.
--
-- Uma FUNÇÃO roda inteira numa transação: as duas linhas mudam juntas ou
-- nenhuma muda. Nenhuma outra sessão enxerga zero ativos nem dois.
--
-- Os dois UPDATEs são SEPARADOS de propósito. Um único
-- `SET is_active = (id = p_id)` parece mais elegante e é ARMADILHA: com índice
-- único não adiável, o Postgres confere linha a linha durante o UPDATE e a
-- ordem das linhas não é definida — se a nova for atualizada antes da antiga,
-- viola. Desativar primeiro e ativar depois é determinístico.
--
-- SECURITY INVOKER (o padrão): a função roda com os privilégios de quem chama,
-- então a RLS acima continua valendo. Uma SECURITY DEFINER aqui seria um
-- buraco — daria a qualquer autenticado um caminho que ignora as policies.
CREATE OR REPLACE FUNCTION public.set_active_measurement_template(p_id uuid)
RETURNS public.measurement_templates
LANGUAGE plpgsql
AS $$
DECLARE
  v_company  text;
  v_resultado public.measurement_templates;
BEGIN
  SELECT company_id::text INTO v_company
    FROM public.measurement_templates
   WHERE id = p_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Modelo % não encontrado (ou sem permissão para lê-lo).', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.measurement_templates
     SET is_active = false, updated_at = now()
   WHERE company_id::text = v_company
     AND id <> p_id
     AND is_active;

  UPDATE public.measurement_templates
     SET is_active = true, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_resultado;

  IF v_resultado.id IS NULL THEN
    RAISE EXCEPTION 'Modelo % não foi ativado — verifique permissões (RLS).', p_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.set_active_measurement_template(uuid)
  IS 'Torna o modelo o ativo da empresa dele, desativando o anterior na MESMA transação. Ver a seção 5 da migration 022.';

REVOKE ALL ON FUNCTION public.set_active_measurement_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_measurement_template(uuid) TO authenticated;


-- ===========================================================================
-- CONFERÊNCIA PÓS-MIGRAÇÃO
-- ===========================================================================
-- 1) Colunas (espera 14: id, name, storage_bucket, storage_path, sheet_name,
--    header_row, first_data_row, mapping, base_fingerprint, is_active,
--    created_at, updated_at, created_by, company_id — esta com o tipo de
--    companies.id e NOT NULL):
--    select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'measurement_templates'
--     order by ordinal_position;
--
-- 2) Constraints (espera 5: pkey, fk para companies com ON DELETE RESTRICT, e
--    3 checks — name, header_row, first_data_row. O NOT NULL de company_id não
--    aparece aqui; confira-o na consulta 1, coluna is_nullable = NO):
--    select conname, contype, pg_get_constraintdef(oid)
--      from pg_constraint
--     where conrelid = 'public.measurement_templates'::regclass
--     order by conname;
--    -- Confira que o def da FK termina em "ON DELETE RESTRICT".
--
-- 3) Índices (espera 4: pkey, measurement_templates_nome_uq,
--    measurement_templates_ativo_uq com "WHERE is_active",
--    measurement_templates_company_idx):
--    select indexname, indexdef from pg_indexes
--     where schemaname = 'public' and tablename = 'measurement_templates'
--     order by indexname;
--
-- 4) RLS ligada e 4 policies (polcmd r/a/w/d):
--    select relrowsecurity from pg_class
--     where oid = 'public.measurement_templates'::regclass;   -- espera true
--    select polname, polcmd from pg_policy
--     where polrelid = 'public.measurement_templates'::regclass
--     order by polcmd;
--
-- 5) A função existe, é INVOKER e a role pode executá-la:
--    select p.proname, p.prosecdef as security_definer,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') as pode_executar
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'set_active_measurement_template';
--    -- Espera: security_definer = false, pode_executar = true.
--
--
-- 6) TESTE FUNCIONAL — DOIS ATIVOS NA MESMA EMPRESA DEVEM FALHAR.
--    Trocar <ID_EMPRESA> pelo id da conferência prévia 6. Tudo dentro de uma
--    transação com ROLLBACK: nada fica gravado.
--
--    begin;
--      insert into public.measurement_templates (company_id, name, is_active)
--        values ('<ID_EMPRESA>', 'teste-022-a', true);
--      insert into public.measurement_templates (company_id, name, is_active)
--        values ('<ID_EMPRESA>', 'teste-022-b', true);
--    rollback;
--    -- Esperado no SEGUNDO insert: ERROR duplicate key value violates unique
--    -- constraint "measurement_templates_ativo_uq".
--
--
-- 7) TESTE FUNCIONAL — A TROCA DE ATIVO PASSA, e sem janela.
--    begin;
--      insert into public.measurement_templates (company_id, name, is_active)
--        values ('<ID_EMPRESA>', 'teste-022-a', true);
--      insert into public.measurement_templates (company_id, name, is_active)
--        values ('<ID_EMPRESA>', 'teste-022-b', false)
--        returning id \gset novo_
--      select public.set_active_measurement_template(:'novo_id');
--      -- Espera exatamente 1 ativo, e que seja o "b":
--      select name, is_active from public.measurement_templates
--       where company_id = '<ID_EMPRESA>' and name like 'teste-022-%'
--       order by name;
--    rollback;
--    -- Esperado: teste-022-a = false, teste-022-b = true.
--    -- (Se o seu cliente SQL não tiver \gset, copie o id do primeiro insert
--    --  e cole na chamada da função.)
--
--
-- 8) TESTE FUNCIONAL — APAGAR EMPRESA COM MODELO É RECUSADO (RESTRICT).
--    begin;
--      insert into public.measurement_templates (company_id, name)
--        values ('<ID_EMPRESA>', 'teste-022-restrict');
--      delete from public.companies where id = '<ID_EMPRESA>';
--    rollback;
--    -- Esperado no DELETE: ERROR update or delete on table "companies"
--    -- violates foreign key constraint "measurement_templates_company_fk"
--    -- on table "measurement_templates".
--
--
-- 9) TESTE FUNCIONAL — first_data_row tem de vir DEPOIS do cabeçalho.
--    begin;
--      insert into public.measurement_templates
--        (company_id, name, is_active, header_row, first_data_row)
--        values ('<ID_EMPRESA>', 'teste-022-linhas', false, 3, 2);
--    rollback;
--    -- Esperado: ERROR new row violates check constraint
--    -- "measurement_templates_first_data_row_check".
