import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const teacherOrigin = process.env.KUDLAB_TEACHER_ORIGIN ?? 'http://localhost:5196';
const apiOrigin = process.env.KUDLAB_API_ORIGIN ?? 'http://localhost:4326';
const playOrigin = process.env.KUDLAB_PLAY_ORIGIN ?? 'http://127.0.0.1:4196';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
async function register(page: Page, coursePath: string, firstName: string) {
  await page.goto(`${teacherOrigin}${coursePath}/estudiantes/nuevo`);
  await page.locator('#student-studentCode').fill(`SYNTHETIC-${randomUUID()}`);
  await page.locator('#student-firstName').fill(firstName);
  await page.locator('#student-lastName').fill('De prueba');
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/students');
  await page.getByRole('button', { name: 'Registrar estudiante', exact: true }).click();
  const r = await response; expect(r.status()).toBe(201);
  const student = await r.json(); expect(student.isActive).toBe(true);
  await expect(page.getByRole('heading', { name: `${firstName} De prueba`, exact: true })).toBeVisible();
  return student.id as string;
}
async function form(page: Page, coursePath: string, name: string) {
  await page.goto(`${teacherOrigin}${coursePath}/asignaciones`);
  await page.getByRole('button', { name: 'Asignar actividad', exact: true }).click();
  await page.getByLabel(new RegExp(name)).check();
  await page.getByLabel('Disponible desde').fill(localDate(new Date(Date.now() - 60000)));
  await page.getByLabel('Disponible hasta').fill(localDate(new Date(Date.now() + 3600000)));
  await page.getByLabel('Máximo de intentos').fill('2');
}

test('empty course → new enabled synthetic student → assignment/code → Play receipt; participation rejection stays local', async ({ page: teacher, browser }) => {
  test.setTimeout(90000);
  for (const value of [teacherOrigin, apiOrigin, playOrigin]) expect(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value)).toBe(true);
  await teacher.goto(teacherOrigin);
  await teacher.getByLabel('Correo', { exact: true }).fill('teacher-a@pilot.edu.co');
  await teacher.getByLabel('Contraseña', { exact: true }).fill('TeacherPass1');
  await teacher.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await teacher.getByRole('link', { name: 'Mis cursos', exact: true }).first().click();
  await teacher.locator('.course-card').filter({ has: teacher.getByRole('heading', { name: 'A2', exact: true }) }).getByRole('link', { name: 'Abrir curso', exact: true }).click();
  await expect(teacher.getByText('Este curso aún no tiene estudiantes', { exact: true })).toBeVisible();
  const coursePath = new URL(teacher.url()).pathname, groupId = coursePath.split('/').at(-1)!;
  const studentId = await register(teacher, coursePath, 'Nuevo ficticio');
  const creates: string[] = [];
  teacher.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/task-assignments') creates.push(r.postData()!); });
  await form(teacher, coursePath, 'Nuevo ficticio');
  await teacher.getByRole('button', { name: 'Guardar asignación y códigos', exact: true }).evaluate(button => { if (button instanceof HTMLButtonElement) { button.click(); button.click(); } });
  const codeElement = teacher.locator('.access-code-row .classroom-code[data-state="ready"]');
  await expect(codeElement).toHaveCount(1);
  const code = (await codeElement.textContent())!;
  expect(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code)).toBe(true);
  expect(creates.length).toBe(1);
  const child = await browser.newContext();
  try {
    const student = await child.newPage();
    expect((await child.cookies(apiOrigin)).length).toBe(0);
    await student.goto(playOrigin, { waitUntil: 'domcontentloaded' });
    await student.getByLabel('Código de actividad', { exact: true }).fill(code);
    await student.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(student.getByRole('button', { name: 'Comenzar', exact: true })).toBeEnabled();
    await student.getByRole('button', { name: 'Comenzar', exact: true }).click();
    await expect(student.locator('canvas')).toBeVisible();
    await student.getByRole('button', { name: 'Terminar actividad', exact: true }).click();
    const receipt = student.waitForResponse(r => r.request().method() === 'POST' && /\/game-runtime\/sessions\/[^/]+\/results$/.test(new URL(r.url()).pathname));
    await student.getByRole('button', { name: 'Sí, terminar', exact: true }).click();
    expect((await receipt).status()).toBe(201);
    const sessions = await (await teacher.request.get(`${apiOrigin}/api/v1/students/${studentId}/task-sessions`)).json();
    expect(sessions.items.length).toBe(1);
    const session = sessions.items[0];
    expect(session.attemptNumber).toBe(1); expect(session.executionStatus).toBe('INTERRUPTED'); expect(session.launchMode).toBe('CODE');
    await expect.poll(async () => (await (await teacher.request.get(`${apiOrigin}/api/v1/task-sessions/${session.id}`)).json()).processingStatus, { timeout: 15000 }).toBe('COMPLETED');
    await teacher.goto(`${teacherOrigin}${coursePath}/estudiantes/${studentId}/tareas/${session.id}`);
    await expect(teacher.getByText('Procesamiento completado', { exact: true })).toBeVisible();
  } finally { await child.close(); }

  const secondId = await register(teacher, coursePath, 'Revocado ficticio');
  await form(teacher, coursePath, 'Revocado ficticio');
  expect((await teacher.request.post(`${apiOrigin}/api/v1/students/${secondId}/deactivate`, { headers: { Origin: teacherOrigin } })).status()).toBe(200);
  await teacher.getByRole('button', { name: 'Guardar asignación y códigos', exact: true }).click();
  await expect(teacher.getByText('Participación no habilitada', { exact: true })).toBeVisible();
  await expect(teacher.getByRole('heading', { name: 'No tienes acceso a este destino', exact: true })).toHaveCount(0);
  await expect(teacher.getByLabel(/Revocado ficticio/)).toBeDisabled();
  await teacher.getByRole('button', { name: 'Seleccionar todos los actuales', exact: true }).click();
  await expect(teacher.getByLabel(/Nuevo ficticio/)).toBeChecked();
  await expect(teacher.getByLabel(/Revocado ficticio/)).not.toBeChecked();
  expect(await teacher.evaluate(() => Object.keys(sessionStorage).some(k => k.startsWith('kudlab:j02:assignment:')))).toBe(false);
  for (const width of [320, 1440]) {
    await teacher.setViewportSize({ width, height: 1000 });
    expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await teacher.screenshot({ path: `test-results/kudlab-integration/new-student-local-rejection-${width}.png`, fullPage: true });
  }
  await teacher.getByRole('link', { name: 'Mis cursos', exact: true }).first().click();
  await expect(teacher.getByRole('heading', { name: 'Mis cursos', exact: true })).toBeVisible();
  const assignments = await (await teacher.request.get(`${apiOrigin}/api/v1/task-assignments?groupId=${groupId}`)).json();
  expect(assignments.items.length).toBe(1);
});
