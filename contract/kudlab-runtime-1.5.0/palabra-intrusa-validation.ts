import { z } from 'zod';
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const uuidV4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
import fixedProfile from './palabra-intrusa-profile.json' with { type: 'json' };
const PROFILE = fixedProfile.config;
import { buildSequence, CONFIG, type ArrangedItem } from './palabra-intrusa-sequence.js';

export const BUILD_ID = 'tg02-palabra-intrusa-1';
export const CONTRACT_VERSION = '2.0';
const time = z.number().finite().nonnegative();
const position = z.number().int().min(0).max(3);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pointer = z.enum(['mouse', 'touch', 'pen']);
const phase = z.enum(['loading', 'intro', 'transition', 'practice', 'countdown', 'test', 'done']);
const invalidReason = z.enum(['tab_hidden', 'focus_lost', 'interruption', 'storage_failure', 'evidence_limit']);
export const configSchema = z.strictObject({
  taskId: z.literal('TG-02'), profile: z.literal('TG02_PALABRA_INTRUSA_V1'), seed: z.literal(20262),
  itemTimeoutMs: z.literal(20000), anticipatoryMs: z.literal(400), segmentCount: z.literal(3), itemsPerSegment: z.literal(6),
  itemsPerLevelPerSegment: z.literal(2), maxRun: z.literal(2), minRtOverall: z.literal(5), minRtGroup: z.literal(3),
  selectionHoldMs: z.literal(250), transitionMs: z.literal(500), practiceMaxRounds: z.literal(2),
  gameBuildId: z.literal(BUILD_ID), algorithmVersion: z.literal(PROFILE.algorithmVersion), referenceCommit: z.literal(PROFILE.referenceCommit),
  itemBankVersion: z.literal(PROFILE.itemBankVersion), validationStatus: z.literal(PROFILE.validationStatus),
  bankHash: z.literal(PROFILE.bankHash), sequenceHash: z.literal(PROFILE.sequenceHash), originalSequenceHash: z.literal(PROFILE.originalSequenceHash),
});
export function profile() { return configSchema.parse(PROFILE); }
export const trialSchema = z.strictObject({
  trial: z.number().int().min(1).max(18), itemId: z.string().min(1).max(16), category: z.string().min(1).max(100),
  level: z.number().int().min(1).max(3), segment: z.number().int().min(1).max(3).nullable(),
  words: z.array(z.string().min(1).max(100)).length(4), targetIdx: position, selectedIdx: position.nullable(),
  presentedAtMs: time, respondedAtMs: time.nullable(), closedAtMs: time, rtMs: time.nullable(),
  result: z.enum(['correct', 'incorrect', 'omission']).nullable(), valid: z.boolean(), invalidReason: invalidReason.nullable(),
  anticipatory: z.boolean(), closureReason: z.enum(['response', 'timeout', 'interruption']),
  pointerType: pointer.nullable(), responseX: z.number().finite().nullable(), responseY: z.number().finite().nullable(),
}).superRefine((t, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent word trial' });
  if (t.valid !== (t.invalidReason === null) || t.closedAtMs < t.presentedAtMs) fail();
  if (t.closureReason === 'response') {
    if (t.selectedIdx === null || t.respondedAtMs === null || t.rtMs === null || t.responseX === null || t.responseY === null ||
      t.respondedAtMs < t.presentedAtMs || t.respondedAtMs !== t.closedAtMs || Math.abs(t.rtMs - (t.respondedAtMs - t.presentedAtMs)) > 0.2 ||
      t.result !== (t.selectedIdx === t.targetIdx ? 'correct' : 'incorrect') || t.anticipatory !== (t.rtMs < CONFIG.anticipatoryMs)) fail();
  } else {
    if (t.selectedIdx !== null || t.respondedAtMs !== null || t.rtMs !== null || t.pointerType !== null || t.responseX !== null || t.responseY !== null || t.anticipatory) fail();
    if (t.result !== (t.closureReason === 'timeout' ? 'omission' : null) || t.closureReason === 'interruption' && t.valid) fail();
  }
});
export const incidentSchema = z.strictObject({ sequence: z.number().int().positive(),
  type: z.enum(['tab_hidden', 'tab_visible', 'loss_of_focus', 'focus_regained', 'script_error', 'resource_load_error',
    'small_stage', 'transition_skipped', 'transition_back_skipped', 'network_lost', 'network_restored',
    'storage_failure', 'recovered_after_reload', 'evidence_limit']),
  phase, clockId: uuid.nullable(), atMs: time.nullable(), recordedAtClient: z.iso.datetime().nullable(),
  durationMs: time.nullable(), detail: z.string().max(300).nullable(),
});
export const preparationSchema = z.strictObject({
  instruction: z.strictObject({ shownAtMs: time.nullable(), acceptedAtMs: time.nullable(), repeats: z.number().int().min(0).max(1000) }),
  practiceCompleted: z.boolean(),
  practice: z.array(z.strictObject({ round: z.number().int().min(1).max(2), items: z.array(trialSchema).min(1).max(3), errors: z.number().int().min(0).max(3) })).max(2),
});
const reference = { sessionId: uuid, taskId: z.literal('TG-02'), publishedVersionId: uuid,
  configVersion: z.number().int().positive(), configurationHash: digest, gameBuildId: z.literal(BUILD_ID), contractVersion: z.literal(CONTRACT_VERSION) };
