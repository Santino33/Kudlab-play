import { PROFILE, BUILD_ID, VIEWPORT_PROFILE, VIEWPORT_BUILD_ID, type SessionContext, type Envelope } from '../../src/contract/schema';
import { viewportGeometry } from '../../src/contract/layout';
export const sessionId = '10000000-0000-4000-8000-000000000001';
export function contextFixture(): SessionContext {
  return { sessionId, taskId: 'TG-01', publishedVersionId: '30000000-0000-4000-8000-000000000001',
    configVersion: 1, configurationHash: 'a'.repeat(64), gameBuildId: BUILD_ID,
    contractVersion: '1.0', config: structuredClone(PROFILE), executionStatus: 'PREPARED',
    attemptNumber: null, startAllowedUntil: '2026-10-27T23:59:00.000Z', uploadAllowedUntil: null,
    serverTime: '2026-10-27T12:00:00.000Z', capabilities: { canStart: true, canSubmit: false, canReadReceipt: true } };
}
export function viewportContextFixture(): SessionContext {
  return { ...contextFixture(), contractVersion: '1.1', gameBuildId: VIEWPORT_BUILD_ID, configVersion: 2,
    publishedVersionId: '30000000-0000-4000-8000-000000000002', config: structuredClone(VIEWPORT_PROFILE) };
}
export function viewportEnvelopeFixture(): Envelope {
  const e = envelopeFixture(); const context = viewportContextFixture(); const geometry = viewportGeometry(390, 772);
  return { ...e, contractVersion: '1.1', gameBuildId: context.gameBuildId, publishedVersionId: context.publishedVersionId, configVersion: 2,
    device: { viewportWidth: 390, viewportHeight: 844, stageScale: geometry.scale, touchCapable: true, stageWidthCss: 390, stageHeightCss: 772 },
    events: e.events.map(t => ({ ...t, geometry: { ...t.geometry, x: (t.geometry.lane - .5) * geometry.logicalWidth / geometry.lanes } })) };
}
export function envelopeFixture(): Envelope {
  const c = contextFixture();
  return { contractVersion: '1.0', sessionId, submissionId: '20000000-0000-4000-8000-000000000001',
    taskId: c.taskId, publishedVersionId: c.publishedVersionId, configVersion: 1,
    configurationHash: c.configurationHash, gameBuildId: BUILD_ID, state: 'interrupted', terminationReason: 'visibility_lost',
    clock: { id: '40000000-0000-4000-8000-000000000001', timeOriginUnixMs: 1793059200000 },
    timing: { startedAtMs: 1000, finishedAtMs: 8000, lastCheckpointAtMs: 8000 },
    device: { viewportWidth: 1280, viewportHeight: 800, stageScale: 1, touchCapable: false },
    events: [{ trial: 1, stimulus: 'star', spawnedAtMs: 1100, presentedAtMs: 1500.125,
      respondedAtMs: 1900.25, closedAtMs: 1900.25, result: 'hit', segment: 1, closureReason: 'response',
      responseWindowCompleted: false, responseDevice: 'mouse', geometry: { lane: 2, x: 240, size: 90 } }],
    incidents: [{ sequence: 1, type: 'visibility_lost', clockId: '40000000-0000-4000-8000-000000000001',
      atMs: 8000, endedAtMs: null, recordedAtClient: null, category: 'EXECUTION_INTERRUPTED' }] };
}
