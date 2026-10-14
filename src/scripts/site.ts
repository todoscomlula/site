type Content = {
  id: string; title: string; excerpt: string; kind: string; source: string;
  sourceName: string; sourceUrl: string; permalink: string | null; imageUrl: string;
  mediaUrl: string | null; downloadUrl: string | null;
};

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const toast = $('#toast');
let toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}

const menuToggle = $<HTMLButtonElement>('.menu-toggle');
menuToggle?.addEventListener('click', () => {
  const opened = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(opened));
  menuToggle.setAttribute('aria-label', opened ? 'Fechar menu' : 'Abrir menu');
  $('#main-nav')?.classList.toggle('open', opened);
});
$('#main-nav')?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  menuToggle?.setAttribute('aria-expanded', 'false');
  $('#main-nav')?.classList.remove('open');
}));

const normalize = (text: string) => text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
document.querySelectorAll<HTMLElement>('[data-gallery]').forEach((gallery) => {
  const filters = [...gallery.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  const items = [...gallery.querySelectorAll<HTMLElement>('[data-post]')];
  const search = gallery.querySelector<HTMLInputElement>('[data-search-input]');
  const params = new URLSearchParams(location.search);
  let category = filters.some((filter) => filter.dataset.filter === params.get('tema')) ? params.get('tema')! : 'all';
  let source = params.get('fonte');
  function update() {
    const query = normalize(search?.value || '');
    let count = 0;
    for (const item of items) {
      const visible = (category === 'all' || item.dataset.category === category)
        && (!source || item.dataset.source === source)
        && normalize(item.dataset.search || '').includes(query);
      item.hidden = !visible;
      if (visible) count++;
    }
    filters.forEach((filter) => {
      const selected = filter.dataset.filter === category;
      filter.classList.toggle('active', selected);
      filter.setAttribute('aria-pressed', String(selected));
    });
    const countLabel = gallery.querySelector<HTMLElement>('[data-gallery-count]');
    if (countLabel) countLabel.textContent = `${count} ${count === 1 ? 'conteúdo' : 'conteúdos'}`;
    const empty = gallery.querySelector<HTMLElement>('[data-gallery-empty]');
    if (empty) empty.hidden = count > 0;
  }
  filters.forEach((filter) => filter.addEventListener('click', () => { category = filter.dataset.filter || 'all'; update(); }));
  search?.addEventListener('input', update);
  gallery.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
    category = 'all';
    source = null;
    if (search) search.value = '';
    const clean = new URL(location.href);
    clean.searchParams.delete('tema');
    clean.searchParams.delete('fonte');
    history.replaceState({}, '', clean);
    update();
    search?.focus();
  });
  update();
});

