# Administração e revisão

O painel está em `/admin/`. As páginas e APIs exigem uma sessão privada; os
visitantes continuam recebendo o site estático pela CDN. A conta de administração
é configurada nas variáveis protegidas da Vercel. Nenhuma credencial deve ser
incluída neste repositório público.

## Fluxo de trabalho

1. Em **Fontes da rede**, adicione um `@perfil` ou link do Instagram. Os quinze
   perfis originais e o perfil do projeto já estão cadastrados.
2. Use **Coletar** para uma fonte ou **Coletar novos vídeos** para todas as fontes
   ativas. A opção de coleta a cada seis horas pode ser ativada por perfil.
3. Os novos Reels ficam em **Para revisar**, com capa e vídeo privados. O coletor
   usa a API do Apify no GitHub Actions; nenhuma máquina pessoal precisa ficar ligada.
   A consulta depende da disponibilidade do provedor e de créditos na conta.
4. Abra o vídeo e acrescente contexto, se necessário. **Gerar prévia com IA**
   prepara a legenda sem aprovar o vídeo. **Aprovar e publicar** autoriza o fluxo
   completo. Também é possível selecionar vários vídeos para aprovação.
5. O processamento gera a legenda, publica somente os arquivos aprovados no
   site e encaminha a publicação ao Instagram. O andamento aparece em
   **Em publicação**. O agendamento consulta a fila a cada cinco minutos;
   coleta, deploy, processamento da Meta e atrasos do GitHub podem levar mais tempo. O painel distingue a espera na fila da coleta em andamento e atualiza esse estado a cada dez segundos.

As legendas mantêm a atribuição e incluem de três a cinco hashtags relacionadas
ao assunto. Cinco outros perfis ativos da lista são marcados em cada nova
publicação, com rotação determinística por vídeo e prioridade para a fonte
original quando ela estiver ativa. A própria conta do projeto não ocupa uma
dessas cinco posições. É preciso manter pelo menos cinco outros perfis ativos.
As marcações da aprovação ficam registradas com o vídeo. Novos conteúdos
editoriais publicados pelo workflow também recebem cinco perfis da lista atual.

O acervo publicado antes da implantação do painel permanece disponível. Novas
coletas da administração só se tornam públicas após aprovação. Rejeitar um vídeo
não remove uma postagem já publicada.

## Vercel

Configure estas variáveis privadas em Production, e faça um novo deploy após
alterá-las. Preview pode ter suas próprias credenciais e armazenamento.

| Nome | Uso |
| --- | --- |
| `ADMIN_EMAIL` | E-mail autorizado para o login. |
| `ADMIN_PASSWORD_HASH` | Hash scrypt no formato `scrypt$<salt-hex>$<hash-hex>`. Não é a senha em texto. |
| `ADMIN_SESSION_SECRET` | Valor aleatório com pelo menos quarenta caracteres para assinar sessões. |
| `ADMIN_WORKER_SECRET` | Valor aleatório compartilhado somente com o worker protegido. |
| `BLOB_READ_WRITE_TOKEN` | Conexão automática com o Blob **privado** da fila. |
| `DEEPSEEK_API_KEY` | Chave da sua conta DeepSeek; fica somente no servidor da Vercel. O nome alternativo `DEEP_SEEK_API` também é aceito. |
| `DEEPSEEK_MODEL` | Opcional; padrão `deepseek-flash`. |

O login usa cookie HttpOnly, Secure, SameSite Strict, com validade de oito horas,
proteção de origem/CSRF e limitação persistente de tentativas. Alterar o hash da
senha invalida as sessões anteriores. Para criar um novo hash sem colocar a senha
no histórico do terminal, use uma ferramenta local com entrada oculta e a função
`hashPassword` de `src/server/admin/auth.mjs`.

Os vídeos de revisão ficam no Blob privado; a prévia passa por uma API autenticada
com suporte a requisições parciais. A fila limita a mídia pendente a 512 MiB e
cada vídeo a 90 MiB. Arquivos rejeitados ou já confirmados no Instagram são
removidos da fila privada nos ciclos seguintes. Os vídeos públicos aprovados
continuam na CDN atual, com integridade SHA-256 e origem em releases públicas.

O coletor processa até oito perfis por ciclo, priorizando os pedidos mais antigos, com orçamento de doze minutos para a etapa de coleta. A execução verifica se há trabalho antes de preparar ferramentas. A API do Apify dispensa navegador no executor; FFmpeg verifica os arquivos e preserva a qualidade da fonte.

## GitHub Actions

No ambiente protegido **instagram-publishing**, configure **Environment secrets**:

