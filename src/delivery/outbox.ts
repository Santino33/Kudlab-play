import { Api, ApiError } from './api';
import { Database, request } from '../storage/database';
import { Journal, type Execution, type Outbox } from '../evidence/journal';
import { envelopeSchema, receiptSchema, type Receipt } from '../contract/schema';
import { hash } from '../contract/canonical';
import type { Credential } from '../runtime/session';

export type DeliveryState = Outbox['status'] | 'SAVED' | 'BUSY';
export class Delivery {
  private inFlight = new Set<string>();
  constructor(private db: Database, private api: Api, private owner: string, private now = Date.now, private rng = Math.random) {}
  async send(sessionId: string, force = false): Promise<DeliveryState> {
    if (this.inFlight.has(sessionId)) return 'BUSY';
    this.inFlight.add(sessionId);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!await this.db.lease(`delivery:${sessionId}`, this.owner, this.now(), 15000)) return 'BUSY';
      heartbeat = setInterval(() => { void this.db.lease(`delivery:${sessionId}`, this.owner, this.now(), 15000).catch(() => undefined); }, 3000);
      const out = await this.db.get<Outbox>('outbox', sessionId);
      if (!out) return await this.db.get('receipts', sessionId) ? 'SAVED' : 'BLOCKED';
      if (out.status === 'AUTH_REQUIRED' || out.status === 'BLOCKED') return out.status;
      // A user retry/online event may expedite backoff, but never Retry-After.
      if (out.nextAttemptAt > this.now() && (!force || out.lastErrorCode === 'RATE_LIMITED')) return 'PENDING';
      const c = await this.db.get<Credential>('credentials', sessionId);
      const execution = await this.db.get<Execution>('executions', sessionId);
      if (!c || !execution) { await this.db.put('outbox', { ...out, status: 'AUTH_REQUIRED' }); return 'AUTH_REQUIRED'; }
      try {
        const envelope = envelopeSchema.parse(JSON.parse(out.body));
        if (envelope.sessionId !== sessionId || await hash(envelope) !== out.hash) throw new ApiError(409, 'LOCAL_EVIDENCE_MISMATCH');
        const state = await this.db.transaction(['outbox'], async tx => {
          const latest = await request<Outbox | undefined>(tx.objectStore('outbox').get(sessionId));
          if (!latest || latest.hash !== out.hash) return 'BLOCKED' as const;
          if (latest.status === 'AUTH_REQUIRED' || latest.status === 'BLOCKED') return latest.status;
          await request(tx.objectStore('outbox').put({ ...latest, status: 'SENDING', lastAttemptAt: this.now() }));
          return 'SENDING' as const;
        });
        if (state !== 'SENDING') return state;
        const saved = await this.db.get<{ receipt: Receipt }>('receipts', sessionId);
        const receipt = saved ? receiptSchema.parse(saved.receipt) : await this.api.submit(sessionId, c.runtimeSecret, out.body);
        if (receipt.sessionId !== sessionId || receipt.submissionId !== out.envelope.submissionId || receipt.evidenceHash !== out.hash) throw new ApiError(409, 'RECEIPT_MISMATCH');
        // Persist verified remote commit before cleanup. Failure to clean is not loss of remote data.
        await this.db.put('receipts', { key: sessionId, receipt, expiresAt: this.now() + 86400000 });
        await new Journal(this.db, execution.context).acknowledge(receipt).catch(() => undefined);
        return 'SAVED';
      } catch (error) {
        const e = error instanceof ApiError ? error : new ApiError(400, 'LOCAL_VALIDATION_FAILED');
        const status = e.status === 401 || e.status === 403 ? 'AUTH_REQUIRED' : e.status >= 400 && e.status < 500 && e.status !== 429 ? 'BLOCKED' : 'PENDING';
        const delay = [2000, 5000, 15000, 30000, 60000][Math.min(out.attemptCount, 4)] * (0.8 + this.rng() * 0.4);
        return this.db.transaction(['outbox', 'receipts'], async tx => {
          const saved = await request<{ receipt: Receipt } | undefined>(tx.objectStore('receipts').get(sessionId));
          const parsed = receiptSchema.safeParse(saved?.receipt);
          if (parsed.success && parsed.data.sessionId === sessionId && parsed.data.submissionId === out.envelope.submissionId && parsed.data.evidenceHash === out.hash) return 'SAVED';
          const latest = await request<Outbox | undefined>(tx.objectStore('outbox').get(sessionId));
          if (!latest || latest.hash !== out.hash) return 'BLOCKED';
          if (latest.status === 'AUTH_REQUIRED' || latest.status === 'BLOCKED') return latest.status;
          await request(tx.objectStore('outbox').put({ ...latest, status, attemptCount: latest.attemptCount + 1,
            lastAttemptAt: this.now(), lastErrorCode: e.code, nextAttemptAt: this.now() + Math.max(delay, e.retryAfterMs) }));
          return status;
        });
      }
    } finally {
      clearInterval(heartbeat); this.inFlight.delete(sessionId);
      await this.db.release(`delivery:${sessionId}`, this.owner);
    }
  }
}
