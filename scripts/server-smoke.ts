/**
 * Smoke test for the standalone server (server/main.ts).
 *
 *   npm run smoke:server                       # boots dist-server/server.js locally
 *   npm run smoke:server -- --url https://...  # checks a deployed instance
 *
 * Needs `npm run build && npm run build:server` first when run locally.
 * Asserts that signed-out writes are refused as well as the happy path: a write that
 * gets through here would be a write anyone on the internet can make.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const urlFlag = process.argv.indexOf('--url');
const remote = urlFlag !== -1 ? process.argv[urlFlag + 1] : undefined;
const PORT = 18_080 + Math.floor(Math.random() * 1000);
const base = remote?.replace(/\/$/, '') ?? `http://127.0.0.1:${PORT}`;

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw request, so paths like `/%2e%2e/` reach the server un-normalized. */
function request(method: string, path: string, body?: string): Promise<Res> {
  const url = new URL(base);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host: url.hostname, port: url.port, method, path, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

async function waitForHealthy(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      if ((await request('GET', '/healthz')).status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

async function run(): Promise<void> {
  const health = await request('GET', '/healthz');
  check('GET /healthz → 200', health.status === 200, `got ${health.status}`);

  const root = await request('GET', '/');
  check('GET / → SPA html', root.status === 200 && root.body.includes('<div id="root">'), `got ${root.status}`);
  check('index.html is revalidated', root.headers['cache-control'] === 'no-cache', String(root.headers['cache-control']));

  const deep = await request('GET', '/some-band');
  check('GET /some-band → SPA fallback', deep.status === 200 && deep.body === root.body, `got ${deep.status}`);

  // Band routes can contain a dot (Zenzi's is `zenzi.music`) — still a route.
  const dotted = await request('GET', '/zenzi.music');
  check('GET /zenzi.music → SPA fallback', dotted.status === 200 && dotted.body === root.body, `got ${dotted.status}`);

  const asset = root.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check('index.html references a JS asset', !!asset);
  if (asset) {
    const js = await request('GET', asset);
    check(`GET ${asset} → 200 JS`, js.status === 200 && /javascript/.test(String(js.headers['content-type'])), `got ${js.status}`);
    check('assets are immutable', /immutable/.test(String(js.headers['cache-control'])), String(js.headers['cache-control']));
  }

  const missing = await request('GET', '/assets/does-not-exist.js');
  check('missing asset → 404, not index.html', missing.status === 404, `got ${missing.status}`);

  const traversal = await request('GET', '/%2e%2e/package.json');
  check('path traversal refused', traversal.status === 404 && !traversal.body.includes('"name"'), `got ${traversal.status}`);

  // Signed out, every write — and the storage read — is refused before it
  // touches anything (Phase 6: routes declare access, the router enforces it).
  const writes: [string, string, string?][] = [
    ['GET', '/api/bands/smoke/storage'],
    ['POST', '/api/bands/smoke/songs/smoke/config', '{}'],
    ['POST', '/api/bands/smoke/songs/smoke/lyrics', '{}'],
    ['POST', '/api/bands/smoke/setlists/smoke', '{}'],
    ['POST', '/api/r2/presign', '{}'],
    ['PUT', '/api/bands/smoke', '{}'],
    ['DELETE', '/api/bands/smoke'],
    ['DELETE', '/api/bands/smoke/songs/smoke'],
  ];
  for (const [method, path, body] of writes) {
    const res = await request(method, path, body);
    check(`signed out: ${method} ${path} → 401`, res.status === 401, `got ${res.status} ${res.body}`);
  }
  const retired = await request('POST', '/api/registry/rebuild');
  check('retired registry/rebuild → 404', retired.status === 404, `got ${retired.status}`);

  // Phase 4: the JSON documents, from Postgres. Public by design.
  const registry = await request('GET', '/api/data/registry.json');
  const bands = registry.status === 200 ? (JSON.parse(registry.body) as { bands?: unknown[] }).bands : undefined;
  check('GET /api/data/registry.json → bands', Array.isArray(bands) && bands.length > 0, `got ${registry.status} ${registry.body.slice(0, 120)}`);
  check('data is revalidated, with an ETag', registry.headers['cache-control'] === 'no-cache' && !!registry.headers.etag);
  if (registry.headers.etag) {
    const again = await new Promise<number>((resolve, reject) => {
      const url = new URL(base);
      (url.protocol === 'https:' ? https : http).get(
        { host: url.hostname, port: url.port, path: '/api/data/registry.json', headers: { 'If-None-Match': registry.headers.etag! } },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); },
      ).on('error', reject);
    });
    check('unchanged data → 304', again === 304, `got ${again}`);
  }
  const noBand = await request('GET', '/api/data/no-such-band/band.json');
  check('unknown document → 404', noBand.status === 404, `got ${noBand.status}`);
  const notDoc = await request('GET', '/api/data/registry.txt');
  check('non-JSON key → 404', notDoc.status === 404, `got ${notDoc.status}`);
  const writeData = await request('PUT', '/api/data/registry.json', '{}');
  check('PUT /api/data → refused', writeData.status === 403 || writeData.status === 404, `got ${writeData.status}`);

  // Phase 5: accounts. Signed out, /api/me answers; member routes ask for sign-in.
  const me = await request('GET', '/api/me');
  check('GET /api/me signed out → user null', me.status === 200 && JSON.parse(me.body).user === null, `got ${me.status} ${me.body.slice(0, 80)}`);
  const roster = await request('GET', '/api/bands/dev/members');
  check('member routes need sign-in → 401', roster.status === 401, `got ${roster.status}`);
  const badInvite = await request('GET', '/api/invites/not-a-real-token');
  check('unknown invite → 404', badInvite.status === 404, `got ${badInvite.status}`);
  const invitePage = await request('GET', '/invite/anything');
  check('GET /invite/<token> → SPA', invitePage.status === 200 && invitePage.body === root.body, `got ${invitePage.status}`);

  const unknown = await request('GET', '/api/nope');
  check('unknown /api route → 404 JSON', unknown.status === 404 && /json/.test(String(unknown.headers['content-type'])), `got ${unknown.status}`);
}

async function main(): Promise<void> {
  let child: ChildProcess | undefined;
  if (!remote) {
    // .env supplies DATABASE_URL and R2_PUBLIC_URL for the /api/data checks.
    child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist-server/server.js'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await waitForHealthy(child);
  }
  try {
    await run();
  } finally {
    child?.kill('SIGTERM');
  }
  console.log(failures ? `\n${failures} check(s) failed against ${base}` : `\nAll checks passed against ${base}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
