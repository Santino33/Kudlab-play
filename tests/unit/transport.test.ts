import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Api } from '../../src/delivery/api';
import { Delivery } from '../../src/delivery/outbox';
import { acceptsAuthorization } from '../../src/bridge/supervised';
import { Session } from '../../src/runtime/session';
import { Database, type Store } from '../../src/storage/database';
import { Journal } from '../../src/evidence/journal';
import type { Outbox } from '../../src/evidence/journal';
import { hash, newSecret } from '../../src/contract/canonical';
import { contextFixture, envelopeFixture, sessionId } from '../fixtures/context';

describe('API y autorización', () => {
  it('usa omit/no-store y valida el hash de configuración', async () => {
    const c = contextFixture(); c.configurationHash = await hash(c.config);
    const api = new Api('http://localhost:3000', async (_input, init) => {
      expect(init?.credentials).toBe('omit'); expect(init?.cache).toBe('no-store');
      return Response.json(c);
    });
    expect((await api.claim(newSecret(), crypto.randomUUID(), newSecret())).sessionId).toBe(sessionId);
    c.configurationHash = 'b'.repeat(64);
    await expect(api.context(sessionId, newSecret())).rejects.toThrow('CONFIGURATION_HASH_MISMATCH');
  });
  it('conserva claim/secreto tras respuesta perdida y no canjea offline', async () => {
    const db = await Database.open(crypto.randomUUID());
    let online = true;
    const ids: unknown[] = [];
    const c = contextFixture(); c.configurationHash = await hash(c.config);
    const s = new Session(db, new Api('http://localhost', async (_url, init) => {
      ids.push(JSON.parse(init?.body as string));
      if (ids.length === 1) throw new TypeError('network');
      return Response.json(c);
    }), 'tab', () => online);
    await expect(s.claim(newSecret())).rejects.toThrow();
    const pending = await db.all('credentials'); expect(pending).toHaveLength(1);
    await s.reconcileClaims(true);
    expect(ids[0]).toEqual(ids[1]);
    expect(await db.get('credentials', sessionId)).toBeDefined();
    online = false;
    await expect(s.claim(newSecret())).rejects.toThrow('ONLINE_REQUIRED');
    expect(ids).toHaveLength(2);
  });
  it('bridge requiere origen, source, bridgeId y forma exactos', () => {
    const source = {};
    const data = { type: 'LAUNCH_AUTHORIZATION', bridgeId: crypto.randomUUID(), launchGrant: newSecret() };
    const valid = { origin: 'https://teacher.example', source, data };
    expect(acceptsAuthorization(valid, 'https://teacher.example', source, data.bridgeId)).toBe(true);
    for (const bad of [{ ...valid, origin: 'https://evil.example' }, { ...valid, source: {} },
      { ...valid, data: { ...data, bridgeId: crypto.randomUUID() } }, { ...valid, data: { ...data, extra: 1 } }]) {
      expect(acceptsAuthorization(bad, 'https://teacher.example', source, data.bridgeId)).toBe(false);
    }
  });
  it('denegación de claim detiene reintentos automáticos', async () => {
    const db = await Database.open(crypto.randomUUID()); let requests = 0;
    const s = new Session(db, new Api('http://localhost', async () => {
      requests++; return Response.json({ code: 'PARTICIPATION_BLOCKED', message: 'fixed' }, { status: 403 });
    }), 'tab', () => true);
    await expect(s.claim(newSecret())).rejects.toThrow();
    await s.reconcileClaims(); await s.reconcileClaims();
    expect(requests).toBe(1);
  });
});
async function pending() {
  const db = await Database.open(crypto.randomUUID());
  const c = contextFixture(); const e = envelopeFixture();
  const j = new Journal(db, c);
  await j.create({ clock: e.clock, device: e.device, startedAtMs: 1000, checkpointAtMs: 8000,
    events: e.events, incidents: e.incidents, terminationReason: 'user_exit' });
  const out = await j.finalize();
  await db.put('credentials', { key: sessionId, phase: 'START_CONFIRMED', context: c, runtimeSecret: newSecret(), claimId: crypto.randomUUID() });
  return { db, out };
}
describe('bandeja y acuses', () => {
  it('automatically confirms a lost ACK after submission permission expires, without renewing credentials', async () => {
    const { db, out } = await pending(), calls: { method?: string; body?: unknown }[] = [];
    const credential = await db.get('credentials', sessionId);
    const receipt = { receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId, evidenceHash: out.hash, receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' };
    const d = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      calls.push({ method: init?.method, body: init?.body });
      return init?.method === 'POST' ? Response.json({ code: 'RUNTIME_UNAUTHENTICATED' }, { status: 401 }) : Response.json({ receipt });
    }), 'owner');
    expect(await d.send(sessionId)).toBe('SAVED');
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET']); expect(calls[0].body).toBe(out.body);
    expect(await db.get('outbox', sessionId)).toBeUndefined();
    expect(await db.get('credentials', sessionId)).toBeUndefined();
    expect(credential).toBeDefined(); expect((await db.get<{ receipt: unknown }>('receipts', sessionId))?.receipt).toEqual(receipt);
  });
  it('upgrades an old AUTH_REQUIRED pending package with a read-only check, without another POST', async () => {
    const { db, out } = await pending();
    await db.put('outbox', { ...out, status: 'AUTH_REQUIRED', lastErrorCode: 'RUNTIME_UNAUTHENTICATED' });
    const d = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      expect(init?.method).toBe('GET');
      return Response.json({ receipt: { receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId, evidenceHash: out.hash, receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
    }), 'owner');
    expect(await d.send(sessionId)).toBe('SAVED');
  });
  it.each(['absent', 'revoked', 'mismatch', 'malformed', 'rate_limit'])('automatic receipt check preserves evidence on %s and never renews authorization', async scenario => {
    const { db, out } = await pending(); let calls = 0;
    const d = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      calls++;
      if (init?.method === 'POST') return Response.json({ code: 'RUNTIME_UNAUTHENTICATED' }, { status: 401 });
      if (scenario === 'revoked') return Response.json({ code: 'RUNTIME_UNAUTHENTICATED' }, { status: 401 });
      if (scenario === 'absent') return Response.json({ receipt: null });
      if (scenario === 'malformed') return Response.json({ ok: true });
      if (scenario === 'rate_limit') return Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '90' } });
      return Response.json({ receipt: { receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId, evidenceHash: 'f'.repeat(64), receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
    }), 'owner', () => 1000, () => .5);
    const expected = scenario === 'mismatch' ? 'BLOCKED' : scenario === 'malformed' || scenario === 'rate_limit' ? 'PENDING' : 'AUTH_REQUIRED';
    expect(await d.send(sessionId)).toBe(expected);
    expect((await db.get<Outbox>('outbox', sessionId))?.body).toBe(out.body);
    expect(await db.get('receipts', sessionId)).toBeUndefined();
    await d.send(sessionId); expect(calls).toBe(2);
    if (scenario === 'rate_limit') expect((await db.get<Outbox>('outbox', sessionId))?.nextAttemptAt).toBe(91000);
  });
  it('recovery replaces only the matching local capability and unblocks identical evidence', async () => {
    const { db, out } = await pending();
    await db.put('outbox', { ...out, status: 'AUTH_REQUIRED' });
    const c = contextFixture(); c.configurationHash = await hash(c.config);
    // Match the stored evidence's historical profile, without changing its body/hash.
    const stored = await db.get<Outbox>('outbox', sessionId);
    c.configurationHash = stored!.envelope.configurationHash;
    c.attemptNumber = 1; c.executionStatus = 'INTERRUPTED'; c.uploadAllowedUntil = '2026-11-01T12:00:00.000Z';
    c.capabilities = { canStart: false, canSubmit: true, canReadReceipt: true };
    // The fixture's placeholder hash is replaced consistently before closing the journal below.
    const validHash = await hash(c.config);
    const validOut = { ...stored!, envelope: { ...stored!.envelope, configurationHash: validHash } };
    validOut.body = JSON.stringify(validOut.envelope); validOut.hash = await hash(validOut.envelope);
    await db.put('outbox', validOut); c.configurationHash = validHash;
    const s = new Session(db, new Api('http://localhost', async () => Response.json(c)), 'recovery', () => true);
    await s.claim(newSecret());
    expect((await db.get<Outbox>('outbox', sessionId))?.status).toBe('PENDING');
    expect((await db.get<Outbox>('outbox', sessionId))?.body).toBe(validOut.body);
    expect((await db.get<{ phase: string; context: typeof c }>('credentials', sessionId))?.context.capabilities.canStart).toBe(false);
  });
  it('recovery without the original local evidence cannot create a game or loop claims', async () => {
    const db = await Database.open(crypto.randomUUID()), c = contextFixture(); let calls = 0;
    c.configurationHash = await hash(c.config); c.attemptNumber = 1; c.uploadAllowedUntil = '2026-11-01T12:00:00.000Z'; c.capabilities = { canStart: false, canSubmit: true, canReadReceipt: true };
    const s = new Session(db, new Api('http://localhost', async () => { calls++; return Response.json(c); }), 'recovery', () => true);
    await expect(s.claim(newSecret())).rejects.toThrow('LOCAL_EVIDENCE_NOT_FOUND');
    await s.reconcileClaims(true); expect(calls).toBe(1); expect(await db.all('outbox')).toEqual([]);
  });
  it('marca SENDING y solo permite una solicitud en vuelo por sesión', async () => {
    const { db, out } = await pending();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const d = new Delivery(db, new Api('http://localhost', async () => {
      entered(); await gate;
      return Response.json({ receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId,
        evidenceHash: out.hash, receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' });
    }), 'owner');
    const sending = d.send(sessionId, true); await started;
    expect((await db.get<Outbox>('outbox', sessionId))?.status).toBe('SENDING');
    expect(await d.send(sessionId, true)).toBe('BUSY');
    release(); expect(await sending).toBe('SAVED');
  });
  it('commit con respuesta perdida reenvía bytes/identidad/hash idénticos y limpia tras acuse', async () => {
    const { db, out } = await pending(); let count = 0; const bodies: string[] = [];
    const receipt = { receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId,
      evidenceHash: out.hash, receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' };
    const d = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      bodies.push(init?.body as string); count++;
      if (count === 1) throw new TypeError('lost response after commit');
      return Response.json(receipt);
    }), 'owner', () => 1000, () => 0.5);
    expect(await d.send(sessionId, true)).toBe('PENDING');
    expect((await db.get('outbox', sessionId))).toBeDefined();
    expect(await d.send(sessionId, true)).toBe('SAVED');
    expect(bodies[0]).toBe(bodies[1]); expect(bodies[0]).toBe(out.body);
    expect(await db.get('outbox', sessionId)).toBeUndefined();
  });
  it.each([401, 403, 409, 400, 413])('HTTP %s preserva y bloquea sin usar otra capacidad', async status => {
    const { db, out } = await pending();
    const d = new Delivery(db, new Api('http://localhost', async () => Response.json({ code: 'FIXED', message: 'error' }, { status })), 'owner');
    expect(await d.send(sessionId, true)).toBe(status === 401 || status === 403 ? 'AUTH_REQUIRED' : 'BLOCKED');
    expect((await db.get<typeof out>('outbox', sessionId))?.hash).toBe(out.hash);
  });
  it('2xx sin acuse no borra respaldo y Retry-After se respeta', async () => {
    const { db } = await pending();
    const api = new Api('http://localhost', async () => Response.json({ ok: true }));
    const d = new Delivery(db, api, 'owner', () => 1000, () => 0.5);
    expect(await d.send(sessionId, true)).toBe('PENDING');
    expect(await db.get('outbox', sessionId)).toBeDefined();
    const limited = new Delivery(db, new Api('http://localhost', async () => Response.json({ code: 'RATE_LIMITED', message: 'error' }, { status: 429, headers: { 'Retry-After': '90' } })), 'owner', () => 1000, () => 0.5);
    await limited.send(sessionId, true);
    expect((await db.get<Outbox>('outbox', sessionId))?.nextAttemptAt).toBe(91000);
  });
  it('emisor obsoleto no resucita un pendiente ya confirmado y limpiado', async () => {
    const { db, out } = await pending();
    const d = new Delivery(db, new Api('http://localhost', async () => {
      // Another tab obtained a receipt while this tab was suspended with a request in flight.
      await db.put('receipts', { key: sessionId, receipt: { receiptId: crypto.randomUUID(), sessionId,
        submissionId: out.envelope.submissionId, evidenceHash: out.hash,
        receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' } });
      await db.remove('outbox', sessionId);
      return Response.json({ code: 'UNAVAILABLE', message: 'fixed' }, { status: 503 });
    }), 'owner');
    expect(await d.send(sessionId, true)).toBe('SAVED');
    expect(await db.get('outbox', sessionId)).toBeUndefined();
  });
  it('acuse comprometido sobrevive al fallo de limpieza y no provoca otro POST', async () => {
    const { db, out } = await pending(); let calls = 0;
    const transact = db.transaction.bind(db); let failCleanup = true;
    db.transaction = async <T>(stores: Store[], action: (tx: IDBTransaction) => Promise<T>, mode?: IDBTransactionMode): Promise<T> => {
      if (failCleanup && stores.includes('outbox') && stores.includes('trials')) { failCleanup = false; throw new DOMException('quota', 'QuotaExceededError'); }
      return transact(stores, action, mode);
    };
    const d = new Delivery(db, new Api('http://localhost', async () => {
      calls++; return Response.json({ receiptId: crypto.randomUUID(), sessionId, submissionId: out.envelope.submissionId,
        evidenceHash: out.hash, receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' });
    }), 'owner');
    expect(await d.send(sessionId, true)).toBe('SAVED');
    expect(await db.get('receipts', sessionId)).toBeDefined(); expect(await db.get('outbox', sessionId)).toBeDefined();
    expect(await d.send(sessionId, true)).toBe('SAVED');
    expect(await db.get('outbox', sessionId)).toBeUndefined(); expect(calls).toBe(1);
  });
});
