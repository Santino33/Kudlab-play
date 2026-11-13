import { test, expect } from '@playwright/test';
test('essential image failure interrupts without invented measurements', async ({ page }) => {
  await page.route('**/games/tg02/escenario-biblioteca.webp', route => route.abort());
  await page.goto('/tests/tg02-flow-harness.html');
  await page.waitForFunction(() => !!(window as unknown as { tg02Result?: unknown; tg02Error?: string }).tg02Result || !!(window as unknown as { tg02Error?: string }).tg02Error);
  const data = await page.evaluate(() => { const w = window as unknown as { tg02Result: unknown; tg02Error?: string }; return { result: w.tg02Result, error: w.tg02Error }; });
  expect(data.error).toBeUndefined(); expect(data.result).toMatchObject({ state: 'interrupted', terminationReason: 'resource_load_error', events: [], timing: { measurementStartedAtMs: null } });
});
test('active practice closes on exit, and destroy removes media and controls', async ({ page }) => {
  await page.goto('/tests/tg02-flow-harness.html');
  await page.getByRole('button', { name: '¡Hola, Kud!' }).click();
  await page.getByRole('button', { name: '¡Vamos!' }).click({ timeout: 20000 });
  await page.waitForFunction(() => !!(window as unknown as { tg02Snapshot?: { evidence: { active: unknown } } }).tg02Snapshot?.evidence.active);
  await page.locator('[data-pos="0"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => !!(window as unknown as { tg02Snapshot: { evidence: { active: unknown } } }).tg02Snapshot.evidence.active)).toBe(true);
  await page.evaluate(() => (window as unknown as { tg02Flow: { stop(): void } }).tg02Flow.stop());
  const data = await page.evaluate(() => { const w = window as unknown as { tg02Result: unknown; tg02Error?: string }; return { result: w.tg02Result, error: w.tg02Error }; });
  expect(data.error).toBeUndefined(); expect(data.result).toMatchObject({ state: 'interrupted', events: [], preparation: { practice: [{ items: [{ closureReason: 'interruption', valid: false }] }] } });
  await expect(page.locator('.tg02')).toHaveCount(0);
});
test('original visual flow produces a valid sealed envelope before closing media', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/tg02-flow-harness.html');
  await expect(page.getByRole('button', { name: '¡Hola, Kud!' })).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/tg02-intro.png' });
  await page.getByRole('button', { name: '¡Hola, Kud!' }).click();
  await page.getByRole('button', { name: '¡Vamos!' }).click({ timeout: 20000 });
  for (let i = 0; i < 21; i++) {
    await page.waitForFunction(() => {
      const w = window as unknown as { tg02Snapshot?: { evidence: { active: unknown } } }; return !!w.tg02Snapshot?.evidence.active;
    });
    const position = await page.evaluate(() => (window as unknown as { tg02Snapshot: { evidence: { active: { targetIdx: number } } } }).tg02Snapshot.evidence.active.targetIdx);
    if (i === 3) await page.screenshot({ path: '/tmp/opencode/tg02-measurement.png' });
    await page.waitForTimeout(500);
    await page.locator(`[data-pos="${position}"]`).click();
    await page.waitForFunction(() => !(window as unknown as { tg02Snapshot: { evidence: { active: unknown } } }).tg02Snapshot.evidence.active);
  }
  const result = await page.evaluate(() => {
    const w = window as unknown as { tg02Result: { state: string; events: unknown[] }; tg02Error?: string }; return { result: w.tg02Result, error: w.tg02Error };
  });
  expect(result.error).toBeUndefined(); expect(result.result.state).toBe('completed'); expect(result.result.events).toHaveLength(18); expect(errors).toEqual([]);
});
