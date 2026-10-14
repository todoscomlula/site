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
- `src/data/sources.json`: os 15 perfis selecionados.
- `src/data/storiesig-posts.json`: publicações obtidas pelo fluxo público do StoriesIG.
- `src/data/instagram-posts.json`: importações diretas com Instaloader.
- `public/cards/`: PNG para compartilhar e WebP para apresentação.
- `public/media/instagram/`: imagens, vídeos e capas realmente baixados.

Cada conteúdo tem página própria, link da fonte, WhatsApp, download e
compartilhamento nativo de arquivos quando o navegador e os apps oferecem suporte.
Horários relativos não são convertidos em datas inventadas. Quando um permalink
não está disponível, o conteúdo aponta para o perfil de origem.

## Atualizar pelo StoriesIG

O coletor usa Playwright e o formulário público do serviço, com o caminho
de download padrão pelo navegador. Requer Chrome e FFmpeg disponíveis na máquina.
Não necessita de credenciais do Instagram ou de chave da API do serviço.

```sh
npm run scrape:storiesig
npm run build
```

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
