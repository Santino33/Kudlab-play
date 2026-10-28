import { expect, test, type Page } from '@playwright/test';
import { demoOrigin, teacherOrigin } from './origins';
async function launch(page: Page) {
  await page.goto(`${teacherOrigin}/laboratorio.html`);
  await page.getByText('Herramientas de desarrollo', { exact: true }).click();
  await page.getByRole('combobox').selectOption('normal');
  await page.getByRole('button', { name: 'Crear sesión sintética' }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#start-reason')).toHaveText('Tu actividad está lista');
  return frame;
}
test('entrada pública sin autorización; ejemplo repetible por teclado tras autorización supervisada', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tu actividad empieza aquí', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  const frame = await launch(page);
  await frame.getByRole('button', { name: 'Ver el ejemplo' }).focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('heading', { name: 'Probemos juntos' })).toBeVisible();
  await frame.getByRole('button', { name: 'Tocar la estrella del ejemplo' }).click();
  await expect(frame.getByText('La luna pasa sola', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Volver a las instrucciones' }).click();
  await frame.getByRole('button', { name: 'Ver el ejemplo' }).click();
  await expect(frame.getByRole('heading', { name: 'Probemos juntos' })).toBeVisible();
});
test('iframe: autorización online, salida explícita y acuse verificado', async ({ page }) => {
  const logs: string[] = []; const urls: string[] = [];
  page.on('console', m => logs.push(m.text())); page.on('request', r => urls.push(r.url()));
  const frame = await launch(page);
  const child = page.frames().find(f => f.url().startsWith(`${demoOrigin}/`))!;
  const secrets = await child.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<{ runtimeSecret: string }[]>(resolve => { const r = db.transaction('credentials').objectStore('credentials').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return rows.map(r => r.runtimeSecret);
  });
  await frame.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Terminar actividad' })).toBeVisible();
  await frame.getByRole('button', { name: 'Terminar actividad' }).click();
  await frame.getByRole('button', { name: 'Sí, terminar' }).click();
  await expect(frame.getByText('Tus resultados se guardaron', { exact: true })).toBeVisible();
  expect(secrets.length).toBeGreaterThan(0);
  expect([...logs, ...urls].some(value => secrets.some(secret => value.includes(secret)))).toBe(false);
});
test('movimiento reducido conserva instrucciones y elimina movimiento del ejemplo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const frame = await launch(page);
  await frame.getByRole('button', { name: 'Ver el ejemplo' }).click();
  await frame.getByRole('button', { name: 'Tocar la estrella del ejemplo' }).click();
  await expect(frame.locator('.example-moon')).toHaveCSS('animation-name', 'none');
  await expect(frame.getByText('La luna pasa sola', { exact: true })).toBeVisible();
});
test('red cortada conserva diario real y al reconectar entrega el mismo registro', async ({ page, context }) => {
  const frame = await launch(page);
  await frame.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Terminar actividad' })).toBeVisible();
  // Wait on a durable checkpoint, not an arbitrary time delay.
  const child = page.frames().find(f => f.url().startsWith(`${demoOrigin}/`))!;
  await expect.poll(() => child.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<{ startedAtMs: number; checkpointAtMs: number }[]>(resolve => { const r = db.transaction('executions').objectStore('executions').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return rows.some(r => r.checkpointAtMs > r.startedAtMs + 1000);
  })).toBe(true);
  await context.setOffline(true);
  await frame.getByRole('button', { name: 'Terminar actividad' }).click();
  await frame.getByRole('button', { name: 'Sí, terminar' }).click();
  await expect(frame.getByText('Falta enviar tus resultados', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(frame.getByText('Tus resultados se guardaron', { exact: true })).toBeVisible();
});
test('nivel superior no toma una preparación supervisada de otra vía', async ({ page, request }) => {
  const bridgeId = crypto.randomUUID();
  await request.post('/__simulator/mode', { data: { mode: 'normal' } });
  const response = await request.post('/__simulator/launch');
  const { launchGrant } = await response.json();
  await page.goto(`/?bridgeId=${bridgeId}`);
  // Test-only harness prepares through the real client/contract. No production bypass or arbitrary student.
  await page.evaluate(async ({ bridgeId, launchGrant, demoOrigin }) => {
    const prefix = '/src';
    const { Database } = await import(`${prefix}/storage/database.ts`) as typeof import('../../src/storage/database');
    const { Session } = await import(`${prefix}/runtime/session.ts`) as typeof import('../../src/runtime/session');
    const { Api } = await import(`${prefix}/delivery/api.ts`) as typeof import('../../src/delivery/api');
    const db = await Database.open();
    await new Session(db, new Api(demoOrigin), crypto.randomUUID()).claim(launchGrant, bridgeId);
    db.raw.close();
  }, { bridgeId, launchGrant, demoOrigin });
  await page.reload();
  await expect(page.getByLabel('Código de actividad', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
});
test('320px y texto aumentado: sin scroll horizontal ni autorización inventada', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await expect(page.getByLabel('Código de actividad', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('las siluetas compartidas con Canvas ocupan la caja lógica completa', async ({ page }) => {
  const frame = await launch(page);
  const boxes = await frame.locator('.instruction-picture svg path').evaluateAll(paths => paths.map(path => {
    const b = (path as SVGGraphicsElement).getBBox(); return { width: b.width, height: b.height };
  }));
  expect(boxes).toHaveLength(2);
  for (const box of boxes) { expect(box.width).toBeCloseTo(100, 2); expect(box.height).toBeCloseTo(100, 2); }
});
