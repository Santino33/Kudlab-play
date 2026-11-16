import { envelopeSchema, type PalabraEnvelope } from '../../contract/palabra-intrusa';
import type { PalabraSnapshot } from './flow';
import type { Trial } from './engine';

type Reference = Pick<PalabraEnvelope, 'sessionId' | 'taskId' | 'publishedVersionId' | 'configVersion' | 'configurationHash' | 'gameBuildId' | 'contractVersion'>;
export function finalizePalabra(reference: Reference, source: PalabraSnapshot, submissionId: string, recovered = false): PalabraEnvelope {
  const s = structuredClone(source), e = s.evidence;
  const round = (n: number) => Math.round(n * 10) / 10;
  const pauses = e.pauses.map(p => ({ startMs: round(p.startMs), endMs: p.endMs === null ? null : round(p.endMs) }));
  const measurementStart = e.measurementStartedAtMs === null ? null : round(e.measurementStartedAtMs);
  const measurementEnd = measurementStart === null ? null : round(e.measurementEndedAtMs ?? s.checkpointAtMs);
  const pausedMs = measurementStart === null ? 0 : round(pauses.reduce((sum, p) => sum + Math.max(0, Math.min(measurementEnd!, p.endMs ?? s.checkpointAtMs) - Math.max(measurementStart, p.startMs)), 0));
  const completed = e.state === 'completed';
  if (!completed && e.active) {
    const closed: Trial = { ...e.active, closedAtMs: s.checkpointAtMs, valid: false, invalidReason: 'interruption', closureReason: 'interruption' };
    if (e.measurementStartedAtMs !== null) e.events.push(closed);
    else {
      let round = e.practice.at(-1);
      if (!round || round.items.length === 3) { round = { round: e.practice.length + 1, items: [], errors: 0 }; e.practice.push(round); }
      round.items.push(closed);
    }
  }
  if (recovered && !completed) s.incidents.push({ sequence: s.incidents.length + 1, type: 'recovered_after_reload', phase: s.phaseReached,
    clockId: null, atMs: null, recordedAtClient: new Date().toISOString(), durationMs: null, detail: null });
  const { sessionId, taskId, publishedVersionId, configVersion, configurationHash, gameBuildId, contractVersion } = reference;
  return envelopeSchema.parse({ sessionId, taskId, publishedVersionId, configVersion, configurationHash, gameBuildId, contractVersion, submissionId, state: completed ? 'completed' : 'interrupted',
    terminationReason: completed ? 'completed' : recovered ? 'recovered_after_reload' : s.terminationReason ?? 'user_exit',
    phaseReached: completed ? 'done' : s.phaseReached, clock: s.clock, device: s.device,
    timing: { startedAtMs: s.startedAtMs, finishedAtMs: s.checkpointAtMs, lastCheckpointAtMs: s.checkpointAtMs,
      measurementStartedAtMs: measurementStart, measurementFinishedAtMs: measurementEnd, pausedMs },
    preparation: { instruction: s.instruction, practice: e.practice, practiceCompleted: e.practiceCompleted },
    events: e.events, incidents: s.incidents, pauses, emptyResponses: e.emptyResponses });
}
