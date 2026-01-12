# Colabor Training Manager 🚀

O **Colabor Training Manager** é uma solução web corporativa de alta performance desenvolvida para a orquestração e gestão de demandas de treinamentos técnicos e de segurança. O sistema centraliza o controle operacional, a alocação de instrutores, a conformidade logística e a gestão documental em uma interface unificada e intuitiva.

---

## 🎯 Visão Geral e Objetivo

O objetivo primordial deste sistema é mitigar falhas operacionais na logística de treinamentos descentralizados. Ele permite que gestores acompanhem o ciclo de vida completo de uma demanda — desde a abertura até o faturamento — garantindo que todos os requisitos (transporte, hospedagem, materiais e documentos) sejam satisfeitos antes do início das atividades.

---

## 🧱 Tecnologias Utilizadas

*   **React (JS/JSX/TSX):** Biblioteca base para construção da interface declarativa.
*   **Context API:** Gerenciamento de estado global centralizado (Single Source of Truth).
*   **Tailwind CSS:** Framework utilitário para design responsivo e consistente.
*   **Recharts:** Motor gráfico para visualização de KPIs e dashboards gerenciais.
*   **docx:** Biblioteca para geração dinâmica de relatórios em formato Microsoft Word (.docx).
*   **Lucide React:** Biblioteca de ícones vetoriais.

---

## 🏗️ Arquitetura (Client-side Only)

A aplicação segue uma arquitetura **100% Client-side**. Por ser uma ferramenta interna de alta agilidade:
*   **Sem Backend:** Toda a lógica de negócio reside no navegador.
*   **Estado Efêmero:** Os dados são mantidos em memória via React Context. Atualizações de página resetam o estado para os dados iniciais do `constants.ts`.
*   **Processamento Local:** Cálculos de status e geração de documentos são processados no cliente, reduzindo a latência e dependência de infraestrutura externa.

---

## ⚙️ Principais Funcionalidades

### 📋 Gestão de Demandas
*   Fluxo completo de CRUD (Criar, Ler, Atualizar, Deletar).
*   Motor de status automatizado (regra de negócio baseada em datas e alocação).
*   Busca avançada e filtros por cliente, região, treinamento e instrutor.

### 🚚 Controle Logístico
O módulo de logística monitora a prontidão operacional através de três estados principais:
*   **PENDENTE (`null`):** Estado inicial. Nenhuma decisão foi tomada.
*   **CONFIRMADO:** A logística foi providenciada e validada.
*   **NAO_NECESSARIO:** Definido explicitamente quando o treinamento não exige aquele item (ex: treinamento local ou online).

### 📂 Gestão Documental (PDF Base64)
Para garantir a rastreabilidade sem um servidor de arquivos, o sistema utiliza o esquema **Base64**:
*   **Upload:** Permite anexar "Lista da Turma" e "Liberação do Instrutor".
*   **Persistência:** Os arquivos são convertidos em strings Base64 e armazenados no estado da demanda.
*   **Download:** Recuperação direta do arquivo original para conferência.

### 📊 Relatórios e Compartilhamento
*   **Exportação DOCX:** Gera relatórios detalhados com comprovantes de medição anexados diretamente no Word.
*   **Integração WhatsApp:** Envio de resumos de demanda via link `wa.me`.
*   **E-mail Corporativo:** Disparo de notificações via protocolo `mailto`.

---

## 📂 Estrutura de Pastas

```text
/
├── components/          # Componentes de interface e módulos de tela
│   ├── Dashboard.tsx    # Visão analítica e gráficos
│   ├── Demands.tsx      # Core da gestão de demandas
│   ├── Logistics.tsx    # Orquestração de instrutores
│   ├── Measurement.tsx  # Lançamento de despesas e faturamento
│   └── ...
├── domain/              # Lógica de negócio pura (independente de UI)
│   └── demandStatus.ts  # Motor de cálculo de status
├── context/             # AppContext e provedores de estado
├── types.ts             # Definições de interfaces e tipos globais
├── constants.ts         # MockData e bases operacionais fixas
└── App.tsx              # Root component e roteamento de visualização
```

---

## 🧠 Regras de Negócio Importantes

1.  **Cálculo de Status:** O status da demanda é dinâmico. Se uma demanda não tem instrutor e faltam menos de 4 dias para o início, ela sobe para `PENDENTE` (alerta).
2.  **Precedência de Cancelamento:** O status `CANCELADA` sobrepõe qualquer lógica de data ou alocação.
3.  **Medição:** O fechamento de uma medição (upload de notinhas) transiciona automaticamente o status da demanda para `CONCLUIDA`.

---

## 🚀 Como Rodar Localmente

O projeto utiliza módulos ES6 nativos e importmaps. Não requer build complexo para desenvolvimento inicial.

1.  Clone este repositório.
2.  Certifique-se de ter um servidor estático (ex: `npx serve`, `Live Server` do VS Code).
3.  Abra o arquivo `index.html`.

---

## ⚠️ Limitações e Próximos Passos

**Limitações:**
*   A persistência em memória implica em perda de dados ao recarregar a aba.
*   O armazenamento de PDFs em Base64 pode degradar a performance se houver centenas de documentos volumosos.

**Roadmap:**
*   Implementação de `LocalStorage` ou `IndexedDB` para persistência local persistente.
*   Integração com Firebase ou Supabase para backend e autenticação.
*   Módulo de exportação de cronograma para Google Calendar/Outlook.

---

## 📄 Licença
Uso interno exclusivo - **Colabor**. Documentação para desenvolvedores e operadores autorizados.

---
**Desenvolvido com foco em Excelência Operacional.**