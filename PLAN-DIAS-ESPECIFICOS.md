# PLANO: Suporte a Dias Específicos (Não Contínuos) na Demanda

## 1. DIAGNÓSTICO — Onde startDate/endDate são usados hoje

### 1.1 Camada de Tipos e Persistência
| Arquivo | O que usa | Classificação |
|---------|-----------|---------------|
| `types.ts` L165-166 | `Demand { startDate, endDate }` | TYPE |
| `services/demands.ts` L14-15 | `DemandRow { start_date, end_date }` | TYPE/PERSIST |
| `services/demands.ts` L48-55 | `fetchDemands()` select query | PERSIST |
| `App.tsx` L798-821 | `mapDemandFromDb` (start_date → startDate) | MAP |
| `App.tsx` L825-857 | `mapDemandToDb` (startDate → start_date) | MAP |

### 1.2 Lógica de Status
| Arquivo | O que usa | Classificação |
|---------|-----------|---------------|
| `domain/demandStatus.ts` L30-89 | `calculateDemandStatus()` → `new Date(startDate/endDate)` compara com `now` | STATUS |
| `Dashboard.tsx` L166-174 | chama `calculateDemandStatus` com startDate/endDate | STATUS |
| `Demands.tsx` L780, L870, L943 | chama `calculateDemandStatus` (3 vezes) | STATUS |
| `Evidences.tsx` L63-68 | chama `calculateDemandStatus` | STATUS |
| `LogisticsControl.tsx` L539-540 | chama `calculateDemandStatus` | STATUS |

### 1.3 Renderização da Agenda (CalendarView.tsx) — 7 LOOPS CURSOR
| Loop | Fonte de dados | Linhas | Impacto |
|------|---------------|--------|---------|
| 1 | `daysInView` (filtro De/Até) | 301-332 | Sem impacto (gera grid visual) |
| 2 | `mobileResourceEvents` | 345-359 | Sem impacto (CTM local, não é demanda) |
| 3 | `resourceAllocations` | 368-393 | **IMPACTO** — itera range de alocação, mas depende da demanda |
| 4 | `agendaItems` (manual) | 408-422 | Sem impacto (manual, datas próprias) |
| 5 | `instructorAllocations` | 426-492 | **IMPACTO ALTO** — cursor itera startDate→endDate, HIBRIDO intersecta |
| 6 | `companionAllocations` | 494-551 | **IMPACTO ALTO** — mesmo padrão do loop 5 |
| 7 | `demands` (legado) | 554-590 | **IMPACTO ALTO** — cursor itera startDate→endDate diretamente |

### 1.4 Detecção de Conflitos (App.tsx)
| Função | Linhas | O que faz |
|--------|--------|-----------|
| `hasScheduleConflict` | 2371-2455 | `overlapsByDay()` compara ranges: `as <= be && ae >= bs` |
| `hasResourceConflict` | 2458-2483 | `start <= aEnd && end >= aStart` |
| `getEffectiveDemandRange` | 1183-1197 | Retorna practice dates para HIBRIDO ou start/end normal |

### 1.5 Filtros por Período
| Arquivo | Linhas | Padrão |
|---------|--------|--------|
| `Dashboard.tsx` L177-197 | `new Date(d.startDate) < filters.startDate` |
| `Measurement.tsx` L205-206 | `d.startDate < advancedFilters.startDate` |
| `ExportDemandsModal.tsx` L120-121 | `d.startDate < filters.startDate` |
| `LogisticsControl.tsx` L352-356 | `dStart <= periodBounds.end && dEnd >= periodBounds.start` |
| `CalendarView.tsx` L248-260 | `intersectsRange()` com dayStart comparisons |

### 1.6 Exibição/Exportação
| Arquivo | O que mostra |
|---------|-------------|
| `Demands.tsx` L2423-2424 | DataViewField "Início" / "Fim" |
| `Demands.tsx` L888-889 | WhatsApp: "Período: X até Y" |
| `Demands.tsx` L997 | DOCX: "Período: X até Y" |
| `ExportDemandsModal.tsx` L172-173 | Excel: colunas "Data Início" / "Data Fim" |
| `Evidences.tsx` L258 | "startDate → endDate" |
| `EvidenceDetails.tsx` L415 | "startDate - endDate" |
| `Measurement.tsx` L612, L987 | DOCX + tabela |

