import { beforeEach, describe, expect, it } from 'vitest';
import { phonePanelOpen, rememberPhonePanel } from './phonePanels';

describe('phonePanels', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts every panel open', () => {
    expect(phonePanelOpen('chords')).toBe(true);
    expect(phonePanelOpen('lyrics')).toBe(true);
    expect(phonePanelOpen('mixer')).toBe(true);
  });

  it('remembers each panel on its own', () => {
    rememberPhonePanel('lyrics', false);
    expect(phonePanelOpen('lyrics')).toBe(false);
    expect(phonePanelOpen('chords')).toBe(true);
    rememberPhonePanel('lyrics', true);
    expect(phonePanelOpen('lyrics')).toBe(true);
  });

  it('ignores a corrupt setting', () => {
    window.localStorage.setItem('practice-portal.phonePanels', 'not json');
    expect(phonePanelOpen('mixer')).toBe(true);
  });
});
