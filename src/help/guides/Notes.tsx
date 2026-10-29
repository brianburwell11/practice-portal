import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Key, Note, Ui } from '../parts';

export default function Notes() {
  return (
    <>
      <p>
        Notes are sticky notes pinned to a moment in a song: “watch the horns here”, “we cut this repeat”, “breathe
        before the bridge”. Everyone who can see the song sees every note, and who wrote it.
      </p>

      <HelpSection title="Adding a note">
        <Bullets>
          <li>
            Press <Key>N</Key>, or click the note button at the left of the notes row. The note goes wherever the song is
            right now, so it’s easiest while playing or paused at the right spot.
          </li>
          <li>
            Type the note and press <Key>Enter</Key> or click <Ui>Save</Ui>. Until then it says <Ui>Unsaved</Ui> and only
            you can see it.
          </li>
        </Bullets>
        <p>
          Anyone in the band can add notes. Guests and people who aren’t signed in can read them but not add them.
        </p>
      </HelpSection>

      <HelpSection title="Seeing notes">
        <Bullets>
          <li>
            A note pops up 3 seconds before its moment and stays until 2 seconds after, so you have time to read it.
          </li>
          <li>The picture in its bottom-right corner shows who wrote it. Hover over it to see their name.</li>
          <li>Every note is also a yellow dot along the bottom of the waveform. Hover for a preview, or click to jump there.</li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Changing or deleting a note">
        <Bullets>
          <li>Click the text of your note to edit it, then save.</li>
          <li>Click its time to type a new one, or drag its dot along the waveform.</li>
          <li>The × deletes it. You get a few seconds to <Ui>Undo</Ui>.</li>
        </Bullets>
        <p>
          You can always change or delete your own notes. Managers and the Owner can change or delete anyone’s. Notes
          you can’t change show without the × and can’t be edited; see{' '}
          <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>.
        </p>
      </HelpSection>

      <HelpSection title="Downloading a song’s notes">
        <p>
          <Ui>Export .txt</Ui> at the end of the notes row downloads every note on the song as a text file, one per line
          with its time. Owners, Managers and Editors have it.
        </p>
        <Note>Hiding notes for a while? The minimize button at the end of the row tucks them away.</Note>
      </HelpSection>
    </>
  );
}
