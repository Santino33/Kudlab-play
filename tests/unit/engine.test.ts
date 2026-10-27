import { describe, expect, it } from 'vitest';
import { Engine, segmentAt, stageLayout } from '../../src/games/tg01/engine';
import { PROFILE } from '../../src/contract/schema';
import { registry, supported } from '../../src/games/registry';
import { contextFixture } from '../fixtures/context';
import { envelopeFixture } from '../fixtures/context';
function engine(rng = () => 0) {
  const e = envelopeFixture();
  return new Engine(PROFILE, { clock: e.clock, device: e.device, startedAtMs: 1000 }, rng);
}
function advance(e: Engine, end: number) { for (let t = e.at + 10; t < end; t += 10) e.frame(t); e.frame(end); }
describe('TG-01 determinista', () => {
  it('registro solo TG-01: configuración inmutable y destrucción terminal', () => {
    const e = envelopeFixture(); const game = registry['TG-01'].create(PROFILE, { clock: e.clock, device: e.device, startedAtMs: 1000 });
    expect(Object.keys(registry)).toEqual(['TG-01']); expect(supported(contextFixture())).toBe(true);
    expect(Object.isFrozen(game.config)).toBe(true); expect(Object.isFrozen(game.config.spawnIntervalMs)).toBe(true);
    registry['TG-01'].destroy(game); expect(game.running).toBe(false); expect(game.snapshot().terminationReason).toBe('user_exit');
  });
  it('no presenta hasta caja completa y conserva milisegundos fraccionarios', () => {
    const e = engine(); e.frame(1000); advance(e, 1350);
    expect(e.snapshot().events[0].presentedAtMs).toBeNull();
    e.frame(1360.125);
    expect(e.snapshot().events[0].presentedAtMs).toBe(1360.125);
    expect(e.pointer(80, 45, 1360.5, 'touch', true)).toBe(true);
    expect(e.snapshot().events[0].respondedAtMs).toBe(1360.5);
    expect(e.pointer(80, 45, 1360.6, 'mouse', true)).toBe(false);
    expect(e.snapshot().events[0].result).toBe('hit');
  });
  it('luna respondida produce false_alarm una sola vez; rechaza pointer secundario', () => {
    const values = [0, 0, 0.99, 0]; let i = 0;
    const e = engine(() => values[i++ % values.length]); e.frame(1000); advance(e, 1400);
    const t = e.snapshot().events[0];
    expect(t.stimulus).toBe('moon');
    expect(e.pointer(t.geometry.x, e.y(t), 1400, 'pen', false)).toBe(false);
    expect(e.pointer(t.geometry.x, e.y(t), 1400.25, 'pen', true)).toBe(true);
    expect(e.snapshot().events[0].result).toBe('false_alarm');
  });
  it('ventana natural clasifica estrella/luna sin respuesta, nunca fuera de ventana', () => {
    for (const [rng, expected] of [[() => 0, 'miss'], [() => 0.99, 'correct_rejection']] as const) {
      const e = engine(rng); e.frame(1000); advance(e, 3900);
      expect(e.snapshot().events[0].result).toBe(expected);
      expect(e.snapshot().events[0].responseWindowCompleted).toBe(true);
      expect(e.pointer(80, 599, 3900, 'mouse', true)).toBe(false);
    }
  });
  it('corte preserva respuestas y no fabrica omisiones ni segmentos para no presentados', () => {
    const e = engine(); e.frame(1000); advance(e, 1400);
    e.finish('user_exit', 1400);
    expect(e.snapshot().events[0].result).toBe('not_evaluated');
    expect(e.snapshot().events[0].closureReason).toBe('interruption');
    const early = engine(); early.frame(1000); early.finish('user_exit', 1001);
    expect(early.snapshot().events[0].segment).toBeNull();
    expect(early.snapshot().events[0].closureReason).toBe('never_presented');
  });
  it('mide 120 s, con fronteras 40/80 por presentación y límite exacto', () => {
    expect([0, 39999.9, 40000, 79999.9, 80000, 119999.9].map(segmentAt)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(segmentAt(120000)).toBeNull();
    const e = engine(); e.frame(1000); advance(e, 121010);
    expect(e.snapshot().terminationReason).toBe('time_limit');
    expect(e.snapshot().checkpointAtMs).toBe(121000);
    expect(e.snapshot().events.filter(t => t.result === 'not_evaluated').length).toBeGreaterThan(0);
  });
  it('hueco de frames interrumpe en último frame válido, sin simular el tiempo ausente', () => {
    const e = engine(); e.frame(1000); e.frame(5000);
    expect(e.snapshot().terminationReason).toBe('frame_gap');
    expect(e.snapshot().checkpointAtMs).toBe(1000);
    expect(e.snapshot().events[0].result).toBe('not_evaluated');
  });
  it('escala sin estirar y bloquea menos de 576×360', () => {
    expect(stageLayout(960, 600)).toEqual({ scale: 1, width: 960, height: 600, supported: true });
    expect(stageLayout(600, 360).scale).toBe(0.6);
    expect(stageLayout(575, 360).supported).toBe(false);
    const e = engine(); e.frame(1000); advance(e, 1500);
    expect(e.snapshot().events[0].geometry).toEqual({ lane: 1, x: 80, size: 75 });
    expect(e.y(e.snapshot().events[0])).toBe(67.5);
  });
  it('generación respeta carriles, secuencia y separación mínima', () => {
    const e = engine(); e.frame(1000);
    // Force a fixed lane RNG; separation is tested at each creation.
    advance(e, 2100);
    expect(e.snapshot().events.map(t => t.trial)).toEqual([1, 2]);
    const [a, b] = e.snapshot().events;
    expect(Math.hypot(a.geometry.x - b.geometry.x, e.y(a) - e.y(b))).toBeGreaterThanOrEqual(180);
  });
  it('la ventana natural se cierra en el frame dibujado, no por física extrapolada del Pointer', () => {
    const e = engine(); e.frame(1000); advance(e, 3850);
    expect(e.snapshot().events[0].closedAtMs).toBeNull();
    expect(e.pointer(80, e.y(e.snapshot().events[0]), 3860, 'mouse', true)).toBe(true);
    const other = engine(); other.frame(1000); advance(other, 3860);
    expect(other.pointer(80, other.y(other.snapshot().events[0]), 3860, 'mouse', true)).toBe(false);
  });
  it('un timestamp RAF anterior a una respuesta no retrocede el checkpoint', () => {
    const e = engine(); e.frame(1000); advance(e, 1400);
    e.pointer(80, e.y(e.snapshot().events[0]), 1400.75, 'mouse', true);
    e.frame(1400.5);
    expect(e.snapshot().checkpointAtMs).toBe(1400.75);
  });
  it('incidencias tardías no prolongan el reloj ni dejan un terminal sin cierre', () => {
    const e = engine(); e.frame(1000); advance(e, 120990);
    e.incident('network_lost', 'CONTEXT_ONLY', 121001);
    expect(e.snapshot().terminationReason).toBe('time_limit');
    expect(e.snapshot().checkpointAtMs).toBe(121000);
    const stalled = engine(); stalled.frame(1000); stalled.incident('focus_lost', 'MEASUREMENT_AFFECTED', 5000);
    expect(stalled.snapshot().terminationReason).toBe('frame_gap');
    expect(stalled.snapshot().checkpointAtMs).toBe(1000);
  });
});
