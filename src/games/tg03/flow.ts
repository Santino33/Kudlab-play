import { button } from '../../app/dom';
import { countdown } from '../../app/countdown';
import type { MentalistaContext, MentalistaReason } from '../../contract/mentalista';
import type { Journal, Outbox } from '../../evidence/journal';
import type { Session } from '../../runtime/session';
import type { Database } from '../../storage/database';
import { MentalistaEngine, type MentalistaSnapshot } from './engine';
import { MentalistaView } from './view';

export class MentalistaFlow {
  busy = false;
  private view: MentalistaView;
  private engine?: MentalistaEngine;
  private journal?: Journal;
  private abort = new AbortController();
  private queue = Promise.resolve();
  private queued = 0;
  private lastRevision = -1;
  private lastAt = 0;
  private raf = 0;
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private starting = false;
  private stopReason: MentalistaReason | null = null;
  constructor(private host: HTMLElement, private context: MentalistaContext, private session: Session, private db: Database,
    private owner: string, private done: (out: Outbox) => Promise<void>, private failed: (started: boolean) => void) {
    this.view = new MentalistaView(context);
  }
  async prepare() {
    this.host.replaceChildren(this.view.stage);
    this.view.board.textContent = 'Preparando…';
    try {
      await this.view.preflight();
      this.view.board.textContent = '¡Hola, Kud!';
      this.view.actions.replaceChildren(button('Entrar al laboratorio', () => {
        this.view.actions.replaceChildren();
        void this.view.transition('opening').then(() => this.view.instructions(() => { void this.begin(); }));
      }, 'button primary'));
    } catch { this.view.board.textContent = 'No pudimos cargar el escenario'; this.view.message.textContent = 'Comprueba la conexión y vuelve a abrir esta misma actividad. Todavía no empezó.'; }
  }
  private snapshot(): MentalistaSnapshot {
    const bounds = this.view.stage.getBoundingClientRect(), at = performance.now();
    return { taskId: 'TG-03', clock: { id: crypto.randomUUID(), timeOriginUnixMs: performance.timeOrigin }, startedAtMs: at, checkpointAtMs: at,
      device: { viewportWidth: innerWidth, viewportHeight: innerHeight, stageWidthCss: Math.min(innerWidth, bounds.width), stageHeightCss: Math.min(innerHeight, bounds.height),
        touchCapable: navigator.maxTouchPoints > 0, layoutPreset: innerHeight > innerWidth ? 'portrait' : 'landscape' },
      events: [], incidents: [], extraResponses: [], preparation: structuredClone(this.view.preparation), terminationReason: null };
  }
  private async begin() {
    if (this.busy || !navigator.onLine || document.hidden) { this.view.message.textContent = 'Para comenzar, vuelve a esta ventana y comprueba la conexión.'; return; }
    this.busy = this.starting = true;
    let started = false;
    this.view.actions.replaceChildren(); this.view.message.textContent = 'Confirmando el inicio…';
    const initial = this.snapshot();
    try {
      await this.db.preflight(); this.journal = await this.session.start(this.context, initial); started = true;
      const on = <K extends keyof WindowEventMap>(type: K, fn: (event: WindowEventMap[K]) => void) => window.addEventListener(type, fn, { signal: this.abort.signal });
      on('blur', () => this.stop('focus_lost'));
      on('pagehide', () => this.stop('visibility_lost'));
      on('resize', () => { if (innerWidth !== initial.device.viewportWidth || innerHeight !== initial.device.viewportHeight) this.stop('layout_changed'); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop('visibility_lost'); }, { signal: this.abort.signal });
      on('error', () => this.stop('script_error')); on('unhandledrejection', () => this.stop('script_error'));
      this.timer = setInterval(() => {
        void this.db.lease(`execution:${this.context.sessionId}`, this.owner).then(ok => { if (!ok) this.stop('script_error'); }).catch(() => this.stop('storage_failure'));
      }, 3000);
      this.view.message.textContent = '';
      await countdown(value => { this.view.board.textContent = String(value); }, this.abort.signal).catch(() => undefined);
      this.starting = false;
      if (this.stopReason || document.hidden) {
        initial.terminationReason = this.stopReason ?? 'visibility_lost';
        await this.journal.create(initial); await this.complete(await this.journal.finalize(initial)); return;
      }
      const measured = this.snapshot();
      this.engine = new MentalistaEngine(measured, this.view.preparation);
      await this.journal.create(this.engine.snapshot());
      this.view.actions.replaceChildren(button('Terminar actividad', () => this.stop('user_exit'), 'button quiet'));
      this.view.draw(this.engine); this.view.board.focus();
      const response = (index: number | null, device: 'mouse' | 'touch' | 'pen' | 'keyboard', x: number | null = null, y: number | null = null) => {
        this.engine!.respond(index, performance.now(), device, x, y); this.view.draw(this.engine!); this.capture();
        if (!this.engine!.running) void this.close();
      };
      this.view.stage.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || !['mouse', 'touch', 'pen'].includes(event.pointerType) || (event.target as Element).closest('.mentalista-actions')) return;
        event.preventDefault();
        const target = (event.target as Element).closest<HTMLButtonElement>('[data-index]'), bounds = this.view.stage.getBoundingClientRect();
        response(target ? Number(target.dataset.index) : null, event.pointerType as 'mouse' | 'touch' | 'pen', Math.max(0, event.clientX - bounds.left), Math.max(0, event.clientY - bounds.top));
      }, { signal: this.abort.signal });
      on('keydown', event => {
        if (event.repeat) { if (/^[1-4]$/.test(event.key)) event.preventDefault(); return; }
        if (/^[1-4]$/.test(event.key)) { event.preventDefault(); response(Number(event.key) - 1, 'keyboard'); }
        else if (event.key === 'Enter' || event.key === ' ') {
          const target = (event.target as Element).closest<HTMLButtonElement>('[data-index]');
          if (target) { event.preventDefault(); response(Number(target.dataset.index), 'keyboard'); }
        }
      });
      on('offline', () => { this.engine?.incident('network_lost', performance.now()); this.capture(); });
      on('online', () => { this.engine?.incident('network_restored', performance.now()); this.capture(); });
      const frame = (at: number) => {
        this.engine!.frame(at); this.view.draw(this.engine!); this.capture();
        if (this.engine!.running) this.raf = requestAnimationFrame(frame); else void this.close();
      };
      this.raf = requestAnimationFrame(frame);
    } catch {
      this.cleanup(); this.busy = false; this.failed(started);
    } finally { this.starting = false; }
  }
  private capture() {
    const engine = this.engine;
    if (!engine || !this.journal || this.closing || engine.revision === this.lastRevision && engine.at - this.lastAt < 1000) return;
    if (this.queued >= 32) { this.stop('storage_failure'); return; }
    this.lastAt = engine.at; this.lastRevision = engine.revision; this.queued++;
    const snapshot = engine.snapshot();
    this.queue = this.queue.then(() => this.journal!.checkpoint(snapshot)).finally(() => this.queued--);
    void this.queue.catch(() => this.stop('storage_failure'));
  }
  stop(reason: MentalistaReason) {
    if (this.starting) { this.stopReason = reason; this.abort.abort(); return; }
    if (!this.engine?.running) return;
    this.engine.finish(reason, Math.max(this.engine.at, Math.min(performance.now(), this.engine.at + 250))); void this.close();
  }
  private cleanup() { cancelAnimationFrame(this.raf); clearInterval(this.timer); this.abort.abort(); }
  private async close() {
    if (this.closing || !this.engine || !this.journal) return; this.closing = true; this.cleanup();
    try {
      await this.queue.catch(() => undefined);
      // Durable terminal checkpoint precedes optional animation; reload can never turn completed into interrupted.
      await this.journal.checkpoint(this.engine.snapshot());
      this.view.actions.replaceChildren();
      if (this.engine.snapshot().terminationReason === 'items_completed') {
        this.view.board.textContent = 'Gracias por participar';
        await this.view.transition('closing');
        for (const incident of this.view.preparation.resourceIncidents.filter(i => i.phase === 'closing')) this.engine.closingIncident(incident.reason);
      }
      await this.complete(await this.journal.finalize(this.engine.snapshot()));
    } catch { this.failed(true); }
    finally { this.busy = false; await this.db.release(`execution:${this.context.sessionId}`, this.owner).catch(() => undefined); }
  }
  private async complete(out: Outbox) { this.cleanup(); await this.done(out); this.busy = false; }
  destroy() { this.view.destroy(); this.stop('user_exit'); }
}
