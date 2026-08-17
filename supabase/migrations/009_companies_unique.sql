-- Migration 009: unicidade de empresas (nome e CNPJ)
--
-- Motivação: `companies` não tinha NENHUMA restrição de unicidade. Nada
-- impedia "Vale", "vale " e "VALE" coexistirem como três cadastros distintos.
-- Cada demanda aponta para o seu registro, então o cálculo nunca ficou errado
-- — o estrago é na conferência: a exportação de medição
-- (services/medicaoWorkbook.ts) agrupa a tarifa hora/aula por par
-- (instrutor, empresa), e a mesma cliente duplicada vira duas linhas na aba
-- Tarifas, exigindo preencher duas vezes e abrindo espaço para o mesmo
-- instrutor receber valores diferentes pela mesma empresa.
--
-- ÍNDICES DE EXPRESSÃO, não UNIQUE de coluna: um UNIQUE cru em `name` não
-- barraria "Vale" vs "vale ", que é exatamente o caso a impedir.

-- ---------------------------------------------------------------------------
-- 1) Nome — único por lower(btrim(name))
-- ---------------------------------------------------------------------------
-- Só normaliza caixa e espaços das pontas. Espaço interno duplicado
-- ("Vale  S.A." vs "Vale S.A.") continua passando — se virar problema, trocar
-- por regexp_replace(name, '\s+', ' ', 'g') numa migration futura.
--
-- Predicado parcial evita quebrar em eventual registro legado com nome vazio.
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_lower_unique_idx
  ON public.companies (lower(btrim(name)))
  WHERE btrim(coalesce(name, '')) <> '';

-- ---------------------------------------------------------------------------
-- 2) CNPJ — único por dígitos, permitindo ausência
-- ---------------------------------------------------------------------------
-- O formulário grava o CNPJ como o usuário digitou (o campo é texto livre,
-- com máscara só de placeholder). Um UNIQUE na coluna crua deixaria
-- "12.345.678/0001-90" e "12345678000190" coexistirem — mesmo CNPJ, duas
-- linhas. Por isso o índice é sobre os dígitos.
--
-- Antes: normaliza string vazia para NULL. O app já grava `cnpj || null`
-- (App.tsx), mas registros antigos podem ter ''; sem isso, dois cadastros sem
-- CNPJ colidiriam entre si.
UPDATE public.companies
   SET cnpj = NULL
 WHERE cnpj IS NOT NULL
   AND btrim(cnpj) = '';

-- Índice parcial: empresa sem CNPJ (NULL) fica de fora e pode se repetir
-- à vontade — só CNPJ efetivamente preenchido é comparado.
CREATE UNIQUE INDEX IF NOT EXISTS companies_cnpj_digits_unique_idx
  ON public.companies (regexp_replace(cnpj, '\D', '', 'g'))
  WHERE cnpj IS NOT NULL
    AND regexp_replace(cnpj, '\D', '', 'g') <> '';

-- ---------------------------------------------------------------------------
-- Conferência PRÉVIA (rodar antes de aplicar, se quiser evitar surpresa)
-- ---------------------------------------------------------------------------
-- A criação do índice único FALHA e faz rollback se já houver duplicata —
-- comportamento desejado, mas melhor descobrir antes:
--
--   -- duplicatas por nome normalizado
--   select lower(btrim(name)) as nome, count(*), array_agg(id)
--     from public.companies
--    where btrim(coalesce(name,'')) <> ''
--    group by 1 having count(*) > 1;
--
--   -- duplicatas por CNPJ (só dígitos) — pega variação de máscara,
--   -- que a conferência por string crua NÃO pega
--   select regexp_replace(cnpj, '\D', '', 'g') as cnpj_digitos,
--          count(*), array_agg(id)
--     from public.companies
--    where cnpj is not null
--      and regexp_replace(cnpj, '\D', '', 'g') <> ''
--    group by 1 having count(*) > 1;
--
-- ---------------------------------------------------------------------------
-- Conferência PÓS-migração
-- ---------------------------------------------------------------------------
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and tablename = 'companies'
--      and indexname in ('companies_name_lower_unique_idx',
--                        'companies_cnpj_digits_unique_idx');