const data = $('#post-data')?.getAttribute('data-posts') || '[]';
const posts = new Map((JSON.parse(data) as Content[]).map((post) => [post.id, post]));
const dialog = $<HTMLDialogElement>('#share-dialog');
let activePost: Content | null = null;
let opener: HTMLElement | null = null;
let preparedFile: File | null = null;
let preparationController: AbortController | null = null;
let sharing = false;
let shareSession = 0;
const sharingInstructions = 'No celular, escolha WhatsApp, Instagram, TikTok ou outro aplicativo no menu de compartilhamento. Você também pode baixar o arquivo e publicar pelo seu app.';
function resetFileShare() {
  shareSession++;
  preparationController?.abort();
  preparationController = null;
  preparedFile = null;
  sharing = false;
}
function shareButtonsBusy(busy: boolean) {
  document.querySelectorAll<HTMLButtonElement>('#dialog-whatsapp, #dialog-native-share').forEach((button) => {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  });
}
const publicOrigin = new URL($<HTMLLinkElement>('link[rel="canonical"]')?.href || location.origin).origin;
const contentUrl = (post: Content) => new URL(`/conteudo/${encodeURIComponent(post.id)}/`, publicOrigin).href;
function setText(selector: string, value: string) { const element = $(selector); if (element) element.textContent = value; }
function openPost(post: Content, trigger: HTMLElement) {
  if (!dialog) return;
  resetFileShare();
  shareButtonsBusy(false);
  opener = trigger;
  activePost = post;
  const media = $('#dialog-media')!;
  media.replaceChildren();
  if (post.kind === 'video' && post.mediaUrl) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'none';
    video.poster = post.imageUrl;
    video.src = post.mediaUrl;
    media.append(video);
  } else {
    const image = document.createElement('img');
    image.src = post.imageUrl;
    image.alt = post.title;
    image.width = 1080;
    image.height = 1350;
    media.append(image);
  }
  setText('#dialog-title', post.title);
  setText('#dialog-source', post.source === 'editorial' ? post.sourceName : `@${post.source}`);
  setText('#dialog-description', post.excerpt);
  $<HTMLAnchorElement>('#dialog-original')!.href = post.sourceUrl;
  $<HTMLAnchorElement>('#dialog-detail')!.href = `/conteudo/${encodeURIComponent(post.id)}/`;
  setText('#dialog-whatsapp [data-share-label]', post.downloadUrl ? `Mandar ${post.kind === 'video' ? 'vídeo' : 'card'} no WhatsApp` : 'Mandar link no WhatsApp');
  const download = $<HTMLAnchorElement>('#dialog-download')!;
  download.hidden = !post.downloadUrl;
  if (post.downloadUrl) {
    download.href = post.downloadUrl;
    download.download = post.downloadUrl.split('/').pop() || post.id;
  } else {
    download.removeAttribute('href');
  }
  setText('#dialog-native-share [data-share-label]', post.downloadUrl ? 'Compartilhar no Instagram / TikTok' : 'Compartilhar link');
  setText('#dialog-sharing-status', sharingInstructions);
  document.body.classList.add('dialog-open');
  dialog.showModal();
}
document.querySelectorAll<HTMLElement>('[data-open-post]').forEach((trigger) => trigger.addEventListener('click', (event) => {
  const post = posts.get(trigger.dataset.openPost || '');
  if (!post) return;
  event.preventDefault();
  openPost(post, trigger);
}));
$('.dialog-close')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
dialog?.addEventListener('close', () => {
  resetFileShare();
  $('#dialog-media')?.querySelector('video')?.pause();
  $('#dialog-media')?.replaceChildren();
  document.body.classList.remove('dialog-open');
  activePost = null;
  opener?.focus();
});

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Link copiado. Bora compartilhar!');
  } catch {
    notify('Não foi possível copiar. Abra a página do conteúdo e copie o endereço.');
  }
}
$('#dialog-copy')?.addEventListener('click', () => { if (activePost) void copy(contentUrl(activePost)); });
type ShareTarget = 'whatsapp' | 'native';
function downloadForSharing(post: Content, target: ShareTarget) {
  $<HTMLAnchorElement>('#dialog-download')?.click();
  const message = `Este navegador não envia arquivos diretamente. Baixe o ${post.kind === 'video' ? 'vídeo' : 'card'} e anexe ${target === 'whatsapp' ? 'no WhatsApp' : 'no aplicativo escolhido'}.`;
  setText('#dialog-sharing-status', message);
  notify(message);
}
function askToSendPreparedFile(post: Content, target: ShareTarget) {
  const message = `${post.kind === 'video' ? 'Vídeo' : 'Card'} pronto. Toque novamente em ${target === 'whatsapp' ? 'Mandar no WhatsApp' : 'Compartilhar no Instagram / TikTok'} para abrir o menu e escolher o aplicativo.`;
  setText('#dialog-sharing-status', message);
  notify(message);
}
async function shareContent(target: ShareTarget) {
  const post = activePost;
  if (!post || sharing) return;
  const session = shareSession;
  sharing = true;
  shareButtonsBusy(true);
  try {
    if (!post.downloadUrl) {
      if (target === 'whatsapp') {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${post.title}\n${contentUrl(post)}`)}`, '_blank', 'noopener,noreferrer');
      } else if (navigator.share) {
        await navigator.share({ title: post.title, url: contentUrl(post) });
      } else {
        await copy(contentUrl(post));
      }
      return;
    }
    const filename = post.downloadUrl.split('/').pop() || `${post.id}.${post.kind === 'video' ? 'mp4' : 'png'}`;
    const mimeTypes: Record<string, string> = { mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    const mimeType = mimeTypes[filename.split('.').pop()?.toLowerCase() || ''];
    const probe = preparedFile || new File([], filename, { type: mimeType });
    if (!navigator.share || !navigator.canShare?.({ files: [probe] })) {
      downloadForSharing(post, target);
      return;
    }
    if (!preparedFile) {
      setText('#dialog-sharing-status', `Preparando ${post.kind === 'video' ? 'vídeo' : 'card'} para enviar…`);
      preparationController = new AbortController();
      const response = await fetch(post.downloadUrl, { signal: preparationController.signal });
      if (!response.ok) throw new Error('Media unavailable');
      const blob = await response.blob();
      if (shareSession !== session) return;
      if (!blob.size || blob.type.split(';')[0] !== mimeType) throw new Error('Invalid media');
      preparedFile = new File([blob], filename, { type: mimeType });
      if (!navigator.canShare({ files: [preparedFile] })) {
        downloadForSharing(post, target);
        return;
      }
      // Downloading can outlive the browser's click permission. Keep the file
      // ready and use the next click to open the native menu without another fetch.
      if (navigator.userActivation?.isActive === false) {
        askToSendPreparedFile(post, target);
        return;
      }
    }
    setText('#dialog-sharing-status', `Escolha ${target === 'whatsapp' ? 'WhatsApp' : 'o aplicativo'} no menu para enviar o arquivo.`);
    await navigator.share({ files: [preparedFile] });
  } catch (error) {
    if (shareSession !== session) return;
    const errorName = error instanceof Error || error instanceof DOMException ? error.name : '';
    if (errorName === 'AbortError') {
      setText('#dialog-sharing-status', sharingInstructions);
    } else if (preparedFile && errorName === 'NotAllowedError') {
      askToSendPreparedFile(post, target);
    } else {
      const message = 'Não foi possível enviar o arquivo. Tente novamente ou use Baixar para publicar e anexe no aplicativo.';
      setText('#dialog-sharing-status', message);
      notify(message);
    }
  } finally {
    if (shareSession === session) {
      sharing = false;
      shareButtonsBusy(false);
      preparationController = null;
    }
  }
}
$('#dialog-whatsapp')?.addEventListener('click', () => { void shareContent('whatsapp'); });
$('#dialog-native-share')?.addEventListener('click', () => { void shareContent('native'); });
document.querySelectorAll('[data-share-site]').forEach((trigger) => trigger.addEventListener('click', () => {
  const url = new URL('/', publicOrigin).href;
  window.open(`https://wa.me/?text=${encodeURIComponent(`Todos com Lula: informação para compartilhar.\n${url}`)}`, '_blank', 'noopener,noreferrer');
}));