export const contextSchema = z.strictObject({ ...reference, config: configSchema,
  executionStatus: z.enum(['READY', 'RUNNING', 'COMPLETED', 'INTERRUPTED', 'EXPIRED', 'UNCONFIRMED']),
  attemptNumber: z.number().int().min(1).max(10).nullable(), startAllowedUntil: z.iso.datetime(), uploadAllowedUntil: z.iso.datetime().nullable(),
  serverTime: z.iso.datetime(), capabilities: z.strictObject({ canStart: z.boolean(), canSubmit: z.boolean(), canReadReceipt: z.boolean() }),
}).superRefine((c, ctx) => {
  if (c.configurationHash !== fixedProfile.configurationHash || c.capabilities.canStart && (c.attemptNumber !== null || c.executionStatus !== 'READY') ||
    c.capabilities.canSubmit && (c.attemptNumber === null || c.uploadAllowedUntil === null))
    ctx.addIssue({ code: 'custom', message: 'Incoherent word context' });
});
export const envelopeSchema = z.strictObject({ ...reference, submissionId: uuidV4, state: z.enum(['completed', 'interrupted']),
  terminationReason: z.enum(['completed', 'user_exit', 'recovered_after_reload', 'storage_failure', 'evidence_limit', 'script_error', 'resource_load_error']),
  phaseReached: phase, clock: z.strictObject({ id: uuid, timeOriginUnixMs: time }),
  timing: z.strictObject({ startedAtMs: time, finishedAtMs: time, lastCheckpointAtMs: time,
    measurementStartedAtMs: time.nullable(), measurementFinishedAtMs: time.nullable(), pausedMs: time }),
  device: z.strictObject({ viewportWidth: z.number().int().positive(), viewportHeight: z.number().int().positive(),
    stageWidthCss: time, stageHeightCss: time, devicePixelRatio: z.number().finite().positive(), touchCapable: z.boolean(), pointerTypes: z.array(pointer).max(3) }),
  preparation: preparationSchema, events: z.array(trialSchema).max(18), incidents: z.array(incidentSchema).max(1000),
  pauses: z.array(z.strictObject({ startMs: time, endMs: time.nullable() })).max(1000),
  emptyResponses: z.array(z.strictObject({ atMs: time, pointerType: pointer.nullable(), x: z.number().finite(), y: z.number().finite(),
    region: z.enum(['locked', 'outside_cards']), segment: z.number().int().min(1).max(3) })).max(1000),
}).superRefine((e, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent word envelope' });
  const { startedAtMs: start, finishedAtMs: end, lastCheckpointAtMs: checkpoint, measurementStartedAtMs: ms, measurementFinishedAtMs: me } = e.timing;
  if (start > end || end !== checkpoint || e.configurationHash !== fixedProfile.configurationHash) fail();
  if (ms !== null && (ms < start || ms > end) || me !== null && (ms === null || me < ms || me > end)) fail();
  if (e.events.length && ms === null || ms !== null && !['test', 'done'].includes(e.phaseReached)) fail();
  if ((ms === null) !== (me === null)) fail();
  if (e.state === 'completed' && me !== e.events.at(-1)?.closedAtMs) fail();
  if (e.state === 'interrupted' && e.events.length === 18 && e.events.at(-1)?.closureReason !== 'interruption') fail();
  if (e.state === 'completed' ? e.events.length !== 18 || me === null || e.phaseReached !== 'done' || e.terminationReason !== 'completed' :
    e.phaseReached === 'done' || e.terminationReason === 'completed') fail();
  const seq = buildSequence();
  const practice = e.preparation.practice;
  const all = [...practice.flatMap(r => r.items), ...e.events];
  const instruction = e.preparation.instruction;
  for (const at of [instruction.shownAtMs, instruction.acceptedAtMs]) if (at !== null && (at < start || at > (ms ?? end))) fail();
  if (instruction.acceptedAtMs !== null && (instruction.shownAtMs === null || instruction.acceptedAtMs < instruction.shownAtMs)) fail();
  let correctPractice = false, previousPracticeEnd = instruction.acceptedAtMs ?? start;
  const sameItem = (t: z.infer<typeof trialSchema>, item: ArrangedItem) =>
    t.itemId === item.item.id && t.category === item.item.category && t.level === item.item.level &&
    t.targetIdx === item.targetIdx && JSON.stringify(t.words) === JSON.stringify(item.words);
  practice.forEach((r, i) => {
    if (r.round !== i + 1 || correctPractice || instruction.acceptedAtMs === null || i > 0 && practice[i - 1]!.items.length !== 3) fail();
    const errors = r.items.filter(t => t.closureReason !== 'interruption' && t.result !== 'correct').length;
    if (r.errors !== errors) fail();
    r.items.forEach((t, j) => {
      if (t.trial !== j + 1 || t.segment !== null || !sameItem(t, seq.practice[j]!) || t.presentedAtMs < previousPracticeEnd || t.closedAtMs > (ms ?? end)) fail();
      previousPracticeEnd = t.closedAtMs + (t.result === 'correct' ? 2400 : 3400) + CONFIG.transitionMs;
      if (t.closureReason === 'interruption' && (ms !== null || e.state !== 'interrupted' || i !== practice.length - 1 || j !== r.items.length - 1)) fail();
    });
    correctPractice = r.items.length === 3 && r.items.every(t => t.result === 'correct');
    if (i < practice.length - 1) previousPracticeEnd += 1900;
  });
  if (e.preparation.practiceCompleted !== correctPractice) fail();
  if (ms !== null && ((!correctPractice && (practice.length !== 2 || practice[1]!.items.length !== 3)) || instruction.acceptedAtMs === null || ms < previousPracticeEnd + 4200 - 0.2)) fail();
  let previousEnd = ms ?? start;
  e.events.forEach((t, i) => {
    if (t.trial !== i + 1 || !sameItem(t, seq.seq[i]!) || t.segment !== seq.seq[i]!.plannedSegment || t.presentedAtMs < previousEnd - 0.2 || t.closedAtMs > (me ?? end)) fail();
    if (t.closureReason === 'interruption' && (e.state !== 'interrupted' || i !== e.events.length - 1)) fail();
    previousEnd = t.closedAtMs + (t.closureReason === 'response' ? CONFIG.selectionHoldMs : 0) + CONFIG.transitionMs;
  });
  // Intervals come from evidence, and must match visibility incidents exactly.
  const intervals = (lost: string, regained: string) => {
    let since: number | null = null;
    const result: { startMs: number; endMs: number | null }[] = [];
    for (const i of e.incidents) {
      if (i.type === lost) { if (since !== null || i.atMs === null) fail(); else since = i.atMs; }
      if (i.type === regained) { if (since === null || i.atMs === null) fail(); else { result.push({ startMs: since, endMs: i.atMs }); since = null; } }
    }
    if (since !== null) result.push({ startMs: since, endMs: null });
    return result;
  };
  let lastIncident = start;
  e.incidents.forEach((i, index) => {
    if (i.sequence !== index + 1) fail();
    if (i.type === 'recovered_after_reload') {
      if (i.clockId !== null || i.atMs !== null || i.recordedAtClient === null || e.state !== 'interrupted') fail();
    } else {
      if (i.clockId !== e.clock.id || i.atMs === null || i.atMs < lastIncident || i.atMs > end || i.recordedAtClient !== null) fail();
      if (i.atMs !== null) lastIncident = i.atMs;
    }
  });
  const hidden = intervals('tab_hidden', 'tab_visible'), blur = intervals('loss_of_focus', 'focus_regained');
  if (JSON.stringify(hidden) !== JSON.stringify(e.pauses)) fail();
  const paused = (from: number, to: number) => hidden.reduce((sum, p) => sum + Math.max(0, Math.min(to, p.endMs ?? end) - Math.max(from, p.startMs)), 0);
  if (Math.abs(e.timing.pausedMs - (ms === null ? 0 : paused(ms, me ?? end))) > 0.2) fail();
  for (const t of all) {
    if (['interruption', 'storage_failure', 'evidence_limit'].includes(t.invalidReason ?? '') && t.closureReason !== 'interruption') fail();
    if (t.closureReason === 'interruption' && (t.closedAtMs !== end ||
      t.invalidReason !== (['storage_failure', 'evidence_limit'].includes(e.terminationReason) ? e.terminationReason : 'interruption'))) fail();
    const overlaps = (rows: typeof hidden) => rows.some(p => p.startMs < t.closedAtMs && (p.endMs ?? end) > t.presentedAtMs);
    if (t.valid && (overlaps(hidden) || overlaps(blur))) fail();
    if (t.invalidReason === 'tab_hidden' && !overlaps(hidden) || t.invalidReason === 'focus_lost' && !overlaps(blur)) fail();
    if (t.closureReason === 'timeout' && t.closedAtMs - t.presentedAtMs - paused(t.presentedAtMs, t.closedAtMs) < CONFIG.itemTimeoutMs - 0.2) fail();
  }
  for (const extra of e.emptyResponses) {
    if (ms === null || extra.atMs < ms || extra.atMs > (me ?? end)) fail();
    const item = [...e.events].reverse().find(t => t.presentedAtMs <= extra.atMs);
    if (item && extra.segment !== item.segment || extra.region === 'locked' && item && extra.atMs < item.closedAtMs) fail();
  }
  if (new TextEncoder().encode(JSON.stringify(e)).length > 1048576) fail();
});
export type Envelope = z.infer<typeof envelopeSchema>;
