import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import context from '../../contract/kudlab-runtime-1.4.0/context-tg07.synthetic.json';
import full from '../../contract/kudlab-runtime-1.4.0/envelope-tg07.synthetic.json';
import partial from '../../contract/kudlab-runtime-1.4.0/envelope-tg07.partial-0.synthetic.json';
import { kudDiceContextSchema, kudDiceEnvelopeSchema } from '../../src/contract/kud-dice';
import type { KudDiceSnapshot } from '../../src/games/tg07/snapshot';
import { Journal, type Outbox } from '../../src/evidence/journal';
import { Database } from '../../src/storage/database';
import { Api } from '../../src/delivery/api';
import { Delivery } from '../../src/delivery/outbox';
import { newSecret } from '../../src/contract/canonical';
import { Session } from '../../src/runtime/session';

function snapshot(input: unknown = full): KudDiceSnapshot {
  const e = kudDiceEnvelopeSchema.parse(input);
  return { taskId: e.taskId, clock: e.clock, device: e.device, startedAtMs: e.timing.startedAtMs,
    checkpointAtMs: e.timing.lastCheckpointAtMs, measurementStartedAtMs: e.timing.measurementStartedAtMs,
    measurementFinishedAtMs: e.timing.measurementFinishedAtMs, phaseReached: e.phaseReached,
    audio: e.audio, preparation: e.preparation, events: e.events, active: null, incidents: [], terminationReason: e.terminationReason };
}
async function journal() {
  const db = await Database.open(`kud-dice-${crypto.randomUUID()}`);
  const c = kudDiceContextSchema.parse(context);
  return { db, c, j: new Journal(db, c) };
}
describe('TG-07 durable evidence / CA-04,07,08', () => {
  it('reconciles an uncertain start using the same startId and only recovers delivery', async () => {
    const { db, c } = await journal(), startId = crypto.randomUUID(), s = snapshot(partial);
    s.terminationReason = null;
    const ready = { ...c, executionStatus: 'READY' as const, attemptNumber: null, uploadAllowedUntil: null,
      capabilities: { canStart: true, canSubmit: false, canReadReceipt: false } };
    await db.put('credentials', { key: c.sessionId, runtimeSecret: newSecret(), claimId: crypto.randomUUID(),
      startId, phase: 'STARTING', context: ready, preparedSnapshot: s });
    let starts = 0;
    const session = new Session(db, new Api('http://localhost', async (url, init) => {
      if (String(url).endsWith(`/sessions/${c.sessionId}`)) return Response.json(ready);
      expect(JSON.parse(init!.body as string)).toEqual({ startId }); starts++;
      return Response.json({ sessionId: c.sessionId, attemptNumber: 1, executionStatus: 'RUNNING',
        startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() });
    }), 'recovered-tab', () => true);
    await session.recoverStarted(); await session.recoverStarted();
    expect(starts).toBe(1);
    const out = await db.get<Outbox>('outbox', c.sessionId);
    expect(out?.envelope.taskId).toBe('TG-07');
    expect(out?.envelope.terminationReason).toBe('recovered_after_reload');
    expect(out?.envelope.events).toEqual([]);
  });
  it('keeps interrupted practice separate from measurement', async () => {
    const { j } = await journal(), s = snapshot();
    s.active = { ...s.preparation.practice[0].evidence, responses: [], closedAtMs: null, closureReason: null };
    s.preparation.practice = []; s.preparation.practiceCompleted = false;
    s.events = []; s.phaseReached = 'practice'; s.terminationReason = null;
    s.measurementStartedAtMs = s.measurementFinishedAtMs = null;
    s.checkpointAtMs = s.active.responseOpenedAtMs! + 100;
    await j.create(s); const out = await j.recover();
    if (out.envelope.taskId !== 'TG-07') throw new Error('Wrong task');
    expect(out.envelope.events).toEqual([]);
    expect(out.envelope.preparation.practice[0].evidence).toMatchObject({ valid: false, closureReason: 'interruption', responses: [] });
  });
  it('keeps a completed checkpoint completed and finalizes only once', async () => {
    const { j } = await journal(); await j.create(snapshot());
    const [a, b] = await Promise.all([j.recover(), j.recover()]);
    expect(a.body).toBe(b.body); expect(a.hash).toBe(b.hash);
    expect(a.envelope.state).toBe('completed');
    expect(a.envelope.events).toEqual(full.events);
    await expect(j.checkpoint(snapshot())).rejects.toThrow('EXECUTION_TERMINAL');
  });
  it('recovers an active measurement without inventing a response or timeout', async () => {
    const { j } = await journal(), s = snapshot();
    s.active = { ...s.events.pop()!, responseOpenedAtMs: null, responses: [], closedAtMs: null, closureReason: null };
    s.checkpointAtMs = s.active.presentationStartMs! + 100;
    s.measurementFinishedAtMs = null; s.terminationReason = null; s.phaseReached = 'test';
    await j.create(s); const out = await j.recover();
    expect(out.envelope.state).toBe('interrupted');
    expect(out.envelope.events.at(-1)).toMatchObject({ valid: false, invalidReason: 'interrupted',
      closureReason: 'interruption', closedAtMs: s.checkpointAtMs, responseOpenedAtMs: null, responses: [] });
    expect(out.envelope.incidents.at(-1)).toMatchObject({ type: 'recovered_after_reload', clockId: null, atMs: null });
    expect((await j.recover()).body).toBe(out.body);
  });
  it('recovers preparation with zero measurement trials', async () => {
    const { j } = await journal(), s = snapshot(partial); s.terminationReason = null;
    await j.create(s); const out = await j.recover();
    expect(out.envelope.events).toEqual([]);
    expect(out.envelope.terminationReason).toBe('recovered_after_reload');
    expect(out.envelope.timing).toMatchObject({ measurementStartedAtMs: null, measurementFinishedAtMs: null });
  });
  it('rejects another profile, another clock and a regressing checkpoint', async () => {
    const { j } = await journal(), s = snapshot(partial); s.terminationReason = null;
    await expect(j.create({ ...s, taskId: 'TG-03' } as unknown as KudDiceSnapshot)).rejects.toThrow('PROFILE_MISMATCH');
    await j.create(s);
    await expect(j.checkpoint({ ...s, clock: { ...s.clock, id: crypto.randomUUID() } })).rejects.toThrow('CLOCK_MISMATCH');
    await expect(j.checkpoint({ ...s, checkpointAtMs: s.checkpointAtMs - 1 })).rejects.toThrow('CHECKPOINT_REGRESSION');
  });
  it('retains identical bytes after 503/lost receipt and clears only on matching acknowledgment', async () => {
    const { db, c, j } = await journal(); await j.create(snapshot()); const out = await j.recover();
    await db.put('credentials', { key: c.sessionId, runtimeSecret: newSecret(), claimId: crypto.randomUUID(), phase: 'START_CONFIRMED', context: c });
    const bodies: unknown[] = [];
    const delivery = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      bodies.push(init?.body);
      if (bodies.length === 1) return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
      if (bodies.length === 2) throw new TypeError('lost receipt');
      return Response.json({ sessionId: c.sessionId, submissionId: out.envelope.submissionId, evidenceHash: out.hash,
        receiptId: crypto.randomUUID(), receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' });
    }), 'sender');
    expect(await delivery.send(c.sessionId, true)).toBe('PENDING');
    expect(await delivery.send(c.sessionId, true)).toBe('PENDING');
    expect((await db.get<Outbox>('outbox', c.sessionId))?.body).toBe(out.body);
    expect(await delivery.send(c.sessionId, true)).toBe('SAVED');
    expect(bodies).toEqual([out.body, out.body, out.body]);
    expect(await db.get('outbox', c.sessionId)).toBeUndefined();
  });
});
