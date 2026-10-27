import type { Plugin } from 'vite';
import { z } from 'zod';
import { viewportContextFixture } from '../fixtures/context';
import { envelopeSchema, secretSchema, uuidV4, type Receipt, type SessionContext } from '../../src/contract/schema';
import { hash, newSecret } from '../../src/contract/canonical';

type SimSession = { grant: string; context: SessionContext; claimId?: string; runtimeSecret?: string; startId?: string; receipt?: Receipt; evidenceHash?: string; body?: string };
export function simulator(): Plugin {
  const sessions = new Map<string, SimSession>();
  let mode = 'normal';
  return { name: 'synthetic-contract-simulator', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = req.url?.split('?')[0] ?? '';
      if (path === '/demo.html' || path === '/laboratorio.html') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Simulador J-01 · Datos sintéticos</title><body><main id="host"></main><script type="module" src="/tests/simulator/host.ts"></script></body></html>'); return;
      }
      if (!path.startsWith('/api/v1/game-runtime/') && !path.startsWith('/__simulator/')) { next(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      const reply = (status: number, data: unknown) => { res.statusCode = status; res.end(JSON.stringify(data)); };
      // Flush a partial response so Chromium cannot transparently replay an untouched socket request.
      const loseResponse = () => { res.setHeader('Content-Length', '1000'); res.flushHeaders(); res.write('{', () => res.destroy()); };
      const error = (status: number, code: string) => reply(status, { code, message: 'Respuesta sintética del contrato' });
      try {
        let raw = '';
        for await (const chunk of req) { raw += String(chunk); if (raw.length > 1048576) { error(413, 'PAYLOAD_TOO_LARGE'); return; } }
        const body = raw ? JSON.parse(raw) : null;
        if (path === '/__simulator/mode') { mode = z.enum(['normal', 'lost_ack', 'lost_claim', 'lost_start', '401', '403', '409', '429', '503', 'delay', 'network']).parse(body.mode); reply(200, { ok: true }); return; }
        if (path === '/__simulator/launch') {
          const context = viewportContextFixture();
          context.sessionId = crypto.randomUUID(); context.configurationHash = await hash(context.config);
          context.serverTime = new Date().toISOString(); context.startAllowedUntil = new Date(Date.now() + 900000).toISOString();
          const session = { grant: newSecret(), context };
          sessions.set(context.sessionId, session); reply(200, { launchGrant: session.grant }); return;
        }
        const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (path.endsWith('/launches/claim')) {
          const parsed = z.strictObject({ claimId: uuidV4, runtimeSecret: secretSchema }).parse(body);
          const s = [...sessions.values()].find(s => s.grant === bearer);
          if (!s) { error(401, 'RUNTIME_UNAUTHENTICATED'); return; }
          if (s.claimId && (s.claimId !== parsed.claimId || s.runtimeSecret !== parsed.runtimeSecret)) { error(409, 'CLAIM_CONFLICT'); return; }
          s.claimId = parsed.claimId; s.runtimeSecret = parsed.runtimeSecret;
          if (mode === 'lost_claim') { mode = 'normal'; loseResponse(); return; }
          reply(200, s.context); return;
        }
        const id = path.split('/sessions/')[1]?.split('/')[0]; const s = id ? sessions.get(id) : undefined;
        if (!s || s.runtimeSecret !== bearer) { error(401, 'RUNTIME_UNAUTHENTICATED'); return; }
        if (path.endsWith('/start')) {
          const parsed = z.strictObject({ startId: uuidV4 }).parse(body);
          if (s.receipt) { error(409, 'SESSION_NOT_STARTABLE'); return; }
          if (s.startId && s.startId !== parsed.startId) { error(409, 'SESSION_ALREADY_STARTED'); return; }
          s.startId = parsed.startId;
          s.context = { ...s.context, attemptNumber: 1, executionStatus: 'RUNNING', uploadAllowedUntil: new Date(Date.now() + 7 * 86400000).toISOString(), capabilities: { canStart: false, canSubmit: true, canReadReceipt: true } };
          if (mode === 'lost_start') { mode = 'normal'; loseResponse(); return; }
          reply(200, { sessionId: id, attemptNumber: 1, executionStatus: 'RUNNING', startedAtServer: s.context.serverTime, uploadAllowedUntil: s.context.uploadAllowedUntil }); return;
        }
        if (path.endsWith('/results')) {
          if (!s.startId) { error(409, 'SESSION_NOT_STARTED'); return; }
          if (mode === 'network') { req.socket.destroy(); return; }
          if (mode === 'delay') await new Promise(resolve => setTimeout(resolve, 1000));
          if (/^\d+$/.test(mode)) { if (mode === '429') res.setHeader('Retry-After', '2'); error(Number(mode), mode === '429' ? 'RATE_LIMITED' : mode === '401' ? 'RUNTIME_UNAUTHENTICATED' : mode === '403' ? 'PARTICIPATION_BLOCKED' : mode === '409' ? 'RESULT_CONFLICT' : 'UNAVAILABLE'); return; }
          const envelope = envelopeSchema.parse(body);
          if (envelope.sessionId !== id || envelope.configurationHash !== s.context.configurationHash || envelope.publishedVersionId !== s.context.publishedVersionId || envelope.configVersion !== s.context.configVersion || envelope.gameBuildId !== s.context.gameBuildId) { error(409, 'RESULT_CONFLICT'); return; }
          const digest = await hash(envelope);
          if (s.receipt && (s.receipt.submissionId !== envelope.submissionId || s.evidenceHash !== digest)) { error(409, 'RESULT_CONFLICT'); return; }
          const first = !s.receipt;
          if (!s.receipt) {
            s.receipt = { receiptId: crypto.randomUUID(), sessionId: id!, submissionId: envelope.submissionId,
              receivedAt: new Date().toISOString(), evidenceHash: digest, processingStatusAtReceipt: 'PENDING' };
            s.evidenceHash = digest; s.body = raw; s.context.executionStatus = envelope.state.toUpperCase();
          }
          if (mode === 'lost_ack') { mode = 'normal'; loseResponse(); return; }
          reply(first ? 201 : 200, s.receipt); return;
        }
        if (path.endsWith('/receipt')) { reply(200, { receipt: s.receipt ?? null }); return; }
        if (path === `/api/v1/game-runtime/sessions/${id}`) { reply(200, s.context); return; }
        error(404, 'NOT_FOUND');
      } catch { error(400, 'INVALID_INPUT'); }
    });
  } };
}
