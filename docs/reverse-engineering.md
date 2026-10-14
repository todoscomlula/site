# Referência de interface e engenharia reversa

Observação em 14 de outubro de 2026. A referência analisada foi o frontend público de [flaviocomaverdade.com.br](https://flaviocomaverdade.com.br/), incluindo HTML, CSS, JavaScript, headers HTTP, um card, um vídeo e uma página de assunto.

A skill local REA orientou a distinção entre observação, inferência e desconhecido. A aquisição foi feita com HTTP e Chrome headless existentes, sem servidor REA conectado; este relatório não possui Evidence IDs do REA. Os snapshots de trabalho ficaram em `/tmp/lula-reference/` e não são artefatos permanentes do repositório. Nenhuma sessão autenticada, credencial ou configuração global foi utilizada.

## Sistema visual observado

O [CSS principal](https://flaviocomaverdade.com.br/css/flavio-com-a-verdade.css?v=20261011_03) declara fundo claro `#F7F9FC`, tinta `#111417`, azul `#005BAA`, amarelo `#FFCB05` e verde `#12B24B`. Usa bordas de 3px, cantos de aproximadamente 12–20px, sombras sólidas deslocadas e elementos ligeiramente inclinados. O container tem máximo de 1680px e margem lateral `clamp(18px, 5vw, 110px)`.

A fonte é Urbanist variável. As declarações chamadas “Gotham” apontam para os mesmos arquivos Urbanist, conforme o [CSS de fontes](https://flaviocomaverdade.com.br/css/gotham.css?v=20261009). Títulos usam peso 900, itálico, caixa alta e espaçamento negativo. As linhas principais do hero usam `clamp(3.6rem, 11vw, 10.5rem)`; a intermediária usa `clamp(2.6rem, 7.8vw, 7.4rem)`.

O screenshot desktop de 1440×1000 confirmou cabeçalho verde fixado durante a rolagem, hero em duas colunas, retrato recortado sobre painéis inclinados, tipografia muito grande, fundo pontilhado e faixa horizontal abaixo. As medidas de CSS são declarações públicas, não uma auditoria completa de estilos computados.

## Organização e comportamento

| Elemento | Evidência pública | Comportamento observado no artefato |
| --- | --- | --- |
| Cabeçalho e hero | [Página inicial](https://flaviocomaverdade.com.br/) | Logo, navegação, compartilhamento, hero `1.15fr / .85fr`, fotografia e formas decorativas |
| Assuntos | [Assuntos](https://flaviocomaverdade.com.br/assuntos), [detalhe](https://flaviocomaverdade.com.br/sus) | Pills numeradas; cards explicativos; detalhe com breadcrumbs, texto, fontes e conteúdos relacionados |
| Cards | [Galeria](https://flaviocomaverdade.com.br/cards), [card](https://flaviocomaverdade.com.br/cards/pix) | Peças 4:5, miniaturas WebP, filtros por assunto e links permanentes |
| Vídeos | [Galeria](https://flaviocomaverdade.com.br/videos), [vídeo](https://flaviocomaverdade.com.br/videos/maes-atipicas) | Capas 9:16, duração, player, download e compartilhamento |
| Modal | Script inline da [página inicial](https://flaviocomaverdade.com.br/) | WhatsApp, Web Share, download, clipboard, Escape, retorno de foco e contenção do Tab |
| Acessibilidade | [Script público](https://flaviocomaverdade.com.br/js/accessibility.js) | Texto, espaçamento, contraste, pausa de animações e preferências em `localStorage` |

O HTML mantém links para as páginas de cada peça mesmo quando o JavaScript intercepta o clique e abre um modal. As galerias apresentam arrasto, setas e rolagem. A composição da homepage alterna blocos claros, amarelos, azuis e verdes; os cabeçalhos das galerias incluem três capas dispostas em leque.

As media queries do CSS trocam o menu por hamburger abaixo de 980px, empilham o hero abaixo de 900px e os cabeçalhos das galerias abaixo de 860px; abaixo de 700px os filtros passam para uma faixa horizontal. Há regras de `prefers-reduced-motion`. A captura mobile pelo CLI sofreu corte por tamanho mínimo da janela; não valida, por si só, o layout em 390px.

## Mídia e infraestrutura observáveis

O [vídeo representativo](https://flaviocomaverdade.com.br/videos/maes-atipicas) declara `controls`, `playsinline`, `preload="none"`, HLS e fallback MP4. Seu [manifesto público](https://flaviocomaverdade.com.br/assets/verdade/videos/maes-atipicas/master.m3u8) lista resoluções 720×1280, 480×854, 360×640 e 240×426. O MP4 de compartilhamento analisado tem cerca de 3,5 MB. Miniaturas e versões maiores têm URLs distintas.

Na amostra HTTP, a homepage retornou `server: cloudflare`, `cf-cache-status: DYNAMIC` e `cache-control: no-cache`. A fotografia, uma miniatura e o MP4 retornaram cache de um ano, suporte a intervalos de bytes e Cloudflare `HIT`. Estes headers são um snapshot, sujeito a mudanças.

O frontend servido contém HTML e vários arquivos CSS/JavaScript imperativo. Não foi identificado bundle React/Next nos arquivos selecionados. Isso não determina a ferramenta de geração do HTML nem a arquitetura do servidor. Código cliente menciona [analytics](https://flaviocomaverdade.com.br/js/analytics-client.js?v=20260904-1), [newsletter](https://flaviocomaverdade.com.br/js/newsletter.js) e [edição CMS](https://flaviocomaverdade.com.br/js/site-cms-runtime.js?v=20260826_01); não houve inspeção de implementações privadas desses serviços.

Permanecem desconhecidos: código de backend, banco de dados, pipeline editorial, origem atrás do CDN, limites operacionais, custos, volume real de tráfego e capacidade sob carga. Cache de mídia não comprova atendimento a milhões de visitantes.

## Aplicação ao Todos com Lula

O projeto adapta composição, hierarquia, navegação por assunto, galerias, detalhes e compartilhamento para uma identidade própria. Não reutiliza marcas, slogans, textos partidários ou retratos da referência. Fontes e imagens deste projeto têm créditos separados em [asset-credits.md](asset-credits.md).

A implementação mantém origem e links das publicações, distingue cards editoriais das postagens importadas e gera páginas estáticas. HLS e transcodificação são uma evolução planejada para o acervo próprio, não uma funcionalidade já entregue. O plano operacional está em [scaling.md](scaling.md).
