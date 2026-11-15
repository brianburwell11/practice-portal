import { describe, expect, it } from 'vitest';
import { matchRoute, runRoute } from './router';
import type { Actor, RouteTarget } from './types';

const actor = (userId: string): Actor => ({ kind: 'user', userId, email: `${userId}@example.com`, sessionHash: 'h' });

async function saveLyrics(search: string, who: Partial<RouteTarget>) {
  const matched = matchRoute('POST', '/api/bands/band1/songs/song1/lyrics');
  if (!matched) throw new Error('no route');
  return runRoute(matched.route, {
    params: matched.params, query: new URLSearchParams(search), cookies: {}, origin: 'https://practiceportal.app', ...who,
  }, async () => ({ body: { lines: [] } }));
}

describe('an edit made offline, sent with ?asUser=', () => {
  it('is refused, as someone else’s, when another account is signed in (before their permissions are checked)', async () => {
    const res = await saveLyrics('asUser=alice&baseRev=3', { actor: actor('bob') });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'wrong-user' });
  });

  it('with nobody signed in is the usual 401, so the app asks for a sign-in', async () => {
    const res = await saveLyrics('asUser=alice', {});
    expect(res.status).toBe(401);
  });
});
