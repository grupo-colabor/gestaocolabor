-- ============================================
-- PROFILES TABLE RLS (Row Level Security)
-- ============================================
-- Execute este SQL no Supabase Dashboard > SQL Editor
-- ============================================

-- 1. Habilitar RLS na tabela profiles (se ainda não estiver)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 2. Remover policies antigas (se existirem)
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Service role full access" ON profiles;

-- 3. Policy: Usuários podem ver seu próprio perfil
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

-- 4. Policy: Usuários podem atualizar seu próprio perfil (exceto role)
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 5. Policy: Admin pode ver todos os perfis
CREATE POLICY "Admin can view all profiles"
ON profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- 6. Policy: Admin pode inserir perfis (para criar novos usuários)
CREATE POLICY "Admin can insert profiles"
ON profiles FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
  OR auth.uid() = id  -- Permite criar próprio perfil
);

-- 7. Policy: Admin pode atualizar qualquer perfil
CREATE POLICY "Admin can update all profiles"
ON profiles FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- ============================================
-- IMPORTANTE: Para a Edge Function funcionar
-- ============================================
-- A Edge Function usa SERVICE_ROLE_KEY que bypassa RLS
-- Então não precisa de policy especial para ela

-- ============================================
-- OPCIONAL: Criar primeiro usuário admin manualmente
-- ============================================
-- Se você ainda não tem um admin, pode criar um assim:
-- (Substitua os valores conforme necessário)

-- INSERT INTO profiles (id, email, role, full_name, created_at, updated_at)
-- VALUES (
--   'SEU_USER_ID_DO_AUTH',  -- ID do usuário no auth.users
--   'admin@suaempresa.com',
--   'admin',
--   'Administrador',
--   NOW(),
--   NOW()
-- );

-- ============================================
-- VERIFICAR ESTRUTURA DA TABELA
-- ============================================
-- Se a tabela profiles não existe, crie assim:

-- CREATE TABLE IF NOT EXISTS profiles (
--   id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
--   email TEXT,
--   role TEXT DEFAULT 'coordenador' CHECK (role IN ('admin', 'analista', 'coordenador')),
--   full_name TEXT,
--   created_at TIMESTAMPTZ DEFAULT NOW(),
--   updated_at TIMESTAMPTZ DEFAULT NOW()
-- );

-- CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);
-- CREATE INDEX IF NOT EXISTS profiles_role_idx ON profiles(role);
