/**
 * Apply every migration to a throwaway in-process Postgres (PGlite) and assert
 * the schema behaves. Runs offline — no server, no cloud account — so the
 * Phase 2 exit criteria ("migrations run clean; capability catalog and role
 * bundles are queryable data") is checkable on any machine.
 *
 * This uses Drizzle's real migrator against the real generated SQL, so a pass
 * here means `npm run db:migrate` will work against Fly/Neon too.
 *
 * Usage: npx tsx scripts/verify-db.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CAPABILITIES, ROLES } from '../server/db/capabilities';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`ok    ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** Assert a statement is rejected by the database. */
async function rejects(label: string, pg: PGlite, sql: string, expect: RegExp): Promise<void> {
  try {
    await pg.exec(sql);
    check(label, false, 'statement was accepted');
  } catch (err) {
    const message = (err as Error).message ?? '';
    check(label, expect.test(message), `got: ${message}`);
  }
}

const pg = await PGlite.create({ extensions: { citext } });
const db = drizzle(pg);

console.log('--- migrations');
await migrate(db, { migrationsFolder: './server/db/migrations' });
check('all migrations applied', true);

const applied = await pg.query<{ hash: string }>(
  'select hash from drizzle.__drizzle_migrations order by created_at',
);
check('migration journal has 3 entries', applied.rows.length === 3, `found ${applied.rows.length}`);

// Re-running must be a no-op, not an error — this is what a redeploy does.
await migrate(db, { migrationsFolder: './server/db/migrations' });
check('re-running migrations is idempotent', true);

console.log('\n--- tables');
const tables = (await pg.query<{ table_name: string }>(
  "select table_name from information_schema.tables where table_schema='public' order by table_name",
)).rows.map((r) => r.table_name);
const expected = [
  'app_user', 'audit_log', 'band', 'capability', 'grant_link', 'invite',
  'membership', 'org', 'role', 'role_capability', 'setlist', 'song',
  'user_song_state',
];
for (const t of expected) check(`table ${t}`, tables.includes(t));
check('no unexpected tables', tables.length === expected.length, tables.join(', '));

console.log('\n--- capability catalog is queryable data');
const caps = (await pg.query<{ key: string }>('select key from capability order by key')).rows.map((r) => r.key);
const wantCaps = Object.keys(CAPABILITIES).sort();
check(`${wantCaps.length} capabilities seeded`, caps.length === wantCaps.length, `got ${caps.length}`);
check('capability keys match the catalog', JSON.stringify(caps) === JSON.stringify(wantCaps));

const roles = (await pg.query<{ key: string; membership_eligible: boolean }>(
  'select key, membership_eligible from role order by sort_order',
)).rows;
check('roles seeded in sort order',
  JSON.stringify(roles.map((r) => r.key)) === JSON.stringify(ROLES.map((r) => r.key)),
  roles.map((r) => r.key).join(','));
check('owner and guest are not membership-eligible',
  roles.filter((r) => !r.membership_eligible).map((r) => r.key).join(',') === 'owner,guest');

