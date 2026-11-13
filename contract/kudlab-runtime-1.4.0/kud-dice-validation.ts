import { z } from 'zod';
import fixedProfile from './kud-dice-profile.json' with { type: 'json' };
// Remaining comparisons only concern ordered integer sequences, not evidence hashes.
const hash = (value: readonly number[] | undefined) => JSON.stringify(value);
import { buildSequences, CONFIG, scoreTrial } from './kud-dice-sequence.js';

export const BUILD_ID = 'tg07-kud-dice-1';
export const CONTRACT_VERSION = '2.0';
const time = z.number().finite().nonnegative();
const drum = z.number().int().min(0).max(3);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const uuidV4 = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const configSchema = z.strictObject({
  profile: z.literal('TG07_KUD_DICE_V1'), seed: z.literal(20263), startLength: z.literal(2), maxLength: z.literal(7),
  trialsPerLength: z.literal(2), reservePerLength: z.literal(1), stimOnMs: z.literal(600), stimOffMs: z.literal(300),
  preSequenceMs: z.literal(900), responseTimeoutMs: z.literal(8000), minRtForStats: z.literal(3),
  practice: z.strictObject({ length: z.literal(2), maxRounds: z.literal(2) }), sequenceHash: digest,
}).superRefine((config, ctx) => {
  if (config.sequenceHash !== fixedProfile.config.sequenceHash) ctx.addIssue({ code: 'custom', message: 'Unrecognized drum sequences' });
});
export function profile() { return configSchema.parse({ profile: 'TG07_KUD_DICE_V1', ...CONFIG, sequenceHash: fixedProfile.config.sequenceHash }); }
export type Config = z.infer<typeof configSchema>;
const tap = z.strictObject({ drum, atMs: time, pointerType: z.enum(['mouse', 'touch', 'pen']).nullable() });
export const trialSchema = z.strictObject({
  trial: z.number().int().min(1).max(18), length: z.number().int().min(2).max(7),
  sequence: z.array(drum).min(2).max(7), sequenceIndex: z.number().int().min(0).max(2),
  attemptAtLength: z.number().int().min(1).max(2), isReplacement: z.boolean(),
  startedAtMs: time, presentationStartMs: time.nullable(), responseOpenedAtMs: time.nullable(), closedAtMs: time,
  responses: z.array(tap).max(1000), earlyTaps: z.array(tap).max(1000),
  valid: z.boolean(), invalidReason: z.enum(['tab_hidden', 'focus_lost', 'interrupted', 'storage_failure', 'evidence_limit']).nullable(),
  closureReason: z.enum(['response', 'timeout', 'interruption']),
}).superRefine((trial, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent drum trial' });
  if (trial.length !== trial.sequence.length || trial.closedAtMs < trial.startedAtMs || trial.valid !== (trial.invalidReason === null)) fail();
  // Original timestamps round to tenths; allow only that rounding at timer boundaries.
  if (trial.presentationStartMs !== null && (trial.presentationStartMs < trial.startedAtMs + CONFIG.preSequenceMs - 0.2 || trial.presentationStartMs > trial.closedAtMs)) fail();
  if (trial.responseOpenedAtMs !== null && (trial.presentationStartMs === null ||
    trial.responseOpenedAtMs < trial.presentationStartMs + trial.length * (CONFIG.stimOnMs + CONFIG.stimOffMs) - 0.2 || trial.responseOpenedAtMs > trial.closedAtMs)) fail();
  if (trial.closureReason !== 'interruption' && trial.responseOpenedAtMs === null) fail();
  if (trial.closureReason === 'interruption' && trial.valid) fail();
  trial.responses.forEach((tap, index) => {
    if (trial.responseOpenedAtMs === null || tap.atMs < trial.responseOpenedAtMs || tap.atMs > trial.closedAtMs || index > 0 && tap.atMs < trial.responses[index - 1]!.atMs) fail();
  });
  trial.earlyTaps.forEach((tap, index) => {
    if (tap.atMs < trial.startedAtMs || tap.atMs > (trial.responseOpenedAtMs ?? trial.closedAtMs) || index > 0 && tap.atMs < trial.earlyTaps[index - 1]!.atMs) fail();
  });
  if (trial.closureReason === 'response' && (trial.responses.length < trial.length ||
    trial.closedAtMs < (trial.responses[trial.length - 1]?.atMs ?? trial.closedAtMs) + 250 - 0.2)) fail();
  // Extra taps in the original 250ms closing window are retained, not silently truncated.
  // The original leaves the last inactivity timer armed during the 250ms closing window.
  const lastArmedAt = trial.responses[Math.min(trial.responses.length, trial.length - 1) - 1]?.atMs ?? trial.responseOpenedAtMs;
  if (trial.closureReason === 'timeout' &&
    trial.closedAtMs - (lastArmedAt ?? trial.closedAtMs) < CONFIG.responseTimeoutMs - 0.2) fail();
});
export type Trial = z.infer<typeof trialSchema>;
export const incidentSchema = z.strictObject({ sequence: z.number().int().positive(),
  type: z.enum(['tab_hidden', 'tab_visible', 'loss_of_focus', 'focus_regained', 'script_error', 'resource_load_error',
    'audio_play_failed', 'small_stage', 'transition_skipped', 'transition_back_skipped', 'network_lost', 'network_restored',
    'storage_failure', 'recovered_after_reload', 'evidence_limit']),
  phase: z.enum(['loading', 'intro', 'transition', 'practice', 'test', 'done']),
  clockId: uuid.nullable(), atMs: time.nullable(), recordedAtClient: z.iso.datetime().nullable(),
  durationMs: time.nullable(), detail: z.string().max(300).nullable(),
});
export const preparationSchema = z.strictObject({
  instruction: z.strictObject({ shownAtMs: time.nullable(), acceptedAtMs: time.nullable(), repeats: z.number().int().min(0).max(1000) }),
  demoShown: z.boolean(), practiceCompleted: z.boolean(),
  practice: z.array(z.strictObject({ round: z.number().int().min(1).max(2), evidence: trialSchema })).max(2),
});
const reference = { sessionId: uuid, taskId: z.literal('TG-07'), publishedVersionId: uuid,
  configVersion: z.number().int().positive(), configurationHash: digest, gameBuildId: z.literal(BUILD_ID), contractVersion: z.literal(CONTRACT_VERSION) };
