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

## Fase 2 possível — Excel de medição

O `medicaoWorkbook` NÃO foi tocado nesta rodada. A planilha é o documento de
**pagamento do instrutor**; reembolso de cliente é outro fluxo, e misturar as
duas colunas na mesma aba confundiria quem confere o pagamento.

Se o time quiser, a fase 2 natural é uma coluna "Reemb.?" por item ou uma aba
"Não Reembolsável" com o mesmo recorte do card.
