import { Engine, type Trial } from './engine';
import { View } from './view';
import type { PalabraEnvelope } from '../../contract/palabra-intrusa';

const QUESTION = '¿Cuál palabra no pertenece al grupo?';
const r1 = (n: number) => Math.round(n * 10) / 10;
export interface PalabraSnapshot {
  taskId: 'TG-02'; clock: PalabraEnvelope['clock']; device: PalabraEnvelope['device'];
  startedAtMs: number; checkpointAtMs: number; phaseReached: PalabraEnvelope['phaseReached'];
  instruction: PalabraEnvelope['preparation']['instruction'];
  evidence: ReturnType<Engine['snapshot']>; incidents: PalabraEnvelope['incidents'];
  terminationReason: PalabraEnvelope['terminationReason'] | null;
}
export class Flow {
  private readonly engine = new Engine();
  readonly view: View;
  private readonly clock = { id: crypto.randomUUID(), timeOriginUnixMs: performance.timeOrigin };
  private readonly startedAt = performance.now();
  private phase: PalabraEnvelope['phaseReached'] = 'loading';
  private instruction: PalabraEnvelope['preparation']['instruction'] = { shownAtMs: null, acceptedAtMs: null, repeats: 0 };
  private incidents: PalabraEnvelope['incidents'] = [];
  private pointerTypes: PalabraEnvelope['device']['pointerTypes'] = [];
  private terminal: PalabraEnvelope['terminationReason'] | null = null;
  private sealed: PalabraSnapshot | null = null;
  private frame = 0;
  private itemDone: ((trial: Trial | null) => void) | null = null;
  private focusCount = 0;
  private blurred = false;
  constructor(host: HTMLElement, private readonly changed: (snapshot: PalabraSnapshot) => void, private readonly finished: (snapshot: PalabraSnapshot) => void) {
    this.view = new View(host);
    const signal = this.view.signal;
    document.addEventListener('visibilitychange', () => this.focus(), { signal });
    window.addEventListener('blur', () => { this.blurred = true; this.focus(); }, { signal });
    window.addEventListener('focus', () => { this.blurred = false; this.focus(); }, { signal });
    this.view.root.addEventListener('pointerdown', e => {
      if ((e.target as Element).closest('.btn')) return;
      const card = (e.target as Element).closest<HTMLElement>('[data-pos]');
      const rect = this.view.root.getBoundingClientRect();
      const pointerType = ['mouse', 'touch', 'pen'].includes(e.pointerType) ? e.pointerType as 'mouse' | 'touch' | 'pen' : null;
      if (pointerType && !this.pointerTypes.includes(pointerType)) this.pointerTypes.push(pointerType);
      e.preventDefault();
      const atMs = e.timeStamp > performance.timeOrigin ? e.timeStamp - performance.timeOrigin : e.timeStamp;
      this.engine.tap(card ? Number(card.dataset.pos) : null, { atMs, pointerType, x: (e.clientX - rect.left) / rect.width * 1920, y: (e.clientY - rect.top) / rect.height * 1080 });
      this.checkItem(); this.checkpoint();
    }, { signal });
    this.view.root.addEventListener('keydown', e => {
      const card = (e.target as Element).closest<HTMLElement>('[data-pos]');
      if (!card || !['Enter', ' '].includes(e.key) || e.repeat) return;
      e.preventDefault(); const rect = card.getBoundingClientRect(), stage = this.view.root.getBoundingClientRect();
      this.engine.tap(Number(card.dataset.pos), { atMs: performance.now(), pointerType: null,
        x: (rect.left + rect.width / 2 - stage.left) / stage.width * 1920, y: (rect.top + rect.height / 2 - stage.top) / stage.height * 1080 });
      this.checkItem(); this.checkpoint();
    }, { signal });
  }
  private focus() {
    if (this.sealed) return;
    this.engine.focus(document.hidden, this.blurred, performance.now());
    const changes = this.engine.snapshot(performance.now()).incidents;
    for (const i of changes.slice(this.focusCount)) this.incidents.push({ ...i, sequence: 0, phase: this.phase, clockId: this.clock.id, recordedAtClient: null, durationMs: null, detail: null });
    this.focusCount = changes.length; this.checkpoint();
  }
  private incident(type: PalabraEnvelope['incidents'][number]['type']) {
    if (this.sealed) return;
    this.incidents.push({ sequence: 0, type, phase: this.phase, clockId: this.clock.id, atMs: r1(performance.now()), recordedAtClient: null, durationMs: null, detail: null });
  }
  snapshot(): PalabraSnapshot {
    if (this.sealed) return structuredClone(this.sealed);
    const at = performance.now(), evidence = this.engine.snapshot(at), rect = this.view.root.getBoundingClientRect();
    const incidents = [...this.incidents]
      .sort((a, b) => a.atMs! - b.atMs!).map((i, index) => ({ ...i, sequence: index + 1 }));
    return { taskId: 'TG-02', clock: this.clock, startedAtMs: r1(this.startedAt), checkpointAtMs: r1(at), phaseReached: this.phase,
      instruction: { ...this.instruction }, evidence, incidents, terminationReason: this.terminal,
      device: { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, stageWidthCss: rect.width, stageHeightCss: rect.height,
        devicePixelRatio: window.devicePixelRatio, touchCapable: navigator.maxTouchPoints > 0, pointerTypes: [...this.pointerTypes] } };
  }
  private checkpoint() { if (!this.view.signal.aborted && !this.sealed) this.changed(this.snapshot()); }
  private checkItem() {
    const s = this.engine.snapshot(performance.now());
    if (this.itemDone && !s.active) { const last = s.measurementStartedAtMs === null ? s.practice.at(-1)?.items.at(-1) : s.events.at(-1);
      if (last) { const done = this.itemDone; this.itemDone = null; done(last); } }
  }
  private async item() {
    const item = this.engine.nextItem(); if (!item || this.view.signal.aborted) return null;
    await this.view.wait(this.engine.nextPresentationAt - performance.now());
    if (this.view.signal.aborted) return null;
    if (this.phase === 'practice') this.view.say(QUESTION, 900, false);
    this.view.cards(item.words);
    const trial = await new Promise<Trial | null>(resolve => {
      this.frame = requestAnimationFrame(() => {
        if (this.view.signal.aborted) { resolve(null); return; }
        this.engine.presented(performance.now()); this.checkpoint(); this.itemDone = resolve;
        const tick = () => { if (this.view.signal.aborted || !this.itemDone) return;
          this.engine.tick(performance.now()); this.checkItem(); this.frame = requestAnimationFrame(tick); };
        this.frame = requestAnimationFrame(tick);
      });
    });
    return trial;
  }
  async start() {
    try {
      await this.view.load(); if (this.view.signal.aborted) return;
      if (this.view.root.getBoundingClientRect().width < 700) this.incident('small_stage');
      this.phase = 'intro'; this.checkpoint(); this.view.say('¡Hola! Soy Kud.', 1400);
      await this.view.buttons(['¡Hola, Kud!']); if (this.view.signal.aborted) return;
      this.instruction.shownAtMs = r1(performance.now());
      do {
        for (const [text, talk, wait] of [['Vamos a mi biblioteca.', 2000, 2400], ['Te voy a mostrar cuatro palabras.', 2200, 2600], ['Tres son del mismo grupo y una no.', 2400, 2800], ['Toca la palabra que no pertenece al grupo.', 2600, 2800]] as const) {
          this.view.say(text, talk); await this.view.wait(wait); if (this.view.signal.aborted) return;
        }
        if (await this.view.buttons(['¡Vamos!', 'Escuchar otra vez']) !== 1) break;
        this.instruction.repeats++; this.checkpoint();
      } while (!this.view.signal.aborted);
      if (this.view.signal.aborted) return;
      this.instruction.acceptedAtMs = r1(performance.now()); this.phase = 'transition'; this.checkpoint();
      if (await this.view.transition()) this.incident('transition_skipped');
      await this.view.wait(300); if (this.view.signal.aborted) return;
      this.phase = 'practice'; this.engine.startPractice(performance.now()); this.view.say('¡Primero practiquemos juntos!', 1600); this.checkpoint();
      while (!this.engine.practiceFinished && !this.view.signal.aborted) {
        const trial = await this.item(); if (!trial || this.view.signal.aborted) return;
        this.view.select(trial.selectedIdx, trial.targetIdx);
        const group = trial.words.filter((_, i) => i !== trial.targetIdx), correct = trial.result === 'correct';
        this.view.say(correct ? `¡Muy bien! «${trial.words[trial.targetIdx]}» no es de los ${trial.category}.` : `Mira: ${group[0]}, ${group[1]} y ${group[2]} son ${trial.category}. «${trial.words[trial.targetIdx]}» no.`, correct ? 2200 : 3000);
        this.checkpoint(); await this.view.wait(correct ? 2400 : 3400); this.view.hideCards(); await this.view.wait(500);
        if (trial.trial === 3 && !this.engine.practiceFinished) { this.view.say('¡Probemos otra vez!', 1600); await this.view.wait(1900); }
      }
      if (this.view.signal.aborted) return;
      this.view.part('cards').classList.add('hidden'); this.phase = 'countdown'; this.checkpoint();
      this.view.say('¡Ahora sí! Vamos a empezar.', 1600); await this.view.wait(1800);
      for (const n of ['3', '2', '1']) { this.view.part('countdown').textContent = n; this.view.part('countdown').classList.remove('hidden'); await this.view.wait(800); }
      if (this.view.signal.aborted) return;
      this.view.part('countdown').classList.add('hidden');
      await this.view.wait(this.engine.nextPresentationAt + 4200 - performance.now());
      this.engine.startMeasurement(performance.now()); this.phase = 'test'; this.view.say(QUESTION, 0, false); this.view.progress(0); this.checkpoint();
      while (!this.engine.finished && !this.view.signal.aborted) {
        const trial = await this.item(); if (!trial || this.view.signal.aborted) return;
        this.view.select(trial.selectedIdx); this.checkpoint();
        if (this.engine.finished) { this.phase = 'done'; this.terminal = 'completed'; this.sealed = this.snapshot(); this.finished(structuredClone(this.sealed)); }
        await this.view.wait(trial.result === 'omission' ? 0 : 250); this.view.progress(trial.trial); this.view.hideCards(); await this.view.wait(500);
      }
      if (this.view.signal.aborted) return;
      this.view.part('progress').classList.add('hidden'); this.view.part('cards').classList.add('hidden');
      this.view.say('¡Terminamos!', 1800); await this.view.wait(2200); if (this.view.signal.aborted) return;
      await this.view.transition(true); if (!this.view.signal.aborted) this.view.say('¡Gracias por leer conmigo!', 2600);
    } catch { if (!this.view.signal.aborted) { this.incident(this.phase === 'loading' ? 'resource_load_error' : 'script_error'); this.stop(this.phase === 'loading' ? 'resource_load_error' : 'script_error'); } }
  }
  stop(reason: PalabraEnvelope['terminationReason'] = 'user_exit') {
    if (!this.sealed) { this.engine.interrupt(reason === 'storage_failure' || reason === 'evidence_limit' ? reason : 'interruption', performance.now());
      this.terminal = reason; this.sealed = this.snapshot();
      const last = this.sealed.evidence.measurementStartedAtMs === null ? this.sealed.evidence.practice.at(-1)?.items.at(-1) : this.sealed.evidence.events.at(-1);
      if (last?.closureReason === 'interruption') this.sealed.checkpointAtMs = last.closedAtMs!;
      this.finished(structuredClone(this.sealed)); }
    this.destroy();
  }
  destroy() { cancelAnimationFrame(this.frame); this.itemDone?.(null); this.itemDone = null; this.view.destroy(); }
}
