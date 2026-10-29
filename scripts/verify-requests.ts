/**
 * Requests to join a Members-only band, end to end through a running server
 * and Postgres — and, with `--mock-resend`, the emails they send.
 *
 *   npm run build:server
 *   RESEND_API_KEY=test RESEND_API_URL=http://localhost:18559 PORT=18558 \
 *     node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-requests.ts --url http://localhost:18558 --mock-resend 18559
 *
 * `--mock-resend <port>` listens there as a stand-in for Resend's
 * `POST /emails` and checks what arrives. Without it, email checks are
 * skipped (the server only logs). Creates throwaway users and bands and
 * deletes them in `finally`; touches no R2.
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const base = flag('url')?.replace(/\/$/, '');
const mockPort = flag('mock-resend');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-requests.ts --url <server> [--mock-resend <port>]   (DATABASE_URL from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vr-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const OPEN = `${TAG}-open`;
const ELSEWHERE = `${TAG}-elsewhere`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

interface Sent { auth: string | undefined; body: Record<string, unknown> }
const outbox: Sent[] = [];
/** Emails that arrived since `since`, once the server has had a moment to send them. */
async function emailsSince(since: number): Promise<Sent[]> {
  await new Promise((r) => setTimeout(r, 300));
  return outbox.slice(since);
}

interface User { id: string; email: string; cookie: string }

async function makeUser(name: string): Promise<User> {
  const email = `${TAG}-${name}@example.invalid`;
  const [u] = await sql`insert into app_user (email, display_name) values (${email}, ${name}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into session (token_hash, user_id, expires_at)
            values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, now() + interval '10 minutes')`;
  return { id: u.id as string, email, cookie: `pp_session=${token}` };
}

