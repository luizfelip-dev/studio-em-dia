<p align="center">
  <img src="./public/studio-em-dia-mark.png" alt="Símbolo do Studio em Dia" width="150" />
</p>

<h1 align="center">Studio em Dia</h1>

<p align="center">
  <strong>Gestão financeira e de atendimentos para maquiadoras.</strong><br />
  Uma aplicação simples, bonita e acessível no computador ou celular.
</p>

<p align="center">
  <a href="https://luizfelip-dev.github.io/studio-em-dia/"><img alt="Acessar aplicação" src="https://img.shields.io/badge/Acessar_aplicação-9D2857?style=for-the-badge&logo=github&logoColor=white" /></a>
  <img alt="React" src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-181818?style=for-the-badge&logo=supabase&logoColor=3FCF8E" />
</p>

---

## Sobre o projeto

O **Studio em Dia** centraliza agenda, clientes, pagamentos, produtos e despesas de uma profissional de maquiagem. A aplicação transforma esses registros em uma visão mensal clara de valores recebidos, pendências, custos, lucro, meta e reserva financeira.

O projeto foi criado para quem não tem familiaridade com tecnologia: a interface evita cálculos manuais, funciona bem no iPhone e no computador e mantém os dados vinculados à conta da profissional.

## Funcionalidades

| Área | O que a aplicação oferece |
| --- | --- |
| **Atendimentos** | Cliente, serviços, data, horário, status, valor, produtos usados e custos adicionais |
| **Agenda** | Visão mensal, próximos atendimentos e evento `.ics` para a agenda do celular |
| **Clientes** | Nome, telefone, observações e histórico de atendimentos |
| **Pagamentos** | Sinal, parcelas, valor pendente e edição ou exclusão de lançamentos |
| **Produtos** | Cadastro, edição e cálculo do custo médio por atendimento |
| **Financeiro** | Recebido, pendente, custos, despesas, lucro, ticket médio, meta e reserva |
| **Comunicação** | Confirmação de atendimento pelo WhatsApp com mensagem pronta para revisão |
| **Dados** | Exportação e importação manual em Excel, com abas organizadas |
| **Relatório** | Resumo mensal pronto para imprimir ou salvar em PDF |

### Como o custo de produto é calculado

```text
custo por atendimento = preço da embalagem ÷ quantidade total × uso médio
```

O custo registrado em um atendimento funciona como um **histórico**. Alterar o preço de um produto não modifica atendimentos antigos; o valor só é recalculado quando a seleção de produtos daquele atendimento é editada.

## Tecnologias

- **React 19** e **TypeScript** para a interface.
- **Vite** para desenvolvimento e build.
- **Supabase Auth** para acesso por e-mail e senha.
- **Supabase PostgreSQL** para armazenamento dos dados.
- **Row Level Security (RLS)** para isolamento entre contas.
- **ExcelJS** para exportação e importação em `.xlsx`.
- **GitHub Actions** e **GitHub Pages** para validação e publicação.

## Estrutura do projeto

```text
studio-em-dia/
├── .github/workflows/        # Verificação automática e publicação
├── docs/                     # Arquitetura e histórico das versões
├── public/                   # Logo, ícone e arquivos públicos
├── src/
│   ├── components/           # Marca e componentes visuais reutilizáveis
│   │   └── ui/               # Componentes básicos da interface
│   ├── features/studio/      # Painel e regras da experiência principal
│   ├── lib/                  # Supabase, acesso aos dados e utilitários
│   ├── styles/               # Identidade visual e responsividade
│   ├── App.tsx               # Autenticação e entrada da aplicação
│   └── main.tsx              # Inicialização do React
├── supabase/
│   ├── migrations/           # Histórico versionado do banco
│   └── validation/           # Verificações antes e depois de migrações
└── vite.config.ts            # Configuração do build
```

Uma explicação mais detalhada está em [docs/architecture.md](./docs/architecture.md).

## Executando localmente

### Requisitos

- Node.js 22 ou superior.
- npm 11 ou superior.
- Um projeto Supabase para desenvolvimento.

### Instalação

```bash
git clone https://github.com/luizfelip-dev/studio-em-dia.git
cd studio-em-dia
npm ci
cp .env.example .env.local
npm run dev
```

Preencha o `.env.local` com a URL e a chave publicável do projeto Supabase de testes:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel
VITE_APP_ENV=test
```

> Nunca use a chave `service_role` no navegador ou em arquivos publicados.

## Verificações de qualidade

Antes de uma alteração entrar na branch `main`, a Pull Request executa automaticamente:

```bash
npm run lint
npm run build
```

Para conferir também as dependências de produção:

```bash
npm audit --omit=dev
```

## Segurança e dados

- Cada registro possui o identificador da conta autenticada.
- Todas as tabelas de dados pessoais usam **RLS**.
- A aplicação valida clientes, produtos, atendimentos e pagamentos antes de gravar.
- Pagamentos não podem ultrapassar o valor do atendimento.
- Migrações são aditivas e preservam os registros existentes.
- A branch `main` é protegida e recebe alterações por Pull Request.
- Dados financeiros ficam no Supabase, nunca dentro do repositório.

## Documentação

- [Arquitetura da aplicação](./docs/architecture.md)
- [Funcionalidades entregues na V2](./docs/releases/v2.md)
- [Plano de publicação segura da V2](./docs/releases/v2-release-plan.md)

## Publicação

Alterações aprovadas na branch `main` acionam o workflow de publicação do GitHub Pages. O build de produção é disponibilizado em:

### [luizfelip-dev.github.io/studio-em-dia](https://luizfelip-dev.github.io/studio-em-dia/)

---

<p align="center">
  Feito para deixar a rotina do studio mais simples e os números mais claros.
</p>
