// Timers are cancellable on unmount; focus never pauses this game's clock.
export class Clock {
  private controller = new AbortController();
  now() { return Math.round(performance.now() * 10) / 10; }
  wait(ms: number): Promise<void> {
    const signal = this.controller.signal;
    if (signal.aborted) return Promise.reject(new DOMException('Game destroyed', 'AbortError'));
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Game destroyed', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  destroy() { this.controller.abort(); }
}