| Secret | Uso |
| --- | --- |
| `ADMIN_BLOB_READ_WRITE_TOKEN` | Credencial do mesmo Blob privado da aplicação. |
| `ADMIN_WORKER_SECRET` | Mesmo valor configurado na Vercel. |
| `ADMIN_VERCEL_TOKEN` | Token para fazer deploy do projeto autorizado. |
| `INSTAGRAM_ACCESS_TOKEN` | Token existente da conta profissional autorizada. |
| `APIFY_API_TOKEN` | Chave privada do Apify para coletar Reels na nuvem. |

Crie o token de deploy em [Vercel Account Tokens](https://vercel.com/account/settings/tokens),
selecionando o projeto desta aplicação no escopo da equipe correspondente.
Copie o valor gerado para o Secret; não use a senha de login da Vercel.
Os IDs não secretos ficam nas repository variables `VERCEL_PROJECT_ID` e
`VERCEL_ORG_ID`. `PUBLIC_SITE_URL` pode definir a origem pública.

Primeiro execute **Processar revisão da administração** com `check_only=true`.
O relatório deve indicar `deploymentCredential: verified`. Ative a repository
variable `ADMIN_WORKER_ENABLED=true` para os ciclos agendados. O workflow reutiliza
o publicador com histórico persistente, trava contra concorrência e deduplicação;
o mesmo vídeo não é republicado por uma nova tentativa de deploy.

Não há webhook necessário para esse fluxo: o worker consulta as filas e o
processamento do Instagram. A configuração de webhooks da Meta é independente.

## DeepSeek e referências editoriais

As skills `ig-caption-writer`, `ig-hashtag-strategist` e `ig-humanizer` de
[sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills)
estão instaladas somente em `.agents/skills/`, na revisão
`1e6fb1691e4f88aa455dd8ba5f74d1239d8091cc`, com licença MIT preservada.
O contexto de escrita enviado em cada chamada está em
`src/server/admin/instagram-guidance.json`. Isso não treina o modelo nem
depende de ferramentas externas mencionadas pelos documentos originais.

A IA recebe a descrição de origem e as observações do editor. Ela não analisa
os frames ou o áudio do vídeo. Quando o contexto é insuficiente, a seleção fica
salva e o painel pede mais informações. As instruções exigem fidelidade factual,
créditos e hashtags pertinentes, sem inventar tendências ou prometer alcance.
Sem chave, saldo ou disponibilidade do provedor, o vídeo aprovado aguarda na fila.

## Verificação

```sh
npm run test:unit
npm test
npm run build
```

Os testes de administração cobrem sessão, limites de login, isolamento da mídia,
CSRF, aprovação explícita, cinco marcações, respostas da IA, proteção de chaves
e atualizações concorrentes do armazenamento. O build mantém as páginas públicas
pré-renderizadas e cria funções apenas para a administração.

Se o StoriesIG informar que está indisponível, a execução interrompe o lote sem esperar a busca de cada perfil. O painel informa a falha do provedor. Os diagnósticos de falha ficam apenas no Blob privado, com uma captura atual por perfil, sem credenciais ou URLs de API.

## Coleta com Apify

Gere a chave em [Apify Integrations](https://console.apify.com/settings/integrations)
e salve-a como **Environment secret** `APIFY_API_TOKEN` no ambiente
`instagram-publishing` do GitHub. Não é necessário colocar essa chave na Vercel
ou em arquivos do repositório. O próximo ciclo recebe o Secret automaticamente.
A validação `check_only=true` consulta a conta sem iniciar uma coleta cobrada.

A integração usa o [Instagram Reel Scraper mantido pelo Apify](https://apify.com/apify/instagram-reel-scraper),
com dois resultados por perfil, janela de quatorze dias, sem Reels fixados e sem
extras pagos de transcrição, compartilhamentos ou armazenamento do vídeo no
provedor. Os arquivos são baixados imediatamente da CDN do Instagram, validados,
comparados com o acervo e enviados somente à fila privada. Legendas e publicação
ainda dependem da aprovação no painel.

Cada execução informa `maxTotalChargeUsd=0.02` e `timeout=180` na API. Antes de
iniciar, o worker reserva US$ 0,02 em `queue/apify-budget.json`, com limite fixo
de US$ 4 por mês UTC. Reservas não são reembolsadas automaticamente: a margem
conservadora evita novas consultas além desse limite. Isso não contabiliza outros
usos da sua conta Apify, nem custos de GitHub, Blob ou Vercel. O esgotamento de
créditos interrompe a coleta e mantém a fila. Nenhum plano pago é contratado.

O identificador de uma consulta fica em `queue/apify-runs/<perfil>.json`, no Blob
privado. Se o processamento parar, ele retoma a mesma consulta antes de abrir
outra. Se o início não receber confirmação, o erro `APIFY_START_UNCERTAIN` exige
conferir os runs na conta Apify; não repita o POST nem apague o checkpoint sem
verificar se existe uma execução correspondente. Nenhuma chave ou URL assinada
é registrada nesses arquivos ou nos logs. O coletor antigo do StoriesIG continua
disponível para uso local, sem `COLLECTION_PROVIDER=apify` e sem a chave do Apify.

## Legendas na Vercel

A aprovação inicia a legenda na própria Vercel com `waitUntil`, sem esperar a
preparação de FFmpeg ou o próximo ciclo do GitHub. A resposta da aprovação é
imediata; uma falha mantém o vídeo aprovado e registra um código no painel.
Uma trava privada de 210 segundos impede que o worker e a aprovação
façam a mesma geração em paralelo. Depois de uma interrupção, o worker pode
retomar uma trava expirada.

Relatórios de resposta do DeepSeek ficam somente no Blob privado, em
`queue/caption-reports/<id>.json`, com a saída textual limitada e o motivo de
término. Eles permitem distinguir resposta truncada de um formato recusado,
sem registrar cabeçalhos ou credenciais. Não são exportados pelo dashboard
nem pelo manifesto público.

As observações são opcionais. A geração usa o título, a descrição e o perfil
de origem, inclusive quando a descrição é curta. Pouca informação resulta
em uma legenda simples, sem deduzir acontecimentos ou exigir mais contexto.

O DeepSeek tem até 45 segundos para concluir a resposta. Se pedir contexto,
ficar indisponível ou retornar uma resposta inválida ou truncada, o sistema
prepara uma legenda simples com o texto original, sem adicionar fatos. Essa
alternativa mantém as hashtags da descrição quando válidas, completa com
tags do perfil e do formato e identifica o modelo como `source-caption-v1`
e o provedor público como `source-text`; não atribui esse texto à IA.
O motivo permanece no relatório privado em `fallback.reason`. Chave inválida,
ausência de chave ou de saldo continuam sendo erros de configuração.
A função da Vercel usa até 180 segundos, dentro do limite do Fluid Compute.

O workflow publica até 25 vídeos prontos em um único deploy, antes de instalar
ferramentas para novas coletas. Ele recupera até cinco legendas por ciclo.
Se uma legenda falhar, **Em publicação → Gerar legenda novamente** retoma a
geração na Vercel, preservando a aprovação e as cinco marcações selecionadas.

## Envio ao Instagram na Vercel

O envio à Meta também roda na Vercel. Um consumidor privado de Vercel Queues
executa uma etapa da publicação por chamada. Se o Reel ainda estiver em
processamento, agenda uma nova chamada para 60 segundos depois; uma recusa de
quota agenda outra tentativa após 15 minutos. Os IDs e os checkpoints ficam no
Blob privado, em `queue/instagram-publishing-state.json`. Uma interrupção de
publicação continua exigindo confirmação do provedor antes de reenviar.

O primeiro processamento importa e valida o histórico existente da branch
`instagram-publishing-state`. Depois da migração, essa branch é uma fotografia
do histórico antigo; o painel e a limpeza do coletor usam o histórico privado.
Não são apagadas publicações nem operações pendentes na migração.

O botão **Retomar Instagram** adiciona uma mensagem à fila na Vercel. Quando
um lote entra no site, o worker chama o endpoint protegido da Vercel, sem
conectar à Meta pelo GitHub. Um cron diário da Vercel recupera uma fila que
tenha ficado inativa; os intervalos normais usam as mensagens duráveis.

`INSTAGRAM_ACCESS_TOKEN` deve ser uma variável sensível de produção na Vercel,
com `INSTAGRAM_PUBLISHING_RUNTIME=vercel`. A configuração inicial pode ser
feita pelo workflow manual `configure-instagram-vercel.yml`: ele transfere o
Secret diretamente para o projeto autorizado pela API da Vercel, sem gravar
o valor em arquivos ou logs. Após configurar, publique um novo deployment e
desative o fluxo legado com a variável de repositório
`INSTAGRAM_PUBLISHING_RUNTIME=vercel`.

O consumidor é uma função independente da função Astro, gerada no `postbuild`,
com o trigger `queue/v2beta`. Isso mantém o consumidor privado sem tornar o
site e o painel privados. Referência: [Vercel Queues](https://vercel.com/docs/queues/quickstart).
