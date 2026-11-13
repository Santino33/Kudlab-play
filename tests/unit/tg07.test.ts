import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/games/tg07/engine';
import { Clock } from '../../src/games/tg07/clock';
import { buildSequences, scoreTrial } from '../../src/games/tg07/sequence';

function perform(engine: Engine, at: number, correct: boolean, invalidate = false) {
  const { token, trial } = engine.beginTrial(at);
  engine.presentationStarted(token, at + 900);
  const open = at + 900 + trial.length * 900;
  engine.openResponse(token, open);
  if (invalidate) { engine.focus(true, false); engine.focus(false, false); }
  if (correct) trial.sequence.forEach((drum, i) => engine.tap(drum, open + (i + 1) * 500, 'mouse'));
  const end = correct ? open + trial.length * 500 + 250 : open + 8000;
  const result = engine.closeTrial(token, end, !correct)!;
  return { ...result, token, next: end + 3200 };
}
function measuring() {
  const engine = new Engine();
  const practice = perform(engine, 0, true);
  engine.startMeasurement(practice.next);
  return { engine, at: practice.next };
}

describe('TG-07 independent engine / CA-02,04,07', () => {
  afterEach(() => vi.useRealTimers());
  it('uses exact first, reserve, last and practice sequences from e213cda', () => {
    const seq = buildSequences();
    expect(seq.byLength[2]).toEqual([[1, 2], [3, 2], [3, 1]]);
    expect(seq.byLength[7]).toEqual([[1, 3, 0, 1, 0, 3, 1], [0, 3, 0, 1, 3, 1, 2], [0, 1, 3, 1, 3, 1, 3]]);
    expect(seq.practice).toEqual([[2, 1], [2, 0], [1, 0]]);
    expect(scoreTrial([0, 1, 0], [{ drum: 0 }, { drum: 0 }, { drum: 0 }]).positions).toEqual(['correct', 'repetition', 'correct']);
  });
  it('requires practice and keeps it out of measurement events', () => {
    const engine = new Engine();
    expect(() => engine.startMeasurement(0)).toThrow('INVALID_MEASUREMENT_START');
    const first = perform(engine, 0, false);
    expect(engine.practiceFinished).toBe(false);
    const second = perform(engine, first.next, false);
    expect(engine.practiceFinished).toBe(true);
    engine.startMeasurement(second.next);
    expect(engine.snapshot()).toMatchObject({ events: [], practiceCompleted: false, measurementStartedAtMs: second.next });
    expect(engine.snapshot().practice).toHaveLength(2);
  });
  it('finishes at length seven after two valid correct trials per length', () => {
    const state = measuring();
    for (let length = 2; length <= 7; length++) for (let i = 0; i < 2; i++) {
      const result = perform(state.engine, state.at, true); state.at = result.next;
      expect(result.evidence).toMatchObject({ length, sequenceIndex: i, attemptAtLength: i + 1 });
    }
    expect(state.engine.snapshot()).toMatchObject({ reason: 'max_length_reached', terminal: true });
    expect(state.engine.snapshot().events).toHaveLength(12);
    expect(() => state.engine.beginTrial(state.at)).toThrow('INVALID_TRIAL_START');
  });
  it('stops after two valid failures instead of using the reserve as another attempt', () => {
    const { engine, at } = measuring(); const first = perform(engine, at, false); perform(engine, first.next, false);
    expect(engine.snapshot()).toMatchObject({ reason: 'all_trials_incorrect_at_length', terminal: true });
    expect(engine.snapshot().events).toHaveLength(2);
  });
  it('invalidates focus without globally closing, then uses only one reserve', () => {
    const { engine, at } = measuring(); const first = perform(engine, at, true, true);
    expect(first.evidence).toMatchObject({ valid: false, invalidReason: 'tab_hidden' });
    expect(engine.finished).toBe(false);
    const second = perform(engine, first.next, false);
    expect(second.evidence.attemptAtLength).toBe(1);
    const third = perform(engine, second.next, false);
    expect(third.evidence).toMatchObject({ sequenceIndex: 2, isReplacement: true, attemptAtLength: 2 });
    expect(engine.snapshot().reason).toBe('all_trials_incorrect_at_length');
  });
  it('records early and extra taps without silently changing original scoring', () => {
    const { engine, at } = measuring(), active = engine.beginTrial(at);
    engine.tap(3, at + 10, 'touch');
    engine.presentationStarted(active.token, at + 900);
    const open = at + 2700; engine.openResponse(active.token, open);
    active.trial.sequence.forEach((drum, i) => engine.tap(drum, open + 500 * (i + 1), 'touch'));
    engine.tap(0, open + 1100, 'touch');
    const result = engine.closeTrial(active.token, open + 1250, false)!;
    expect(result.evidence.earlyTaps).toHaveLength(1); expect(result.evidence.responses).toHaveLength(3);
    expect(result.score.outcome).toBe('correct');
  });
  it('ignores an old closing callback after a new trial starts', () => {
    const { engine, at } = measuring(), first = perform(engine, at, true);
    const second = engine.beginTrial(first.next); engine.presentationStarted(second.token, first.next + 900);
    engine.openResponse(second.token, first.next + 2700);
    expect(engine.closeTrial(first.token, first.next + 3000, false)).toBeNull();
    expect(engine.snapshot().active?.trial).toBe(2);
  });
  it('preserves interruption during presentation and rejects resuming that engine', () => {
    const { engine, at } = measuring(), active = engine.beginTrial(at);
    engine.presentationStarted(active.token, at + 900); engine.interrupt('interrupted', at + 1000);
    expect(engine.snapshot().events[0]).toMatchObject({ responseOpenedAtMs: null, responses: [], valid: false, closureReason: 'interruption' });
    expect(() => engine.beginTrial(at + 2000)).toThrow('INVALID_TRIAL_START');
    expect(engine.tap(0, at + 2100, 'mouse')).toBeNull();
  });
  it('invalidates a trial starting under an existing focus loss and isolates snapshots', () => {
    const { engine, at } = measuring(); engine.focus(false, true);
    const active = engine.beginTrial(at); active.trial.sequence[0] = 99;
    const snap = engine.snapshot(); snap.active!.responses.push({ drum: 3, atMs: at, pointerType: null });
    expect(engine.snapshot().active).toMatchObject({ valid: false, invalidReason: 'focus_lost', sequence: [1, 2], responses: [] });
  });
  it('cancels all pending waits when destroyed and never shortens stimulus timers', async () => {
    vi.useFakeTimers(); const clock = new Clock(); let complete = false;
    const wait = clock.wait(900).then(() => { complete = true; });
    await vi.advanceTimersByTimeAsync(899); expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await wait; expect(complete).toBe(true);
    const pending = clock.wait(8000); const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    clock.destroy(); await rejection;
    expect(vi.getTimerCount()).toBe(0);
    await expect(clock.wait(1)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
