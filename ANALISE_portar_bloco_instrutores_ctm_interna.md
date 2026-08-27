# Portar o bloco Instrutores + Centro Móvel para a Demanda Interna — análise

**Branch:** `mvp-estavel` · **Escopo:** análise, sem código e sem migration
**Veredito curto:** cenário **(a) com pré-requisito bloqueante** — mas o pré-requisito não é o que eu supunha na primeira leitura. O botão ADICIONAR **não** adiciona um co-instrutor: ele faz um *split destrutivo* de dias, e com o período pré-preenchido (o padrão) ele **apaga a alocação do instrutor anterior**. Detalhes em 1.2 e 3.3; recomendação na seção 6.

---

## 1. Fluxo atual do bloco no modal de cliente

O bloco vive em [components/Demands.tsx:3208-3310](components/Demands.tsx#L3208-L3310), dentro de `{modalSubMode === 'VIEW' && ...}` — dois cards lado a lado num grid de 2 colunas: "Instrutores" ([3212-3254](components/Demands.tsx#L3212-L3254)) e "Centro Móvel" ([3256-3300](components/Demands.tsx#L3256-L3300)).

`Demands.tsx` opera sobre um dataset cliente-only, cortado na entrada ([Demands.tsx:154](components/Demands.tsx#L154)):

```ts
const demands = useMemo(() => allDemands.filter(d => d.tipo !== 'interna'), [allDemands]);
```

Não há **nenhuma** condicional de `tipo` dentro do bloco — ele não precisa, porque interna nunca chega neste componente.

### 1.1 O que ADICIONAR escreve

Grava em **`instructor_allocations`**, não em `companion_allocations`. O payload é montado em [Demands.tsx:2041-2047](components/Demands.tsx#L2041-L2047):

```ts
const newAllocation: InstructorAllocation = {
  id: `ALOC-${Date.now()}`,
  demandId: formDemand.id!,
  instructorId: allocationForm.instructorId,
  startDate: startIso,
  endDate: endIso
};
```

e persiste via `addInstructorAllocation` em [2077](components/Demands.tsx#L2077) (caminho normal) ou [2091](components/Demands.tsx#L2091) (caminho "confirmei apesar do conflito"). Cinco campos, nada mais — sem `role`, sem `is_principal`, sem `tipo`.

**Não toca `demands.instructor_id`.** O único efeito colateral na demanda é o status: `NOVA`/`PENDENTE` viram `ALOCADA` ([2072-2076](components/Demands.tsx#L2072-L2076)).

Mas o nome do handler engana. `addInstructorAllocation` ([App.tsx:2192-2320](App.tsx#L2192-L2320)) **não é um insert** — é um *split destrutivo*, declarado no próprio cabeçalho ([2192-2198](App.tsx#L2192-L2198)):

> *"Regra de negócio: cada DIA só pode pertencer a UM instrutor dentro da mesma demanda. Ao adicionar uma nova alocação, os dias que se sobrepõem são removidos de qualquer instrutor que os possuía anteriormente e passam para o novo instrutor."*

Cinco casos de recorte ([2230-2300](App.tsx#L2230-L2300)), e depois `replaceInstructorAllocationsForDemand` reescreve todas as linhas da demanda ([2302-2313](App.tsx#L2302-L2313)):

| caso | situação | efeito na alocação antiga |
|---|---|---|
| 1 ([2232](App.tsx#L2232)) | nova **cobre** a antiga | **removida por inteiro** |
| 2 ([2239-2262](App.tsx#L2239-L2262)) | nova no meio da antiga | antiga vira duas |
| 3 ([2266-2279](App.tsx#L2266-L2279)) | sobreposição no fim | antiga aparada |
| 4 ([2283-2296](App.tsx#L2283-L2296)) | sobreposição no início | antiga aparada |
| 5 ([2299](App.tsx#L2299)) | sem sobreposição | mantida |

Isso é decisivo: `handleOpenAllocationModal` pré-preenche o formulário com o **período inteiro da demanda** ([Demands.tsx:1947-1970](components/Demands.tsx#L1947-L1970)). Quem abre "Adicionar", escolhe um instrutor e confirma sem mexer nas datas cai no **caso 1** — e o instrutor que estava lá é **apagado**, sem aviso. Para haver dois instrutores é obrigatório editar as datas para sub-períodos disjuntos.

### 1.2 "Principal" vs "adicional" — não existe na modelagem, e o bloco não faz o que o nome diz

Não há coluna que distinga. "Principal 1" e "Principal 2" são **derivados em memória**: os dois primeiros `instructorId` distintos ordenados por `startDate` ([Demands.tsx:2305-2327](components/Demands.tsx#L2305-L2327)):

```ts
const allocs = instructorAllocations
  .filter(a => a.demandId === formDemand.id && a.instructorId && a.startDate)
  .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
// [0] = principal 1, [1] = principal 2
```

Existe um segundo campo, `demands.instructor_id`, mas ele é escrito por outro caminho — `allocateInstructor` ([App.tsx:2960-2999](App.tsx#L2960-L2999)), que faz as duas coisas de uma vez:

```ts
updateDemand({ ...demand, instructorId, status: 'ALOCADA' });
addInstructorAllocation({ id: `ALOC-${Date.now()}`, demandId, instructorId, startDate: finalStart, endDate: finalEnd });
```

Ou seja: **a primeira alocação (pela tela de alocação/agenda) sincroniza os dois; o botão ADICIONAR do modal só escreve a tabela.** Não há trigger de banco fazendo essa sincronia — ver seção 5.

Consequência já em produção: `demands.instructor_id` e `instructor_allocations` divergem por construção, e cada leitor escolheu um lado. Está documentado em [instructorAvailability.ts:22-26](domain/instructorAvailability.ts#L22-L26) e [instructorHours.ts:169](domain/instructorHours.ts#L169).

**O bloco é um divisor de dias, não um adicionador de co-instrutores.** Junte o split de 1.1 com o texto do próprio modal ([Demands.tsx:3462-3464](components/Demands.tsx#L3462-L3464)):

> *"Este recurso é destinado a adicionar instrutores **acompanhantes** a uma demanda já alocada. Para alocação principal, use a Programação ou Alocação Inteligente."*

O aviso se repete nos três diálogos de confirmação ([3568-3571](components/Demands.tsx#L3568-L3571)). Só que **acompanhante tem tabela própria** — `companion_allocations` ([services/companionAllocations.ts](services/companionAllocations.ts)) — alimentada por `addCompanionAllocation`, e o único lugar que a usa é o `AllocationDrawer` da agenda ([AllocationDrawer.tsx:329-336](components/AllocationDrawer.tsx#L329-L336)). O botão ADICIONAR **não escreve nela**.

Ou seja, o bloco promete acompanhante, grava divisão de dias, e no uso padrão remove o instrutor anterior. O empty state reforça o mal-entendido: *"Nenhum instrutor adicional alocado"* ([3252](components/Demands.tsx#L3252)) — quando `currentAllocations` lista **todas** as alocações, inclusive a do principal vinda da Programação.

Isso não é opinião de estilo: é a semântica que seria copiada para a interna.

### 1.3 Validação de conflito no ADICIONAR

`hasScheduleConflict` ([Demands.tsx:2049-2053](components/Demands.tsx#L2049-L2053)) **não bloqueia** — abre um modal de confirmação. O usuário pode alocar por cima de um conflito. Há ainda uma classificação de qualificação (`qualified` / `exception` / `unqualified`, [2055-2067](components/Demands.tsx#L2055-L2067)) que também é só um aviso.

### 1.4 O que ALOCAR CTM escreve

Tabela **`resource_allocations`**, discriminada por `resource_type = 'CENTRO_TREINAMENTO_MOVEL'` ([services/resourceAllocations.ts:3-11](services/resourceAllocations.ts#L3-L11)). Handler em [Demands.tsx:2117-2164](components/Demands.tsx#L2117-L2164):

```ts
const newAllocation: LogisticAllocation = {
  id: `RES-${Date.now()}`,
  demandId: formDemand.id!,
  resourceType: 'CENTRO_TREINAMENTO_MOVEL',
  startDate: startDateTime,   // 'YYYY-MM-DDT08:00'
  endDate: endDateTime        // 'YYYY-MM-DDT18:00'
};
```

Duas validações, essas sim **bloqueantes**:
1. período do CTM contido no da demanda ([2130-2134](components/Demands.tsx#L2130-L2134));
2. `hasResourceConflict` ([2137-2141](components/Demands.tsx#L2137-L2141)) — o CTM é recurso único, e a checagem é overlap puro em [App.tsx:2685-2708](App.tsx#L2685-L2708), ignorando demandas `CANCELADA`.

A persistência usa `onConflict: 'demand_id,resource_type'` ([resourceAllocations.ts:34-36](services/resourceAllocations.ts#L34-L36)) — logo existe um UNIQUE `(demand_id, resource_type)` no banco: **um CTM por demanda**.

### 1.5 Como o bloco lê

Ambos filtram o estado global do `App` por `demandId`, sem ida ao banco:

- Instrutores: [Demands.tsx:2289-2292](components/Demands.tsx#L2289-L2292) — `instructorAllocations.filter(a => a.demandId === formDemand.id)`
- CTM: [Demands.tsx:2295-2297](components/Demands.tsx#L2295-L2297) — mesmo padrão sobre `resourceAllocations`

O estado vem de `fetchInstructorAllocations` ([services/instructorAllocations.ts:18-26](services/instructorAllocations.ts#L18-L26), paginado) e `fetchResourceAllocations` ([services/resourceAllocations.ts:14-26](services/resourceAllocations.ts#L14-L26), **sem paginação** — ver risco em 3.4).

### 1.6 Permissões — o achado desconfortável

**Nenhum dos dois botões tem guard de permissão.** As únicas condições são `modalSubMode === 'VIEW'` e `currentStatus !== 'CANCELADA'` ([Demands.tsx:3218](components/Demands.tsx#L3218) e [3262](components/Demands.tsx#L3262)).

`domain/demandPermissions.ts` só conhece quatro ações — `create_demand`, `edit_demand`, `delete_demand`, `cancel_demand` ([demandPermissions.ts:15-19](domain/demandPermissions.ts#L15-L19)) — e **alocar não é uma delas**. As sete chamadas de `canPerformAction` em `Demands.tsx` ([1033](components/Demands.tsx#L1033), [2417](components/Demands.tsx#L2417), [2836](components/Demands.tsx#L2836), [3362](components/Demands.tsx#L3362), [3378](components/Demands.tsx#L3378), [3395](components/Demands.tsx#L3395)) cobrem só criar/editar/excluir/cancelar.

O único gate real é o acesso à *view*, via `ROLE_PERMISSIONS` ([App.tsx:~250](App.tsx)): `admin` e `analista` veem `demands` e `internal-demands`; `coordenador` vê **apenas** `calendar`. Ou seja, hoje **todo mundo que enxerga a tela pode alocar** — e a camada de baixo (RLS) não segura, porque as policies de `demands` são `auth.role() = 'authenticated'` sem filtro de coluna ([012:85-99](supabase/migrations/012_internal_demands_schema.sql#L85-L99)) e as das tabelas satélites nem versionadas estão.

Portar o bloco **replica esse buraco**, não o cria. Mas replica.

---

## 2. A assimetria: quem lê `instructor_allocations`

Grep completo (`.ts`/`.tsx`/`.sql`, fora de `node_modules`/`dist`). Leitores reais, agrupados:

| # | Leitor | Arquivo:linha | Fonte que usa |
|---|---|---|---|
| 1 | Horas por instrutor (fonte única) | [instructorHours.ts:169](domain/instructorHours.ts#L169) | **allocations** (ignora `instructor_id`) |
| 2 | Disponibilidade / ociosidade | [instructorAvailability.ts:22-26](domain/instructorAvailability.ts#L22-L26) | **`demands.instructor_id`** (ignora allocations) |
| 3 | Conflito de agenda | [App.tsx:2720-2744](App.tsx#L2720-L2744) | ambos |
| 4 | Sugestão de instrutores | [App.tsx:2913-2926](App.tsx#L2913-L2926) | via conflito (ambos) |
| 5 | Excel de medição (pagamento) | [medicaoExportService.ts:231](services/medicaoExportService.ts#L231) | **allocations** |
| 6 | Dashboard — Horas Ministradas / ranking | [Dashboard.tsx:903](components/Dashboard.tsx#L903), [967](components/Dashboard.tsx#L967) | **allocations** |
| 7 | Dashboard — aviso "concluída sem alocação" | [Dashboard.tsx:1032-1035](components/Dashboard.tsx#L1032-L1035) | **allocations** |
| 8 | Agenda / CalendarView | [CalendarView.tsx:455](components/CalendarView.tsx#L455), [476-477](components/CalendarView.tsx#L476-L477) | **allocations** (prioridade 1) |
| 9 | Tela Demandas Internas (lista) | [InternalDemands.tsx:365-375](components/InternalDemands.tsx#L365-L375) | **allocations**, com fallback |
| 10 | Export XLSX de demandas | [InternalDemands.tsx:1478](components/InternalDemands.tsx#L1478) | allocations |
| 11 | Realtime sync | [App.tsx:1297-1302](App.tsx#L1297-L1302) | — |
| 12 | Notificações | [notificationAlerts.ts:117-121](domain/notificationAlerts.ts#L117-L121) | **`demands.instructor_id`** |

**Ponto que muda o enquadramento da tarefa:** a interna **já pode** ter linha em `instructor_allocations` — só não pelo modal dela. O write existe em `Demands.tsx` e `CalendarView.tsx`, e a agenda aloca interna normalmente ([CalendarView.tsx:234](components/CalendarView.tsx#L234)). A própria UI orienta isso: *"Aloque pela agenda para as horas passarem a contar"* ([Dashboard.tsx:3116](components/Dashboard.tsx#L3116)). E [InternalDemands.tsx:365-375](components/InternalDemands.tsx#L365-L375) já **lê** allocations de interna com fallback para `instructor_id`.

A assimetria é **de escrita numa tela**, não de modelo de dados. Está fixada em teste: [smokeDashboardInternas.ts:170-202](scripts/smokeDashboardInternas.ts#L170-L202).

### 2.1 Cenário (a) — interna grava allocations como cliente

| Leitor | O que acontece |
|---|---|
| Horas (1) | Interna passa a somar horas ministradas. **É o efeito desejado** e resolve o aviso "concluída sem alocação". ⚠️ Exposta ao bug de 3.3 (split desfeito por edição de datas). |
| Disponibilidade (2) | **Nada muda.** Não lê allocations. Adicional continua invisível para a ociosidade. |
| Conflito (3) | Adicional de interna passa a bloquear/avisar cliente e vice-versa. Melhora real — hoje só a 1ª interna, via `instructor_id`, participa. |
| Sugestão (4) | Herda o conflito: instrutor com interna adicional some da lista "sugeridos" e aparece em "já alocado". |
| Excel (5) | **Interna alocada entra na planilha de pagamento.** Impacto financeiro direto. Ver 3.3. |
| Dashboard (6,7) | Ranking passa a contar internas com adicional; o alerta amarelo esvazia. |
| Agenda (8) | Adicional de interna ganha card próprio na grade. Já suportado. |
| Tela Internas (9) | Já preparada — passa a mostrar N nomes em vez de 1. **Zero mudança de código.** |
| Notificações (12) | **Nada muda.** Ancorado em `instructor_id`; alocar adicional não silencia "Aguardando Alocação". |

### 2.2 Cenário (b) — bloco com armazenamento próprio

Uma tabela nova (ex.: `internal_demand_instructors`) mantém os 12 leitores intactos: nada muda em horas, conflito, Excel, dashboard ou agenda.

O preço: o adicional de interna vira **dado decorativo**. Não gera conflito de agenda (o instrutor pode ser alocado em cliente no mesmo dia sem aviso), não aparece na grade, não entra em horas nem no pagamento. É exatamente o que o time já classificou como bug em cliente — a demanda existe, o instrutor "está" nela, e nenhuma conta enxerga.

Exige migration nova (tabela + RLS) e um segundo caminho de leitura em toda tela que quiser exibir os adicionais. **Custo maior que (a) e valor menor.**

---

## 3. Pontos sensíveis, um a um

### 3.1 `instructorAvailability.ts` e o `countsAsBusy`

**Adicional de interna em allocations não muda conta nenhuma aqui.** O módulo lê exclusivamente `d.instructorId` ([instructorAvailability.ts:96-104](domain/instructorAvailability.ts#L96-L104)), e o cabeçalho declara a limitação ([22-26](domain/instructorAvailability.ts#L22-L26)):

> *"Também não olha `instructor_allocations`: a ocupação vem de `demands.instructor_id`, então acompanhante alocado sem ser o instrutor principal não conta como ocupado. Isso é herdado, não introduzido."*

O `countsAsBusy: d => d.tipo !== 'interna'` do card de Cobertura ([Dashboard.tsx:2834](components/Dashboard.tsx#L2834)) continua íntegro.

**"Adicional alocado deveria contar como coberto?"** — `computeIdleCoverage` detecta cobertura por `d.instructorId` ([instructorAvailability.ts:150-158](domain/instructorAvailability.ts#L150-L158)). Minha leitura: **sim, deveria.** A pergunta do card é "a ferramenta de ocupação está sendo usada?"; um instrutor ocioso que recebeu uma interna como adicional foi ocupado de fato, e hoje conta como *não coberto* — o card subestima o próprio indicador.

Mas isso é **mudança de semântica do card, não consequência do porte**. O porte não piora nem melhora; só aumenta a frequência do caso. Recomendo tratar como item separado.

### 3.2 Conflito cruzado interna × cliente

`hasScheduleConflict` ([App.tsx:2642-2758](App.tsx#L2642-L2758)) roda sobre o dataset **completo** do `App` — internas incluídas; quem corta por tipo é o `Dashboard`/`Demands`, não o `App`. São três âncoras:

1. **Demandas por `instructor_id`** ([2689-2716](App.tsx#L2689-L2716)) — com uma exclusão importante em [2696-2697](App.tsx#L2696-L2697):
   ```ts
   const hasExplicitAllocation = instructorAllocations.some(a => a.demandId === d.id);
   if (hasExplicitAllocation) return false;
   ```
   Havendo alocação explícita, a demanda **para** de conflitar por `instructor_id` e passa a conflitar só pela tabela. Hoje interna não tem allocation → conflita pelo `instructor_id`. No cenário (a) a âncora **troca** — e é aqui que mora o risco de regressão: se a alocação da interna cobrir menos dias que a demanda, os dias descobertos deixam de conflitar.
2. **Alocações explícitas** ([2720-2744](App.tsx#L2720-L2744)) — neutra quanto a `tipo`; só ignora demanda `CANCELADA` ou órfã.
3. **Agenda** ([2748-2756](App.tsx#L2748-L2756)) — férias/folga.

**Adicionais entram na checagem?** Hoje, em cliente, **sim** — via âncora 2, que não distingue principal de adicional. Em interna, hoje **não** (não há linha). No cenário (a), passam a entrar.

### 3.3 Medição, pagamento e o Excel

**Medição não é por instrutor.** É **uma por demanda**: `id: "MEA-DEM-6301"`, chave `demand_id`, leitura com `.maybeSingle()` ([services/measurements.ts:4-12](services/measurements.ts#L4-L12) e [33-39](services/measurements.ts#L33-L39)). Instrutor adicional **não gera medição própria**, nem em cliente nem em interna. Essa parte está segura.

**A chave do Excel aguenta N instrutores?** Sim. A tarifa é `(instrutor, empresa, tipo, noturno)` ([medicaoExportService.ts:296-301](services/medicaoExportService.ts#L296-L301)) e a estrutura é um bloco por instrutor, com uma linha por demanda ([254-280](services/medicaoExportService.ts#L254-L280)). N instrutores na mesma interna geram N blocos com uma linha cada — nenhuma colisão de chave, ordenação estável ([311-313](services/medicaoExportService.ts#L311-L313)).

#### O rateio das horas, e onde ele quebra

Em [instructorHours.ts:223](domain/instructorHours.ts#L223):

```ts
horas: (dias.length / totalDiasDemanda) * horasTotais
```

onde `totalDiasDemanda` é o tamanho da **união dos dias alocados** ([193-200](domain/instructorHours.ts#L193-L200)), *não* o número de participantes. Executei o módulo real contra uma interna de 16h (`horas_previstas = 16`, 2 dias):

| cenário | por instrutor | soma |
|---|---|---|
| 1 instrutor, 2 dias | I-1: 16h | **16h** ✔ |
| 2 instrutores, dias divididos | I-1: 8h · I-2: 8h | **16h** ✔ |
| 2 instrutores, **mesmo período** | I-1: 16h · I-2: 16h | **32h** ✖ |
| 3 instrutores, mesmo período | 16h cada | **48h** ✖ |

A fórmula modela **divisão** de dias (foi para isso que foi desenhada — ver o caso DEM-359 em [instructorHours.ts:17-25](domain/instructorHours.ts#L17-L25)) e **não** modela co-docência no mesmo dia.

#### Por que o botão ADICIONAR, sozinho, não produz isso

O split destrutivo de `addInstructorAllocation` (1.1) **impede a sobreposição na origem**: cada dia pertence a um instrutor só, então a união bate com a soma das partes e o rateio fecha. Pelo caminho do botão, a linha "✖" da tabela acima é inalcançável.

O preço dessa proteção é o outro problema: em vez de pagar dobrado, o sistema **apaga o instrutor anterior** (caso 1). Não há duplicação de custo; há perda silenciosa de vínculo — e as horas do apagado somem do ranking, do Dashboard e da planilha.

#### Onde a sobreposição É alcançável

Por `updateInstructorAllocation` ([App.tsx:2322-2352](App.tsx#L2322-L2352)), que faz `prev.map(a => a.id === updated.id ? updated : a)` — substituição crua, **sem passar pelo split**. Três chamadores:

1. [Demands.tsx:1605-1614](components/Demands.tsx#L1605-L1614) — ao **editar as datas da demanda**, TODAS as alocações dela são reescritas para o novo período cheio:
   ```ts
   instructorAllocations.filter(a => a.demandId === sanitizedDemand.id).forEach(alloc => {
     updateInstructorAllocation({ ...alloc, startDate: sanitizedDemand.startDate, endDate: sanitizedDemand.endDate });
   });
   ```
   Uma demanda dividida entre I-1 (dia 1) e I-2 (dia 2) vira, após uma edição de data, **I-1 e I-2 ambos cobrindo os dois dias**. O split é desfeito e o rateio dobra.
2. [Demands.tsx:1648-1653](components/Demands.tsx#L1648-L1653) — mesma coisa para mudança de horário (preserva o dia, muda só HH:mm; risco menor).
3. [CalendarView.tsx:771](components/CalendarView.tsx#L771) — drag de alocação entre instrutores; troca o `instructorId` mantendo o período, então não cria sobreposição por si.

**Resumo honesto:** o caminho (1) é um bug real e já ativo em cliente, mas é **ortogonal ao porte** — ele não depende do bloco existir na interna. Portar o bloco não o cria nem o agrava; o que o porte faz é aumentar o número de demandas divididas, que são a matéria-prima dele. Deixa de ser pré-requisito bloqueante e vira **acompanhamento paralelo, de prioridade alta** — com o agravante de que, em interna, a carga é `horas_previstas` ([instructorHours.ts:126-131](domain/instructorHours.ts#L126-L131)) e a Colabor absorve 100% do custo, sem contraparte de faturamento.

### 3.4 CTM na interna

**Funcionalmente faz sentido** — "Apoio Logístico" é categoria de interna, e o CTM é exatamente o recurso desse caso de uso.

**Interação com `demandLogisticsStatus.ts`: nenhuma.** O checklist tem cinco colunas — `hotel`, `car`, `material`, `release`, `list` ([demandLogisticsStatus.ts:88-95](domain/demandLogisticsStatus.ts#L88-L95)) — e **CTM não é uma delas**. `LogisticsChecklistInput` ([58-85](domain/demandLogisticsStatus.ts#L58-L85)) nem recebe o dado. Alocar CTM não move a prontidão em direção nenhuma. O tratamento de interna (`material` e `list` → `NAO_APLICA`, [111-121](domain/demandLogisticsStatus.ts#L110-L121)) fica intocado. **Sem risco aqui.**

**Disponibilidade do recurso:** `hasResourceConflict` ([App.tsx:2685-2708](App.tsx#L2685-L2708)) é overlap puro sobre `resourceAllocations`, sem olhar `tipo`. Interna já competiria corretamente pelo CTM com cliente. O UNIQUE `(demand_id, resource_type)` garante um CTM por demanda.

**Único ponto de atenção:** `fetchResourceAllocations` ([services/resourceAllocations.ts:14-26](services/resourceAllocations.ts#L14-L26)) **não pagina** — é o único fetch de alocação sem `fetchAllPaginated`. Passando de ~1000 linhas, o PostgREST corta em silêncio e a checagem de conflito passa a aprovar sobreposições. Aumentar o volume de CTM (que é o que o porte faz) aproxima esse teto. Independente da decisão, vale corrigir.

---

## 4. RLS de `instructor_allocations` e `resource_allocations`

**Nenhuma das duas tabelas existe em SQL versionado.** Varredura dos 19 `.sql` do repositório: zero `CREATE TABLE`, zero `CREATE POLICY`, zero índice, zero CHECK, zero trigger para qualquer uma delas. Verifiquei por conta própria:

```
$ grep -rn "instructor_allocations\|resource_allocations" supabase/migrations/
(nenhum resultado)
```

As duas aparecem no repositório **só como string**, na lista de tabelas auditadas: [auditoria_rls.sql:31](auditoria_rls.sql#L31) e [auditoria_rls.sql:33](auditoria_rls.sql#L33). Foram criadas pelo dashboard do Supabase — a mesma dívida que a [007](supabase/migrations/007_trainings_rls_consolidation.sql) e a [012:68-70](supabase/migrations/012_internal_demands_schema.sql#L68-L70) admitem para outras tabelas e depois versionaram.

**Portanto: não é possível responder "as policies cobrem escrita a partir do fluxo interno?" a partir do código.** Só `pg_policies` responde.

Indícios circunstanciais, nos dois sentidos:

- **A favor de que passe:** a [008_rls_gaps_consolidation.sql](supabase/migrations/008_rls_gaps_consolidation.sql) fechou os buracos apontados pela auditoria e corrigiu `companies`, `evidences`, `measurements` e `companion_allocations` — **`instructor_allocations` não está lá**, o que sugere que passou na auditoria com as quatro policies. E o app grava nessa tabela a partir de demanda interna hoje, pela agenda, sem erro relatado.
- **Contra:** o app já bateu em bloqueio de RLS nessa tabela — a mensagem existe em [services/instructorAllocations.ts:48](services/instructorAllocations.ts#L48). E o `replace` está documentado como perigoso justamente porque um delete bloqueado por RLS é silencioso e **duplica alocações** ([instructorAllocations.ts:54-62](services/instructorAllocations.ts#L54-L62)).

Em `resource_allocations` o risco de silêncio é maior: os erros são só `console.error` ([resourceAllocations.ts:41-44](services/resourceAllocations.ts#L41-L44)) e o delete não é endurecido ([52-55](services/resourceAllocations.ts#L52-L55)).

A query de introspecção pronta está em [diagnostico_auditoria.sql:100-113](diagnostico_auditoria.sql#L100-L113) — já seleciona `qual` e `with_check`; basta trocar o nome da tabela.

---

## 5. O CHECK da 012 e constraints que assumem `tipo='cliente'`

Texto exato ([012_internal_demands_schema.sql:39-43](supabase/migrations/012_internal_demands_schema.sql#L39-L43)):

```sql
ALTER TABLE demands
  ADD CONSTRAINT demands_interna_requires_fields
  CHECK (tipo <> 'interna' OR (categoria_interna IS NOT NULL AND horas_previstas > 0));
```

- `tipo = 'interna'` → exige `categoria_interna NOT NULL` **e** `horas_previstas > 0`. Como `NULL > 0` avalia para `NULL`, o CHECK falha: `horas_previstas` é obrigatória e estritamente positiva.
- `tipo = 'cliente'` → primeiro disjunto verdadeiro, não exige nada.

**Não afeta tabelas satélites.** É `ALTER TABLE demands`, escopo de linha; CHECK no Postgres não referencia outra tabela. `instructor_allocations` e `resource_allocations` são indiferentes.

Outras constraints da 012:
- [30-34](supabase/migrations/012_internal_demands_schema.sql#L30-L34): `demands_tipo_check CHECK (tipo IN ('cliente','interna'))`
- [57-62](supabase/migrations/012_internal_demands_schema.sql#L57-L62): `demands_cliente_requires_refs CHECK (tipo <> 'cliente' OR (company_id IS NOT NULL AND training_id IS NOT NULL)) NOT VALID` — a única que assume `cliente` de forma dura, e também só sobre `demands`.

**Nenhuma constraint, trigger, function ou policy versionada assume `tipo='cliente'` em tabela satélite.** As policies de `demands` são neutras — a própria 012 declara ([71-73](supabase/migrations/012_internal_demands_schema.sql#L71-L73)):

> *"todas TO authenticated, predicado `auth.role() = 'authenticated'`, nenhuma filtra por coluna — ou seja, demanda interna não muda nada de acesso."*

O único precedente de satélite que "assumia cliente" foi `location_associations`, resolvido por **coluna discriminadora** `contexto` + UNIQUE composto, não por policy ([014_location_context.sql:21-29](supabase/migrations/014_location_context.sql#L21-L29), [43-44](supabase/migrations/014_location_context.sql#L43-L44)). É o precedente de estilo da casa.

**Nenhum trigger sincroniza `demands.instructor_id` ↔ `instructor_allocations`.** Não existe `CREATE TRIGGER` nem `CREATE FUNCTION` em nenhum `.sql` do repo. A sincronia é da aplicação e é parcial — o único ponto explícito é o drag da agenda ([CalendarView.tsx:773-776](components/CalendarView.tsx#L773-L776)).

Migrations em ordem: `001`…`015`; a última é `015_locais_demandas_internas_seed.sql`. Próxima seria `016_`.

---

## 6. Recomendação

### Cenário (a) — portar gravando em `instructor_allocations`, com um pré-requisito

**Por que (a) e não (b):** o modelo já suporta interna com allocations — a agenda faz isso hoje, a tela Internas já lê ([InternalDemands.tsx:365-375](components/InternalDemands.tsx#L365-L375)), o Excel já rotula `tipo: 'Interna'` ([medicaoExportService.ts:300](services/medicaoExportService.ts#L300)) e `effectiveDemandHours` já trata interna ([instructorHours.ts:126-131](domain/instructorHours.ts#L126-L131)). O porte não abre caminho novo: **fecha um caminho que já existe pela porta dos fundos.** (b) criaria uma segunda verdade sobre "quem trabalhou nesta demanda", com adicional decorativo — invisível para conflito, agenda, horas e pagamento. Mais migration, mais código, menos valor.

**O pré-requisito bloqueante é a semântica do botão, não o rateio.** Portar o bloco como está leva para a interna um botão que:

- diz que adiciona **acompanhante** ([Demands.tsx:3462-3464](components/Demands.tsx#L3462-L3464));
- grava em `instructor_allocations`, não em `companion_allocations`;
- e, com o período pré-preenchido — o clique padrão —, **apaga o instrutor que já estava alocado** (caso 1 do split, [App.tsx:2232](App.tsx#L2232)).

Em cliente isso é atenuado porque o instrutor principal chega pela Programação e o usuário do modal é quem já entende a divisão de dias. Na interna não há esse caminho paralelo: o instrutor vem do **cadastro da demanda** (`demands.instructor_id`), que o split nem enxerga. O resultado seria o pior dos dois mundos — o usuário "adiciona" um segundo instrutor, a tabela passa a ter só o novo, e `demands.instructor_id` continua apontando para o antigo. Duas fontes discordando, sem nada na tela sinalizando.

Isso é uma decisão de produto de meia hora, não uma refatoração: **o botão adiciona co-instrutor (e aí o alvo é `companion_allocations`) ou divide dias (e aí o rótulo e o pré-preenchimento precisam mudar)?** Sem essa resposta, o porte propaga uma ambiguidade que já confunde em cliente.

### O que a investigação precisa responder

**Bloqueante para liberar:**
1. **O botão é "acompanhante" ou "divisor de dias"?** Se acompanhante de verdade, o destino é `companion_allocations` — que **não** entra em horas nem no Excel, e o porte fica trivial e sem risco financeiro. Se divisor, o rótulo e o pré-preenchimento (hoje, período cheio) precisam mudar antes de ir para a interna.
2. **Na interna, quem manda: `demands.instructor_id` ou a tabela?** O split não sincroniza o campo do cadastro. Decidir se a primeira alocação assume o campo (como `allocateInstructor` faz, [App.tsx:2984-2996](App.tsx#L2984-L2996)) ou se o campo continua soberano. Afeta conflito (3.2), notificações e Cobertura de Ociosidade.

**Bloqueante para deploy:**
3. **RLS real das duas tabelas** ([diagnostico_auditoria.sql:100-113](diagnostico_auditoria.sql#L100-L113)): as policies existem? Alguma faz join com `demands` filtrando `tipo`?

**Paralelo, prioridade alta, não bloqueia o porte:**
4. **O desfazimento do split ao editar datas** ([Demands.tsx:1605-1614](components/Demands.tsx#L1605-L1614), seção 3.3). Query de verificação: demandas `CONCLUIDA` com 2+ alocações de instrutores distintos e dias sobrepostos. Se houver linhas, houve pagamento a maior em planilhas **já emitidas** — retroativo, não prospectivo.
5. **Co-docência no mesmo dia é caso real?** Define se `(dias/união) × horas` está errado ou apenas incompleto.

### Esforço

| Etapa | Estimativa | Observação |
|---|---|---|
| Decisão de produto (1) + desenho (2) | 0,5 dia | Conversa + query; sem código |
| Confirmar RLS (3) | 1 h | Uma query, template pronto no repo |
| Porte do bloco | 0,5–1 dia | Reuso quase integral do JSX; handlers já existem no `App` |
| Guard de permissão | 0,5 dia | Ampliar `demandPermissions.ts` com `allocate_instructor`/`allocate_resource` e aplicar **nos dois modais** |
| Paginar `fetchResourceAllocations` | 0,5 h | Independente; corrige buraco existente |
| **Porte, total** | **1,5–2,5 dias** | |
| *(paralelo)* investigar/corrigir o split desfeito (4,5) | 1–2 dias | Toca `instructorHours.ts`, fonte única de pagamento — smoke pesado e conferência contra planilha emitida |

### Migrations necessárias

**Cenário (a): nenhuma migration de schema.** As tabelas existem, aceitam qualquer `demand_id`, e nenhuma constraint versionada distingue tipo. O que pode ser necessário — e só a investigação (3) dirá — é **versionar** as policies existentes de `instructor_allocations` e `resource_allocations`, no padrão da [007](supabase/migrations/007_trainings_rls_consolidation.sql)/[012](supabase/migrations/012_internal_demands_schema.sql): uma `016_` que reproduz o que já está em produção, sem mudar comportamento. Recomendo fazer isso independentemente da decisão — duas tabelas centrais sem DDL versionada são uma bomba-relógio de ambiente.

Se a decisão de (1) for "acompanhante de verdade", `companion_allocations` também não precisa de migration — a tabela existe e a [008:39-40](supabase/migrations/008_rls_gaps_consolidation.sql#L39-L40) já corrigiu o buraco de UPDATE dela.

**Cenário (b): migration obrigatória** — tabela nova + 4 policies + índices.

### Riscos residuais em (a)

1. **Troca de âncora no conflito** (3.2): interna que ganha allocation parcial perde conflito nos dias descobertos. Mitigação: alocação cobrindo o período inteiro por padrão, como faz `allocateInstructor`.
2. **Cobertura de Ociosidade subestimada** (3.1): adicional não conta como coberto. Não é regressão do porte, mas fica mais visível.
3. **Ranking e "Horas Ministradas" mudam de valor** no dia do deploy — internas antes invisíveis passam a contar. É correção, mas vai parecer salto; vale avisar quem lê o Dashboard.
4. **RLS não versionada**: um ambiente novo pode não reproduzir as policies.
5. **`fetchResourceAllocations` sem paginação**: teto de ~1000 linhas com falha silenciosa na checagem de conflito de CTM.
6. **O split desfeito** (3.3) continua ativo até ser corrigido, e o porte aumenta a matéria-prima dele.

### Meio-termo recomendado se houver pressa

**Portar só o Centro Móvel agora; o bloco de Instrutores depois da decisão (1).** O CTM não toca `instructor_allocations`, não entra em horas nem em pagamento, é invisível para o checklist de logística (3.4), tem conflito bloqueante próprio e já é neutro quanto a `tipo`. Resolve o caso de uso de Apoio Logístico — que é justamente o que motiva o pedido — com risco próximo de zero e meio dia de trabalho. O item ambíguo fica isolado atrás de uma pergunta de produto, em vez de atrasar a entrega inteira.

---

## 7. Verificações executadas

- Grep completo de `instructor_allocations` / `resource_allocations` em `.ts`, `.tsx` e `.sql` — confirmado que **nenhuma migration** menciona as duas tabelas.
- Leitura direta de [012_internal_demands_schema.sql:28-99](supabase/migrations/012_internal_demands_schema.sql#L28-L99) — CHECKs e policies transcritos do arquivo.
- **Execução real** de `computeInstructorHoursByDemand` com quatro arranjos de alocação (seção 3.3). O script foi temporário e removido; não há alteração pendente no repositório além deste `.md`.
- Leitura de [App.tsx:2192-2320](App.tsx#L2192-L2320) (split destrutivo) e [2322-2352](App.tsx#L2322-L2352) (`updateInstructorAllocation` sem split), mais os três chamadores deste último.
- Confirmado que `canPerformAction` não gate nenhum dos dois botões (7 chamadas inspecionadas em `Demands.tsx`).

**O que não foi verificado:** as policies RLS e a DDL reais das duas tabelas — não existem no repositório e não tenho acesso ao banco. Toda afirmação sobre RLS nesta análise é inferência a partir do código do app e da ausência nas migrations, não leitura de `pg_policies`.
