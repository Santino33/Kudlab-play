import { chromium, test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
const teacherOrigin = process.env.KUDLAB_TEACHER_ORIGIN ?? 'http://localhost:5183';
const apiOrigin = process.env.KUDLAB_API_ORIGIN ?? 'http://localhost:4313';
const playOrigin = process.env.KUDLAB_PLAY_ORIGIN ?? 'http://127.0.0.1:4183';
test.use({ trace: 'off', screenshot: 'off', video: 'off' }); // Never retain usable access codes in failure traces.
async function login(page: Page) {
  await page.goto(teacherOrigin); await page.getByLabel('Correo', { exact: true }).fill('teacher-a@pilot.edu.co');
  await page.getByLabel('Contraseña', { exact: true }).fill('TeacherPass1'); await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.getByRole('link', { name: 'Mis cursos', exact: true }).first().click();
  await page.locator('.course-card').filter({ has: page.getByRole('heading', { name: 'A1', exact: true }) }).getByRole('link', { name: 'Abrir curso', exact: true }).click();
}
async function outbox(page: Page): Promise<{ sessionId: string; body: string; hash: string; envelope: { submissionId: string } }[]> {
  return page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('kudlab-play-runtime'); open.onsuccess = () => { const db = open.result, r = db.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => { resolve(r.result); db.close(); }; }; }));
}
async function enter(page: Page, code: string) {
  await page.goto(playOrigin); await page.getByLabel('Código de actividad', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toBeEnabled();
}
async function touchShape(page: Page, kind: 'star' | 'moon') {
  let point: { x: number; y: number } | null = null;
  await expect.poll(async () => {
    point = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement, type) => {
      const ctx = canvas.getContext('2d')!, bounds = canvas.getBoundingClientRect(), data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const color = type === 'star' ? [248, 210, 120] : [232, 240, 239];
      for (let y = Math.round(180 * canvas.height / bounds.height); y < canvas.height - 80; y += 3) for (let x = 10; x < canvas.width - 10; x += 3) {
        const at = (y * canvas.width + x) * 4;
        if (color.every((v, n) => data[at + n] === v)) return { x: x * bounds.width / canvas.width, y: y * bounds.height / canvas.height };
      }
      return null;
    }, kind);
    return Boolean(point);
  }, { timeout: 40000, intervals: [100, 150, 200] }).toBe(true);
  await page.locator('canvas').click({ position: point! });
}
test('J03: código docente → perfil público independiente → desconexión/ACK perdido → consulta y recuperación sin otro intento', async ({ page: teacher, context: teacherContext }) => {
  test.setTimeout(360000);
  const backend = process.env.KUDLAB_J02_BACKEND_DIR, database = process.env.KUDLAB_J02_DATABASE_URL;
  expect(Boolean(backend && database), 'La demostración completa requiere CLI y BD sintética').toBe(true);
  await teacherContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: teacherOrigin });
  await login(teacher); await teacher.getByRole('link', { name: 'Asignaciones de tareas digitales' }).click(); await teacher.getByRole('button', { name: 'Asignar actividad', exact: true }).click();
  await teacher.getByLabel(/Participante Sintético A/).check(); await teacher.getByLabel(/Participante Sintético B/).check();
  const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  await teacher.getByLabel('Disponible desde').fill(localDate(new Date(Date.now() - 60000))); await teacher.getByLabel('Disponible hasta').fill(localDate(new Date(Date.now() + 3600000))); await teacher.getByLabel('Máximo de intentos').fill('3');
  await teacher.getByRole('button', { name: 'Guardar asignación', exact: true }).click();
  await teacher.getByLabel(/Participante Sintético A/).check(); await teacher.getByLabel(/Participante Sintético B/).check();
  await teacher.getByRole('button', { name: 'Generar accesos', exact: true }).click(); await teacher.getByRole('button', { name: 'Confirmar generación', exact: true }).click();
  const rowA = teacher.locator('.access-code-row').filter({ hasText: 'Participante Sintético A' }), rowB = teacher.locator('.access-code-row').filter({ hasText: 'Participante Sintético B' });
  await rowA.getByRole('button', { name: 'Copiar mensaje', exact: true }).click(); await expect(teacher.getByText(/Copiado. Compártelo/)).toBeVisible();
  const message = await teacher.evaluate(() => navigator.clipboard.readText()); expect(message.includes(`${playOrigin}/`)).toBe(true);
  const codeA = /código: ([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5})/.exec(message)?.[1]; expect(Boolean(codeA)).toBe(true);
  await rowB.getByRole('button', { name: 'Mostrar código', exact: true }).click(); const codeB = (await rowB.locator('strong').textContent())!;
  expect(await rowA.locator('strong').count()).toBe(0); await rowB.getByRole('button', { name: 'Ocultar código', exact: true }).click();
  const assignmentUrl = teacher.url();
  const profile = await mkdtemp('/tmp/opencode/kudlab-j03-public-');
  const launch = () => chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], viewport: { width: 1100, height: 850 } });
  let child: BrowserContext = await launch(); let student = child.pages()[0]!;
  try {
    expect(await child.cookies(apiOrigin)).toEqual([]);
    let cookieSent = false;
    child.on('request', req => { if (req.url().startsWith(`${apiOrigin}/api/v1/game-runtime/`) && req.headers().cookie) cookieSent = true; });
    await enter(student, codeA!); await student.getByRole('button', { name: 'Ver el ejemplo', exact: true }).click(); await student.getByRole('button', { name: 'Volver a las instrucciones', exact: true }).click();
    await student.getByRole('button', { name: 'Comenzar', exact: true }).click(); await expect(student.locator('canvas')).toBeVisible();
    await touchShape(student, 'star'); await touchShape(student, 'moon');
    await student.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await child.setOffline(true);
    await expect(student.getByRole('heading', { name: 'Terminaste la actividad', exact: true })).toBeVisible({ timeout: 130000 });
    const original = (await outbox(student))[0]!; expect(Boolean(original)).toBe(true);
    await student.reload(); await student.getByRole('link', { name: 'Enviar una actividad pendiente', exact: true }).click(); await expect(student.getByRole('heading', { name: 'Actividades pendientes', exact: true })).toBeVisible();
    expect((await outbox(student))[0]!.body === original.body).toBe(true);
    await child.close(); child = await launch(); student = child.pages()[0]!;
    let lost = false; const bodies: string[] = [];
    await child.route('**/game-runtime/sessions/*/results', async route => {
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      if (!lost && response.ok()) { lost = true; await route.abort('failed'); } else await route.fulfill({ response });
    });
    await student.goto(`${playOrigin}/pendientes`);
    await expect.poll(async () => (await outbox(student)).length, { timeout: 25000 }).toBe(0);
    expect(lost).toBe(true); expect(bodies.length).toBeGreaterThanOrEqual(2); expect(bodies.every(body => body === original.body)).toBe(true); expect(cookieSent).toBe(false);
    await teacher.bringToFront(); await teacher.goto(assignmentUrl); await teacher.locator('.activity-roster > li').filter({ hasText: 'Participante Sintético A' }).getByRole('link', { name: 'Ver sesiones', exact: true }).click();
    await teacher.getByRole('link', { name: 'Ver sesión', exact: true }).first().click();
    await expect.poll(async () => { const r = await teacher.request.get(`${apiOrigin}/api/v1/task-sessions/${original.sessionId}`); return (await r.json()).processingStatus; }, { timeout: 15000 }).toBe('COMPLETED');
    await teacher.getByRole('button', { name: 'Actualizar sesión', exact: true }).click(); await expect(teacher.getByText('Procesamiento completado', { exact: true })).toBeVisible();
    const evidence = await (await teacher.request.get(`${apiOrigin}/api/v1/task-sessions/${original.sessionId}/evidence?kind=trials&limit=100`)).json();
    const results = new Set(evidence.items.map((t: { result: string }) => t.result)); for (const result of ['hit', 'false_alarm', 'miss', 'correct_rejection']) expect(results.has(result), `Resultado clásico ${result}`).toBe(true);
    // Another activity is an explicit action, never a way to send A's results under B.
    await enter(student, codeB); await student.getByRole('button', { name: 'Comenzar', exact: true }).click(); await expect(student.locator('canvas')).toBeVisible();
    await child.unroute('**/game-runtime/sessions/*/results'); await child.route('**/game-runtime/sessions/*/results', route => route.abort('internetdisconnected'));
    await student.getByRole('button', { name: 'Terminar actividad', exact: true }).click(); await student.getByRole('button', { name: 'Sí, terminar', exact: true }).click();
    await expect(student.getByRole('button', { name: 'Reintentar envío', exact: true })).toBeVisible(); const partial = (await outbox(student))[0]!;
    execFileSync(process.execPath, ['--import', 'tsx', 'tests/game-expire-capability.ts', partial.sessionId], { cwd: backend, env: { ...process.env, DATABASE_URL: database } });
    await child.unroute('**/game-runtime/sessions/*/results'); await student.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(student.getByText('Necesitamos ayuda de tu profesor para enviar los resultados', { exact: true })).toBeVisible();
    await teacher.goto(assignmentUrl); await teacher.locator('.activity-roster > li').filter({ hasText: 'Participante Sintético B' }).getByRole('link', { name: 'Ver sesiones', exact: true }).click(); await teacher.getByRole('link', { name: 'Ver sesión', exact: true }).first().click();
    await teacher.getByRole('button', { name: 'Generar código de recuperación', exact: true }).click(); await teacher.getByRole('button', { name: 'Confirmar código de recuperación', exact: true }).click();
    const recoverySection = teacher.getByRole('heading', { name: 'Envío desde Kudlab Play', exact: true }).locator('..');
    await recoverySection.getByRole('button', { name: 'Mostrar código', exact: true }).click(); const recoveryCode = (await recoverySection.locator('strong').textContent())!; await recoverySection.getByRole('button', { name: 'Ocultar código', exact: true }).click();
    await student.goto(`${playOrigin}/pendientes`); await student.getByLabel('Código para enviar', { exact: true }).fill(recoveryCode); await student.getByRole('button', { name: 'Enviar pendiente', exact: true }).click();
    await expect.poll(async () => (await outbox(student)).length).toBe(0);
    const detail = await (await teacher.request.get(`${apiOrigin}/api/v1/task-sessions/${partial.sessionId}`)).json(); expect(detail.attemptNumber).toBe(1); expect(detail.launchMode).toBe('CODE'); expect(detail.executionStatus).toBe('INTERRUPTED');
    for (const width of [1440, 768, 390, 320]) {
      await student.setViewportSize({ width, height: 950 }); await student.goto(playOrigin); expect(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await student.screenshot({ path: `test-results/kudlab-integration/j03-public-${width}.png`, fullPage: true });
      await teacher.setViewportSize({ width, height: 950 }); await teacher.goto(assignmentUrl); await expect(teacher.getByRole('heading', { name: 'Accesos por código', exact: true })).toBeVisible(); await expect(teacher.locator('.access-code-row').first()).toBeVisible(); expect(await teacher.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await teacher.screenshot({ path: `test-results/kudlab-integration/j03-teacher-${width}.png`, fullPage: true });
    }
    await teacher.setViewportSize({ width: 1440, height: 1000 }); await teacher.goto(assignmentUrl);
    const oldRow = teacher.locator('.access-code-row').filter({ hasText: 'Participante Sintético A' }); await oldRow.getByRole('button', { name: 'Reemplazar', exact: true }).click(); await teacher.getByRole('button', { name: 'Reemplazar acceso', exact: true }).click();
    await student.goto(playOrigin); await student.getByLabel('Código de actividad', { exact: true }).fill(codeA!); await student.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(student.getByText(/No podemos abrir una actividad con este código/)).toBeVisible();
    await student.getByLabel('Código de actividad', { exact: true }).fill('');
  } finally { await child.close(); }
});
