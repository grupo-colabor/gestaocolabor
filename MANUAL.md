# Manual do Usuário — Sistema COLABOR

> Versão MVP Estável · Atualizado em 25/02/2026

---

## Sumário

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Fluxo Completo de uma Demanda](#2-fluxo-completo-de-uma-demanda)
3. [Dashboard](#3-dashboard)
4. [Demandas](#4-demandas)
5. [Agenda / Programação](#5-agenda--programação)
6. [Controle Logístico](#6-controle-logístico)
7. [Medição](#7-medição)
8. [Evidências](#8-evidências)
9. [Cadastros](#9-cadastros)
10. [Exportações Disponíveis](#10-exportações-disponíveis)
11. [Regras de Negócio e Status](#11-regras-de-negócio-e-status)
12. [Dicionário de Campos](#12-dicionário-de-campos)

---

## 1. Visão Geral do Sistema

O **COLABOR** é um sistema de gestão de treinamentos corporativos. Ele centraliza todas as etapas do processo: desde o cadastro de uma demanda de treinamento até o registro das evidências e o faturamento das despesas.

### Para que serve

- Registrar e acompanhar **demandas de treinamento** de clientes
- Gerenciar a **agenda dos instrutores** e evitar conflitos
- Controlar a **logística** de viagem (transporte, hospedagem, materiais)
- Registrar **evidências** (listas de presença, certificados, fotos)
- Contabilizar e aprovar **despesas** (medição/faturamento)

### Perfis de acesso

| Perfil | O que pode fazer |
|--------|-----------------|
| **Admin** | Acesso total: criar, editar, deletar demandas; gerenciar usuários e cadastros; exportações de Medições e Demandas |
| **Analista** | Criar, editar e deletar demandas; visualizar tudo, exceto Medição; exportação de Demandas |
| **Coordenador** | Visualiza apenas demandas que possuem instrutor alocado |

---

## 2. Fluxo Completo de uma Demanda

Uma demanda passa pelas seguintes etapas:

```
[1] CRIAR DEMANDA
        ↓ Status: NOVA
[2] ALOCAR INSTRUTOR
        ↓ Status: ALOCADA
[3] CONFIRMAR LOGÍSTICA (Controle Logístico)
        ↓ Carro ✓ · Hotel ✓ · Material ✓ · Documentos ✓
[4] TREINAMENTO ACONTECE
        ↓ Status: EM_ANDAMENTO → CONCLUÍDA
[5] REGISTRAR EVIDÊNCIAS
        ↓ Lista de Presença · Certificados · Fotos
[6] LANÇAR DESPESAS (Medição)
        ↓ Café · Almoço · Jantar · Transporte · Hospedagem · Outros
[7] APROVAR E FATURAR
        ↓ Status Medição: FATURADA
```

### Passo a passo detalhado

**1. Criar a Demanda**
Acesse **Demandas → + Nova Demanda**. Preencha empresa, treinamento, datas, local, modalidade e logística.

**2. Alocar o Instrutor**
Abra a demanda e clique em **Alocar Instrutor**. O sistema exibe instrutores disponíveis com score de compatibilidade (região + skills). Selecione o instrutor e o período de atuação.

**3. Conferir a Logística**
Acesse **Controle Logístico**. Para cada demanda próxima, confirme: carro, hotel, material e documentos. Faça upload dos PDFs de lista da turma e liberação do instrutor.

**4. Acompanhar o Treinamento**
Durante as datas da demanda, o status muda automaticamente para **EM_ANDAMENTO**. Após o término, muda para **CONCLUÍDA**.

**5. Registrar Evidências**
Acesse **Evidências**. Faça upload da lista de presença, certificados e fotos (quando aplicável).

**6. Lançar Despesas**
Acesse **Medição**. Para cada demanda concluída, registre as despesas com recibos/fotos das notas. Avance pelos estágios: Lançamento → Conferência → Pronta para Faturamento → Faturada.

---

## 3. Dashboard

### O que é

Painel de controle com métricas, gráficos e indicadores de saúde operacional do mês.

### Filtros disponíveis

- **Mês/Ano**: Seletor principal; filtra todos os dados da tela
- **Período personalizado**: Data início e data fim
- **Empresa**: Filtra por cliente específico
- **Região**: Sudeste, Norte, Nordeste
- **Status**: NOVA, PENDENTE, ALOCADA, EM_ANDAMENTO, CONCLUÍDA, CANCELADA
- **Local do Treinamento**: Valores dinâmicos
- **Corredor**: Responsável operacional
- **Botão Resetar Filtros**: Volta aos valores padrão

### Abas

#### Geral
- Total de demandas no período
- Distribuição por status (gráfico em barras)
- Distribuição por modalidade (PRESENCIAL, ONLINE, HÍBRIDO, TUTORIA)
- **Alertas de Pendência**: demandas sem instrutor com prazo ≤ 4 dias
- **Alertas de Medição**: demandas concluídas sem despesas lançadas
- Contador de demandas canceladas (clique para expandir)

#### Operacional
- Demandas sem instrutor (NOVA/PENDENTE) que precisam de ação
- Demandas sem confirmação de logística
- Demandas que iniciam em breve

#### Instrutores
- Lista de instrutores com demandas alocadas
- Horas de treinamento por instrutor
- Skills e níveis de especialização

#### Clientes
- Volume de demandas por empresa
- Histórico de treinamentos por cliente

#### Custos
- Total de despesas por categoria
- Média de custo por demanda
- Custos por empresa
- Evolução de despesas no período

### Exportar pelo Dashboard

Clique em **Exportar** para abrir o modal de exportação Excel (veja seção 10).

---

## 4. Demandas

### Lista de Demandas

#### Busca rápida (campo de texto)
Pesquisa por: ID da demanda, ID do cliente, nome da empresa ou nome do treinamento. A busca ignora acentuação.

#### Filtros avançados (clique para expandir)
- Empresa, Região, Treinamento, Instrutor, Status, Data Início, Data Fim, Local do Treinamento

#### Ordenação
Clique no cabeçalho de qualquer coluna para ordenar (clique novamente para inverter): ID, Empresa, Treinamento, Região, Data Início, Instrutor, Status.

#### Paginação
Selecione 10, 20, 50 ou 100 itens por página. Navegue entre páginas com os botões Anterior / Próxima.

---

### Criar Nova Demanda

Clique em **+ Nova Demanda**. O modal abre em branco.

#### Seção: Dados do Treinamento

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| Empresa | Dropdown | ✓ | Cliente que solicitou o treinamento |
| Região | Dropdown | ✓ | Sudeste, Norte, Nordeste |
| Treinamento | Dropdown | ✓ | Treinamento a ser realizado |
| Modalidade | Dropdown | ✓ | PRESENCIAL, ONLINE, HÍBRIDO ou TUTORIA |
| Modo de Datas | Radio | ✓ | CONTÍNUO ou DIAS ESPECÍFICOS |
| Data Início | Data + hora | ✓ | Início do treinamento |
| Data Fim | Data + hora | ✓ | Fim do treinamento |
| Local | Texto livre | ✓ (se presencial) | Ex: "Fábrica Carajás", "Sala BH" |
| Corredor | Texto livre | — | Responsável operacional |
| ID do Cliente | Texto livre | — | Identificador externo (ID SAP, pedido) |
| Observações | Área de texto | — | Notas adicionais |

**Modo DIAS ESPECÍFICOS**: Em vez de um intervalo contínuo, selecione datas avulsas no calendário (ex: 12, 14 e 17 de fevereiro).

**Modalidade HÍBRIDO**: Informe também o período presencial (início e fim dentro do período total).

#### Seção: Dados Internos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| Aprovador | Dropdown | Pessoa responsável por aprovar a demanda |
| Analista | Dropdown | Analista responsável pelo acompanhamento |

#### Seção: Logística — Locomoção

Selecione o meio de transporte:

- **Carro Alugado**: preencha locadora, agência, localizador, categoria, check-in e check-out
- **Carro Próprio**: sem campos adicionais
- **Táxi**: sem campos adicionais
- **N/A**: sem necessidade de transporte

**Campos extras (somente Carro Alugado):**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| Empresa de Locação | Dropdown | Localiza, Movida ou Outro |
| Agência de Retirada | Texto | Ex: "Aeroporto de BH", "Recife" |
| Localizador | Texto | Código da reserva (booking code) |
| Categoria | Dropdown | Grupo B, BE, C, CE, CS, F, FS, FH, FX |
| Check-in | Data + hora | Quando pega o carro |
| Check-out | Data + hora | Quando devolve o carro |

#### Seção: Logística — Hospedagem

Selecione a situação:

- **Precisa de Hotel**: preencha cidade, hotel, check-in, check-out e forma de pagamento
- **N/A**: sem necessidade de hotel

**Campos extras (somente Hotel):**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| Cidade | Texto | Cidade onde ficará hospedado |
| Hotel | Dropdown/Texto | Nome do hotel (lista pré-cadastrada ou novo) |
| Check-in | Data | Entrada |
| Check-out | Data | Saída |
| Forma de Pagamento | Dropdown | Faturado, PIX, Balcão ou N/A |

#### Seção: Documentos da Demanda

- **Lista da Turma (PDF)**: faça upload do arquivo ou marque como N/A
- **Liberação do Instrutor (PDF)**: faça upload do arquivo ou marque como N/A

---

### Visualizar e Editar uma Demanda

Clique em qualquer demanda da lista para abrir o modal.

#### Modo Visualização (VIEW)

Exibe todos os dados preenchidos. Disponibiliza as seguintes ações:

| Ação | O que faz |
|------|-----------|
| **Editar** | Habilita edição dos campos |
| **Alocar Instrutor** | Abre painel para selecionar instrutor e período |
| **Alocar CTM** | Aloca Centro de Treinamento Móvel |
| **Alocar Acompanhante** | Adiciona segundo instrutor como acompanhante |
| **Exportar para Word** | Gera documento .docx com todos os dados |
| **Cancelar Demanda** | Marca como CANCELADA (pede motivo) |
| **Reativar Demanda** | Desfaz o cancelamento |
| **Deletar Demanda** | Remove permanentemente (pede confirmação) |

#### Alocar Instrutor

1. Clique em **Alocar Instrutor**
2. O sistema exibe instrutores com score de compatibilidade (baseado em skills e região)
3. Selecione o instrutor
4. Informe o período de atuação (início e fim)
5. Confirme — se houver conflito de agenda, o sistema avisa e pergunta se deseja forçar

#### Modo Edição (FORM)

Todos os campos ficam habilitados para alteração.

- **Salvar**: valida, salva no banco e fecha o modal
- **Descartar**: volta sem salvar

---

## 5. Agenda / Programação

### O que é

Calendário visual que exibe a agenda completa de cada instrutor: demandas alocadas, folgas, férias, viagens e outros compromissos.

### Filtros

- **Instrutor**: Dropdown para ver a agenda de um instrutor específico
- **Vista**: Semana ou Mês
- **Navegação**: Botões Anterior, Hoje e Próximo

### Tipos de itens na agenda

| Tipo | Cor | Origem |
|------|-----|--------|
| Demanda (treinamento) | Azul escuro | Alocações de instrutor |
| Folga | Verde claro | Manual |
| Indisponível | Rosa/vermelho | Manual |
| Férias | Azul claro | Manual |
| Descanso | Azul céu | Manual |
| Escritório (Alphaville/BH/Vitória) | Índigo | Manual |
| Home Office | Cinza | Manual |
| Externo | Âmbar | Manual |
| Outro | Âmbar | Manual |
| Acompanhante | Indicador especial | Alocações de acompanhante |

Demandas noturnas (início ≥ 18h ou fim ≤ 6h) aparecem com a tag **(N)** ao lado do nome.

### Criar item manual na agenda

Clique em qualquer dia do calendário → preencha:
- **Tipo**: Folga, Indisponível, Férias, Descanso, Escritório, etc
- **Data início e fim**
- **Título** e **Descrição** (opcionais)

### Editar ou excluir item da agenda

Clique no item → modal de detalhes → botão **Editar** ou **Deletar**.

---

## 6. Controle Logístico

### O que é

Painel de checklist logístico que mostra as demandas próximas e o status de cada item de logística.

### Filtros

- **Busca por texto**: ID, empresa ou treinamento
- **Vista**: Semana ou Mês
- **Navegação**: Anterior, Hoje, Próximo

### Checklist por demanda

Para cada demanda, o painel mostra:

| Item | Verde ✓ | Cinza — | Vermelho ✗ |
|------|---------|---------|------------|
| 🚗 Carro | Confirmado | N/A | Pendente |
| 🏨 Hotel | Confirmado | N/A | Pendente |
| 📦 Material | Pronto | — | Pendente |
| 📄 Lista da Turma | PDF enviado | N/A | Pendente |
| 📝 Liberação | PDF enviado | N/A | Pendente |

**Status Geral:**
- **✓ OK**: tudo confirmado
- **⚠ PENDÊNCIAS**: um ou mais itens em aberto
- **✗ BLOQUEADO**: item crítico faltando

### Ações por demanda

Clique em uma linha para abrir o painel detalhado:

- **Marcar Confirmação**: marque ✓ para carro, hotel e material
- **Upload de Documentos**: envie PDFs de Lista da Turma e Liberação do Instrutor
- **Marcar como N/A**: quando o item não se aplica à demanda

---

## 7. Medição

### O que é

Módulo para registrar, revisar e aprovar as despesas geradas durante o treinamento.

### Filtros

- **Busca por texto**: ID, empresa ou instrutor
- **Empresa**: Dropdown
- **Status da demanda**: NOVA, PENDENTE, ALOCADA, EM_ANDAMENTO, CONCLUÍDA
- **Período**: Data início e data fim

### Estágios da Medição

Cada demanda concluída percorre os seguintes estágios:

| Estágio | Significado | Próxima ação |
|---------|-------------|--------------|
| **NÃO INICIADA** | Nenhuma despesa lançada | Clicar em "Iniciar Lançamento" |
| **LANÇAMENTO** | Despesas sendo adicionadas | Clicar em "Enviar para Conferência" |
| **CONFERÊNCIA** | Em revisão/validação | Clicar em "Aprovar para Faturamento" |
| **PRONTA FATURAMENTO** | Aprovada, aguarda faturar | Clicar em "Marcar como Faturada" |
| **FATURADA** | Encerrada definitivamente | Somente leitura |

### Categorias de despesa

| Categoria | Descrição |
|-----------|-----------|
| Café | Café da manhã, lanches |
| Almoço | Refeição do meio-dia |
| Jantar | Refeição noturna |
| Transporte | Combustível, passagens, táxi |
| Hospedagem | Hotel, pousada |
| Outros | Estacionamento, pedágio, etc |

### Como registrar uma despesa

1. Clique em uma demanda na lista de Medição
2. Clique em **"Iniciar Lançamento"** (se ainda não iniciou)
3. Em cada categoria, clique em:
   - **"Anexar Notinha"**: selecione um arquivo (foto/PDF do recibo) e informe o valor
   - **"Valor Avulso"**: informe apenas o valor, sem arquivo
4. Para a categoria **Outros**: selecione ou crie uma linha (ex: "Estacionamento") e adicione os recibos
5. Adicione **Observações** se necessário
6. Avance o estágio conforme aprovação

### As duas marcações de cada item de despesa

Cada notinha ou valor avulso tem dois botões à direita do valor. São independentes: um item pode ter nenhum, um ou os dois.

| Botão | O que significa | Efeito |
|-------|-----------------|--------|
| **NÃO REEMBOLSA** (âmbar quando marcado) | O **cliente** não reembolsa este item (ex.: Uber até a locadora, almoço acima do teto) | Fica **fora** da Medição Vale e do BM. Continua no total da medição e no custo do Dashboard |
| **PAGO PELO INSTRUTOR** (azul quando marcado) | O **instrutor** pagou do próprio bolso e a Colabor precisa reembolsá-lo | Entra nas colunas de despesa do **Excel de pagamento** do instrutor. Não muda o custo nem a medição da Vale |

| Não reembolsa | Pago pelo instrutor | Medição Vale / BM | Excel de pagamento |
|---|---|---|---|
| não | não | entra | não entra |
| não | sim | entra | entra |
| sim | não | fora | não entra |
| sim | sim | fora | entra |

O botão **Pago pelo instrutor** aparece também em demanda interna. Itens antigos nascem sem a marcação: nada vira reembolso ao instrutor sem alguém clicar.

Na medição com seções por pessoa, o reembolso é de quem lançou o item. Item lançado **sem pessoa** (medição antiga, ou painel de uma pessoa só) vai para o **titular principal** — a linha do item avisa isso.

### Demanda dividida entre dois ou mais titulares

Toda demanda com **mais de uma pessoa** abre em seções por pessoa — inclusive a demanda de cliente **dividida por dias entre dois titulares** sem acompanhante, que até setembro de 2026 abria no formato de uma pessoa só (despesas e reembolso inteiros no instrutor principal).

- **Horas de cada titular**: o padrão é a fatia do rateio por dias, a mesma conta da planilha de pagamento (ex.: 2 de 4 dias de uma turma de 16 h = 8 h). A legenda mostra *"Rateio por dias: 2 de 4 (8h)"*. Conta sem ninguém digitar e aceita override individual. Em híbrida, cada bloco abre vazio com o aviso, como sempre.
- **Despesas** são de quem lançou; item sem pessoa vai para o principal (`instructor_id`), com legenda no item.
- **Valor HH e "Pago pelo instrutor"** por bloco.
- **Medição antiga** (formato de uma pessoa) abre normalmente: o bloco antigo vira o bloco do titular principal, a tarifa antiga é copiada para os titulares, e só é gravada no novo formato ao salvar. Nenhum dado é migrado por trás.
- **Planilha de pagamento**: sem horas digitadas, o resultado é **idêntico** ao de antes (rateio por dias). Com horas digitadas por pessoa, vale o digitado. As despesas vão para o dono do item.
- **Medição Vale, BM e Dashboard**: os totais por demanda não mudam. O Dashboard passa a somar a fatia de cada titular, que fecha com a carga da demanda.

⚠️ **Mudança de comportamento em híbrida dividida com medição antiga**: antes, a carga gravada na abertura contava como horas informadas e a planilha pagava o rateio. Agora, como toda híbrida, cada titular sai com Horas em branco e amarela até alguém digitar as horas presenciais. A lista de demandas afetadas está em `supabase/migrations/README_reembolso.md`.

O total da pessoa e o rodapé mostram **"a reembolsar ao instrutor"** quando houver item marcado. O resumo do WhatsApp também.

### Exportar Medição (planilha de pagamento, Excel)

Em Medição → **Exportar Medição**, escolha o mês (ou um período) e gere o `.xlsx`. Entram demandas **concluídas** com instrutor alocado, com as horas recortadas pelos dias dentro do período.

**Aba de cada instrutor**, no formato da planilha manual da Colabor:

- Linha 1: nome. Linha 2: CPF/CNPJ (do cadastro) e **dados bancários** — estes vêm do Resumo por fórmula: digite uma vez lá.
- Colunas: Código · Empresa · Treinamento · Data · Local · Modalidade · **Hospedagem · Transporte (Locomoção) · Alimentação · Outros · Total despesas** · **Horas** · **Hora/aula (R$)** · **Total (R$)** · Tipo · Categoria · Noturno · Papel.
- As colunas de despesa trazem **só o que foi marcado como "Pago pelo instrutor"** na medição. Despesa paga pela Colabor não aparece na aba dele.
- **Hora/aula** = horas × a tarifa da aba **Tarifas** (uma linha por instrutor + empresa + tipo + noturno + papel; a única coluna a preencher). **Total** = despesas + hora/aula.

**Acompanhante sem horas informadas** passa a aparecer na aba dele: a célula de **Horas** sai em branco e **amarela** (a única célula editável da aba), o Hora/aula mostra o texto *"horas não informadas"* até alguém preencher — na medição ou na própria planilha —, e as despesas dele entram normalmente. Isso vale para todo acompanhante alocado em demanda concluída, **com ou sem medição salva**. Consequências: a lista de nomes no Resumo cresce, e **Tarifas pendentes** passa a contar a tarifa de acompanhante dessas pessoas (ela existe na aba Tarifas para o valor calcular assim que as horas forem preenchidas). Acompanhante com **0 h** digitado continua fora: zero é decisão, não ausência.

**Demanda híbrida sem horas presenciais digitadas** segue a mesma regra: a linha sai normalmente (Modalidade *Híbrido*), com **Horas** em branco e amarela e o Hora/aula mostrando *"híbrida: informe as horas presenciais realizadas"* até alguém digitar — na medição ou na planilha. Não existe mais a exigência de "medição com horas digitadas antes de exportar": o Excel mostra a célula em amarelo até as horas serem digitadas. A carga do treinamento é a total (EAD + prática) e o split varia por demanda; a planilha não adivinha as horas presenciais. Vale para titular, participante e acompanhante, em medição antiga ou por pessoa. Quem digitou as horas no painel sai com elas. O Dashboard **não muda**: continua com a carga total.

**Resumo**: Instrutor · Total de Horas · **Hora/aula (R$)** · **Despesas a reembolsar (R$)** · **Total a pagar (R$)** (= hora/aula + despesas) · Tarifas pendentes · **Horas pendentes** (quantas linhas da aba estão com Horas em branco: acompanhante ou híbrida) · CPF/CNPJ · Dados Bancários. Tudo por fórmula sobre as abas; a linha TOTAL GERAL soma as seis colunas. Antes de fechar o mês, **Tarifas pendentes** e **Horas pendentes** devem estar zeradas.

### Exportar Medição para Word

No modal de detalhes da medição, clique em **Exportar** para gerar um documento .docx com todas as despesas, totais por categoria e total geral.

---

## 8. Evidências

### O que é

Registro da documentação comprobatória do treinamento: lista de presença, certificados e fotos.

### Regra de disponibilidade

As evidências só se tornam **obrigatórias após a demanda estar CONCLUÍDA**.

| Status | Condição |
|--------|----------|
| **AGUARDANDO** | Demanda ainda não foi concluída |
| **PENDENTE** | Demanda concluída, mas faltam arquivos |
| **COMPLETA** | Demanda concluída e todos os arquivos enviados |

### Filtros

- **Busca por texto**: ID da demanda
- **Período**: Data início e data fim
- **Empresa**: Dropdown
- **Treinamento**: Dropdown
- **Instrutor**: Dropdown
- **Local**: Dropdown
- **Botão "Limpar filtros"**: aparece automaticamente quando algum filtro está ativo

### O que é exigido por modalidade

| Item | Presencial / Híbrido | Online |
|------|---------------------|--------|
| Lista de Presença | ✓ Obrigatório | ✓ Obrigatório |
| Certificados | ✓ Obrigatório | ✓ Obrigatório |
| Fotos | ✓ Obrigatório | ✗ Não exigido |

### Como registrar evidências

1. Clique em uma demanda na lista de Evidências → botão **Visualizar**
2. Na tela de detalhes, você verá três seções:

**Lista de Presença**
- Clique em **"Adicionar Lista"**
- Selecione o arquivo (PDF, Excel, etc)
- O arquivo é enviado e aparece na lista (com botão de download e exclusão)

**Certificados Gerados**
- Clique em **"Upload em Lote"** para enviar vários de uma vez
- Cada certificado aparece com nome, botão de download e exclusão

**Registros Fotográficos**
- Clique em **"Adicionar Fotos"**
- Selecione uma ou várias imagens
- As fotos aparecem em grade com preview

**Notas & Observações**
- Campo de texto livre para informações adicionais

---

## 9. Cadastros

### O que é

Área de configuração do sistema, onde os dados mestres são mantidos.

### Aba: Empresas

Cadastro de clientes que solicitam treinamentos.

**Campos:**
- Razão Social, Nome Fantasia, CNPJ, Status (Ativo/Inativo)
- Tipo de Logística: **COMPLETA** (carro, hotel, material) ou **SIMPLIFICADA**
- Segmento: Indústria, Comércio, Serviços, Educação, Saúde, Outros
- Endereço: CEP, Rua, Número, Bairro, Cidade, Estado
- Contato: Nome, Cargo, Telefone, E-mail

### Aba: Treinamentos

Catálogo de treinamentos disponíveis.

**Campos:**
- Nome, Código/NR, Categoria, Duração (horas), Modalidade, Status
- Descrição curta e detalhada, Pré-requisitos, Público-alvo
- Emite certificado? Sim/Não — Validade em meses

**Categorias disponíveis:**
Segurança do Trabalho, Manutenção Industrial, Operação de Equipamentos, Emergência, Operação Ferroviária, Técnicos Elétrica, Técnicos Solda, Treinamentos Comportamentais.

### Aba: Instrutores

Cadastro dos instrutores que realizam os treinamentos.

**Campos:**
- Nome, E-mail, Status (Ativo/Inativo)
- Regiões de Atuação (multi-seleção): Sudeste, Norte, Nordeste
- Local de Residência
- Função na Agenda: Instrutor, Coordenador ou Motorista
- **Skills/Competências**: para cada habilidade, selecione o treinamento e o nível (1 a 4)

**Níveis de skill:**
1 = Iniciante · 2 = Intermediário · 3 = Avançado · 4 = Especialista

### Aba: Bases Operacionais

Listas de valores utilizados em formulários do sistema. Cada lista pode ter itens adicionados, editados ou removidos.

| Lista | Descrição |
|-------|-----------|
| Aprovadores | Nomes de aprovadores de demanda |
| Analistas | Nomes de analistas |
| Matriculadores | Histórico de cadastradores |
| Corredores | Responsáveis por corredor operacional |
| Localidades | Locais de treinamento (Carajás, Cauê, etc) |
| Locais da Agência | Estados com agências de locadora |
| Hotéis | Lista de hotéis conveniados |
| Locadoras | Empresas de locação de veículos |

### Aba: Perfil

Edição dos dados do usuário logado:
- Nome (editável)
- E-mail (somente leitura)
- Função (somente leitura)
- Botão **Sair** (logout)

### Aba: Usuários *(somente Admin)*

Gerenciamento de contas de acesso ao sistema.

**Criar novo usuário**: E-mail, Senha, Nome, Função (admin / analista / coordenador)

**Ações por usuário**: Editar nome/função, Deletar, Enviar link de reset de senha.

---

## 10. Exportações Disponíveis

### Exportar Demandas para Excel

**Como acessar:** Dashboard → botão **Exportar** ou menu Demandas

**Passo a passo:**
1. O modal de exportação abre com a lista de demandas
2. Use os filtros à esquerda para refinar (Período, Cliente, Treinamento, Instrutor, Região, Local, Corredor, Status, Busca por texto)
3. Marque as demandas que deseja exportar — ou deixe sem marcar para exportar todas as filtradas
4. Clique em **"Baixar Excel"**

**Colunas do arquivo gerado:**

| Coluna | Conteúdo |
|--------|----------|
| ID | Identificador interno da demanda |
| ID Cliente | ID SAP / Pedido do cliente |
| Empresa | Nome fantasia |
| Treinamento | Nome do treinamento |
| Região | Região de atuação |
| Data Início | Data formatada (DD/MM/AAAA) |
| Data Fim | Data formatada (DD/MM/AAAA) |
| Modo Datas | Contínuo ou Dias Específicos |
| Dias Específicos | Lista de datas (quando aplicável) |
| Instrutor Principal | Nome do instrutor |
| Status | Status calculado da demanda |
| Modalidade | PRESENCIAL, ONLINE, etc |
| Local do Treinamento | Localidade |
| Corredor | Corredor operacional |
| Aprovador | Nome do aprovador |
| Analista | Nome do analista |
| Transporte | Tipo de transporte |
| Hospedagem | Tipo de hospedagem |

### Aba Exportações (planilhas de análise)

**Como acessar:** menu lateral → **Exportações** (perfis Admin e Analista).

É um exportador genérico para **análise**: você escolhe o módulo, filtra, escolhe e ordena as colunas, vê uma prévia com a contagem e baixa **XLSX** ou **CSV**. Não substitui a planilha de pagamento (Medição → Exportar Medição), que continua com fórmulas, aba Tarifas e proteção.

**Módulos disponíveis:**

| Módulo | O que sai | Quem vê |
|--------|-----------|---------|
| **Medições** | Uma linha por **pessoa × demanda** (titular, participante de interna, acompanhante) para toda demanda com medição aberta, em qualquer estágio: horas, valor HH, hora/aula e despesas por pessoa | Quem acessa a tela de Medição (Admin) |
| **Demandas** | Uma linha por demanda: cadastro, status calculado, pessoas, logística primária, documentos, se há medição | Admin e Analista |
| **Logística** | Uma linha por **bloco logístico** (locomoção ou hospedagem, por pessoa): datas do bloco, checklist do Controle Logístico e documentos da demanda | Quem acessa o Controle Logístico (Admin e Analista) |
| **Instrutores** | Uma linha por **pessoa × demanda** (titular, participante de interna, acompanhante): dias alocados no período e carga do treinamento. **Sem valores, sem CPF** | Quem acessa a Agenda (Admin e Analista) |
| **Despesas** | Uma linha por **item de despesa** da medição (notinha ou valor avulso): pessoa dona, categoria, valor, as duas flags, se há anexo | Quem acessa a tela de Medição (Admin) |

Além desses, cada empresa cliente pode ter o **próprio módulo de medição**, chamado **Medição <Empresa>**, configurado pela equipe sem depender da TI — ver *Modelos de medição por empresa*, mais abaixo. Um modelo incompleto aparece na lista **apagado**, com o motivo, e não gera.

**Passo a passo:**
1. Escolha o módulo
2. Clique em **Carregar dados** — a busca é sempre nova no banco; se algo falhar, aparece um aviso vermelho e nada é gerado
3. Aplique os filtros (período, status, modalidade, tipo cliente/interna, UF, cliente; em Medições e Instrutores também pessoa e papel; em Logística modo de transporte e "só com pendência de documento"; em Despesas categoria e as duas flags)
4. Ligue/desligue colunas e ordene com as setas ↑/↓ — **Padrão** volta à seleção inicial
5. Confira a prévia e a contagem de linhas
6. Clique em **XLSX** ou **CSV**

**Formato:** datas em DD/MM/AAAA; valores como número (moeda R$ no XLSX; vírgula decimal e separador `;` no CSV, que abre direto no Excel em português); cabeçalho congelado e autofiltro no XLSX. Interna sem empresa aparece como **Colabor (Interna)**.

#### Horas pagamento × Horas informadas — e por que o export não rateia

No módulo **Medições** existem três colunas de horas, porque o sistema resolve "horas em branco" de jeitos diferentes conforme o lugar:

| Coluna | De onde vem | Quando fica em branco |
|--------|-------------|------------------------|
| **Horas pagamento** (ligada por padrão) | A linha que a planilha de pagamento imprimiria para a pessoa naquela demanda: rateio da alocação em `instructor_allocations`, substituído pelas horas digitadas na medição quando houver | Quando a planilha **não tem horas** para a pessoa: demanda ainda não concluída, pessoa sem alocação, acompanhante sem horas digitadas ou demanda híbrida sem horas presenciais digitadas (estes aparecem na planilha com Horas em branco e amarela — a origem diz "Acompanhante sem horas informadas" / "Híbrida sem horas presenciais informadas"). Em branco nunca é zero |
| **Horas informadas** (desligada) | O que está gravado na medição (o campo da pessoa, ou a carga da medição antiga) | Ninguém digitou |
| **Horas (painel)** (desligada) | O que o Painel de Medição conta na seção da pessoa: em branco vale a carga padrão da demanda; acompanhante e demanda híbrida valem 0 até alguém digitar | Pessoa sem bloco no painel (segundo titular de uma medição antiga) |

Ligue **Origem das horas** para ver, linha a linha, de onde veio a coluna Horas pagamento ou por que ela está em branco. **Elegível pagamento** (ligada por padrão) diz se a pessoa entra na planilha.

O **filtro de período** seleciona as demandas que têm ao menos um dia dentro do intervalo, e as horas saem **inteiras**. A planilha de pagamento, ao contrário, rateia as horas pelos dias que caem dentro do mês: uma demanda de 5 dias que começa dois dias antes do fechamento entra na planilha com 3/5 das horas e no export com todas. Para fechar o mês, use a planilha; para analisar volumes e custos por demanda, pessoa ou cliente, use o export.

**Despesas** saem nas quatro categorias do painel (Hospedagem, Locomoção, Alimentação, Outros). **Total despesas** inclui os itens marcados como não reembolsáveis — eles foram gastos —, **Não reembolsável** mostra esse recorte à parte e **Despesas reembolsáveis** (desligada) é a diferença. **Reembolso ao instrutor (R$)** (desligada) é o outro recorte, independente: os itens da pessoa marcados como *Pago pelo instrutor* — o que sai nas colunas de despesa do Excel de pagamento. **Total geral** = hora/aula (painel) + total despesas, a mesma composição do card *Custo das Demandas Internas* do Dashboard.
#### Opções marcáveis (Medições e Demandas)

- **Usar Valor HH da medição** (ligada por padrão, só em Medições): desligada, as colunas *Valor HH*, *Hora/aula* e *Total geral* saem em branco. A coluna **Origem da tarifa** diz, linha a linha, se a tarifa veio da medição, se foi digitada como zero, se não existe na medição (o R$ 0,00 "por ausência") ou se a opção está desligada.
- **Incluir canceladas** (desligada por padrão): demandas canceladas ficam fora, a menos que o filtro de status seja exatamente *Cancelada*, que força a inclusão.

#### Logística (uma linha por bloco)

Cada linha é um bloco de **locomoção** ou **hospedagem** de uma pessoa na demanda — os mesmos blocos do formulário da demanda. Não existe "ida/volta" como registro: as datas do bloco de locomoção são a **retirada** e a **devolução** do carro; as de hospedagem, o **check-in** e o **check-out**. A ordem do bloco (1 = primário) é coluna desligada.

- **Instrutor do bloco**: pelo cadastro quando o bloco tem a pessoa vinculada; nos blocos antigos, o nome gravado. O **filtro** de instrutor só alcança blocos vinculados por cadastro.
- **Checklist**: as cinco colunas do Controle Logístico (Carro, Hotel, Material, Liberação, Lista) e **Logística pronta**, pela mesma regra da tela — inclusive "Não se aplica" para Material e Lista na demanda interna. **Documentos pendentes** conta Liberação e Lista em Pendente. **Status gravado (controle)** (desligada) mostra o que está no banco, que só se atualiza quando alguém abre o Controle Logístico.
- **Modo de transporte** (filtro): só linhas de locomoção têm modo; com o filtro ativo, as de hospedagem saem.
- Demanda **sem bloco** não aparece aqui — está no módulo Demandas.

#### Instrutores (uma linha por pessoa × demanda)

Uma linha por vínculo: **Titular** (alocação, ou o instrutor principal quando não há alocação), **Participante** (demanda interna) e **Acompanhante** (demanda de cliente). Quem é titular não repete como acompanhante ou participante da mesma demanda.

- **Dias alocados no período**: dos dias reais do vínculo (o vínculo cruzado com os dias da demanda, o mesmo cálculo do aviso de conflito da Agenda), quantos caem dentro do período filtrado; sem período, todos. As colunas *Dias do vínculo* e *Dias no período* (desligadas) listam as datas.
- **Total de dias do instrutor no período** (desligada): dias distintos da pessoa em todas as demandas não canceladas, independentemente dos outros filtros; dois vínculos no mesmo dia contam um.
- **Carga do treinamento**: horas do treinamento (cliente) ou horas previstas (interna). É informação, não rateio nem pagamento.
- **UF do instrutor**: a UF de residência do cadastro. O **filtro** de UF é o da **demanda**.
- Este módulo **não** traz CPF, e-mail, endereço, observações, tarifa ou valor — por construção, e o smoke confere.

#### Despesas (uma linha por item)

Cada linha é um item de despesa da medição (notinha anexada ou valor avulso), com a **pessoa dona** exatamente como o Painel de Medição atribui: o dono gravado no item; sem dono (ou dono que saiu do cadastro), o titular principal — a coluna *Dono — origem* (desligada) diz qual foi o caso. As somas por pessoa e por categoria fecham com o painel e com o módulo Medições.

- **Categoria**: as seis do painel (Hospedagem, Locomoção, Café da manhã, Almoço, Jantar, Outras despesas); *Bucket* (desligada) mostra o agrupamento em quatro.
- **Descrição**: em Outras despesas, a descrição da linha; nos demais, o nome do item. **Tem anexo**: há arquivo com referência; valor avulso e arquivo que perdeu a referência saem como Não (*Tipo do item* explica).
- **Vale não reembolsa** e **Pago pelo instrutor**: as duas flags do item, também como filtros (Sim/Não).
- **Órfão (fora do total)**: anexo de Outras despesas apontando para linha apagada — o painel não soma, e aqui sai listado para não sumir.

#### Modelos salvos (filtros, colunas e opções com nome)

Nos módulos de tabela (Medições, Demandas, Logística, Instrutores, Despesas), a barra **Modelos** guarda a escolha atual com um nome — filtros, colunas ligadas com a ordem e opções marcáveis — só para o seu usuário. Ações: **Aplicar**, **Padrão** (aplicado automaticamente ao abrir o módulo; um por módulo), **Regravar** com o que está na tela, **Renomear**, **Excluir** e **Salvar como modelo**.

- **O período nunca entra no modelo**: ao aplicar, o período que está na tela é mantido. Um modelo com datas fixas envelheceria.
- Modelo com coluna que **deixou de existir** aplica o restante e mostra um aviso amarelo dizendo qual coluna foi ignorada; filtro ou opção desconhecidos, idem. Nada é ignorado em silêncio.
- Cada usuário vê só os próprios modelos (regra no banco, migration 021), e só dos módulos que o perfil pode ver.
- **Seguimentos** (fora da V1): modelos para Medição Vale e BM Vale (quando o estado de filtros dessas telas subir para a aba) e período relativo "último mês fechado" (V1.1).

#### Medição Vale (planilha no modelo do cliente)

**Como acessar:** Exportações → módulo **Medição Vale** (perfil com acesso à Medição).

Gera o XLSX **no layout do modelo da Vale**, a partir do próprio arquivo-modelo guardado no sistema: aba **Turmas Realizadas** (uma turma por demanda) e aba **Plantas** (copiada do modelo, sem cruzamento com os dados do app).

**Quem entra na aba Turmas:** demandas de **cliente** da Vale, **concluídas**, com instrutor titular, que **terminam** dentro do período. A turma entra na medição do mês em que **termina**, mesmo que tenha começado antes — e, como cada turma tem uma só data de fim, ela **nunca aparece em duas medições**. Em turma com **dias específicos**, o fim é o **último dia da lista**: a turma dos dias 19, 20, 21 e 25/08 termina em 25/08, não em 21/08. Quando o recorte traz turma que começou antes do início do período, a tela avisa quantas são ("N turma(s) começaram antes de dd/mm e terminam neste período") e o painel de pendências repete na linha de cada uma — é aviso, não bloqueio. Cancelada, não concluída, sem titular e demanda interna com empresa Vale ficam fora — e aparecem no painel de pendências. O **status da medição não bloqueia**: é filtro (Não iniciada, Em lançamento, Em conferência, Pronta para faturamento, Faturada, Sem medição), com "todas" por padrão.

**Colunas e origem:**

| Coluna do modelo | De onde vem |
|---|---|
| Número do anexo | sequência 1..n |
| ID da Turma | campo *ID SAP / Pedido Cliente* da demanda (em branco e amarelo quando falta) |
| Treinamento, Local, Data, Horário | cadastro da demanda (data e horário do **primeiro** dia — a coluna *Data* continua sendo a de início; só a seleção do período olha o término) |
| Carga horária | carga do treinamento, inclusive em híbrida |
| Preço unitário HH | **digitado na prévia**; lembrado por treinamento, sobrescrevível na turma (em branco e amarelo quando falta) |
| Valor total do treinamento | fórmula `=G×H` do modelo |
| Despesas reembolsáveis (locação/táxi, alimentação, hospedagem, outros) | as categorias da medição (Locomoção, Alimentação, Hospedagem, Outros), **só os itens reembolsáveis** |
| Combustível | digitado na prévia (nasce 0; o app não separa combustível) |
| % despesa reembolsável | 0,2 do modelo, editável |
| Valor total despesas | fórmula `=SOMA(J:N)+(SOMA(J:N)×O)` do modelo |
| Consultor | instrutor(es) titular(es); demanda dividida sai "A / B" |
| Observação | digitada na prévia, por turma |
| Linha de totais | `SOMA` em G, I a N e P, logo abaixo da última turma |

**Passo a passo:**
1. Escolha **Medição Vale** e clique em **Carregar dados**
2. Filtre por período (**data de término** da turma), corredor, site e status da medição
3. Leia o painel **O que falta para fechar a medição** — ⛔ tira a demanda da planilha; ⚠ entra, mas confira. Dá para baixar em XLSX
4. Preencha os campos manuais (preço HH por treinamento e, se preciso, por turma; combustível; %; observação) e clique em **Salvar**
5. Confira a prévia e clique em **Gerar Medição Vale** — o botão fica travado enquanto houver edição não salva

**Pendências e de onde vêm:** não concluída, cancelada e sem titular (fatos, do cadastro); sem ID SAP; sem preço HH; sem medição aberta ou não iniciada; medição não pronta; item não reembolsável excluído das colunas; ID SAP repetido em outra demanda do recorte; interna com empresa Vale. A única **inferência** é *logística indica viagem, mas não há despesa lançada* (carro ou hotel na logística e nenhum item na medição) — é aviso, nunca bloqueio.

#### BM da Vale (Boletim de Medição)

**Como acessar:** Exportações → módulo **BM Vale** (perfil com acesso à Medição).

O BM é o documento que a Vale assina: a medição **agregada por treinamento**, no modelo da Vale (folha `BOLETIM MEDIÇÃO`), gerado a partir do próprio arquivo-modelo guardado no sistema. **Ele sai da mesma seleção da Medição Vale**: mesmas turmas (concluídas, com instrutor, que **terminam** no período), mesmo preço HH (com sobrescrita por turma), mesma exclusão de item não reembolsável. Por isso o **Σ das linhas de treinamento do BM é igual ao Σ da coluna I** da aba Turmas, e a **quantidade da linha de despesas é igual ao Σ da coluna P** — batem por construção, e o sistema confere isso automaticamente.

**Um BM por (corredor, mina).** Mina = *Local Treinamento* da demanda. Com corredor e site/mina nos filtros, sai um `.xlsx`; só com o corredor, sai um `.zip` com um `.xlsx` por mina do recorte; com corredor **Todos**, sai um `.zip` (`vale-bm-todos-<período>.zip`) com **uma pasta por corredor** e, dentro de cada uma, um `.xlsx` por mina com o mesmo nome de sempre. A prévia e o bloco Cabeçalho do BM ficam agrupados por corredor. Turma **sem local** na demanda fica fora do BM — a tela mostra em destaque quantas ficaram e o painel de pendências lista cada uma; corrija o local na demanda. Com **Todos**, turma **sem corredor** na demanda também fica fora, com o mesmo destaque.

**O que o BM traz:**

| Bloco | Conteúdo | De onde vem |
|---|---|---|
| Cabeçalho | gerência executiva, gerência, contrato nº, contratada/CNPJ, objeto, gestor, local de prestação, data de envio, período | cadastro por corredor/mina (bloco **Cabeçalho do BM**, uma vez por mina, com Salvar); data de envio = hoje, editável; período = o filtro, `dd/mm/aaaa a dd/mm/aaaa` |
| Linhas do QQP | uma linha por treinamento: QQP 20, `Aplicação de Treinamento - <nome>`, unidade Hora/Aula, preço HH, quantidade = Σ carga horária das turmas, valor = fórmula preço × quantidade | turmas do recorte agregadas por **nome do treinamento + preço**; preços diferentes viram linhas separadas; cadastro duplicado (mesmo nome, ids diferentes) vira aviso, o BM sai limpo |
| Linha de despesas | QQP 70, `Despesas Tributáveis (hospedagem,transporte e alimentação)`, unidade 1, preço 1, quantidade = Σ das despesas das turmas | com o acréscimo de % de cada turma (coluna P da Medição Vale). Se a Colabor decidir sem o acréscimo, é uma constante do template |
| Valor total desta medição | fórmula SOMA das linhas | sempre na faixa real; mais de 24 linhas insere linhas antes do total sem mexer nas assinaturas |
| Assinaturas | intocadas | o modelo |

Os números das linhas do QQP (20 e 70) fazem parte do cabeçalho por corredor/mina, porque podem variar por contrato.

**Passo a passo:**
1. Escolha **BM Vale** e **Carregar dados**
2. Filtre por período (**data de término** da turma), **corredor** (obrigatório), site/mina e status da medição
3. Leia o painel de pendências — além dos motivos da Medição Vale, o BM avisa: sem local, cabeçalho não cadastrado, cadastro de treinamento duplicado
4. Na primeira vez em cada mina, preencha o **Cabeçalho do BM** e clique em **Salvar**; os preços HH são os mesmos da Medição Vale (grade *Campos manuais*)
5. Confira a prévia por mina e clique em **Gerar BM Vale**. Se algum cabeçalho estiver incompleto, a tela pergunta antes de gerar; o BM sai com as células em branco em amarelo
#### Nota rápida: por que a Medição Vale é diferente do dataset Medições

- **Período.** O dataset Medições pega toda demanda que *toca* o intervalo (interseção), porque é análise. A Medição Vale usa a **data de término**: a turma entra na medição do mês em que acaba. Como cada turma tem uma só data de fim, ela cai num único mês — nunca seria cobrada duas vezes. Foi por isso que a regra mudou em 23/09/2026: antes a seleção era pela data de início, e uma turma que começava no fim de um mês e terminava no outro sumia da medição em que a operação a esperava.
- **Não reembolsável.** Na medição, um item marcado como não reembolsável continua no total (foi gasto). Na planilha da Vale ele **não entra**: as colunas se chamam "despesa reembolsável" e a marca existe justamente para o que o cliente não paga. O painel avisa quanto ficou fora.
- **Preço HH.** O sistema lembra o último preço salvo **por treinamento** e pré-preenche todas as turmas daquele treinamento; quando uma turma precisa de outro preço, sobrescreva só nela. A coluna "fonte do preço" na grade mostra de onde veio cada valor. Nada é gravado até o **Salvar**; o download nunca grava.
#### Modelos de medição por empresa (configurar sem depender de TI)

**Como acessar:** Exportações → botão **Modelos de medição**, no alto da tela (perfil com acesso à Medição).

A Medição Vale e o BM Vale são feitos sob medida no código. Para **qualquer outro cliente**, você mesma cadastra a planilha que ele exige: envia o arquivo, diz o que cada coluna recebe, e aquela empresa passa a ter o próprio módulo de medição na aba Exportações, chamado **Medição <Empresa>**.

Uma empresa pode ter vários modelos (para testar uma mudança, por exemplo), mas só **um ativo** — é o ativo que vira módulo.

##### Passo a passo completo

O exemplo abaixo é a Gerdau, que exige uma planilha com as colunas *Serviço Prestado*, *Horas*, *Tarifa Hora* e *Total*.

**1. Criar o modelo.** Em **Modelos de medição**, clique em **Novo modelo**. Escolha a empresa (**Gerdau**) e dê um nome ao modelo (**Padrão 2027**). O nome é só para você se organizar nesta lista: na aba Exportações o módulo vai se chamar *Medição Gerdau*, e o cliente nunca vê esse nome.

**2. Enviar a planilha.** Clique em **Escolher arquivo** e mande o **.xlsx em branco** que a Gerdau usa — o modelo oficial, não uma planilha já preenchida de outro mês.

- Se o arquivo for **.xls** (formato antigo), o sistema recusa e explica: abra no Excel e salve como *Pasta de Trabalho do Excel (.xlsx)*.
- Se você mandar um PDF ou uma imagem por engano, ele também diz isso.

**3. Confirmar o que o sistema leu.** Ele mostra as abas do arquivo, sugere a de dados e diz: *"Achei o cabeçalho na linha 3, confere?"*. Abaixo aparecem as **5 primeiras linhas da planilha com o número da linha**, igual ao Excel.

- Se o cabeçalho estiver em outra linha, clique em **é esta** na linha certa.
- Se a aba estiver **oculta** ou **protegida** no arquivo, ele avisa em amarelo — dá para seguir assim mesmo.
- As **outras abas do arquivo saem na medição exatamente como estão**; nada nelas é alterado.

Clique em **Confirmar e mapear as colunas**.

**4. Dizer o que cada coluna recebe.** Aparece uma linha por coluna da planilha, com o cabeçalho do jeito que está no arquivo. Clique numa coluna para abri-la e escolha:

| Origem | Quando usar |
|---|---|
| **Campo do sistema** | A coluna recebe um dado que o app já tem. A lista vem agrupada por assunto: Demanda, Cliente, Treinamento, Pessoas, Despesas, Medição. |
| **Digitado na hora** | Não existe no sistema e alguém digita na prévia todo mês. Escolha se é **um valor por treinamento** (serve para todas as turmas daquele treinamento — é o caso do preço da hora) ou **um valor por turma**. No primeiro caso, marque *Permitir sobrescrever nesta turma* se às vezes precisa mudar só numa. |
| **Calculado** | Uma conta sobre outras colunas — ver o passo 5. |
| **Valor fixo do modelo** | O mesmo valor em toda linha (número de contrato, por exemplo). Cadastre antes, em *Valores fixos*. |
| **Deixar em branco** | A coluna existe no arquivo do cliente e ninguém preenche. |
| **Numeração** | 1, 2, 3… na ordem das turmas. |

Escolha também **como o valor aparece** (texto, horas, dinheiro, percentual, data). No exemplo: *Serviço Prestado* → campo **Treinamento**; *Horas* → campo **Carga horária**, formato *Horas*; *Tarifa Hora* → **digitado, um valor por treinamento**, formato *Dinheiro*, com *Avisar quando ficar em branco* marcado.

No alto, o contador mostra **"3 de 4 colunas configuradas"**. Enquanto faltar alguma, o botão de salvar fica travado.

**5. Montar a conta de uma coluna.** Em *Total*, escolha **Calculado**. Você **não digita fórmula**: escolhe a operação numa lista e depois as colunas, pelos nomes que elas têm na planilha.

- *Multiplicar duas colunas* → **Horas** × **Tarifa Hora**.
- Embaixo aparece a conta escrita em português: **"Horas × Tarifa Hora"**. É por aí que você confere.

As operações disponíveis são cinco: multiplicar, somar um intervalo de colunas, somar um intervalo e acrescentar um percentual, subtrair, e somar com um valor fixo. Se o seu cliente precisar de algo que não está nessa lista, é pedido para a TI.

**6. Valores fixos e totais (opcional).** Mais abaixo:

- **Valores fixos do modelo**: dê um nome e um valor — por exemplo *percentual de despesa* = `20%`. Escrevendo com `%`, o sistema já entende. Eles servem nas contas e como valor de coluna. Apagar um que esteja em uso pergunta antes e diz onde ele é usado.
- **Linha de totais**: marque as colunas que devem somar no fim da tabela. Só aparecem as colunas com valor numérico.

**7. Conferir com turmas de verdade.** No fim da tela aparecem as **3 primeiras turmas reais** do período, com o valor que cada coluna vai receber e, embaixo de cada valor, **de onde ele veio** (*Treinamento → NR-35 Trabalho em Altura*).

É aqui que erro de mapeamento aparece. Nenhuma validação pega "liguei a coluna Treinamento ao campo Local": os dois são texto, os dois preenchem, e a planilha sai bonita e errada. **Leia os três exemplos antes de salvar.**

Se não houver turma concluída no período, ele diz isso e deixa salvar mesmo assim — o modelo fica pronto e você confere quando houver turma.

**8. Salvar e ativar.** Clique em **Salvar mapeamento**. De volta à lista, clique em **Usar este** para ativar. Pronto: a aba Exportações passa a ter o módulo **Medição Gerdau**.

**9. Gerar a medição.** O módulo da empresa usa **a mesma elegibilidade da Medição Vale**, inclusive a regra do período: entram as turmas concluídas, com instrutor titular, que **terminam** dentro do intervalo. Em Exportações, escolha **Medição Gerdau**, clique em **Carregar dados**, ajuste o período, preencha os campos digitados (a *Tarifa Hora*) e clique em **Salvar**. Confira o painel de pendências e a prévia, e clique em **Gerar**. O arquivo sai **em cima da planilha que você enviou**, com as contas como **fórmulas vivas** — o cliente abre no Excel e vê a conta, não só o número.

##### O que o sistema não deixa passar

- **Coluna sem origem escolhida**: o botão de salvar fica travado e o contador diz quantas faltam.
- **Coluna ligada a um campo que não existe mais** (porque o sistema mudou): o modelo aparece na lista com o motivo, o botão *Usar este* fica desabilitado, e na aba Exportações o módulo aparece **apagado**, dizendo o que falta. Ele nunca aparece funcionando para falhar na hora de gerar.
- **Conta que usa uma coluna que você apagou**: mesma coisa, dizendo o nome da coluna.
- **Modelo sem planilha enviada**: aparece na lista com *"Falta enviar a planilha-base"*.

##### Trocar a planilha-base de um modelo que já existe

Clique em **Trocar planilha** e envie o arquivo novo. O sistema compara com o anterior:

- **Colunas iguais**: troca direto, sem mexer no que você configurou.
- **Colunas diferentes**: ele **bloqueia** e mostra exatamente o que mudou — *"A coluna B era «Horas» e agora é «Quantidade»"*, *"A coluna D («Observação») não existia na planilha anterior"*. O que tem o mesmo nome de cabeçalho mantém a configuração; o resto volta para *não configurada* e você reconfere antes de salvar.

Isso existe porque uma planilha com colunas em outra ordem continuaria "funcionando": o sistema escreveria no lugar errado e ninguém perceberia até o cliente reclamar.

##### Outras ações da lista

- **Duplicar**: cria uma cópia (*"Padrão 2027 (cópia)"*), **desativada**, com o mesmo mapeamento e a mesma planilha. Serve para testar uma mudança sem mexer no modelo que está medindo o mês.
- **Desativar**: a empresa fica **sem** módulo de medição até você ativar outro. A tela avisa.
- **Excluir**: apaga o modelo. Se a planilha for compartilhada com uma cópia, o arquivo é mantido.
- Trocar o modelo ativo **não muda as medições já geradas** — só o que for gerado daqui para a frente.

### Exportar Demanda para Word

**Como acessar:** Abrir uma demanda → botão **Exportar para Word**

Gera um documento `.docx` com: dados gerais, instrutor, logística, documentos e observações.

### Exportar Medição para Word

**Como acessar:** Medição → abrir uma demanda → botão **Exportar**

Gera um documento `.docx` com tabela de despesas, totais por categoria e total geral.

---

## 11. Regras de Negócio e Status

### Status automático das demandas

O status é **calculado automaticamente** com base na data atual, nas datas da demanda e na presença de instrutor.

| Status | Condição |
|--------|----------|
| **NOVA** | Sem instrutor · Prazo > 4 dias |
| **PENDENTE** | Sem instrutor · Prazo ≤ 4 dias, OU local não definido |
| **ALOCADA** | Com instrutor · Ainda não começou |
| **EM_ANDAMENTO** | Data atual está dentro do período do treinamento |
| **CONCLUÍDA** | Data atual é posterior ao fim do treinamento |
| **CANCELADA** | Cancelada manualmente (pode ser reativada) |

> **Importante:** Demandas com modalidade **ONLINE** ou **TUTORIA** nunca ficam com status PENDENTE — não exigem instrutor obrigatório.

### Alerta de pendência

O sistema destaca demandas que ficam **PENDENTE** no Dashboard e nas telas de listagem. São demandas que precisam de ação imediata (alocar instrutor).

### Conflito de agenda

Ao alocar um instrutor, o sistema verifica automaticamente se há conflito com outras demandas ou itens de agenda. Se houver conflito, exibe aviso e pergunta se deseja forçar mesmo assim.

### Treinamento noturno

Se o horário de início for ≥ 18h ou o horário de fim for ≤ 6h, a demanda é marcada como noturna e recebe a tag **(N)** nos cartões da agenda.

### Evidências por modalidade

- **Presencial / Híbrido**: exige lista de presença + certificados + fotos
- **Online**: exige lista de presença + certificados (fotos não são obrigatórias)

---

## 12. Dicionário de Campos

### Modalidade de Treinamento

| Valor | Descrição |
|-------|-----------|
| PRESENCIAL | 100% presencial, com prática in-loco |
| ONLINE | 100% virtual (videoconferência) |
| HÍBRIDO | Parte online + parte presencial (prática) |
| TUTORIA | Acompanhamento individual |

### Modo de Datas

| Valor | Descrição |
|-------|-----------|
| CONTÍNUO | Período ininterrupto (ex: 10/02 a 14/02) |
| DIAS ESPECÍFICOS | Datas avulsas (ex: 10/02, 12/02, 17/02) |

### Tipo de Transporte

| Valor | Descrição |
|-------|-----------|
| Carro Alugado | Locado em empresa parceira (Localiza, Movida) |
| Carro Próprio | Instrutor usa veículo próprio |
| Táxi | Deslocamento por táxi |
| N/A | Não precisa de transporte |

### Categorias de Carro (Grupos)

Grupo B · Grupo BE · Grupo C · Grupo CE · Grupo CS · Grupo F · Grupo FS · Grupo FH · Grupo FX

### Forma de Pagamento (Hospedagem)

| Valor | Descrição |
|-------|-----------|
| Faturado | Cobrado na fatura da empresa |
| PIX | Transferência imediata |
| Balcão | Pagamento direto no hotel |
| N/A | Não aplicável |

### Regiões

Sudeste · Norte · Nordeste

### Funções na Agenda

Instrutor · Coordenador · Motorista

### Tipos de Item Manual na Agenda

FOLGA · INDISPONÍVEL · FÉRIAS · DESCANSO · OUTRO · ESCRITÓRIO (Alphaville / BH / Vitória) · HOME OFFICE · EXTERNO

### Categorias de Despesa (Medição)

| Categoria | Descrição |
|-----------|-----------|
| Café | Café da manhã e lanches |
| Almoço | Refeição do meio-dia |
| Jantar | Refeição noturna |
| Transporte | Combustível, passagens, táxi |
| Hospedagem | Hotel, pousada |
| Outros | Estacionamento, pedágio, etc (linha com descrição livre) |

---

*Fim do Manual · Sistema COLABOR · Versão MVP Estável*
