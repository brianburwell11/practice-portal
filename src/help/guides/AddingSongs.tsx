import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Key, Note, Steps, Ui } from '../parts';

export default function AddingSongs() {
  return (
    <>
      <p>
        Owners, Managers and Editors can add songs (see{' '}
        <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>). Open the <Ui>Songs</Ui> menu and choose{' '}
        <Ui>Add Song</Ui>. It takes four steps, and nothing is uploaded until you save at the end.
      </p>

      <HelpSection title="What you’ll need">
        <Bullets>
          <li>
            <Ui>Stems:</Ui> one audio file per part, all from the same recording and the same length. WAV, MP3, OGG,
            Opus, FLAC, AIFF and M4A all work. A song can have up to 32 stems of up to 1 GB each.
          </li>
          <li>
            <Ui>Sheet music</Ui> (optional): MusicXML (<code>.musicxml</code>, <code>.xml</code> or <code>.mxl</code>) or a
            MuseScore file (<code>.mscz</code>, up to 50 MB). Export it from Sibelius, Finale, Dorico or MuseScore.
          </li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Step 1: Metadata">
        <p>
          Only the <Ui>Title</Ui> is required. <Ui>Artist</Ui> is filled in with your band’s name if you leave it blank.
          Add a <Ui>Key</Ui> (like C, Bbm or F#m) and <Ui>Tags</Ui> to make songs easy to filter when you build{' '}
          <GuideLink slug="setlists">setlists</GuideLink>.
        </p>
        <p>
          The song’s link is made from its title, like practiceportal.app/your-band?song=my-song. You can change it, as
          long as no other song in the band uses it.
        </p>
      </HelpSection>

      <HelpSection title="Step 2: Stems and groups">
        <Steps>
          <li>
            Drag a folder or your audio files onto the page, or click <Ui>Browse files</Ui>. Each stem is named from
            its file name, which you can change.
          </li>
          <li>
            Put them in order by dragging. If your files are numbered (01 Kick, 02 Snare…), they start in that order;
            otherwise drums come first, then bass, guitars, keys and so on.
          </li>
          <li>Give each stem a color. Your band’s saved colors are offered first.</li>
          <li>
            Optionally, make <Ui>groups</Ui>, like Drums or Horns, so the mixer can turn several stems up or down
            together. Then set the order the mixer shows groups and stems in.
          </li>
          <li>Add the sheet music here too, if you have it.</li>
        </Steps>
        <Note>
          <Ui>Normalize stem loudness on upload</Ui> is on to start with. It evens out how loud each stem is. Turn it off
          if your stems come from a finished mix whose balance you want to keep.
        </Note>
        <p>
          With sheet music attached, <Ui>Repeat internal sections after D.C. / D.S.</Ui> decides what happens after a D.C.
          or D.S.: leave it off to play straight through on the way back, as most charts mean; turn it on to take the
          repeats and 1st and 2nd endings again.
        </p>
      </HelpSection>

      <HelpSection title="Step 3: Align">
        <p>
          If a stem starts a little early or late compared with the others, drag it into place, or type how many
          milliseconds to shift it. Select a stem and use the arrow keys to nudge it: <Key>←</Key> <Key>→</Key> move it 1
          ms, add <Key>Shift</Key> for 10 ms or <Key>Alt</Key> for 100 ms. Mute and solo stems to check them. Most songs
          need nothing here.
        </p>
      </HelpSection>

      <HelpSection title="Step 4: Review and save">
        <p>
          Check the summary and click <Ui>Save Song</Ui>. Each stem uploads and is then converted so it streams quickly.
          You’ll see each one go from Uploading to Done.
        </p>
        <Bullets>
          <li>
            <Ui>Keep the page open</Ui> until it says <Ui>Song added!</Ui> If you leave while it’s uploading, the song
            isn’t saved.
          </li>
          <li>If a stem fails, click <Ui>Retry</Ui> next to it. Nothing is saved until every stem is done.</li>
          <li>
            When it’s done, <Ui>Open Song</Ui> takes you to it, or <Ui>Add another song</Ui> starts again.
          </li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Changing a song later">
        <p>Open the song, then <Ui>Songs</Ui> → <Ui>Edit Song</Ui>. You can:</p>
        <Bullets>
          <li>change its title, artist, key, tags and link;</li>
          <li>replace or remove the sheet music;</li>
          <li>rename, recolor, reorder or remove stems, or add one with <Ui>+ Add Stem</Ui>;</li>
          <li>change its groups and mixer order;</li>
          <li>add <Ui>Nav Links</Ui>: links shown above the player while the song is open, like a chart or a recording;</li>
          <li>add up to four YouTube videos, which play in sync with the song.</li>
        </Bullets>
        <p>
          <Ui>Align stems</Ui> at the top reopens the alignment step. To mark the song’s sections and measures or add
          lyrics, see <GuideLink slug="timing-and-lyrics">Timing and lyrics</GuideLink>.
        </p>
        <Note>
          Deleting a song (<Ui>Songs</Ui> → <Ui>Delete Song</Ui>) can’t be undone. Only Managers and the Owner can do it.
        </Note>
      </HelpSection>
    </>
  );
}
