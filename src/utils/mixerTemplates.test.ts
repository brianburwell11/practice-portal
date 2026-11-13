import { describe, expect, it } from 'vitest';
import type { SongConfig } from '../audio/types';
import { applyTemplateToConfig, captureTemplate, matchTemplate, normalizeName } from './mixerTemplates';

const stem = (id: string, label: string, defaultVolume = 0.7, defaultPan = 0) => ({
  id, label, file: `${id}.opus`, color: '#000', defaultVolume, defaultPan,
});

const song: Pick<SongConfig, 'stems' | 'groups'> = {
  stems: [stem('kick', 'Kick'), stem('snare', 'Snare'), stem('bass', '  bass  guitar '), stem('vox', 'Lead Vox')],
  groups: [{ id: 'drums', label: 'Drums', color: '#000', stemIds: ['kick', 'snare'] }],
};

describe('normalizeName', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeName('  Bass   Guitar ')).toBe('bass guitar');
  });
});

describe('matchTemplate', () => {
  it('matches by exact name ignoring case and spacing, leaves others alone', () => {
    const m = matchTemplate({
      stems: [
        { name: 'KICK', volume: 1, pan: 0 },
        { name: 'Bass Guitar', volume: 0.5, pan: -0.3 },
        { name: 'Kick In', volume: 0.2, pan: 0 },
        { name: 'Vox', volume: 0.9, pan: 0 },
      ],
      groups: [{ name: 'drums', volume: 1.2 }],
    }, song);
    expect([...m.stems.keys()]).toEqual(['kick', 'bass']);
    expect(m.stems.get('bass')).toEqual({ volume: 0.5, pan: -0.3 });
    expect(m.groups.get('drums')).toBe(1.2);
    expect(m.matched).toBe(3);
    expect(m.total).toBe(5);
  });

  it('takes the first of duplicate template names and clamps values', () => {
    const m = matchTemplate({
      stems: [{ name: 'Kick', volume: 9, pan: -4 }, { name: 'kick', volume: 0.1, pan: 0 }],
      groups: [],
    }, song);
    expect(m.stems.get('kick')).toEqual({ volume: 1.5, pan: -1 });
  });
});

describe('captureTemplate', () => {
  it('reads the live mix by label, falling back to defaults, skipping duplicate names', () => {
    const t = captureTemplate(
      { stems: [...song.stems, stem('kick2', 'kick')], groups: song.groups },
      { kick: { volume: 1.1, pan: 0.2 }, kick2: { volume: 0.1, pan: 0 } },
      { drums: { volume: 0.8 } },
    );
    expect(t.stems).toEqual([
      { name: 'Kick', volume: 1.1, pan: 0.2 },
      { name: 'Snare', volume: 0.7, pan: 0 },
      { name: 'bass  guitar', volume: 0.7, pan: 0 },
      { name: 'Lead Vox', volume: 0.7, pan: 0 },
    ]);
    expect(t.groups).toEqual([{ name: 'Drums', volume: 0.8 }]);
  });
});

describe('applyTemplateToConfig', () => {
  const template = {
    stems: [{ name: 'kick', volume: 1, pan: 0.5 }, { name: 'snare', volume: 0.4, pan: -0.5 }],
    groups: [{ name: 'Drums', volume: 1.3 }],
  };

  it('sets matched defaults', () => {
    const out = applyTemplateToConfig(song, template);
    expect(out.stems[0]).toMatchObject({ defaultVolume: 1, defaultPan: 0.5 });
    expect(out.stems[1]).toMatchObject({ defaultVolume: 0.4, defaultPan: -0.5 });
    expect(out.stems[2]).toBe(song.stems[2]);
    expect(out.groups?.[0].defaultVolume).toBe(1.3);
  });

  it('respects the filters', () => {
    const out = applyTemplateToConfig(song, template, {
      stem: (s) => s.id === 'snare',
      group: () => false,
    });
    expect(out.stems[0]).toBe(song.stems[0]);
    expect(out.stems[1]).toMatchObject({ defaultVolume: 0.4 });
    expect(out.groups?.[0].defaultVolume).toBeUndefined();
  });

  it('leaves a song without groups without groups', () => {
    const out = applyTemplateToConfig({ stems: song.stems }, template);
    expect('groups' in out).toBe(false);
  });
});
