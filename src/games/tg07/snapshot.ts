import type { KudDiceEnvelope } from '../../contract/kud-dice';
import type { Trial } from './engine';

export interface KudDiceSnapshot {
  taskId: 'TG-07';
  clock: KudDiceEnvelope['clock'];
  device: KudDiceEnvelope['device'];
  startedAtMs: number;
  checkpointAtMs: number;
  measurementStartedAtMs: number | null;
  measurementFinishedAtMs: number | null;
  phaseReached: KudDiceEnvelope['phaseReached'];
  audio: KudDiceEnvelope['audio'];
  preparation: Omit<KudDiceEnvelope['preparation'], 'practice'> & { practice: { round: number; evidence: Trial }[] };
  events: Trial[];
  active: Trial | null;
  incidents: KudDiceEnvelope['incidents'];
  terminationReason: KudDiceEnvelope['terminationReason'] | null;
}

// Close only evidence already present in the durable checkpoint. Never resume a trial.
export function closeSnapshot(s: KudDiceSnapshot) {
  const events = structuredClone(s.events), preparation = structuredClone(s.preparation);
  if (s.active) {
    const evidence: Trial = { ...structuredClone(s.active), closedAtMs: s.checkpointAtMs,
      valid: false, invalidReason: 'interrupted', closureReason: 'interruption' };
    if (s.measurementStartedAtMs === null) preparation.practice.push({ round: preparation.practice.length + 1, evidence });
    else events.push(evidence);
  }
  return { events, preparation };
}
