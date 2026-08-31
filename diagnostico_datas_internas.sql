-- ============================================================================
-- DIAGNÓSTICO — horários deslocados em demandas INTERNAS
--
-- Contexto: `demands.start_date` / `demands.end_date` são timestamptz, mas o app
-- grava ali o HORÁRIO DE PAREDE que o usuário digitou (string naive
-- "YYYY-MM-DDTHH:mm", resolvida pelo Postgres na sessão em UTC). Ou seja: o
-- horário correto de uma demanda é sempre `start_date at time zone 'UTC'`.
--
-- O bug corrigido em domain/demandDateTime.ts: o form interno reabria a demanda
-- passando o valor por new Date()+getHours(), o que trazia a parede -3h. Se o
-- usuário salvasse de novo, esse -3h era PERSISTIDO — e cada nova edição descia
-- outras 3h, derrubando junto o adicional noturno (fim >= 19:00).
--
-- Estas queries são SOMENTE LEITURA. Não corrigem nada.
-- Rodar no SQL Editor do Supabase (a anon key não enxerga estas linhas por RLS).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] Inventário: horário gravado hoje em cada demanda interna.
--     `inicio_gravado` / `fim_gravado` é o que a listagem e a agenda exibem.
-- ----------------------------------------------------------------------------
select
  d.id,
  d.status,
  d.categoria_interna,
  d.descricao_interna,
  to_char(d.start_date at time zone 'UTC', 'DD/MM/YYYY HH24:MI') as inicio_gravado,
  to_char(d.end_date   at time zone 'UTC', 'DD/MM/YYYY HH24:MI') as fim_gravado,
  -- noturno pela regra do domínio (domain/demandDays.ts): fim >= 19:00 ou vira o dia
  (
    to_char(d.end_date at time zone 'UTC', 'HH24:MI') >= '19:00'
    or to_char(d.end_date at time zone 'UTC', 'HH24:MI') < to_char(d.start_date at time zone 'UTC', 'HH24:MI')
  ) as noturno_hoje,
  d.updated_at
from demands d
where d.tipo = 'interna'
order by d.start_date desc;


-- ----------------------------------------------------------------------------
-- [2] FINGERPRINT DO BUG — edições em que o horário caiu exatamente 3h (ou 6h,
--     9h… em quem foi editado mais de uma vez) sem que o usuário tivesse motivo.
--
--     `dados_antes.startDate` vem do banco (com "+00:00"); `dados_depois.startDate`
--     vem do form (naive). Nos dois casos os caracteres 12..16 são a parede HH:mm.
-- ----------------------------------------------------------------------------
with edicoes as (
  select
    a.created_at,
    a.user_name,
    coalesce(a.dados_depois->>'id', a.dados_antes->>'id')            as demand_id,
    substring(a.dados_antes ->>'startDate' from 12 for 5)            as inicio_antes,
    substring(a.dados_depois->>'startDate' from 12 for 5)            as inicio_depois,
    substring(a.dados_antes ->>'endDate'   from 12 for 5)            as fim_antes,
    substring(a.dados_depois->>'endDate'   from 12 for 5)            as fim_depois,
    substring(a.dados_antes ->>'startDate' from 1 for 10)            as dia_antes,
    substring(a.dados_depois->>'startDate' from 1 for 10)            as dia_depois
  from audit_logs a
  where a.modulo = 'Demandas'
    and a.acao   = 'Editar'
    and coalesce(a.dados_depois->>'tipo', a.dados_antes->>'tipo') = 'interna'
)
select
  demand_id,
  created_at,
  user_name,
  inicio_antes, inicio_depois,
  fim_antes,    fim_depois,
  dia_antes,    dia_depois,
  -- diferença em minutos na parede do início (negativa = recuou)
  (
    (split_part(inicio_depois, ':', 1)::int * 60 + split_part(inicio_depois, ':', 2)::int)
    - (split_part(inicio_antes, ':', 1)::int * 60 + split_part(inicio_antes, ':', 2)::int)
  ) as delta_minutos_inicio
