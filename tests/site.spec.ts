import { expect, test, type Page } from '@playwright/test';

const firstPostId = 'farmacia-popular';
const firstSource = 'https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular';
const visibleCards = (page: Page) => page.locator('[data-gallery] [data-post]:visible');

async function openFirstCard(page: Page) {
  await page.goto('/cards/');
  const trigger = page.locator(`a[data-open-post="${firstPostId}"]`);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Farmácia Popular/ })).toBeVisible();
  return { dialog, trigger };
}

async function canonicalPostUrl(page: Page) {
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toBeTruthy();
  return new URL(`/conteudo/${firstPostId}/`, canonical!).href;
}

test('homepage delivers the portrait and real cards without external startup requests or runtime errors', async ({ page, baseURL }) => {
  const remoteRequests: string[] = [];
  const runtimeErrors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) remoteRequests.push(request.url());
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/TODOS.*COM.*LULA/s);
  const portrait = page.getByRole('img', { name: /Retrato oficial de Luiz Inácio Lula da Silva/ });
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveAttribute('src', '/images/lula-hero.webp');
  await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.locator('#cards [data-post]').count()).toBeGreaterThanOrEqual(6);
  const cardImages = page.locator('#cards [data-post] img');
  for (const image of await cardImages.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await page.waitForLoadState('load');
  expect(remoteRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('primary navigation works on desktop and the mobile menu exposes links', async ({ page, isMobile }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
  if (isMobile) {
    const menu = page.locator('.menu-toggle');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAccessibleName('Abrir menu');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(navigation.getByRole('link', { name: 'Cards', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Cards', exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/$/);
  await expect(page.getByRole('searchbox', { name: 'Buscar cards' })).toBeVisible();
  expect(await visibleCards(page).count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('[data-gallery] [data-post][data-source="editorial"]')).toHaveCount(6);
});

test('topic URLs, search, empty state and clear filters update the gallery', async ({ page }) => {
  await page.goto('/cards/?tema=saude');
  await expect(visibleCards(page)).toHaveCount(1);
  await expect(visibleCards(page).getByRole('heading')).toHaveText(/Farmácia Popular/);
  await expect(page.getByRole('button', { name: 'Saúde', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  const totalCards = await page.locator('[data-gallery] [data-post]').count();
  expect(totalCards).toBeGreaterThanOrEqual(6);
  await expect(visibleCards(page)).toHaveCount(totalCards);
  const search = page.getByRole('searchbox', { name: 'Buscar cards' });
  await search.fill('Pé-de-Meia: apoio à permanência no ensino médio');
  await expect(visibleCards(page).filter({ has: page.locator('[data-open-post="pe-de-meia"]') })).toHaveCount(1);
  await expect(visibleCards(page)).toHaveCount(1);

  await search.fill('assunto inexistente xyz987');
  await expect(visibleCards(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vamos tentar outra busca?' })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(visibleCards(page)).toHaveCount(totalCards);
  await expect(page.getByRole('heading', { name: 'Vamos tentar outra busca?' })).toBeHidden();
});

test('card sharing uses the canonical link and a valid local PNG, then Escape restores focus', async ({ page }) => {
  const { dialog, trigger } = await openFirstCard(page);
  const expectedLink = await canonicalPostUrl(page);
  await expect(dialog.locator('#dialog-original')).toHaveAttribute('href', firstSource);
  await expect(dialog.locator('#dialog-detail')).toHaveAttribute('href', `/conteudo/${firstPostId}/`);

  const whatsappHref = await dialog.locator('#dialog-whatsapp').getAttribute('href');
  const whatsapp = new URL(whatsappHref!);
  expect(whatsapp.origin).toBe('https://wa.me');
  expect(whatsapp.searchParams.get('text')).toContain(expectedLink);
  expect(whatsappHref).toContain('text=');
  expect(whatsappHref).toMatch(/%3A%2F%2F/i);

  const download = dialog.getByRole('link', { name: 'Baixar para publicar' });
  await expect(download).toHaveAttribute('href', '/cards/farmacia-popular.png');
  await expect(download).toHaveAttribute('download', /./);
  const response = await page.request.get((await download.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^image\/png\b/);
  expect((await response.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('copy link writes the public content URL without needing OS clipboard permission', async ({ page }) => {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, '__copiedLinks', { value: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { copied.push(value); } },
    });
  });
  const { dialog } = await openFirstCard(page);
  const expectedLink = await canonicalPostUrl(page);
  await dialog.getByRole('button', { name: 'Copiar link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __copiedLinks: string[] }).__copiedLinks)).toEqual([expectedLink]);
  await expect(page.getByRole('status')).toContainText(/copiado/i);
});

test('content deep link presents its source and downloadable file directly', async ({ page }) => {
  const response = await page.goto(`/conteudo/${firstPostId}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Farmácia Popular/);
  const source = page.getByRole('link', { name: 'Consultar fonte original' });
  await expect(source).toHaveAttribute('href', firstSource);
  await expect(source).toHaveAttribute('rel', /noopener/);
  await expect(page.getByRole('link', { name: 'Baixar card', exact: true })).toHaveAttribute('href', '/cards/farmacia-popular.png');
  await page.getByRole('button', { name: 'Compartilhar este conteúdo' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('real videos show local posters and attribution while MP4 stays unloaded before playback', async ({ page }) => {
  const mp4Requests: string[] = [];
  page.on('request', (request) => {
    if (/\.mp4$/i.test(new URL(request.url()).pathname)) mp4Requests.push(request.url());
  });
  await page.goto('/videos/');
  const firstVideo = page.locator('[data-gallery] [data-post][data-kind="video"]').first();
  await expect(firstVideo).toBeVisible();
  const author = await firstVideo.getAttribute('data-source');
  expect(author).toMatch(/^[a-z0-9_.]+$/);
  await expect(firstVideo.locator('.post-source')).toHaveText(`@${author}`);
  const poster = firstVideo.getByRole('img');
  await expect(poster).toHaveAttribute('src', /^\/media\/instagram\/[a-z0-9_.]+\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/);
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.waitForLoadState('networkidle');
  expect(mp4Requests).toEqual([]);

  await firstVideo.locator('a[data-open-post]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#dialog-source')).toHaveText(`@${author}`);
  const sourceUrl = new URL((await dialog.locator('#dialog-original').getAttribute('href'))!);
  expect(sourceUrl.origin).toBe('https://www.instagram.com');
  expect(sourceUrl.search).toBe('');
  const video = dialog.locator('video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('src', /^\/media\/instagram\/[a-z0-9_.]+\/[A-Za-z0-9_-]+\.mp4$/);
  await expect(video).toHaveAttribute('poster', (await poster.getAttribute('src'))!);
  await page.waitForLoadState('networkidle');
  expect(mp4Requests).toEqual([]);
});

test('a real video download returns MP4 headers and a byte-range response without fetching the full file', async ({ page }) => {
  await page.goto('/videos/');
  const firstVideo = page.locator('[data-gallery] [data-post][data-kind="video"]').first();
  await expect(firstVideo).toBeVisible();
  await firstVideo.locator('a[data-open-post]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const download = dialog.getByRole('link', { name: 'Baixar para publicar' });
  const href = (await download.getAttribute('href'))!;
  expect(href).toMatch(/^\/media\/instagram\/[a-z0-9_.]+\/[A-Za-z0-9_-]+\.mp4$/);
  await expect(download).toHaveAttribute('download', /\.mp4$/);
  const headers = await page.request.head(href);
  expect(headers.status()).toBe(200);
  expect(headers.headers()['content-type']).toMatch(/^video\/mp4\b/);
  expect(Number(headers.headers()['content-length'])).toBeGreaterThan(32);

  const prefixResponse = await page.request.get(href, { headers: { Range: 'bytes=0-31' } });
  expect(prefixResponse.status()).toBe(206);
  expect(prefixResponse.headers()['content-type']).toMatch(/^video\/mp4\b/);
  expect(prefixResponse.headers()['content-range']).toMatch(/^bytes 0-31\/\d+$/);
  const prefix = await prefixResponse.body();
  expect(prefix.length).toBe(32);
  expect(prefix.subarray(4, 8).toString('ascii')).toBe('ftyp');
});

test('the source directory contains all fifteen profiles and opens the chosen canonical profile', async ({ page, context }) => {
  await context.route('https://www.instagram.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Fonte de teste</title><p>Destino público verificado.</p>',
  }));
  await page.goto('/fontes/');
  const followLinks = page.getByRole('link', { name: /Acompanhar/ });
  await expect(followLinks).toHaveCount(15);
  for (const link of await followLinks.all()) {
    const url = new URL((await link.getAttribute('href'))!);
    expect(url.origin).toBe('https://www.instagram.com');
    expect(url.pathname).toMatch(/^\/[a-z0-9_.]+\/$/);
    expect(url.search).toBe('');
    await expect(link).toHaveAttribute('rel', /noopener/);
  }
  const lula = page.locator('.source-profile').filter({ hasText: '@lulaoficial' }).getByRole('link', { name: /Acompanhar/ });
  const [popup] = await Promise.all([page.waitForEvent('popup'), lula.click()]);
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup).toHaveURL('https://www.instagram.com/lulaoficial/');
  await popup.close();
});

test('accessibility choices survive reload and can be restored to defaults', async ({ page }) => {
  await page.goto('/');
  const openPanel = page.getByRole('button', { name: 'Opções de acessibilidade', exact: true });
  await openPanel.click();
  const panel = page.getByRole('region', { name: 'Opções de acessibilidade' });
  await expect(panel).toBeVisible();
  const contrast = panel.getByRole('checkbox', { name: 'Alto contraste' });
  const motion = panel.getByRole('checkbox', { name: 'Reduzir movimento' });
  await contrast.check();
  await motion.check();
  expect(await page.evaluate(() => localStorage.length)).toBeGreaterThan(0);

  await page.reload();
  await openPanel.click();
  await expect(contrast).toBeChecked();
  await expect(motion).toBeChecked();
  await panel.getByRole('button', { name: 'Restaurar preferências' }).click();
  await expect(contrast).not.toBeChecked();
  await expect(motion).not.toBeChecked();
  await page.reload();
  await openPanel.click();
  await expect(contrast).not.toBeChecked();
  await expect(motion).not.toBeChecked();
});
