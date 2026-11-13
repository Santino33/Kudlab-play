import { z } from 'zod';
import schemas from '../../contract/kudlab-runtime-1.3.0/schemas.json' with { type: 'json' };
import reference from '../../contract/kudlab-runtime-1.3.0/mentalista-profile.json' with { type: 'json' };
import type { RuntimeContext, RuntimeEnvelope } from '../../contract/kudlab-runtime-1.3.0/types';
import { canonical } from './canonical';
import { buildSequence } from '../../contract/kudlab-runtime-1.3.0/mentalista-bank';

export type MentalistaContext = Extract<RuntimeContext, { taskId: 'TG-03' }>;
export type MentalistaEnvelope = Extract<RuntimeEnvelope, { taskId: 'TG-03' }>;
export type MentalistaTrial = MentalistaEnvelope['events'][number];
export type Preparation = MentalistaEnvelope['preparation'];
export type MentalistaReason = MentalistaEnvelope['terminationReason'];
// Structural validation comes from the producer artifact; invariants are checked below and by the API.
const contextShape = schemas.RuntimeContext.anyOf.find(s => s.properties.taskId.const === 'TG-03')!;
const envelopeShape = schemas.RuntimeEnvelope.oneOf.find(s => s.properties.taskId.const === 'TG-03')!;
const contextBase = z.fromJSONSchema(contextShape as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<MentalistaContext>;
const envelopeBase = z.fromJSONSchema(envelopeShape as unknown as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<MentalistaEnvelope>;
export const mentalistaContextSchema = contextBase.superRefine((c, ctx) => {
  if (canonical(c.config) !== canonical(reference.config) || c.configurationHash !== reference.configurationHash ||
    c.capabilities.canStart && c.attemptNumber !== null || c.capabilities.canSubmit && (c.attemptNumber === null || c.uploadAllowedUntil === null))
    ctx.addIssue({ code: 'custom', message: 'Unrecognized Mentalista context' });
});
export const mentalistaEnvelopeSchema = envelopeBase.superRefine((e, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Incoherent Mentalista evidence' });
  const { startedAtMs: start, finishedAtMs: end, lastCheckpointAtMs: checkpoint } = e.timing;
  if (e.configurationHash !== reference.configurationHash || start > end || end !== checkpoint ||
    (e.state === 'completed') !== (e.terminationReason === 'items_completed') || e.state === 'completed' && e.events.length !== 12) fail();
  const sequence = buildSequence();
  e.events.forEach((t, index) => {
    const entry = sequence[index]; if (!entry) { fail(); return; }
    if (t.trial !== index + 1 || t.itemId !== entry.item.id || t.load !== entry.item.load || t.plannedBlock !== entry.plannedBlock ||
      t.start !== entry.item.start || canonical(t.ops) !== canonical(entry.item.ops) || canonical(t.intermediates) !== canonical(entry.item.intermediates) || canonical(t.optionValues) !== canonical(entry.item.options)) fail();
    if (t.startedAtMs < start || t.closedAtMs > end || t.closedAtMs < t.startedAtMs || index > 0 && t.startedAtMs < e.events[index - 1]!.closedAtMs) fail();
    const shown = t.instructionShownAtMs;
    if (shown.length > t.load + 1 || shown.length && shown[0]! < t.startedAtMs + 1000 || shown.some((at, n) => at > t.closedAtMs || n > 0 && at < shown[n - 1]! + 3000)) fail();
    if (t.optionsShownAtMs !== null && (shown.length !== t.load + 1 || t.optionsShownAtMs < shown.at(-1)! + 3000 || t.optionsShownAtMs > t.closedAtMs)) fail();
    if (t.closureReason === 'response') {
      if (t.optionsShownAtMs === null || t.selectedIdx === null || t.selectedAtMs === null || t.responseDevice === null || t.selectedAtMs < t.optionsShownAtMs || t.selectedAtMs >= t.optionsShownAtMs + 30000 || t.selectedAtMs !== t.closedAtMs) fail();
    } else {
      if (t.selectedIdx !== null || t.selectedAtMs !== null || t.responseDevice !== null) fail();
      if (t.closureReason === 'timeout' && (t.optionsShownAtMs === null || t.closedAtMs < t.optionsShownAtMs + 30000)) fail();
      if (t.closureReason === 'interruption' && (e.state !== 'interrupted' || index !== e.events.length - 1)) fail();
    }
  });
  e.preparation.practice.forEach((round, index) => {
    if (round.round !== index + 1 || index === 1 && e.preparation.practice[0]!.items.every(t => t.result === 'correct')) fail();
    round.items.forEach((t, n) => {
      const item = reference.config.bank.practice[n]!;
      if (t.itemId !== item.id || t.result !== (t.selectedIdx === null ? 'omission' : t.selectedIdx === item.correctIdx ? 'correct' : 'incorrect') ||
        (t.rtMs === null) !== (t.selectedIdx === null) || t.rtMs !== null && t.rtMs >= 30000) fail();
    });
  });
  if (e.preparation.practice.length === 1 && e.preparation.practice[0]!.items.some(t => t.result !== 'correct')) fail();
  e.incidents.forEach((i, n) => {
    if (n > 0 && i.sequence <= e.incidents[n - 1]!.sequence) fail();
    if (i.type === 'recovered_after_reload') {
      if (i.clockId !== null || i.atMs !== null || i.endedAtMs !== null || i.recordedAtClient === null) fail();
    } else if (i.clockId !== e.clock.id || i.atMs === null || i.atMs < start || i.atMs > end || i.endedAtMs !== null && (i.endedAtMs < i.atMs || i.endedAtMs > end)) fail();
    const network = i.type === 'network_lost' || i.type === 'network_restored';
    if (network !== (i.category === 'CONTEXT_ONLY') || !network && e.state === 'completed' || !network && i.atMs !== null && e.events.some(t => t.startedAtMs > i.atMs!)) fail();
  });
  e.extraResponses.forEach((r, n) => {
    const t = e.events[r.trial - 1];
    if (!t || r.atMs < t.startedAtMs || r.atMs > end || n > 0 && r.sequence <= e.extraResponses[n - 1]!.sequence ||
      (r.device === 'keyboard' ? r.x !== null || r.y !== null : r.x === null || r.y === null)) fail();
  });
  if (e.device.stageWidthCss > e.device.viewportWidth || e.device.stageHeightCss > e.device.viewportHeight ||
    e.incidents.length + e.preparation.resourceIncidents.length > 1000 || new TextEncoder().encode(JSON.stringify(e)).length > 1048576) fail();
});
