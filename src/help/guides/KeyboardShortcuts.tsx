import { HelpSection } from '../HelpLayout';
import { GuideLink, Key, Note, Table } from '../parts';

export default function KeyboardShortcuts() {
  return (
    <>
      <p>
        Shortcuts work whenever you’re not typing in a box. On a Mac, use <Key>⌘</Key> where it says{' '}
        <Key>Ctrl</Key>.
      </p>

      <HelpSection title="Playing a song">
        <Table
          head={['To', 'Press']}
          rows={[
            ['Play or pause', <Key>Space</Key>],
            ['Set where the loop starts', <Key>[</Key>],
            ['Set where the loop ends', <Key>]</Key>],
            ['Turn the loop on or off', <><Key>\</Key> or <Key>c</Key></>],
            ['Clear the loop', <><Key>Shift</Key>+<Key>\</Key>, or <Key>Shift</Key>+click the loop button</>],
            ['Add a note here', <Key>N</Key>],
            ['Mute the parts you’ve chosen, or unmute them', <Key>M</Key>],
            ['Solo the parts you’ve chosen, or stop soloing', <Key>S</Key>],
            ['Clear every part’s mute or solo', <><Key>Shift</Key>+<Key>M</Key>, <Key>Shift</Key>+<Key>S</Key></>],
            ['Make the waveform follow the song again', <Key>`</Key>],
            ['Show or hide the mixer', <Key>X</Key>],
            ['Show or hide the lyrics (computer only)', <Key>L</Key>],
            ['Show or hide the chords (computer only)', <Key>K</Key>],
            ['Zoom the waveform', <><Key>Ctrl</Key>+scroll, or pinch</>],
            ['Move along the waveform or lyrics', <><Key>Shift</Key>+scroll</>],
            ['Reset Speed, Vol or a part’s Pan', 'Double-click the slider'],
            ['Close a window', <Key>Esc</Key>],
          ]}
        />
        <Note>
          On a phone or tablet, press and hold instead of <Key>Shift</Key>+click: hold the loop button to clear the loop,
          or the big M or S to clear every part’s mute or solo. Hold play to stop.
        </Note>
        <p>
          More on mute and solo in <GuideLink slug="using-the-mixer">Using the mixer</GuideLink>.
        </p>
      </HelpSection>

      <HelpSection title="Lyrics editor">
        <Table
          head={['To', 'Press']}
          rows={[
            ['Play or pause', <Key>Space</Key>],
            ['Stamp the next line with the current time', <Key>Tab</Key>],
            ['Add an instrumental line', <><Key>Ctrl</Key>+<Key>I</Key></>],
            ['Move a line up or down', <><Key>Alt</Key>+<Key>↑</Key> or <Key>↓</Key></>],
            ['Duplicate a line', <><Key>Ctrl</Key>+<Key>D</Key></>],
            ['Select every line', <><Key>Ctrl</Key>+<Key>A</Key></>],
            ['Select a range of lines', <><Key>Shift</Key>+click</>],
            ['Delete the selected lines', <><Key>Delete</Key> or <Key>Backspace</Key></>],
            ['Undo, redo', <><Key>Ctrl</Key>+<Key>Z</Key>, <Key>Ctrl</Key>+<Key>Shift</Key>+<Key>Z</Key></>],
          ]}
        />
      </HelpSection>

      <HelpSection title="Chords editor">
        <p>In Grid mode:</p>
        <Table
          head={['To', 'Press']}
          rows={[
            ['Store the chord and go to the next beat, or back one', <><Key>Space</Key>, <Key>Shift</Key>+<Key>Space</Key></>],
            ['Store the chord and go to the next bar, or back one', <><Key>Tab</Key>, <Key>Shift</Key>+<Key>Tab</Key></>],
            ['Repeat the last chord on this beat', <Key>/</Key>],
            ['Copy the previous bar into this one', <Key>%</Key>],
            ['Push the chord to the “and” before its beat', <Key>&lt;</Key>],
            ['Delete the chord, or every chord in the selection', <><Key>Delete</Key> or <Key>Backspace</Key></>],
            ['Select a range of beats', <><Key>Shift</Key>+click, or <Key>Shift</Key>+arrows</>],
            ['Select every beat', <><Key>Ctrl</Key>+<Key>A</Key></>],
            ['Copy, cut, paste', <><Key>Ctrl</Key>+<Key>C</Key>, <Key>Ctrl</Key>+<Key>X</Key>, <Key>Ctrl</Key>+<Key>V</Key></>],
            ['Play from the cursor, or pause', <><Key>Ctrl</Key>+<Key>Enter</Key></>],
            ['Undo, redo', <><Key>Ctrl</Key>+<Key>Z</Key>, <Key>Ctrl</Key>+<Key>Shift</Key>+<Key>Z</Key></>],
          ]}
        />
        <p>In Stamp mode:</p>
        <Table
          head={['To', 'Press']}
          rows={[
            ['Play or pause', <Key>Space</Key>],
            ['Stamp the next chord in the queue at the current time', <Key>Tab</Key>],
            ['Take the last stamp back', <><Key>Shift</Key>+<Key>Tab</Key></>],
            ['Nudge the selected chord', <><Key>Alt</Key>+<Key>←</Key> or <Key>→</Key></>],
            ['Replay from just before the selected chord', <Key>R</Key>],
            ['Select a run of chords', <><Key>Shift</Key>+click</>],
            ['Delete the selected chords', <><Key>Delete</Key> or <Key>Backspace</Key></>],
          ]}
        />
      </HelpSection>

      <HelpSection title="TapMap editor">
        <Table
          head={['To', 'Press']}
          rows={[
            ['Mark a new section', <Key>S</Key>],
            ['Mark a measure', <Key>M</Key>],
            ['Mark a beat', <Key>B</Key>],
            ['Delete the selected mark', <><Key>Delete</Key> or <Key>Backspace</Key></>],
            ['Undo', <><Key>Z</Key> or <Key>Ctrl</Key>+<Key>Z</Key></>],
          ]}
        />
      </HelpSection>

      <HelpSection title="Aligning stems">
        <Table
          head={['To', 'Press']}
          rows={[
            ['Nudge the selected stem by 1 ms', <><Key>←</Key> or <Key>→</Key></>],
            ['…by 10 ms', <><Key>Shift</Key>+<Key>←</Key> or <Key>→</Key></>],
            ['…by 100 ms', <><Key>Alt</Key>+<Key>←</Key> or <Key>→</Key></>],
            ['Add a marker', <Key>M</Key>],
            ['Zoom, move along', <><Key>Ctrl</Key>+scroll, <Key>Shift</Key>+scroll</>],
            ['Undo', <><Key>Ctrl</Key>+<Key>Z</Key></>],
          ]}
        />
        <p>
          More in <GuideLink slug="timing-and-lyrics">Timing, lyrics and chords</GuideLink> and{' '}
          <GuideLink slug="adding-songs">Adding and editing songs</GuideLink>.
        </p>
      </HelpSection>
    </>
  );
}
