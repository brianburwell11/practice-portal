import { HelpSection } from '../HelpLayout';
import { GuideLink, Question, Ui } from '../parts';

const SUPPORT = 'support@practiceportal.app';

export default function Faq() {
  return (
    <>
      <HelpSection title="Playing">
        <Question q="I can’t hear anything on my iPhone or iPad.">
          <p>
            Check the silent switch on the side. When it’s on, iPhones and iPads mute sound from websites, even with the
            volume up. Also check the band’s <Ui>Vol</Ui> slider, and that no parts are muted or soloed in the mixer.
          </p>
        </Question>
        <Question q="A song is stuck on “Loading”.">
          <p>
            A song loads all of its parts before it plays, so a song with many parts takes a moment on a slow
            connection. If it doesn’t finish, or says it couldn’t load, check your connection and use{' '}
            <Ui>Try again</Ui> or reload the page.
          </p>
        </Question>
        <Question q="Why can’t I see the sheet music on my phone?">
          <p>Sheet music only shows on a computer or a larger tablet for now. Lyrics, notes and the mixer all work on a phone.</p>
        </Question>
        <Question q="My mix didn’t come with me to my other device.">
          <p>
            Your mixer settings are saved in the browser you set them in, so each device and browser has its own. See{' '}
            <GuideLink slug="using-the-mixer">Using the mixer</GuideLink>.
          </p>
        </Question>
        <Question q="Some parts are silent even though I didn’t mute them.">
          <p>
            Something is probably soloed: when any part is soloed, only soloed parts play. Press <Ui>Shift+S</Ui>, or
            press and hold the big <Ui>S</Ui> at the top of the mixer, to clear it.
          </p>
        </Question>
      </HelpSection>

      <HelpSection title="Bands and access">
        <Question q="I can’t see my band.">
          <p>
            Most bands are Members only, so you need to be signed in with the Google account you were invited with. If
            you’re signed in and still can’t see it, ask to join from the band’s page, or ask someone in the band to
            invite you.
          </p>
        </Question>
        <Question q="Why can’t I add a note, or edit a song?">
          <p>
            It depends on your role in the band. Guests and people who aren’t signed in can play songs and read notes,
            but not add them. See <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink> for who can do
            what, and ask a Manager or the Owner if you need more.
          </p>
        </Question>
        <Question q="My invite link doesn’t work.">
          <p>
            Invite links work once and last 7 days, and some only work for one email address. Ask whoever sent it for a
            new one.
          </p>
        </Question>
        <Question q="How do I give a sub access for one gig?">
          <p>
            Use the band’s guest link, with an expiry date. The <GuideLink slug="setlists">Setlists and collections</GuideLink> guide shows how
            to send them straight to a setlist.
          </p>
        </Question>
        <Question q="How do I leave a band, or hand it to someone else?">
          <p>
            To leave, open the band, click your picture at the top right and choose <Ui>Leave this band</Ui>. An Owner
            can’t leave, but can hand the band to another member in <Ui>Members &amp; Sharing</Ui> and stays on as a
            Manager. To delete your account, or download what we hold about you, choose <Ui>Account settings</Ui> in the
            same menu. If you own a band, hand it on or delete it first.
          </p>
        </Question>
      </HelpSection>

      <HelpSection title="Songs">
        <Question q="What audio files can I upload?">
          <p>
            WAV, MP3, OGG, Opus, FLAC, AIFF and M4A, up to 32 parts per song and 1 GB each. More in{' '}
            <GuideLink slug="adding-songs">Adding and editing songs</GuideLink>.
          </p>
        </Question>
        <Question q="I uploaded a new logo but still see the old one.">
          <p>Reload the page. If you replaced it a while ago and still see the old one, email us.</p>
        </Question>
      </HelpSection>

      <HelpSection title="Still stuck?">
        <p>
          Email <a href={`mailto:${SUPPORT}`} className="text-blue-400 hover:text-blue-300">{SUPPORT}</a> and tell us what
          you were doing and what you saw. A screenshot helps.
        </p>
      </HelpSection>
    </>
  );
}
