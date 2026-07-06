-- Migration 005: CPF do instrutor
-- Campo opcional (instrutores antigos podem não ter CPF cadastrado ainda).
-- Armazena somente dígitos (11 chars); a máscara de exibição é aplicada no front-end.
-- Índice único parcial evita CPF duplicado entre instrutores, sem afetar registros com cpf = NULL.

ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS cpf text;

CREATE UNIQUE INDEX IF NOT EXISTS instructors_cpf_unique_idx
  ON instructors (cpf)
  WHERE cpf IS NOT NULL;
