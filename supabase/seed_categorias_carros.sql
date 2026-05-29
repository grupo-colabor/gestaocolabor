-- Seed: Categorias de Carro em operational_bases_items
-- Execute no Supabase Dashboard > SQL Editor

INSERT INTO operational_bases_items (base_key, value)
VALUES
  ('categoriasCarros', 'Grupo B'),
  ('categoriasCarros', 'Grupo BE'),
  ('categoriasCarros', 'Grupo C'),
  ('categoriasCarros', 'Grupo CE'),
  ('categoriasCarros', 'Grupo CS'),
  ('categoriasCarros', 'Grupo F'),
  ('categoriasCarros', 'Grupo FH'),
  ('categoriasCarros', 'Grupo FS'),
  ('categoriasCarros', 'Grupo FX')
ON CONFLICT DO NOTHING;
