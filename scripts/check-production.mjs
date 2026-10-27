import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const files = ['index.html', 'sw.js', '_headers', ...(await readdir('dist/assets')).map(f => `assets/${f}`)];
for (const file of files) {
  if (!/\.(js|html|css)$/.test(file)) continue;
  const text = await readFile(`dist/${file}`, 'utf8');
  for (const forbidden of ['__simulator', 'launchGrant: session.grant', '10000000-0000-4000-8000-000000000001', 'Laboratorio J-01', 'demo=true', 'TD-LLUVIA-DE-ESTRELLAS', 'skipWaiting(']) {
    assert(!text.includes(forbidden), `${file}: contenido no productivo ${forbidden}`);
  }
  assert(!/https?:\/\/(fonts\.googleapis|cdn\.jsdelivr|unpkg)\./.test(text), 'CDN productivo inesperado');
}
assert(!files.some(f => /demo|simulator|\.map$/.test(f)), 'Artefacto de desarrollo inesperado');
const sw = await readFile('dist/sw.js', 'utf8');
assert(sw.includes("FILES.includes(path)"));
assert(!sw.includes('indexedDB'));
console.log('Build verificada: sin simulador, bypass, fixtures, CDN ni operaciones IndexedDB desde SW.');
