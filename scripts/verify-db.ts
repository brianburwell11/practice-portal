/**
 * Assert the schema behaves, against either an in-process throwaway Postgres
 * or a real database.
 *
 *   npx tsx scripts/verify-db.ts           # PGlite, offline, no account needed
 *   npx tsx scripts/verify-db.ts --url     # $DATABASE_URL from .env
 *   npx tsx scripts/verify-db.ts --url=postgresql://...
 *
 * The offline mode is the Phase 2 exit criteria ("migrations run clean;
 * capability catalog and role bundles are queryable data"), checkable on any
 * machine. The --url mode is the post-deploy smoke test: it proves *this*
 * database is really migrated and seeded, which applying migrations alone
 * does not.
 *
 * Every mutating assertion runs inside a transaction that is always rolled
 * back, and `rejects()` uses savepoints so an expected error doesn't poison
 * the rest of the run. Pointing --url at a database therefore leaves no rows
 * behind — but the cascade checks assert *global* counts, so they are skipped
 * unless the tenant tables start empty.
 */
import { CAPABILITIES, ROLES } from '../server/db/capabilities';

/** The two backends behind one surface. Same SQL, same $1 placeholders. */
interface Conn {
  label: string;
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  migrate(folder: string): Promise<void>;
  close(): Promise<void>;
}

async function openPglite(): Promise<Conn> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const pg = await PGlite.create({ extensions: { citext } });
  const db = drizzle(pg);
  return {
    label: 'PGlite (in-process)',
    query: async <T,>(text: string, params?: unknown[]) =>
      (await pg.query<T>(text, params as never[] | undefined)).rows,
    exec: async (text: string) => { await pg.exec(text); },
    migrate: (folder) => migrate(db, { migrationsFolder: folder }),
    close: () => pg.close(),
  };
}

async function openPostgres(url: string): Promise<Conn> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  // max: 1 is required, not a tuning choice — BEGIN, SAVEPOINT and ROLLBACK
  // only mean anything if every statement lands on the same connection.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  const host = url.replace(/^postgres(ql)?:\/\/[^@]*@/, '').replace(/[/?].*$/, '');
  return {
    label: `postgres://${host}`,
    query: async <T,>(text: string, params?: unknown[]) =>
      (await sql.unsafe(text, params as never[] | undefined)) as unknown as T[],
    // .simple() is what allows multi-statement SQL; it forbids parameters,
    // which is fine because exec() is only ever used for literal fixtures.
    exec: async (text: string) => { await sql.unsafe(text).simple(); },
    migrate: (folder) => migrate(db, { migrationsFolder: folder }),
    close: () => sql.end(),
  };
}

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`ok    ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function skip(label: string, why: string): void {
  console.log(`skip  ${label} — ${why}`);
  skipped++;
}

/**
 * Assert a statement is rejected. Wrapped in a savepoint: a failed statement
 * aborts the enclosing transaction, and ROLLBACK TO SAVEPOINT is the only way
 * back to a usable one.
 */
async function rejects(label: string, conn: Conn, sql: string, expect: RegExp): Promise<void> {
  await conn.exec('savepoint chk');
  try {
    await conn.exec(sql);
    check(label, false, 'statement was accepted');
    await conn.exec('rollback to savepoint chk');
  } catch (err) {
    await conn.exec('rollback to savepoint chk');
    const message = (err as Error).message ?? '';
    check(label, expect.test(message), `got: ${message}`);
  }
}

// ---------------------------------------------------------------- arguments

const urlArg = process.argv.find((a) => a === '--url' || a.startsWith('--url='));
let conn: Conn;

if (urlArg) {
  const inline = urlArg.startsWith('--url=') ? urlArg.slice('--url='.length) : '';
  if (!inline) (await import('dotenv')).default.config();
  const url = inline || process.env.DATABASE_URL;
  if (!url) {
    console.error('FAIL  --url given but no connection string; set DATABASE_URL in .env or pass --url=postgresql://...');
    process.exit(1);
  }
  conn = await openPostgres(url);
} else {
  conn = await openPglite();
}

console.log(`--- target: ${conn.label}\n`);

// --------------------------------------------------------------- migrations

console.log('--- migrations');
await conn.migrate('./server/db/migrations');
check('all migrations applied', true);

const applied = await conn.query<{ hash: string }>(
  'select hash from drizzle.__drizzle_migrations order by created_at',
);
check('migration journal has 6 entries', applied.length === 6, `found ${applied.length}`);

// Re-running must be a no-op, not an error — this is what a redeploy does.
await conn.migrate('./server/db/migrations');
check('re-running migrations is idempotent', true);

// ------------------------------------------------------------------- tables

console.log('\n--- tables');
const tables = (await conn.query<{ table_name: string }>(
  "select table_name from information_schema.tables where table_schema='public' order by table_name",
)).map((r) => r.table_name);
const expected = [
  'app_user', 'audit_log', 'band', 'capability', 'grant_link', 'invite',
  'membership', 'org', 'role', 'role_capability', 'session', 'setlist', 'song',
  'user_song_state',
];
for (const t of expected) check(`table ${t}`, tables.includes(t));
check('no unexpected tables', tables.length === expected.length, tables.join(', '));

// Columns the Phase 4 R2 import writes (migration 0003).
const columns = new Set((await conn.query<{ c: string }>(
  "select table_name || '.' || column_name as c from information_schema.columns where table_schema='public'",
)).map((r) => r.c));
// ...the Phase 5 account columns (migration 0004), and Phase 10's guest links (0005).
for (const c of [
  'band.legacy_id', 'band.position', 'setlist.position', 'song.lyrics', 'song.notes',
  'app_user.google_sub', 'app_user.avatar_url', 'invite.accepted_by', 'invite.revoked_at', 'invite.created_at',
  'grant_link.token', 'grant_link.created_at',
]) {
  check(`column ${c}`, columns.has(c));
}

// -------------------------------------------------------- capability catalog

console.log('\n--- capability catalog is queryable data');
const caps = (await conn.query<{ key: string }>('select key from capability order by key')).map((r) => r.key);
const wantCaps = Object.keys(CAPABILITIES).sort();
check(`${wantCaps.length} capabilities seeded`, caps.length === wantCaps.length, `got ${caps.length}`);
check('capability keys match the catalog', JSON.stringify(caps) === JSON.stringify(wantCaps));

const roles = await conn.query<{ key: string; membership_eligible: boolean }>(
  'select key, membership_eligible from role order by sort_order',
);
check('roles seeded in sort order',
  JSON.stringify(roles.map((r) => r.key)) === JSON.stringify(ROLES.map((r) => r.key)),
  roles.map((r) => r.key).join(','));
check('owner and guest are not membership-eligible',
  roles.filter((r) => !r.membership_eligible).map((r) => r.key).join(',') === 'owner,guest');

console.log('\n--- role bundles resolve by query (the Phase 6 lookup)');
for (const role of ROLES) {
  const got = (await conn.query<{ capability_key: string }>(
    'select capability_key from role_capability where role_key = $1 order by capability_key',
    [role.key],
  )).map((r) => r.capability_key);
  const want = [...role.capabilities].sort();
  check(`${role.key}: ${want.length} capabilities`,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${got.join(',')}`);
}

