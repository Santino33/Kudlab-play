import { Clock } from './clock';
import { buildSequence, CONFIG, type ArrangedItem } from './sequence';

type InvalidReason = 'tab_hidden' | 'focus_lost' | 'interruption' | 'storage_failure' | 'evidence_limit';
type Pointer = { atMs: number; pointerType: 'mouse' | 'touch' | 'pen' | null; x: number; y: number };
export type Trial = {
  trial: number; itemId: string; category: string; level: number; segment: number | null;
  words: string[]; targetIdx: number; selectedIdx: number | null;
  presentedAtMs: number; respondedAtMs: number | null; closedAtMs: number | null; rtMs: number | null;
  result: 'correct' | 'incorrect' | 'omission' | null; valid: boolean; invalidReason: InvalidReason | null;
  anticipatory: boolean; closureReason: 'response' | 'timeout' | 'interruption' | null;
  pointerType: Pointer['pointerType']; responseX: number | null; responseY: number | null;
};
const round = (value: number) => Math.round(value * 10) / 10;

// View supplies first visible frame and normalized PointerEvent timestamps; shell owns persistence.
export class Engine {
  private readonly sequence = buildSequence();
  private readonly clock = new Clock();
  private events: Trial[] = [];
  private practice: { round: number; items: Trial[]; errors: number }[] = [];
  private active: Trial | null = null;
  private activeClock = 0;
  private hidden = false;
  private blurred = false;
  private nextAt = 0;
  private practiceStartedAt: number | null = null;
  private practiceEndedAt: number | null = null;
  private measurementStartedAt: number | null = null;
  private measurementEndedAt: number | null = null;
  private measurementPausedAtStart = 0;
  private terminal: 'completed' | 'interrupted' | null = null;
  private reason: InvalidReason | null = null;
  private incidents: { type: 'tab_hidden' | 'tab_visible' | 'loss_of_focus' | 'focus_regained'; atMs: number }[] = [];
  private extras: (Pointer & { region: 'locked' | 'outside_cards'; segment: number })[] = [];
  revision = 0;

  get finished() { return this.terminal !== null; }
  get practiceFinished() { return this.practiceEndedAt !== null; }
  get practiceCompleted() { return this.practiceFinished && this.practice.at(-1)!.errors === 0; }
  get nextPresentationAt() { return this.nextAt; }

