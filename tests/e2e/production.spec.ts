import { expect, test } from '@playwright/test';
import { envelopeFixture } from '../fixtures/context';
import { hash } from '../../src/contract/canonical';
import { productionOrigin } from './origins';

test('producción aplica CSP, excluye herramientas y shell funciona con teclado', async ({ page, request }) => {
  const response = await page.goto(`${productionOrigin}/`);
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain("script-src 'self'"); expect(policy).not.toContain('unsafe-inline');
  expect(policy).toContain('frame-ancestors');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Ayuda', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Ayuda', exact: true })).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await request.get(`${productionOrigin}/demo.html`)).status()).toBe(404);
  expect((await request.get(`${productionOrigin}/__simulator/launch`)).status()).toBe(404);
  expect((await request.get(`${productionOrigin}/src/main.ts`)).status()).toBe(404);
});
test('SW solo cachea estáticos propios; shell offline no autoriza partida nueva', async ({ page, context }) => {
  await page.goto(`${productionOrigin}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.evaluate(async () => { await fetch('/api/v1/game-runtime/probe', { headers: { Authorization: 'Bearer synthetic-probe' }, cache: 'no-store' }); });
  const keys = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat();
  });
  expect(keys.length).toBeGreaterThan(5); expect(keys.some(k => /api|token|grant|bridgeId/.test(k))).toBe(false);
  expect(keys.every(k => k.startsWith(`${productionOrigin}/`))).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu actividad empieza aquí', exact: true })).toBeVisible();
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Necesitamos conexión para comprobar el código.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('link', { name: 'Enviar una actividad pendiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Actividades pendientes', exact: true })).toBeVisible();
  await context.setOffline(false);
});
test('migración aditiva v1→v2 y actualización SW conservan outbox antiguo inmutable', async ({ page }) => {
  const envelope = envelopeFixture();
  const digest = await hash(envelope);
  await page.goto(`${productionOrigin}/empty`);
  await page.evaluate(async ({ envelope, digest }) => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const r = indexedDB.open('kudlab-play-runtime', 1);
      r.onupgradeneeded = () => { for (const name of ['executions', 'trials', 'incidents', 'outbox', 'credentials', 'leases']) r.result.createObjectStore(name, { keyPath: 'key' }); };
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put({ key: envelope.sessionId, sessionId: envelope.sessionId, envelope,
        body: JSON.stringify(envelope), hash: digest, status: 'PENDING', attemptCount: 0, nextAttemptAt: 0 });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    await caches.open('tg01-static-legacy');
    await navigator.serviceWorker.register('/legacy-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  }, { envelope, digest });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto(`${productionOrigin}/`);
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  const read = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise<{ envelope: unknown; hash: string }[]>(resolve => { const r = db.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => resolve(r.result); });
    const value = { version: db.version, receipts: db.objectStoreNames.contains('receipts'), out: result[0], caches: await caches.keys() }; db.close(); return value;
  });
  const before = await read();
  expect(before.version).toBe(2); expect(before.receipts).toBe(true);
  expect(before.out.envelope).toEqual(envelope); expect(before.out.hash).toBe(digest);
  expect(before.caches).toContain('tg01-static-legacy');
  // Release the old client; no production skipWaiting or forced update.
  await page.goto('about:blank'); await page.goto(`${productionOrigin}/`);
  expect((await read()).out.hash).toBe(digest);
});
