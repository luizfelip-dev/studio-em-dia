# Publicação segura da V2

> Documento histórico. A V2 foi publicada com sucesso em setembro de 2026 e os dados existentes foram preservados.

Este plano preserva os dados da V1 e mantém o site oficial funcionando até a aprovação final.

## Antes da publicação

1. Exportar os dados pelo site e gerar um backup do projeto Supabase.
2. Executar `supabase/validation/v2_preflight.sql` e guardar o resultado.
3. Aplicar `supabase/migrations/20260919024346_v2_safe_upgrade.sql` primeiro no banco de testes.
4. Executar `supabase/validation/v2_postflight.sql`.
5. Confirmar que produtos, atendimentos, gastos e configurações mantiveram as mesmas quantidades.
6. Testar login, clientes, agenda, pagamentos, gastos, produtos e configurações.

## Publicação

1. Aplicar a migração no banco oficial em uma única operação.
2. Executar a validação pós-migração antes de trocar o site.
3. Publicar o código da V2 apontando para o mesmo projeto Supabase oficial.
4. Entrar com a conta real e conferir os dados antes de liberar o uso normal.

## Regras de segurança

- A migração não apaga tabelas, colunas ou registros.
- Clientes são criadas a partir dos nomes já presentes nos atendimentos.
- Atendimentos antigos continuam ligados ao mesmo usuário.
- Como a V1 não separava pagamentos, os atendimentos antigos entram como quitados para preservar os totais anteriores.
- A V1 continua disponível para restauração do código caso seja necessário.
- O banco oficial só será alterado depois de uma confirmação específica para a publicação.
