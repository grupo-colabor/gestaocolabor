-- Seed: Regiões ativas em operational_bases_items
-- Execute no Supabase Dashboard > SQL Editor
-- "Sul" é omitido intencionalmente (status INATIVO no sistema)

INSERT INTO operational_bases_items (base_key, value)
VALUES
  ('regioes', 'Sudeste'),
  ('regioes', 'Norte'),
  ('regioes', 'Nordeste')
ON CONFLICT DO NOTHING;
