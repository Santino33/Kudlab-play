import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`${viewport.width}×${viewport.height}: demo limpia, cuenta en el botón y escenario de borde a borde`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${teacherOrigin}/demo.html`);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByText('Herramientas de desarrollo')).toHaveCount(0);
    const frame = page.frameLocator('iframe');
    const start = frame.getByRole('button', { name: 'Comenzar', exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    const count = frame.locator('.launch-area .countdown');
    await expect(count).toHaveText('3');
    await expect(frame.locator('canvas')).toHaveCount(0);
    await expect(count).toHaveText('2');
    await expect(count).toHaveText('1');
    await expect(frame.locator('canvas')).toBeVisible();
    const child = page.frames().find(f => f.url().startsWith(`${demoOrigin}/`))!;
    const geometry = await child.evaluate(() => {
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      const top = document.querySelector('.game-top')!.getBoundingClientRect();
      return { x: canvas.x, width: canvas.width, height: canvas.height, bottom: canvas.bottom, top: canvas.top,
        controlsBottom: top.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.x).toBe(0); expect(geometry.width).toBe(geometry.viewportWidth);
    expect(geometry.top).toBe(geometry.controlsBottom); expect(geometry.bottom).toBeCloseTo(geometry.viewportHeight);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(viewport.width);
    await frame.getByRole('button', { name: 'Terminar actividad' }).click();
    await frame.getByRole('button', { name: 'Sí, terminar' }).click();
    await expect(frame.getByRole('heading', { name: 'Tus resultados se guardaron' })).toBeVisible();
  });
}
test('la cuenta atrás no crea estímulos, no consume tiempo medido y una recarga no la reanuda', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${teacherOrigin}/demo.html`);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(frame.locator('.countdown')).toHaveText('3');
  const child = page.frames().find(f => f.url().startsWith(`${demoOrigin}/`))!;
  const count = await child.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); });
    const n = await new Promise<number>(resolve => { const r = db.transaction('trials').objectStore('trials').count(); r.onsuccess = () => resolve(r.result); });
    db.close(); return n;
  });
  expect(count).toBe(0);
  await child.goto(child.url());
  await expect(frame.getByRole('heading', { name: 'La actividad se interrumpió' })).toBeVisible({ timeout: 20000 });
  await expect(frame.locator('canvas')).toHaveCount(0);
  await expect(frame.locator('.countdown')).toHaveCount(0);
});
test('laboratorio separado: herramientas cerradas y errores explicados en español', async ({ page }) => {
  await page.goto(`${teacherOrigin}/laboratorio.html`);
  await expect(page.getByRole('combobox')).toBeHidden();
  await page.getByText('Herramientas de desarrollo', { exact: true }).click();
  await page.getByRole('combobox').selectOption('401');
  await expect(page.getByRole('status')).toContainText('La autorización de envío ya no sirve');
});
import { demoOrigin, teacherOrigin } from './origins';
