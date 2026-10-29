import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Steps, Ui } from '../parts';

export default function StartYourBand() {
  return (
    <>
      <p>
        Practice Portal gives your band one place for its songs: every part as its own track, the sheet music and
        lyrics in sync, and notes from the whole band. Here’s how to get going.
      </p>

      <HelpSection title="1. Create the band">
        <Steps>
          <li>Sign in with Google from the home page.</li>
          <li>Click <Ui>+ Start a band</Ui>.</li>
          <li>
            Give it a <Ui>Name</Ui>. The <Ui>Route</Ui> is filled in from the name: it’s your band’s address, like
            practiceportal.app/your-band. You can change it, as long as no other band has it.
          </li>
          <li>Add a logo and pick colors if you like, then click <Ui>Create Band</Ui>.</li>
        </Steps>
        <p>
          You’re the band’s <Ui>Owner</Ui>. New bands start <Ui>Members only</Ui>, so nobody else can see it until you
          invite them.
        </p>
      </HelpSection>

      <HelpSection title="2. Add your first song">
        <p>
          A new band opens on an empty screen with <Ui>+ Add a song</Ui>. You’ll need the song’s stems: one audio file
          per part (drums, bass, guitar, vocals and so on), all the same length. Sheet music is optional.
        </p>
        <p>
          The <GuideLink slug="adding-songs">Adding and editing songs</GuideLink> guide walks through every step.
        </p>
      </HelpSection>

      <HelpSection title="3. Bring your band in">
        <p>Open the <Ui>Band</Ui> menu, then <Ui>Members &amp; Sharing</Ui>. There are three ways in:</p>
        <Bullets>
          <li>
            <Ui>Invite someone.</Ui> Pick their role and, if you like, their email address, then <Ui>Send invite</Ui>.
            Each link works once and lasts 7 days. With an email address, we email it to them; either way you can copy
            the link and send it yourself.
          </li>
          <li>
            <Ui>Asking to join.</Ui> Anyone signed in who finds your band’s address can ask to join. You get an email,
            and you approve or decline them here.
          </li>
          <li>
            <Ui>Guest link.</Ui> For a sub or anyone who only needs to play along for a while. They don’t need an
            account, and they can’t change anything. You can give it an expiry date, reset it or turn it off.
          </li>
        </Bullets>
        <p>
          Not sure which role to give someone? See <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>.
          Most bandmates are <Ui>Members</Ui>; give <Ui>Editor</Ui> to whoever will add songs.
        </p>
      </HelpSection>

      <HelpSection title="4. Public or Members only">
        <p>
          Under <Ui>Who can see this band</Ui> in Members &amp; Sharing, the Owner can make the band{' '}
          <Ui>Public</Ui>, so anyone with the link can play it without signing in. Only members can ever add notes
          or change anything.
        </p>
      </HelpSection>

      <HelpSection title="Next">
        <Bullets>
          <li><GuideLink slug="practicing-a-song">Practicing a song</GuideLink>: loops, speed, sections and sheet music.</li>
          <li><GuideLink slug="setlists">Setlists and collections</GuideLink>: put songs in order for a gig.</li>
        </Bullets>
      </HelpSection>
    </>
  );
}
