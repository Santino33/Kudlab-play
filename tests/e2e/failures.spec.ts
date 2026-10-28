import { test, expect, type Frame, type Page } from '@playwright/test';
import { demoOrigin, teacherOrigin } from './origins';

async function launch(page: Page, mode = 'normal') {
  await page.goto(`${teacherOrigin}/laboratorio.html`);
  await page.getByText('Herramientas de desarrollo', { exact: true }).click();
  await page.getByRole('combobox').selectOption(mode);
  await page.getByRole('button', { name: 'Crear sesión sintética' }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#start-reason')).toHaveText('Tu actividad está lista');
  return frame;
}
function child(page: Page) { return page.frames().find(f => f.url().startsWith(`${demoOrigin}/`))!; }
async function rows<T>(frame: Frame, store: string): Promise<T[]> {
  return frame.evaluate(async store => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const result = await new Promise<T[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return result;
  }, store);
}
async function finish(page: Page) {
  const f = page.frameLocator('iframe');
  await f.getByRole('button', { name: 'Terminar actividad' }).click();
  await f.getByRole('button', { name: 'Sí, terminar' }).click();
}
test('acuse perdido tras commit: un único submission/hash y recibo verificado', async ({ page }) => {
  const f = await launch(page, 'lost_ack');
  const submissions: string[] = [];
  page.on('request', r => { if (r.url().endsWith('/results')) submissions.push(r.postData()!); });
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await finish(page);
  await expect(f.getByRole('heading', { name: 'Tus resultados se guardaron' })).toBeVisible({ timeout: 10000 });
  expect(submissions.length).toBeGreaterThanOrEqual(2); expect(new Set(submissions).size).toBe(1);
  expect(await rows(child(page), 'outbox')).toEqual([]);
  expect(await rows(child(page), 'credentials')).toEqual([]);
  expect(await rows(child(page), 'receipts')).toHaveLength(1);
});
for (const mode of ['401', '403', '409']) {
  test(`HTTP ${mode}: conserva pendiente y detiene reintentos automáticos`, async ({ page }) => {
    const f = await launch(page, mode);
    await f.getByRole('button', { name: 'Comenzar', exact: true }).click(); await finish(page);
    await expect(f.getByRole('heading', { name: 'Necesitamos ayuda de tu profesor para enviar los resultados' })).toBeVisible();
    const out = await rows<{ status: string; attemptCount: number }>(child(page), 'outbox');
    expect(out).toHaveLength(1); expect(out[0].status).toBe(mode === '409' ? 'BLOCKED' : 'AUTH_REQUIRED');
    expect(out[0].attemptCount).toBe(1);
    if (mode === '403') {
      await page.setViewportSize({ width: 320, height: 800 });
      await child(page).addStyleTag({ content: 'html { font-size: 200% }' });
      expect(await child(page).evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
test('inicio perdido se reconcilia como interrumpido y nunca empieza a medir', async ({ page }) => {
  const f = await launch(page, 'lost_start');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.getByRole('heading', { name: 'La actividad se interrumpió' })).toBeVisible({ timeout: 20000 });
  await expect(f.locator('canvas')).toHaveCount(0);
  await expect(f.getByRole('heading', { name: 'Tus resultados se guardaron' })).toBeVisible();
  expect(await rows(child(page), 'receipts')).toHaveLength(1);
});
test('offline no consume inicio incluso con autorización preparada', async ({ page, context }) => {
  const f = await launch(page);
  let starts = 0; page.on('request', r => { if (r.url().endsWith('/start')) starts++; });
  await context.setOffline(true);
  await expect(f.getByRole('button', { name: 'Comenzar', exact: true })).toBeDisabled();
  expect(starts).toBe(0);
  expect(await rows(child(page), 'executions')).toHaveLength(0);
  await context.setOffline(false);
});
test('almacenamiento bloqueado en iframe no anuncia listo ni inicia', async ({ page, context }) => {
  await context.addInitScript(() => {
    if (location.hostname === '127.0.0.1') indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.goto(`${teacherOrigin}/laboratorio.html`);
  await page.getByRole('button', { name: 'Crear sesión sintética' }).click();
  const f = page.frameLocator('iframe');
  await expect(f.locator('#start-reason')).toContainText('No podemos preparar un respaldo');
  await expect(f.getByRole('button', { name: 'Comenzar', exact: true })).toBeDisabled();
});
test('cuota agotada durante ejecución interrumpe y no promete respaldo completo', async ({ page }) => {
  const f = await launch(page);
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  await child(page).evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      if (args[1] === 'readwrite' && Array.from(typeof args[0] === 'string' ? [args[0]] : args[0]).includes('trials')) throw new DOMException('quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await expect(f.getByRole('heading', { name: 'No podemos confirmar un respaldo completo' })).toBeVisible();
  await expect(f.locator('canvas')).toHaveCount(0);
});
test('segunda pestaña no mide la misma sesión', async ({ page, context }) => {
  const f = await launch(page);
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${teacherOrigin}/laboratorio.html`);
  const url = child(page).url();
  await second.evaluate(url => { const iframe = document.createElement('iframe'); iframe.src = url; iframe.style.cssText = 'width:100%;height:800px'; document.body.append(iframe); }, url);
  const secondFrame = second.frameLocator('iframe');
  await expect(secondFrame.getByRole('button', { name: 'Comenzar', exact: true })).toBeDisabled();
  await expect(secondFrame.locator('canvas')).toHaveCount(0);
  await second.close();
  expect(await rows(child(page), 'executions')).toHaveLength(1);
});
test('claim perdido recupera la misma preparación y no consume intento', async ({ page }) => {
  await page.goto(`${teacherOrigin}/laboratorio.html`);
  await page.getByText('Herramientas de desarrollo', { exact: true }).click();
  await page.getByRole('combobox').selectOption('lost_claim');
  const bodies: string[] = [];
  page.on('request', r => { if (r.url().endsWith('/launches/claim')) bodies.push(r.postData()!); });
  await page.getByRole('button', { name: 'Crear sesión sintética' }).click();
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('button', { name: 'Comenzar', exact: true })).toBeEnabled({ timeout: 10000 });
  expect(bodies.length).toBeGreaterThanOrEqual(2); expect(new Set(bodies).size).toBe(1);
  expect(await rows(child(page), 'executions')).toHaveLength(0);
});
test('recarga sin eventos de cierre recupera checkpoint anterior, no reanuda medición', async ({ page, context }) => {
  // Simulate a document lost without lifecycle callbacks. IndexedDB itself is not mocked.
  await context.addInitScript(() => {
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (...args: Parameters<typeof original>) {
      if (['pagehide', 'visibilitychange'].includes(args[0])) return;
      original.apply(this, args);
    };
  });
  const f = await launch(page, 'network');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  await expect.poll(async () => (await rows<{ checkpointAtMs: number; startedAtMs: number }>(child(page), 'executions'))
    .some(r => r.checkpointAtMs >= r.startedAtMs + 1000)).toBe(true);
  const before = (await rows<{ clock: { id: string }; checkpointAtMs: number }>(child(page), 'executions'))[0];
  await child(page).goto(child(page).url());
  await expect(f.getByRole('heading', { name: 'La actividad se interrumpió' })).toBeVisible({ timeout: 20000 });
  const out = (await rows<{ envelope: { terminationReason: string; clock: { id: string }; timing: { finishedAtMs: number } } }>(child(page), 'outbox'))[0];
  expect(out.envelope.terminationReason).toBe('recovered_after_reload');
  expect(out.envelope.clock.id).toBe(before.clock.id);
  expect(out.envelope.timing.finishedAtMs).toBeGreaterThanOrEqual(before.checkpointAtMs);
  await expect(f.locator('canvas')).toHaveCount(0);
});
test('cambio de escenario interrumpe en lugar de cambiar escala durante medición', async ({ page }) => {
  const f = await launch(page);
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(f.getByRole('heading', { name: 'La actividad se interrumpió' })).toBeVisible();
  await expect(f.locator('canvas')).toHaveCount(0);
});
test('pendiente A bloqueado no se asocia a la autorización del estudiante B', async ({ page }) => {
  const f = await launch(page, '403');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click(); await finish(page);
  await expect(f.getByRole('heading', { name: 'Necesitamos ayuda de tu profesor para enviar los resultados' })).toBeVisible();
  const before = (await rows<{ sessionId: string; hash: string }>(child(page), 'outbox'))[0];
  await page.getByRole('combobox').selectOption('normal');
  await page.getByRole('button', { name: 'Crear sesión sintética' }).click();
  await expect(f.locator('#start-reason')).toHaveText('Tu actividad está lista');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  const after = (await rows<{ sessionId: string; hash: string }>(child(page), 'outbox'))[0];
  expect(after.sessionId).toBe(before.sessionId); expect(after.hash).toBe(before.hash);
});
test('Pointer primario más click sintetizado deja una sola respuesta durable', async ({ page, context }) => {
  await context.addInitScript(() => { Math.random = () => 0; });
  const f = await launch(page, 'network');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect.poll(async () => (await rows<{ value: { presentedAtMs: number | null } }>(child(page), 'trials'))
    .some(r => r.value.presentedAtMs !== null)).toBe(true);
  await child(page).evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); });
    const trials = await new Promise<{ value: { spawnedAtMs: number; geometry: { x: number; size: number } } }[]>(resolve => {
      const r = db.transaction('trials').objectStore('trials').getAll(); r.onsuccess = () => resolve(r.result);
    });
    const execution = await new Promise<{ device: { stageScale: number } }[]>(resolve => {
      const r = db.transaction('executions').objectStore('executions').getAll(); r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const t = trials[0].value; const canvas = document.querySelector('canvas')!; const bounds = canvas.getBoundingClientRect();
    const scale = execution[0].device.stageScale;
    const x = bounds.left + t.geometry.x * scale;
    const y = bounds.top + (-t.geometry.size / 2 + (performance.now() - t.spawnedAtMs) * 0.21) * scale;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }));
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true }));
  });
  await expect.poll(async () => (await rows<{ value: { result: string } }>(child(page), 'trials')).filter(r => r.value.result === 'hit').length).toBe(1);
  const trials = await rows<{ value: { respondedAtMs: number | null; responseDevice: string } }>(child(page), 'trials');
  expect(trials.filter(r => r.value.respondedAtMs !== null)).toHaveLength(1);
  expect(trials[0].value.responseDevice).toBe('touch');
});
test('bloqueo de render superior a 250 ms interrumpe sin fabricar omisiones', async ({ page }) => {
  const f = await launch(page, 'network');
  await f.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(f.locator('canvas')).toBeVisible();
  await child(page).evaluate(() => { const until = performance.now() + 350; while (performance.now() < until) { /* intentional frame stall */ } });
  await expect(f.getByRole('heading', { name: 'La actividad se interrumpió' })).toBeVisible();
  const out = (await rows<{ envelope: { terminationReason: string } }>(child(page), 'outbox'))[0];
  expect(out.envelope.terminationReason).toBe('frame_gap');
});
