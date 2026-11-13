import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { productionOrigin } from './origins';
import { envelopeFixture } from '../fixtures/context';
import { hash } from '../../src/contract/canonical';

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

test('CA-02: navegación fallida actualiza el mismo registro sin borrar pendientes ni forzar clientes', async ({ page, context }) => {
  test.setTimeout(60000);
  const server = await stagedServer(await readFile('tests/fixtures/redirected-sw.js', 'utf8'));
  const envelope = envelopeFixture();
  const pending = { key: envelope.sessionId, sessionId: envelope.sessionId, envelope, body: JSON.stringify(envelope),
    hash: await hash(envelope), status: 'PENDING', attemptCount: 0, nextAttemptAt: Number.MAX_SAFE_INTEGER, lastErrorCode: 'RATE_LIMITED' };
  try {
    // An old client stays open while the browser checks /sw.js through a failed navigation.
    await page.goto(`${server.origin}/empty`);
    await page.evaluate(async pending => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('kudlab-play-runtime', 2);
        r.onupgradeneeded = () => {
          for (const name of ['executions', 'trials', 'incidents', 'outbox', 'credentials', 'leases', 'receipts']) r.result.createObjectStore(name, { keyPath: 'key' });
        };
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(pending);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
      db.close();
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    }, pending);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    let forcedNavigations = 0;
    page.on('framenavigated', () => { forcedNavigations++; });
    await server.publish(await readFile('dist/sw.js', 'utf8'));
    const failed = await context.newPage();
    await expect(failed.goto(`${server.origin}/`)).rejects.toThrow(/ERR_FAILED/);
    // No app code, register(), update(), bypass, skipWaiting or unregister after publication.
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), { timeout: 20000 }).toBe('installed');
    expect(forcedNavigations).toBe(0);
    expect(page.url()).toBe(`${server.origin}/empty`);
    await failed.close();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${server.origin}/pendientes`);
    await expect(reopened.getByRole('heading', { name: 'Actividades pendientes', exact: true })).toBeVisible();
    const stored = await reopened.evaluate(async key => {
      const db = await new Promise<IDBDatabase>(resolve => {
        const r = indexedDB.open('kudlab-play-runtime', 2); r.onsuccess = () => resolve(r.result);
      });
      const out = await new Promise(resolve => {
        const r = db.transaction('outbox').objectStore('outbox').get(key); r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return { out, caches: await caches.keys(), registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, url: r.active?.scriptURL })) };
    }, pending.key);
    expect(stored.out).toEqual(pending);
    expect(stored.caches).toContain('tg01-static-redirected-fixture');
    expect(stored.caches.some(name => name.startsWith('tg01-static-v2-'))).toBe(true);
    expect(stored.registrations).toEqual([{ scope: `${server.origin}/`, url: `${server.origin}/sw.js` }]);
  } finally { await server.close(); }
});
