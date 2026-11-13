import { test, expect } from '@playwright/test';
import { productionOrigin } from './origins';
import contextFixture from '../../contract/kudlab-runtime-1.3.0/context-2.0.synthetic.json' with { type: 'json' };
import { mentalistaEnvelopeSchema } from '../../src/contract/mentalista';
import { hash } from '../../src/contract/canonical';

// Browser behavior with a synthetic API. Real API/PostgreSQL coverage is a separate integration suite.
test('Mentalista: practice, twelve items, receipt and responsive scene', async ({ page }) => {
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let started = 0, received = 0;
  await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/claim')) return route.fulfill({ json: contextFixture });
    if (path.endsWith('/start')) {
      started++;
      return route.fulfill({ json: { sessionId: contextFixture.sessionId, executionStatus: 'RUNNING', attemptNumber: 1,
        startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } });
    }
    if (path.endsWith('/results')) {
      const e = mentalistaEnvelopeSchema.parse(route.request().postDataJSON());
      expect(e.state).toBe('completed'); expect(e.events).toHaveLength(12); received++;
      return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId, evidenceHash: await hash(e),
        receiptId: '60000000-0000-4000-8000-000000000001', receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
    }
    return route.fulfill({ json: { receipt: null } });
  });
  await page.goto(productionOrigin);
  await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar al laboratorio' })).toBeVisible();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `test-results/mentalista-${size.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Entrar al laboratorio' }).click();
  await page.getByRole('button', { name: 'Practicar', exact: true }).click();
  await page.clock.install();
  for (const item of contextFixture.config.bank.practice) {
    await page.clock.runFor(1000 + (item.load + 1) * 3000 + 100);
    await page.locator('.mentalista-option').nth(item.correctIdx).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Comenzar actividad', exact: true }).click();
  await page.clock.runFor(4000);
  for (let n = 0; n < 12; n++) {
    for (let step = 0; step < 40 && !await page.locator('.mentalista-option').count(); step++) await page.clock.runFor(500);
    await expect(page.locator('.mentalista-option')).toHaveCount(4);
    await page.clock.runFor(500); await page.keyboard.press('1'); await page.clock.runFor(500);
  }
  await expect(page.getByRole('heading', { name: 'Tus resultados se guardaron', exact: true })).toBeVisible();
  expect(started).toBe(1); expect(received).toBe(1);
});

for (const interruption of ['focus', 'layout', 'reload'] as const) {
  test(`Mentalista: two failed practice rounds and terminal ${interruption}`, async ({ page }) => {
    test.setTimeout(180000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let starts = 0;
    const received: ReturnType<typeof mentalistaEnvelopeSchema.parse>[] = [];
    await page.route('https://api.invalid/api/v1/game-runtime/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/access/claim')) return route.fulfill({ json: contextFixture });
      if (path.endsWith(`/sessions/${contextFixture.sessionId}`)) return route.fulfill({ json: { ...contextFixture, executionStatus: 'RUNNING', attemptNumber: 1,
        uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString(), capabilities: { canStart: false, canSubmit: true, canReadReceipt: true } } });
      if (path.endsWith('/start')) {
        starts++;
        return route.fulfill({ json: { sessionId: contextFixture.sessionId, executionStatus: 'RUNNING', attemptNumber: 1, startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() } });
      }
      if (path.endsWith('/results')) {
        const e = mentalistaEnvelopeSchema.parse(route.request().postDataJSON()); received.push(e);
        return route.fulfill({ status: 201, json: { sessionId: e.sessionId, submissionId: e.submissionId, evidenceHash: await hash(e), receiptId: '60000000-0000-4000-8000-000000000001', receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
      }
      return route.fulfill({ json: { receipt: null } });
    });
    await page.goto(productionOrigin);
    await page.getByLabel('Código de actividad', { exact: true }).fill('ERD34');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Entrar al laboratorio' }).click();
    await page.clock.install();
    await page.getByRole('button', { name: 'Practicar', exact: true }).click();
    for (let round = 0; round < 2; round++) {
      for (const item of contextFixture.config.bank.practice) {
        await page.clock.runFor(1000 + (item.load + 1) * 3000 + 100);
        await page.locator('.mentalista-option').nth((item.correctIdx + 1) % 4).click();
        await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      }
      expect(starts).toBe(0);
      if (!round) await page.getByRole('button', { name: 'Segunda práctica' }).click();
    }
    await page.getByRole('button', { name: 'Comenzar actividad', exact: true }).click();
    await page.clock.runFor(6000);
    await expect(page.locator('.mentalista-measuring')).toBeVisible();
    if (interruption === 'focus') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (interruption === 'layout') await page.setViewportSize({ width: 900, height: 700 });
    else { await page.reload(); await page.clock.runFor(16000); }
    await expect.poll(() => received.length).toBe(1);
    expect(starts).toBe(1);
    expect(received[0]!.state).toBe('interrupted');
    expect(received[0]!.terminationReason).toBe(interruption === 'focus' ? 'focus_lost' : interruption === 'layout' ? 'layout_changed' : 'recovered_after_reload');
    expect(received[0]!.preparation.practice).toHaveLength(2);
    expect(received[0]!.events[0]!.closureReason).toBe('interruption');
    expect(received[0]!.events[0]!.selectedIdx).toBeNull();
    await expect(page.getByRole('button', { name: 'Comenzar actividad', exact: true })).toHaveCount(0);
  });
}
