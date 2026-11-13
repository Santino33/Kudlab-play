import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/storage/database';
import { Journal } from '../../src/evidence/journal';
import { Engine } from '../../src/games/tg02/engine';
import { finalizePalabra } from '../../src/games/tg02/snapshot';
import type { PalabraSnapshot } from '../../src/games/tg02/flow';
import context from '../../contract/kudlab-runtime-1.5.0/context-tg02.synthetic.json';
import { contextSchema } from '../../src/contract/palabra-intrusa';

const reference = contextSchema.parse(context), submission = '60000000-0000-4000-8000-000000000002';
function snapshot(engine: Engine, at: number, phase: PalabraSnapshot['phaseReached']): PalabraSnapshot {
  return { taskId: 'TG-02', clock: { id: '70000000-0000-4000-8000-000000000002', timeOriginUnixMs: 1794528000000 },
    startedAtMs: 0, checkpointAtMs: at, phaseReached: phase, instruction: { shownAtMs: 10, acceptedAtMs: 20, repeats: 0 },
    evidence: engine.snapshot(at), incidents: [], terminationReason: null,
    device: { viewportWidth: 1920, viewportHeight: 1080, stageWidthCss: 1920, stageHeightCss: 1080, devicePixelRatio: 1, touchCapable: false, pointerTypes: ['mouse'] } };
}
function practice(e: Engine) {
  e.startPractice(100);
  for (let i = 0; i < 3; i++) { const at = e.nextPresentationAt, item = e.nextItem()!; e.presented(at); e.tap(item.targetIdx, { atMs: at + 500, pointerType: 'mouse', x: 400, y: 300 }); }
}
describe('TG02 durable finalization / CA-08,09', () => {
  it('reopens the journal, finalizes concurrently once and preserves evidence until matching receipt', async () => {
    const db = await Database.open(`tg02-${crypto.randomUUID()}`), first = new Journal(db, reference), engine = new Engine();
    engine.startPractice(100); engine.presented(2000); const s = snapshot(engine, 2200, 'practice');
    await first.create(s);
    const reopened = new Journal(db, reference), [a, b] = await Promise.all([reopened.recover(), reopened.recover()]);
    expect(a.body).toBe(b.body); expect(a.hash).toBe(b.hash); expect(a.envelope.state).toBe('interrupted');
    await expect(first.checkpoint(s)).rejects.toThrow('EXECUTION_TERMINAL');
    const receipt = { sessionId: reference.sessionId, submissionId: a.envelope.submissionId, evidenceHash: '0'.repeat(64),
      receiptId: crypto.randomUUID(), receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' as const };
    await expect(reopened.acknowledge(receipt)).rejects.toThrow('RECEIPT_MISMATCH');
    expect(await db.get('outbox', reference.sessionId)).toBeDefined();
    await reopened.acknowledge({ ...receipt, evidenceHash: a.hash });
    expect(await db.get('outbox', reference.sessionId)).toBeUndefined();
  });
  it('recovers an active practice item without inventing measurement or resuming', () => {
    const e = new Engine(); e.startPractice(100); e.presented(2000);
    const s = snapshot(e, 2200, 'practice'), before = structuredClone(s);
    const result = finalizePalabra(reference, s, submission, true);
    expect(result.state).toBe('interrupted'); expect(result.events).toEqual([]);
    expect(result.preparation.practice[0]!.items[0]).toMatchObject({ valid: false, closureReason: 'interruption', closedAtMs: 2200 });
    expect(result.timing.measurementStartedAtMs).toBeNull(); expect(s).toEqual(before);
  });
  it('recovers a measured active item and validates a completed sequence', () => {
    const e = new Engine(); practice(e); let at = e.nextPresentationAt + 4200; e.startMeasurement(at);
    e.presented(at);
    const partial = finalizePalabra(reference, snapshot(e, at + 100, 'test'), submission, true);
    expect(partial.events[0]).toMatchObject({ result: null, valid: false, closureReason: 'interruption' });
    e.tap(e.snapshot(at + 100).active!.targetIdx, { atMs: at + 500, pointerType: 'mouse', x: 400, y: 300 });
    for (let i = 1; i < 18; i++) { at = e.nextPresentationAt; const item = e.nextItem()!; e.presented(at); e.tap(item.targetIdx, { atMs: at + 500, pointerType: 'mouse', x: 400, y: 300 }); }
    const s = snapshot(e, at + 500, 'done'); s.terminationReason = 'completed';
    const full = finalizePalabra(reference, s, submission, true);
    expect(full.state).toBe('completed'); expect(full.events).toHaveLength(18);
    expect(full.incidents).toEqual([]); expect(full.terminationReason).toBe('completed');
  });
});
