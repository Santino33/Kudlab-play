import { type Config, type LegacyConfig, type Incident, type TerminationReason, type Trial, PROFILE, isViewportConfig } from '../../contract/schema';
import { viewportGeometry } from '../../contract/layout';
import type { DraftTrial, Snapshot } from '../../evidence/journal';

export function segmentAt(elapsed: number): 1 | 2 | 3 | null {
  return elapsed < 0 || elapsed >= 120000 ? null : elapsed < 40000 ? 1 : elapsed < 80000 ? 2 : 3;
}
export function stageLayout(width: number, height: number, config: Config = PROFILE) {
  if (isViewportConfig(config)) {
    const { scale, supported } = viewportGeometry(width, height);
    return { scale, width, height, supported };
  }
  const scale = Math.min(width / 960, height / 600, 1.5);
  return { scale, width: 960 * scale, height: 600 * scale, supported: scale >= PROFILE.minimumStageScale };
}
export type ResolvedConfig = Omit<LegacyConfig, 'logicalWidth' | 'logicalHeight' | 'lanes'> & { logicalWidth: number; logicalHeight: number; lanes: number };
export function resolveConfig(config: Config, width: number, height: number): ResolvedConfig {
  if (!isViewportConfig(config)) return structuredClone(config);
  const { logicalWidth, logicalHeight, lanes } = viewportGeometry(width, height);
  return { ...config, logicalWidth, logicalHeight, lanes };
}
export class Engine {
  private events: DraftTrial[] = [];
  private incidents: Incident[] = [];
  private reason: TerminationReason | null = null;
  private nextSpawn: number;
  private checkpoint: number;
  revision = 0;
  at: number;
  constructor(readonly config: ResolvedConfig, readonly meta: Pick<Snapshot, 'clock' | 'device' | 'startedAtMs'>, private rng: () => number = Math.random) {
    this.at = this.checkpoint = this.nextSpawn = meta.startedAtMs;
  }
  get running() { return this.reason === null; }
  y(t: DraftTrial, at = this.at): number {
    return -t.geometry.size / 2 + (at - t.spawnedAtMs) * this.config.fallSpeedUnitsPerSecond / 1000;
  }
  private random(min: number, max: number) { return min + Math.max(0, Math.min(0.999999999, this.rng())) * (max - min); }
  private spawn(): void {
    if (this.events.length >= 1000) { this.finish('evidence_limit', this.at); return; }
    const size = this.random(this.config.stimulusSizeUnits.min, this.config.stimulusSizeUnits.max);
    for (let attempt = 0; attempt < this.config.positionAttempts; attempt++) {
      const lane = Math.floor(this.random(1, this.config.lanes + 1));
      const x = (lane - 0.5) * this.config.logicalWidth / this.config.lanes;
      if (this.events.some(t => t.closedAtMs === null && Math.hypot(t.geometry.x - x, this.y(t) + size / 2) < this.config.minimumDistanceUnits)) continue;
      this.events.push({ trial: this.events.length + 1, stimulus: this.rng() < this.config.starProbability ? 'star' : 'moon', spawnedAtMs: this.at,
        presentedAtMs: null, respondedAtMs: null, closedAtMs: null, result: null, segment: null,
        closureReason: null, responseWindowCompleted: false, responseDevice: null, geometry: { lane, x, size } });
      this.revision++;
      return;
    }
  }
  frame(at: number): void {
    if (!this.running || at < this.at) return;
    if (at - this.at > this.config.maxFrameGapMs) { this.finish('frame_gap', this.at); return; }
    if (at >= this.meta.startedAtMs + this.config.durationMs) { this.finish('time_limit', this.meta.startedAtMs + this.config.durationMs); return; }
    this.at = at;
    if (at >= this.nextSpawn) {
      this.spawn();
      this.nextSpawn = at + this.random(this.config.spawnIntervalMs.min, this.config.spawnIntervalMs.max);
    }
    for (const t of this.events) {
      if (t.closedAtMs !== null) continue;
      const y = this.y(t);
      if (y + t.geometry.size / 2 > this.config.logicalHeight) {
        t.closedAtMs = at;
        t.result = t.presentedAtMs === null ? 'not_evaluated' : t.stimulus === 'star' ? 'miss' : 'correct_rejection';
        t.closureReason = t.presentedAtMs === null ? 'never_presented' : 'window_elapsed';
        t.responseWindowCompleted = t.presentedAtMs !== null;
        this.revision++;
      } else if (t.presentedAtMs === null && y - t.geometry.size / 2 >= 0) {
        t.presentedAtMs = at; t.segment = segmentAt(at - this.meta.startedAtMs); this.revision++;
      }
    }
    this.checkpoint = Math.max(this.checkpoint, at);
  }
  pointer(x: number, y: number, at: number, device: NonNullable<Trial['responseDevice']>, primary: boolean): boolean {
    if (!primary || !this.running || at < this.at) return false;
    if (at - this.at > this.config.maxFrameGapMs) { this.finish('frame_gap', this.at); return false; }
    if (at >= this.meta.startedAtMs + this.config.durationMs) { this.finish('time_limit', this.meta.startedAtMs + this.config.durationMs); return false; }
    // Last drawn order is also hit-test order. Only fully visible, rendered stimuli are eligible.
    const t = [...this.events].reverse().find(t => t.closedAtMs === null && t.presentedAtMs !== null &&
      this.y(t) + t.geometry.size / 2 <= this.config.logicalHeight && Math.abs(x - t.geometry.x) <= t.geometry.size / 2 &&
      Math.abs(y - this.y(t)) <= t.geometry.size / 2);
    if (!t) return false;
    t.respondedAtMs = t.closedAtMs = at;
    t.result = t.stimulus === 'star' ? 'hit' : 'false_alarm';
    t.closureReason = 'response'; t.responseDevice = device;
    this.checkpoint = Math.max(this.checkpoint, at);
    this.revision++;
    return true;
  }
  incident(type: Incident['type'], category: Incident['category'], at = this.at): void {
    if (!this.running) return;
    if (at - this.at > this.config.maxFrameGapMs) { this.finish('frame_gap', this.at); return; }
    if (at >= this.meta.startedAtMs + this.config.durationMs) { this.finish('time_limit', this.meta.startedAtMs + this.config.durationMs); return; }
    if (this.incidents.length >= 999) { this.finish('evidence_limit', this.at); return; }
    this.incidents.push({ sequence: this.incidents.length + 1, type, category, clockId: this.meta.clock.id,
      atMs: Math.max(this.checkpoint, at), endedAtMs: null, recordedAtClient: null });
    this.checkpoint = Math.max(this.checkpoint, at); this.revision++;
  }
  finish(reason: TerminationReason, at: number): void {
    if (!this.running) return;
    const end = Math.max(this.checkpoint, Math.min(at, this.meta.startedAtMs + 120000));
    if (reason !== 'time_limit' && reason !== 'user_exit') {
      this.incidents.push({ sequence: this.incidents.length + 1, type: reason, clockId: this.meta.clock.id,
        atMs: end, endedAtMs: null, recordedAtClient: null, category: 'EXECUTION_INTERRUPTED' });
    }
    this.reason = reason; this.at = this.checkpoint = end;
    for (const t of this.events) if (t.closedAtMs === null) {
      t.closedAtMs = end; t.result = 'not_evaluated'; t.responseWindowCompleted = false;
      t.closureReason = t.presentedAtMs === null ? 'never_presented' : reason === 'time_limit' ? 'session_cutoff' : 'interruption';
    }
    this.revision++;
  }
  snapshot(): Snapshot {
    return structuredClone({ ...this.meta, checkpointAtMs: this.checkpoint,
      events: this.events, incidents: this.incidents, terminationReason: this.reason });
  }
  visible(): DraftTrial[] { return this.events.filter(t => t.closedAtMs === null); }
}
