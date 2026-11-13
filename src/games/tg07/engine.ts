import { buildSequences, CONFIG, scoreTrial } from './sequence';

export type Tap = { drum: number; atMs: number; pointerType: 'mouse' | 'touch' | 'pen' | null };
type InvalidReason = 'tab_hidden' | 'focus_lost' | 'interrupted' | 'storage_failure' | 'evidence_limit';
export type Trial = {
  trial: number; length: number; sequence: number[]; sequenceIndex: number; attemptAtLength: number; isReplacement: boolean;
  startedAtMs: number; presentationStartMs: number | null; responseOpenedAtMs: number | null; closedAtMs: number | null;
  responses: Tap[]; earlyTaps: Tap[]; valid: boolean; invalidReason: InvalidReason | null;
  closureReason: 'response' | 'timeout' | 'interruption' | null;
};
export class Engine {
  readonly sequences = buildSequences();
  private events: Trial[] = [];
  private practice: { round: number; evidence: Trial }[] = [];
  private active: Trial | null = null;
  private token = 0;
  private length: number = CONFIG.startLength;
  private used = 0;
  private valid = 0;
  private correct = 0;
  private hidden = false;
  private blurred = false;
  private terminal = false;
  private measurementStartedAtMs: number | null = null;
  private reason: 'invalid_trials' | 'all_trials_incorrect_at_length' | 'max_length_reached' | InvalidReason | null = null;
  practiceCompleted = false;
  revision = 0;

  get practiceFinished() { return this.practiceCompleted || this.practice.length === CONFIG.practice.maxRounds; }
  get finished() { return this.terminal; }
  startMeasurement(at: number) {
    if (this.terminal || this.active || !this.practiceFinished || this.measurementStartedAtMs !== null) throw new Error('INVALID_MEASUREMENT_START');
    this.measurementStartedAtMs = at; this.revision++;
  }
  beginTrial(at: number) {
    if (this.terminal || this.active || this.measurementStartedAtMs === null && this.practiceFinished) throw new Error('INVALID_TRIAL_START');
    const practice = this.measurementStartedAtMs === null;
    const sequence = practice ? this.sequences.practice[this.practice.length + 1] : this.sequences.byLength[this.length][this.used];
    const invalidReason = this.blurred ? 'focus_lost' : this.hidden ? 'tab_hidden' : null;
    this.active = { trial: practice ? this.practice.length + 1 : this.events.length + 1, length: sequence.length,
      sequence: [...sequence], sequenceIndex: practice ? this.practice.length : this.used,
      attemptAtLength: practice ? this.practice.length + 1 : this.valid + 1, isReplacement: !practice && this.used >= CONFIG.trialsPerLength,
      startedAtMs: at, presentationStartMs: null, responseOpenedAtMs: null, closedAtMs: null,
      responses: [], earlyTaps: [], valid: invalidReason === null, invalidReason, closureReason: null };
    this.token++; this.revision++;
    return { token: this.token, trial: structuredClone(this.active) };
  }
  presentationStarted(token: number, at: number) {
    if (!this.active || token !== this.token || this.active.presentationStartMs !== null) return;
    this.active.presentationStartMs = at; this.revision++;
  }
  openResponse(token: number, at: number) {
    if (!this.active || token !== this.token || this.active.presentationStartMs === null || this.active.responseOpenedAtMs !== null) return;
    this.active.responseOpenedAtMs = at; this.revision++;
  }
  tap(drum: number, atMs: number, pointerType: Tap['pointerType']) {
    const trial = this.active;
    if (!trial || this.terminal || !Number.isInteger(drum) || drum < 0 || drum > 3 || !Number.isFinite(atMs) || atMs < trial.startedAtMs) return null;
    const response = trial.responseOpenedAtMs !== null;
    const taps = response ? trial.responses : trial.earlyTaps;
    if (atMs < (taps.at(-1)?.atMs ?? trial.responseOpenedAtMs ?? trial.startedAtMs)) return null;
    if (taps.length >= 1000) { this.interrupt('evidence_limit', atMs); return null; }
    taps.push({ drum, atMs, pointerType }); this.revision++;
    return { token: this.token, response, count: taps.length, complete: response && taps.length >= trial.length };
  }
  focus(hidden: boolean, blurred: boolean) {
    this.hidden = hidden; this.blurred = blurred;
    if (this.active?.valid && (hidden || blurred)) {
      this.active.valid = false; this.active.invalidReason = hidden ? 'tab_hidden' : 'focus_lost'; this.revision++;
    }
  }
  closeTrial(token: number, at: number, timedOut: boolean) {
    const trial = this.active;
    if (!trial || token !== this.token || this.terminal || trial.responseOpenedAtMs === null) return null;
    trial.closedAtMs = at; trial.closureReason = timedOut ? 'timeout' : 'response';
    const score = scoreTrial(trial.sequence, trial.responses);
    this.active = null; this.revision++;
    if (this.measurementStartedAtMs === null) {
      this.practice.push({ round: this.practice.length + 1, evidence: trial });
      // Original practice advances on a correct response, even if focus invalidated that practice round.
      this.practiceCompleted = score.outcome === 'correct';
    } else {
      this.events.push(trial); this.used++;
      if (trial.valid) { this.valid++; if (score.outcome === 'correct') this.correct++; }
      if (this.valid === CONFIG.trialsPerLength || this.used === CONFIG.trialsPerLength + CONFIG.reservePerLength) {
        if (!this.valid) this.reason = 'invalid_trials';
        else if (!this.correct) this.reason = 'all_trials_incorrect_at_length';
        else if (this.length === CONFIG.maxLength) this.reason = 'max_length_reached';
        else { this.length++; this.used = this.valid = this.correct = 0; }
        if (this.reason) this.terminal = true;
      }
    }
    return { evidence: structuredClone(trial), score };
  }
  interrupt(reason: InvalidReason, at: number) {
    if (this.terminal) return;
    if (this.active) {
      this.active.valid = false; this.active.invalidReason = reason; this.active.closedAtMs = at; this.active.closureReason = 'interruption';
      if (this.measurementStartedAtMs === null) this.practice.push({ round: this.practice.length + 1, evidence: this.active });
      else this.events.push(this.active);
      this.active = null;
    }
    this.reason = reason; this.terminal = true; this.revision++;
  }
  snapshot() {
    return structuredClone({ events: this.events, practice: this.practice, active: this.active, practiceCompleted: this.practiceCompleted,
      measurementStartedAtMs: this.measurementStartedAtMs, reason: this.reason, terminal: this.terminal });
  }
}
