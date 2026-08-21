-- Migration 011: Endereço do instrutor
-- Campo opcional de texto livre (rua, número, bairro, cidade/UF, CEP em uma única string).
-- Complementa `residence_location`, que guarda apenas a localidade operacional (base/cidade
-- escolhida numa lista fechada) e não serve para correspondência ou deslocamento.
-- Sem backfill: coluna nova, preenchida manualmente no cadastro de instrutores.
-- Não estruturado de propósito (nada de CEP/cidade/UF separados) — o uso hoje é só exibição
-- e export; estruturar depois é uma migration nova, não um problema deste campo.

ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS address text NULL;
