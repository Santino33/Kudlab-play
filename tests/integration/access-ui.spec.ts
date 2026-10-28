import { test, expect } from '@playwright/test';
const teacherOrigin = process.env.KUDLAB_TEACHER_ORIGIN ?? 'http://localhost:5183';
const apiOrigin = process.env.KUDLAB_API_ORIGIN ?? 'http://localhost:4313';
const playOrigin = process.env.KUDLAB_PLAY_ORIGIN ?? 'http://127.0.0.1:4183';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('J03 UI: foco, copia fallida, cancelación, ocultación, texto 200% y vistas cargadas', async ({ page, browser }) => {
  await page.goto(teacherOrigin); await page.getByLabel('Correo', { exact: true }).fill('teacher-a@pilot.edu.co'); await page.getByLabel('Contraseña', { exact: true }).fill('TeacherPass1'); await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mis cursos', exact: true }).first()).toBeVisible();
  const groups = await (await page.request.get(`${apiOrigin}/api/v1/groups`)).json(), group = groups.items.find((g: { name: string }) => g.name === 'A1');
  const assignments = await (await page.request.get(`${apiOrigin}/api/v1/task-assignments?groupId=${group.id}`)).json();
  const assignment = assignments.items.find((a: { recipientCount: number }) => a.recipientCount === 2);
  expect(Boolean(assignment), 'Ejecutar primero la demostración J03 de dos destinatarios').toBe(true);
  const target = `${teacherOrigin}/academico/cursos/${group.id}/asignaciones/${assignment.id}`;
  await page.goto(target); await expect(page.getByRole('heading', { name: 'Códigos de actividad', exact: true })).toBeVisible(); await expect(page.locator('.access-code-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Proyectar códigos', exact: true }).click();
  const projector = page.getByRole('dialog'); await expect(projector).toBeVisible();
  await expect(projector.locator('.classroom-code').first()).toHaveText(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  await expect(projector.getByRole('link', { name: 'Ver sesiones', exact: true })).toHaveCount(0);
  await projector.screenshot({ path: 'test-results/kudlab-integration/j03-projector.png', mask: [projector.locator('.classroom-code')] });
  await page.keyboard.press('Escape'); await expect(projector).not.toBeVisible();
  const row = page.locator('.access-code-row').filter({ hasText: 'Participante Sintético A' });
  await row.getByText('Gestionar acceso y sesiones', { exact: true }).click();
  await row.getByRole('button', { name: 'Mostrar código', exact: true }).click(); await expect(row.locator('strong.text-xl')).toBeVisible();
  const code = (await row.locator('strong.text-xl').textContent())!;
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); expect(storage.includes(code)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(page.locator('.access-code-row strong.text-xl')).toHaveCount(0);
  await expect(row.locator('.classroom-code')).toHaveText('Oculto');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('synthetic clipboard unavailable'); } } }));
  await row.getByRole('button', { name: 'Copiar mensaje', exact: true }).click(); await expect(page.getByText('No se pudo copiar. Selecciona el texto y cópialo manualmente.')).toBeVisible();
  const fallback = row.getByRole('textbox'); await expect(fallback).toBeVisible(); expect((await fallback.inputValue()).includes(code)).toBe(true);
  await row.getByRole('button', { name: 'Ocultar código', exact: true }).click(); await expect(fallback).toHaveCount(0);
  const before = await (await page.request.get(`${apiOrigin}/api/v1/task-assignments/${assignment.id}/access-codes?limit=100`)).json();
  await row.getByRole('button', { name: 'Revocar', exact: true }).click(); const cancel = page.getByRole('button', { name: 'Volver', exact: true }); await expect(cancel).toBeVisible(); await cancel.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await (await page.request.get(`${apiOrigin}/api/v1/task-assignments/${assignment.id}/access-codes?limit=100`)).json()).toEqual(before);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 }); await page.goto(target); await expect(page.getByRole('heading', { name: 'Códigos de actividad', exact: true })).toBeVisible(); await expect(page.locator('.access-code-row').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/kudlab-integration/j03-teacher-${width}.png`, fullPage: true, mask: [page.locator('.classroom-code')] });
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '200%'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const publicContext = await browser.newContext(), child = await publicContext.newPage();
  try {
    await child.goto(`${playOrigin}/pendientes`); await expect(child.getByText(/En este navegador no encontramos resultados pendientes/)).toBeVisible();
    await child.getByRole('link', { name: 'Ingresar otro código', exact: true }).click(); const field = child.getByLabel('Código de actividad', { exact: true });
    await expect(field).toBeEnabled(); await field.focus(); await expect(field).toBeFocused(); await child.keyboard.insertText('ERD34'); expect(await field.inputValue()).toBe('ERD34');
    await child.evaluate(() => window.dispatchEvent(new Event('blur'))); expect(await field.inputValue()).toBe('');
    await child.setViewportSize({ width: 320, height: 950 }); await child.evaluate(() => document.documentElement.style.fontSize = '200%');
    expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await publicContext.close(); }
});