---

## 2. DECISÃO DE MODELAGEM

### Opção escolhida: C) Manter ambos + criar camada de abstração

**Estrutura:**
```
Demand {
  dateMode: 'CONTINUO' | 'DIAS_ESPECIFICOS'   // NOVO
  specificDates?: string[]                      // NOVO — ['2026-02-12', '2026-02-13', '2026-02-19', '2026-02-20']
  startDate: string                             // MANTIDO (auto-derivado como min de specificDates)
  endDate: string                               // MANTIDO (auto-derivado como max de specificDates)
  startTime: string                             // já existia embutido no startDate (ex: '08:00')
  endTime: string                               // já existia embutido no endDate (ex: '18:00')
}
```

**Justificativa técnica:**
1. **Compatibilidade total**: startDate/endDate continuam existindo → TODO o legado funciona sem quebrar
2. **Verdade está em specificDates**: quando dateMode === 'DIAS_ESPECIFICOS', a fonte da verdade é o array
3. **Sem joins**: array `text[]` no Supabase é nativo e performático para ~30-60 itens
4. **Derivação automática**: startDate = min(specificDates) + time, endDate = max(specificDates) + time
5. **Helper centralizado**: `getDemandDays(demand)` retorna os dias corretos para QUALQUER modo

### Supabase — Migração
```sql
ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS date_mode TEXT NOT NULL DEFAULT 'CONTINUO',
  ADD COLUMN IF NOT EXISTS specific_dates TEXT[] DEFAULT NULL;
```
- Demandas existentes: `date_mode = 'CONTINUO'`, `specific_dates = NULL` → comportamento idêntico ao atual
- Novas demandas com dias alternados: `date_mode = 'DIAS_ESPECIFICOS'`, `specific_dates = ['2026-02-12', ...]`

---

## 3. CAMADA DE ABSTRAÇÃO — `domain/demandDays.ts`

Funções centralizadas que TODOS os componentes devem usar:

```typescript
/** Retorna array de 'YYYY-MM-DD' para os dias da demanda */
getDemandDays(demand: Demand): string[]
// Se CONTINUO: gera todos os dias entre startDate e endDate
// Se DIAS_ESPECIFICOS: retorna specificDates (ordenado)

/** Retorna { start, end } como Date (limites min/max) */
getDemandBounds(demand: Demand): { start: Date; end: Date }
// Sempre usa startDate/endDate (que são auto-derivados)

/** Verifica se um dia específico faz parte da demanda */
isDemandDay(demand: Demand, date: Date | string): boolean
// Se CONTINUO: date >= startDate && date <= endDate
// Se DIAS_ESPECIFICOS: specificDates.includes(formatDateKey(date))

/** Verifica se a demanda intersecta um range de filtro */
demandIntersectsRange(demand: Demand, from?: string, to?: string): boolean
// Se CONTINUO: range overlap padrão
// Se DIAS_ESPECIFICOS: ANY specificDate falls within [from, to]

/** Verifica se duas demandas têm conflito de dias */
demandDaysOverlap(demandA: Demand, startB: string, endB: string, specificDatesB?: string[]): boolean
// Compara os conjuntos de dias reais
```

---

## 4. PLANO DE IMPLEMENTAÇÃO (8 Etapas)

### Etapa 1: Tipos + Serviços + Migração SQL
- **types.ts**: Adicionar `dateMode` e `specificDates` à interface Demand
- **services/demands.ts**: Adicionar `date_mode` e `specific_dates` ao DemandRow e ao select
- **App.tsx mapDemandFromDb**: Mapear `date_mode` → `dateMode`, `specific_dates` → `specificDates`
- **App.tsx mapDemandToDb**: Mapear inverso + derivar startDate/endDate automaticamente
- **SQL**: `ALTER TABLE demands ADD COLUMN date_mode TEXT DEFAULT 'CONTINUO', ADD COLUMN specific_dates TEXT[] DEFAULT NULL`

