import { test, expect } from '@playwright/test';
import { productionOrigin } from './origins';
import context from '../../contract/kudlab-runtime-1.4.0/context-tg07.synthetic.json' with { type: 'json' };
import { kudDiceEnvelopeSchema } from '../../src/contract/kud-dice';
import { hash } from '../../src/contract/canonical';
import { buildSequences } from '../../src/games/tg07/sequence';

test('Kud Dice original intro, two practice rounds, timed measurement and durable receipt', async ({ page }) => {
  test.setTimeout(180000);
  let starts = 0;
  const received: ReturnType<typeof kudDiceEnvelopeSchema.parse>[] = [];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/claim')) return route.fulfill({ json: context });
    if (path.endsWith('/start')) {
      starts++;
      return route.fulfill({ json: { sessionId: context.sessionId, executionStatus: 'RUNNING', attemptNumber: 1,
        startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } });
    }
    if (path.endsWith('/results')) {
      const e = kudDiceEnvelopeSchema.parse(route.request().postDataJSON()); received.push(e);
      return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId,
        evidenceHash: await hash(e), receiptId: '60000000-0000-4000-8000-000000000007',
        receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
    }
    return route.fulfill({ json: { receipt: null } });
  });
  await page.goto(productionOrigin);
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: '¡Hola, Kud!', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '¡Hola, Kud!', exact: true }).click();
  await expect(page.getByRole('button', { name: '¡Vamos!', exact: true })).toBeVisible({ timeout: 20000 });
  expect(starts).toBe(1);
  await page.screenshot({ path: 'test-results/kud-dice-intro.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '¡Vamos!', exact: true }).click();
  await expect(page.getByRole('button', { name: '¡Empezar!', exact: true })).toBeVisible({ timeout: 65000 });
  await page.screenshot({ path: 'test-results/kud-dice-practice.png' });
  await page.getByRole('button', { name: '¡Empezar!', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tus resultados se guardaron', exact: true })).toBeVisible({ timeout: 60000 });
  expect(received).toHaveLength(1);
  const e = received[0];
  expect(e.state).toBe('completed'); expect(e.terminationReason).toBe('all_trials_incorrect_at_length');
  expect(e.events).toHaveLength(2); expect(e.preparation.practice).toHaveLength(2);
  expect(e.events.every(t => t.closureReason === 'timeout')).toBe(true);
  expect(e.audio).toEqual({ source: 'files', missingFiles: [] });
  expect(e.timing.measurementStartedAtMs!).toBeGreaterThan(e.preparation.practice[1].evidence.closedAtMs);
  expect(errors).toEqual([]);
});

test('Kud Dice video supports cached byte ranges offline', async ({ page, context: browser }) => {
  test.setTimeout(60000);
  await page.goto(productionOrigin);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await browser.setOffline(true);
  const response = await page.evaluate(async () => {
    const r = await fetch('/kud-dice/v1/transicion-lab-a-musica.mp4', { headers: { Range: 'bytes=0-99' } });
    return { status: r.status, range: r.headers.get('Content-Range'), size: (await r.arrayBuffer()).byteLength };
  });
  expect(response.status).toBe(206); expect(response.size).toBe(100); expect(response.range).toMatch(/^bytes 0-99\/\d+$/);
});

test('Kud Dice pointer practice, focus invalidation and reload recover a partial without replay', async ({ page }) => {
  test.setTimeout(120000);
  let starts = 0;
  const received: ReturnType<typeof kudDiceEnvelopeSchema.parse>[] = [];
  await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/claim')) return route.fulfill({ json: context });
    if (path.endsWith(`/sessions/${context.sessionId}`)) return route.fulfill({ json: { ...context, executionStatus: 'RUNNING', attemptNumber: 1,
      uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString(), capabilities: { canStart: false, canSubmit: true, canReadReceipt: true } } });
    if (path.endsWith('/start')) { starts++; return route.fulfill({ json: { sessionId: context.sessionId, executionStatus: 'RUNNING', attemptNumber: 1,
      startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } }); }
    if (path.endsWith('/results')) {
      const e = kudDiceEnvelopeSchema.parse(route.request().postDataJSON()); received.push(e);
      return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId, evidenceHash: await hash(e),
        receiptId: '60000000-0000-4000-8000-000000000007', receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
    }
    return route.fulfill({ json: { receipt: null } });
  });
  await page.goto(productionOrigin);
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: '¡Hola, Kud!', exact: true }).click();
  await page.getByRole('button', { name: '¡Vamos!', exact: true }).click();
  await expect(page.locator('#drum0')).not.toHaveClass(/disabled/, { timeout: 35000 });
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  for (const drum of buildSequences().practice[1]) {
    const target = page.locator(`#drum${drum}`), bounds = (await target.boundingBox())!;
    await target.click({ position: { x: bounds.width * .5, y: bounds.height * .3 } });
  }
  await page.getByRole('button', { name: '¡Empezar!', exact: true }).click();
  await expect(page.locator('#musicText')).toContainText('¡Mira y escucha!');
  await page.reload();
  await expect.poll(() => received.length, { timeout: 30000 }).toBe(1);
  const e = received[0];
  expect(starts).toBe(1); expect(e.state).toBe('interrupted');
  expect(e.preparation.practiceCompleted).toBe(true);
  expect(e.preparation.practice).toHaveLength(1);
  expect(e.preparation.practice[0].evidence).toMatchObject({ valid: false, invalidReason: 'focus_lost' });
  expect(e.events).toHaveLength(1); expect(e.events[0]).toMatchObject({ valid: false, closureReason: 'interruption' });
  await expect(page.getByRole('button', { name: '¡Empezar!', exact: true })).toHaveCount(0);
});
