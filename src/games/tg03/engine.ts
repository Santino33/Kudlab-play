import { buildSequence } from '../../../contract/kudlab-runtime-1.3.0/mentalista-bank';
import type { MentalistaEnvelope, MentalistaReason, MentalistaTrial, Preparation } from '../../contract/mentalista';

export interface MentalistaSnapshot {
  taskId: 'TG-03'; clock: MentalistaEnvelope['clock']; device: MentalistaEnvelope['device']; startedAtMs: number; checkpointAtMs: number;
  events: MentalistaTrial[]; incidents: MentalistaEnvelope['incidents']; preparation: Preparation;
  extraResponses: MentalistaEnvelope['extraResponses']; terminationReason: MentalistaReason | null;
}
export class MentalistaEngine {
  readonly sequence = buildSequence();
  running = true;
  revision = 0;
  at: number;
  phase: 'neutral' | 'instruction' | 'gap' | 'options' | 'locked' = 'neutral';
  instruction = 0;
  private phaseAt: number;
  private lastFrame: number;
  private data: MentalistaSnapshot;
  constructor(readonly meta: Pick<MentalistaSnapshot, 'clock' | 'device' | 'startedAtMs'>, preparation: Preparation) {
    this.at = this.phaseAt = this.lastFrame = meta.startedAtMs;
    this.data = { ...structuredClone(meta), taskId: 'TG-03', checkpointAtMs: this.at, events: [], incidents: [], preparation: structuredClone(preparation), extraResponses: [], terminationReason: null };
    this.next();
  }
  get current() { return this.data.events.at(-1)!; }
  get text() {
    if (this.phase === 'neutral' || this.phase === 'gap') return '';
    if (this.phase === 'options' || this.phase === 'locked') return '¿Qué número tienes ahora?';
    if (this.instruction === 0) return `Comienza con ${this.current.start}`;
    const op = this.current.ops[this.instruction - 1]!;
    return `${op.op === 'suma' ? 'Suma' : 'Resta'} ${op.n}`;
  }
  private next() {
    if (this.data.events.length === 12) { this.finish('items_completed', this.at); return; }
    const { item, plannedBlock } = this.sequence[this.data.events.length]!;
    this.data.events.push({ trial: this.data.events.length + 1, itemId: item.id, load: item.load, plannedBlock, start: item.start,
      ops: item.ops.map(op => ({ ...op })), intermediates: [...item.intermediates], optionValues: [...item.options], startedAtMs: this.at,
      instructionShownAtMs: [], optionsShownAtMs: null, selectedIdx: null, selectedAtMs: null, closedAtMs: this.at, responseDevice: null, closureReason: 'interruption' });
    this.phase = 'neutral'; this.phaseAt = this.at; this.instruction = 0; this.revision++;
  }
  // Called once per painted frame. Never catch up through missing presentation phases.
  frame(at: number) {
    if (!this.running) return;
    at = Math.max(at, this.at);
    if (at - this.lastFrame > 250) { this.finish('frame_gap', this.at); return; }
    this.at = this.lastFrame = at; this.current.closedAtMs = this.current.closureReason === 'interruption' ? at : this.current.closedAtMs;
    const elapsed = at - this.phaseAt;
    if (this.phase === 'neutral' && elapsed >= 1000) this.showInstruction();
    else if (this.phase === 'instruction' && elapsed >= 2500) { this.phase = 'gap'; this.phaseAt = at; this.revision++; }
    else if (this.phase === 'gap' && elapsed >= 500) {
      if (this.instruction < this.current.load) { this.instruction++; this.showInstruction(); }
      else { this.phase = 'options'; this.phaseAt = at; this.current.optionsShownAtMs = at; this.revision++; }
    } else if (this.phase === 'options' && elapsed >= 30000) {
      this.current.closedAtMs = at; this.current.closureReason = 'timeout'; this.next(); this.revision++;
    } else if (this.phase === 'locked' && elapsed >= 300) this.next();
  }
  private showInstruction() { this.phase = 'instruction'; this.phaseAt = this.at; this.current.instructionShownAtMs.push(this.at); this.revision++; }
  respond(index: number | null, at: number, device: NonNullable<MentalistaTrial['responseDevice']>, x: number | null = null, y: number | null = null) {
    if (!this.running || !Number.isFinite(at)) return;
    this.at = Math.max(this.at, at);
    if (this.at - this.lastFrame > 250) { this.finish('frame_gap', this.lastFrame); return; }
    if (this.phase === 'options' && index !== null && Number.isInteger(index) && index >= 0 && index < 4 && this.at < this.current.optionsShownAtMs! + 30000) {
      Object.assign(this.current, { selectedIdx: index, selectedAtMs: this.at, closedAtMs: this.at, responseDevice: device, closureReason: 'response' });
      this.phase = 'locked'; this.phaseAt = this.at;
    } else {
      if (this.data.extraResponses.length >= 1000) { this.finish('evidence_limit', this.at); return; }
      this.data.extraResponses.push({ sequence: this.data.extraResponses.length + 1, trial: this.current.trial, atMs: this.at,
        region: this.phase === 'options' ? 'outside_options' : 'locked', device, x: device === 'keyboard' ? null : x, y: device === 'keyboard' ? null : y });
    }
    this.revision++;
  }
  incident(type: 'network_lost' | 'network_restored', at: number) {
    if (!this.running) return;
    if (this.data.incidents.length + this.data.preparation.resourceIncidents.length >= 999) { this.finish('evidence_limit', this.at); return; }
    this.at = Math.max(this.at, at);
    this.data.incidents.push({ sequence: this.data.incidents.length + 1, type, clockId: this.meta.clock.id, atMs: this.at, endedAtMs: null, recordedAtClient: null, category: 'CONTEXT_ONLY' }); this.revision++;
  }
  finish(reason: MentalistaReason, at: number) {
    if (!this.running) return;
    if (reason === 'items_completed' && (this.data.events.length !== 12 || this.current.closureReason === 'interruption')) throw new Error('INCOMPLETE_MEASUREMENT');
    this.at = Math.max(this.at, at); this.running = false; this.data.terminationReason = reason;
    if (this.current.closureReason === 'interruption') this.current.closedAtMs = this.at;
    if (reason !== 'items_completed' && reason !== 'user_exit' && reason !== 'recovered_after_reload') this.data.incidents.push({ sequence: this.data.incidents.length + 1, type: reason,
      clockId: this.meta.clock.id, atMs: this.at, endedAtMs: null, recordedAtClient: null, category: 'EXECUTION_INTERRUPTED' });
    this.revision++;
  }
  closingIncident(reason: Preparation['resourceIncidents'][number]['reason']) {
    this.data.preparation.resourceIncidents.push({ phase: 'closing', type: 'transition_skipped', reason }); this.revision++;
  }
  snapshot(): MentalistaSnapshot { return structuredClone({ ...this.data, checkpointAtMs: this.at }); }
}
