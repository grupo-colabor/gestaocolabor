-- Migration: location_associations
-- Tabela de associações Local de Treinamento → Corredor → Estado (UF) → Região

CREATE TABLE IF NOT EXISTS location_associations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  local text NOT NULL,
  regiao text NOT NULL DEFAULT '',
  corredor text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS location_associations_local_uq
  ON location_associations (local);

ALTER TABLE location_associations ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Authenticated read location_associations"
  ON location_associations FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Authenticated insert location_associations"
  ON location_associations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Authenticated update location_associations"
  ON location_associations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Authenticated delete location_associations"
  ON location_associations FOR DELETE TO authenticated USING (true);

-- Seed / upsert com os dados iniciais
INSERT INTO location_associations (local, regiao, corredor, uf) VALUES
  ('Vitória',                               'Sudeste',  'Porto/Ferrovia', 'ES'),
  ('Carajás',                               'Norte',    'Serra Norte',    'PA'),
  ('Vargem Grande',                         'Sudeste',  'Sul/Portos Sul', 'MG'),
  ('Brucutu',                               'Sudeste',  'Sudeste',        'MG'),
  ('Cauê',                                  'Sudeste',  'Sudeste',        'MG'),
  ('Timbopeba',                             'Sudeste',  'Sudeste',        'MG'),
  ('São Luis',                              'Nordeste', 'Ferrovia/MA',    'MA'),
  ('Fábrica',                               'Sudeste',  'Sul/Portos Sul', 'MG'),
  ('Mutuca',                                'Sudeste',  'Sul/Portos Sul', 'MG'),
  ('Rio de Janeiro',                        'Sudeste',  'Sul/Portos Sul', 'RJ'),
  ('Canaã',                                 'Norte',    'S11D',           'PA'),
  ('Fazendão',                              'Sudeste',  'Sudeste',        'MG'),
  ('Açailândia',                            'Nordeste', 'Ferrovia/MA',    'MA'),
  ('N/A',                                   '',         '',               ''),
  ('Praia Mole',                            'Sudeste',  'Porto/Ferrovia', 'ES'),
  ('Tubarão',                               'Sudeste',  'Porto/Ferrovia', 'ES'),
  ('Canaã - Village',                       'Norte',    'S11D',           'PA'),
  ('Capanema',                              'Sudeste',  'Sudeste',        'MG'),
  ('Governador Valadares',                  'Sudeste',  'Porto/Ferrovia', 'MG'),
  ('Salobo',                                'Norte',    'Salobo',         'PA'),
  ('Mariana',                               'Sudeste',  'Sudeste',        'MG'),
  ('Ipatinga',                              'Sudeste',  'Porto/Ferrovia', 'MG'),
  ('Camburi',                               'Sudeste',  'Porto/Ferrovia', 'ES'),
  ('Estação Ferroviária de Costa Lacerda',  'Sudeste',  'Porto/Ferrovia', 'MG')
ON CONFLICT (local) DO UPDATE SET
  regiao   = EXCLUDED.regiao,
  corredor = EXCLUDED.corredor,
  uf       = EXCLUDED.uf;
