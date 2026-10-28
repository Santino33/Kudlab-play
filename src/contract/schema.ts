import { z } from 'zod';
import { VIEWPORT_POLICY, viewportGeometry } from './layout';
import type { EvidenceReceipt, RuntimeEnvelope } from '../../contract/kudlab-runtime-1.2.0/types';

export const BUILD_ID = 'tg01-reference-rebuild-1';
export const VIEWPORT_BUILD_ID = 'tg01-viewport-rebuild-2';
export const PROFILE = Object.freeze<LegacyConfig>({
  durationMs: 120000, segmentBoundariesMs: [0, 40000, 80000, 120000],
  logicalWidth: 960, logicalHeight: 600, lanes: 6, fallSpeedUnitsPerSecond: 210,
  spawnIntervalMs: { min: 1100, max: 1800 }, starProbability: 0.7,
  stimulusSizeUnits: { min: 75, max: 105 }, minimumDistanceUnits: 180, positionAttempts: 30,
  presentationRule: 'FULLY_VISIBLE' as const, maxFrameGapMs: 250, minimumStageScale: 0.6, inputProfile: 'POINTER_V1' as const,
});
export const legacyConfigSchema = z.strictObject({
  durationMs: z.literal(120000), segmentBoundariesMs: z.tuple([z.literal(0), z.literal(40000), z.literal(80000), z.literal(120000)]),
  logicalWidth: z.literal(960), logicalHeight: z.literal(600), lanes: z.literal(6), fallSpeedUnitsPerSecond: z.literal(210),
  spawnIntervalMs: z.strictObject({ min: z.literal(1100), max: z.literal(1800) }), starProbability: z.literal(0.7),
  stimulusSizeUnits: z.strictObject({ min: z.literal(75), max: z.literal(105) }), minimumDistanceUnits: z.literal(180),
  positionAttempts: z.literal(30), presentationRule: z.literal('FULLY_VISIBLE'), maxFrameGapMs: z.literal(250),
  minimumStageScale: z.literal(0.6), inputProfile: z.literal('POINTER_V1'),
});
const sharedConfig = legacyConfigSchema.omit({ logicalWidth: true, logicalHeight: true, lanes: true }).shape;
export const viewportConfigSchema = z.strictObject({ ...sharedConfig, layoutRule: z.literal('VIEWPORT_FIT_V2'),
  referenceWidthUnits: z.literal(480), minimumLaneWidthUnits: z.literal(120), maximumLanes: z.literal(6) });
