import type { ImageMetadata } from 'astro';
import perfil from '../assets/desmantelando/01-perfil-nikolas.png';
import cadastro from '../assets/desmantelando/02-cadastro.png';
import movimento from '../assets/desmantelando/03-movimento.png';
import canal from '../assets/desmantelando/04-canal-nikolas.png';
import convite from '../assets/desmantelando/05-convite-tropa.png';
import tropa from '../assets/desmantelando/06-canal-tropa.png';
import impressao from '../assets/desmantelando/07-convite-impressao.png';
import cartazes from '../assets/desmantelando/08-cartazes.png';
import site from '../assets/desmantelando/09-site-flavio.png';
import assuntos from '../assets/desmantelando/10-assuntos.png';
import player from '../assets/desmantelando/11-player-compartilhamento.png';
import arquivo from '../assets/desmantelando/12-video-whatsapp.png';
import religiao from '../assets/desmantelando/13-tema-religiao.png';

export interface EvidenceRecord {
  number: string;
  image: ImageMetadata;
  title: string;
  caption: string;
  alt: string;
}

export const evidence = {
  perfil: { number: '01', image: perfil, title: 'O ponto de partida', caption: 'O perfil de Nikolas Ferreira no Instagram exibe um link para o site do movimento.', alt: 'Perfil de Nikolas Ferreira no Instagram com o endereço movimentonikolasferreira.com na bio.' },
  cadastro: { number: '02', image: cadastro, title: 'Seu telefone entra no percurso', caption: 'O formulário solicita nome, WhatsApp e autorização para comunicações que incluem outros candidatos do PL. Há uma caixa de consentimento desmarcada e um botão para fechar.', alt: 'Formulário sobreposto à página do movimento, com campos de nome e WhatsApp, texto de consentimento, botão verde de cadastro e controle para fechar.' },
  movimento: { number: '03', image: movimento, title: 'A página por trás do cadastro', caption: 'A apresentação do movimento usa um convite à mobilização e uma imagem de Nikolas diante de uma manifestação.', alt: 'Página de apresentação do movimento de Nikolas Ferreira, com slogan e fotografia de uma manifestação.' },
  canal: { number: '04', image: canal, title: 'A chegada ao WhatsApp', caption: 'A captura registra a abertura do canal que se apresenta como oficial de Nikolas. Essa etapa foi fornecida pelo autor das imagens; o cadastro não foi reproduzido pelo projeto.', alt: 'Página pública do canal Nikolas Ferreira — Oficial, com solicitação do navegador para abrir o WhatsApp.' },
  convite: { number: '05', image: convite, title: 'Um canal promove outro', caption: 'No canal de Nikolas, uma mensagem fixada e uma publicação convidam a seguir a Tropa do Flávio. A interface identifica o destino como canal.', alt: 'Canal de Nikolas no WhatsApp com convite e link para o canal Tropa do Flávio.' },
  tropa: { number: '06', image: tropa, title: 'O convite é ampliar a audiência', caption: 'A Tropa do Flávio pede o envio do link aos contatos. O total de 1,8 milhão aparece na interface dessa captura e não representa uma medição independente de alcance.', alt: 'Canal Tropa do Flávio exibindo 1,8 milhão de seguidores e mensagem para encaminhar o endereço do canal aos contatos.' },
  impressao: { number: '07', image: impressao, title: 'A distribuição também pode virar papel', caption: 'Uma mensagem oferece um PDF de cartazes e pede que sejam impressos e espalhados. A captura documenta o convite, sem comprovar quantas impressões ocorreram.', alt: 'Mensagem no canal de Nikolas com link para um PDF de cartazes e convite à impressão e distribuição.' },
  cartazes: { number: '08', image: cartazes, title: 'O material oferecido para impressão', caption: 'O visualizador mostra peças de ataque a Lula. A imagem é apresentada como registro de propaganda; as alegações de cada cartaz não foram verificadas nesta análise.', alt: 'Visualizador de um PDF com nove páginas de cartazes políticos, incluindo peças de ataque a Lula.' },
  site: { number: '09', image: site, title: 'Uma vitrine para fazer circular', caption: 'O site Flávio com a Verdade oferece cards, vídeos e chamadas para compartilhamento. O percurso entre o canal e esse site foi informado pelo autor das capturas; o clique de saída não está registrado no lote.', alt: 'Página inicial do site Flávio com a Verdade, com retrato de Flávio Bolsonaro e chamadas para cards e envio pelo WhatsApp.' },
  assuntos: { number: '10', image: assuntos, title: 'A vitrine se organiza por assunto', caption: 'A página reúne temas, declarações e promessas políticas. Esse recorte não permite concluir que o site inteiro esteja sem propostas ou sem plano de governo.', alt: 'Lista de assuntos do site de Flávio, com temas como Bolsa Família, aposentadoria, SUS e salário mínimo.' },
  player: { number: '11', image: player, title: 'O arquivo fica a poucos toques', caption: 'O player exibe ações de WhatsApp, compartilhamento, download e cópia de link. A disponibilidade de cada forma de envio depende do aparelho e do navegador.', alt: 'Player de um vídeo de Flávio com botões de WhatsApp, compartilhar, download e copiar link.' },
  arquivo: { number: '12', image: arquivo, title: 'O vídeo aparece dentro da conversa', caption: 'Outro registro mostra um vídeo sobre mães atípicas como mídia no WhatsApp, acompanhado de legenda e link. As duas capturas exibem peças diferentes e não constituem uma comparação dos arquivos byte a byte.', alt: 'Mensagem no WhatsApp com vídeo de Flávio sobre mães atípicas anexado como mídia, legenda e endereço de origem.' },
  religiao: { number: '13', image: religiao, title: 'Uma página de tema político', caption: 'Exemplo de página sobre Nossa Senhora Aparecida. A reprodução documenta a apresentação do site e não funciona como checagem da afirmação exibida.', alt: 'Página temática do site de Flávio sobre Nossa Senhora Aparecida, com texto de defesa do candidato e retrato.' },
} satisfies Record<string, EvidenceRecord>;

export const sources = {
  movimento: 'https://movimentonikolasferreira.com/',
  flavio: 'https://flaviocomaverdade.com.br/',
  video: 'https://flaviocomaverdade.com.br/videos/maes-atipicas',
  whatsapp: 'https://www.whatsapp.com/legal/statusandchannels-privacy-policy',
  tse: 'https://www.tse.jus.br/legislacao/compilada/res/2019/resolucao-no-23-610-de-18-de-dezembro-de-2019',
  darkPatternsGray: 'https://doi.org/10.1145/3173574.3174108',
  darkPatternsScale: 'https://arxiv.org/abs/1907.07032',
  darkPatternsNorms: 'https://arxiv.org/abs/2101.04843',
  deceptiveDesign: 'https://deceptive.design/types/forced-action/',
  webShare: 'https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share',
};
