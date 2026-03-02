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
| **Admin** | Acesso total: criar, editar, deletar demandas; gerenciar usuários e cadastros |
| **Analista** | Criar, editar e deletar demandas; visualizar tudo |
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
- **Região**: Sudeste, Norte, Nordeste ou Sul
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
| Região | Dropdown | ✓ | Sudeste, Norte, Nordeste ou Sul |
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
- Regiões de Atuação (multi-seleção): Sudeste, Norte, Nordeste, Sul
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

Sudeste · Norte · Nordeste · Sul

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
