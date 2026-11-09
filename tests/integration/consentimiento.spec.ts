import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Opt-in, existing synthetic rehearsal only. No traces/screenshots containing capabilities.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const root = process.env.KUDLAB_CONSENT_FIXTURE_DIR;
type Fixtures = { groupId: string; versionId: string; items: { scenario: string; studentId: string; recordId: string }[] };
async function pending(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('kudlab-play-runtime'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise<{ sessionId: string; hash: string; envelope: { submissionId: string }; state: string }[]>((resolve, reject) => {
      const r = db.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    db.close(); return rows.map(r => ({ sessionId: r.sessionId, hash: r.hash, submissionId: r.envelope.submissionId }));
  });
}
function expire(sessionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid fixture ID');
  execFileSync('docker', ['--context', 'desktop-linux', 'exec', 'feat-consentimiento-phase-b-postgres-1', 'psql', '-U', 'kudlab', '-d', 'kudlab_consentimiento_phase_b', '-v', 'ON_ERROR_STOP=1', '-c',
    `update task_runtime_capabilities set expires_at=now()-interval '1 second' where session_id='${sessionId}'`], { stdio: 'pipe' });
}
for (const scenario of ['blocked', 'online', 'offline', 'expired', 'lost']) {
  test(`CA-04/05/06 consentimiento real: ${scenario}`, async ({ page, context, request }) => {
    test.skip(!root, 'Requires explicit private synthetic fixture directory');
    const fixtures = JSON.parse(readFileSync(process.env.KUDLAB_CONSENT_FIXTURES ?? `${root}/phase-d/fixtures.json`, 'utf8')) as Fixtures;
    const configuration = JSON.parse(readFileSync(`${root}/phase-b/accounts.json`, 'utf8')) as { api: string; frontend: string; actors: { email: string; password: string }[] };
    const api = configuration.api, play = process.env.KUDLAB_PLAY_ORIGIN ?? 'http://127.0.0.1:4212';
    expect(new URL(api).hostname).toBe('localhost'); expect(new URL(play).hostname).toBe('127.0.0.1');
    const f = fixtures.items.find(item => item.scenario === scenario)!;
    const teacherHeaders = { origin: configuration.frontend };
    const actor = configuration.actors[1]!;
    const login = await request.post(`${api}/api/auth/sign-in/email`, { headers: teacherHeaders, data: { email: actor.email, password: actor.password } });
    expect(login.status()).toBe(200);
    const post = (path: string, data: unknown) => request.post(`${api}/api/v1${path}`, { headers: teacherHeaders, data });
    const snapshot = await request.get(`${api}/api/v1/students/${f.studentId}/consents`, { headers: teacherHeaders });
    const before = await snapshot.json();
    expect(before.consent.state, 'Fixture already consumed; prepare a new isolated rehearsal instead of replaying mutations').toBe('CURRENT');
    const assigned = await post('/task-assignments', { requestId: randomUUID(), taskId: 'TG-01', publishedVersionId: fixtures.versionId,
      groupId: fixtures.groupId, studentIds: [f.studentId], startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), maxAttempts: 2 });
    expect(assigned.status()).toBe(201); const assignment = await assigned.json();
    const issued = await post(`/task-assignments/${assignment.id}/access-codes`, { requestId: randomUUID(), recipientIds: [assignment.recipients[0].id] });
    expect(issued.status()).toBe(201); const metadata = (await issued.json()).items[0];
    const reveal = await post(`/task-access-codes/${metadata.id}/reveal`, {}); expect(reveal.status()).toBe(200);
    await page.goto(play);
    await page.getByLabel('Código de actividad', { exact: true }).fill((await reveal.json()).code);
    const claimed = page.waitForResponse(r => r.url().endsWith('/game-runtime/access/claim') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const claim = await claimed; expect(claim.status()).toBe(200); const sessionId = (await claim.json()).sessionId as string;
    await expect(page.getByRole('button', { name: 'Comenzar', exact: true })).toBeEnabled();
    const revoke = async () => { const r = await post(`/students/${f.studentId}/consents/revocations`, { requestId: randomUUID(), expectedVersion: before.consent.version, recordId: f.recordId, reason: `Ensayo ficticio D ${scenario}` }); expect(r.status()).toBe(200); };
    if (scenario === 'blocked') {
      await revoke();
      const start = page.waitForResponse(r => r.url().endsWith('/start') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Comenzar', exact: true }).click(); expect((await start).status()).toBe(403);
      await expect(page.locator('canvas')).toHaveCount(0);
      const detail = await request.get(`${api}/api/v1/task-sessions/${sessionId}`, { headers: teacherHeaders }); expect((await detail.json()).attemptNumber).toBeNull(); return;
    }
    await page.getByRole('button', { name: 'Comenzar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Terminar actividad', exact: true })).toBeVisible();
    await revoke();
    let posts = 0, commits = 0, firstBody: string | null = null;
    let savedIdentity: { sessionId: string; hash: string; submissionId: string } | undefined;
    if (scenario === 'lost') {
      await page.route('**/game-runtime/sessions/*/receipt?*', route => route.abort());
      await page.route('**/game-runtime/sessions/*/results', async route => {
        posts++;
        if (posts === 1) {
          firstBody = route.request().postData(); const response = await route.fetch(); expect(response.status()).toBe(201);
          commits++; expire(sessionId); await route.abort();
        } else {
          expect(route.request().postData() === firstBody).toBe(true);
          const response = await route.fetch(); expect(response.status()).toBe(401); await route.fulfill({ response });
        }
      });
    }
    if (scenario === 'offline') await context.setOffline(true);
    if (scenario === 'expired') expire(sessionId);
    await page.getByRole('button', { name: 'Terminar actividad', exact: true }).click();
    await page.getByRole('button', { name: 'Sí, terminar', exact: true }).click();
    if (scenario === 'offline' || scenario === 'expired' || scenario === 'lost') {
      await expect.poll(async () => (await pending(page)).length).toBe(1);
      const saved = await pending(page); expect(saved[0]!.sessionId).toBe(sessionId);
      savedIdentity = saved[0]; expect(savedIdentity!.hash).toMatch(/^[a-f0-9]{64}$/);
      if (scenario === 'offline') {
        await page.reload(); await expect.poll(() => pending(page)).toEqual(saved); await expect(page.locator('canvas')).toHaveCount(0); await context.setOffline(false);
      } else if (scenario === 'expired') {
        await expect(page.getByText('Necesitamos ayuda de tu profesor para enviar los resultados', { exact: true })).toBeVisible();
        await page.goto(`${play}/pendientes`);
        const recovery = await post(`/task-sessions/${sessionId}/access-recovery-codes`, { requestId: randomUUID() }); expect(recovery.status()).toBe(201);
        const r = await post(`/task-access-codes/${(await recovery.json()).id}/reveal`, {}); expect(r.status()).toBe(200);
        await page.getByLabel('Código para enviar', { exact: true }).fill((await r.json()).code);
        await page.getByRole('button', { name: 'Enviar pendiente', exact: true }).click();
      } else {
        await expect.poll(() => commits).toBe(1); await expect.poll(() => pending(page)).toEqual(saved);
        await page.unroute('**/game-runtime/sessions/*/receipt?*'); await page.reload();
      }
    }
    await expect.poll(async () => (await pending(page)).length, { timeout: 30000 }).toBe(0);
    const detail = await request.get(`${api}/api/v1/task-sessions/${sessionId}`, { headers: teacherHeaders });
    const result = await detail.json(); expect(result.attemptNumber).toBe(1); expect(result.receipt.sessionId).toBe(sessionId);
    if (savedIdentity) { expect(result.receipt.evidenceHash).toBe(savedIdentity.hash); expect(result.receipt.submissionId).toBe(savedIdentity.submissionId); }
    if (scenario === 'lost') expect(commits).toBe(1);
    await expect(page.locator('canvas')).toHaveCount(0);
  });
}
