import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { mentalistaEnvelopeSchema } from '../../src/contract/mentalista';
import profile from '../../contract/kudlab-runtime-1.3.0/mentalista-profile.json' with { type: 'json' };

const teacherOrigin = 'http://localhost:5333', apiOrigin = 'http://localhost:4333', playOrigin = 'http://127.0.0.1:4233';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
for (const mode of ['complete', 'offline-interrupted-lost-ack'] as const) test(`CA-01…11: ${mode}: teacher assignment → actual Mentalista → PostgreSQL receipt → teacher detail/history`, async ({ browser }) => {
  test.setTimeout(240000);
  const path = process.env.TG03_SYNTHETIC_FIXTURES;
  test.skip(!path, 'Requires explicit private fixture path for the authorized TG-03 stack');
  const fixtures = JSON.parse(await readFile(path!, 'utf8'));
  expect(fixtures.syntheticOnly).toBe(true); expect(fixtures.database).toBe('kudlab_local');
  const user = fixtures.teachers[0];
  const teacher = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });
  const login = await teacher.request.post(`${apiOrigin}/api/auth/sign-in/email`, { headers: { origin: teacherOrigin }, data: { email: user.email, password: user.password } });
  expect(login.status()).toBe(200);
  const page = await teacher.newPage();
  await page.goto(`${teacherOrigin}/academico/cursos/${user.groupId}/asignaciones`);
  await page.getByRole('button', { name: 'Asignar actividad', exact: true }).click();
  await page.getByLabel('Tarea digital', { exact: true }).selectOption('TG-03');
  await expect(page.getByRole('heading', { name: 'Asignar Mentalista' })).toBeVisible();
  await page.getByRole('button', { name: 'Seleccionar todos los actuales' }).click();
  const local = (time: number) => new Date(time).toISOString().slice(0, 16);
  await page.getByLabel('Disponible desde', { exact: true }).fill(local(Date.now() - 3600000));
  await page.getByLabel('Disponible hasta', { exact: true }).fill(local(Date.now() + 86400000));
  await page.getByLabel('Máximo de intentos', { exact: true }).fill('3');
  const created = page.waitForResponse(r => r.url() === `${apiOrigin}/api/v1/task-assignments` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar asignación y códigos' }).click();
  const response = await created; expect(response.status()).toBe(201);
  const assignment = await response.json(); expect(assignment.taskId).toBe('TG-03');
  await expect(page.getByRole('heading', { name: assignment.title, exact: true })).toBeVisible();
  await expect.poll(async () => (await (await teacher.request.get(`${apiOrigin}/api/v1/task-assignments/${assignment.id}/access-codes`)).json()).items?.length).toBe(1);
  if (mode === 'offline-interrupted-lost-ack') {
    await page.getByRole('button', { name: 'Proyectar códigos', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Mentalista');
    await page.getByRole('button', { name: 'Cerrar proyección', exact: true }).click();
  }
  const codesResponse = await teacher.request.get(`${apiOrigin}/api/v1/task-assignments/${assignment.id}/access-codes`);
  expect(codesResponse.status()).toBe(200);
  const codes = await codesResponse.json();
  const reveal = await teacher.request.post(`${apiOrigin}/api/v1/task-access-codes/${codes.items[0].id}/reveal`, { headers: { origin: teacherOrigin }, data: {} });
  expect(reveal.status()).toBe(200);
  const code = (await reveal.json()).code;
  const child = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const game = await child.newPage();
  const submittedBodies: string[] = [];
  let lostAck = false;
  if (mode === 'offline-interrupted-lost-ack') await game.route('**/sessions/*/results', async route => {
    submittedBodies.push(route.request().postData()!);
    if (!lostAck) {
      const accepted = await route.fetch();
      expect([200, 201]).toContain(accepted.status());
      lostAck = true;
      await route.abort('failed');
    } else await route.continue();
  });
  await game.goto(playOrigin);
  await game.getByLabel('Código de actividad', { exact: true }).fill(code);
  const claimed = game.waitForResponse(r => r.url().endsWith('/access/claim') && r.request().method() === 'POST');
  await game.getByRole('button', { name: 'Continuar', exact: true }).click();
  const claim = await claimed;
  expect(claim.ok(), `Claim HTTP ${claim.status()}${claim.ok() ? '' : `: ${(await claim.json()).code}`}`).toBe(true);
  await game.getByRole('button', { name: 'Entrar al laboratorio' }).click();
  await game.clock.install();
  await game.getByRole('button', { name: 'Practicar', exact: true }).click();
  for (const item of profile.config.bank.practice) {
    await game.clock.runFor(1000 + (item.load + 1) * 3000 + 100);
    await game.locator('.mentalista-option').nth(item.correctIdx).click();
    await game.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  const delivered = game.waitForResponse(r => r.url().endsWith('/results') && r.request().method() === 'POST', { timeout: 180000 });
  await game.getByRole('button', { name: 'Comenzar actividad', exact: true }).click();
  await expect(game.locator('.mentalista-board')).toHaveText('3');
  await game.clock.runFor(3000);
  await expect(game.locator('.mentalista-measuring')).toBeVisible();
  for (let n = 0; n < (mode === 'complete' ? 12 : 1); n++) {
    for (let step = 0; step < 40 && !await game.locator('.mentalista-option').count(); step++) await game.clock.runFor(500);
    await expect(game.locator('.mentalista-option'), `Item ${n + 1}: ${await game.locator('main').innerText()}`).toHaveCount(4);
    await game.clock.runFor(500); await game.keyboard.press('1'); await game.clock.runFor(500);
  }
  if (mode === 'offline-interrupted-lost-ack') {
    await child.setOffline(true);
    await game.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(game.getByRole('heading', { name: 'La actividad se interrumpió', exact: true })).toBeVisible();
    await expect(game.getByRole('heading', { name: 'Tus resultados se guardaron', exact: true })).toHaveCount(0);
    const understood = game.getByRole('button', { name: 'Entendido', exact: true });
    if (await understood.count()) await understood.click();
    await child.setOffline(false);
    await expect.poll(() => lostAck).toBe(true);
    await expect(game.getByRole('button', { name: 'Reintentar envío', exact: true })).toBeVisible();
    await game.getByRole('button', { name: 'Reintentar envío', exact: true }).click();
  }
  const saved = await delivered; expect([200, 201]).toContain(saved.status());
  const envelope = mentalistaEnvelopeSchema.parse(saved.request().postDataJSON()), receipt = await saved.json();
  expect(envelope.state).toBe(mode === 'complete' ? 'completed' : 'interrupted');
  if (mode === 'complete') expect(envelope.events).toHaveLength(12);
  else {
    expect(envelope.terminationReason).toBe('focus_lost');
    expect(envelope.events.length).toBeLessThan(12);
    expect(submittedBodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(submittedBodies).size).toBe(1);
  }
  expect(receipt.submissionId).toBe(envelope.submissionId);
  await expect(game.getByRole('heading', { name: 'Tus resultados se guardaron', exact: true })).toBeVisible();
  await expect.poll(async () => (await (await teacher.request.get(`${apiOrigin}/api/v1/task-sessions/${envelope.sessionId}`)).json()).processingStatus, { timeout: 30000 }).toBe('COMPLETED');
  await page.goto(`${teacherOrigin}/academico/cursos/${user.groupId}/estudiantes/${user.studentId}/tareas/${envelope.sessionId}`);
  await expect(page.getByRole('heading', { name: 'Mentalista · resultados por intento' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Indicadores completos de Mentalista' })).toContainText('Diferencia de precisión');
  await expect(page.getByRole('region', { name: 'Ítems de Mentalista', exact: true })).toContainText('Incluido');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `integration-results/mentalista-${mode}-detail-${width}.png`, fullPage: true });
  }
  await page.goto(`${teacherOrigin}/academico/cursos/${user.groupId}/estudiantes/${user.studentId}/indicadores`);
  await page.getByLabel('Tarea digital', { exact: true }).selectOption('TG-03');
  await expect(page.getByRole('region', { name: 'Historia de Mentalista', exact: true })).toContainText('TG03-DESCRIPTIVE-1');
  await page.getByLabel('Alcance', { exact: true }).selectOption('LOAD_4');
  await expect(page.getByRole('region', { name: 'Historia de Mentalista', exact: true })).toContainText('carga 4');
  await page.getByLabel('Indicador', { exact: true }).selectOption('delta_precision_pts');
  await expect(page.getByLabel('Alcance', { exact: true })).toHaveValue('SESSION');
  await page.goto(`${teacherOrigin}/indicadores/TG-03/delta_precision_pts`);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Ficha de indicador');
  await expect(page.locator('main')).toContainText('Puntos porcentuales');
  const other = await browser.newContext();
  const deniedLogin = await other.request.post(`${apiOrigin}/api/auth/sign-in/email`, { headers: { origin: teacherOrigin }, data: { email: fixtures.teachers[1].email, password: fixtures.teachers[1].password } });
  expect(deniedLogin.status()).toBe(200);
  expect((await other.request.get(`${apiOrigin}/api/v1/task-sessions/${envelope.sessionId}`)).status()).toBe(404);
  await other.close(); await child.close(); await teacher.close();
});
