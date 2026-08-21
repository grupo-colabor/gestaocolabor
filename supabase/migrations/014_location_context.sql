-- Migration 014: Contexto das associações de localidade
--
-- Até aqui `location_associations` era um conjunto único: a cascata
-- Local → Corredor → Estado → Região do formulário de demanda de cliente e a do
-- formulário de demanda interna liam exatamente as mesmas linhas. A partir de
-- agora são dois conjuntos independentes, discriminados por `contexto`.
--
-- Regra: local criado no contexto 'interna' não aparece na cascata do
-- formulário de cliente, e vice-versa. Hoje os dois conjuntos nascem idênticos
-- (item 3 copia tudo), mas divergem daí em diante.
--
-- Diferente da 012/013, esta tabela ESTÁ versionada — foi criada na 002, com
-- unique index em (local). Esse índice é o que impede a cópia do item 3 e
-- precisa ser recriado antes dela.

-- ---------------------------------------------------------------------------
-- 1) Coluna nova
-- ---------------------------------------------------------------------------
-- O DEFAULT 'cliente' backfilla as linhas existentes no próprio ALTER: tudo o
-- que existe hoje foi cadastrado para demanda de cliente, por definição.
ALTER TABLE location_associations
  ADD COLUMN IF NOT EXISTS contexto text NOT NULL DEFAULT 'cliente';

-- Domínio fechado, constraint nomeada (padrão da 012).
ALTER TABLE location_associations
  DROP CONSTRAINT IF EXISTS location_associations_contexto_check;
ALTER TABLE location_associations
  ADD CONSTRAINT location_associations_contexto_check
  CHECK (contexto IN ('cliente', 'interna'));

-- ---------------------------------------------------------------------------
-- 2) Unicidade agora é por (local, contexto)
-- ---------------------------------------------------------------------------
-- ⚠️ ORDEM IMPORTA: o índice antigo é UNIQUE em (local) sozinho. Enquanto ele
-- existir, o INSERT do item 3 falha na primeira linha copiada — 'Brucutu' já
-- existe como cliente e não poderia existir também como interna.
--
-- O app também depende disso: `upsertLocationAssociation` usa
-- onConflict: 'local,contexto', que exige um índice único exatamente sobre
-- essas duas colunas (o PostgREST resolve o ON CONFLICT pelo índice).
DROP INDEX IF EXISTS location_associations_local_uq;

CREATE UNIQUE INDEX IF NOT EXISTS location_associations_local_contexto_uq
  ON location_associations (local, contexto);

-- ---------------------------------------------------------------------------
-- 3) Seed: cópia integral do conjunto atual para o contexto 'interna'
-- ---------------------------------------------------------------------------
-- Os dois conjuntos começam idênticos porque a maioria dos locais coincide —
-- obrigar o usuário a recadastrar tudo do zero seria trabalho manual puro.
-- A separação vale da aplicação desta migration em diante.
--
-- Idempotente pelo NOT EXISTS (padrão da 013): rodar duas vezes não duplica, e
-- qualquer local que já tenha sido cadastrado à mão como 'interna' é preservado
-- com os valores que tiver — a cópia não sobrescreve nada.
INSERT INTO location_associations (local, regiao, corredor, uf, contexto)
SELECT src.local, src.regiao, src.corredor, src.uf, 'interna'
FROM location_associations src
WHERE src.contexto = 'cliente'
  AND NOT EXISTS (
    SELECT 1 FROM location_associations dst
    WHERE dst.local = src.local AND dst.contexto = 'interna'
  );

-- ---------------------------------------------------------------------------
-- Conferência pós-migração
-- ---------------------------------------------------------------------------
-- Coluna nova (espera 1 linha: text, NOT NULL, default 'cliente'):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'location_associations' and column_name = 'contexto';
--
-- Cópia completa (espera as duas contagens IGUAIS):
--   select contexto, count(*) from location_associations group by contexto;
--
-- Nenhum local ficou sem par (espera 0 linhas):
--   select local from location_associations where contexto = 'cliente'
--   except
--   select local from location_associations where contexto = 'interna';
--
-- Índices (espera location_associations_local_contexto_uq, e NÃO o _local_uq):
--   select indexname, indexdef from pg_indexes
--    where tablename = 'location_associations';
--
-- Constraint de domínio (espera location_associations_contexto_check):
--   select conname, convalidated from pg_constraint
--    where conrelid = 'public.location_associations'::regclass and contype = 'c';
