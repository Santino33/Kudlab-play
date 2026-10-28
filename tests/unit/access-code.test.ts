import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { normalizeCode } from '../../src/runtime/access-code';
import { Api } from '../../src/delivery/api';
import { Session, type Credential } from '../../src/runtime/session';
import { Database } from '../../src/storage/database';
import { hash } from '../../src/contract/canonical';
import { viewportContextFixture } from '../fixtures/context';
describe('public code entry', () => {
  it('accepts five unambiguous ASCII characters and paste without Unicode substitutions', () => {
    expect(normalizeCode(' e-r d34 ')).toBe('ERD34');
    for (const value of ['ERD３4', 'ERD3O', 'ERD34\n', 'ßRD34', 'ERD345']) expect(() => normalizeCode(value)).toThrow();
  });
  it('persists only claim/secret, omits cookies/auth, re-enters same code after reload and never retries it automatically', async () => {
    const db = await Database.open(crypto.randomUUID()), c = viewportContextFixture(); c.configurationHash = await hash(c.config); c.startAllowedUntil = new Date(Date.now() + 900000).toISOString();
    let requests = 0; const bodies: unknown[] = [];
    const api = new Api('http://localhost', async (url, init) => {
      requests++; expect(String(url)).not.toContain('ERD34'); expect(init?.credentials).toBe('omit'); expect(init?.headers).not.toHaveProperty('Authorization');
      bodies.push(JSON.parse(init?.body as string)); if (requests === 1) throw new Error('reply lost'); return Response.json(c);
    });
    const s = new Session(db, api, 'owner', () => true);
    await expect(s.claimCode('ERD34')).rejects.toThrow(); expect(JSON.stringify(await db.all('credentials'))).not.toContain('ERD34');
    await s.reconcileClaims(true); expect(requests).toBe(1);
    const restored = new Session(db, api, 'other-document', () => true);
    await restored.claimCode('ERD34'); expect(bodies[1]).toEqual(bodies[0]);
    await restored.claimCode('ERD34'); expect(bodies[2]).toEqual(bodies[0]);
    expect((await db.get<Credential>('credentials', c.sessionId))?.runtimeSecret).toBeTruthy(); expect(JSON.stringify(await db.all('credentials'))).not.toContain('ERD34');
  });
  it('requires original local evidence before code recovery and respects Retry-After on manual retry', async () => {
    const db = await Database.open(crypto.randomUUID()); let requests = 0;
    const s = new Session(db, new Api('http://localhost', async () => { requests++; return Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '90' } }); }), 'owner', () => true);
    await expect(s.claimCode('ERD34', { sessionId: crypto.randomUUID(), submissionId: crypto.randomUUID() })).rejects.toThrow('LOCAL_EVIDENCE_NOT_FOUND'); expect(requests).toBe(0);
    await expect(s.claimCode('ERD34')).rejects.toThrow('RATE_LIMITED'); await expect(s.claimCode('ERD34')).rejects.toThrow('RATE_LIMITED'); expect(requests).toBe(1);
  });
});
