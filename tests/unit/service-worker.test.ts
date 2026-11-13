import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

// Exercise the actual generated handler without requiring a pre-existing dist build.
const dir = await mkdtemp(join(tmpdir(), 'play-sw-build-'));
for (const name of ['dist/assets', 'node_modules/@fontsource/nunito', 'node_modules/zod', 'node_modules/canonicalize']) {
  await mkdir(join(dir, name), { recursive: true });
}
const contents = new Map([
  ['dist/index.html', '<html>synthetic</html>'], ['dist/favicon.svg', '<svg/>'], ['dist/assets/test.js', '/* synthetic */'],
  ['node_modules/@fontsource/nunito/LICENSE', 'nunito'], ['node_modules/zod/LICENSE', 'zod'], ['node_modules/canonicalize/LICENSE', 'canonicalize'],
]);
for (const [file, text] of contents) await writeFile(join(dir, file), text);
execFileSync(process.execPath, [resolve('scripts/build-sw.mjs')], { cwd: dir });
const source = await readFile(join(dir, 'dist/sw.js'), 'utf8');
afterAll(() => rm(dir, { recursive: true, force: true }));

type FetchRequest = Pick<Request, 'url' | 'method' | 'mode'>;
type FetchEvent = { request: FetchRequest; respondWith: (response: Promise<Response>) => void };
function handler(open: () => Promise<{ match: (path: string) => Promise<Response | undefined> }>, fetch = vi.fn(async () => new Response('network'))) {
  const listeners: Record<string, (event: FetchEvent) => void> = {};
  runInNewContext(source, {
    self: { location: { origin: 'https://play.example' }, addEventListener: (type: string, listener: (event: FetchEvent) => void) => { listeners[type] = listener; } },
    caches: { open }, URL, fetch,
  });
  return {
    fetch,
    dispatch(request: FetchRequest = { url: 'https://play.example/', method: 'GET', mode: 'navigate' }) {
      const respondWith = vi.fn<(response: Promise<Response>) => void>();
      listeners.fetch({ request, respondWith });
      return { respondWith, response: respondWith.mock.calls[0]?.[0] };
    },
  };
}

describe('generated static worker', () => {
  it('CA-01/02: changes cache policy even with identical static bytes', () => {
    const digest = createHash('sha256');
    for (const file of ['dist/index.html', 'dist/favicon.svg', 'node_modules/@fontsource/nunito/LICENSE', 'node_modules/zod/LICENSE', 'node_modules/canonicalize/LICENSE', 'dist/assets/test.js']) digest.update(contents.get(file)!);
    const oldVersion = digest.digest('hex').slice(0, 20);
    expect(source).toContain(`const CACHE = 'tg01-static-v2-${oldVersion}'`);
    expect(source).not.toContain(`const CACHE = 'tg01-static-${oldVersion}'`);
    expect(source).not.toMatch(/indexedDB|caches\.delete|skipWaiting\(/);
  });

  it.each(['/', '/index.html', '/pendientes', '/?bridgeId=synthetic'])('CA-01: %s reads the canonical shell without network', async path => {
    const cached = new Response('cached');
    const match = vi.fn(async () => cached);
    const sw = handler(async () => ({ match }));
    expect(await sw.dispatch({ url: `https://play.example${path}`, method: 'GET', mode: 'navigate' }).response).toBe(cached);
    expect(match).toHaveBeenCalledWith('/');
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it.each(['open', 'match', 'miss'])('CA-01: %s failure/miss falls back exactly once using original request', async failure => {
    const sw = handler(async () => {
      if (failure === 'open') throw new Error('synthetic cache failure');
      return { match: async () => { if (failure === 'match') throw new Error('synthetic cache failure'); return undefined; } };
    });
    const request = { url: 'https://play.example/pendientes?synthetic=1', method: 'GET', mode: 'navigate' as const };
    expect(await (await sw.dispatch(request).response)!.text()).toBe('network');
    expect(sw.fetch).toHaveBeenCalledExactlyOnceWith(request, { credentials: 'omit', cache: 'no-store' });
  });

  it('CA-01: does not hide total cache/network failure or retry network', async () => {
    const network = vi.fn(async (): Promise<Response> => { throw new Error('synthetic offline'); });
    const sw = handler(async () => { throw new Error('synthetic cache failure'); }, network);
    await expect(sw.dispatch().response).rejects.toThrow('synthetic offline');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    { url: 'https://play.example/api/v1/game-runtime/probe', method: 'GET', mode: 'cors' },
    { url: 'https://play.example/', method: 'POST', mode: 'navigate' },
    { url: 'https://api.example/', method: 'GET', mode: 'cors' },
    { url: 'https://play.example/assets/test.js?token=synthetic', method: 'GET', mode: 'cors' },
    { url: 'https://play.example/unknown', method: 'GET', mode: 'navigate' },
  ] as FetchRequest[])('CA-03: does not intercept $method $url', request => {
    const open = vi.fn(async () => ({ match: async () => undefined }));
    const sw = handler(open);
    expect(sw.dispatch(request).respondWith).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(sw.fetch).not.toHaveBeenCalled();
  });
});
