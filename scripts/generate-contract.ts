import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { legacyConfigSchema, legacyContextSchema, legacyEnvelopeSchema, viewportConfigSchema, viewportContextSchema, viewportEnvelopeSchema, receiptSchema } from '../src/contract/schema';
import { canonical, hash } from '../src/contract/canonical';
import { contextFixture, envelopeFixture, viewportContextFixture, viewportEnvelopeFixture } from '../tests/fixtures/context';
for (const version of ['1.0', '1.1'] as const) {
const legacy = version === '1.0';
const dir = legacy ? 'contract/v1' : 'contract/v1.1';
await mkdir(dir, { recursive: true });
const files: Record<string, string> = {};
for (const [name, schema] of Object.entries({ config: legacy ? legacyConfigSchema : viewportConfigSchema,
  context: legacy ? legacyContextSchema : viewportContextSchema, envelope: legacy ? legacyEnvelopeSchema : viewportEnvelopeSchema, receipt: receiptSchema })) {
  files[`${name}.schema.json`] = JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n';
}
const context = legacy ? contextFixture() : viewportContextFixture(); context.configurationHash = await hash(context.config);
const envelope = legacy ? envelopeFixture() : viewportEnvelopeFixture(); envelope.configurationHash = context.configurationHash;
files['context.synthetic.json'] = JSON.stringify(context, null, 2) + '\n';
files['envelope.synthetic.json'] = JSON.stringify(envelope, null, 2) + '\n';
// eslint-disable-next-line no-loss-of-precision -- RFC 8785 intentionally exercises IEEE-754 rounding.
const vectors = await Promise.all([{}, { b: 2, a: 1 }, { numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27] }].map(async value => ({ value, canonical: canonical(value), sha256: await hash(value) })));
files['canonical-vectors.json'] = JSON.stringify(vectors, null, 2) + '\n';
const manifest: Record<string, string> = {};
for (const [name, body] of Object.entries(files)) {
  await writeFile(`${dir}/${name}`, body);
  const bytes = new TextEncoder().encode(body);
  manifest[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
await writeFile(`${dir}/manifest.json`, JSON.stringify({ contractVersion: version, canonicalization: 'RFC8785', digest: 'SHA-256', files: manifest }, null, 2) + '\n');
}
console.log('Artefactos 1.0 histórico y 1.1 adaptable generados. Coherencia adicional: src/contract/schema.ts.');
