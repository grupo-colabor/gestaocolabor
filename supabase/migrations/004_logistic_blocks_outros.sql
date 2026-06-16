-- Migration 004: suporte à opção "Outros" em LOGÍSTICA — LOCOMOÇÃO
-- Adiciona a descrição livre do meio de transporte quando transport_mode = 'OUTROS'.
-- Check-in/check-out de "Outros" reaproveitam rental_check_in/rental_check_out (já existentes).
--
-- Também garante receipt_url e hotel_receipt_urls: já são lidos/gravados pelo código
-- (Táxi/Carro Aplicativo e Hospedagem), mas não constavam na migration 003.
-- Uso de IF NOT EXISTS torna a aplicação segura independentemente do estado atual do banco.

ALTER TABLE logistic_blocks
  ADD COLUMN IF NOT EXISTS transport_other_description text;

ALTER TABLE logistic_blocks
  ADD COLUMN IF NOT EXISTS receipt_url text[];

ALTER TABLE logistic_blocks
  ADD COLUMN IF NOT EXISTS hotel_receipt_urls text[];