from edicoes
where inicio_antes is not null
  and inicio_depois is not null
  and inicio_antes is distinct from inicio_depois
  -- múltiplos exatos de -3h são a assinatura do bug (o dia não muda junto)
  and dia_antes = dia_depois
  and (
    (split_part(inicio_depois, ':', 1)::int * 60 + split_part(inicio_depois, ':', 2)::int)
    - (split_part(inicio_antes, ':', 1)::int * 60 + split_part(inicio_antes, ':', 2)::int)
  ) % 180 = 0
order by created_at desc;


-- ----------------------------------------------------------------------------
-- [3] VERDADE DE ORIGEM — horário que o usuário digitou na CRIAÇÃO vs. o que
--     está gravado hoje. Divergência aqui é candidata a correção de dado.
--     (Uma edição legítima de horário também aparece; o filtro % 180 = 0 abaixo
--     separa as que têm a cara do bug.)
-- ----------------------------------------------------------------------------
with criacao as (
  select distinct on (a.dados_depois->>'id')
    a.dados_depois->>'id'                                 as demand_id,
    substring(a.dados_depois->>'startDate' from 1 for 16)  as start_criado,
    substring(a.dados_depois->>'endDate'   from 1 for 16)  as end_criado,
    a.created_at                                           as criado_em
  from audit_logs a
  where a.modulo = 'Demandas'
    and a.acao   = 'Criar'
    and a.dados_depois->>'tipo' = 'interna'
    and a.dados_depois->>'id' is not null
  order by a.dados_depois->>'id', a.created_at asc
)
select
  d.id,
  d.categoria_interna,
  d.descricao_interna,
  c.criado_em,
  substring(c.start_criado from 12 for 5)                      as inicio_digitado,
  to_char(d.start_date at time zone 'UTC', 'HH24:MI')          as inicio_hoje,
  substring(c.end_criado from 12 for 5)                        as fim_digitado,
  to_char(d.end_date   at time zone 'UTC', 'HH24:MI')          as fim_hoje,
  substring(c.start_criado from 1 for 10)                      as dia_inicio_digitado,
  to_char(d.start_date at time zone 'UTC', 'YYYY-MM-DD')       as dia_inicio_hoje
from demands d
join criacao c on c.demand_id = d.id
where d.tipo = 'interna'
  and (
       substring(c.start_criado from 12 for 5) is distinct from to_char(d.start_date at time zone 'UTC', 'HH24:MI')
    or substring(c.end_criado   from 12 for 5) is distinct from to_char(d.end_date   at time zone 'UTC', 'HH24:MI')
  )
order by c.criado_em desc;


-- ----------------------------------------------------------------------------
-- [4] IMPACTO NA MEDIÇÃO — internas que HOJE não são noturnas, mas cujo fim
--     digitado na criação era >= 19:00. São as que perderam o adicional.
-- ----------------------------------------------------------------------------
with criacao as (
  select distinct on (a.dados_depois->>'id')
    a.dados_depois->>'id'                                 as demand_id,
    substring(a.dados_depois->>'endDate' from 12 for 5)    as fim_digitado,
    substring(a.dados_depois->>'startDate' from 12 for 5)  as inicio_digitado
  from audit_logs a
  where a.modulo = 'Demandas'
    and a.acao   = 'Criar'
    and a.dados_depois->>'tipo' = 'interna'
    and a.dados_depois->>'id' is not null
  order by a.dados_depois->>'id', a.created_at asc
)
select
  d.id,
  c.inicio_digitado,
  c.fim_digitado,
  to_char(d.start_date at time zone 'UTC', 'HH24:MI') as inicio_hoje,
  to_char(d.end_date   at time zone 'UTC', 'HH24:MI') as fim_hoje
from demands d
join criacao c on c.demand_id = d.id
where d.tipo = 'interna'
  and (c.fim_digitado >= '19:00' or c.fim_digitado < c.inicio_digitado)
  and not (
    to_char(d.end_date at time zone 'UTC', 'HH24:MI') >= '19:00'
    or to_char(d.end_date at time zone 'UTC', 'HH24:MI') < to_char(d.start_date at time zone 'UTC', 'HH24:MI')
  )
order by d.start_date desc;
