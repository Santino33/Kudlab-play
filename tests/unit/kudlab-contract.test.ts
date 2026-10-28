import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contextSchema, envelopeSchema } from '../../src/contract/schema';
import { hash } from '../../src/contract/canonical';
import { envelopeFixture, viewportEnvelopeFixture } from '../fixtures/context';

const dir = new URL('../../contract/kudlab-runtime-1.2.0/', import.meta.url);
describe('artefacto canónico Kudlab 1.2.0 fijado en el productor', () => {
  it('verifica todos los hashes y comparte contexto real y vectores RFC 8785', async () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
    expect(manifest.version).toBe('1.2.0');
    for (const [file, digest] of Object.entries(manifest.files)) expect(createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex')).toBe(digest);
    const context = contextSchema.parse(JSON.parse(readFileSync(new URL('context-1.1.synthetic.json', dir), 'utf8')));
    expect(await hash(context.config)).toBe(context.configurationHash);
    for (const vector of JSON.parse(readFileSync(new URL('canonical-vectors.json', dir), 'utf8'))) expect(await hash(vector.value)).toBe(vector.sha256);
    expect(envelopeSchema.parse(envelopeFixture()).contractVersion).toBe('1.0');
    expect(envelopeSchema.parse(viewportEnvelopeFixture()).contractVersion).toBe('1.1');
  });
});
