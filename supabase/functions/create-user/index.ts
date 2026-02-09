// Supabase Edge Function para criar usuários de forma segura
// Deploy: supabase functions deploy create-user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserRequest {
  email: string
  password: string
  role: 'admin' | 'analista' | 'coordenador'
  full_name?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verificar autenticação do chamador
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Token de autenticação não fornecido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Criar cliente Supabase com o token do usuário para verificar permissões
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // 3. Verificar se o usuário chamador é admin
    const { data: { user: callerUser }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Usuário não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Buscar profile do chamador para verificar role
    const { data: callerProfile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (profileError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem criar usuários' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Parsear body da requisição
    const body: CreateUserRequest = await req.json()
    const { email, password, role, full_name } = body

    // Validações básicas
    if (!email || !password || !role) {
      return new Response(
        JSON.stringify({ error: 'Email, senha e role são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['admin', 'analista', 'coordenador'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Role inválido. Use: admin, analista ou coordenador' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Senha deve ter pelo menos 6 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Criar usuário usando service role (pode criar usuários)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Já confirma o email
      user_metadata: { full_name }
    })

    if (createError) {
      console.error('Erro ao criar usuário:', createError)
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Criar/atualizar profile com o role
    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user!.id,
        email: email,
        role: role,
        full_name: full_name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

    if (profileInsertError) {
      console.error('Erro ao criar profile:', profileInsertError)
      // Tentar deletar o usuário criado se o profile falhar
      await supabaseAdmin.auth.admin.deleteUser(newUser.user!.id)
      return new Response(
        JSON.stringify({ error: 'Erro ao criar perfil do usuário' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 7. Retornar sucesso
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user!.id,
          email: newUser.user!.email,
          role: role,
          full_name: full_name
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erro na função create-user:', error)
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
