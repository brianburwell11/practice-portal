// @vitest-environment node
/**
 * The cost estimate is site-admin only: through the real route table and
 * router, nobody else gets past authorization, and the handler (which lists
 * every band and its storage) never runs for them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, RouteTarget } from '../types';

const ran = vi.hoisted(() => ({ costs: 0, bands: 0 }));
vi.mock('../handlers/siteAdmin', async (original) => ({
  ...(await original<typeof import('../handlers/siteAdmin')>()),
  adminCosts: async () => { ran.costs++; return { status: 200, body: { ok: true } }; },
  adminBands: async () => { ran.bands++; return { status: 200, body: { ok: true } }; },
}));

const { matchRoute, runRoute } = await import('../router');

process.env.ADMIN_EMAILS = 'admin@example.com, second@example.com';

const user = (email: string): Actor => ({ kind: 'user', userId: '00000000-0000-0000-0000-000000000001', email, sessionHash: 'h' });

async function call(path: string, who: Partial<RouteTarget> = {}, method = 'GET') {
  const [pathname, search = ''] = path.split('?');
  const matched = matchRoute(method, pathname);
  if (!matched) return { status: 404 };
  return runRoute(matched.route, {
    params: matched.params, query: new URLSearchParams(search), cookies: {}, origin: 'https://practiceportal.app', ...who,
  }, async () => ({}));
}

beforeEach(() => { ran.costs = 0; ran.bands = 0; });

describe('GET /api/admin/costs', () => {
  it('is declared site-admin only', () => {
    expect(matchRoute('GET', '/api/admin/costs')?.route.access).toBe('platformAdmin');
  });

  it('refuses anyone signed out', async () => {
    expect((await call('/api/admin/costs')).status).toBe(401);
    expect((await call('/api/admin/costs?fresh=1')).status).toBe(401);
  });

  it('refuses a guest-link holder', async () => {
    const res = await call('/api/admin/costs', { guests: [{ bandId: 'b' }] as RouteTarget['guests'] });
    expect(res.status).toBe(401);
  });

  it('refuses a signed-in user who isn’t a site admin', async () => {
    for (const email of ['owner@example.com', 'admin@example.com.evil.test', 'admin@example', '']) {
      expect((await call('/api/admin/costs', { actor: user(email) })).status).toBe(403);
    }
  });

  it('never runs the handler for those refused', async () => {
    await call('/api/admin/costs');
    await call('/api/admin/costs?fresh=1', { actor: user('owner@example.com') });
    await call('/api/admin/bands?fresh=1', { actor: user('owner@example.com') });
    expect(ran).toEqual({ costs: 0, bands: 0 });
  });

  it('answers a site admin, whatever the address’s case', async () => {
    expect((await call('/api/admin/costs', { actor: user('Admin@Example.com') })).status).toBe(200);
    expect((await call('/api/admin/costs?fresh=1', { actor: user('second@example.com') })).status).toBe(200);
    expect(ran.costs).toBe(2);
  });

  it('matches only the exact path and GET', async () => {
    const admin = { actor: user('admin@example.com') };
    expect((await call('/api/admin/costs/', admin)).status).toBe(404);
    expect((await call('/api/admin/costs/x', admin)).status).toBe(404);
    expect((await call('/api/admin/costs', admin, 'POST')).status).toBe(404);
  });
});
