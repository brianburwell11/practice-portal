import { beforeEach, describe, expect, it } from 'vitest';
import { usePanelMinimizeStore } from './panelMinimizeStore';

const KEY = 'practice-portal.minimizedVideos';

describe('panelMinimizeStore videos', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePanelMinimizeStore.getState().clearAll();
    usePanelMinimizeStore.getState().setCurrentSongId('song-1');
  });

  it('remembers a video minimized by hand for the next visit', () => {
    usePanelMinimizeStore.getState().minimizeVideo('v1');
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ 'song-1': ['v1'] });
  });

  it('minimizes without remembering when asked (an editor tucking videos away)', () => {
    usePanelMinimizeStore.getState().minimizeVideo('v1', { remember: false });
    expect(usePanelMinimizeStore.getState().isVideoMinimized('v1')).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Coming back to the song shows it again.
    usePanelMinimizeStore.getState().setCurrentSongId('song-1');
    expect(usePanelMinimizeStore.getState().isVideoMinimized('v1')).toBe(false);
  });
});