export const configSchema = z.union([legacyConfigSchema, viewportConfigSchema]);
export type LegacyConfig = z.infer<typeof legacyConfigSchema>;
export type Config = z.infer<typeof configSchema>;
export const VIEWPORT_PROFILE = Object.freeze<z.infer<typeof viewportConfigSchema>>({
  durationMs: 120000, segmentBoundariesMs: [0, 40000, 80000, 120000], fallSpeedUnitsPerSecond: 210,
  spawnIntervalMs: { min: 1100, max: 1800 }, starProbability: .7, stimulusSizeUnits: { min: 75, max: 105 },
  minimumDistanceUnits: 180, positionAttempts: 30, presentationRule: 'FULLY_VISIBLE', maxFrameGapMs: 250,
  minimumStageScale: .6, inputProfile: 'POINTER_V1', layoutRule: 'VIEWPORT_FIT_V2', ...VIEWPORT_POLICY,
});
export function isViewportConfig(config: Config): config is z.infer<typeof viewportConfigSchema> { return 'layoutRule' in config; }
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const uuidV4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const time = z.number().finite().nonnegative();
const utc = z.iso.datetime({ offset: false });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const secretSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const reference = {
  sessionId: uuid, taskId: z.literal('TG-01'), publishedVersionId: uuid,
  configVersion: z.number().int().positive(), configurationHash: digest,
  gameBuildId: z.enum([BUILD_ID, VIEWPORT_BUILD_ID]), contractVersion: z.enum(['1.0', '1.1']),
};
export const contextSchema = z.strictObject({
  ...reference, config: configSchema,
  // The draft does not enumerate server statuses; authorization uses explicit capabilities.
  executionStatus: z.string().min(1).max(64), attemptNumber: z.number().int().min(1).max(10).nullable(),
  startAllowedUntil: utc, uploadAllowedUntil: utc.nullable(), serverTime: utc,
  capabilities: z.strictObject({ canStart: z.boolean(), canSubmit: z.boolean(), canReadReceipt: z.boolean() }),
}).superRefine((c, ctx) => {
  if ((c.contractVersion === '1.1') !== isViewportConfig(c.config) || (c.contractVersion === '1.1' ? c.gameBuildId !== VIEWPORT_BUILD_ID : c.gameBuildId !== BUILD_ID)) ctx.addIssue({ code: 'custom', message: 'Profile version mismatch' });
  if (c.capabilities.canStart && c.attemptNumber !== null) ctx.addIssue({ code: 'custom', message: 'Context not startable' });
  if (c.capabilities.canSubmit && (!c.uploadAllowedUntil || c.attemptNumber === null)) ctx.addIssue({ code: 'custom', message: 'Context not submittable' });
});
export type SessionContext = z.infer<typeof contextSchema>;
export const reasonSchema = z.enum(['time_limit', 'user_exit', 'visibility_lost', 'script_error', 'storage_failure', 'frame_gap', 'layout_changed', 'recovered_after_reload', 'evidence_limit', 'resource_error']);
export type TerminationReason = z.infer<typeof reasonSchema>;
export const trialSchema = z.strictObject({
  trial: z.number().int().positive(), stimulus: z.enum(['star', 'moon']), spawnedAtMs: time,
  presentedAtMs: time.nullable(), respondedAtMs: time.nullable(), closedAtMs: time,
  result: z.enum(['hit', 'false_alarm', 'miss', 'correct_rejection', 'not_evaluated']),
  segment: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  closureReason: z.enum(['response', 'window_elapsed', 'session_cutoff', 'interruption', 'never_presented']),
  responseWindowCompleted: z.boolean(), responseDevice: z.enum(['mouse', 'touch', 'pen']).nullable(),
  geometry: z.strictObject({ lane: z.number().int().min(1).max(6), x: z.number().finite(), size: z.number().min(75).max(105) }),
}).superRefine((e, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent trial' });
  if (e.spawnedAtMs > e.closedAtMs) fail();
  if (e.presentedAtMs === null) {
    if (e.segment !== null || e.respondedAtMs !== null || e.closureReason !== 'never_presented') fail();
  } else if (e.presentedAtMs < e.spawnedAtMs || e.presentedAtMs > e.closedAtMs || e.segment === null) fail();
  if (e.respondedAtMs !== null) {
    if (e.presentedAtMs === null || e.respondedAtMs < e.presentedAtMs || e.closedAtMs !== e.respondedAtMs ||
      e.closureReason !== 'response' || e.responseDevice === null || e.result !== (e.stimulus === 'star' ? 'hit' : 'false_alarm')) fail();
  } else {
    const natural = e.closureReason === 'window_elapsed';
    if (e.responseDevice !== null || e.result !== (natural ? (e.stimulus === 'star' ? 'miss' : 'correct_rejection') : 'not_evaluated')) fail();
    if (e.closureReason === 'response') fail();
  }
  if (e.responseWindowCompleted !== (e.closureReason === 'window_elapsed')) fail();
});
export type Trial = z.infer<typeof trialSchema>;
export const incidentSchema = z.strictObject({
  sequence: z.number().int().positive(),
  type: z.enum(['focus_lost', 'visibility_lost', 'script_error', 'audio_unavailable', 'network_lost', 'network_restored', 'storage_failure', 'frame_gap', 'layout_changed', 'recovered_after_reload', 'resource_error', 'evidence_limit']),
  clockId: uuid.nullable(), atMs: time.nullable(), endedAtMs: time.nullable(), recordedAtClient: utc.nullable(),
  category: z.enum(['EXECUTION_INTERRUPTED', 'CONTEXT_ONLY', 'MEASUREMENT_AFFECTED']),
});
export type Incident = z.infer<typeof incidentSchema>;
export const legacyDeviceSchema = z.strictObject({ viewportWidth: z.number().int().positive(), viewportHeight: z.number().int().positive(), stageScale: z.number().min(0.6), touchCapable: z.boolean() });
export const viewportDeviceSchema = legacyDeviceSchema.extend({ stageWidthCss: z.number().finite().positive(), stageHeightCss: z.number().finite().positive() });
export const envelopeSchema = z.strictObject({
  ...reference, submissionId: uuidV4, state: z.enum(['completed', 'interrupted']), terminationReason: reasonSchema,
  clock: z.strictObject({ id: uuid, timeOriginUnixMs: time }),
  timing: z.strictObject({ startedAtMs: time, finishedAtMs: time, lastCheckpointAtMs: time }),
  device: z.union([legacyDeviceSchema, viewportDeviceSchema]),
  events: z.array(trialSchema).max(1000), incidents: z.array(incidentSchema).max(1000),
}).superRefine((e, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent envelope' });
  const adaptive = e.contractVersion === '1.1';
  if (adaptive !== ('stageWidthCss' in e.device) || (adaptive ? e.gameBuildId !== VIEWPORT_BUILD_ID : e.gameBuildId !== BUILD_ID)) fail();
  const geometry = 'stageWidthCss' in e.device ? viewportGeometry(e.device.stageWidthCss, e.device.stageHeightCss) : { logicalWidth: 960, lanes: 6 };
  if ('stageWidthCss' in e.device) {
    const actual = viewportGeometry(e.device.stageWidthCss, e.device.stageHeightCss);
    if (!actual.supported || Math.abs(actual.scale - e.device.stageScale) > 1e-9 || e.device.stageWidthCss > e.device.viewportWidth || e.device.stageHeightCss > e.device.viewportHeight) fail();
  }
  const { startedAtMs: start, finishedAtMs: end, lastCheckpointAtMs: checkpoint } = e.timing;
  if (start > end || end !== checkpoint || end - start > PROFILE.durationMs) fail();
  if ((e.state === 'completed') !== (e.terminationReason === 'time_limit') || (e.state === 'completed' && end - start !== 120000)) fail();
  let previous = 0;
  for (const t of e.events) {
    if (t.geometry.lane > geometry.lanes || Math.abs(t.geometry.x - (t.geometry.lane - .5) * geometry.logicalWidth / geometry.lanes) > 1e-8) fail();
    if (t.trial <= previous || t.spawnedAtMs < start || t.closedAtMs > end) fail();
    previous = t.trial;
    if (t.presentedAtMs !== null) {
      const elapsed = t.presentedAtMs - start;
      if (elapsed < 0 || elapsed >= 120000 || t.segment !== (elapsed < 40000 ? 1 : elapsed < 80000 ? 2 : 3)) fail();
    }
    if (t.closureReason === 'session_cutoff' && e.state !== 'completed') fail();
  }
  previous = 0;
  for (const i of e.incidents) {
    if (i.sequence <= previous) fail();
    previous = i.sequence;
    if (i.type === 'recovered_after_reload') {
      if (i.clockId !== null || i.atMs !== null || i.endedAtMs !== null || i.recordedAtClient === null) fail();
    } else if (i.clockId !== e.clock.id || i.atMs === null || i.atMs < start || i.atMs > end ||
      (i.endedAtMs !== null && (i.endedAtMs < i.atMs || i.endedAtMs > end))) fail();
  }
  if (new TextEncoder().encode(JSON.stringify(e)).byteLength > 1048576) fail();
});
export type Envelope = RuntimeEnvelope;
export const legacyContextSchema = contextSchema.safeExtend({ contractVersion: z.literal('1.0'), gameBuildId: z.literal(BUILD_ID), config: legacyConfigSchema });
export const viewportContextSchema = contextSchema.safeExtend({ contractVersion: z.literal('1.1'), gameBuildId: z.literal(VIEWPORT_BUILD_ID), config: viewportConfigSchema });
export const legacyEnvelopeSchema = envelopeSchema.safeExtend({ contractVersion: z.literal('1.0'), gameBuildId: z.literal(BUILD_ID), device: legacyDeviceSchema });
export const viewportEnvelopeSchema = envelopeSchema.safeExtend({ contractVersion: z.literal('1.1'), gameBuildId: z.literal(VIEWPORT_BUILD_ID), device: viewportDeviceSchema });
export const receiptSchema = z.strictObject({ receiptId: uuid, sessionId: uuid, submissionId: uuidV4, receivedAt: utc, evidenceHash: digest, processingStatusAtReceipt: z.literal('PENDING') });
export type Receipt = EvidenceReceipt;
export const startResponseSchema = z.strictObject({ sessionId: uuid, attemptNumber: z.number().int().min(1).max(10), executionStatus: z.literal('RUNNING'), startedAtServer: utc, uploadAllowedUntil: utc });
