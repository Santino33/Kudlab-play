import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { productionOrigin } from './origins';

// A separate origin per test permits a real /sw.js update without touching another suite's build.
async function stagedServer(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'play-sw-'));
  const workerFile = join(dir, 'sw.js');
  await writeFile(workerFile, source);
  const child = spawn(process.execPath, ['scripts/serve-production.mjs'], {
    env: { ...process.env, PORT: '0', VERIFICATION_SW_FILE: workerFile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = await new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Verification server exited: ${code}`)));
    child.stderr.on('data', data => reject(new Error(String(data))));
    child.stdout.on('data', data => {
      const port = String(data).match(/verificación: (\d+)/)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}`);
    });
  });
  return {
    origin,
    publish: (worker: string) => writeFile(workerFile, worker),
    async close() {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('CA-01: la política anterior reproduce ERR_FAILED al devolver HTML redirigido', async ({ page }) => {
  const server = await stagedServer(await readFile('tests/fixtures/redirected-sw.js', 'utf8'));
  try {
    await page.goto(`${server.origin}/empty`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(await page.evaluate(async () => {
      const cache = await caches.open('tg01-static-redirected-fixture');
      return (await cache.match('/index.html'))?.redirected;
    })).toBe(true);
    await expect(page.goto(`${server.origin}/`)).rejects.toThrow(/ERR_FAILED/);
  } finally { await server.close(); }
});

test('CA-01: el shell canónico carga tras recarga y reapertura bajo redirección Pages', async ({ page, context, request }) => {
  const redirect = await request.get(`${productionOrigin}/index.html`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe('/');
  await page.goto(`${productionOrigin}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('tg01-static-v2-'))!;
    const cache = await caches.open(name);
    const shell = await cache.match('/');
    return { redirected: shell?.redirected, oldKey: Boolean(await cache.match('/index.html')) };
  })).toEqual({ redirected: false, oldKey: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu actividad empieza aquí', exact: true })).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`${productionOrigin}/`);
  await expect(reopened.getByRole('heading', { name: 'Tu actividad empieza aquí', exact: true })).toBeVisible();
  await reopened.goto(`${productionOrigin}/index.html`);
  await expect(reopened.getByRole('heading', { name: 'Tu actividad empieza aquí', exact: true })).toBeVisible();
  await reopened.goto(`${productionOrigin}/pendientes`);
  await expect(reopened.getByRole('heading', { name: 'Actividades pendientes', exact: true })).toBeVisible();
});
