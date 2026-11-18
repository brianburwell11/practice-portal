/**
 * The player's keyboard shortcuts, shown under Shortcuts in the ? panel,
 * one per row and grouped by what they're for. Each entry's `keys` lists
 * the key combinations that do it (each a list of keys, shown joined by
 * "+", alternatives joined by "or"). The Help guide's Keyboard shortcuts
 * page has the editors' shortcuts too.
 */
export interface Shortcut {
  action: string;
  keys: string[][];
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? 'Option' : 'Alt';

export const SHORTCUT_GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: 'Playing',
    shortcuts: [
      { action: 'Play or pause', keys: [['Space']] },
      { action: 'Follow the playhead', keys: [['`']] },
      { action: 'Add a note here', keys: [['N']] },
    ],
  },
  {
    title: 'Looping',
    shortcuts: [
      { action: 'Set where the loop starts', keys: [['[']] },
      { action: 'Set where the loop ends', keys: [[']']] },
      { action: 'Turn the loop on or off', keys: [['\\'], ['C']] },
      { action: 'Clear the loop', keys: [['Shift', '\\']] },
    ],
  },
  {
    title: 'Mixer',
    shortcuts: [
      { action: 'Soloed parts on or off', keys: [['S']] },
      { action: 'Clear the solos', keys: [['Shift', 'S']] },
      { action: 'Muted parts on or off', keys: [['M']] },
      { action: 'Clear the mutes', keys: [['Shift', 'M']] },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { action: 'Show or hide the mixer', keys: [['X']] },
      { action: 'Show or hide the lyrics', keys: [['L']] },
      { action: 'Show or hide the chords', keys: [['K']] },
      { action: 'Label every control', keys: [['?']] },
    ],
  },
  {
    title: 'Waveform',
    shortcuts: [
      { action: 'Zoom in or out', keys: [[MOD, 'Scroll']] },
      { action: 'Scroll left or right', keys: [['Shift', 'Scroll']] },
      { action: 'Move the view', keys: [[ALT, 'Drag']] },
    ],
  },
];
