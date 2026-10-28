import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const teacherOrigin = process.env.KUDLAB_TEACHER_ORIGIN ?? 'http://localhost:5173';
const apiOrigin = process.env.KUDLAB_API_ORIGIN ?? 'http://localhost:4300';
const playOrigin = process.env.KUDLAB_PLAY_ORIGIN ?? 'http://127.0.0.1:4178';
test('J02: profesor asigna, juega offline, recupera y consulta evidencia real en PostgreSQL', async ({ page, context }) => {
  await expect.poll(async () => { try { return (await page.request.get(`${apiOrigin}/api/auth/jwks`)).status(); } catch { return 0; } }, { timeout: 15000 }).toBe(200);
  await page.goto(teacherOrigin);
  await page.getByLabel('Correo', { exact: true }).fill('teacher-a@pilot.edu.co');
  await page.getByLabel('Contraseña', { exact: true }).fill('TeacherPass1');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('link', { name: 'Mis cursos', exact: true }).first().click();
  await page.locator('.course-card').filter({ has: page.getByRole('heading', { name: 'A1', exact: true }) }).getByRole('link', { name: 'Abrir curso', exact: true }).click();
  await page.getByRole('link', { name: 'Asignaciones de tareas digitales' }).click();
  await page.getByRole('button', { name: 'Asignar actividad', exact: true }).click();
  await page.getByLabel(/Participante Sintético A/).check();
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  await page.getByLabel('Disponible desde').fill(localDate(new Date(Date.now() - 60000)));
  await page.getByLabel('Disponible hasta').fill(localDate(new Date(Date.now() + 3600000)));
  await page.getByLabel('Máximo de intentos').fill('2');
  await page.getByRole('button', { name: 'Guardar asignación', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de asignación' })).toBeVisible();
  await page.screenshot({ path: 'test-results/kudlab-integration/assignment-1440.png', fullPage: true });
  await page.getByRole('link', { name: 'Iniciar actividad supervisada', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Kudlab Play · Lluvia de estrellas"]');
  await expect(frame.getByRole('button', { name: 'Comenzar', exact: true })).toBeEnabled({ timeout: 20000 });
  await frame.getByRole('button', { name: 'Comenzar', exact: true }).click();
  await expect(frame.locator('canvas')).toBeVisible({ timeout: 10000 });
  await frame.locator('canvas').click({ position: { x: 180, y: 200 } });
  await context.setOffline(true);
  await expect(frame.getByRole('button', { name: 'Reintentar envío', exact: true })).toBeVisible({ timeout: 130000 });
  await expect(frame.getByRole('heading', { name: 'Terminaste la actividad', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/kudlab-integration/pending-offline.png', fullPage: true });
  const runtimePage = page.frames().find(f => f.url().startsWith(`${playOrigin}/`))!;
  await runtimePage.evaluate(() => location.reload());
  await expect(frame.getByRole('button', { name: 'Reintentar envío', exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Kudlab confirma la evidencia guardada. Consulta la sesión para revisar el procesamiento.')).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Consultar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de sesión' })).toBeVisible();
  await expect(page.getByText('Procesamiento completado', { exact: true })).toBeVisible({ timeout: 12000 }).catch(async () => {
    await page.getByRole('button', { name: 'Actualizar sesión' }).click();
    await expect(page.getByText('Procesamiento completado', { exact: true })).toBeVisible();
  });
  await page.getByText('Ver ensayos y decisiones de cálculo', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Evidencia de ensayos', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/kudlab-integration/results-1440.png', fullPage: true });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/kudlab-integration/results-${width}.png`, fullPage: true });
  }
  const backend = process.env.KUDLAB_J02_BACKEND_DIR, database = process.env.KUDLAB_J02_DATABASE_URL;
  if (backend && database) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('link', { name: 'Ver asignación', exact: true }).click();
    await page.getByRole('link', { name: 'Iniciar actividad supervisada', exact: true }).click();
    const secondFrame = page.frameLocator('iframe[title="Kudlab Play · Lluvia de estrellas"]');
    await secondFrame.getByRole('button', { name: 'Comenzar', exact: true }).click();
    await expect(secondFrame.locator('canvas')).toBeVisible();
    await page.route('**/game-runtime/sessions/*/results', route => route.abort('internetdisconnected'));
    await secondFrame.getByRole('button', { name: 'Terminar actividad', exact: true }).click();
    await secondFrame.getByRole('button', { name: 'Sí, terminar', exact: true }).click();
    await expect(secondFrame.getByRole('button', { name: 'Reintentar envío', exact: true })).toBeVisible();
    const href = await page.getByRole('link', { name: 'Consultar sesión', exact: true }).getAttribute('href');
    const sessionId = href!.split('/').at(-1)!;
    execFileSync(process.execPath, ['--import', 'tsx', 'tests/game-expire-capability.ts', sessionId], { cwd: backend, env: { ...process.env, DATABASE_URL: database } });
    await page.unroute('**/game-runtime/sessions/*/results');
    // Expedite the same outbox operation; automatic maintenance may already have consumed the retry UI.
    await secondFrame.locator('body').evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(secondFrame.getByText('Necesitamos ayuda de tu profesor para enviar los resultados', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Consultar sesión', exact: true }).click();
    await page.getByRole('link', { name: 'Recuperar envío en este navegador', exact: true }).click();
    await expect(page.getByText('Kudlab confirma la evidencia guardada. Consulta la sesión para revisar el procesamiento.')).toBeVisible({ timeout: 20000 });
    await page.getByRole('link', { name: 'Consultar sesión', exact: true }).click();
    await expect(page.getByText('Interrumpida · datos parciales', { exact: true })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: /^Intento$/ }).locator('..').locator('dd')).toHaveText('2');
    await page.screenshot({ path: 'test-results/kudlab-integration/recovered-expired-capability.png', fullPage: true });
  }
});
