-- Policies do Storage do bucket `measurement-templates` (companheiro da 022)
--
-- APLICADAS EM PRODUÇÃO EM 23/09/2026, À MÃO, PELO SQL EDITOR. Este arquivo é
-- o registro delas: o que está aqui é o que está no banco, não uma proposta.
-- Versionado para que o próximo ambiente (staging, uma restauração, uma conta
-- nova) saia igual ao de hoje sem ninguém precisar lembrar do que foi clicado.
--
--
-- O BUCKET É CRIADO NO PAINEL, NÃO AQUI
-- ---------------------------------------------------------------------------
-- `measurement-templates` é PRIVADO e foi criado pelo painel do Supabase
-- (Storage > New bucket, com "Public bucket" DESMARCADO). Este arquivo NÃO
-- cria bucket: inserir em `storage.buckets` por SQL contorna o caminho que o
-- Supabase suporta e deixa o bucket sem a configuração que o painel escreve
-- junto. Se o bucket não existir, crie-o no painel ANTES de rodar isto — as
-- policies abaixo valem para um bucket que existe, e não o trazem de volta.
--
-- Privado importa: o arquivo-base de cada cliente é a planilha de medição
-- dele. Em bucket público, bastaria adivinhar o caminho. O app lê por URL
-- ASSINADA de 1 h (services/exports/templateStorage.ts), e isso só faz sentido
-- porque o bucket é privado.
--
--
-- POR QUE ISTO NÃO ESTÁ DENTRO DA MIGRATION 022
-- ---------------------------------------------------------------------------
-- Policy de bucket se escreve sobre `storage.objects`, que é tabela do schema
-- `storage` — do Supabase, não da aplicação. A 022 cria
-- `public.measurement_templates` e a RLS DELA; o arquivo é outro assunto, com
-- outro dono. Misturar os dois faria a migration falhar por permissão em
-- qualquer ambiente onde quem aplica não é dono de `storage.objects`, e a
-- tabela da aplicação ficaria sem criar por causa de uma policy de Storage.
--
-- A consequência é o que este arquivo existe para resolver: aplicar a 022 NÃO
-- basta. As duas coisas precisam ser feitas, e a conferência prévia 4 da 022 é
-- o ponto em que isso se descobre — ver a nota no cabeçalho dela.
--
-- Tabela liberada não significa arquivo liberado, e vice-versa: a RLS da 022
-- deixa qualquer autenticado ler o REGISTRO do modelo (bucket e caminho são só
-- texto lá); quem decide se ele pode BAIXAR A PLANILHA é a policy daqui.
--
--
-- "QUALQUER AUTENTICADO", COMO A RLS DA 022
-- ---------------------------------------------------------------------------
-- Mesmo critério, pelo mesmo motivo: modelo de medição é dado da operação, não
-- preferência pessoal. O gate real continua sendo de UI — o módulo de medição
-- por empresa exige `requiredView: 'measurement'`
-- (domain/exports/registry.ts), que o analista não tem. O banco não sabe
-- disso, e RLS por papel segue pendente para a leva de segurança, aqui como lá.
--
-- As quatro policies são restritas ao bucket pelo `bucket_id`: nenhuma delas
-- alcança objeto de outro bucket. A de UPDATE tem USING e WITH CHECK com a
-- mesma condição — só com o USING, um update poderia trocar o `bucket_id` e
-- MOVER o objeto para fora, que é a brecha clássica de policy de Storage.
--
-- Idempotente: DROP POLICY IF EXISTS antes de cada CREATE, porque CREATE
-- POLICY não aceita IF NOT EXISTS (mesma nota da 007/012/016/017/021/022).
-- Rodar duas vezes deixa o banco no mesmo estado.
--
-- Se der "must be owner of table objects": esta conexão não tem privilégio
-- para escrever policy de Storage por SQL. É o esperado fora do SQL Editor do
-- painel — aplique por lá, como foi feito em 23/09/2026.


-- ===========================================================================
-- CONFERÊNCIA PRÉVIA — rodar ANTES de aplicar
-- ===========================================================================
--   -- 1) o bucket existe e é PRIVADO (espera 1 linha, public = false):
--   select id, name, public from storage.buckets
--    where id = 'measurement-templates';
--   --    0 linhas: crie o bucket no painel antes de seguir.
--   --    public = true: torne-o privado antes de seguir.
--
--   -- 2) o que já existe hoje para este bucket (0 na primeira aplicação; as
--   --    quatro de baixo numa reaplicação):
--   select polname, polcmd from pg_policy
--    where polrelid = 'storage.objects'::regclass
--      and polname ilike '%measurement-templates%';


-- ---------------------------------------------------------------------------
-- As quatro policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados leem measurement-templates"      ON storage.objects;
DROP POLICY IF EXISTS "Autenticados enviam measurement-templates"    ON storage.objects;
DROP POLICY IF EXISTS "Autenticados atualizam measurement-templates" ON storage.objects;
DROP POLICY IF EXISTS "Autenticados apagam measurement-templates"    ON storage.objects;

-- LER: o download do arquivo-base e a URL assinada de 1 h saem daqui.
CREATE POLICY "Autenticados leem measurement-templates"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'measurement-templates');

-- ENVIAR: o upload da planilha ao criar o modelo ou ao trocar o arquivo-base.
CREATE POLICY "Autenticados enviam measurement-templates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'measurement-templates');

-- ATUALIZAR: o upload usa `upsert: true`, então reenviar a mesma planilha é um
-- UPDATE do objeto. O WITH CHECK repete a condição de propósito — ver o
-- cabeçalho.
CREATE POLICY "Autenticados atualizam measurement-templates"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'measurement-templates')
  WITH CHECK (bucket_id = 'measurement-templates');

-- APAGAR: a limpeza do arquivo antigo quando o modelo troca de planilha.
CREATE POLICY "Autenticados apagam measurement-templates"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'measurement-templates');


-- ===========================================================================
-- CONFERÊNCIA PÓS-APLICAÇÃO
-- ===========================================================================
-- 1) As quatro policies existem, uma por comando (polcmd r/a/w/d):
--    select polname, polcmd from pg_policy
--     where polrelid = 'storage.objects'::regclass
--       and polname ilike '%measurement-templates%'
--     order by polcmd;
--    -- Espera 4 linhas. Filtrar pelo NOME e não pela expressão é de propósito:
--    -- a de INSERT (polcmd = 'a') não tem USING, só WITH CHECK, e some de
--    -- qualquer busca que olhe só o `polqual`.
--
-- 2) A de UPDATE tem USING **e** WITH CHECK:
--    select polname,
--           pg_get_expr(polqual, polrelid)      as usando,
--           pg_get_expr(polwithcheck, polrelid) as com_check
--      from pg_policy
--     where polrelid = 'storage.objects'::regclass
--       and polname = 'Autenticados atualizam measurement-templates';
--    -- Espera as duas colunas preenchidas, com bucket_id = 'measurement-templates'.
--
-- 3) TESTE FUNCIONAL — pelo APP, que é onde isto importa:
--    Exportações > Modelos de medição > Novo modelo: envie uma planilha e
--    confira que ela sobe; depois abra o modelo e confira que a conferência lê
--    o arquivo (é a URL assinada funcionando). Trocar o arquivo-base exercita
--    o UPDATE e o DELETE na mesma ação.
--    Sintoma de policy faltando: o upload falha com "new row violates
--    row-level security policy", ou a leitura devolve 400 na URL assinada.
