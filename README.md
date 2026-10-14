# Todos com Lula — site

Repositório do site Todos com Lula.

## Credenciais

Este repositório é público. Guarde chaves e tokens em variáveis de ambiente ou
em arquivos locais ignorados pelo Git, como `.env.local`. Arquivos de exemplo
devem conter apenas placeholders. Nunca inclua segredos no código, em commits
ou em arquivos enviados ao GitHub.

Os hooks em `.githooks/` verificam os arquivos preparados para commit e o
histórico antes de um push com Gitleaks. Eles estão ativos nesta cópia de trabalho,
com o executável instalado localmente em `.git/tools/gitleaks`.
Em novos clones, disponibilize Gitleaks e ative os hooks com
`git config --local core.hooksPath .githooks`.

## Skill do projeto

A skill [reverse-engineer-anything](.agents/skills/reverse-engineer-anything/SKILL.md)
está instalada em `.agents/skills/` apenas para este projeto, com suas referências.
Origem: [morluto/rea](https://github.com/morluto/rea), sob a
[licença MIT](.agents/skills/reverse-engineer-anything/LICENSE).
