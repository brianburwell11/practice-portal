import { LegalPage, Mail, Section } from './LegalPage';

const CONTACT = 'legal@practiceportal.app';
const EFFECTIVE = 'October 30, 2026';

/**
 * /legal/privacy. Written against what the app actually does — when that
 * changes (new providers, analytics, private media), this page changes too.
 */
export function PrivacyPolicy() {
  const mail = <Mail to={CONTACT} />;

  return (
    <LegalPage title="Privacy Policy" effective={EFFECTIVE}>
      <p>
        Practice Portal (<span className="text-gray-100">practiceportal.app</span>) is a rehearsal tool for bands:
        stems, sheet music, lyrics and setlists in one place. This page explains what information the site
        handles, why, and what you can do about it. Questions go to {mail}.
      </p>

      <Section title="The short version">
        <ul className="list-disc pl-5 space-y-1">
          <li>You can use public bands without an account. We don’t run ads, analytics or tracking scripts, and we don’t sell or share your information for marketing.</li>
          <li>If you sign in, it’s with Google, and we receive your name, email address and profile photo, never your password.</li>
          <li>What a band uploads is visible to the people the band shares it with. Read “Who can see band content” below before uploading anything private.</li>
        </ul>
      </Section>

      <Section title="What we collect">
        <p><span className="text-gray-100">When you sign in with Google.</span> Your Google account ID, email address, name and profile photo address. We ask Google only for basic profile access (“openid”, “email” and “profile”); we can’t see your Gmail, Drive, contacts or anything else in your Google account.</p>
        <p><span className="text-gray-100">Band membership.</span> Which bands you belong to, your role in each (Owner, Manager, Editor or Member) and when you joined. If you create an invite link, we keep its role, expiry date and, if you lock it to one person, that person’s email address, and we email them the link on your behalf. If a band turns on its guest link, we keep the link, its expiry date if it has one, and when it was last opened, but not who opened it.</p>
        <p><span className="text-gray-100">Agreeing to the terms.</span> When you sign up, we record which version of the Terms of Service you agreed to, and when.</p>
        <p><span className="text-gray-100">Requests to join.</span> If you ask to join a Members-only band, we keep your request, the message you wrote (if any), and whether it was approved or declined.</p>
        <p><span className="text-gray-100">What bands add.</span> Audio, sheet music, lyrics, notes on songs, setlists, song details, YouTube links, and a band’s name, logo, colors and website. We record who added a song and who wrote each note, and keep a log of changes (who did what, and when) so a band can see its own history.</p>
        <p><span className="text-gray-100">Server logs.</span> Like most websites, our server records each request it answers: the page or file asked for, the time, and whether it succeeded. Our hosting provider may also record your IP address.</p>
        <p><span className="text-gray-100">Email opt-outs.</span> If you use “Don’t email me again” in one of our emails, we keep your email address on a list so we never email it again.</p>
        <p><span className="text-gray-100">Kept only on your device.</span> Your mixer settings and a few display preferences are saved in your browser’s storage. They never leave your device and we never see them. Clearing your browser’s site data deletes them.</p>
      </Section>

      <Section title="Cookies">
        <p>We set three cookies, each only after you do something that needs it:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code className="text-gray-100">pp_session</code> keeps you signed in. It lasts 30 days, or until you sign out.</li>
          <li><code className="text-gray-100">pp_oauth</code> exists for up to 10 minutes while you sign in with Google, to make sure the sign-in that comes back is the one you started.</li>
          <li><code className="text-gray-100">pp_guest</code> is set when you open a band’s guest link, so this device can keep playing that band’s songs without an account. It holds the guest links you’ve opened and lasts a year; it stops working for a band as soon as that band resets or turns off its link, and “Leave on this device” removes it.</li>
        </ul>
        <p>None can be read by scripts on the page, and none is used for tracking.</p>
        <p><span className="text-gray-100">YouTube.</span> Songs with videos show YouTube’s privacy-enhanced player (youtube-nocookie.com). Opening the song sends Google your IP address and browser details so the player can load; once you play a video, YouTube may set cookies and track that viewing over time and across sites, under Google’s policies. No other third party tracks you here.</p>
        <p><span className="text-gray-100">Do Not Track.</span> We don’t track you across sites, so there’s nothing for a Do Not Track signal to turn off; the site works the same either way.</p>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc pl-5 space-y-1">
          <li>To sign you in and keep you signed in.</li>
          <li>To show you the bands you belong to and let you do what your role allows.</li>
          <li>To show band members who else is in the band (Owners and Managers see members’ names and email addresses).</li>
          <li>To show who wrote each note on a song: everyone who can see the song sees the name and profile photo of whoever added each of its notes, but never their email address.</li>
          <li>To pass on a request to join: the band’s Owner gets an email with your name, email address and message, and can reply to you directly. Owners and Managers see it in the app too. We email you when the band answers.</li>
          <li>To keep the site running and secure, for example to investigate errors or misuse.</li>
        </ul>
        <p>We don’t use your information for advertising, and we don’t sell it.</p>
      </Section>

      <Section title="Who can see band content">
        <p>Each band is either <span className="text-gray-100">Public</span>, which anyone with the link can view and play, or <span className="text-gray-100">Members only</span>, which only its members and people holding its guest link can open.</p>
        <p>
          A band’s files (audio, sheet music and its song data) are kept in private storage. Each time you open one, we
          check that you may see the band, then give your browser a link to that file which stops working within 12
          hours. A band’s name and logo are the exception: anyone with the band’s address sees them, so they can be
          shown on the sign-in and request-to-join pages.
        </p>
      </Section>

      <Section title="Services we rely on">
        <p>These companies run parts of the site for us and handle data only to provide their service:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-gray-100">Fly.io</span>: runs the web server, and holds its logs.</li>
          <li><span className="text-gray-100">Neon</span>: hosts our database (accounts, memberships, band and song data).</li>
          <li><span className="text-gray-100">Cloudflare</span>: stores uploaded files and runs our domain’s DNS.</li>
          <li><span className="text-gray-100">Google</span>: provides “Sign in with Google”, and the YouTube player for songs with videos.</li>
          <li><span className="text-gray-100">Resend</span>: sends the site’s emails, such as invites and requests to join a band and their answers.</li>
        </ul>
        <p>These services store data in the United States.</p>
      </Section>

      <Section title="How long we keep it">
        <ul className="list-disc pl-5 space-y-1">
          <li>Your account and memberships: until you delete your account.</li>
          <li>Sign-in sessions: 30 days at most; signing out ends yours immediately.</li>
          <li>Invite links: they stop working after 7 days or once used; the record of them stays with the band’s history.</li>
          <li>Guest links: they work until the band resets or turns them off, or until an expiry date the band sets. After that the link itself is erased; a record that it existed stays with the band’s history.</li>
          <li>Requests to join: kept with the band’s history after they’re answered. They’re deleted with your account or the band.</li>
          <li>Band content and its change history: as long as the band keeps it.</li>
          <li>Server logs: kept only briefly by our hosting provider.</li>
          <li>Backups: our database provider keeps backups for a limited time, so deleted information can remain in a backup until it ages out.</li>
        </ul>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc pl-5 space-y-1">
          <li>Sign out at any time from your account menu.</li>
          <li>Leave any band you belong to from your account menu, unless you’re its Owner. An Owner can hand the band to another member first.</li>
          <li>Download a copy of the information we hold about you, or delete your account, on your <span className="text-gray-100">Account</span> page (choose Account settings in your account menu).</li>
          <li>Remove Practice Portal’s access in your Google account’s security settings.</li>
          <li>Email {mail} to correct your information, or with any other request about it.</li>
        </ul>
        <p>
          Deleting your account removes your name, email address, profile photo and Google account ID, your sessions,
          memberships, saved song settings and requests to join, and your email address from invites. What’s left is
          an anonymous record that keeps the bands’ change history consistent; it can’t be linked back to you. Songs
          and notes you added belong to the band, so they stay with it, and your notes show as written by a band
          member. If you asked us never to email you, we keep that address on our do-not-email list so we can keep
          that promise. If you own a band, hand it to another member or delete it first.
        </p>
      </Section>

      <Section title="Security">
        <p>The site is served only over HTTPS. Sign-in sessions and invite links are stored only as one-way hashes. A band’s guest link is stored as-is so its Owners and Managers can copy it again; it gives read-only access, which the band can end at any time. Every change is checked against the person’s role in the band. No system is perfectly secure, but we take reasonable steps to protect what you share with us.</p>
      </Section>

      <Section title="Children">
        <p>Practice Portal isn’t meant for children under 13, and we don’t knowingly collect information from them. If you think a child has signed up, email {mail} and we’ll delete the account.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>When we change how we handle information, we’ll update this page and the date at the top. For significant changes, we’ll also say so on the site.</p>
      </Section>

      <Section title="Contact">
        <p>Questions or requests: {mail}.</p>
      </Section>
    </LegalPage>
  );
}
