# Revisão de segurança e importação — 27/10/2026

## Escopo e isolamento

Base: main 183c577c573f3cbc3af4059a3c69c5e39b0c930c. Desenvolvimento na branch hardening/test-security-and-import.

Produção (bdrexwsbvydkfsnttcyu): somente consultas de leitura. Nenhuma migração, importação, edição de dados, mudança de autenticação ou publicação.

Testes (qwcxjaldvehwgfnozaby): projeto reativado; recebeu as três migrações de correções que faltavam e a nova importação. .env.local usa exclusivamente esse banco e está ignorado pelo Git. Nenhum dado da produção foi copiado. Não houve criação de recurso pago.

## Auditoria do banco de produção

- RLS ativo nas seis tabelas. Políticas de leitura/escrita vinculam user_id a auth.uid(), com USING e WITH CHECK nos updates.
- Políticas de atendimentos validam o proprietário da cliente; pagamentos validam o proprietário do atendimento.
- Nenhuma permissão de tabela para anon; authenticated tem SELECT, INSERT, UPDATE e DELETE, sem TRUNCATE, REFERENCES ou TRIGGER.
- As quatro funções de gatilho usam SECURITY INVOKER e search_path restrito; gatilhos de pagamento, valor do atendimento e produtos estão ativos.
- Zero registros sem dono, vínculos entre contas diferentes, produtos ausentes nos atendimentos, clientes/pagamentos órfãos ou atendimentos com recebimento excedente nas consultas realizadas.
- Contagens observadas: 117 produtos, 8 atendimentos, 6 clientes, 7 pagamentos, 6 gastos e 2 configurações.
- As cinco migrações existentes no repositório estão registradas com os mesmos nomes e versões na produção. Não há divergência encontrada nesse conjunto.
- O ambiente de testes tem histórico legado próprio; foi atualizado pelas migrações de correção, sem reaplicar a conversão V1/V2 que poderia gerar pagamentos históricos indevidos.

## Nova importação

O cliente chama import_studio_backup uma única vez. Toda a mesclagem acontece em uma transação do PostgreSQL: erros em qualquer etapa desfazem todas as alterações daquela tentativa. Não existe fallback para a gravação antiga por etapas.

A função mantém SECURITY INVOKER e RLS. anon/PUBLIC não podem executá-la. Valida formato, limites, IDs duplicados, referências entre registros, datas, números e pagamentos. Tabelas e colunas usadas no SQL dinâmico vêm de uma lista fixa; o conteúdo do arquivo é parametrizado.

Importações da mesma conta são serializadas por trava de transação. Recibos com SHA-256 do conteúdo e mapeamento dos registros permitem repetir o mesmo arquivo após perda de resposta sem duplicar, preservam edições posteriores e permitem restaurar somente registros que foram excluídos. Recibos também têm RLS por conta. Configurações e registros existentes não são sobrescritos; custos históricos não são recalculados.

O Excel v1 com a aba técnica continua compatível. O parser foi separado da interface para testes e passou a rejeitar linhas incompletas, configurações duplicadas, IDs sem precisão e centavos acima do limite do banco.

Limite mantido: 20.000 registros no arquivo. Arquivos grandes podem exceder o tempo de execução do serviço; nesse caso a transação é desfeita e pode ser repetida. Alterações normais feitas por outra sessão ainda podem provocar conflito e abortar uma tentativa, preservando a integridade.

A auditoria também encontrou a CSP do HTML fixada no endereço de produção, o que impediria o banco de testes de funcionar pelo navegador. A CSP agora deriva da origem validada do ambiente, sem liberar domínios extras. Compilar em modo de testes com o endereço do banco real é bloqueado. Há seis testes específicos para esse isolamento.

## Verificações

- 29 testes automatizados do Excel e da chamada do aplicativo.
- 18 cenários no PostgreSQL, incluindo erro injetado depois de gravações, reversão integral, perda de resposta seguida de repetição, restauração de registro ausente, preservação de edições, pagamentos excedentes e isolamento entre duas contas.
- Contas e registros dessa suíte criados dentro de subtransação e desfeitos ao final.
- Duas chamadas simultâneas reais no banco de testes: resultados added=8/kept=0 e added=0/kept=8. Totais finais: 2 produtos, 1 atendimento, 2 pagamentos e 1 recibo, sem duplicação. Conta fictícia e respectivos registros removidos depois do ensaio.
- Lint, compilação e verificação do diff realizados. Os testes locais foram adicionados ao workflow de revisão de PR.
- A compilação local usa o banco de testes. Nenhum pacote foi publicado no GitHub Pages.

## Dependências

A auditoria inicial encontrou três pacotes com avisos altos: Vite, source-map-js e Zod. Foram corrigidos somente nesta branch: Vite 8.3.5, source-map-js 1.2.2 e Zod 4.6.7, com lockfile atualizado. A instalação informou zero vulnerabilidades após a atualização. Essas dependências são usadas pelas ferramentas de desenvolvimento, estilos e lint; isso não demonstra comprometimento do site estático publicado.

Referências: https://github.com/vitejs/vite/releases/tag/v8.3.5
https://github.com/advisories/GHSA-68fv-2mgg-jv7q
https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

## Pendências encontradas

1. O Supabase continua avisando que a proteção contra senhas vazadas está desabilitada. Não houve alteração de plano ou autenticação. Referência: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
2. Ao remover a conta fictícia do ensaio de concorrência, o gatilho já existente de exclusão de produtos tentou atualizar atendimentos durante a remoção em cascata da conta, causando conflito com a FK de usuário. A operação falhou e foi desfeita. A limpeza dos registros fictícios foi concluída em ordem explícita e confirmada. Esse caso administrativo não foi corrigido nesta mudança de importação; requer revisão própria antes de qualquer exclusão de conta. Não excluímos nenhuma conta real.
3. A confirmação de login, recuperação de senha e aparência no iPhone não foi repetida manualmente nesta etapa. Testes de banco, arquivo e chamada do aplicativo não equivalem a um teste visual completo.
4. Permanece o aviso de tamanho do módulo Excel, carregado sob demanda. A compilação atual passou; __dirname foi substituído por import.meta.dirname na configuração.

## Publicação futura

Este trabalho fica separado para revisão. A versão oficial ainda usa a importação anterior. Não mesclar/publicar automaticamente.

Antes de uma publicação futura: exportação manual recente, revisão da migração aditiva, testes finais do fluxo no ambiente separado e autorização do usuário. Aplicar a migração antes do novo cliente, pois o novo código recusa importar em ambiente sem o RPC, sem gravar parcialmente.

A migração foi refinada durante os testes; a definição final da função foi reaplicada no banco de testes. O histórico de iterações desse ambiente não deve ser copiado para a produção: utilizar o arquivo final versionado e validar previamente a ausência dos novos objetos na produção.
