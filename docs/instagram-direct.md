# Publicação local no Instagram

Crie a legenda em um arquivo local e execute:

```sh
npm run instagram:post -- --image caminho/card.jpg --caption-file caminho/legenda.txt --id identificador-unico --publish
```

O script prepara a imagem, verifica segredos com Gitleaks e publica diretamente
na conta `boraaalula2026`. Não altera o site nem executa deploy na Vercel.
A imagem fica em um release público deste repositório, pois o Instagram precisa
baixá-la por HTTPS. A legenda e as credenciais permanecem locais.

Na primeira conexão, GitHub Actions entrega a credencial existente ao computador
com criptografia de ponta a ponta, por um túnel temporário. Ela é validada para
a conta esperada e salva somente em `.cache/instagram-direct/credentials.json`,
ignorado pelo Git e com permissão `600`. O túnel é encerrado em seguida.
É necessário ter `gh` autenticado, `cloudflared` instalado e as dependências do
projeto disponíveis. As próximas publicações não repetem essa conexão.

Para usar um manifesto já preparado:

```sh
npm run instagram:direct -- --publish .cache/instagram-direct/prepare-identificador-unico/post.json
```

O histórico continua na branch `instagram-manual-state`. Uma operação incerta
não é reenviada automaticamente; repetir o mesmo identificador preserva a prova
da publicação anterior.
