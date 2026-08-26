-- Migration 015: Seed da base operacional 'locaisDemandasInternas'
--
-- Cria (por seed, não por DDL) a base "Local de Demanda Interna" em Cadastros →
-- Bases Operacionais. Como toda base operacional, ela vive em
-- `operational_bases_items` (base_key, value) — não há tabela nem coluna nova.
-- O registro da chave no app (types.ts / constants.ts / BASE_LABELS) já faz a
-- lista aparecer na tela com o CRUD genérico das demais.
--
-- ---------------------------------------------------------------------------
-- Divisão de papéis: lista ≠ cascata
-- ---------------------------------------------------------------------------
-- Esta lista alimenta APENAS as SUGESTÕES (datalist) do campo Local do
-- formulário de demanda interna.
--
-- A CASCATA — Local → Corredor / Estado / Região — continua sendo resolvida
-- pelas `location_associations` com contexto = 'interna', e NADA nela muda.
--
-- Consequência esperada, não é bug: um local novo adicionado só nesta lista
-- aparece como sugestão mas NÃO preenche corredor/estado/região sozinho, porque
-- não existe associação para ele. É exatamente o mesmo comportamento da dupla
-- `locaisTreinamento` + `location_associations` no formulário de cliente. Para
-- o local novo também alimentar a cascata, é preciso cadastrar a associação
-- correspondente em Cadastros → Associações de Local.
--
-- ⚠️ `operational_bases_items` foi criada no dashboard e não está versionada em
-- nenhuma migration (mesma dívida registrada na 013). Os INSERTs abaixo mandam
-- exatamente as duas colunas que o app já manda em updateOperationalBase.

-- ---------------------------------------------------------------------------
-- 1) Seed a partir das associações internas
-- ---------------------------------------------------------------------------
-- Todo local que já é usado no contexto interno vira sugestão. O DISTINCT evita
-- repetir o mesmo local associado a mais de um corredor/UF.
--
-- Idempotente: o NOT EXISTS impede duplicar numa segunda execução e preserva
-- qualquer local que o usuário já tenha cadastrado à mão pela tela.
INSERT INTO operational_bases_items (base_key, value)
SELECT DISTINCT 'locaisDemandasInternas', la.local
FROM location_associations la
WHERE la.contexto = 'interna'
  AND la.local IS NOT NULL
  AND btrim(la.local) <> ''
  AND la.local <> 'N/A'
  AND NOT EXISTS (
    SELECT 1 FROM operational_bases_items o
    WHERE o.base_key = 'locaisDemandasInternas' AND o.value = la.local
  );

-- ---------------------------------------------------------------------------
-- 2) Seed dos 3 escritórios
-- ---------------------------------------------------------------------------
-- Locais fixos da Colabor: são destino recorrente de demanda interna e não
-- dependem de associação existir. Mesmo padrão idempotente da 013.
INSERT INTO operational_bases_items (base_key, value)
SELECT 'locaisDemandasInternas', v
FROM (VALUES
  ('Escritório BH'),
  ('Escritório Alphaville'),
  ('Escritório Vitória')
) AS seed(v)
WHERE NOT EXISTS (
  SELECT 1 FROM operational_bases_items o
  WHERE o.base_key = 'locaisDemandasInternas' AND o.value = seed.v
);

-- ---------------------------------------------------------------------------
-- Conferência pós-migração
-- ---------------------------------------------------------------------------
-- a) A base ficou populada (lista final, em ordem):
--   select value from operational_bases_items
--    where base_key = 'locaisDemandasInternas' order by value;
--
-- b) Quantidade esperada = distintos das associações internas + escritórios
--    que ainda não estavam lá. Para conferir a origem:
--   select count(distinct local) as locais_assoc_internas
--     from location_associations
--    where contexto = 'interna' and local is not null
--      and btrim(local) <> '' and local <> 'N/A';
--
-- c) Nenhum valor duplicado (espera 0 linhas):
--   select value, count(*) from operational_bases_items
--    where base_key = 'locaisDemandasInternas'
--    group by value having count(*) > 1;
--
-- d) Os 3 escritórios entraram (espera 3 linhas):
--   select value from operational_bases_items
--    where base_key = 'locaisDemandasInternas'
--      and value in ('Escritório BH','Escritório Alphaville','Escritório Vitória');
--
-- e) Locais da lista SEM associação interna — são os que não disparam cascata.
--    Não é erro: é o comportamento documentado acima. Serve para o time saber
--    quais precisariam de associação se quiserem o preenchimento automático:
--   select o.value
--     from operational_bases_items o
--    where o.base_key = 'locaisDemandasInternas'
--      and not exists (
--        select 1 from location_associations la
--         where la.contexto = 'interna' and la.local = o.value
--      )
--    order by o.value;
--
-- Rollback (se precisar desfazer o seed inteiro):
--   delete from operational_bases_items where base_key = 'locaisDemandasInternas';
