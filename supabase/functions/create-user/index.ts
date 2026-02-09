// Supabase Edge Function para criar usuários de forma segura
// Deploy: supabase functions deploy create-user
//
// Variáveis de ambiente necessárias (já disponíveis automaticamente):
// - SUPABASE_URL
// - SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers - permitir todas as origens para desenvolvimento
// Em produção, considere restringir para seu domínio específico
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400', // 24 horas
}

interface CreateUserRequest {
  email: string
  password: string
  role: 'admin' | 'analista' | 'coordenador'
  full_name?: string
}

// Helper para criar resposta com CORS
function jsonResponse(data: object, status: number = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      }
    }
  )
}

Deno.serve(async (req) => {
  // Log da requisição para debug
  console.log(`[create-user] ${req.method} request received`)

  // Handle CORS preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    console.log('[create-user] Handling CORS preflight')
    return new Response('ok', { headers: corsHeaders })
  }

  // Apenas POST é permitido
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido' }, 405)
  }

  try {
    // 1. Verificar autenticação do chamador
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.log('[create-user] No auth header')
      return jsonResponse({ error: 'Token de autenticação não fornecido' }, 401)
    }

    // 2. Obter variáveis de ambiente
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('[create-user] Missing environment variables')
      return jsonResponse({ error: 'Configuração do servidor incompleta' }, 500)
    }

    // 3. Criar cliente Supabase com o token do usuário para verificar permissões
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    })

    // 4. Verificar se o usuário chamador está autenticado
    const { data: { user: callerUser }, error: userError } = await supabaseClient.auth.getUser()

    if (userError) {
      console.log('[create-user] Auth error:', userError.message)
      return jsonResponse({ error: 'Token inválido ou expirado' }, 401)
    }

    if (!callerUser) {
      console.log('[create-user] No user found')
      return jsonResponse({ error: 'Usuário não autenticado' }, 401)
    }

    console.log('[create-user] Caller user:', callerUser.email)

    // 5. Buscar profile do chamador para verificar se é admin
    const { data: callerProfile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (profileError) {
      console.log('[create-user] Profile error:', profileError.message)
      return jsonResponse({ error: 'Erro ao verificar permissões' }, 500)
    }

    if (!callerProfile || callerProfile.role !== 'admin') {
      console.log('[create-user] Not admin. Role:', callerProfile?.role)
      return jsonResponse({ error: 'Apenas administradores podem criar usuários' }, 403)
    }

    console.log('[create-user] Admin verified, proceeding...')

    // 6. Parsear body da requisição
    let body: CreateUserRequest
    try {
      body = await req.json()
    } catch (e) {
      return jsonResponse({ error: 'Body inválido' }, 400)
    }

    const { email, password, role, full_name } = body

    // 7. Validações básicas
    if (!email || !password || !role) {
      return jsonResponse({ error: 'Email, senha e role são obrigatórios' }, 400)
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return jsonResponse({ error: 'E-mail inválido' }, 400)
    }

    // Validar role
    if (!['admin', 'analista', 'coordenador'].includes(role)) {
      return jsonResponse({ error: 'Role inválido. Use: admin, analista ou coordenador' }, 400)
    }

    // Validar senha
    if (password.length < 6) {
      return jsonResponse({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400)
    }

    // 8. Criar cliente admin usando service role (pode criar usuários)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 9. Criar usuário no Auth
    console.log('[create-user] Creating user:', email)

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Já confirma o email automaticamente
      user_metadata: {
        full_name: full_name || null
      }
    })

    if (createError) {
      console.error('[create-user] Create user error:', createError.message)

      // Traduzir erros comuns
      if (createError.message.includes('already been registered')) {
        return jsonResponse({ error: 'Este e-mail já está cadastrado' }, 400)
      }

      return jsonResponse({ error: createError.message }, 400)
    }

    if (!newUser.user) {
      return jsonResponse({ error: 'Erro ao criar usuário' }, 500)
    }

    console.log('[create-user] User created in Auth:', newUser.user.id)

    // 10. Criar profile com o role definido
    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        email: email,
        role: role,
        full_name: full_name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })

    if (profileInsertError) {
      console.error('[create-user] Profile insert error:', profileInsertError.message)

      // Tentar deletar o usuário criado se o profile falhar
      try {
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
        console.log('[create-user] Rolled back user creation')
      } catch (deleteError) {
        console.error('[create-user] Failed to rollback:', deleteError)
      }

      return jsonResponse({ error: 'Erro ao criar perfil do usuário' }, 500)
    }

    console.log('[create-user] Profile created successfully')

    // 11. Retornar sucesso
    return jsonResponse({
      success: true,
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
        role: role,
        full_name: full_name || null
      }
    })

  } catch (error) {
    console.error('[create-user] Unexpected error:', error)
    return jsonResponse({ error: 'Erro interno do servidor' }, 500)
  }
})
