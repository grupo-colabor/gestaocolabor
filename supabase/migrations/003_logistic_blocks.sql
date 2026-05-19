-- Migration 003: tabela logistic_blocks para suporte a múltiplos blocos de logística por demanda
-- Cada linha representa um bloco de locomoção OU hospedagem para um instrutor específico.
-- A tabela logistic_allocations (1:1 por demanda) permanece inalterada — é usada pelo checklist operacional.

CREATE TABLE IF NOT EXISTS logistic_blocks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id              text NOT NULL,
  block_type             text NOT NULL CHECK (block_type IN ('LOCOMOCAO', 'HOSPEDAGEM')),
  block_order            integer NOT NULL DEFAULT 0,
  instructor_name        text,

  -- Campos de Locomoção (nulos quando block_type = 'HOSPEDAGEM')
  transport_mode         text,
  rental_company         text,
  rental_agency_location text,
  rental_locator         text,
  car_category           text,
  rental_check_in        timestamptz,
  rental_check_out       timestamptz,

  -- Campos de Hospedagem (nulos quando block_type = 'LOCOMOCAO')
  lodging_mode           text,
  hotel_city             text,
  hotel_name             text,
  hotel_check_in         date,
  hotel_check_out        date,
  hotel_payment          text,

  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

-- Índice para queries por demanda + tipo + ordem
CREATE INDEX IF NOT EXISTS idx_logistic_blocks_demand_type_order
  ON logistic_blocks (demand_id, block_type, block_order);

-- RLS: habilitar e permitir acesso a usuários autenticados
ALTER TABLE logistic_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistic_blocks: authenticated users full access"
  ON logistic_blocks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