async function call(user: User | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(method !== 'GET' ? { origin: base!, 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  const mock = mockPort ? http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/emails') {
        outbox.push({ auth: req.headers.authorization, body: JSON.parse(data) });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: randomBytes(8).toString('hex') }));
      } else {
        res.writeHead(404).end();
      }
    });
  }).listen(Number(mockPort)) : null;

  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const manager = await makeUser('manager');
    const member = await makeUser('member');
    const sam = await makeUser('sam');
    const alex = await makeUser('alex');
    users.push(owner, manager, member, sam, alex);
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    for (const [b, visibility] of [[BAND, 'private'], [OPEN, 'public'], [ELSEWHERE, 'private']] as const) {
      await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
                values (${b}, ${b}, ${`Band ${b}`}, ${colors}, ${owner.id}, ${visibility})`;
    }
    for (const [u, role] of [[manager, 'manager'], [member, 'member']] as const) {
      await sql`insert into membership (user_id, band_id, role) select ${u.id}, id, ${role} from band where legacy_id = ${BAND}`;
    }
    const access = `/api/access/${BAND}`;
    const requests = `/api/bands/${BAND}/access-requests`;

    console.log('--- finding the band');
    const anon = await call(null, 'GET', access);
    check('signed out sees the band’s name too', anon.status === 200 && (anon.json.band as { name?: string })?.name === `Band ${BAND}`, JSON.stringify(anon.json));
    check('…and nothing about requests', anon.json.request === null && anon.json.canRequest === false && anon.json.member === false);
    check('…but still can’t read the band', (await call(null, 'GET', `/api/data/${BAND}/band.json`)).status === 401);
    check('signed out, an unknown address → 404', (await call(null, 'GET', `/api/access/${TAG}-nope`)).status === 404);
    check('signed out can’t ask → 401', (await call(null, 'POST', access, {})).status === 401);
    const seen = await call(sam, 'GET', access);
    check('a signed-in non-member sees the band’s name', seen.status === 200 && (seen.json.band as { name?: string })?.name === `Band ${BAND}`, JSON.stringify(seen.json));
    check('…not a member, no request yet, may ask', seen.json.member === false && seen.json.request === null && seen.json.canRequest === true);
    check('…but still can’t read the band', (await call(sam, 'GET', `/api/data/${BAND}/band.json`)).status === 403);
    check('an unknown address → 404', (await call(sam, 'GET', `/api/access/${TAG}-nope`)).status === 404);
    check('a Public band needs no asking → 400', (await call(sam, 'POST', `/api/access/${OPEN}`, {})).status === 400);
    check('a member can’t ask → 400', (await call(member, 'POST', access, {})).status === 400);
    check('the owner can’t ask → 400', (await call(owner, 'POST', access, {})).status === 400);
    check('a 501-character message → 400', (await call(sam, 'POST', access, { message: 'x'.repeat(501) })).status === 400);
    check('a message that isn’t text → 400', (await call(sam, 'POST', access, { message: 42 })).status === 400);

    console.log('\n--- asking');
    const message = 'Hi! I play <script>alert(1)</script> trumpet & "sub" a lot';
    let mark = outbox.length;
    const asked = await call(sam, 'POST', access, { message });
    check('sam asks, with a message', asked.status === 200, JSON.stringify(asked.json));
    check('asking twice → 409', (await call(sam, 'POST', access, {})).status === 409);
    const pending = await call(sam, 'GET', access);
    check('sam sees it pending', (pending.json.request as { status?: string })?.status === 'pending' && pending.json.canRequest === false);
    if (mock) {
      const [mail, extra] = await emailsSince(mark);
      check('one email went out', !!mail && !extra, `${outbox.length - mark} sent`);
      const b = mail?.body ?? {};
      check('…to the owner only', JSON.stringify(b.to) === JSON.stringify([owner.email]), JSON.stringify(b.to));
      check('…from do-not-reply@practiceportal.app', String(b.from).includes('<do-not-reply@practiceportal.app>'), String(b.from));
      check('…with sam as Reply-To', b.reply_to === sam.email, String(b.reply_to));
      check('…with the API key', mail?.auth === 'Bearer test', String(mail?.auth));
      check('…naming the band in the subject', String(b.subject).includes(`Band ${BAND}`), String(b.subject));
      check('…the message escaped in the HTML', String(b.html).includes('&lt;script&gt;') && !String(b.html).includes('<script>'));
      check('…and as typed in the text', String(b.text).includes(message));
      check('…linking to Members & Sharing', String(b.html).includes(`/${BAND}?requests=1`));
      check('the server says it was emailed', asked.json.emailed === true);
    } else {
      console.log('skip  email checks (no --mock-resend)');
    }

    console.log('\n--- who sees requests');
    check('signed out → 401', (await call(null, 'GET', requests)).status === 401);
    check('sam → 403', (await call(sam, 'GET', requests)).status === 403);
    check('a member → 403', (await call(member, 'GET', requests)).status === 403);
    const listed = await call(manager, 'GET', requests);
    const rows = (listed.json.requests ?? []) as { id: string; email: string; message: string }[];
    check('a manager sees sam’s, with the message', rows.length === 1 && rows[0].email === sam.email && rows[0].message === message, JSON.stringify(listed.json));
    const firstId = rows[0]?.id;
    check('a member can’t decide → 403', (await call(member, 'POST', `${requests}/${firstId}/decline`)).status === 403);
    check('sam can’t approve himself → 403', (await call(sam, 'POST', `${requests}/${firstId}/approve`)).status === 403);

    console.log('\n--- declining');
    mark = outbox.length;
    check('the manager declines', (await call(manager, 'POST', `${requests}/${firstId}/decline`)).status === 200);
    check('deciding it again → 409', (await call(owner, 'POST', `${requests}/${firstId}/approve`)).status === 409);
    if (mock) {
      const [mail] = await emailsSince(mark);
      check('sam is emailed that it wasn’t approved', String(mail?.body.to) === sam.email && /wasn’t approved/.test(String(mail?.body.text)), JSON.stringify(mail?.body));
    }
    const declined = await call(sam, 'GET', access);
    const retryDays = (new Date(String(declined.json.retryAt)).getTime() - Date.now()) / 86_400_000;
    check('sam sees it declined, may ask again in 7 days', (declined.json.request as { status?: string })?.status === 'declined'
      && declined.json.canRequest === false && retryDays > 6.9 && retryDays <= 7, JSON.stringify(declined.json));
    check('asking again too soon → 429', (await call(sam, 'POST', access, {})).status === 429);
    check('still not in', (await call(sam, 'GET', `/api/data/${BAND}/band.json`)).status === 403);
    await sql`update access_request set decided_at = now() - interval '8 days' where id = ${firstId}`;
    check('a week on, sam may ask again', (await call(sam, 'GET', access)).json.canRequest === true);

    console.log('\n--- approving');
    mark = outbox.length;
    check('sam asks again, this time without a message', (await call(sam, 'POST', access, {})).status === 200);
    if (mock) {
      const [mail] = await emailsSince(mark);
      check('…and the email has no message section', !!mail && !/message/i.test(String(mail.body.text)) && !/message/i.test(String(mail.body.html)), String(mail?.body.text));
    }
    const secondId = ((await call(owner, 'GET', requests)).json.requests as { id: string }[])[0]?.id;
    mark = outbox.length;
    check('the owner approves', (await call(owner, 'POST', `${requests}/${secondId}/approve`)).status === 200);
    const [m] = await sql`select role from membership m join band b on b.id = m.band_id where b.legacy_id = ${BAND} and m.user_id = ${sam.id}`;
    check('sam is a Member', m?.role === 'member', JSON.stringify(m));
    check('sam reads the band now', (await call(sam, 'GET', `/api/data/${BAND}/band.json`)).status === 200);
    check('sam’s page says so', (await call(sam, 'GET', access)).json.member === true);
    check('no requests left pending', ((await call(owner, 'GET', requests)).json.requests as unknown[]).length === 0);
    if (mock) {
      const [mail] = await emailsSince(mark);
      check('sam is emailed he’s in, with a link to the band', String(mail?.body.to) === sam.email
        && String(mail?.body.subject).startsWith('You’re in') && String(mail?.body.html).includes(`/${BAND}"`), JSON.stringify(mail?.body));
    }

    console.log('\n--- one band’s managers decide only its own requests');
    check('alex asks to join another band', (await call(alex, 'POST', `/api/access/${ELSEWHERE}`, {})).status === 200);
    const [elsewhere] = await sql`select r.id from access_request r join band b on b.id = r.band_id where b.legacy_id = ${ELSEWHERE}`;
    check('approving it through this band’s path → 404', (await call(manager, 'POST', `${requests}/${elsewhere.id}/approve`)).status === 404);
    check('approving it through its own band → 403', (await call(manager, 'POST', `/api/bands/${ELSEWHERE}/access-requests/${elsewhere.id}/approve`)).status === 403);
    check('…and it’s still pending', (await sql`select status from access_request where id = ${elsewhere.id}`)[0]?.status === 'pending');
    check('the other band’s requests aren’t listed here', ((await call(manager, 'GET', requests)).json.requests as unknown[]).length === 0);

    console.log('\n--- invite emails');
    const invitee = `${TAG}-invitee@example.invalid`;
    mark = outbox.length;
    const locked = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'editor', email: invitee });
    check('an invite locked to an address', locked.status === 200, JSON.stringify(locked.json));
    if (mock) {
      const [mail, extra] = await emailsSince(mark);
      const b = mail?.body ?? {};
      check('…is emailed to that address, once', JSON.stringify(b.to) === JSON.stringify([invitee]) && !extra, JSON.stringify(b.to));
      check('…with the inviter as Reply-To', b.reply_to === owner.email, String(b.reply_to));
      check('…naming the inviter, band and role', String(b.subject).includes('owner invited you to') && String(b.subject).includes(`Band ${BAND}`) && String(b.text).includes('as Editor'), `${b.subject} / ${b.text}`);
      check('…carrying the same link the inviter sees', String(b.html).includes(String(locked.json.url)) && String(b.text).includes(String(locked.json.url)));
      check('…and the server says it was emailed', locked.json.emailed === true);
      const headers = (b.headers ?? {}) as Record<string, string>;
      check('…with one-click unsubscribe headers', /\/api\/email\/block\?token=/.test(headers['List-Unsubscribe'] ?? '')
        && headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', JSON.stringify(headers));
      check('…and a “Don’t email me again” link', String(b.html).includes('/email/unsubscribe?token=') && String(b.html).includes('Don’t email me again'));
    }
    mark = outbox.length;
    const open = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member' });
    check('an invite with no address sends nothing', open.status === 200 && open.json.emailed === false && (await emailsSince(mark)).length === 0);

    console.log('\n--- the block list');
    const inviteToken = String(locked.json.url).split('/invite/')[1];
    const blockUrl = `/api/email/block?token=${inviteToken}`;
    const before = await call(null, 'GET', blockUrl);
    check('the opt-out link names its address, not yet blocked', before.json.email === invitee && before.json.blocked === false, JSON.stringify(before.json));
    check('a made-up token is refused', (await call(null, 'POST', `/api/email/block?token=${'x'.repeat(43)}`)).status === 404);
    const blocked = await call(null, 'POST', blockUrl);
    check('posting it blocks the address, no sign-in needed', blocked.status === 200 && blocked.json.blocked === true, JSON.stringify(blocked.json));
    check('…and again is fine', (await call(null, 'POST', blockUrl)).status === 200);
    mark = outbox.length;
    const toBlocked = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member', email: invitee.toUpperCase() });
    check('an invite to a blocked address is still made', toBlocked.status === 200 && !!toBlocked.json.url, JSON.stringify(toBlocked.json));
    check('…but not emailed, and says why', toBlocked.json.emailed === false && toBlocked.json.emailSkipped === 'blocked', JSON.stringify(toBlocked.json));
    if (mock) check('…and nothing went out', (await emailsSince(mark)).length === 0);

    console.log('\n--- user text in emails');
    await sql`update app_user set display_name = ${'Owner https://evil.example/x www.spam.example'} where id = ${owner.id}`;
    await sql`update band set name = ${`Band ${'z'.repeat(120)} bit.ly/free`} where legacy_id = ${BAND}`;
    mark = outbox.length;
    const named = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member', email: `${TAG}-n1@example.invalid` });
    check('an invite after renaming is emailed', named.json.emailed === true, JSON.stringify(named.json));
    if (mock) {
      const b = (await emailsSince(mark))[0]?.body ?? {};
      const all = `${b.subject} ${b.text} ${b.html}`;
      check('…with no links from the names', !/evil|spam|bit\.ly/.test(all), String(b.subject));
      check('…and the band name cut to 100 characters', String(b.subject).includes('z'.repeat(90)) && !String(b.subject).includes('z'.repeat(100)), String(b.subject));
    }
    const kim = await makeUser('kim');
    users.push(kim);
    check('a request message over 100 characters is refused', (await call(kim, 'POST', access, { message: 'm'.repeat(101) })).status === 400);
    mark = outbox.length;
    check('kim asks with a link in the message', (await call(kim, 'POST', access, { message: 'hi! see https://evil.example/x' })).status === 200);
    if (mock) {
      const b = (await emailsSince(mark))[0]?.body ?? {};
      check('…the Owner’s email keeps the words, not the link', String(b.text).includes('hi! see') && !/evil/.test(`${b.text} ${b.html}`), String(b.text));
    }

    console.log('\n--- 10 invite emails per band per week');
    // Emailed so far this week: the first locked invite and the renamed one.
    mark = outbox.length;
    const extra: Record<string, unknown>[] = [];
    for (let i = 2; i <= 9; i++) extra.push((await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member', email: `${TAG}-w${i}@example.invalid` })).json);
    check('emails 3 to 10 go out', extra.every((j) => j.emailed === true), JSON.stringify(extra.map((j) => j.emailSkipped)));
    const eleventh = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member', email: `${TAG}-w11@example.invalid` });
    check('the 11th invite is still made', eleventh.status === 200 && !!eleventh.json.url);
    check('…but not emailed, and says why', eleventh.json.emailed === false && eleventh.json.emailSkipped === 'weekly-limit', JSON.stringify(eleventh.json));
    if (mock) check('…so exactly 8 more emails went out', (await emailsSince(mark)).length === 8, String(outbox.length - mark));
    check('an invite with no address is still fine', (await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member' })).status === 200);
    const [{ n }] = await sql`select count(*)::int as n from invite i join band b on b.id = i.band_id where b.legacy_id = ${BAND} and i.emailed_at is not null`;
    check('Postgres records 10 emailed invites', n === 10, String(n));

    const audit = await sql`select action from audit_log a join band b on b.id = a.band_id where b.legacy_id = ${BAND}`;
    const actions = audit.map((r) => r.action as string);
    check('asking, declining and approving are audited',
      ['access_request.create', 'access_request.decline', 'access_request.approve'].every((a) => actions.includes(a)), actions.join(', '));
  } finally {
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    await sql`delete from email_block where email like ${TAG + '%'}`;
    await sql`delete from app_user where id = any(${ids})`;
    const [{ left }] = await sql`select count(*)::int left from app_user where email like ${TAG + '%'}`;
    console.log(`\ncleanup: ${left} test user(s) left`);
    await sql.end();
    mock?.close();
  }
  console.log(`===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
