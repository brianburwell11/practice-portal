/**
 * Phase 6's guard against drift: every route declares who may call it, and
 * the declarations make sense. Offline — no database, no server.
 *
 *   npx tsx scripts/verify-access.ts
 *
 * Fails when a route is added without `access`, names a capability that
 * doesn't exist, checks a capability without a band in its path, or makes a
 * write public. Also pins how a song config save maps what changed to the
 * capabilities it needs.
 */
import { CAPABILITIES, type Capability } from '../server/db/capabilities';
import { configSaveCapabilities, isCapabilityAccess } from '../server/core/access';
import { routes } from '../server/core/routes';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

/** Writes allowed without signing in. Sign-out has to work for anyone holding a cookie. */
const PUBLIC_WRITES = new Set(['auth.logout']);

console.log(`--- route table (${routes.length} routes)`);
for (const r of routes) {
  const access = (r as { access?: unknown }).access;
  if (access === undefined) {
    check(`${r.name} declares access`, false, 'no access — the router would refuse it, and it must be declared');
    continue;
  }
  if (isCapabilityAccess(r.access)) {
    check(`${r.name}: ${r.access} is a real capability`, r.access in CAPABILITIES);
    check(`${r.name}: has a band in its path to check ${r.access} against`, r.pattern.source.includes('(?<bandId>'));
  }
  if (r.method !== 'GET') {
    check(`${r.name}: declares what it writes`, !!r.writes, 'non-GET route without `writes`');
  }
  if (r.method === 'GET') {
    check(`${r.name}: a GET writes nothing`, !r.writes);
  }
  if (r.method !== 'GET' && r.access === 'public') {
    check(`${r.name}: public write is allowlisted`, PUBLIC_WRITES.has(r.name));
  }
}
const names = routes.map((r) => r.name);
check('route names are unique', new Set(names).size === names.length);
const signedInOnly = routes.filter((r) => r.access === 'signedIn' && !r.authorizePath && !r.authorizeBody).map((r) => r.name);
check('signedIn-only routes are the expected few (their handlers check the rest)',
  JSON.stringify(signedInOnly.sort()) === JSON.stringify(['invite.accept', 'member.remove']), signedInOnly.join(', '));

console.log('\n--- what a song config save needs');
const base = {
  id: 's1', title: 'T', artist: 'A', key: 'C', durationSeconds: 10, beatOffset: 0,
  stems: [{ id: 's' }], tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: {}, markers: [], tapMap: [{ time: 1, type: 'measure' }],
};
const caps = (after: Record<string, unknown>, before: Record<string, unknown> | null = base) =>
  configSaveCapabilities(before, after).sort().join(',');
const same = (a: string, b: Capability[]) => a === [...b].sort().join(',');

check('new song → song.create only', same(caps(base, null), ['song.create']));
check('unchanged save → song.content.write', same(caps({ ...base }), ['song.content.write']));
check('title change → content', same(caps({ ...base, title: 'New' }), ['song.content.write']));
check('tapMap change → timing', same(caps({ ...base, tapMap: [{ time: 2, type: 'measure' }] }), ['song.timing.write']));
check('tempoMap change → timing', same(caps({ ...base, tempoMap: [{ beat: 0, bpm: 99 }] }), ['song.timing.write']));
check('markers change → timing', same(caps({ ...base, markers: [{ name: 'A', beat: 0, color: '#f00' }] }), ['song.timing.write']));
check('stems change (mixer defaults) → audio', same(caps({ ...base, stems: [{ id: 's', defaultVolume: 0.5 }] }), ['song.audio.write']));
check('score change → score', same(caps({ ...base, sheetMusicUrl: 'a.mxl' }), ['song.score.write']));
check('videos added → content', same(caps({ ...base, videos: [{ id: 'v' }] }), ['song.content.write']));
check('title + tapMap → content and timing', same(caps({ ...base, title: 'X', tapMap: [] }), ['song.content.write', 'song.timing.write']));
check('key order alone is not a change', same(caps(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(base).reverse())))), ['song.content.write']));
check('removing a field counts', same(caps(Object.fromEntries(Object.entries(base).filter(([k]) => k !== 'tapMap'))), ['song.timing.write']));

console.log(`\n===== ${failures} failure(s) =====`);
process.exit(failures ? 1 : 0);