type Preferences = { scale: number; contrast: boolean; motion: boolean };
const defaults: Preferences = { scale: 1, contrast: false, motion: false };
let preferences = { ...defaults };
try {
  const stored = JSON.parse(localStorage.getItem('todos-com-lula-accessibility') || 'null');
  if (stored) preferences = { scale: Math.max(.9, Math.min(1.3, Number(stored.scale) || 1)), contrast: stored.contrast === true, motion: stored.motion === true };
} catch { /* Browser storage is optional. */ }
function applyPreferences() {
  document.documentElement.style.setProperty('--font-scale', String(preferences.scale));
  document.documentElement.classList.toggle('high-contrast', preferences.contrast);
  document.documentElement.classList.toggle('reduce-motion', preferences.motion);
  const contrast = $<HTMLInputElement>('#high-contrast');
  const motion = $<HTMLInputElement>('#reduce-motion');
  if (contrast) contrast.checked = preferences.contrast;
  if (motion) motion.checked = preferences.motion;
  try { localStorage.setItem('todos-com-lula-accessibility', JSON.stringify(preferences)); } catch { /* No persistence is required. */ }
}
applyPreferences();
$('.accessibility-trigger')?.addEventListener('click', () => {
  const panel = $('#accessibility-panel')!;
  panel.hidden = !panel.hidden;
  $('.accessibility-trigger')?.setAttribute('aria-expanded', String(!panel.hidden));
});
document.querySelectorAll<HTMLElement>('[data-font]').forEach((button) => button.addEventListener('click', () => {
  preferences.scale = Math.max(.9, Math.min(1.3, preferences.scale + (button.dataset.font === 'increase' ? .1 : -.1)));
  applyPreferences();
}));
$<HTMLInputElement>('#high-contrast')?.addEventListener('change', (event) => { preferences.contrast = (event.target as HTMLInputElement).checked; applyPreferences(); });
$<HTMLInputElement>('#reduce-motion')?.addEventListener('change', (event) => { preferences.motion = (event.target as HTMLInputElement).checked; applyPreferences(); });
$('#reset-accessibility')?.addEventListener('click', () => { preferences = { ...defaults }; applyPreferences(); });
