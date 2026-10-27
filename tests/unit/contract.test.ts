import { describe, expect, it } from 'vitest';
import { configSchema, contextSchema, envelopeSchema, receiptSchema, PROFILE, BUILD_ID } from '../../src/contract/schema';
import { canonical, hash } from '../../src/contract/canonical';
import { contextFixture, envelopeFixture } from '../fixtures/context';

describe('contrato 1.0 estricto', () => {
  it('acepta el perfil exacto, no sliders ni una duración oculta de 20 s', () => {
    expect(configSchema.parse(PROFILE).durationMs).toBe(120000);
    expect(configSchema.safeParse({ ...PROFILE, durationMs: 20000 }).success).toBe(false);
    expect(configSchema.safeParse({ ...PROFILE, difficulty: 2 }).success).toBe(false);
  });
  it('valida contexto mínimo sin datos personales ni builds desconocidos', () => {
    expect(contextSchema.parse(contextFixture()).gameBuildId).toBe(BUILD_ID);
    expect(contextSchema.safeParse({ ...contextFixture(), studentId: crypto.randomUUID() }).success).toBe(false);
    expect(contextSchema.safeParse({ ...contextFixture(), gameBuildId: 'unknown' }).success).toBe(false);
  });
  it('acepta precisión fraccionaria y rechaza resultado incoherente', () => {
    const e = envelopeFixture();
    expect(envelopeSchema.parse(e).events[0].respondedAtMs).toBe(1900.25);
    e.events[0].result = 'miss';
    expect(envelopeSchema.safeParse(e).success).toBe(false);
  });
  it('rechaza segmento falso, tiempos fuera del reloj y campos desconocidos', () => {
    const e = envelopeFixture();
    e.events[0].segment = 2;
    expect(envelopeSchema.safeParse(e).success).toBe(false);
    e.events[0].segment = 1;
    e.timing.finishedAtMs = 100;
    expect(envelopeSchema.safeParse(e).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...envelopeFixture(), name: 'no' }).success).toBe(false);
  });
  it('exige acuse estable y estricto', () => {
    expect(receiptSchema.safeParse({ ok: true }).success).toBe(false);
  });
  it('no impone UUID v4 a identificadores emitidos por servidor; submission sí exige v4', () => {
    const c = contextFixture(); c.sessionId = '10000000-0000-7000-8000-000000000001';
    expect(contextSchema.safeParse(c).success).toBe(true);
    const e = envelopeFixture(); e.submissionId = c.sessionId;
    expect(envelopeSchema.safeParse(e).success).toBe(false);
  });
  it('canonicaliza RFC 8785 y calcula SHA-256 sin redondear marcas', async () => {
    expect(canonical({ z: 1e30, a: [1.25, null], b: -0 })).toBe('{"a":[1.25,null],"b":0,"z":1e+30}');
    expect(await hash({ b: 2, a: 1 })).toBe(await hash({ a: 1, b: 2 }));
    expect(await hash({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });
});
