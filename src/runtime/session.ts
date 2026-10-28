import { Api, ApiError } from '../delivery/api';
import { newSecret } from '../contract/canonical';
import { secretSchema, type SessionContext } from '../contract/schema';
import { Database, request } from '../storage/database';
import { Journal, type Snapshot, type Execution, type Outbox } from '../evidence/journal';
import { normalizeCode } from './access-code';

export interface Credential {
  key: string; claimId: string; runtimeSecret: string; launchGrant?: string; context?: SessionContext;
  startId?: string; phase: 'CLAIMING' | 'READY' | 'STARTING' | 'START_CONFIRMED'; preparedSnapshot?: Snapshot;
  operationBlocked?: boolean; nextAttemptAt?: number; attemptCount?: number; lastErrorCode?: string;
  bridgeId?: string;
  access?: { kind: 'PLAY' | 'RECOVER'; sessionId?: string; submissionId?: string };
}
export class Session {
  constructor(readonly db: Database, readonly api: Api, readonly owner: string, private online = () => navigator.onLine) {}
  private requireOnline() { if (!this.online()) throw new Error('ONLINE_REQUIRED'); }
  async claim(grant: string, bridgeId?: string): Promise<SessionContext> {
    this.requireOnline(); secretSchema.parse(grant);
    const pending = (await this.db.all<Credential>('credentials')).find(c => c.phase === 'CLAIMING' && c.launchGrant === grant);
    const credential: Credential = pending ?? { key: `claim:${crypto.randomUUID()}`, claimId: crypto.randomUUID(), runtimeSecret: newSecret(), launchGrant: grant, phase: 'CLAIMING', bridgeId };
    if (!pending) await this.db.put('credentials', credential);
    return this.completeClaim(credential);
  }
  private async completeClaim(c: Credential): Promise<SessionContext> {
    this.requireOnline();
    if (!c.launchGrant) throw new Error('GRANT_MISSING');
    let context: SessionContext;
    try { context = await this.api.claim(c.launchGrant, c.claimId, c.runtimeSecret); }
    catch (error) { await this.defer(c, error); throw error; }
    return this.bind(c, context);
  }
  async claimCode(value: string, recovery?: { sessionId: string; submissionId: string }): Promise<SessionContext> {
    this.requireOnline(); const code = normalizeCode(value);
    const kind = recovery ? 'RECOVER' : 'PLAY';
    if (recovery) {
      const out = await this.db.get<Outbox>('outbox', recovery.sessionId);
      if (!out || out.envelope.submissionId !== recovery.submissionId) throw new Error('LOCAL_EVIDENCE_NOT_FOUND');
    }
    const pending = (await this.db.all<Credential>('credentials')).find(c => (c.phase === 'CLAIMING' || kind === 'PLAY' && c.phase === 'READY' && c.context?.capabilities.canStart && Date.parse(c.context.startAllowedUntil) > Date.now()) && !c.operationBlocked && c.access?.kind === kind && c.access.sessionId === recovery?.sessionId);
    if (pending?.lastErrorCode === 'RATE_LIMITED' && (pending.nextAttemptAt ?? 0) > Date.now()) throw new ApiError(429, 'RATE_LIMITED', pending.nextAttemptAt! - Date.now());
    const c: Credential = pending ?? { key: `access:${crypto.randomUUID()}`, claimId: crypto.randomUUID(), runtimeSecret: newSecret(), phase: 'CLAIMING', access: { kind, ...recovery } };
    await this.db.put('credentials', c);
    let context: SessionContext;
    try { context = await this.api.access(code, c.claimId, c.runtimeSecret, recovery); }
    catch (error) { await this.defer(c, error); throw error; }
    if (recovery && (context.sessionId !== recovery.sessionId || context.capabilities.canStart || !context.capabilities.canSubmit)) throw new Error('LOCAL_EVIDENCE_MISMATCH');
    return this.bind(c, context);
  }
  private async bind(c: Credential, context: SessionContext): Promise<SessionContext> {
    try { await this.db.transaction(['credentials', 'executions', 'outbox'], async tx => {
      const s = tx.objectStore('credentials');
      const previous = await request<Credential | undefined>(s.get(context.sessionId));
      const recovery = !context.capabilities.canStart && context.capabilities.canSubmit && context.attemptNumber !== null;
      if (recovery) {
        const out = await request<Outbox | undefined>(tx.objectStore('outbox').get(context.sessionId));
        const execution = await request<Execution | undefined>(tx.objectStore('executions').get(context.sessionId));
        if (!out || !execution) throw new Error('LOCAL_EVIDENCE_NOT_FOUND');
        if (out.envelope.configurationHash !== context.configurationHash || out.envelope.publishedVersionId !== context.publishedVersionId || out.envelope.gameBuildId !== context.gameBuildId || out.envelope.contractVersion !== context.contractVersion) throw new Error('LOCAL_EVIDENCE_MISMATCH');
        await request(tx.objectStore('outbox').put({ ...out, status: 'PENDING', nextAttemptAt: 0 }));
      } else if (previous && previous.claimId !== c.claimId) throw new Error('CLAIM_CONFLICT');
      await request(s.put({ key: context.sessionId, claimId: c.claimId, runtimeSecret: c.runtimeSecret, context, phase: 'READY', bridgeId: c.bridgeId, access: c.access }));
      if (c.key !== context.sessionId) await request(s.delete(c.key));
    }); } catch (error) {
      await this.defer(c, new ApiError(409, error instanceof Error ? error.message : 'LOCAL_RECOVERY_FAILED'));
      throw error;
    }
    return context;
  }
  private async defer(c: Credential, error: unknown): Promise<void> {
    const e = error instanceof ApiError ? error : new ApiError(400, 'INVALID_RESPONSE');
    const blocked = e.status >= 400 && e.status < 500 && e.status !== 429;
    const attemptCount = (c.attemptCount ?? 0) + 1;
    await this.db.put('credentials', { ...c, operationBlocked: blocked, attemptCount,
      lastErrorCode: e.code, nextAttemptAt: Date.now() + Math.max(e.retryAfterMs, Math.min(60000, 2000 * 2 ** Math.min(attemptCount - 1, 5))) });
  }
  async reconcileClaims(force = false): Promise<SessionContext[]> {
    this.requireOnline();
    const contexts: SessionContext[] = [];
    for (const c of await this.db.all<Credential>('credentials')) {
      if (c.phase !== 'CLAIMING' || !c.launchGrant || c.operationBlocked || ((c.nextAttemptAt ?? 0) > Date.now() && (!force || c.lastErrorCode === 'RATE_LIMITED'))) continue;
      try { contexts.push(await this.completeClaim(c)); } catch { /* status persisted; isolate other sessions */ }
    }
    return contexts;
  }
  async start(context: SessionContext, preparedSnapshot: Snapshot): Promise<Journal> {
    this.requireOnline();
    if (!context.capabilities.canStart || context.attemptNumber !== null) throw new Error('SESSION_NOT_STARTABLE');
    if (!await this.db.lease(`execution:${context.sessionId}`, this.owner, Date.now(), 15000)) throw new Error('ACTIVE_SESSION');
    const c = await this.db.get<Credential>('credentials', context.sessionId);
    if (!c || c.phase === 'START_CONFIRMED' || await this.db.get('executions', context.sessionId)) throw new Error('SESSION_ALREADY_STARTED');
    if (c.phase === 'STARTING') throw new Error('START_RECONCILIATION_REQUIRED');
    const starting: Credential = { ...c, phase: 'STARTING', startId: crypto.randomUUID(), preparedSnapshot };
    await this.db.put('credentials', starting);
    let result;
    try { result = await this.api.start(context.sessionId, c.runtimeSecret, starting.startId!); }
    catch (error) { await this.defer(starting, error); throw error; }
    this.requireOnline();
    const confirmed: Credential = { ...starting, phase: 'START_CONFIRMED', context: { ...context, attemptNumber: result.attemptNumber,
      executionStatus: 'RUNNING', uploadAllowedUntil: result.uploadAllowedUntil, capabilities: { ...context.capabilities, canStart: false, canSubmit: true } } };
    await this.db.put('credentials', confirmed);
    return new Journal(this.db, confirmed.context!);
  }
  async recoverStarted(): Promise<void> {
    for (const c of await this.db.all<Credential>('credentials')) {
      if (!c.context || c.operationBlocked || (c.nextAttemptAt ?? 0) > Date.now() || (c.phase !== 'STARTING' && c.phase !== 'START_CONFIRMED')) continue;
      if (!await this.db.lease(`execution:${c.key}`, this.owner)) continue;
      try {
        let execution = await this.db.get<Execution>('executions', c.key);
        if (!execution && c.preparedSnapshot) {
          if (c.phase === 'STARTING') {
            this.requireOnline();
            // Reconcile context, never use a repeated start as permission to render after reload.
            const context = await this.api.context(c.key, c.runtimeSecret);
            if (context.attemptNumber === null) {
              // Retry only the persisted requested start, never issue a new startId or render after recovery.
              const result = await this.api.start(c.key, c.runtimeSecret, c.startId!);
              c.context = { ...context, attemptNumber: result.attemptNumber, executionStatus: result.executionStatus,
                uploadAllowedUntil: result.uploadAllowedUntil, capabilities: { canStart: false, canSubmit: true, canReadReceipt: true } };
            } else c.context = context;
            c.phase = 'START_CONFIRMED';
            await this.db.put('credentials', c);
          }
          await new Journal(this.db, c.context).create(c.preparedSnapshot);
          execution = await this.db.get<Execution>('executions', c.key);
        }
        if (execution) await new Journal(this.db, execution.context).recover();
      } catch (error) {
        if (c.phase === 'STARTING') await this.defer(c, error);
        else throw error;
      } finally { await this.db.release(`execution:${c.key}`, this.owner); }
    }
  }
}
