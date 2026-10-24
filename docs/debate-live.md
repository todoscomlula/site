# Coleta local do debate

```sh
npm run debate:scrape
npm run debate:scrape -- --watch-minutes 15 --interval-seconds 30
```

O coletor lê as três fontes indicadas pelo responsável:
g1, Radar da Eleição/UOL e checagemaovivo.org. Descobre o feed público do g1 pelo navegador na primeira
consulta e utiliza esse feed nas consultas seguintes. O UOL é extraído da página
pública. Respostas de bloqueio são registradas como bloqueio, sem contornar
login, CAPTCHA ou outras restrições.

O Checagem Ao Vivo é consultado pelo manifesto público e seus blocos de dados.
Cada item preserva o veredito, as fontes e a indicação de revisão automática ou
humana. A própria página avisa que as análises por IA são preliminares. A coleta
mantém essa distinção para a revisão antes de publicar.

O resultado fica em `.cache/debate-live/latest.json`; a fila deduplicada, em
`queue.json`. Cada entrada preserva a fonte, o identificador, o horário quando
fornecido e a necessidade de revisão. Notícias, falas de candidatos e opiniões
não recebem automaticamente um veredito de fake news. Somente entradas que a
própria fonte apresenta como checagem são separadas como `factcheck`.

As publicações anteriores podem ser associadas ao ID da entrada em
`.cache/debate-live/publications.json`, evitando preparar novamente o mesmo tema.
Uma mudança no texto da fonte continua indicada para revisão.

## Cards com layouts alternados

```sh
npm run debate:card -- caminho/dados.json caminho/card.jpg auto
```

O arquivo de dados usa `headline`, `kicker`, `source` e dois `items`, cada um com
`label` e `text`. Os layouts alternam entre linha do tempo escura, composição
clara e composição editorial vermelha. O crédito e a indicação de iniciativa
independente ficam visíveis. Também é possível selecionar `timeline-dark`,
`comparison-light` ou `editorial-red` explicitamente.

Para uma fala falsa, informe `"verdict": "FAKE"` nos dados do card. A chamada
**É FAKE! MENTIU DE NOVO!** aparece em tamanho grande. Classificações como
enganoso, parcial ou inconclusivo conservam seu veredito e não recebem essa chamada.

Publique a arte e a legenda pelo comando local descrito em
[Publicação local no Instagram](instagram-direct.md). O coletor não publica
matérias ou alegações automaticamente.
