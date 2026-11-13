import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/games/tg02/engine';
import { buildSequence, originalSequenceHash } from '../../src/games/tg02/sequence';
import { Clock } from '../../src/games/tg02/clock';

const pointer = (atMs: number) => ({ atMs, pointerType: 'mouse' as const, x: 400, y: 300 });
function practice(engine: Engine, wrong = false) {
  engine.startPractice(0);
  for (let i = 0; i < (wrong ? 6 : 3); i++) {
    const at = engine.nextPresentationAt;
    const trial = engine.presented(at);
    engine.tap(wrong ? (trial.targetIdx + 1) % 4 : trial.targetIdx, pointer(at + 500));
  }
  const start = engine.nextPresentationAt + 4200;
  engine.startMeasurement(start);
  return start;
}

describe('TG02 standalone engine — CA-05/06/07/08/10', () => {
  it('uses a paused timeout clock; repeated hidden events do not reset it', () => {
    const clock = new Clock();
    expect(clock.active(100)).toBe(100);
    clock.visibility(true, 200); clock.visibility(true, 300);
    expect(clock.active(1000)).toBe(200);
    clock.visibility(false, 1200);
    expect(clock.active(1300)).toBe(300);
    expect(clock.pauses).toEqual([{ startMs: 200, endMs: 1200 }]);
    expect(() => clock.active(1200)).toThrow('INVALID_TG02_CLOCK');
  });

  it('runs 3 practice items, repeats at most once and waits original pretest/countdown', () => {
    const engine = new Engine();
    expect(() => engine.startMeasurement(0)).toThrow();
    const start = practice(engine, true);
    expect(engine.snapshot(start)).toMatchObject({ practiceCompleted: false, events: [] });
    expect(engine.snapshot(start).practice.map(round => [round.items.length, round.errors])).toEqual([[3, 3], [3, 3]]);
    const trial = engine.presented(start);
    expect(trial.itemId).toBe(buildSequence().seq[0]!.item.id);
    expect(() => engine.startPractice(start)).toThrow();
  });

  it('locks the first selection, records extras separately and enforces 250+500ms', () => {
    const engine = new Engine(), start = practice(engine);
    const trial = engine.presented(start);
    expect(engine.tap(trial.targetIdx, pointer(start + 400))).toBe(true);
    expect(engine.tap((trial.targetIdx + 1) % 4, pointer(start + 450))).toBe(false);
    engine.tap(null, pointer(start + 460));
    expect(() => engine.presented(start + 1149)).toThrow();
    engine.presented(start + 1150);
    const snapshot = engine.snapshot(start + 1150);
    expect(snapshot.events[0]).toMatchObject({ result: 'correct', selectedIdx: trial.targetIdx, rtMs: 400, anticipatory: false });
    expect(snapshot.emptyResponses.map(tap => tap.region)).toEqual(['locked', 'outside_cards']);
    expect(snapshot.practiceCompleted).toBe(true);
    snapshot.events[0]!.words[0] = 'mutated caller';
    expect(engine.snapshot(start + 1150).events[0]!.words[0]).not.toBe('mutated caller');
  });

  it('hidden invalidates only the active item, pauses timeout, and preserves wall-clock response latency', () => {
    const engine = new Engine(), start = practice(engine);
    const trial = engine.presented(start);
    engine.focus(true, false, start + 100);
    engine.tick(start + 30000);
    expect(engine.snapshot(start + 30000).active?.closureReason).toBeNull();
    engine.focus(false, false, start + 30100);
    engine.tap(trial.targetIdx, pointer(start + 30500));
    expect(engine.snapshot(start + 30500).events[0]).toMatchObject({ valid: false, invalidReason: 'tab_hidden', rtMs: 30500 });
    engine.focus(false, true, start + 30600); // Already answered: no retroactive change.
    expect(engine.snapshot(start + 30600).events[0]!.invalidReason).toBe('tab_hidden');
    engine.focus(false, false, start + 30700);
    engine.presented(engine.nextPresentationAt);
    expect(engine.snapshot(engine.nextPresentationAt).active?.trial).toBe(2);
  });

  it('blur does not pause; a valid timeout is omission, not an error', () => {
    const engine = new Engine(), start = practice(engine);
    engine.presented(start); engine.focus(false, true, start + 100);
    engine.tick(start + 20000);
    expect(engine.snapshot(start + 20000).events[0]).toMatchObject({ result: 'omission', valid: false, invalidReason: 'focus_lost', rtMs: null });
    engine.focus(false, false, start + 20100);
    const next = engine.nextPresentationAt;
    engine.presented(next); engine.tick(next + 20000);
    expect(engine.snapshot(next + 20000).events[1]).toMatchObject({ result: 'omission', valid: true, selectedIdx: null });
    expect(engine.nextPresentationAt).toBe(next + 20500);
  });

  it('closes interrupted practice/measurement as partial without re-entry or fabricated omissions', () => {
    const early = new Engine(); early.interrupt('interruption', 0);
    expect(early.snapshot(0)).toMatchObject({ events: [], state: 'interrupted', measurementStartedAtMs: null });
    const engine = new Engine(), start = practice(engine);
    engine.presented(start); engine.interrupt('interruption', start + 1000);
    expect(engine.snapshot(start + 1000).events).toHaveLength(1);
    expect(engine.snapshot(start + 1000).events[0]).toMatchObject({ result: null, valid: false, closureReason: 'interruption' });
    expect(() => engine.presented(start + 1001)).toThrow();
  });

  it('completes exactly 18 items and preserves completed evidence through closing animation/exit', () => {
    const engine = new Engine(); practice(engine);
    let end = 0;
    for (let i = 0; i < 18; i++) {
      const at = engine.nextPresentationAt, trial = engine.presented(at);
      end = at + 500; engine.tap(trial.targetIdx, pointer(end));
    }
    const before = engine.snapshot(end);
    engine.interrupt('interruption', end + 2000); engine.focus(true, true, end + 3000);
    expect(engine.snapshot(end + 4000)).toEqual(before);
    expect(before.state).toBe('completed'); expect(before.events).toHaveLength(18);
    expect(before.events.map(row => row.itemId)).toEqual(buildSequence().seq.map(row => row.item.id));
    expect(originalSequenceHash(buildSequence().seq)).toMatch(/^[0-9a-f]+$/);
  });
});
