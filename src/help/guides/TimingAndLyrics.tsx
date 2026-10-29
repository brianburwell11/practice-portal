import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Key, Note, Steps, Ui } from '../parts';

export default function TimingAndLyrics() {
  return (
    <>
      <p>
        Two editors make a song easier to practice: the <Ui>TapMap Editor</Ui> marks where its sections and measures
        fall, and the <Ui>Lyrics Editor</Ui> lines the words up with the music. Both are in the <Ui>Songs</Ui> menu while
        a song is open.
      </p>

      <HelpSection title="The tap map">
        <p>
          A song’s tap map is the list of where each section, measure and beat starts. Once a song has one, the player
          shows measure and beat numbers, <Ui>Jump to Section</Ui> lists the sections, and the sheet music follows
          along. Managers and the Owner can edit it.
        </p>
        <Steps>
          <li>Open <Ui>Songs</Ui> → <Ui>TapMap Editor</Ui> and play the song.</li>
          <li>
            Tap along: <Key>S</Key> where a new section starts, <Key>M</Key> on the first beat of each measure, and{' '}
            <Key>B</Key> on other beats if you want them. Sections are named A, B, C and so on.
          </li>
          <li>Give sections real names (Verse, Chorus…) in the section list.</li>
          <li>
            Fix mistakes as you go: click a mark to select it and drag it, press <Key>Delete</Key> to remove it, or{' '}
            <Key>Z</Key> to undo.
          </li>
        </Steps>
        <Note>
          If you’ve mapped the song in Transcribe!, <Ui>Import .xsc</Ui> brings its markers in. <Ui>Export .xsc</Ui>{' '}
          goes the other way, with a WAV of the current mix, and <Ui>Export MusicXML</Ui> makes a blank score with the
          section names as rehearsal marks.
        </Note>
      </HelpSection>

      <HelpSection title="Lyrics">
        <p>Owners, Managers and Editors can add lyrics from <Ui>Songs</Ui> → <Ui>Lyrics Editor</Ui>.</p>
        <Steps>
          <li>
            Type or paste the lyrics, one line per line, or use <Ui>Import .txt</Ui>. A line that says{' '}
            <code>[Instrumental]</code> or <code>#INSTRUMENTAL</code> becomes an instrumental break.
          </li>
          <li>
            Add section labels with <Ui>+ Section</Ui> (Intro, Verse, Chorus…). They only show in the editor, to help you
            find your way; the band sees just the lyrics.
          </li>
          <li>
            Play the song and press <Key>Tab</Key> as each line starts. That stamps the line with the current time.
            Click a time to clear it and try again.
          </li>
          <li>Save. The lyrics now scroll along with the song for everyone.</li>
        </Steps>
        <p>
          The rest of the editor’s shortcuts are in <GuideLink slug="keyboard-shortcuts">Keyboard shortcuts</GuideLink>.
        </p>
      </HelpSection>

      <HelpSection title="Lining up videos">
        <p>
          If a song has YouTube videos (added in <Ui>Edit Song</Ui>), Owners, Managers and Editors see a <Ui>Sync</Ui>{' '}
          button on each video. Click it and the video stops following the song, so you can put both at the same
          moment, like the first downbeat: the video with its own controls, the song with the waveform. Then click{' '}
          <Ui>Set Sync</Ui>. From then on the video keeps time with the song.
        </p>
      </HelpSection>

      <HelpSection title="Who can do what">
        <Bullets>
          <li>TapMap Editor: Managers and the Owner.</li>
          <li>Lyrics Editor and video sync: Owners, Managers and Editors.</li>
        </Bullets>
        <p>The full list is in <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>.</p>
      </HelpSection>
    </>
  );
}