export const contextSchema = z.strictObject({ ...reference, config: configSchema,
  executionStatus: z.enum(['READY', 'RUNNING', 'COMPLETED', 'INTERRUPTED', 'EXPIRED', 'UNCONFIRMED']),
  attemptNumber: z.number().int().min(1).max(10).nullable(), startAllowedUntil: z.iso.datetime(), uploadAllowedUntil: z.iso.datetime().nullable(),
  serverTime: z.iso.datetime(), capabilities: z.strictObject({ canStart: z.boolean(), canSubmit: z.boolean(), canReadReceipt: z.boolean() }),
}).superRefine((context, ctx) => {
  if (context.configurationHash !== fixedProfile.configurationHash || context.capabilities.canStart && context.attemptNumber !== null ||
    context.capabilities.canSubmit && (context.attemptNumber === null || context.uploadAllowedUntil === null))
    ctx.addIssue({ code: 'custom', message: 'Incoherent drum context' });
});
export const envelopeSchema = z.strictObject({ ...reference, submissionId: uuidV4, state: z.enum(['completed', 'interrupted']),
  terminationReason: z.enum(['invalid_trials', 'all_trials_incorrect_at_length', 'max_length_reached', 'user_exit', 'recovered_after_reload', 'storage_failure', 'evidence_limit', 'script_error']),
  phaseReached: z.enum(['loading', 'intro', 'transition', 'practice', 'test', 'done']),
  clock: z.strictObject({ id: uuid, timeOriginUnixMs: time }),
  timing: z.strictObject({ startedAtMs: time, finishedAtMs: time, lastCheckpointAtMs: time,
    measurementStartedAtMs: time.nullable(), measurementFinishedAtMs: time.nullable() }),
  device: z.strictObject({ viewportWidth: z.number().int().positive(), viewportHeight: z.number().int().positive(),
    stageWidthCss: z.number().finite().nonnegative(), stageHeightCss: z.number().finite().nonnegative(),
    devicePixelRatio: z.number().finite().positive(), touchCapable: z.boolean(), pointerTypes: z.array(z.enum(['mouse', 'touch', 'pen'])).max(3) }),
  audio: z.strictObject({ source: z.enum(['files', 'synth', 'mixed', 'none']).nullable(), missingFiles: z.array(z.enum(['do.mp3', 're.mp3', 'mi.mp3', 'fa.mp3'])).max(4) }),
  preparation: preparationSchema, events: z.array(trialSchema).max(18), incidents: z.array(incidentSchema).max(1000),
}).superRefine((envelope, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent drum envelope' });
  const { startedAtMs: start, finishedAtMs: end, lastCheckpointAtMs: checkpoint, measurementStartedAtMs: ms, measurementFinishedAtMs: me } = envelope.timing;
  if (start > end || end !== checkpoint || envelope.configurationHash !== fixedProfile.configurationHash) fail();
  if (ms !== null && (ms < start || ms > end) || me !== null && (ms === null || me < ms || me > end)) fail();
  if (envelope.events.length && ms === null) fail();
  if (ms !== null && envelope.phaseReached !== 'test' && envelope.phaseReached !== 'done') fail();
  if (envelope.state === 'interrupted' && envelope.phaseReached === 'done') fail();
  const sequences = buildSequences();
  let length: number = CONFIG.startLength, used = 0, valid = 0, correct = 0, finished: string | null = null;
  envelope.events.forEach((event, index) => {
    if (finished || event.trial !== index + 1 || event.length !== length || event.sequenceIndex !== used ||
      hash(event.sequence) !== hash(sequences.byLength[length]?.[used] ?? []) || event.attemptAtLength !== valid + 1 || event.isReplacement !== (used >= 2)) fail();
    if (event.startedAtMs < (ms ?? start) || event.closedAtMs > (me ?? end) || index > 0 && event.startedAtMs < envelope.events[index - 1]!.closedAtMs) fail();
    if (event.closureReason === 'interruption') {
      if (envelope.state !== 'interrupted' || index !== envelope.events.length - 1) fail();
      return;
    }
    used++;
    if (event.valid) { valid++; if (scoreTrial(event.sequence, event.responses).outcome === 'correct') correct++; }
    if (valid === 2 || used === 3) {
      if (valid === 0) finished = 'invalid_trials';
      else if (correct === 0) finished = 'all_trials_incorrect_at_length';
      else if (length === 7) finished = 'max_length_reached';
      else { length++; used = 0; valid = 0; correct = 0; }
    }
  });
  const completedReasons = ['invalid_trials', 'all_trials_incorrect_at_length', 'max_length_reached'];
  if (envelope.state === 'completed') {
    if (finished !== envelope.terminationReason || me === null || envelope.phaseReached !== 'done') fail();
  } else if (completedReasons.includes(envelope.terminationReason)) fail();
  const prep = envelope.preparation, instruction = prep.instruction;
  for (const t of [instruction.shownAtMs, instruction.acceptedAtMs]) if (t !== null && (t < start || t > (ms ?? end))) fail();
  if (instruction.acceptedAtMs !== null && (instruction.shownAtMs === null || instruction.acceptedAtMs < instruction.shownAtMs)) fail();
  let practiceCorrect = false;
  prep.practice.forEach((round, index) => {
    const trial = round.evidence;
    if (!prep.demoShown || instruction.acceptedAtMs === null || round.round !== index + 1 || practiceCorrect || trial.length !== 2 || hash(trial.sequence) !== hash(sequences.practice[index + 1]) ||
      trial.startedAtMs < (instruction.acceptedAtMs ?? start) || trial.closedAtMs > (ms ?? end) || index > 0 && trial.startedAtMs < prep.practice[index - 1]!.evidence.closedAtMs) fail();
    if (trial.closureReason === 'interruption' && (ms !== null || envelope.state !== 'interrupted')) fail();
    practiceCorrect = trial.closureReason !== 'interruption' && scoreTrial(trial.sequence, trial.responses).outcome === 'correct';
  });
  if (prep.practiceCompleted !== practiceCorrect) fail();
  if (ms !== null && (!prep.demoShown || instruction.acceptedAtMs === null || !practiceCorrect && prep.practice.length !== 2)) fail();
  envelope.incidents.forEach((incident, index) => {
    if (index > 0 && incident.sequence <= envelope.incidents[index - 1]!.sequence) fail();
    if (incident.type === 'recovered_after_reload') {
      if (incident.clockId !== null || incident.atMs !== null || incident.recordedAtClient === null) fail();
    } else if (incident.clockId !== envelope.clock.id || incident.atMs === null || incident.atMs < start || incident.atMs > end) fail();
  });
  for (const [lost, regained] of [['tab_hidden', 'tab_visible'], ['loss_of_focus', 'focus_regained']] as const) {
    let since: number | null = null;
    const intervals: { start: number; end: number }[] = [];
    for (const incident of envelope.incidents.filter(row => row.atMs !== null).sort((a, b) => a.atMs! - b.atMs!)) {
      if (incident.type === lost && since === null) since = incident.atMs;
      if (incident.type === regained && since !== null) { intervals.push({ start: since, end: incident.atMs! }); since = null; }
    }
    if (since !== null) intervals.push({ start: since, end });
    for (const event of [...envelope.events, ...prep.practice.map(round => round.evidence)])
      if (event.valid && intervals.some(interval => interval.start <= event.closedAtMs && interval.end > event.startedAtMs)) fail();
  }
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > 1048576) fail();
});
export type Envelope = z.infer<typeof envelopeSchema>;
