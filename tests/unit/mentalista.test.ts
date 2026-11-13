import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import context from '../../contract/kudlab-runtime-1.3.0/context-2.0.synthetic.json';
import full from '../../contract/kudlab-runtime-1.3.0/envelope-2.0.synthetic.json';
import partial from '../../contract/kudlab-runtime-1.3.0/envelope-2.0.partial-0.synthetic.json';
import { mentalistaContextSchema, mentalistaEnvelopeSchema } from '../../src/contract/mentalista';
import { MentalistaEngine } from '../../src/games/tg03/engine';
import { Journal } from '../../src/evidence/journal';
import { Database } from '../../src/storage/database';
import { Api } from '../../src/delivery/api';
import { Delivery } from '../../src/delivery/outbox';
import { Session } from '../../src/runtime/session';
import type { Outbox } from '../../src/evidence/journal';
import { newSecret } from '../../src/contract/canonical';

const fixture = () => mentalistaEnvelopeSchema.parse(full);
function engine() {
  const e = fixture();
  return new MentalistaEngine({ clock: e.clock, device: e.device, startedAtMs: 0 }, e.preparation);
}
function advance(e: MentalistaEngine, ms: number) {
  const end = e.at + ms;
  while (e.running && e.at < end) e.frame(Math.min(end, e.at + 50));
}
describe('Mentalista contract, clock and durable recovery / CA-04…08,13', () => {
  it('reconciles STARTING with the same startId and preparation, without measuring again', async () => {
    const db = await Database.open(`mentalista-start-${crypto.randomUUID()}`), c = mentalistaContextSchema.parse(context), startId = crypto.randomUUID();
    c.executionStatus = 'READY'; c.attemptNumber = null; c.uploadAllowedUntil = null; c.capabilities = { canStart: true, canSubmit: false, canReadReceipt: false };
    const snapshot = engine().snapshot();
    await db.put('credentials', { key: c.sessionId, runtimeSecret: newSecret(), claimId: crypto.randomUUID(), startId, phase: 'STARTING', context: c, preparedSnapshot: snapshot });
    let starts = 0;
    const session = new Session(db, new Api('http://localhost', async (url, init) => {
      if (String(url).endsWith(`/sessions/${c.sessionId}`)) return Response.json(c);
      expect(JSON.parse(init!.body as string)).toEqual({ startId }); starts++;
      return Response.json({ sessionId: c.sessionId, attemptNumber: 1, executionStatus: 'RUNNING', startedAtServer: new Date().toISOString(), uploadAllowedUntil: new Date(Date.now() + 86400000).toISOString() });
    }), 'recovered-tab', () => true);
    await session.recoverStarted(); await session.recoverStarted();
    const out = await db.get<Outbox>('outbox', c.sessionId);
    expect(starts).toBe(1); expect(out?.envelope.taskId).toBe('TG-03');
    expect(out?.envelope.events).toHaveLength(1);
    expect(out?.envelope.terminationReason).toBe('recovered_after_reload');
    if (out?.envelope.taskId !== 'TG-03') throw new Error('Wrong task');
    expect(out.envelope.preparation).toEqual(snapshot.preparation);
    expect(out.envelope.events[0]!.optionsShownAtMs).toBeNull();
  });
  it('retains identical TG-03 bytes on 503/lost ACK and removes them only after matching receipt', async () => {
    const db = await Database.open(`mentalista-delivery-${crypto.randomUUID()}`), c = mentalistaContextSchema.parse(context), e = engine();
    advance(e, 2000);
    const j = new Journal(db, c); await j.create(e.snapshot()); const out = await j.recover();
    await db.put('credentials', { key: c.sessionId, runtimeSecret: newSecret(), claimId: crypto.randomUUID(), phase: 'START_CONFIRMED', context: c });
    const bodies: unknown[] = [];
    const delivery = new Delivery(db, new Api('http://localhost', async (_url, init) => {
      bodies.push(init?.body);
      if (bodies.length === 1) return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
      if (bodies.length === 2) throw new TypeError('lost receipt');
      return Response.json({ sessionId: c.sessionId, submissionId: out.envelope.submissionId, evidenceHash: out.hash, receiptId: crypto.randomUUID(), receivedAt: new Date().toISOString(), processingStatusAtReceipt: 'PENDING' });
    }), 'sender');
    expect(await delivery.send(c.sessionId, true)).toBe('PENDING');
    expect(await delivery.send(c.sessionId, true)).toBe('PENDING');
    expect((await db.get<Outbox>('outbox', c.sessionId))?.body).toBe(out.body);
    expect(await delivery.send(c.sessionId, true)).toBe('SAVED');
    expect(bodies).toEqual([out.body, out.body, out.body]);
    expect(await db.get('outbox', c.sessionId)).toBeUndefined();
  });
  it('accepts producer vectors and rejects swapped task, bank and sequence', () => {
    expect(mentalistaContextSchema.parse(context).taskId).toBe('TG-03');
    expect(fixture().events).toHaveLength(12);
    expect(mentalistaEnvelopeSchema.parse(partial).events).toHaveLength(0);
    expect(mentalistaEnvelopeSchema.safeParse({ ...full, taskId: 'TG-01' }).success).toBe(false);
    expect(mentalistaEnvelopeSchema.safeParse({ ...full, events: [...full.events].reverse() }).success).toBe(false);
    expect(mentalistaContextSchema.safeParse({ ...context, config: { ...context.config, seed: 9 } }).success).toBe(false);
  });
  it('presents each instruction before options and keeps only the first choice', () => {
    const e = engine(); advance(e, 999); expect(e.phase).toBe('neutral');
    advance(e, 1); expect(e.text).toContain(String(e.current.start));
    advance(e, 2500); expect(e.phase).toBe('gap');
    advance(e, 500); expect(e.phase).toBe('instruction');
    while (e.phase !== 'options') advance(e, 50);
    const at = e.at; e.respond(2, at + 500, 'keyboard');
    // A response without painted frames is a watchdog interruption, not invented elapsed display time.
    expect(e.running).toBe(false); expect(e.snapshot().terminationReason).toBe('frame_gap');
    const next = engine(); while (next.phase !== 'options') advance(next, 50);
    advance(next, 500); next.respond(2, next.at, 'keyboard'); next.respond(0, next.at, 'keyboard');
    expect(next.current.selectedIdx).toBe(2); expect(next.snapshot().extraResponses).toHaveLength(1);
  });
  it('completes twelve responses and preserves completed on reload before closing video', async () => {
    const e = engine();
    while (e.running) {
      advance(e, 50);
      if (e.phase === 'options') { advance(e, 500); e.respond(e.sequence[e.current.trial - 1]!.item.correctIdx, e.at, 'keyboard'); }
    }
    expect(e.snapshot().terminationReason).toBe('items_completed');
    const db = await Database.open(`mentalista-${crypto.randomUUID()}`);
    const j = new Journal(db, mentalistaContextSchema.parse(context));
    await j.create(e.snapshot());
    const out = await j.recover();
    expect(out.envelope.state).toBe('completed'); expect(out.envelope.events).toHaveLength(12);
    expect((await j.recover()).body).toBe(out.body);
    if (out.envelope.taskId !== 'TG-03') throw new Error('Wrong task');
    expect(out.envelope.preparation.resourceIncidents).toContainEqual({ phase: 'closing', type: 'transition_skipped', reason: 'closing_recovered' });
  });
  it('recovers encoding as incomplete, never as a timeout or resumed trial', async () => {
    const e = engine(); advance(e, 2000);
    const db = await Database.open(`mentalista-${crypto.randomUUID()}`), j = new Journal(db, mentalistaContextSchema.parse(context));
    await j.create(e.snapshot());
    const out = await j.recover();
    expect(out.envelope.state).toBe('interrupted');
    expect(out.envelope.events[0]).toMatchObject({ closureReason: 'interruption', selectedIdx: null, optionsShownAtMs: null, closedAtMs: 2000 });
    await expect(j.checkpoint(e.snapshot())).rejects.toThrow('EXECUTION_TERMINAL');
  });
  it('records timeout only after the full answer window and stops on lost presentation', () => {
    const e = engine(); while (e.phase !== 'options') advance(e, 50);
    advance(e, 30000);
    expect(e.snapshot().events[0]!.closureReason).toBe('timeout');
    e.finish('layout_changed', e.at);
    const before = e.snapshot(); advance(e, 1000); expect(e.snapshot()).toEqual(before);
    expect(before.events[1]!.closureReason).toBe('interruption');
  });
});