  startPractice(at: number) {
    this.clock.observe(at);
    if (this.finished || this.practiceStartedAt !== null) throw new Error('INVALID_TG02_PRACTICE_START');
    this.practiceStartedAt = at; this.nextAt = at + 1900; this.revision++;
  }
  startMeasurement(at: number) {
    this.clock.observe(at);
    // 1800ms greeting + original 3-2-1, 800ms each, after the final practice transition.
    if (this.finished || !this.practiceFinished || this.active || this.measurementStartedAt !== null || at < this.nextAt + 4200)
      throw new Error('INVALID_TG02_MEASUREMENT_START');
    this.measurementStartedAt = at; this.measurementPausedAtStart = this.clock.pausedAt(at); this.nextAt = at; this.revision++;
  }
  nextItem(): ArrangedItem | null {
    if (this.finished || this.active || this.practiceStartedAt === null) return null;
    if (this.measurementStartedAt !== null) return structuredClone(this.sequence.seq[this.events.length] ?? null);
    if (this.practiceFinished) return null;
    return structuredClone(this.sequence.practice[(this.practice.at(-1)?.items.length ?? 0) % 3]!);
  }
  presented(at: number) {
    this.clock.observe(at);
    const arranged = this.nextItem();
    if (!arranged || at < this.nextAt) throw new Error('INVALID_TG02_PRESENTATION');
    const measured = this.measurementStartedAt !== null;
    if (!measured && (!this.practice.length || this.practice.at(-1)!.items.length === 3))
      this.practice.push({ round: this.practice.length + 1, items: [], errors: 0 });
    const trial = measured ? this.events.length + 1 : this.practice.at(-1)!.items.length + 1;
    const invalidReason = this.hidden ? 'tab_hidden' : this.blurred ? 'focus_lost' : null;
    this.active = { trial, itemId: arranged.item.id, category: arranged.item.category, level: arranged.item.level,
      segment: measured ? Math.floor((trial - 1) / 6) + 1 : null, words: [...arranged.words], targetIdx: arranged.targetIdx,
      selectedIdx: null, presentedAtMs: round(at), respondedAtMs: null, closedAtMs: null, rtMs: null, result: null,
      valid: invalidReason === null, invalidReason, anticipatory: false, closureReason: null,
      pointerType: null, responseX: null, responseY: null };
    this.presentedRaw = at; this.activeClock = this.clock.active(at); this.revision++;
    return structuredClone(this.active);
  }
  private presentedRaw = 0;
  tap(position: number | null, pointer: Pointer) {
    if (this.finished) return false;
    if (!Number.isFinite(pointer.atMs) || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) ||
      position !== null && (!Number.isInteger(position) || position < 0 || position > 3)) return false;
    if (pointer.atMs < 0 || this.active && pointer.atMs < this.presentedRaw) return false;
    const observedAt = this.clock.input(pointer.atMs);
    if (position === null || !this.active) {
      if (this.measurementStartedAt !== null) {
        if (this.extras.length >= 1000) { this.interrupt('evidence_limit', observedAt); return false; }
        this.extras.push({ ...pointer, atMs: round(pointer.atMs), x: round(pointer.x), y: round(pointer.y),
          region: position === null ? 'outside_cards' : 'locked', segment: this.active?.segment ?? this.events.at(-1)?.segment ?? 1 });
        this.revision++;
      }
      return false;
    }
    const trial = this.active;
    trial.selectedIdx = position; trial.respondedAtMs = round(pointer.atMs);
    trial.rtMs = round(pointer.atMs - this.presentedRaw); // Original wall-clock RT, not the paused timeout clock.
    trial.result = position === trial.targetIdx ? 'correct' : 'incorrect'; trial.anticipatory = trial.rtMs < CONFIG.anticipatoryMs;
    trial.pointerType = pointer.pointerType; trial.responseX = round(pointer.x); trial.responseY = round(pointer.y);
    this.close('response', pointer.atMs);
    return true;
  }
  tick(at: number) {
    const active = this.clock.active(at);
    if (!this.finished && this.active && active - this.activeClock >= CONFIG.itemTimeoutMs) {
      this.active.result = 'omission'; this.close('timeout', at);
    }
  }
  focus(hidden: boolean, blurred: boolean, at: number) {
    if (this.finished) return;
    this.clock.observe(at);
    const changes: typeof this.incidents = [];
    if (hidden !== this.hidden) changes.push({ type: hidden ? 'tab_hidden' : 'tab_visible', atMs: round(at) });
    if (blurred !== this.blurred) changes.push({ type: blurred ? 'loss_of_focus' : 'focus_regained', atMs: round(at) });
    if (this.incidents.length + changes.length > 1000) { this.interrupt('evidence_limit', at); return; }
    this.incidents.push(...changes); this.clock.visibility(hidden, at); this.hidden = hidden; this.blurred = blurred;
    if (this.active?.valid && (hidden || blurred)) {
      this.active.valid = false; this.active.invalidReason = hidden ? 'tab_hidden' : 'focus_lost';
    }
    if (changes.length) this.revision++;
  }
  private close(reason: 'response' | 'timeout', at: number) {
    const trial = this.active!;
    trial.closureReason = reason; trial.closedAtMs = round(at); this.active = null;
    if (this.measurementStartedAt !== null) {
      this.events.push(trial);
      this.nextAt = at + (reason === 'timeout' ? 0 : CONFIG.selectionHoldMs) + CONFIG.transitionMs;
      // Seal measurement before the decorative closing transition/video, including abrupt exit there.
      if (this.events.length === 18) { this.terminal = 'completed'; this.measurementEndedAt = at; }
    } else {
      const round = this.practice.at(-1)!;
      round.items.push(trial); if (trial.result !== 'correct') round.errors++;
      this.nextAt = at + (trial.result === 'correct' ? 2400 : 3400) + CONFIG.transitionMs;
      if (round.items.length === 3) {
        if (!round.errors || round.round === CONFIG.practiceMaxRounds) this.practiceEndedAt = this.nextAt;
        else this.nextAt += 1900;
      }
    }
    this.revision++;
  }
  interrupt(reason: InvalidReason, at: number) {
    if (this.finished) return;
    this.clock.observe(at);
    if (this.active) {
      this.active.valid = false; this.active.invalidReason = reason;
      this.active.closureReason = 'interruption'; this.active.closedAtMs = round(at);
      if (this.measurementStartedAt !== null) this.events.push(this.active);
      else this.practice.at(-1)!.items.push(this.active);
      this.active = null;
    }
    this.reason = reason; this.terminal = 'interrupted';
    if (this.measurementStartedAt !== null) this.measurementEndedAt = at;
    this.revision++;
  }
  snapshot(at: number) {
    this.clock.observe(at);
    const end = this.measurementEndedAt ?? at;
    const pausedMs = this.measurementStartedAt === null ? 0 : this.clock.pausedAt(end) - this.measurementPausedAtStart;
    return structuredClone({ events: this.events, practice: this.practice, active: this.active,
      practiceCompleted: this.practiceCompleted, practiceStartedAtMs: this.practiceStartedAt, practiceEndedAtMs: this.practiceEndedAt,
      measurementStartedAtMs: this.measurementStartedAt, measurementEndedAtMs: this.measurementEndedAt,
      measurementDurationMs: this.measurementStartedAt === null ? null : round(end - this.measurementStartedAt - pausedMs),
      pausedMs: round(pausedMs), pauses: this.clock.pauses, incidents: this.incidents, emptyResponses: this.extras,
      state: this.terminal ?? 'running', reason: this.reason });
  }
}
