import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/storage/database';
import { Journal, type Snapshot } from '../../src/evidence/journal';
import { contextFixture, envelopeFixture } from '../fixtures/context';

let db: Database;
beforeEach(async () => { db = await Database.open(`test-${crypto.randomUUID()}`); });
function snapshot(): Snapshot {
  const e = envelopeFixture();
  return { clock: e.clock, device: e.device, startedAtMs: 1000, checkpointAtMs: 8000,
    events: e.events, incidents: [], terminationReason: null };
}
describe('diario transaccional', () => {
  it('recupera reloj anterior, no reanuda y reutiliza sobre e identidad de envío', async () => {
    const j = new Journal(db, contextFixture());
    await j.create(snapshot());
    const first = await j.recover();
    const second = await j.recover();
    expect(second).toEqual(first);
    expect(first.envelope.terminationReason).toBe('recovered_after_reload');
    expect(first.envelope.timing.finishedAtMs).toBe(8000);
    expect(first.envelope.clock.id).toBe(snapshot().clock.id);
    expect(first.envelope.events[0].result).toBe('hit');
    expect(first.envelope.incidents[0].atMs).toBeNull();
  });
  it('no retrocede checkpoint ni modifica sobre cerrado', async () => {
    const j = new Journal(db, contextFixture());
    await j.create(snapshot());
    await expect(j.checkpoint({ ...snapshot(), checkpointAtMs: 7000 })).rejects.toThrow('CHECKPOINT_REGRESSION');
    const result = await j.finalize({ ...snapshot(), terminationReason: 'user_exit' });
    await expect(j.checkpoint(snapshot())).rejects.toThrow('EXECUTION_TERMINAL');
    expect((await j.recover()).hash).toBe(result.hash);
  });
  it('nunca acepta checkpoint de un reloj de otro documento', async () => {
    const j = new Journal(db, contextFixture()); await j.create(snapshot());
    await expect(j.checkpoint({ ...snapshot(), clock: { ...snapshot().clock, id: crypto.randomUUID() } })).rejects.toThrow('CLOCK_MISMATCH');
  });
  it('cierra estímulos abiertos sin convertirlos en omisiones', async () => {
    const s = snapshot();
    s.events = [{ ...s.events[0], respondedAtMs: null, closedAtMs: null, result: null, closureReason: null, responseDevice: null }];
    const j = new Journal(db, contextFixture());
    await j.create(s);
    const out = await j.recover();
    expect(out.envelope.events[0].result).toBe('not_evaluated');
    expect(out.envelope.events[0].closureReason).toBe('interruption');
  });
  it('lease transaccional excluye otra pestaña y puede recuperarse al vencer', async () => {
    expect(await db.lease('execution:A', 'tab1', 0, 100)).toBe(true);
    expect(await db.lease('execution:A', 'tab2', 99, 100)).toBe(false);
    expect(await db.lease('execution:A', 'tab2', 101, 100)).toBe(true);
    expect(await db.lease('execution:B', 'tab1', 99, 100)).toBe(true);
  });
  it('acuse limpia solo su sesión y conserva recibo mínimo', async () => {
    const j = new Journal(db, contextFixture());
    await j.create(snapshot());
    const out = await j.recover();
    await db.put('credentials', { key: out.sessionId, runtimeSecret: 'synthetic' });
    await db.put('credentials', { key: 'other', runtimeSecret: 'synthetic-other' });
    await j.acknowledge({ receiptId: crypto.randomUUID(), sessionId: out.sessionId,
      submissionId: out.envelope.submissionId, evidenceHash: out.hash,
      receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' });
    expect(await db.get('outbox', out.sessionId)).toBeUndefined();
    expect(await db.get('credentials', out.sessionId)).toBeUndefined();
    expect(await db.get('credentials', 'other')).toBeDefined();
    expect(await db.get('receipts', out.sessionId)).toBeDefined();
  });
});
