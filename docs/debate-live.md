# Coleta local do debate

```sh
npm run debate:scrape
npm run debate:scrape -- --watch-minutes 15 --interval-seconds 30
```

O coletor lê os dois endereços de acompanhamento indicados pelo responsável:
g1 e Radar da Eleição/UOL. Descobre o feed público do g1 pelo navegador na primeira
consulta e utiliza esse feed nas consultas seguintes. O UOL é extraído da página
pública. Respostas de bloqueio são registradas como bloqueio, sem contornar
login, CAPTCHA ou outras restrições.

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

Publique a arte e a legenda pelo comando local descrito em
[Publicação local no Instagram](instagram-direct.md). O coletor não publica
matérias ou alegações automaticamente.
