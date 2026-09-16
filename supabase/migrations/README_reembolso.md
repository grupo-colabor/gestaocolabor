# Flag "não reembolsável" — sem migration

A flag vive em `measurements.attachments` (jsonb), que já existe. Cada item de
despesa ganhou `reembolsavel?: boolean`.

**Não há migration** e **não há backfill**: a leitura é `reembolsavel === false`,
nunca `=== true`. Item gravado antes desta mudança não tem o campo e continua
valendo como reembolsável.

Conferência (quantos itens já foram marcados):

```sql
select count(*) as itens_marcados
  from measurements m,
       jsonb_array_elements(m.attachments) as a
 where (a->>'reembolsavel') = 'false';
```

Total absorvido por período (equivalente ao card "Despesas Não Reembolsáveis"):

```sql
select sum((a->>'value')::numeric) as total_nao_reembolsavel
  from measurements m
  join demands d on d.id = m.demand_id,
       jsonb_array_elements(m.attachments) as a
 where (a->>'reembolsavel') = 'false'
   and d.tipo <> 'interna';
```

## Fase 2 (feita em 09/2026) — flag "pago pelo instrutor" e Excel de pagamento

A "fase 2" imaginada acima virou OUTRA flag, e não uma coluna da primeira: o
Excel é o documento de pagamento do instrutor, e o que interessa nele não é
"o cliente reembolsa?" e sim "o instrutor pagou do bolso?". Mesmo desenho:

- `pagoPeloInstrutor?: boolean` no item de `measurements.attachments` (jsonb).
- **Sem migration, sem backfill.** Leitura `pagoPeloInstrutor === true`
  (`isPagoPeloInstrutor`, domain/measurementTotals.ts): item antigo, `null` e
  a string `"true"` são "não". Nada vira reembolso sem alguém marcar.
- Independente de `reembolsavel`: as quatro combinações são válidas (tabela
  no cabeçalho de measurementTotals.ts). Medição Vale e BM continuam lendo
  só `reembolsavel`. Dashboard e card de custo não leem nenhuma das duas
  para somar — a despesa foi gasta independentemente de quem pagou.

Conferência (quantos itens marcados e quanto é devido aos instrutores):

```sql
select count(*) as itens_pagos_pelo_instrutor,
       sum((a->>'value')::numeric) as total_a_reembolsar
  from measurements m,
       jsonb_array_elements(m.attachments) as a
 where (a->>'pagoPeloInstrutor') = 'true';
```

Para procurar candidatos a migrar por convenção de descrição (não há nenhuma
no código; só vale migrar se o padrão for inequívoco):

```sql
select m.demand_id, a->>'category' as categoria, a->>'name' as item,
       o->>'description' as descricao_outros, a->>'value' as valor
  from measurements m
       cross join jsonb_array_elements(m.attachments) a
       left join jsonb_array_elements(m.other_expenses) o on o->>'id' = a->>'otherId'
 where lower(coalesce(a->>'name','') || ' ' || coalesce(o->>'description','')) ~ '(instrutor|pagou|reembols|adiant)'
 order by m.demand_id;
```

## Seguimentos registrados

1. **Trava otimista por `updated_at`.** O Salvar do painel grava o jsonb inteiro
   e a tabela `measurements` não está no realtime. Hoje o painel RELÊ a medição
   ao abrir (`fetchMeasurementByDemandId`), o que encurta a janela para
   "enquanto o painel está aberto" — mas dois painéis abertos ao mesmo tempo
   ainda sobrescrevem um ao outro. O passo seguinte é o upsert condicionado ao
   `updated_at` lido na abertura (update … where updated_at = X, e aviso
   "alguém salvou antes de você" quando não afetar linha).
2. **Seções por pessoa para toda demanda com mais de um titular.** Numa demanda
   de cliente dividida por dias sem acompanhante o painel não tem seções por
   pessoa, e todo item marcado como pago pelo instrutor vai para o titular de
   `demands.instructor_id` (regra em domain/measurementPersonBlocks.ts). O
   painel avisa com o nome; o certo é abrir seções sempre que houver 2+
   titulares, para cada um lançar o que pagou.
