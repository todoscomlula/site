import { expect, test, type Page } from '@playwright/test';

type SharedFile = { name: string; type: string; size: number; prefix: number[] };
type ShareCall = { files: SharedFile[]; url: string | null; text: string | null; activated: boolean };
type ShareWindow = Window & { __shares: ShareCall[] };

async function installShareHarness(page: Page, mode: 'supported' | 'unavailable' | 'text-only' | 'cancel' = 'supported') {
  await page.addInitScript((mode) => {
    const shares: ShareCall[] = [];
    Object.defineProperty(window, '__shares', { value: shares });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => mode !== 'text-only' && Boolean(data.files?.length),
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: mode === 'unavailable' ? undefined : async (data: ShareData) => {
        const activated = navigator.userActivation.isActive;
        const files = await Promise.all((data.files || []).map(async (file) => ({
          name: file.name, type: file.type, size: file.size,
          prefix: [...new Uint8Array(await file.slice(0, 12).arrayBuffer())],
        })));
        shares.push({ files, url: data.url || null, text: data.text || null, activated });
        if (mode === 'cancel') throw new DOMException('Share cancelled', 'AbortError');
      },
    });
  }, mode);
}

const calls = (page: Page) => page.evaluate(() => (window as ShareWindow).__shares);

async function openVideo(page: Page) {
  await page.goto('/videos/');
  await page.locator('[data-gallery] [data-post] a[data-open-post]').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('WhatsApp shares the real MP4 attachment without a site URL or text payload', async ({ page }) => {
  await installShareHarness(page);
  const dialog = await openVideo(page);
  const filename = (await dialog.locator('#dialog-download').getAttribute('download'))!;
  await dialog.getByRole('button', { name: 'Mandar vídeo no WhatsApp' }).click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  const [share] = await calls(page);
  expect(share.url).toBeNull();
  expect(share.text).toBeNull();
  expect(share.activated).toBe(true);
  expect(share.files).toHaveLength(1);
  expect(share.files[0].name).toBe(filename);
  expect(share.files[0].type).toBe('video/mp4');
  expect(share.files[0].size).toBeGreaterThan(32);
  expect(Buffer.from(share.files[0].prefix).subarray(4, 8).toString('ascii')).toBe('ftyp');
  await expect(dialog.locator('#dialog-whatsapp')).toBeEnabled();
});

test('Instagram and TikTok sharing keeps the actual PNG attachment', async ({ page }) => {
  await installShareHarness(page);
  await page.goto('/cards/');
  await page.locator('a[data-open-post="farmacia-popular"]').click();
  await page.locator('#dialog-native-share').click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  const [share] = await calls(page);
  expect(share.url).toBeNull();
  expect(share.files[0].type).toBe('image/png');
  expect(share.files[0].name).toBe('farmacia-popular.png');
  expect(share.files[0].prefix.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

for (const mode of ['unavailable', 'text-only'] as const) {
  test(`WhatsApp offers the MP4 download when native file sharing is ${mode}`, async ({ page }) => {
    await installShareHarness(page, mode);
    const dialog = await openVideo(page);
    const filename = (await dialog.locator('#dialog-download').getAttribute('download'))!;
    const downloadEvent = page.waitForEvent('download');
    await dialog.locator('#dialog-whatsapp').click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(filename);
    expect(download.url()).toMatch(/\/media\/instagram\/.+\.mp4$/);
    await expect(dialog.locator('#dialog-sharing-status')).toContainText('anexe no WhatsApp');
    expect(await calls(page)).toEqual([]);
    expect(page.context().pages()).toHaveLength(1);
  });
}

test('a slow download asks for a fresh click and sends the cached MP4 without another request', async ({ page }) => {
  await installShareHarness(page);
  let requests = 0;
  await page.route('**/*.mp4', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    // Playwright's polling evaluates with a user gesture. Explicitly model the
    // permission expiring so those evaluations cannot extend the click lifetime.
    await page.evaluate(() => Object.defineProperty(navigator, 'userActivation', {
      configurable: true, value: { isActive: false },
    }));
    await route.continue();
  });
  const dialog = await openVideo(page);
  await dialog.locator('#dialog-whatsapp').click();
  await expect(dialog.locator('#dialog-sharing-status')).toContainText('Vídeo pronto. Toque novamente', { timeout: 12_000 });
  expect(await calls(page)).toEqual([]);
  await page.evaluate(() => Reflect.deleteProperty(navigator, 'userActivation'));
  await dialog.locator('#dialog-whatsapp').click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  expect((await calls(page))[0].activated).toBe(true);
  expect(requests).toBe(1);
});

test('cancelling the native menu neither opens WhatsApp with a link nor downloads a file', async ({ page }) => {
  await installShareHarness(page, 'cancel');
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.url()));
  const dialog = await openVideo(page);
  await dialog.locator('#dialog-whatsapp').click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  await expect(dialog.locator('#dialog-sharing-status')).toContainText('No celular, escolha WhatsApp');
  await expect(dialog.locator('#dialog-whatsapp')).toBeEnabled();
  expect(downloads).toEqual([]);
  expect(page.context().pages()).toHaveLength(1);
});

test('a media download failure is visible and retry sends the file instead of a URL', async ({ page }) => {
  await installShareHarness(page);
  let requests = 0;
  await page.route('**/*.mp4', async (route) => {
    if (++requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  const dialog = await openVideo(page);
  await dialog.locator('#dialog-whatsapp').click();
  await expect(dialog.locator('#dialog-sharing-status')).toContainText('Não foi possível enviar o arquivo');
  expect(await calls(page)).toEqual([]);
  await expect(dialog.locator('#dialog-whatsapp')).toBeEnabled();
  await dialog.locator('#dialog-whatsapp').click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  expect((await calls(page))[0].url).toBeNull();
  expect(requests).toBe(2);
});

test('closing while downloading cannot share or overwrite the reopened dialog', async ({ page }) => {
  await installShareHarness(page);
  let requests = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/*.mp4', async (route) => {
    if (++requests === 1) {
      await pending;
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  const dialog = await openVideo(page);
  await dialog.locator('#dialog-whatsapp').click();
  await expect(dialog.locator('#dialog-sharing-status')).toContainText('Preparando vídeo');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('[data-gallery] [data-post] a[data-open-post]').first().click();
  await expect(dialog.locator('#dialog-whatsapp')).toBeEnabled();
  release();
  await dialog.locator('#dialog-whatsapp').click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  await expect(dialog.locator('#dialog-sharing-status')).toContainText('Escolha WhatsApp');
  expect((await calls(page))[0].files[0].type).toBe('video/mp4');
});
