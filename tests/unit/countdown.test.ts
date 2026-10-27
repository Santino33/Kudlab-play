import { afterEach, expect, it, vi } from 'vitest';
import { countdown } from '../../src/app/countdown';
afterEach(() => vi.useRealTimers());
it('muestra 3, 2, 1, 0 y termina exactamente a los tres segundos', async () => {
  vi.useFakeTimers(); const values: number[] = []; let finished = false;
  const pending = countdown(value => values.push(value), new AbortController().signal).then(() => { finished = true; });
  expect(values).toEqual([3]);
  await vi.advanceTimersByTimeAsync(1000); expect(values).toEqual([3, 2]);
  await vi.advanceTimersByTimeAsync(1000); expect(values).toEqual([3, 2, 1]); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); await pending;
  expect(values).toEqual([3, 2, 1, 0]); expect(finished).toBe(true);
});
it('cancelar elimina el temporizador y nunca llega a cero', async () => {
  vi.useFakeTimers(); const values: number[] = []; const abort = new AbortController();
  const pending = countdown(value => values.push(value), abort.signal);
  const rejected = expect(pending).rejects.toThrow('COUNTDOWN_CANCELLED');
  abort.abort(); await rejected; await vi.advanceTimersByTimeAsync(4000);
  expect(values).toEqual([3]); expect(vi.getTimerCount()).toBe(0);
});
