-- Migration 006: Horas práticas para treinamentos HÍBRIDOS
-- Em treinamento híbrido, só a parte presencial é ministrada por instrutor
-- (o restante é EAD, sem instrutor). practical_hours substitui a carga
-- horária nominal (hours) no cálculo de "Horas Concluídas" do Dashboard
-- para demandas HIBRIDO — ver domain/instructorHours.ts.
-- NULL = sem override cadastrado; o cálculo cai de volta para `hours`.

ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS practical_hours numeric;

-- Seed: únicos 4 treinamentos com demandas híbridas no banco (levantamento manual).
UPDATE trainings SET practical_hours = 4 WHERE id = '8e81814e-cae9-46c0-9d8a-b7fa8ff4e8fe'; -- NR 20 Intermediário
UPDATE trainings SET practical_hours = 8 WHERE id = '324cbf73-cfce-4dcf-94fd-917de1d209d4'; -- NR 05 CIPA
UPDATE trainings SET practical_hours = 8 WHERE id = '5dc1e125-96a4-4ff8-98e8-98f8e6c8ab8e'; -- CIPA Mineração
UPDATE trainings SET practical_hours = 4 WHERE id = 'e08ce314-7485-4b9a-bcbc-5414282b7fd7'; -- Ponte Rolante Reciclagem Híbrido
