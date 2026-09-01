# Medição multi-pessoa — diagnóstico e proposta

**Branch:** `mvp-estavel` · **Escopo:** análise e desenho, sem código e sem migration
**Motivação:** a equipe criou 5 demandas internas clonadas para uma mesma reunião porque a interna comporta 1 instrutor.

**Veredito curto:** o desenho é viável em 4 fases, com **uma única migration (016)** na F1. O ponto de maior risco não é a tabela nova nem a UI — é o encontro entre `instructorHours.ts` (horas por rateio de dias) e os blocos da medição (horas por pessoa). A recomendação é **override declarado por pessoa, nunca soma**, com o campo `horas` **ausente por padrão** no JSON — porque um default gravado com avidez faria toda interna de 2 participantes pular de 16h para 32h no dia do deploy. Detalhes em [7.4](#74-o-ponto-delicado-instructorhoursts--blocos-v2-sem-dupla-contagem).

Um segundo achado muda o enquadramento da Parte 1: **acompanhante hoje não gera conflito de agenda nem entra em horas ou pagamento** — é decoração da grade. É exatamente o precedente pedido, e a lição dele é o que não repetir. Ver [4.2](#42-o-que-companion_allocations-não-alcança).

---

## Parte 1 — Infraestrutura de participante

### 1. A tabela nova

#### 1.1 Nome

Recomendo **`demand_participants`**, não `internal_demand_participants`.

"Participante" é a palavra que o domínio já usa, e a restrição a `tipo='interna'` é uma **regra**, não a identidade da tabela — uma tabela batizada `internal_*` que amanhã precise abrigar outra coisa força rename ou tabela irmã. O precedente da casa é discriminador em coluna, não tabela por tipo: a [014](supabase/migrations/014_location_context.sql) separou os dois conjuntos de `location_associations` com a coluna `contexto` + UNIQUE composto ([014:21-29](supabase/migrations/014_location_context.sql#L21-L29), [43-44](supabase/migrations/014_location_context.sql#L43-L44)), em vez de criar `internal_location_associations`.

#### 1.2 Colunas mínimas

| coluna | tipo | por quê |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | Segue [003:6](supabase/migrations/003_logistic_blocks.sql#L6) e `companion_allocations` (o id vem do banco — [companionAllocations.ts:33-42](services/companionAllocations.ts#L33-L42) omite `id` no insert). **Não** seguir `instructor_allocations`, cujo id é gerado no app como `ALOC-${Date.now()}` — o drawer já teve que contornar colisão de milissegundo concatenando o dia: `CA-${Date.now()}-${day}` ([AllocationDrawer.tsx:330](components/AllocationDrawer.tsx#L330)). |
| `demand_id` | `text NOT NULL` | `demands.id` é `text` (`"DEM-6301"` — [demands.ts:6](services/demands.ts#L6)), não uuid. |
| `tipo` | `text NOT NULL DEFAULT 'interna'` | Discriminador redundante — é o que permite validar sem trigger. Ver 1.4. |
| `instructor_id` | `uuid NOT NULL` | `instructors.id` é uuid ([medicaoExportService.ts:276](services/medicaoExportService.ts#L276) faz fallback `Instrutor ${id}`, e o comentário de [instructors.ts:30-31](services/instructors.ts#L30-L31) fala em "Instrutor \<uuid\>"). |
| `start_date` | `date NULL` | Período próprio, opcional. NULL = **todo o período da demanda**. |
| `end_date` | `date NULL` | idem |
| `created_at` / `updated_at` | `timestamptz DEFAULT now()` | padrão da 003 |

**Por que `date` e não `timestamptz`.** As duas tabelas irmãs usam timestamptz e guardam ali um horário de parede — `companion_allocations` grava literalmente `${day}T08:00` / `${day}T18:00` ([AllocationDrawer.tsx:332-333](components/AllocationDrawer.tsx#L332-L333)), horário fixo que ignora o da demanda. É a mesma convenção que acabou de custar o bug de -3h da interna (ver [domain/demandDateTime.ts](domain/demandDateTime.ts)). A participação é **por dia** — as horas vêm do bloco da medição, não do período — então `date` elimina a classe inteira de bug numa tabela que nasce agora. O horário para o card da agenda sai de `getDayHorarioInicio` / `getDayHorarioFim` ([demandDays.ts:148-171](domain/demandDays.ts#L148-L171)), que já lê o horário real da demanda dia a dia. É estritamente melhor que o `T08:00` fixo do acompanhante.

> ⚠️ Decisão aberta: se a agenda precisar de horário por participante (um participa só de manhã), `date` não serve. Meu palpite é que não precisa — o caso real é "quem esteve na reunião", e o horário é o da reunião. Ver [Decisão D1](#d1--granularidade-do-período-do-participante).

#### 1.3 Unicidade e índices

```sql
CONSTRAINT demand_participants_uq UNIQUE (demand_id, instructor_id)
CREATE INDEX ... ON demand_participants (demand_id);
CREATE INDEX ... ON demand_participants (instructor_id);
```

O UNIQUE é o pedido. O índice em `instructor_id` não é decorativo: `hasScheduleConflict` ([App.tsx:2659-2775](App.tsx#L2659-L2775)) e a Cobertura de Ociosidade varrem por instrutor. O índice em `demand_id` espelha [003:34-35](supabase/migrations/003_logistic_blocks.sql#L34-L35).

#### 1.4 Validar `tipo='interna'` — CHECK vs trigger vs service

O CHECK sozinho não resolve, porque não cruza tabela — como a própria 012 registra ao explicar por que `demands_interna_requires_fields` só olha a própria linha ([012:36-43](supabase/migrations/012_internal_demands_schema.sql#L36-L43)).

**Recomendação: FK composta com discriminador redundante.** Declarativo, sem trigger, e é a extensão natural do padrão da 014:

```sql
-- em demands (barato: só um índice único a mais sobre a PK + tipo)
ALTER TABLE demands ADD CONSTRAINT demands_id_tipo_uq UNIQUE (id, tipo);

-- em demand_participants
CHECK (tipo = 'interna'),
FOREIGN KEY (demand_id, tipo) REFERENCES demands (id, tipo)
  ON DELETE CASCADE ON UPDATE RESTRICT
```

O que isso compra, sem uma linha de código de aplicação:

- inserir participante numa demanda de cliente **falha no banco**;
- virar uma demanda com participantes de `interna` para `cliente` **falha** (o `ON UPDATE RESTRICT` barra);
- apagar a demanda leva os participantes junto. Isso importa: `deleteDemandById` ([demands.ts:156-180](services/demands.ts#L156-L180)) só limpa documentos explicitamente, e o `deleteDemand` do App ([App.tsx:1688-1692](App.tsx#L1688-L1692)) limpa `measurements`, `agendaItems`, `instructorAllocations` e `resourceAllocations` **do estado local — e esquece `companionAllocations`**. Um acompanhante de demanda apagada continua no estado até o reload. Não repetir: a linha de `demandParticipants` entra nesse bloco, e o CASCADE cuida do banco.

**Por que não trigger.** Não existe **nenhum** `CREATE TRIGGER` nem `CREATE FUNCTION` em migration neste repositório (varredura confirmada na análise anterior, §5). Introduzir o primeiro por uma validação que a FK composta faz sozinha adiciona um objeto de banco que ninguém mais mantém.

**Por que não só no service.** Validação de aplicação não sobrevive a um insert pelo dashboard do Supabase nem a um script de correção — e a tabela vai guardar quem recebe pagamento.

`instructor_id` → `instructors(id)`: recomendo **`ON DELETE RESTRICT`**. `deleteInstructor` existe no app; se o instrutor sumir, o bloco correspondente na medição (que guarda `instructorId` em jsonb, sem FK) vira órfão silencioso. RESTRICT força a decisão a aparecer na tela.

#### 1.5 RLS — as 4 policies, no formato da 012

Reproduzindo [012:78-99](supabase/migrations/012_internal_demands_schema.sql#L78-L99): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, quatro `DROP POLICY IF EXISTS` (o Postgres não aceita `CREATE POLICY IF NOT EXISTS`) e quatro `CREATE POLICY` nomeadas "Autenticados podem ler/inserir/atualizar/deletar demand_participants", todas `TO authenticated` com predicado `auth.role() = 'authenticated'`.

Diferença em relação à [003:38-45](supabase/migrations/003_logistic_blocks.sql#L38-L45), que usou uma única policy `FOR ALL`: quatro policies separadas é o formato pedido e é o que a auditoria (`auditoria_rls.sql`) consegue conferir comando a comando — foi assim que a [008](supabase/migrations/008_rls_gaps_consolidation.sql) descobriu que faltava UPDATE em `companion_allocations` ([008:35-40](supabase/migrations/008_rls_gaps_consolidation.sql#L35-L40)).

Fechar a migration com o bloco de conferência pós-migração no estilo [012:101-118](supabase/migrations/012_internal_demands_schema.sql#L101-L118).

---

### 2. `companion_allocations` — mapeamento completo

#### 2.1 Schema e DDL

| item | onde |
|---|---|
| Shape | [companionAllocations.ts:4-11](services/companionAllocations.ts#L4-L11) — `id`, `demand_id`, `instructor_id`, `start_date`, `end_date`, `created_at` |
| **DDL versionada** | **não existe.** Zero `CREATE TABLE`, zero índice, zero CHECK em qualquer `.sql` do repo. Criada pelo dashboard. |
| Única menção em SQL | [008:35-40](supabase/migrations/008_rls_gaps_consolidation.sql#L35-L40) (policy de UPDATE, adicionada por consistência — o service não tem update) e [auditoria_rls.sql:30](auditoria_rls.sql#L30) (lista de tabelas auditadas) |

A [008](supabase/migrations/008_rls_gaps_consolidation.sql) corrigiu o que a auditoria apontou (`companies`, `evidences`, `measurements`, `companion_allocations`) — `instructor_allocations` **não** está lá, o que sugere que passou com as quatro. Mas isso é inferência: nenhuma das três tabelas de alocação tem DDL no repositório. A query de introspecção pronta está em [diagnostico_auditoria.sql:100-113](diagnostico_auditoria.sql#L100-L113).

#### 2.2 Como o AllocationDrawer grava

Dois caminhos, ambos **uma linha por dia**:

1. **Modo acompanhante direto** — [AllocationDrawer.tsx:326-337](components/AllocationDrawer.tsx#L326-L337): `getDemandDays(selectedDemand).forEach(day => addCompanionAllocation({ id: \`CA-${Date.now()}-${day}\`, ..., startDate: \`${day}T08:00\`, endDate: \`${day}T18:00\` }))`.
2. **Seleção de dias** — [AllocationDrawer.tsx:414-435](components/AllocationDrawer.tsx#L414-L435): o usuário escolhe dias avulsos; checa conflito dia a dia ([417](components/AllocationDrawer.tsx#L417)) e insere uma linha por dia.

Existe um terceiro caminho, na tela de Logística: [Logistics.tsx:138-160](components/Logistics.tsx#L138-L160) (demanda inteira) e [Logistics.tsx:214-250](components/Logistics.tsx#L214-L250) (dias selecionados).

Persistência: [App.tsx:328-383](App.tsx#L328-L383) — otimista no estado, depois `insertCompanionAllocation`, e o id local é substituído pelo id real do banco ([App.tsx:354-358](App.tsx#L354-L358)).

> **Achado:** `08:00`/`18:00` são literais em todos os caminhos. O card do acompanhante na agenda mostra sempre 08–18, mesmo numa demanda noturna. É a mesma classe de "convenção implícita" que o bug de -3h explorou.

#### 2.3 Como a agenda renderiza o card ACOMPANHANTE

O `useMemo` que decide o que aparece por instrutor/dia é **[CalendarView.tsx:451-641](components/CalendarView.tsx#L451-L641)** — um mapa `agendaByDay` chaveado por `` `${instructorId}-${dayKey}` ``, montado em quatro passadas de prioridade crescente:

| passada | linha | fonte | escreve em |
|---|---|---|---|
| — | [460-474](components/CalendarView.tsx#L460-L474) | `agendaItems` (férias/folga) | `map` |
| 1 | [476-541](components/CalendarView.tsx#L476-L541) | `instructorAllocations` | `map` **e** `allocMulti` ([535-537](components/CalendarView.tsx#L535-L537)) |
| 1.5 | [543-598](components/CalendarView.tsx#L543-L598) | `companionAllocations` | só `map` |
| 2 | [599-638](components/CalendarView.tsx#L599-L638) | `demands.instructorId`, excluindo demandas que já têm allocation **ou** companion ([601](components/CalendarView.tsx#L601)) | `map` |

Dois detalhes que importam para o desenho:

- a passada 1.5 escreve direto em `map[...]` e **não alimenta `allocMulti`** — ou seja, acompanhante **sobrescreve** o card de alocação do mesmo instrutor no mesmo dia, em vez de conviver;
- o conjunto `demandsWithCompanions` ([456](components/CalendarView.tsx#L456)) existe só para desligar a passada 2 e evitar card duplicado.

Cor: [CalendarView.tsx:1774-1782](components/CalendarView.tsx#L1774-L1782) — `isCompanion` força `bg-emerald-600` e vence tudo, inclusive o âmbar de interna aplicado logo acima em [1759-1763](components/CalendarView.tsx#L1759-L1763) (`INTERNAL_DEMAND_STYLING`, que é [`AGENDA_STYLING.APOIO`](components/CalendarView.tsx#L79)). O botão × de remover também é gated por `isCompanion` ([1786-1817](components/CalendarView.tsx#L1786-L1817)).

#### 2.4 Grep completo de leitores

| # | Leitor | Arquivo:linha |
|---|---|---|
| 1 | Estado global + fetch | [App.tsx:118](App.tsx#L118), [327](App.tsx#L327), [3063](App.tsx#L3063), [3156](App.tsx#L3156) |
| 2 | Realtime | [App.tsx:1313-1319](App.tsx#L1313-L1319), [useRealtimeSync.ts:5](hooks/useRealtimeSync.ts#L5) |
| 3 | Drawer de alocação (escrita + contagem) | [AllocationDrawer.tsx:207-210](components/AllocationDrawer.tsx#L207-L210), [326-337](components/AllocationDrawer.tsx#L326-L337), [414-435](components/AllocationDrawer.tsx#L414-L435) |
| 4 | Agenda (render + exclusão + helpers) | [CalendarView.tsx:456](components/CalendarView.tsx#L456), [543-598](components/CalendarView.tsx#L543-L598), [696](components/CalendarView.tsx#L696), [1058](components/CalendarView.tsx#L1058), [1774-1782](components/CalendarView.tsx#L1774-L1782) |
| 5 | Tela de Logística (escrita + lista) | [Logistics.tsx:133-160](components/Logistics.tsx#L133-L160), [214-250](components/Logistics.tsx#L214-L250), [1174-1230](components/Logistics.tsx#L1174-L1230) |
| 6 | Modal de cliente — exibição "Acompanhantes" | [Demands.tsx:2205-2211](components/Demands.tsx#L2205-L2211), [3048-3051](components/Demands.tsx#L3048-L3051) |
| 7 | Service | [companionAllocations.ts](services/companionAllocations.ts) inteiro |

#### 2.5 O que `companion_allocations` **não** alcança

Este é o achado que importa. Nenhum dos módulos abaixo lê a tabela:

| módulo | fonte real | consequência |
|---|---|---|
| `hasScheduleConflict` | [App.tsx:2706-2732](App.tsx#L2706-L2732) (demands por `instructor_id`), [2736-2760](App.tsx#L2736-L2760) (`instructor_allocations`), [2764-2772](App.tsx#L2764-L2772) (`agenda_items`) | **acompanhante não gera conflito.** Ele pode ser alocado como titular em outra demanda no mesmo dia, sem aviso. O drawer *checa* conflito antes de criar o acompanhante ([417](components/AllocationDrawer.tsx#L417)), mas nada checa **contra** acompanhantes existentes — assimetria pura. |
| `instructorHours.ts` | [instructorHours.ts:168-169](domain/instructorHours.ts#L168-L169) — `if (!allocsForDemand) continue` | acompanhante não soma horas em lugar nenhum |
| `medicaoExportService.ts` | [231-238](services/medicaoExportService.ts#L231-L238) via `computeInstructorHoursByDemand` | **acompanhante não aparece na planilha de pagamento** |
| `instructorAvailability.ts` | [96-104](domain/instructorAvailability.ts#L96-L104) — só `d.instructorId`; a limitação está declarada no cabeçalho ([22-26](domain/instructorAvailability.ts#L22-L26)) | acompanhante não conta como ocupado nem como coberto |
| `notificationAlerts.ts` | [117-121](domain/notificationAlerts.ts#L117-L121) — `demands.instructor_id` | — |
| `measurements` | uma por demanda, `.maybeSingle()` ([measurements.ts:33-41](services/measurements.ts#L33-L41)) | acompanhante não tem medição nem despesa |

**Leitura:** `companion_allocations` é o precedente pedido — "pessoa vinculada a demanda fora de `instructor_allocations`, visível na agenda" — e prova que o padrão **funciona para a grade e falha para todo o resto**. O participante de interna precisa da integração que o acompanhante nunca teve: conflito (item 4), cobertura (item 8) e pagamento (Parte 2). É por isso que a F3 (acompanhante na medição) é uma fase própria e não um efeito colateral.

#### 2.6 Custo de incluir participantes como 5ª fonte da agenda

Concreto e pequeno:

1. **~35 linhas** de uma nova passada, espelhando 1.5 ([543-598](components/CalendarView.tsx#L543-L598)) — inclusive o tratamento de HÍBRIDO, que numa interna é morto (interna é sempre `PRESENCIAL`, [InternalDemands.tsx:769](components/InternalDemands.tsx#L769)) e pode ser omitido.
2. **Alimentar `allocMulti`**, ao contrário do acompanhante — senão dois participantes no mesmo dia sobrescrevem um ao outro no `map`. É o caso principal desta feature, então não é opcional.
3. **Um `demandsWithParticipants`** somado ao filtro de [601](components/CalendarView.tsx#L601), para a passada 2 não duplicar o card do `instructorId` da própria demanda.
4. **Zero código de cor.** O participante entra com `isCompanion: false` e `demandId` preenchido; [1759-1763](components/CalendarView.tsx#L1759-L1763) já pinta de âmbar (`INTERNAL_DEMAND_STYLING` = `AGENDA_STYLING.APOIO`) por `isInternalDemand(linkedDemand)`. Só não pode reusar o ramo `isCompanion`.
5. Nada de novo em `getDayBoundsForIteration` / `isDemandDay` — já existem e já tratam `DIAS_ESPECIFICOS`.

Estimativa: **meio dia**, incluindo o `+ demandParticipants` nas deps do `useMemo` ([641](components/CalendarView.tsx#L641)).

---

### 3. Como o form interno adicionaria participantes

#### 3.1 Estado atual do bloco Instrutores

Somente leitura, e declarado como tal: [InternalDemands.tsx:1094-1101](components/InternalDemands.tsx#L1094-L1101) e o comentário do JSX em [1924-1929](components/InternalDemands.tsx#L1924-L1929). Renderiza `currentInstructorEntries` ([1104-1107](components/InternalDemands.tsx#L1104-L1107)), que vem de `resolveDemandInstructors` ([demandInstructors.ts:40-62](domain/demandInstructors.ts#L40-L62)) — a leitura com fallback `instructor_allocations` → `demands.instructor_id`.

A decisão registrada ali ("o botão do cliente faz split destrutivo") é exatamente o motivo pelo qual participante **não** vai para `instructor_allocations`. O bloco de participantes é um card **novo, irmão** desse, não uma substituição — o titular continua vindo de `demands.instructor_id`/allocations.

#### 3.2 Seleção do cadastro, não texto livre

O padrão já existe na própria tela: o filtro "Instrutor" em [InternalDemands.tsx:1261-1270](components/InternalDemands.tsx#L1261-L1270) monta um `<select>` sobre `instructors`, e o CTM usa o par `ResourceAllocationModal` + `useResourceAllocation` ([1119-1126](components/InternalDemands.tsx#L1119-L1126), [2269](components/InternalDemands.tsx#L2269)) como modal de seleção. Um card "Participantes" com botão ADICIONAR abrindo um modal análogo (lista de `instructors` com `status === 'ATIVO'`, busca, e o instrutor já participante desabilitado) é reuso quase integral.

Filtros que valem a pena aplicar na lista, todos com dado já disponível no `App`:
- excluir quem já é participante (o UNIQUE do banco recusaria, mas o erro seria feio);
- excluir o próprio `formDemand.instructorId` (o titular não é participante de si);
- marcar visualmente quem tem conflito, via `hasScheduleConflict` — o drawer já faz isso ([AllocationDrawer.tsx:913](components/AllocationDrawer.tsx#L913)) e o padrão da casa é **avisar, não bloquear**.

#### 3.3 Shape atual dos blocos de logística e o pré-preenchimento

| | |
|---|---|
| Tipos | [types.ts:165-179](types.ts#L165-L179) (`LogisticaLocomocao`) e [181-191](types.ts#L181-L191) (`LogisticaHospedagem`) — ambos com `instructorName?: string` |
| Construtores | [LogisticaLocomocaoSection.tsx:52-59](components/demand-form/LogisticaLocomocaoSection.tsx#L52-L59) e [LogisticaHospedagemSection.tsx:48-52](components/demand-form/LogisticaHospedagemSection.tsx#L48-L52) |
| Campo na UI | [LogisticaLocomocaoSection.tsx:186-196](components/demand-form/LogisticaLocomocaoSection.tsx#L186-L196) — `<input type="text">` livre, placeholder "Ex.: João Silva" |
| Estado no form | `formDemand.logisticasLocomocao[] / logisticasHospedagem[]`, inicializados com um bloco vazio em [InternalDemands.tsx:661-662](components/InternalDemands.tsx#L661-L662) |
| Persistência | [InternalDemands.tsx:879-930](components/InternalDemands.tsx#L879-L930) → `logistic_blocks.instructor_name` ([logistics.ts:161](services/logistics.ts#L161), [003:10](supabase/migrations/003_logistic_blocks.sql#L10)), `block_order` = índice do array |
| Escrita | `upsertLogisticBlocks` ([logistics.ts:226-247](services/logistics.ts#L226-L247)) — delete-all por `demand_id` + insert |

**O pré-preenchimento é barato:** ao adicionar o participante, empurrar `{ ...emptyLocomocaoBlock(), instructorName: nome }` e `{ ...emptyHospedagemBlock(), instructorName: nome }` nos dois arrays. O save já mapeia índice → `block_order` sem mudança.

**Mas há um achado.** O vínculo participante↔bloco seria **por nome**, em coluna `text`. Renomear o instrutor no cadastro quebra a associação silenciosamente, e dois "João Silva" são indistinguíveis. Recomendo incluir na 016:

```sql
ALTER TABLE logistic_blocks ADD COLUMN IF NOT EXISTS instructor_id uuid NULL;
```

`instructor_name` fica como rótulo de exibição e como fallback das linhas legadas (que nunca terão `instructor_id`). Sem backfill, sem NOT NULL, sem quebrar nada — o mesmo estilo "ausente = comportamento antigo" do `reembolsavel` ([measurementTotals.ts:60](domain/measurementTotals.ts#L60)).

Atenção ao caveat já documentado do `upsertLogisticBlocks`: delete bloqueado por RLS é silencioso e **duplica** em vez de substituir ([logistics.ts:218-225](services/logistics.ts#L218-L225)). Multiplicar blocos por participante multiplica a exposição a esse bug. Não é criado pela feature, mas fica mais provável.

---

### 4. Conflito de agenda

#### 4.1 Comportamento atual, verificado

`hasScheduleConflict` ([App.tsx:2659-2775](App.tsx#L2659-L2775)) tem **três** âncoras e `companion_allocations` não é nenhuma delas:

1. **Demandas por `instructor_id`** ([2706-2732](App.tsx#L2706-L2732)) — só status `PENDENTE`/`ALOCADA`, e desligada quando a demanda já tem alocação explícita ([2712-2713](App.tsx#L2712-L2713)).
2. **`instructor_allocations`** ([2736-2760](App.tsx#L2736-L2760)) — neutra quanto a `tipo`; ignora demanda cancelada ou órfã.
3. **`agenda_items`** ([2764-2772](App.tsx#L2764-L2772)) — férias, folga, indisponível.

**Resposta direta: acompanhante hoje NÃO gera conflito.** Ser acompanhante não ocupa o instrutor para nada. O que existe é a checagem na direção oposta, no ato de criar o acompanhante ([AllocationDrawer.tsx:417](components/AllocationDrawer.tsx#L417), [Logistics.tsx:236](components/Logistics.tsx#L236)) — que consulta as três âncoras acima e portanto também não vê os outros acompanhantes.

#### 4.2 Esforço para incluir participantes

Uma quarta âncora espelhando a segunda: `~20 linhas` de um `demandParticipants.some(...)` com o mesmo `overlapsByDay`, o mesmo tratamento de `DIAS_ESPECIFICOS` ([2745-2757](App.tsx#L2745-L2757)) e o mesmo guard de demanda cancelada/órfã, mais `demandParticipants` no array de dependências ([2774](App.tsx#L2774)).

Duas checagens de sanidade no desenho, ambas favoráveis:

- **Não interage com a exclusão da âncora 1** ([2712-2713](App.tsx#L2712-L2713)): aquela chave em `d.instructorId`, e o participante é outra pessoa. Participante não pode desligar a âncora 1 do titular — e não desliga.
- **Período NULL** (participa do período todo) resolve para os limites da demanda; período próprio recorta. Nos dois casos o insumo é `YYYY-MM-DD`, que é exatamente o que `toDayStart`/`toDayEnd` ([2674-2687](App.tsx#L2674-L2687)) esperam.

Estimativa: **meio dia** com smoke próprio (a regra é pura o bastante para sair do React, como `domain/resourceConflict.ts` já fez para o CTM).

> **Oportunidade adjacente:** as mesmas 20 linhas sobre `companionAllocations` fecham o buraco do acompanhante. Não é regressão introduzida pela feature, mas passará a **bloquear alocações que hoje passam** — mudança de comportamento visível para quem opera a agenda. Ver [Decisão D2](#d2--fechar-o-buraco-de-conflito-do-acompanhante-junto).

---

## Parte 2 — Medição v2

### 5. Shape atual do JSON, completo

Três colunas `jsonb` em `measurements` ([measurements.ts:4-19](services/measurements.ts#L4-L19)):

```
expenses        jsonb   -- objeto
attachments     jsonb   -- array
other_expenses  jsonb   -- array
```

**`expenses`** ([types.ts:322-330](types.ts#L322-L330)):
```ts
{
  breakfast: string; lunch: string; dinner: string;   // OBSERVAÇÃO livre, não valor
  transport: string; others: string;                   // idem (legado)
  classHours?: number;                                 // horas
  hourRate?: number;                                   // valor da hora/aula
}
```
Os cinco primeiros são texto de observação — declarado em [measurementTotals.ts:20-22](domain/measurementTotals.ts#L20-L22) e visível no uso: [Measurement.tsx:1674](components/Measurement.tsx#L1674) passa `expenses.breakfast` como `obs` do `CategoryBlock`.

**`attachments[]`** ([types.ts:289-310](types.ts#L289-L310)) — `id`, `name`, `url`, `data?`, `type`, `date`, `category` (6 valores, [types.ts:14](types.ts#L14)), `value` (number|string), `otherId?`, `reembolsavel?`, `bucket?`, `path?`, `size?`.

O achado central, documentado em [measurementTotals.ts:13-22](domain/measurementTotals.ts#L13-L22): **não existe tabela de despesas nem "valor avulso"** — todo item de despesa é um elemento de `attachments`, inclusive os lançados manualmente sem arquivo.

**`other_expenses[]`** ([types.ts:312-316](types.ts#L312-L316)) — `id`, `description`, `value`. O `value` é **referência e não entra na soma**; quem soma são os attachments com aquele `otherId` ([measurementTotals.ts:104-116](domain/measurementTotals.ts#L104-L116)).

**Flag reembolsável**: mora no item, `ausente = reembolsável`, leitura `=== false` nunca `=== true` ([measurementTotals.ts:56-60](domain/measurementTotals.ts#L56-L60)). É o padrão de compatibilidade sem backfill que o v2 deve imitar.

**Uma medição por demanda**: id `MEA-${demandId}` ([measurements.ts:59](services/measurements.ts#L59)), unique em `demand_id`, upsert `onConflict: 'demand_id'` ([70](services/measurements.ts#L70)), leitura `.maybeSingle()` ([38](services/measurements.ts#L38)). **Nada disso muda no v2.**

### 6. Proposta v2 — blocos-pessoa como índice, não como aninhamento

#### 6.1 O formato

Duas adições, ambas dentro do jsonb existente. **Nenhuma coluna nova, nenhuma migration.**

```jsonc
// measurements.expenses
{
  "breakfast": "...", "lunch": "...", /* ...legado intacto... */
  "classHours": 16, "hourRate": 120,     // v1: permanecem, ver 6.3

  "participantes": [                      // NOVO
    { "instructorId": "uuid-A", "papel": "TITULAR",      "horas": 16, "valorHH": 120 },
    { "instructorId": "uuid-B", "papel": "PARTICIPANTE",                "valorHH": 95  }
    //                                                    ^ horas AUSENTE — ver 7.4
  ]
}

// measurements.attachments[] — um campo opcional a mais
{ "id": "...", "category": "ALMOCO", "value": 42.9, "instructorId": "uuid-B" }
//                                                   ^ NOVO. Ausente = bloco do titular.
```

#### 6.2 Por que índice e não aninhamento

O instinto seria `participantes: [{ instructorId, horas, valorHH, attachments: [...] }]`. **Não faça isso.** Todo leitor de hoje percorre o array plano — `for (const a of m.attachments)` em [measurementTotals.ts:130](domain/measurementTotals.ts#L130) e [296](domain/measurementTotals.ts#L296), `attachments.filter(...)` em [measurementTotals.ts:107](domain/measurementTotals.ts#L107) e [Measurement.tsx:105-107](components/Measurement.tsx#L105-L107), mais o Word e o upload. Aninhar quebra os sete de uma vez.

Com o campo opcional `instructorId` no item:

- **`computeMeasurementTotals(m)` continua devolvendo o total da demanda, sem nenhum ramo v1/v2** — ele simplesmente ignora um campo que não conhece;
- a fatia por pessoa sai **de graça** pelo hook que já existe: `PanelExpenseBreakdownOptions.itemFilter` ([measurementTotals.ts:257-271](domain/measurementTotals.ts#L257-L271)). `aggregatePanelExpenseBreakdown(ms, { itemFilter: a => (a.instructorId ?? titularId) === pessoaId })` já entrega as quatro categorias daquela pessoa, com o mesmo tratamento de órfão e a mesma ordem filtro-antes-de-órfão que o comentário de [262-269](domain/measurementTotals.ts#L262-L269) documenta;
- **soma dos blocos = total por construção**: os blocos são uma *partição* dos itens por um campo opcional cujo ausente cai no titular. É a mesma propriedade que o cabeçalho de [measurementTotals.ts:201-215](domain/measurementTotals.ts#L201-L215) já defende para os quatro buckets.

Custo: a UI de upload precisa saber em que bloco o item está sendo lançado — ou seja, `handleUploadFile` / `handleAddManualValue` ganham um parâmetro `instructorId`. É um parâmetro a mais em duas funções, contra reescrever sete leitores.

#### 6.3 Compatibilidade v1 — leitura dupla, sem migração de dado

Toda medição salva é implicitamente mono-pessoa. A normalização mora em **`domain/measurementTotals.ts`**, fonte única, e é uma função nova:

```ts
export interface MeasurementPersonBlock {
  instructorId: string;
  papel: 'TITULAR' | 'PARTICIPANTE' | 'ACOMPANHANTE';
  /** Ausente no JSON = não informado. NUNCA confundir com 0. */
  horas?: number;
  valorHH: number;
  /** Itens deste bloco — partição de m.attachments. */
  attachments: TotalizableAttachment[];
  /** true quando o bloco absorve os itens sem instructorId. */
  titular: boolean;
}

export function normalizeMeasurementBlocks(
  m: TotalizableMeasurement,
  titularInstructorId?: string
): MeasurementPersonBlock[]
```

Regra:

- **`expenses.participantes` ausente ou vazio → UM bloco** com `instructorId = titularInstructorId`, `horas = expenses.classHours`, `valorHH = expenses.hourRate ?? 0`, `attachments = todos`, `titular: true`. Por construção, `horaAula` desse bloco é `classHours × hourRate` — **exatamente** o que [measurementTotals.ts:120-121](domain/measurementTotals.ts#L120-L121) calcula hoje. Esse é o contrato de compatibilidade, e é provável num smoke.
- **`participantes` presente → um bloco por entrada**, com os attachments particionados por `a.instructorId`; itens sem o campo vão para o bloco `titular`.
- **`horaAula` da medição** vira `Σ(bloco.horas × bloco.valorHH)`, que no caso v1 é o valor antigo.

Duas restrições de projeto que valem ser explícitas:

1. **`measurementTotals.ts` não tem nenhum import hoje** — é um módulo puro sobre seus próprios tipos. A normalização recebe `titularInstructorId` como parâmetro em vez de importar `Demand`, preservando isso (é o que deixa `smoke:custos` rodar sem montar nada).
2. **Nenhum backfill.** `demand_id`, o UNIQUE e o `.maybeSingle()` ficam intactos; o v2 é aditivo dentro do jsonb, do mesmo jeito que `reembolsavel` foi.

### 7. Leitores do JSON — impacto um a um

| # | Leitor | Arquivo:linha | Impacto |
|---|---|---|---|
| 1 | **Painel de Medição — totais** | wrapper [Measurement.tsx:368](components/Measurement.tsx#L368); memo [385-401](components/Measurement.tsx#L385-L401); cards [1544-1563](components/Measurement.tsx#L1544-L1563) | **Baixo.** Os cards mostram o total da demanda, que não muda. Ganham, opcionalmente, um "de N pessoas". |
| 2 | **Painel — Hora/Aula** | UI [1564-1651](components/Measurement.tsx#L1564-L1651); defaults [430-455](components/Measurement.tsx#L430-L455); `getDemandDefaultHours` [247-254](components/Measurement.tsx#L247-L254) | **Alto.** Um par horas+valorHH por pessoa. `getDemandDefaultHours` já resolve `horasPrevistas` para interna ([248-251](components/Measurement.tsx#L248-L251)) — é o default pedido, já implementado. O botão "restaurar" ([1598-1612](components/Measurement.tsx#L1598-L1612)) vira por bloco. |
| 3 | **Painel — 6 CategoryBlocks** | [1653-1706](components/Measurement.tsx#L1653-L1706), componente [70-160](components/Measurement.tsx#L70-L160) | **Alto.** Seções por pessoa. O `CategoryBlock` já filtra por `category`+`otherId` ([105-107](components/Measurement.tsx#L105-L107)); ganha um terceiro critério `instructorId`. Nota: `showReembolsavel={!_selIsInterna}` ([1660](components/Measurement.tsx#L1660)) — em interna o toggle não aparece, o que continua correto por bloco. |
| 4 | **Painel — save + auditoria** | [457-530](components/Measurement.tsx#L457-L530) | **Médio.** O diff lê `_expA.classHours`/`hourRate` ([480-483](components/Measurement.tsx#L480-L483), [501](components/Measurement.tsx#L501)) e degrada para "—" no v2. Precisa virar diff por bloco, senão o log de auditoria da medição fica cego justamente na feature nova. |
| 5 | **`measurementTotals.ts`** | [102-152](domain/measurementTotals.ts#L102-L152), [168-189](domain/measurementTotals.ts#L168-L189), [288-318](domain/measurementTotals.ts#L288-L318), [328-351](domain/measurementTotals.ts#L328-L351) | **Médio, mas contido.** Só a normalização é nova; a quebra por pessoa reusa `itemFilter` ([270](domain/measurementTotals.ts#L270)) sem traversal novo. **`computeMeasurementTotals` não muda de assinatura nem de resultado.** |
| 6 | **Dashboard — Custo das Internas** | [Dashboard.tsx:2857-2861](components/Dashboard.tsx#L2857-L2861) | **Zero.** `aggregateMeasurements` + `aggregatePanelExpenseBreakdown` continuam somando a medição inteira; os números não mudam. Drill-down por pessoa é F4. |
| 7 | **Dashboard — Não Reembolsáveis** | [Dashboard.tsx:2447-2449](components/Dashboard.tsx#L2447-L2449) | **Zero.** É cliente-only e usa `itemFilter: isNaoReembolsavel`. Se um dia precisar combinar pessoa + não-reembolsável, os dois predicados compõem com um `&&`. |
| 8 | **Word** | [Measurement.tsx:780-1050](components/Measurement.tsx#L780-L1050); hora/aula em [787-792](components/Measurement.tsx#L787-L792); linha "Instrutor" em [803](components/Measurement.tsx#L803) | **Médio.** Uma seção por pessoa, ou uma tabela com coluna Pessoa. O recibo é o documento que o instrutor assina — a separação por pessoa **é o produto**, não um detalhe. |
| 9 | **WhatsApp** | [Measurement.tsx:1150-1164](components/Measurement.tsx#L1150-L1164) | **Baixo.** Imprime os 4 totais + total geral, todos da demanda. Ganha, no máximo, uma linha por pessoa. |
| 10 | **Excel — montagem** | [medicaoExportService.ts:210-317](services/medicaoExportService.ts#L210-L317) | **Alto e delicado.** Ver 7.4. |
| 11 | **Excel — workbook/tarifas** | [medicaoWorkbook.ts:180-197](services/medicaoWorkbook.ts#L180-L197), [330-361](services/medicaoWorkbook.ts#L330-L361), [604-616](services/medicaoWorkbook.ts#L604-L616) | **Nenhum, provavelmente.** Ver 7.3. |
| 12 | **`ExpenseItemRow`** | [ExpenseItemRow.tsx:110-119](components/measurement/ExpenseItemRow.tsx#L110-L119) | **Zero.** Só lê `reembolsavel`. |
| 13 | **`instructorHours.ts`** | [121](domain/instructorHours.ts#L121) — lê `expenses.classHours` como override de carga | **Alto.** Ver 7.4. |

#### 7.3 A chave `(instrutor, empresa, tipo, noturno)` aguenta acompanhante com HH próprio?

**Sim, estruturalmente — verificado.** A chave é montada em [medicaoExportService.ts:296-301](services/medicaoExportService.ts#L296-L301) e materializada em `buildTarifaRows` ([medicaoWorkbook.ts:330-361](services/medicaoWorkbook.ts#L330-L361)), que deduplica **dentro de cada bloco de instrutor** ([341-352](services/medicaoWorkbook.ts#L341-L352)) e usa o nome do instrutor como primeira coluna. O SUMIFS cruza as quatro colunas ([604-616](services/medicaoWorkbook.ts#L604-L616)), com o instrutor entrando como literal porque a aba é dele.

Consequência: titular e acompanhante da **mesma** demanda geram **duas linhas distintas** na aba Tarifas, cada uma com sua célula de valor digitável, e duas abas de detalhe separadas. O HH do acompanhante ser diferente do titular já funciona hoje, sem tocar em nada.

**O buraco é outro, e é real:** a chave não tem componente de **papel**. Se a *mesma pessoa* for titular na demanda A e acompanhante na demanda B, com mesma empresa/tipo/noturno, as duas linhas colapsam numa só entrada de Tarifas — e ela recebe o mesmo valor/hora nos dois papéis. Se acompanhar valer menos que ministrar, a chave precisa de um quinto componente. Ver [Decisão D4](#d4--papel-é-chave-de-tarifa).

#### 7.4 O ponto delicado: `instructorHours.ts` × blocos v2 sem dupla contagem

Este é o item que decide o desenho. Vale começar pelo estado de fato:

- A planilha de pagamento tira horas **exclusivamente** de `computeInstructorHoursByDemand` ([medicaoExportService.ts:231-238](services/medicaoExportService.ts#L231-L238)), cuja fonte é `instructor_allocations` — sem linha na tabela, `continue` e a demanda **não gera linha nenhuma** ([instructorHours.ts:168-169](domain/instructorHours.ts#L168-L169)).
- Participante e acompanhante **não** estarão em `instructor_allocations` (decisão de escopo, e o motivo está na análise anterior: o split destrutivo apagaria participantes uns dos outros, e o rateio dias/união multiplicaria as horas de quem trabalha nos mesmos dias — 2 instrutores no mesmo período numa interna de 16h dão 16h **cada**).
- Logo, **para participante e acompanhante não existe dupla contagem a reconciliar**: hoje eles valem zero na planilha, e o bloco da medição será a única fonte.
- A sobreposição existe **só para o titular**, que aparece nos dois lados: rateio (via allocations) e bloco próprio (via medição).

**Proposta: os blocos são override por pessoa, com precedência declarada. Nunca soma.**

Uma função pura nova — `applyMeasurementOverrides(rows, measurements, demands)`, em `domain/` — aplicada **depois** de `computeInstructorHoursByDemand` e **antes** de montar os blocos do workbook:

| situação | regra |
|---|---|
| existe `hoursRow` **e** bloco com `horas` **presente** | `horas` do bloco **substitui** a do rateio. `dias` continua vindo do rateio (o bloco não tem dias). |
| existe `hoursRow` e bloco com `horas` **ausente** | rateio inalterado. |
| **não** existe `hoursRow` e existe bloco | **insere** linha nova — é o participante/acompanhante. `dias` derivados do período próprio, ou de `getDemandDays(demand)` quando o período for NULL. |
| não existe bloco | nada muda. |

Três razões para override em vez de "blocos mandam em tudo":

1. `computeInstructorHoursByDemand` é a fonte única de cinco leitores além do Excel — ranking do Dashboard ([Dashboard.tsx:903](components/Dashboard.tsx#L903), [967](components/Dashboard.tsx#L967)), alerta "concluída sem alocação" ([1032-1035](components/Dashboard.tsx#L1032-L1035)) — e trocar a fonte mudaria o número de toda demanda de cliente que nunca terá bloco.
2. Override é aditivo e reversível: apagar o bloco devolve o rateio.
3. Mantém a regra de rateio (e o caso DEM-359 que a justifica, [instructorHours.ts:17-25](domain/instructorHours.ts#L17-L25)) intocada e testada pelo `smoke:medicao` atual.

##### ⚠️ A guarda mais importante do desenho: `horas` ausente ≠ zero

O default pedido — "horas do participante = `horas_previstas`" — **não pode ser gravado com avidez no JSON**. Se cada bloco nascesse com `horas` preenchido, no dia em que a F2 entrar **toda interna com bloco passaria do rateio para horas por pessoa**, e uma interna de 16h dividida entre 2 instrutores saltaria de 16h totais para 32h — a linha "✖" da tabela da análise anterior, agora alcançável pela porta da frente.

Portanto:

- **`horas` fica ausente no JSON até o usuário digitar.** A UI mostra o default (`horas_previstas`, via `getDemandDefaultHours` — [Measurement.tsx:247-254](components/Measurement.tsx#L247-L254), que já faz isso) como *placeholder*, não como valor gravado. É o mesmo truque de `reembolsavel` ([measurementTotals.ts:56-60](domain/measurementTotals.ts#L56-L60)) e de `classHours` ([Measurement.tsx:451](components/Measurement.tsx#L451), que hoje grava o default — **e isso precisa mudar**).
- **Ausente resolve de forma diferente conforme o caso:** para quem *tem* `hoursRow` (o titular), ausente = "mantenha o rateio". Para quem *não tem* (participante/acompanhante), ausente = "use `horas_previstas`". Os dois fallbacks são distinguidos exatamente pela existência da linha de rateio, não por adivinhação.

##### O segundo `valorHH`

O Excel é construído sobre a regra "o app entrega horas; o valor da hora é digitado à mão na planilha" — declarada em [medicaoWorkbook.ts:11-13](services/medicaoWorkbook.ts#L11-L13) e toda célula de valor é fórmula. O `valorHH` do bloco cria uma segunda fonte para o mesmo número.

Recomendo **não conectar os dois em F2/F3**: o `valorHH` do bloco é o custo interno (alimenta "Custo das Demandas Internas" e o recibo Word), e a aba Tarifas continua manual. Pré-preencher a célula de tarifa quebraria a proteção de aba e a nota "NÃO PREENCHA AQUI" ([medicaoWorkbook.ts:606-611](services/medicaoWorkbook.ts#L606-L611)). Revisitar em F4, se a duplicidade incomodar. Ver [Decisão D5](#d5--valorhh-do-bloco-alimenta-a-aba-tarifas).

### 8. Cobertura de Ociosidade — dimensionamento

`computeIdleCoverage` ([instructorAvailability.ts:143-164](domain/instructorAvailability.ts#L143-L164)) detecta cobertura **só** por `d.instructorId` ([150](domain/instructorAvailability.ts#L150)). Um participante de interna hoje conta como **não coberto** — o card subestima o próprio indicador, e a análise anterior já registrou isso como pendência (§3.1).

O que muda:

- `computeIdleCoverage` ganha um parâmetro opcional com os participantes (ou um `extraCoverage: Map<instructorId, D[]>`), e o `byInstructor` passa a ser alimentado por duas fontes. **~15 linhas**, e a assinatura permanece compatível.
- O chamador ([Dashboard.tsx:2883-2891](components/Dashboard.tsx#L2883-L2891)) passa a lista já recortada por período.
- `getAvailableInstructors` / `getBusyInstructorIds` ([88-104](domain/instructorAvailability.ts#L88-L104)) **não mudam**: participante é de interna, e `countsAsBusy: d => d.tipo !== 'interna'` ([Dashboard.tsx:2888](components/Dashboard.tsx#L2888)) deve continuar valendo — se a interna ocupasse, receber interna tiraria o instrutor de "ocioso" e a resposta do card seria zero por construção (o comentário de [2863-2873](components/Dashboard.tsx#L2863-L2873) já defende isso).
- `smoke:ociosidade` ganha os casos novos.

**Esforço: 0,5 dia.** É fase própria (F4) porque é mudança de semântica do card, não consequência mecânica.

---

## Parte 3 — Plano de fases

### F1 — Infraestrutura de participante

| item | detalhe |
|---|---|
| **Migration** | **016** — `demand_participants` (tabela, CHECK, FK composta, UNIQUE, 2 índices, RLS + 4 policies no formato da [012](supabase/migrations/012_internal_demands_schema.sql)) + `UNIQUE (id, tipo)` em `demands` + `logistic_blocks.instructor_id uuid NULL`. **Primeira migration desde a [015](supabase/migrations/015_locais_demandas_internas_seed.sql) — revisar com Bernardo antes de aplicar; banco antes do push.** |
| Código | `services/demandParticipants.ts` (fetch paginado + insert + delete, no molde de [companionAllocations.ts](services/companionAllocations.ts)); estado + realtime no App ([1313-1319](App.tsx#L1313-L1319) como molde) e a linha de limpeza em [deleteDemand](App.tsx#L1688-L1692); card "Participantes" no form interno com modal de seleção; pré-preenchimento dos blocos de logística; 5ª fonte na agenda; 4ª âncora no conflito |
| **Esforço** | **3–4 dias** |

Ao fim da F1 o participante existe, aparece na agenda em âmbar, tem logística própria e gera conflito. **Ainda não recebe pagamento** — e isso precisa estar dito na tela, senão a F1 sozinha parece completa e não é.

### F2 — Medição v2 (interna)

| item | detalhe |
|---|---|
| **Migration** | **nenhuma** — tudo dentro dos jsonb existentes |
| Código | `normalizeMeasurementBlocks` em [measurementTotals.ts](domain/measurementTotals.ts); `instructorId` opcional em `Attachment`; UI do painel em seções por pessoa (itens 2, 3, 4 da tabela de 7); Word por pessoa; `applyMeasurementOverrides` + fio no [medicaoExportService](services/medicaoExportService.ts) |
| **Esforço** | **4–6 dias** — a maior parte é UI do painel e Word |

### F3 — Acompanhante de cliente na medição

| item | detalhe |
|---|---|
| **Migration** | nenhuma obrigatória. **Sugerida: 017 versionando a DDL de `companion_allocations`** (e, no mesmo fôlego, `instructor_allocations` e `resource_allocations`) — três tabelas centrais sem `CREATE TABLE` versionado são bomba-relógio de ambiente, e a F3 passa a fazer pagamento depender de uma delas |
| Código | reusa integralmente a normalização da F2; a fonte do bloco passa a ser `companion_allocations` em vez de `demand_participants`; papel `ACOMPANHANTE`; o painel de cliente ganha as seções |
| **Esforço** | **2–3 dias** |

### F4 — Cobertura e KPIs

| item | detalhe |
|---|---|
| **Migration** | nenhuma |
| Código | `computeIdleCoverage` com participantes (item 8); drill-down por pessoa nos cards do Dashboard; decidir D5 (`valorHH` × Tarifas) |
| **Esforço** | **1–2 dias** |

**Total: 10–15 dias**, uma única migration (016), com a 017 recomendada como higiene em F3.

### Smokes de contraprova críticos

O padrão da casa — reproduzir a implementação **antiga** dentro do smoke e exigir que ela **falhe** — está em [smokeLocalOnline.ts:8-20](scripts/smokeLocalOnline.ts#L8-L20) e [smokeDatasDemanda.ts:18-24](scripts/smokeDatasDemanda.ts#L18-L24). Vale para todos os quatro:

| # | Contraprova | Onde | O que prende |
|---|---|---|---|
| 1 | **Soma dos blocos = total da medição** | novo `smoke:medicao-blocos`, ou dentro de [smokeCustos.ts](scripts/smokeCustos.ts) | `Σ blocos.despesas === computePanelExpenseBreakdown(m).total` e `Σ blocos.horaAula === computeMeasurementTotals(m).horaAula`, inclusive com item de `instructorId` desconhecido e com órfão de OUTROS (a exclusão de [measurementTotals.ts:305-308](domain/measurementTotals.ts#L305-L308) tem de valer por bloco) |
| 2 | **Medição v1 lê idêntico ao comportamento atual** | mesmo smoke | Medição sem `participantes` → exatamente 1 bloco, e `computeMeasurementTotals` devolve **os mesmos números** de hoje. Regressão ancorada na implementação v1 reproduzida no arquivo |
| 3 | **Acompanhante não duplica horas do titular no Excel** | estender [smokeMedicao.ts](scripts/smokeMedicao.ts) | Titular com allocation + acompanhante com bloco → duas linhas, **soma = horas da demanda**, não o dobro. E: bloco com `horas` **ausente** não altera o rateio do titular (a guarda de 7.4) |
| 4 | **Participantes não entram em `instructor_allocations`** | guarda de fonte, estilo [smokeDatasDemanda.ts §5](scripts/smokeDatasDemanda.ts) | Nenhum `addInstructorAllocation` / `upsertInstructorAllocation` / `replaceInstructorAllocationsForDemand` alcançável a partir do fluxo de participante, e `services/demandParticipants.ts` não importa `instructorAllocations` |
| 5 | *(recomendo somar)* **`horas` ausente ≠ zero** | mesmo smoke do #1 | Participante sem `horas` resolve para `horas_previstas`; titular sem `horas` mantém o rateio. Sem isso, um `?? 0` desavisado zera pagamento em silêncio |

---

## Decisões abertas — Bernardo

#### D1 — Granularidade do período do participante
Proponho `date` (dia inteiro), com NULL = período todo da demanda, e o horário do card saindo de `getDayHorarioInicio`/`Fim` — o que já corrige, para o participante, o `T08:00` fixo que o acompanhante tem hoje. **Isso serve?** Se algum caso real é "participa só da manhã", precisamos de timestamptz e da convenção de parede documentada em [demandDateTime.ts](domain/demandDateTime.ts).

#### D2 — Fechar o buraco de conflito do acompanhante junto
As mesmas ~20 linhas que colocam participante em `hasScheduleConflict` colocam acompanhante. Corrige um buraco real, **mas passa a bloquear alocações que hoje passam** — mudança visível para quem opera a agenda no dia do deploy. Junto na F1, ou item separado com aviso à equipe?

#### D3 — O titular é também um bloco?
Meu desenho diz **sim**: o titular é o bloco `TITULAR`, absorve os attachments sem `instructorId`, e é o que faz "soma dos blocos = total" valer sem caso especial. A alternativa (titular fora do array, só os participantes dentro) economiza uma entrada no JSON e custa um ramo especial em cada leitor. **Confirma o titular como bloco?**

#### D4 — Papel é chave de tarifa?
A chave do Excel é `(instrutor, empresa, tipo, noturno)`. Ela separa **pessoas** diferentes na mesma demanda sem nenhuma mudança — isso está resolvido. O que ela **não** separa é a mesma pessoa em papéis diferentes: titular na demanda A e acompanhante na demanda B, mesma empresa, recebem o mesmo valor/hora. **Acompanhar vale menos que ministrar, para a mesma pessoa?** Se sim, a chave ganha um quinto componente e `buildTarifaRows` ([medicaoWorkbook.ts:330-361](services/medicaoWorkbook.ts#L330-L361)) muda junto.

#### D5 — `valorHH` do bloco alimenta a aba Tarifas?
Proponho **não** em F2/F3: o bloco é custo interno, a aba Tarifas continua manual, e a regra "toda célula de valor é fórmula" ([medicaoWorkbook.ts:11-13](services/medicaoWorkbook.ts#L11-L13)) fica de pé. O preço é digitar o valor duas vezes para a mesma pessoa. **Aceita a duplicidade agora e revisita em F4?**

#### D6 — Nome da tabela
`demand_participants` (minha recomendação, alinhada ao precedente de discriminador da [014](supabase/migrations/014_location_context.sql)) ou `internal_demand_participants` (mais explícito, mas engessa)?

#### D7 — Versionar a DDL das três tabelas de alocação
`companion_allocations`, `instructor_allocations` e `resource_allocations` não têm `CREATE TABLE` em migration nenhuma. A F3 faz pagamento depender da primeira. Vale uma **017** que só reproduz o que já está em produção (padrão da [007](supabase/migrations/007_trainings_rls_consolidation.sql)/[012](supabase/migrations/012_internal_demands_schema.sql)), depois de rodar [diagnostico_auditoria.sql:100-113](diagnostico_auditoria.sql#L100-L113) contra as três?

---

## Verificações executadas

- Leitura integral de [companionAllocations.ts](services/companionAllocations.ts), [instructorAllocations.ts](services/instructorAllocations.ts), [measurements.ts](services/measurements.ts), [measurementTotals.ts](domain/measurementTotals.ts), [instructorHours.ts](domain/instructorHours.ts), [medicaoExportService.ts](services/medicaoExportService.ts), [demandInstructors.ts](domain/demandInstructors.ts), [instructorAvailability.ts](domain/instructorAvailability.ts).
- Grep completo de `companion` em `.ts`/`.tsx`/`.sql` fora de `node_modules`/`dist` — 7 grupos de leitores, tabela em 2.4.
- Leitura de `hasScheduleConflict` ([App.tsx:2659-2775](App.tsx#L2659-L2775)) linha a linha: **três** âncoras, nenhuma é `companion_allocations`.
- Leitura das quatro passadas de `agendaByDay` ([CalendarView.tsx:451-641](components/CalendarView.tsx#L451-L641)) e do ramo de cor ([1740-1782](components/CalendarView.tsx#L1740-L1782)).
- Leitura de `buildTarifaRows` e do SUMIFS ([medicaoWorkbook.ts:330-361](services/medicaoWorkbook.ts#L330-L361), [604-616](services/medicaoWorkbook.ts#L604-L616)) para responder 7.3.
- Migrations 003, 008, 012 e 014 lidas na íntegra para extrair os padrões de tabela nova, RLS e discriminador.

**O que não foi verificado:** DDL e policies reais de `companion_allocations`, `instructor_allocations` e `resource_allocations` — não existem no repositório e não tenho acesso ao banco (a anon key do `.env` não enxerga as linhas por RLS). Toda afirmação sobre RLS dessas três é inferência a partir do código e da ausência nas migrations, não leitura de `pg_policies`.
