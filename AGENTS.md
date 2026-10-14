# Instruções do projeto

Este repositório é público.

- Nunca inclua chaves, tokens, senhas, credenciais ou certificados privados em
  código, documentação, commits ou arquivos enviados ao GitHub.
- Use variáveis de ambiente e arquivos ignorados pelo Git, como `.env.local`.
  Exemplos de configuração devem conter somente placeholders.
- Nunca imprima valores secretos em comandos, logs, relatórios ou respostas.
- Antes de um commit ou push, revise os arquivos incluídos e execute Gitleaks
  com `--redact`. Nesta cópia, o executável local está em `.git/tools/gitleaks`.
  Mantenha os hooks em `.githooks/` ativos por meio da configuração local
  `core.hooksPath=.githooks`.
- Se a verificação encontrar um segredo, interrompa o envio e remova o segredo
  de todos os commits que seriam publicados. Não ignore nem desative a verificação.
- Mantenha as skills do projeto em `.agents/skills/`; não as instale globalmente.
