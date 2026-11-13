export class Clock {
  private hiddenAt: number | null = null;
  private paused = 0;
  private latest = 0;
  readonly pauses: { startMs: number; endMs: number | null }[] = [];

  observe(at: number) {
    if (!Number.isFinite(at) || at < this.latest) throw new Error('INVALID_TG02_CLOCK');
    this.latest = at;
  }
  visibility(hidden: boolean, at: number) {
    this.observe(at);
    if (hidden && this.hiddenAt === null) {
      this.hiddenAt = at; this.pauses.push({ startMs: at, endMs: null });
    } else if (!hidden && this.hiddenAt !== null) {
      this.paused += at - this.hiddenAt; this.hiddenAt = null; this.pauses.at(-1)!.endMs = at;
    }
  }
  active(at: number) { this.observe(at); return at - this.pausedAt(at); }
  pausedAt(at: number) { return this.paused + (this.hiddenAt === null ? 0 : at - this.hiddenAt); }
}
