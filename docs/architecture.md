# Arquitetura do Studio em Dia

Este documento apresenta a organização técnica da aplicação sem depender de detalhes de implementação específicos de uma tela.

## Visão geral

O Studio em Dia é uma aplicação React executada no navegador. A interface usa o cliente oficial do Supabase para autenticação e acesso ao PostgreSQL. O GitHub Pages hospeda apenas os arquivos estáticos gerados pelo Vite.

```text
Navegador
  ├── React + TypeScript
  ├── Supabase Auth
  └── Supabase Data API
          └── PostgreSQL + RLS
```

## Responsabilidades

| Pasta | Responsabilidade |
| --- | --- |
| `src/components` | Componentes visuais reutilizáveis e identidade da marca |
| `src/features/studio` | Painel principal, formulários e fluxos do studio |
| `src/lib` | Comunicação com o Supabase, validações e utilitários |
| `src/styles` | Tema, layout responsivo e estilos de impressão |
| `supabase/migrations` | Mudanças versionadas e reproduzíveis do banco |
| `supabase/validation` | Consultas de conferência para migrações |
| `docs/releases` | Escopo e decisões das versões publicadas |

## Fluxo de dados

1. A pessoa entra com e-mail e senha pelo Supabase Auth.
2. O navegador recebe uma sessão autenticada.
3. A aplicação consulta e grava apenas as linhas permitidas pelas políticas RLS.
4. Os cálculos de resumo são feitos a partir dos registros da conta autenticada.
5. Custos históricos permanecem salvos no atendimento para não mudar retroativamente.

## Publicação

1. O desenvolvimento acontece em uma branch separada.
2. Uma Pull Request executa lint e build no GitHub Actions.
3. Depois da aprovação, a alteração entra na branch protegida `main`.
4. O workflow de Pages gera o build e publica a nova versão.

O banco e o site são atualizados separadamente. Migrações são aplicadas de forma aditiva antes de o novo código depender delas.

## Decisões de segurança

- A chave usada no navegador é publicável e possui acesso limitado pelas políticas do banco.
- A chave `service_role` não é usada no front-end.
- RLS permanece habilitado nas tabelas com dados da aplicação.
- Identificadores recebidos da interface são verificados antes de gravações relacionadas.
- Regras críticas, como o limite de pagamentos e a propriedade de produtos, também são validadas no PostgreSQL.
