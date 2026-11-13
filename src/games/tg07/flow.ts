import { z } from 'zod';
import { kudDiceContextSchema, type KudDiceEnvelope } from '../../contract/kud-dice';
import type { Journal, Outbox } from '../../evidence/journal';
import type { Session } from '../../runtime/session';
import type { Database } from '../../storage/database';
import { Clock } from './clock';
import { Engine, type Tap } from './engine';
import type { KudDiceSnapshot } from './snapshot';
import { KudDiceView } from './view';
type Context = z.infer<typeof kudDiceContextSchema>;
type Reason = KudDiceEnvelope['terminationReason'];

export class KudDiceFlow {
  busy = false;
  private view: KudDiceView;
  private engine = new Engine();
  private clock = new Clock();
  private abort = new AbortController();
  private journal?: Journal;
  private state?: KudDiceSnapshot;
  private queue = Promise.resolve();
  private queued = 0;
  private closing = false;
  private sealed = false;
  private destroyed = false;
  private blurred = false;
  private timer?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private response?: (drum: number, event: PointerEvent) => void;
  constructor(private host: HTMLElement, private context: Context, private session: Session, private db: Database,
    private owner: string, private done: (out: Outbox) => Promise<void>, private failed: (started: boolean) => void) {
    this.view = new KudDiceView((type, detail) => this.incident(type, detail));
  }
  async prepare() {
    this.host.replaceChildren(this.view.host);
    try {
      await this.view.preflight();
      this.view.say('¡Hola! Soy Kud.', 1400);
      await this.view.buttons(['¡Hola, Kud!']);
      // User gesture unlocks audio; authorization is confirmed before instructions/practice.
      const audio = this.view.initAudio();
      await this.begin(audio);
    } catch { if (!this.destroyed && !this.closing) this.view.error('No pudimos cargar el escenario. Comprueba la conexión y vuelve a abrir esta actividad.'); }
  }
  private initial(): KudDiceSnapshot {
    const rect = this.view.stage.getBoundingClientRect(), at = this.clock.now();
    return { taskId: 'TG-07', clock: { id: crypto.randomUUID(), timeOriginUnixMs: performance.timeOrigin },
      startedAtMs: at, checkpointAtMs: at, measurementStartedAtMs: null, measurementFinishedAtMs: null,
      phaseReached: 'intro', device: { viewportWidth: innerWidth, viewportHeight: innerHeight, stageWidthCss: rect.width,
        stageHeightCss: rect.height, devicePixelRatio: devicePixelRatio || 1, touchCapable: navigator.maxTouchPoints > 0, pointerTypes: [] },
      audio: structuredClone(this.view.audio), preparation: { instruction: { shownAtMs: null, acceptedAtMs: null, repeats: 0 },
        demoShown: false, practiceCompleted: false, practice: [] }, events: [], active: null, incidents: [], terminationReason: null };
  }
  private async begin(audio: Promise<void>) {
    if (this.busy || this.destroyed) return;
    if (!navigator.onLine || document.hidden) { this.failed(false); return; }
    this.busy = true; this.state = this.initial();
    try {
      await this.db.preflight(); this.journal = await this.session.start(this.context, this.state);
      await this.journal.create(this.state);
      if (this.destroyed) { await this.journal.recover(); return; }
      this.listeners(); await audio;
      if (this.view.audio.missingFiles.length) this.incident('resource_load_error', this.view.audio.missingFiles.join(','));
      if (this.state.device.stageWidthCss < 700) this.incident('small_stage', String(this.state.device.stageWidthCss));
      await this.run();
    } catch { if (!this.closing && !this.destroyed) { this.cleanup(); this.clock.destroy(); this.view.destroy(); this.busy = false; this.failed(Boolean(this.journal)); } }
  }
  private snapshot(): KudDiceSnapshot {
    const s = structuredClone(this.state!), engine = this.engine.snapshot();
    return { ...s, checkpointAtMs: this.clock.now(), audio: structuredClone(this.view.audio), events: engine.events, active: engine.active,
      measurementStartedAtMs: engine.measurementStartedAtMs,
      preparation: { ...s.preparation, practice: engine.practice, practiceCompleted: engine.practiceCompleted } };
  }
  private capture() {
    if (!this.journal || this.closing || this.sealed) return;
    if (this.queued >= 32) { this.stop('storage_failure'); return; }
    const s = this.snapshot(); this.queued++;
    this.queue = this.queue.then(() => this.journal!.checkpoint(s)).finally(() => this.queued--);
    void this.queue.catch(() => this.stop('storage_failure'));
  }
  private incident(type: KudDiceEnvelope['incidents'][number]['type'], detail: string | null = null) {
    if (!this.state || this.closing || this.sealed) return;
    if (this.state.incidents.length >= 999) { this.stop('evidence_limit'); return; }
    this.state.incidents.push({ sequence: this.state.incidents.length + 1, type, phase: this.state.phaseReached,
      clockId: this.state.clock.id, atMs: this.clock.now(), recordedAtClient: null, durationMs: null, detail }); this.capture();
  }
  private listeners() {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (event: WindowEventMap[K]) => void) => window.addEventListener(type, fn, { signal: this.abort.signal });
    on('blur', () => { this.blurred = true; this.engine.focus(document.hidden, true); this.incident('loss_of_focus'); });
    on('focus', () => { this.blurred = false; this.engine.focus(document.hidden, false); this.incident('focus_regained'); });
    document.addEventListener('visibilitychange', () => { this.engine.focus(document.hidden, this.blurred); this.incident(document.hidden ? 'tab_hidden' : 'tab_visible'); }, { signal: this.abort.signal });
    on('pagehide', () => this.stop('user_exit')); on('error', () => this.stop('script_error'));
    on('offline', () => this.incident('network_lost')); on('online', () => this.incident('network_restored'));
    this.heartbeat = setInterval(() => this.capture(), 1000);
    this.timer = setInterval(() => { void this.db.lease(`execution:${this.context.sessionId}`, this.owner)
      .then(ok => { if (!ok) this.stop('script_error'); }).catch(() => this.stop('storage_failure')); }, 3000);
    this.view.onTap = (drum, event) => {
      if (this.closing || this.sealed) return;
      const pointer = ['mouse', 'touch', 'pen'].includes(event.pointerType) ? event.pointerType as Tap['pointerType'] : null;
      if (pointer && !this.state!.device.pointerTypes.includes(pointer)) this.state!.device.pointerTypes.push(pointer);
      if (this.response) this.response(drum, event);
      else { this.engine.tap(drum, this.clock.now(), pointer); this.capture(); }
    };
  }
  private async present(sequence: number[], token?: number) {
    this.view.enabled(false); await this.clock.wait(900);
    if (token !== undefined) { this.engine.presentationStarted(token, this.clock.now()); this.capture(); }
    for (const drum of sequence) { this.view.light(drum, 600); this.view.tone(drum, 600); await this.clock.wait(900); }
  }
  private async trial() {
    const { token, trial } = this.engine.beginTrial(this.clock.now()); this.capture();
    this.view.say('¡Mira y escucha!', 900); await this.present(trial.sequence, token);
    this.engine.openResponse(token, this.clock.now()); this.capture(); this.view.say('¡Tu turno!', 700);
    const result = await new Promise<ReturnType<Engine['closeTrial']>>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>; const endings: ReturnType<typeof setTimeout>[] = []; let finished = false;
      const abort = () => { clearTimeout(timeout); endings.forEach(clearTimeout); this.response = undefined; reject(new DOMException('Stopped', 'AbortError')); };
      this.abort.signal.addEventListener('abort', abort, { once: true });
      const finish = (timedOut: boolean) => {
        if (finished) return; finished = true; clearTimeout(timeout); endings.forEach(clearTimeout);
        this.abort.signal.removeEventListener('abort', abort); this.response = undefined; this.view.enabled(false);
        const closed = this.engine.closeTrial(token, this.clock.now(), timedOut); this.capture(); resolve(closed);
      };
      const arm = () => { clearTimeout(timeout); timeout = setTimeout(() => finish(true), 8000); };
      this.view.taps(trial.length, []); this.view.enabled(true);
      const responses: number[] = [];
      this.response = (drum, event) => {
        const pointer = ['mouse', 'touch', 'pen'].includes(event.pointerType) ? event.pointerType as Tap['pointerType'] : null;
        const tap = this.engine.tap(drum, this.clock.now(), pointer);
        if (!tap) { if (this.engine.finished) this.stop('evidence_limit'); return; }
        this.view.light(drum, 220); this.view.tone(drum, 300); responses.push(drum); this.view.taps(trial.length, responses); this.capture();
        // Preserve extra taps and the previous inactivity timeout during the original 250ms window.
        if (tap.complete) endings.push(setTimeout(() => finish(false), 250)); else arm();
      };
      arm();
    });
    this.view.taps(0, []); if (!result) throw new Error('TRIAL_MISSING'); return result;
  }
  private async run() {
    const s = this.state!; s.preparation.instruction.shownAtMs = this.clock.now(); this.capture();
    for (;;) {
      this.view.say('Vamos a mi laboratorio musical.', 2200); await this.clock.wait(2600);
      this.view.say('Mis tambores van a tocar una canción.', 2400); await this.clock.wait(2800);
      this.view.say('Escucha bien y tócalos en el mismo orden.', 2600); await this.clock.wait(2800);
      if (await this.view.buttons(['¡Vamos!', 'Escuchar otra vez']) === 0) break;
      if (s.preparation.instruction.repeats >= 1000) { this.stop('evidence_limit'); return; }
      s.preparation.instruction.repeats++; this.capture();
    }
    s.preparation.instruction.acceptedAtMs = this.clock.now(); s.phaseReached = 'transition'; this.capture();
    await this.view.transition(); this.view.scene(true); await this.clock.wait(300);
    s.phaseReached = 'practice'; this.capture();
    this.view.say('Mira, primero lo hago yo.', 1600); await this.clock.wait(1800);
    await this.present(this.engine.sequences.practice[0]);
    this.view.say('Ahora la repito igualita…', 1500); await this.clock.wait(1300);
    for (const drum of this.engine.sequences.practice[0]) { this.view.light(drum, 450); this.view.tone(drum, 450); await this.clock.wait(700); }
    s.preparation.demoShown = true; this.capture(); this.view.say('¡Así! Ahora tú.', 1400); await this.clock.wait(1600);
    while (!this.engine.practiceFinished) {
      const result = await this.trial();
      if (result.score.outcome === 'correct') { this.view.celebrate(); this.view.say('¡Muy bien! Lo entendiste.', 1500); await this.clock.wait(1800); }
      else { this.view.say(this.engine.practiceFinished ? '¡Buen intento! Vamos a empezar.' : '¡Casi! Escucha otra vez y repite en el mismo orden.', 2200); await this.clock.wait(2400); }
    }
    this.view.say('¡Ahora empieza el concierto!', 1600); await this.view.buttons(['¡Empezar!']);
    s.phaseReached = 'test'; this.engine.startMeasurement(this.clock.now()); this.capture();
    let previousLength = 2;
    while (!this.engine.finished) {
      const result = await this.trial();
      if (result.score.outcome === 'correct') { this.view.celebrate(); this.view.say('¡Muy bien!', 1100); } else this.view.say('¡Buen intento!', 1100);
      await this.clock.wait(1500);
      const events = this.engine.snapshot().events.filter(e => e.length === previousLength);
      if (!this.engine.finished && (events.filter(e => e.valid).length === 2 || events.length === 3)) {
        previousLength++; this.view.say('¡Ahora la canción es más larga!', 1500); await this.clock.wait(1700);
      }
    }
    s.phaseReached = 'done'; s.measurementFinishedAtMs = this.clock.now(); s.terminationReason = this.engine.snapshot().reason as Reason;
    await this.close(true);
  }
  stop(reason: Reason) {
    if (this.closing || this.sealed || !this.state || !this.journal) return;
    this.engine.interrupt(reason === 'storage_failure' || reason === 'evidence_limit' ? reason : 'interrupted', this.clock.now());
    this.state.terminationReason = reason; void this.close(false);
  }
  private cleanup() { this.abort.abort(); clearInterval(this.timer); clearInterval(this.heartbeat); this.response = undefined; }
  private async close(completed: boolean) {
    if (this.closing || !this.journal) return; this.closing = true; this.cleanup();
    if (!completed) this.clock.destroy();
    try {
      await this.queue.catch(() => undefined);
      const out = await this.journal.finalize(this.snapshot()); this.sealed = true;
      if (completed && !this.destroyed) {
        this.view.celebrate(); this.view.say('¡Concierto terminado!', 2000); await this.clock.wait(2400);
        await this.view.transition(true); this.view.scene(false); this.view.say('¡Gracias por tocar conmigo!', 2600); await this.clock.wait(2600);
      }
      if (!this.destroyed) { this.view.destroy(); await this.done(out); }
    } catch { if (!this.destroyed) { this.view.destroy(); this.failed(true); } }
    finally { this.busy = false; await this.db.release(`execution:${this.context.sessionId}`, this.owner).catch(() => undefined); }
  }
  destroy() { this.destroyed = true; this.stop('user_exit'); this.cleanup(); this.clock.destroy(); this.view.destroy(); }
}
