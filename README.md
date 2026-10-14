# Todos com Lula

Portal independente com cards, publicações e Reels para acompanhar e compartilhar.
O site gera páginas estáticas com Astro e é publicado na Vercel.

## Desenvolvimento

```sh
npm ci
npm run dev
```

```sh
npm run build
npm test
```

Os testes do navegador usam o Chrome instalado no macOS. Os testes da coleta
direta podem ser executados sem acessar o Instagram:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
```

## Acervo e compartilhamento

- `src/data/editorial.json`: cards originais e fontes oficiais.
- `src/data/sources.json`: nosso @boraaalula2026 e os 15 perfis selecionados.
- `src/data/storiesig-posts.json`: publicações obtidas pelo fluxo público do StoriesIG.
- `src/data/instagram-posts.json`: importações diretas com Instaloader.
- `public/cards/`: PNG para compartilhar e WebP para apresentação.
- `public/media/instagram/`: imagens, vídeos e capas realmente baixados.

Cada conteúdo tem página própria, link da fonte, WhatsApp, download e
compartilhamento nativo de arquivos quando o navegador e os apps oferecem suporte.
O botão do WhatsApp prepara o MP4 ou a imagem e abre o menu do celular para
escolher o WhatsApp. Ele não substitui o arquivo pelo link da página. Em downloads
lentos, pode ser necessário tocar novamente depois que o arquivo estiver pronto;
esse segundo toque abre o menu sem baixar o arquivo outra vez. Sem suporte a
arquivos, o botão oferece o download e orienta a anexar pelo aplicativo.
Copiar link e os botões para divulgar o site continuam compartilhando a página.
Horários relativos não são convertidos em datas inventadas. Quando um permalink
não está disponível, o conteúdo aponta para o perfil de origem.

## Estatísticas de visitas

Vercel Web Analytics está habilitado no projeto. O SDK `@vercel/analytics` é
carregado somente no build de produção e registra visitas a páginas, sem eventos
personalizados de compartilhamento ou reprodução. URLs de páginas são enviadas
sem parâmetros ou fragmentos; Do Not Track e Global Privacy Control desativam a
medição. A página de privacidade descreve esse uso.

Consulte o [painel do projeto](https://vercel.com/thiago-butignon-claramunts-projects/todos-com-lula/analytics).
No plano Hobby, o limite é compartilhado pela equipe: 50 mil eventos por mês,
segundo a [documentação da Vercel](https://vercel.com/docs/analytics/limits-and-pricing).
Nenhum upgrade pago foi contratado.

Os testes de proteção das estatísticas usam `npm run test:unit`.

## Publicação automática no Instagram

A fila inclui o acervo elegível e novas entradas, sem republicar o mesmo vídeo.
O workflow consulta o site a cada 15 minutos e publica um item por execução em
`@boraaalula2026`, respeitando processamento e quota da Meta. Em 14/10/2026, a
conexão foi validada, o card da Farmácia Popular foi publicado e o agendamento foi
ativado. A [primeira execução confirmada](https://github.com/todoscomlula/site/actions/runs/38628789905)
registra a publicação e o checkpoint persistente.

A [configuração e operação](docs/instagram-publishing.md) descreve a conexão da
conta profissional, os Secrets protegidos e a simulação disponível no Actions.
O build prepara as 11 imagens atuais em JPEG para a API, preservando os originais.
As próximas legendas incluem até cinco hashtags por assunto e uma chamada para
seguir a conta. O modo manual `publish_all=true`, com `dry_run=false`, permite
consumir todo o acervo pendente respeitando a quota e o histórico de publicações.

## Atualizar pelo StoriesIG

O coletor usa Playwright e o formulário público do serviço, com o caminho
de download padrão pelo navegador. Requer Chrome e FFmpeg disponíveis na máquina.
Não necessita de credenciais do Instagram ou de chave da API do serviço.

```sh
npm run scrape:storiesig
npm run build
```

Para buscar um Reel recente ainda ausente por perfil, sem repetir cópias do mesmo
vídeo, use `npm run scrape:storiesig:update`. A coleta incremental examina até seis
Reels por fonte, usa os horários relativos informados pelo serviço para uma janela
de até 14 dias e mantém o limite acumulado de 85 MiB. Não converte esses rótulos em
datas de publicação. As últimas adições ao acervo aparecem primeiro nas galerias.

Por padrão, coleta até uma postagem e um Reel por perfil, aguarda cinco
segundos entre fontes e limita a mídia pública a 85 MiB. Preserva importações
anteriores e registra falhas em `data/storiesig-import-report.json`.
O relatório e os originais em `.cache/` ficam fora do Git. O scraper depende
da disponibilidade e do fluxo público atual do serviço.

```sh
npm run scrape:storiesig -- --source lulaoficial
```

## Coleta direta alternativa

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-scraper.txt
npm run scrape:instagram
```

Instaloader coleta posts e Reels públicos com limites e deduplicação. Se o
Instagram restringir acesso anônimo, o coletor mantém o feed anterior e registra
o resultado em `data/instagram-import-report.json`; o bloqueio não indica
ausência de conteúdo.

## Publicação e escala

```sh
npx vercel@64.0.2 --prod --yes
```

Use a cópia local que contém as mídias importadas. Esses arquivos não são
versionados no Git. O passo `prebuild` verifica os arquivos locais e restaura
os que faltarem a partir do deployment público existente. Novos conteúdos
devem ser publicados primeiro pela cópia local que contém os downloads.
O scraper não roda no build nem a cada visita.

Veja a [análise da referência](docs/reverse-engineering.md), a
[operação e dimensionamento para alto tráfego](docs/scaling.md) e os
[créditos dos assets](docs/asset-credits.md). Capacidade para milhões depende
do plano de CDN, do pico de tráfego e da distribuição de vídeos.

## Credenciais e instruções locais

Este repositório é público. Use variáveis privadas e arquivos locais ignorados,
como `.env.local`, para credenciais. `PUBLIC_*` entra no conteúdo público e deve
conter apenas valores públicos, como `PUBLIC_SITE_URL`.
Antes de commit, push e publicação, execute Gitleaks com `--redact`.

Os hooks em `.githooks/` verificam commits e pushes. Nesta cópia, Gitleaks está
instalado apenas em `.git/tools/gitleaks`. Em novos clones, disponibilize o
executável e ative os hooks com `git config --local core.hooksPath .githooks`.

A skill [reverse-engineer-anything](.agents/skills/reverse-engineer-anything/SKILL.md)
permanece restrita ao projeto, com a [licença MIT](.agents/skills/reverse-engineer-anything/LICENSE).
