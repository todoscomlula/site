# Publicação local no Instagram

Crie a legenda em um arquivo local e execute:

```sh
npm run instagram:post -- --image caminho/card.jpg --caption-file caminho/legenda.txt --id identificador-unico --publish
```

O script prepara a imagem, verifica segredos com Gitleaks e publica diretamente
na conta `boraaalula2026`. Não altera o site nem executa deploy na Vercel.
A imagem fica na branch pública `instagram-media` deste repositório, pois o Instagram precisa
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
# Carrossel local

Repita `--image` na ordem das lâminas para preparar um único carrossel de 2 a
10 imagens. Uma imagem continua criando uma publicação simples.

```sh
npm run instagram:post -- --image capa.jpg --image checagem-1.jpg --image fontes.jpg --caption-file legenda.txt --id compilado-unico --publish
```

O envio verifica os arquivos, cria os contêineres das lâminas e publica somente
o contêiner pai. Os identificadores são registrados a cada etapa para retomar
interrupções sem duplicar lâminas ou repetir uma publicação de resultado incerto.
