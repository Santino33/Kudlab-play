import type { SessionContext } from '../../contract/profiles';
import type { Journal, Outbox } from '../../evidence/journal';
import type { Session } from '../../runtime/session';
import type { Database } from '../../storage/database';
import { Flow, type PalabraSnapshot } from './flow';

export class PalabraFlow {
  busy = false;
  private flow: Flow;
  private journal?: Journal;
  private queue = Promise.resolve();
  private queued = 0;
  private closing = false;
  private destroyed = false;
  private abort = new AbortController();
  private heartbeat?: ReturnType<typeof setInterval>;
  private lease?: ReturnType<typeof setInterval>;
  private visualDone!: () => void;
  private visual = new Promise<void>(resolve => { this.visualDone = resolve; });
  constructor(host: HTMLElement, private context: Extract<SessionContext, { taskId: 'TG-02' }>, private session: Session,
    private db: Database, private owner: string, private done: (out: Outbox) => Promise<void>, private failed: (started: boolean) => void) {
    host.replaceChildren();
    this.flow = new Flow(host, s => this.capture(s), s => { void this.close(s); }, () => this.begin(), () => this.visualDone());
  }
  async prepare() { await this.flow.start(); }
  private async begin() {
    if (!navigator.onLine || document.hidden || this.destroyed) throw new Error('ONLINE_REQUIRED');
    this.busy = true;
    await this.db.preflight();
    const s = this.flow.snapshot(); this.journal = await this.session.start(this.context, s); await this.journal.create(s);
    if (this.destroyed) { await this.journal.recover(); return; }
    window.addEventListener('pagehide', () => this.flow.stop('user_exit'), { signal: this.abort.signal });
    window.addEventListener('error', () => this.flow.stop('script_error'), { signal: this.abort.signal });
    this.heartbeat = setInterval(() => this.capture(this.flow.snapshot()), 1000);
    this.lease = setInterval(() => { void this.db.lease(`execution:${this.context.sessionId}`, this.owner)
      .then(ok => { if (!ok) this.flow.stop('script_error'); }).catch(() => this.flow.stop('storage_failure')); }, 3000);
  }
  private capture(s: PalabraSnapshot) {
    if (!this.journal || this.closing || this.destroyed) return;
    if (this.queued >= 32) { this.flow.stop('storage_failure'); return; }
    this.queued++;
    this.queue = this.queue.then(() => this.journal!.checkpoint(s)).finally(() => this.queued--);
    void this.queue.catch(() => this.flow.stop('storage_failure'));
  }
  private cleanup() { clearInterval(this.heartbeat); clearInterval(this.lease); this.abort.abort(); }
  private async close(s: PalabraSnapshot) {
    if (this.closing) return; this.closing = true; this.cleanup();
    try {
      if (!this.journal) { if (!this.destroyed) this.failed(false); return; }
      await this.queue.catch(() => undefined);
      const out = await this.journal.finalize(s);
      if (s.evidence.state === 'completed' && !this.destroyed) await this.visual;
      if (!this.destroyed) { this.flow.destroy(); await this.done(out); }
    } catch { if (!this.destroyed) { this.flow.destroy(); this.failed(true); } }
    finally { this.busy = false; await this.db.release(`execution:${this.context.sessionId}`, this.owner).catch(() => undefined); }
  }
  destroy() { this.destroyed = true; this.visualDone(); this.flow.stop('user_exit'); this.cleanup(); }
}