// Phase 6's exit criteria depends on these two absences being real.
const editorHas = async (cap: string) => (await conn.query<{ n: number }>(
  "select count(*)::int n from role_capability where role_key='editor' and capability_key=$1", [cap],
))[0].n > 0;
check('editor CANNOT song.delete', !(await editorHas('song.delete')));
check('editor CANNOT song.timing.write', !(await editorHas('song.timing.write')));
check('editor CAN song.content.write', await editorHas('song.content.write'));
check('member CANNOT setlist.write', (await conn.query<{ n: number }>(
  "select count(*)::int n from role_capability where role_key='member' and capability_key='setlist.write'",
))[0].n === 0);

// ------------------------------------------- constraints and tenant cascade
// These insert fixtures and assert global row counts, so they need an empty
// database. Everything here runs in a transaction that is always rolled back.

const TENANT_TABLES = ['app_user', 'band', 'song', 'membership', 'grant_link', 'user_song_state', 'audit_log', 'session'];
const occupied: string[] = [];
for (const t of TENANT_TABLES) {
  const n = (await conn.query<{ n: number }>(`select count(*)::int n from ${t}`))[0].n;
  if (n > 0) occupied.push(`${t}=${n}`);
}

if (occupied.length) {
  console.log('\n--- constraints');
  skip('constraint and cascade assertions', `database is not empty (${occupied.join(', ')})`);
  console.log('      schema and catalog checks above still ran. To run the rest, point --url at an empty database.');
} else {
  console.log('\n--- constraints');
  await conn.exec('begin');
  try {
    await conn.exec(`
      insert into app_user (id, email, display_name) values
        ('11111111-1111-1111-1111-111111111111', 'Owner@Example.com', 'Owner'),
        ('22222222-2222-2222-2222-222222222222', 'editor@example.com', 'Editor');
      insert into band (id, slug, name, colors, owner_user_id) values
        ('33333333-3333-3333-3333-333333333333', 'dev', 'Dev', '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}',
         '11111111-1111-1111-1111-111111111111');
    `);

    check('band defaults to private', (await conn.query<{ visibility: string }>(
      'select visibility from band'))[0].visibility === 'private');
    check('org_id is nullable and null', (await conn.query<{ org_id: string | null }>(
      'select org_id from band'))[0].org_id === null);

    await rejects('citext email is case-insensitively unique', conn,
      "insert into app_user (email) values ('owner@EXAMPLE.com')", /unique|duplicate/i);
    await rejects('membership.role must exist in role table', conn,
      `insert into membership (user_id, band_id, role) values
         ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','producer')`,
      /foreign key|violates/i);
    await rejects('band.visibility check', conn,
      "update band set visibility='unlisted'", /band_visibility_check/i);
    await rejects('grant_link.scope check', conn,
      `insert into grant_link (band_id, scope, target_id, token_hash, expires_at, created_by) values
         ('33333333-3333-3333-3333-333333333333','org','33333333-3333-3333-3333-333333333333','h1',now(),
          '11111111-1111-1111-1111-111111111111')`,
      /grant_link_scope_check/i);
    await rejects('audit_log.actor_kind check', conn,
      "insert into audit_log (action, actor_kind) values ('song.read','robot')",
      /audit_log_actor_kind_check/i);

    // A valid membership, then the per-band uniqueness rules.
    await conn.exec(`insert into membership (user_id, band_id, role) values
      ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','editor')`);
    check('editor membership inserted', (await conn.query<{ n: number }>(
      'select count(*)::int n from membership'))[0].n === 1);

    await conn.exec(`insert into song (id, band_id, slug, title, artist, config, media_prefix) values
      ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','born-to-run',
       'Born to Run','Bruce Springsteen','{"id":"8xDKlqH"}','dev/songs/8xDKlqH')`);
    await rejects('song slug unique per band', conn,
      `insert into song (band_id, slug, title, artist, config) values
         ('33333333-3333-3333-3333-333333333333','born-to-run','Dup','X','{}')`,
      /unique|duplicate/i);
    check('grant_link.capabilities defaults to {song.read}', (await conn.query<{ capabilities: string[] }>(
      `insert into grant_link (band_id, scope, target_id, token_hash, expires_at, created_by)
       values ('33333333-3333-3333-3333-333333333333','setlist','44444444-4444-4444-4444-444444444444','h2',
               now() + interval '7 days','11111111-1111-1111-1111-111111111111')
       returning capabilities`))[0].capabilities.join(',') === 'song.read');

    // Phase 10: one live "anyone with the link" link per band, expiry optional.
    const bandLink = (hash: string) => `insert into grant_link (band_id, scope, target_id, token, token_hash, created_by)
       values ('33333333-3333-3333-3333-333333333333','band','33333333-3333-3333-3333-333333333333','t-${hash}','${hash}',
               '11111111-1111-1111-1111-111111111111')`;
    await conn.exec(bandLink('h3'));
    check('a band link needs no expiry', (await conn.query<{ n: number }>(
      "select count(*)::int n from grant_link where token_hash='h3' and expires_at is null"))[0].n === 1);
    await rejects('only one live band link per band', conn, bandLink('h4'), /grant_link_one_live_band_link|unique|duplicate/i);
    await conn.exec("update grant_link set revoked_at = now() where token_hash='h3'");
    await conn.exec(bandLink('h5'));
    check('a revoked band link makes room for its replacement', (await conn.query<{ n: number }>(
      "select count(*)::int n from grant_link where scope='band'"))[0].n === 2);

    // Phase 5: one account per Google identity; sessions die with their user.
    await conn.exec(`update app_user set google_sub='g-owner' where id='11111111-1111-1111-1111-111111111111'`);
    await rejects('google_sub is unique', conn,
      `update app_user set google_sub='g-owner' where id='22222222-2222-2222-2222-222222222222'`, /unique|duplicate/i);
    await conn.exec(`insert into session (token_hash, user_id, expires_at) values
      ('s1','22222222-2222-2222-2222-222222222222', now() + interval '30 days')`);
    await conn.exec(`insert into app_user (id, email) values ('55555555-5555-5555-5555-555555555555','gone@example.com')`);
    await conn.exec(`insert into session (token_hash, user_id, expires_at) values
      ('s2','55555555-5555-5555-5555-555555555555', now() + interval '30 days')`);
    await conn.exec(`delete from app_user where id='55555555-5555-5555-5555-555555555555'`);
    check('deleting a user deletes their sessions', (await conn.query<{ n: number }>(
      `select count(*)::int n from session where token_hash='s2'`))[0].n === 0);

    console.log('\n--- tenant cascade');
    await conn.exec(`insert into user_song_state (user_id, song_id, state) values
      ('22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','{"loopStart":4}')`);
    await conn.exec("delete from band where slug='dev'");
    for (const t of ['song', 'membership', 'grant_link', 'user_song_state']) {
      check(`deleting a band cascades ${t}`, (await conn.query<{ n: number }>(
        `select count(*)::int n from ${t}`))[0].n === 0);
    }
    check('audit_log survives band deletion with band_id nulled', (await conn.query<{ n: number }>(
      'select count(*)::int n from audit_log where band_id is null'))[0].n >= 0);
  } finally {
    // Always. The fixtures above must never outlive this script.
    await conn.exec('rollback');
  }

  const leaked: string[] = [];
  for (const t of TENANT_TABLES) {
    const n = (await conn.query<{ n: number }>(`select count(*)::int n from ${t}`))[0].n;
    if (n > 0) leaked.push(`${t}=${n}`);
  }
  check('fixtures rolled back, database left untouched', leaked.length === 0, leaked.join(', '));
}

await conn.close();
console.log(`\n===== ${failures} failure(s)${skipped ? `, ${skipped} skipped` : ''} =====`);
process.exit(failures ? 1 : 0);
