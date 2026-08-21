-- Migration 013: Descrição da demanda interna + base de categorias
--
-- Complementa a 012 (tipo/categoria_interna/horas_previstas). São duas coisas
-- independentes no mesmo arquivo porque as duas nascem da mesma tela (o form de
-- demanda interna) e não fazem sentido separadas: sem a base de categorias o
-- select do form fica vazio.
--
-- Fase 3 de 5.

-- ---------------------------------------------------------------------------
-- 1) demands.descricao_interna
-- ---------------------------------------------------------------------------
-- Descrição curta da demanda interna (ex: "Organizar van para Brucutu").
-- É o que aparece na listagem/exports no lugar do nome do treinamento.
-- Obrigatoriedade garantida no app (form), não em CHECK — para não travar
-- flexibilidade futura.
--
-- Sem backfill: coluna nova e, hoje, nenhuma linha tem tipo='interna'. Demanda
-- de cliente mantém o campo nulo — quem nomeia essas é o treinamento.
ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS descricao_interna text NULL;

-- ---------------------------------------------------------------------------
-- 2) Seed da base operacional 'categoriasInternas'
-- ---------------------------------------------------------------------------
-- As bases operacionais vivem em `operational_bases_items` (base_key, value) —
-- mesma tabela e mesmo mecanismo de todas as outras listas do app, então a base
-- nova já aparece na tela de Bases Operacionais e já é editável por lá (o
-- updateOperationalBase apaga e recria as linhas da key).
--
-- Idempotente: o NOT EXISTS evita duplicar se a migration rodar duas vezes, e
-- preserva qualquer categoria que o usuário já tenha cadastrado à mão.
--
-- ⚠️ `operational_bases_items` foi criada no dashboard e não está versionada em
-- nenhuma migration (mesma dívida das policies que a 012 acertou). O INSERT
-- abaixo manda exatamente as duas colunas que o app já manda em
-- updateOperationalBase, então não depende de nada que não esteja em uso hoje.
INSERT INTO operational_bases_items (base_key, value)
SELECT 'categoriasInternas', v
FROM (VALUES
  ('Visita'),
  ('SIPAT'),
  ('Apoio Logístico'),
  ('Evento'),
  ('Outro')
) AS seed(v)
WHERE NOT EXISTS (
  SELECT 1 FROM operational_bases_items o
  WHERE o.base_key = 'categoriasInternas' AND o.value = seed.v
);

-- ---------------------------------------------------------------------------
-- Conferência pós-migração
-- ---------------------------------------------------------------------------
-- Coluna nova (espera 1 linha, is_nullable = YES):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'demands' and column_name = 'descricao_interna';
--
-- Seed das categorias (espera 5 linhas):
--   select value from operational_bases_items
--    where base_key = 'categoriasInternas' order by value;
