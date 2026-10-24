# Publicação automática em @boraaalula2026

> O envio atual roda na Vercel. Consulte [Envio ao Instagram na Vercel](admin.md#envio-ao-instagram-na-vercel). Os comandos e o workflow abaixo descrevem o publicador legado, preservado para manutenção do histórico.

## Lote manual durante a indisponibilidade do armazenamento

O workflow **Instagram — lote manual aprovado** lê somente os IDs de
`src/data/instagram-manual-batch.json`. O lote de 23/10/2026 contém dez vídeos
adicionais cujos horários relativos indicam publicação no próprio dia, no fuso
America/Sao_Paulo. A seleção considera a incerteza do arredondamento desses
horários; os intervalos ficam em `publicationWindow`, sem inventar datas exatas.
Cada vídeo tem legenda revisada, atribuição e cinco marcações.

Os vídeos foram priorizados pelas curtidas exibidas no StoriesIG,
com comentários como desempate, excluindo vídeos já importados e cópias visuais.
As contagens arredondadas e o horário da consulta ficam em `engagementSnapshot`
nos registros; o critério e o alcance da consulta estão no manifesto do lote.

As legendas usam português brasileiro de conversa, com palavras comuns e uma
abertura clara. A preferência editorial está em
`.agents/references/voice-profile.md` e na política do gerador de legendas.
Vinte legendas anteriores também foram revistas no site, preservando as chaves
de publicação. As versões para trocar no aplicativo do Instagram estão em
`public/legendas-revisadas-2026-10-22.txt`; o publicador não edita posts já enviados.

O envio exige aprovação nas últimas 48 horas, armazenamento privado bloqueado
e `INSTAGRAM_NATIVE_PAUSED=true` no deployment ativo. Confere a conta e os
posts existentes na Meta antes de enviar, mantém os checkpoints na branch
`instagram-manual-state` e interrompe o lote diante de um resultado incerto.
O histórico anterior é preservado. Após o lote, restaure a configuração anterior
de `INSTAGRAM_NATIVE_PAUSED` e publique o deployment correspondente.

A automação prepara a fila do acervo e, no modo padrão, publica **no máximo um conteúdo por execução** na conta `boraaalula2026`. O workflow verifica a fila a cada 15 minutos quando `INSTAGRAM_AUTOPUBLISH_ENABLED=true`. Inclui o acervo elegível que ainda não foi publicado e as novas adições, na ordem de chegada ao acervo. `observedAt` serve para ordenar a coleta; não é apresentado como data original de publicação.

A publicação já está autorizada pelo responsável pelo projeto. A fila deve ser ativada somente depois de validar a autenticação da conta.

## Conectar a conta

O caminho escolhido é a **Instagram API com Instagram Login**, da Meta. A conta precisa ser profissional, do tipo Empresa ou Criador. Se ainda for pessoal, transforme-a em conta profissional nas configurações do Instagram antes de conectar. Configure um app Meta com o produto Instagram e autorize a conta com as permissões `instagram_business_basic` e `instagram_business_content_publish`. O fluxo oficial devolve o Instagram User ID e um token de usuário. A configuração de acesso do app precisa permitir operar essa conta. Consulte o [guia de Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login) e o [fluxo de autorização oficial](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login).

O publicador consulta `username` na API antes de criar o conteúdo e novamente antes de publicar. Se a API não retornar exatamente `boraaalula2026`, ele encerra a execução. Não existe variável para escolher outra conta.

Configure os valores privados no GitHub, em **Settings → Environments → instagram-publishing → Secrets**:

| Segredo | Valor necessário |
| --- | --- |
| `INSTAGRAM_ACCESS_TOKEN` | Token de usuário obtido pela autorização oficial da conta |
| `INSTAGRAM_USER_ID` | Opcional: ID da conta profissional obtido no mesmo fluxo. Sem esse segredo, o publicador consulta `/me?fields=user_id,username` e descobre o ID depois de confirmar a conta |

Para gerar o token no painel da Meta, abra **Instagram → Configuração da API com login empresarial no Instagram → Gere tokens de acesso**. Adicione a conta como **Testador do Instagram**, aceite o convite no Instagram em **Apps and Websites** e volte ao painel para gerar o token ao lado da conta. O ID do aplicativo e o ID do app do Instagram mostrados no topo do painel não são o ID da conta.

O `GITHUB_TOKEN` é fornecido automaticamente pelo GitHub Actions; o job de publicação tem permissão `contents: write` para manter o estado. Não é necessário adicionar um token pessoal do GitHub para executar o workflow.

Nas variáveis do repositório, configure:

| Variável | Configuração |
| --- | --- |
| `PUBLIC_SITE_URL` | URL HTTPS permanente da versão pública do site, sem caminho, query ou credenciais |
| `INSTAGRAM_AUTOPUBLISH_ENABLED` | `false` enquanto estiver preparando a conexão; `true` para ativar a fila a cada 15 minutos |
| `INSTAGRAM_API_VERSION` | Opcional; o padrão fixado é `v26.0` |

Guarde credenciais somente em Secrets ou em arquivo local ignorado, como `.env.instagram.local`. Nunca envie tokens no chat, no repositório, nos comentários de issues ou em logs. O publicador usa o cabeçalho Bearer; não acrescenta tokens às URLs nem imprime respostas brutas dos provedores.

Os tokens de longa duração do Instagram têm validade e precisam ser renovados conforme o [fluxo oficial da Meta](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login). Esta implementação não realiza troca OAuth ou renovação automática de tokens. Ao renovar, atualize o segredo protegido sem publicar seu valor.

## Operar a fila

Em **Actions → Publicar acervo no Instagram → Run workflow**, marque `check_connection=true` para validar o token, confirmar `boraaalula2026`, descobrir o ID da conta e consultar a quota da Meta. Esse modo usa apenas consultas GET; não carrega o acervo, não escreve estado e não publica, independentemente do valor de `dry_run`. Os logs contêm somente a conta confirmada, seu ID público e a quota; erros do provedor são sanitizados.

Para validar localmente com o token em um arquivo ignorado, execute `node --env-file=.env.instagram.local scripts/instagram-publish.mjs --check-connection`.

Em **Actions → Publicar acervo no Instagram → Run workflow**, `dry_run=true` mostra o ID e o tipo do próximo conteúdo disponível, sem chamar a Meta ou modificar o estado. O padrão é simulação. Escolher `dry_run=false` executa a publicação com a autenticação configurada; não é necessário digitar uma confirmação adicional. O agendamento usa somente a variável operacional `INSTAGRAM_AUTOPUBLISH_ENABLED`.

Para enviar todo o acervo pendente já autorizado, escolha `dry_run=false`, `check_connection=false` e `publish_all=true`. Esse modo continua a fila sem apagar posts ou histórico e usa os mesmos checkpoints, lease, quota e verificações de conta. Para ao terminar o acervo, atingir a quota, completar 100 ciclos ou alcançar 45 minutos; o agendamento pode continuar o restante. Erros de publicação interrompem o lote e preservam a operação pendente para inspeção ou retomada. O runner reserva 60 minutos para concluir com segurança o último processamento. Localmente, esse modo corresponde a `--publish-all`.

O workflow não precisa instalar as dependências do site para publicar. O publicador usa Node.js e `fetch` nativo, lendo `/feed.json` e verificando os arquivos diretamente no domínio público. Ele não depende das mídias ignoradas pelo Git estarem presentes no runner.

Para simular localmente, substitua o domínio de exemplo:

```sh
PUBLIC_SITE_URL='https://seu-dominio.example' node scripts/instagram-publish.mjs --dry-run
```

Sem estado remoto, a simulação usa um estado local somente para leitura em `.cache/instagram-publishing/state.json`, quando esse arquivo existir. A simulação no Actions consulta o estado remoto e, por isso, reflete o histórico real da fila.

A execução local com publicação requer a mesma branch de estado persistente do Actions. Um arquivo ignorado pode conter apenas os valores reais que você configurar privadamente; o exemplo abaixo contém somente placeholders:

```dotenv
PUBLIC_SITE_URL=https://DOMINIO_PUBLICO.example
INSTAGRAM_STATE_BACKEND=github
GITHUB_REPOSITORY=OWNER/REPOSITORY
GITHUB_TOKEN=GITHUB_CONTENTS_WRITE_TOKEN_PLACEHOLDER
INSTAGRAM_ACCESS_TOKEN=INSTAGRAM_USER_ACCESS_TOKEN_PLACEHOLDER
```

O repositório de estado aceito é `todoscomlula/site`. Depois de preencher o arquivo ignorado e manter o Gitleaks local disponível, execute:

```sh
node --env-file=.env.instagram.local scripts/instagram-publish.mjs --publish
```

## Imagens, vídeos e atribuição

Vídeos MP4 disponíveis no domínio do site são enviados completos como **Reels**, usando `video_url` e `share_to_feed=true`. O publicador não corta ou transcodifica vídeos. Os arquivos devem satisfazer os formatos e codecs exigidos pela Meta; a plataforma valida o processamento antes de publicar. Consulte a [referência de mídia](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media).

A API de imagens aceita JPEG. O prebuild do site já restaura as mídias e executa `prepareImages()` automaticamente. O preparo lê os manifestos editorial, Instagram e StoriesIG, gera JPEGs em sRGB e conserva os JPEGs que já atendem aos requisitos. Imagens muito altas ou largas recebem padding para preservar o quadro inteiro, sem recorte e sem sobrescrever o original. O mapa público `/instagram-publication-assets.json` fornece o `instagramImageUrl` exportado no feed.

As legendas reservam espaço para a atribuição, o link do conteúdo, uma chamada para seguir `@boraaalula2026` e até cinco hashtags relacionadas ao assunto. `#Lula` e `#TodosComLula` identificam o projeto; os demais temas são escolhidos a partir do título e resumo, como `#FarmaciaPopular`, `#SUS`, `#PeDeMeia` e `#MEI`. Vídeos podem incluir `#ReelsBrasil`. Tags antigas são removidas do texto antes de compor o conjunto, e título e resumo idênticos aparecem uma só vez. Essa seleção temática não representa um ranking de tendências em tempo real nem uma garantia de alcance.

O publicador exige arquivos HTTPS públicos e permanentes no mesmo domínio, com tipo `image/jpeg` ou `video/mp4`. Ele rejeita URLs assinadas, com query ou credenciais e URLs de CDN externa. Novos itens com mídia indisponível ou incompatível são pulados para permitir que a fila continue. Carrosséis não são publicados por esta versão. As legendas incluem o título, o resumo, a fonte e o link do conteúdo, respeitando o limite da API e preservando a atribuição. Referência: [publicação de conteúdo da Meta](https://developers.facebook.com/documentation/instagram-platform/content-publishing).

## Evitar republicações

A automação calcula um identificador por `contentGroupId`, quando o grupo de vídeo foi confirmado na coleta; caso contrário, usa o permalink sem parâmetros ou o ID editorial. O grupo usa um representante estável e evita publicar novamente versões do mesmo vídeo vindas de fontes diferentes. Grupos distintos mantêm publicações independentes. Legendas parecidas não são utilizadas para inferir duplicatas.

Publicações originadas de `boraaalula2026` não entram na fila. Grupos confirmados que já aparecem nesse perfil também são considerados publicados, inclusive quando outro perfil tiver enviado uma versão equivalente.

O histórico fica na branch dedicada `instagram-publishing-state`. Ela contém o `state.json` sanitizado e um `vercel.json` que desativa deploys dessa branch; não contém tokens, legendas, cookies, credenciais ou URLs temporárias. A [configuração Git da Vercel](https://vercel.com/docs/project-configuration/git-configuration) permite impedir os deploys por essa configuração. A publicação roda no Actions; o site continua estático e não ganha uma função ou um cron na Vercel.

O estado armazena hashes de conteúdo, IDs públicos, estágio da operação e datas dos checkpoints. A concorrência do workflow, um lease com expiração e atualizações condicionadas ao SHA do arquivo impedem duas execuções de substituir simultaneamente o mesmo estado. **Cada checkpoint é persistido antes da respectiva operação externa.** Antes de criar qualquer commit de estado, o Gitleaks local é executado com `--redact`. Uma falha de validação ou de verificação interrompe o envio.

O campo `publishedAt` desse arquivo administrativo registra o momento em que a automação confirmou o resultado; ele não altera a data original do material no site. A branch precisa ser preservada para manter a deduplicação entre execuções.

## Processamento, quota e recuperação

O fluxo cria um contêiner, consulta o processamento e só publica depois de `FINISHED`. A consulta ocorre uma vez por minuto, por até cinco minutos. O timeout mantém o contêiner no estado `processing` para a próxima execução. Um contêiner `EXPIRED` que ainda não foi enviado para publicação pode ser recriado com segurança, no máximo uma vez por execução. Referência: [guia de publicação](https://developers.facebook.com/documentation/instagram-platform/content-publishing).

A quota é consultada na API e respeita `quota_usage` e `config.quota_total`. Quando esgota, a fila aguarda a próxima execução, sem reservar uma nova publicação. Não há um limite diário inventado no código; a resposta da conta é a referência. Consulte a [referência de quota da Meta](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit).

Uma recusa explícita de publicação com HTTP 400, código 9 e subcódigo 2207042 também pausa a fila, mesmo quando a consulta de quota indica capacidade disponível. O contêiner permanece em `processing` para a próxima execução. A recusa não é registrada como publicação nem como resposta incerta. Outros erros e interrupções continuam preservando `publishing` para impedir reenvios sem confirmação. Os logs registram somente códigos numéricos; mensagens da Meta não são exportadas.

Se uma chamada de publicação perder a resposta, o estado permanece `publishing`. O publicador **não reenvia essa chamada automaticamente**: primeiro consulta o contêiner. `PUBLISHED` confirma o sucesso e conclui o histórico. Outro estado gera `PUBLISHING_RESULT_UNCERTAIN` e exige conferir o perfil e o resultado no provedor antes de qualquer intervenção no estado.

Para resolver uma operação incerta, mantenha o agendamento desligado, confira o contêiner e a conta e preserve todos os registros já concluídos. Somente quando estiver confirmado que a operação não publicou o conteúdo, remova aquele `pending` no estado para permitir uma nova tentativa. Não apague a branch ou o histórico para resolver um erro. Revise a alteração e execute Gitleaks com `--redact` antes de publicar qualquer commit manual.

O cron representa uma fila periódica, não publicação instantânea: processamento, quota e atrasos do agendador podem manter itens aguardando. Cada execução agendada publica no máximo um item. O modo manual `publish_all=true` pode consumir vários itens do backlog.

## Verificação offline

```sh
node --test scripts/test-instagram-publishing.mjs scripts/test-instagram-assets.mjs
```

Os testes não conectam uma conta nem publicam. Cobrem identidade incorreta, Bearer sem token na URL, erros sem exposição de credenciais, dedupe por grupos e pelo próprio perfil, limite de quota, lease, checkpoints duráveis, timeout, recriação limitada de contêiner expirado, resposta incerta, preservação de imagens e preparo dos manifestos StoriesIG. O teste local também executa o Gitleaks real sobre um estado sanitizado.

Valide a conexão pelo workflow antes de ativar o agendamento. A confirmação de leitura da conta e da quota não representa uma publicação ao vivo; confira também o resultado da primeira execução de publicação.

Em 14/10/2026, a [validação da conexão](https://github.com/todoscomlula/site/actions/runs/38628630783) confirmou a conta esperada e a quota da Meta. A [primeira publicação](https://github.com/todoscomlula/site/actions/runs/38628789905) confirmou o card `farmacia-popular`, persistiu o histórico sem pendência e liberou o lease. Depois disso, `INSTAGRAM_AUTOPUBLISH_ENABLED` foi configurado como `true`.
