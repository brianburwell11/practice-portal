import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Note, Steps, Ui } from '../parts';

export default function Setlists() {
  return (
    <>
      <p>
        A setlist puts songs in order for a gig or a rehearsal. Everyone in the band can play through one; Owners,
        Managers and Editors can make and change them (see{' '}
        <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>).
      </p>

      <HelpSection title="Playing through a setlist">
        <p>
          Pick the setlist from the menu next to the song menu. Its first song loads, and <Ui>Previous</Ui> and{' '}
          <Ui>Next</Ui> step through the rest. The address shows which setlist and which song you’re on, so you can
          send a bandmate straight to song 5 of tonight’s set.
        </p>
      </HelpSection>

      <HelpSection title="Making a setlist">
        <Steps>
          <li>Open the <Ui>Setlists</Ui> menu and choose <Ui>Add Setlist</Ui>.</li>
          <li>
            Give it a <Ui>Setlist Name</Ui>, like Friday Night Gig. Its link is made from the name, and you can change it.
          </li>
          <li>Click songs in the list to add them, then drag them into order.</li>
          <li>
            <Ui>+ Add Set Heading</Ui> splits the list into sets (Set 1, Set 2…). Rename and drag headings like songs.
            Each set shows how long it runs.
          </li>
          <li>Save. You need a name and at least one song.</li>
        </Steps>
      </HelpSection>

      <HelpSection title="Finding the right song">
        <Bullets>
          <li>
            <Ui>Set Length</Ui>: enter how long you’re playing (hours, minutes and seconds), and the setlist shows how much
            time is left, or how far over you are.
          </li>
          <li>
            The filter button sorts songs by title, length or key, and filters them by key, tag or length, including{' '}
            <Ui>Fits remaining</Ui> to show only songs that fit the time you have left.
          </li>
          <li>
            <Ui>Allow duplicates</Ui> decides whether a song can appear twice, like a closer you reprise as an encore.
          </li>
          <li>
            The <Ui>Camelot wheel</Ui> (on larger screens) helps with keys. Pick the key you’re coming from and how you
            want to move, from <Ui>Seamless</Ui> to <Ui>Energy boost</Ui>, and songs in keys that fit are highlighted.
          </li>
        </Bullets>
        <Note>
          A song’s length comes from its audio. Its key and tags come from whoever added it; fill them in with{' '}
          <Ui>Edit Song</Ui> so the filters and the wheel can use them.
        </Note>
      </HelpSection>

      <HelpSection title="Changing setlists">
        <Bullets>
          <li>With a setlist open, <Ui>Setlists</Ui> → <Ui>Edit Setlist</Ui> changes it.</li>
          <li><Ui>Copy Setlist</Ui> starts a new one from it. Give the copy a different name.</li>
          <li><Ui>View All Setlists</Ui> lists every setlist with how long it runs.</li>
          <li>
            <Ui>Delete Setlist</Ui> asks you to type “delete” and its name first. It can’t be undone, but the songs in it aren’t touched.
          </li>
          <li>
            <Ui>Nav Links</Ui> are links shown above the player while the setlist is open, like the venue’s address or
            a shared chart folder.
          </li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Sharing a setlist with a sub">
        <p>
          A sub can play along without an account using the band’s guest link. To send them straight to a setlist:
        </p>
        <Steps>
          <li>
            Make sure the guest link is on: <Ui>Band</Ui> → <Ui>Members &amp; Sharing</Ui> → <Ui>Turn on guest link</Ui>.
          </li>
          <li>Open the setlist, then <Ui>Setlists</Ui> → <Ui>Copy Guest Link</Ui>.</li>
          <li>Send them the link. It opens on that setlist.</li>
        </Steps>
        <p>Owners and Managers can do this. Turning the guest link off, or resetting it, stops every copy of it working.</p>
      </HelpSection>
    </>
  );
}
