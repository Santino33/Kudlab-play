import { test, expect } from '@playwright/test';
import { productionOrigin } from './origins';
import context from '../../contract/kudlab-runtime-1.5.0/context-tg02.synthetic.json' with { type: 'json' };
import { envelopeSchema } from '../../src/contract/palabra-intrusa';
import { hash } from '../../src/contract/canonical';
import { buildSequence } from '../../src/games/tg02/sequence';

test('TG02 reload delivers interrupted practice without replay or a second start', async ({ page }) => {
  test.setTimeout(90000); let starts = 0;
  const received: ReturnType<typeof envelopeSchema.parse>[] = [];
  await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/claim')) return route.fulfill({ json: { ...context, startAllowedUntil: new Date(Date.now() + 86400000).toISOString() } });
    if (path.endsWith(`/sessions/${context.sessionId}`)) return route.fulfill({ json: { ...context, executionStatus: 'RUNNING', attemptNumber: 1,
      uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString(), capabilities: { canStart: false, canSubmit: true, canReadReceipt: true } } });
    if (path.endsWith('/start')) { starts++; return route.fulfill({ json: { sessionId: context.sessionId, executionStatus: 'RUNNING', attemptNumber: 1,
      startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } }); }
    if (path.endsWith('/results')) { const e = envelopeSchema.parse(route.request().postDataJSON()); received.push(e);
      return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId, evidenceHash: await hash(e),
        receiptId: '60000000-0000-4000-8000-000000000002', receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } }); }
    return route.fulfill({ json: { receipt: null } });
  });
  await page.goto(productionOrigin);
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34'); await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: '¡Hola, Kud!', exact: true }).click();
  await page.getByRole('button', { name: '¡Vamos!', exact: true }).click({ timeout: 20000 });
  await expect(page.locator('[data-part="cards"]')).not.toHaveClass(/hidden|off|locked/, { timeout: 25000 });
  await page.waitForTimeout(1200); await page.reload();
  await expect.poll(() => received.length, { timeout: 30000 }).toBe(1);
  expect(starts).toBe(1); expect(received[0]).toMatchObject({ state: 'interrupted', events: [], preparation: { practice: [{ items: [{ closureReason: 'interruption', valid: false }] }] } });
  await expect(page.getByRole('button', { name: '¡Hola, Kud!', exact: true })).toHaveCount(0);
});

test('TG02 code entry, original game, durable queue and confirmed receipt on production build', async ({ page }) => {
  test.setTimeout(150000); let starts = 0;
  const received: ReturnType<typeof envelopeSchema.parse>[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/claim')) return route.fulfill({ json: { ...context, startAllowedUntil: new Date(Date.now() + 86400000).toISOString() } });
    if (path.endsWith('/start')) { starts++; return route.fulfill({ json: { sessionId: context.sessionId, executionStatus: 'RUNNING', attemptNumber: 1,
      startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } }); }
    if (path.endsWith('/results')) { const e = envelopeSchema.parse(route.request().postDataJSON()); received.push(e);
      return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId, evidenceHash: await hash(e),
        receiptId: '60000000-0000-4000-8000-000000000002', receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } }); }
    return route.fulfill({ json: { receipt: null } });
  });
  await page.goto(productionOrigin);
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: '¡Hola, Kud!', exact: true }).click();
  await page.getByRole('button', { name: '¡Vamos!', exact: true }).click({ timeout: 20000 });
  const seq = buildSequence();
  for (const item of [...seq.practice, ...seq.seq]) {
    const cards = page.locator('[data-part="cards"]');
    await expect(cards).not.toHaveClass(/hidden|off|locked/, { timeout: 25000 });
    await expect(page.locator('[data-pos="0"] [data-word]')).toHaveText(item.words[0]);
    await page.waitForTimeout(500); await page.locator(`[data-pos="${item.targetIdx}"]`).click();
    await expect(cards).toHaveClass(/locked/);
  }
  await expect(page.getByRole('heading', { name: 'Tus resultados se guardaron', exact: true })).toBeVisible({ timeout: 25000 });
  expect(starts).toBe(1); expect(received).toHaveLength(1); expect(received[0].events).toHaveLength(18);
  expect(received[0].state).toBe('completed'); expect(errors).toEqual([]);
});