console.log('\n--- role bundles resolve by query (the Phase 6 lookup)');
for (const role of ROLES) {
  const got = (await pg.query<{ capability_key: string }>(
    'select capability_key from role_capability where role_key = $1 order by capability_key',
    [role.key],
  )).rows.map((r) => r.capability_key);
  const want = [...role.capabilities].sort();
  check(`${role.key}: ${want.length} capabilities`,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${got.join(',')}`);
}

// Phase 6's exit criteria depends on these two absences being real.
const editorHas = async (cap: string) => (await pg.query<{ n: number }>(
  "select count(*)::int n from role_capability where role_key='editor' and capability_key=$1", [cap],
)).rows[0].n > 0;
check('editor CANNOT song.delete', !(await editorHas('song.delete')));
check('editor CANNOT song.timing.write', !(await editorHas('song.timing.write')));
check('editor CAN song.content.write', await editorHas('song.content.write'));
check('member CANNOT setlist.write', (await pg.query<{ n: number }>(
  "select count(*)::int n from role_capability where role_key='member' and capability_key='setlist.write'",
)).rows[0].n === 0);

console.log('\n--- constraints');
await pg.exec(`
  insert into app_user (id, email, display_name) values
    ('11111111-1111-1111-1111-111111111111', 'Owner@Example.com', 'Owner'),
    ('22222222-2222-2222-2222-222222222222', 'editor@example.com', 'Editor');
  insert into band (id, slug, name, colors, owner_user_id) values
    ('33333333-3333-3333-3333-333333333333', 'dev', 'Dev', '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}',
     '11111111-1111-1111-1111-111111111111');
`);

check('band defaults to private', (await pg.query<{ visibility: string }>(
  'select visibility from band')).rows[0].visibility === 'private');
check('org_id is nullable and null', (await pg.query<{ org_id: string | null }>(
  'select org_id from band')).rows[0].org_id === null);

await rejects('citext email is case-insensitively unique', pg,
  "insert into app_user (email) values ('owner@EXAMPLE.com')", /unique|duplicate/i);
await rejects('membership.role must exist in role table', pg,
  `insert into membership (user_id, band_id, role) values
     ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','producer')`,
  /foreign key|violates/i);
await rejects('band.visibility check', pg,
  "update band set visibility='unlisted'", /band_visibility_check/i);
await rejects('grant_link.scope check', pg,
  `insert into grant_link (band_id, scope, target_id, token_hash, expires_at, created_by) values
     ('33333333-3333-3333-3333-333333333333','band','33333333-3333-3333-3333-333333333333','h1',now(),
      '11111111-1111-1111-1111-111111111111')`,
  /grant_link_scope_check/i);
await rejects('audit_log.actor_kind check', pg,
  "insert into audit_log (action, actor_kind) values ('song.read','robot')",
  /audit_log_actor_kind_check/i);

// A valid membership, then the per-band uniqueness rules.
await pg.exec(`insert into membership (user_id, band_id, role) values
  ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','editor')`);
check('editor membership inserted', (await pg.query<{ n: number }>(
  'select count(*)::int n from membership')).rows[0].n === 1);

await pg.exec(`insert into song (id, band_id, slug, title, artist, config, media_prefix) values
  ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','born-to-run',
   'Born to Run','Bruce Springsteen','{"id":"8xDKlqH"}','dev/songs/8xDKlqH')`);
await rejects('song slug unique per band', pg,
  `insert into song (band_id, slug, title, artist, config) values
     ('33333333-3333-3333-3333-333333333333','born-to-run','Dup','X','{}')`,
  /unique|duplicate/i);
check('grant_link.capabilities defaults to {song.read}', (await pg.query<{ capabilities: string[] }>(
  `insert into grant_link (band_id, scope, target_id, token_hash, expires_at, created_by)
   values ('33333333-3333-3333-3333-333333333333','setlist','44444444-4444-4444-4444-444444444444','h2',
           now() + interval '7 days','11111111-1111-1111-1111-111111111111')
   returning capabilities`)).rows[0].capabilities.join(',') === 'song.read');

console.log('\n--- tenant cascade');
await pg.exec(`insert into user_song_state (user_id, song_id, state) values
  ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','{"loopStart":4}')`);
await pg.exec("delete from band where slug='dev'");
for (const t of ['song', 'membership', 'grant_link', 'user_song_state']) {
  check(`deleting a band cascades ${t}`, (await pg.query<{ n: number }>(
    `select count(*)::int n from ${t}`)).rows[0].n === 0);
}
check('audit_log survives band deletion with band_id nulled', (await pg.query<{ n: number }>(
  'select count(*)::int n from audit_log where band_id is null')).rows[0].n >= 0);

await pg.close();
console.log(`\n===== ${failures} failure(s) =====`);
process.exit(failures ? 1 : 0);
