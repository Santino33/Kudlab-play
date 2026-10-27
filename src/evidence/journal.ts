import { envelopeSchema, receiptSchema, type Envelope, type Incident, type Receipt, type SessionContext, type TerminationReason, type Trial } from '../contract/schema';
import { hash } from '../contract/canonical';
import { Database, request } from '../storage/database';

export type DraftTrial = Omit<Trial, 'closedAtMs' | 'result' | 'closureReason'> & {
  closedAtMs: number | null; result: Trial['result'] | null; closureReason: Trial['closureReason'] | null;
};
export interface Snapshot {
  clock: Envelope['clock']; device: Envelope['device']; startedAtMs: number; checkpointAtMs: number;
  events: DraftTrial[]; incidents: Incident[]; terminationReason: TerminationReason | null;
}
export interface Execution extends Omit<Snapshot, 'events' | 'incidents'> {
  key: string; context: SessionContext; submissionId: string; status: 'RUNNING' | 'TERMINAL';
}
export interface Outbox {
  key: string; sessionId: string; envelope: Envelope; hash: string; body: string;
  status: 'PENDING' | 'SENDING' | 'AUTH_REQUIRED' | 'BLOCKED'; attemptCount: number;
  nextAttemptAt: number; lastAttemptAt: number | null; lastErrorCode: string | null;
}
export class Journal {
  constructor(readonly db: Database, readonly context: SessionContext) {}
  async create(snapshot: Snapshot): Promise<void> {
    await this.db.transaction(['executions', 'trials', 'incidents'], async tx => {
      if (await request(tx.objectStore('executions').get(this.context.sessionId))) throw new Error('EXECUTION_EXISTS');
      const { events, incidents, ...meta } = snapshot;
      await request(tx.objectStore('executions').put({ ...meta, key: this.context.sessionId, context: this.context, submissionId: crypto.randomUUID(), status: 'RUNNING' }));
      for (const event of events) await request(tx.objectStore('trials').put({ key: `${this.context.sessionId}:${event.trial}`, sessionId: this.context.sessionId, value: event }));
      for (const incident of incidents) await request(tx.objectStore('incidents').put({ key: `${this.context.sessionId}:${incident.sequence}`, sessionId: this.context.sessionId, value: incident }));
    });
  }
  async checkpoint(snapshot: Snapshot): Promise<void> {
    await this.db.transaction(['executions', 'trials', 'incidents'], async tx => {
      const store = tx.objectStore('executions');
      const e = await request<Execution | undefined>(store.get(this.context.sessionId));
      if (!e || e.status !== 'RUNNING') throw new Error('EXECUTION_TERMINAL');
      if (snapshot.clock.id !== e.clock.id || snapshot.clock.timeOriginUnixMs !== e.clock.timeOriginUnixMs || snapshot.startedAtMs !== e.startedAtMs) throw new Error('CLOCK_MISMATCH');
      if (snapshot.checkpointAtMs < e.checkpointAtMs) throw new Error('CHECKPOINT_REGRESSION');
      const { events, incidents, ...meta } = snapshot;
      await request(store.put({ ...e, ...meta }));
      for (const event of events) await request(tx.objectStore('trials').put({ key: `${e.key}:${event.trial}`, sessionId: e.key, value: event }));
      for (const incident of incidents) await request(tx.objectStore('incidents').put({ key: `${e.key}:${incident.sequence}`, sessionId: e.key, value: incident }));
    });
  }
  async read(): Promise<{ execution: Execution; snapshot: Snapshot }> {
    return this.db.transaction(['executions', 'trials', 'incidents'], async tx => {
      const execution = await request<Execution | undefined>(tx.objectStore('executions').get(this.context.sessionId));
      if (!execution) throw new Error('EXECUTION_MISSING');
      const events = (await request<{ sessionId: string; value: DraftTrial }[]>(tx.objectStore('trials').getAll()))
        .filter(r => r.sessionId === execution.key).map(r => r.value).sort((a, b) => a.trial - b.trial);
      const incidents = (await request<{ sessionId: string; value: Incident }[]>(tx.objectStore('incidents').getAll()))
        .filter(r => r.sessionId === execution.key).map(r => r.value).sort((a, b) => a.sequence - b.sequence);
      return { execution, snapshot: { clock: execution.clock, device: execution.device,
        startedAtMs: execution.startedAtMs, checkpointAtMs: execution.checkpointAtMs,
        terminationReason: execution.terminationReason, events, incidents } };
    }, 'readonly');
  }
  async finalize(snapshot?: Snapshot): Promise<Outbox> {
    const existing = await this.db.get<Outbox>('outbox', this.context.sessionId);
    if (existing) return existing;
    if (snapshot) await this.checkpoint(snapshot);
    const { execution, snapshot: s } = await this.read();
    const reason = s.terminationReason ?? 'recovered_after_reload';
    const incidents = [...s.incidents];
    if (reason === 'recovered_after_reload') incidents.push({ sequence: (incidents.at(-1)?.sequence ?? 0) + 1,
      type: 'recovered_after_reload', clockId: null, atMs: null, endedAtMs: null,
      recordedAtClient: new Date().toISOString(), category: 'EXECUTION_INTERRUPTED' });
    const { sessionId, taskId, publishedVersionId, configVersion, configurationHash, gameBuildId, contractVersion } = this.context;
    const envelope = envelopeSchema.parse({ sessionId, taskId, publishedVersionId, configVersion, configurationHash, gameBuildId, contractVersion,
      submissionId: execution.submissionId, state: reason === 'time_limit' ? 'completed' : 'interrupted', terminationReason: reason,
      clock: s.clock, device: s.device, timing: { startedAtMs: s.startedAtMs, finishedAtMs: s.checkpointAtMs, lastCheckpointAtMs: s.checkpointAtMs },
      events: s.events.map(e => e.closedAtMs !== null ? e : { ...e, closedAtMs: s.checkpointAtMs, result: 'not_evaluated', responseWindowCompleted: false,
        closureReason: e.presentedAtMs === null ? 'never_presented' : reason === 'time_limit' ? 'session_cutoff' : 'interruption' }), incidents });
    const outbox: Outbox = { key: sessionId, sessionId, envelope, hash: await hash(envelope), body: JSON.stringify(envelope),
      status: 'PENDING', attemptCount: 0, nextAttemptAt: 0, lastAttemptAt: null, lastErrorCode: null };
    return this.db.transaction(['executions', 'outbox'], async tx => {
      const existing = await request<Outbox | undefined>(tx.objectStore('outbox').get(sessionId));
      if (existing) return existing;
      const latest = await request<Execution>(tx.objectStore('executions').get(sessionId));
      if (latest.checkpointAtMs !== execution.checkpointAtMs) throw new Error('FINALIZATION_RACE');
      await request(tx.objectStore('executions').put({ ...latest, status: 'TERMINAL', terminationReason: reason }));
      await request(tx.objectStore('outbox').put(outbox));
      return outbox;
    });
  }
  recover(): Promise<Outbox> { return this.finalize(); }
  async acknowledge(input: Receipt): Promise<void> {
    const receipt = receiptSchema.parse(input);
    await this.db.transaction(['outbox', 'executions', 'trials', 'incidents', 'credentials', 'receipts', 'leases'], async tx => {
      const out = await request<Outbox | undefined>(tx.objectStore('outbox').get(receipt.sessionId));
      if (!out || out.sessionId !== this.context.sessionId || out.envelope.submissionId !== receipt.submissionId || out.hash !== receipt.evidenceHash) throw new Error('RECEIPT_MISMATCH');
      await request(tx.objectStore('receipts').put({ key: receipt.sessionId, receipt, expiresAt: Date.now() + 86400000 }));
      for (const store of ['trials', 'incidents'] as const) {
        const rows = await request<{ key: string; sessionId: string }[]>(tx.objectStore(store).getAll());
        for (const row of rows) if (row.sessionId === receipt.sessionId) await request(tx.objectStore(store).delete(row.key));
      }
      for (const store of ['outbox', 'executions', 'credentials'] as const) await request(tx.objectStore(store).delete(receipt.sessionId));
      await request(tx.objectStore('leases').delete(`execution:${receipt.sessionId}`));
      await request(tx.objectStore('leases').delete(`delivery:${receipt.sessionId}`));
    });
  }
}
