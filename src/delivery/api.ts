import { z } from 'zod';
import { contextSchema, receiptSchema, secretSchema, startResponseSchema, uuid, uuidV4, type Receipt, type SessionContext } from '../contract/schema';
import { hash } from '../contract/canonical';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterMs = 0) { super(code); }
}
export class Api {
  private base: string;
  constructor(origin: string, private transport: typeof fetch = (input, init) => fetch(input, init)) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('INVALID_API_ORIGIN');
    this.base = `${origin}/api/v1/game-runtime`;
  }
  private async call(path: string, secret: string, body?: string): Promise<unknown> {
    secretSchema.parse(secret);
    let response: Response;
    try {
      response = await this.transport(`${this.base}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(8000), ...(body === undefined ? {} : { body }) });
    } catch { throw new ApiError(0, 'NETWORK_UNCERTAIN'); }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      const error = await response.json().catch(() => null);
      const code = z.object({ code: z.string().regex(/^[A-Z_]{1,64}$/) }).safeParse(error);
      throw new ApiError(response.status, code.success ? code.data.code : 'HTTP_ERROR', Number.isFinite(wait) ? wait : 0);
    }
    let text: string;
    try { text = await response.text(); } catch { throw new ApiError(0, 'NETWORK_UNCERTAIN'); }
    if (text.length > 1048576) throw new ApiError(0, 'INVALID_RESPONSE');
    try { return JSON.parse(text); } catch { throw new ApiError(0, 'INVALID_RESPONSE'); }
  }
  private async verifiedContext(input: unknown): Promise<SessionContext> {
    const context = contextSchema.parse(input);
    if (await hash(context.config) !== context.configurationHash) throw new ApiError(409, 'CONFIGURATION_HASH_MISMATCH');
    return context;
  }
  async claim(grant: string, claimId: string, runtimeSecret: string): Promise<SessionContext> {
    uuidV4.parse(claimId); secretSchema.parse(runtimeSecret);
    return this.verifiedContext(await this.call('/launches/claim', grant, JSON.stringify({ claimId, runtimeSecret })));
  }
  async context(sessionId: string, secret: string): Promise<SessionContext> {
    uuid.parse(sessionId);
    const c = await this.verifiedContext(await this.call(`/sessions/${sessionId}`, secret));
    if (c.sessionId !== sessionId) throw new ApiError(409, 'SESSION_MISMATCH');
    return c;
  }
  async start(sessionId: string, secret: string, startId: string) {
    uuid.parse(sessionId); uuidV4.parse(startId);
    const r = startResponseSchema.parse(await this.call(`/sessions/${sessionId}/start`, secret, JSON.stringify({ startId })));
    if (r.sessionId !== sessionId) throw new ApiError(409, 'SESSION_MISMATCH');
    return r;
  }
  async submit(sessionId: string, secret: string, body: string): Promise<Receipt> {
    uuid.parse(sessionId);
    const r = receiptSchema.safeParse(await this.call(`/sessions/${sessionId}/results`, secret, body));
    if (!r.success) throw new ApiError(0, 'INVALID_RECEIPT');
    return r.data;
  }
  async receipt(sessionId: string, secret: string, submissionId: string): Promise<Receipt | null> {
    uuid.parse(sessionId); uuidV4.parse(submissionId);
    return z.strictObject({ receipt: receiptSchema.nullable() }).parse(await this.call(`/sessions/${sessionId}/receipt?submissionId=${submissionId}`, secret)).receipt;
  }
}