### Etapa 2: Helper `domain/demandDays.ts`
- Criar arquivo com as 5 funções listadas acima
- Testes implícitos: cada função deve funcionar tanto com CONTINUO quanto DIAS_ESPECIFICOS

### Etapa 3: UI do Formulário (Demands.tsx)
- Toggle "Dias contínuos" / "Dias específicos" no form
- Modo contínuo: inputs atuais (Início/Fim com date+time) — zero mudança
- Modo específico: seletor de datas (input date + botão "Adicionar" + chips com X para remover)
- Inputs de horário (startTime/endTime) compartilhados entre os modos
- Resumo: "4 dias selecionados | 12/fev a 20/fev"
- Validação: ao menos 1 data no modo específico
- Auto-derivação de startDate/endDate antes de salvar

### Etapa 4: Visualização (Demands.tsx VIEW + exports)
- DataViewField: mostrar "Dias específicos: 12, 13, 19, 20/fev" quando aplicável
- WhatsApp message: incluir lista de dias
- DOCX export: incluir lista de dias
- ExportDemandsModal: coluna extra ou modificar "Data Início"/"Data Fim" para incluir info

### Etapa 5: Agenda — CalendarView.tsx
- **Loops 5, 6, 7**: Substituir cursor while(start→end) por iteração em `getDemandDays()`
  - Loop 5 (instructorAllocations): o allocation tem suas próprias datas, MAS filtramos contra os dias da demanda
  - Loop 6 (companionAllocations): idem
  - Loop 7 (demands legado): substitui completamente por getDemandDays
- **Loop 3 (resourceAllocations)**: idem, filtra contra dias da demanda
- `intersectsRange`: usar `demandIntersectsRange` para cards com demanda vinculada

### Etapa 6: Detecção de Conflitos (App.tsx)
- `hasScheduleConflict`: substituir `overlapsByDay` por comparação dia-a-dia usando `getDemandDays`
- `hasResourceConflict`: idem
- `getEffectiveDemandRange`: manter para HIBRIDO, mas respeitar dias específicos

### Etapa 7: Filtros por Período
- `Dashboard.tsx`: usar `demandIntersectsRange` em vez de comparação simples
- `Measurement.tsx`: idem
- `ExportDemandsModal.tsx`: idem
- `LogisticsControl.tsx`: idem

### Etapa 8: Verificação e Testes
- Build limpo (npx vite build)
- Cenários de teste manual conforme requisitos

---

## 5. RISCOS E MITIGAÇÕES

| Risco | Mitigação |
|-------|-----------|
| Quebrar demandas existentes | `dateMode` default 'CONTINUO' + specificDates NULL → legado intacto |
| Performance dos loops com Sets | ~30 dias max por demanda, Set lookup O(1) |
| Alocações com datas diferentes da demanda | Alocações mantêm suas próprias datas, mas filtramos contra `isDemandDay` |
| HIBRIDO + dias específicos | practiceStartDate/practiceEndDate continuam separados, intersecção respeita dias |
| Exports quebrarem | startDate/endDate continuam preenchidos, exports usam esses campos |
| Filtros Dashboard/Measurement | Substituição cirúrgica por `demandIntersectsRange` |

---

## 6. CENÁRIOS DE TESTE

| # | Cenário | Validação |
|---|---------|-----------|
| A | PRESENCIAL dias 12,13,19,20 | Salva, agenda mostra SÓ nesses dias, conflito só nesses dias |
| B | ONLINE dias 12,13,19,20 | Salva e reflete em agenda/filtros |
| C | HÍBRIDO dias específicos + prática | Agenda mostra prática nos dias corretos |
| D | CONTÍNUO qualquer modalidade (12→20) | Funciona IGUAL ao sistema atual |
| E | Filtro "De/Até" com dias específicos | Demanda aparece se QUALQUER dia estiver no range |
| F | Demanda antiga (sem dateMode) | Funciona normalmente como CONTINUO |
| G | Conflito: instrutor em dia 13, nova demanda em 12-14 | Conflito detectado apenas se dia 13 estiver na lista |
