import { LegalPage, Mail, Section } from './LegalPage';

const CONTACT = 'legal@practiceportal.app';
const EFFECTIVE = 'October 28, 2026';

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
          <li>If you sign in, it’s with Google, and we receive your name, email address and profile photo — never your password.</li>
          <li>What a band uploads is visible to the people the band shares it with. Read “Who can see band content” below before uploading anything private.</li>
        </ul>
      </Section>

      <Section title="What we collect">
        <p><span className="text-gray-100">When you sign in with Google.</span> Your Google account ID, email address, name and profile photo address. We ask Google only for basic profile access (“openid”, “email” and “profile”); we can’t see your Gmail, Drive, contacts or anything else in your Google account.</p>
        <p><span className="text-gray-100">Band membership.</span> Which bands you belong to, your role in each (Owner, Manager, Editor or Member) and when you joined. If you create an invite link, we keep its role, expiry date and — if you lock it to one person — that person’s email address. If a band turns on its guest link, we keep the link, its expiry date if it has one, and when it was last opened — not who opened it.</p>
        <p><span className="text-gray-100">Requests to join.</span> If you ask to join a Members-only band, we keep your request, the message you wrote (if any), and whether it was approved or declined.</p>
        <p><span className="text-gray-100">What bands add.</span> Audio, sheet music, lyrics, band notes, setlists, song details, YouTube links, and a band’s name, logo, colors and website. We record who added a song, and keep a log of changes — who did what, and when — so a band can see its own history.</p>
        <p><span className="text-gray-100">Server logs.</span> Like most websites, our server records each request it answers: the page or file asked for, the time, and whether it succeeded. Our hosting provider may also record your IP address.</p>
        <p><span className="text-gray-100">Kept only on your device.</span> Personal notes, your mixer settings and a few display preferences are saved in your browser’s storage. They never leave your device and we never see them. Clearing your browser’s site data deletes them.</p>
      </Section>

      <Section title="Cookies">
        <p>We set three cookies, each only after you do something that needs it:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code className="text-gray-100">pp_session</code> keeps you signed in. It lasts 30 days, or until you sign out.</li>
          <li><code className="text-gray-100">pp_oauth</code> exists for up to 10 minutes while you sign in with Google, to make sure the sign-in that comes back is the one you started.</li>
          <li><code className="text-gray-100">pp_guest</code> is set when you open a band’s guest link, so this device can keep playing that band’s songs without an account. It holds the guest links you’ve opened and lasts a year; it stops working for a band as soon as that band resets or turns off its link, and “Leave on this device” removes it.</li>
        </ul>
        <p>None can be read by scripts on the page, and none is used for tracking. When you open a song that has YouTube videos, the embedded YouTube player may set its own cookies under Google’s policies.</p>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc pl-5 space-y-1">
          <li>To sign you in and keep you signed in.</li>
          <li>To show you the bands you belong to and let you do what your role allows.</li>
          <li>To show band members who else is in the band (Owners and Managers see members’ names and email addresses).</li>
          <li>To pass on a request to join: the band’s Owner gets an email with your name, email address and message, and can reply to you directly. Owners and Managers see it in the app too. We email you when the band answers.</li>
          <li>To keep the site running and secure — for example, to investigate errors or misuse.</li>
        </ul>
        <p>We don’t use your information for advertising, and we don’t sell it.</p>
      </Section>

      <Section title="Who can see band content">
        <p>Each band is either <span className="text-gray-100">Public</span> — anyone with the link can view and play it — or <span className="text-gray-100">Members only</span>, which hides it in the app from anyone who isn’t a signed-in member.</p>
        <p className="text-amber-300/90">
          Be aware: today, a band’s uploaded files (audio, sheet music and the band’s song data) are stored at web
          addresses that anyone who has the exact address can open, even for Members-only bands, and those bands
          can also appear on an older copy of the site. We’re working on making those files private too, and will
          update this page when we do. Until then, don’t upload anything you couldn’t accept becoming public.
        </p>
      </Section>

      <Section title="Services we rely on">
        <p>These companies run parts of the site for us and handle data only to provide their service:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="text-gray-100">Fly.io</span> — runs the web server, and holds its logs.</li>
          <li><span className="text-gray-100">Neon</span> — hosts our database (accounts, memberships, band and song data).</li>
          <li><span className="text-gray-100">Cloudflare</span> — stores uploaded files and runs our domain’s DNS.</li>
          <li><span className="text-gray-100">Google</span> — provides “Sign in with Google”, and the YouTube player for songs with videos.</li>
          <li><span className="text-gray-100">Resend</span> — sends the site’s emails, such as requests to join a band and their answers.</li>
        </ul>
        <p>These services store data in the United States.</p>
      </Section>

      <Section title="How long we keep it">
        <ul className="list-disc pl-5 space-y-1">
          <li>Your account and memberships: until you ask us to delete your account.</li>
          <li>Sign-in sessions: 30 days at most; signing out ends yours immediately.</li>
          <li>Invite links: they stop working after 7 days or once used; the record of them stays with the band’s history.</li>
          <li>Guest links: they work until the band resets or turns them off, or until an expiry date the band sets. After that the link itself is erased; a record that it existed stays with the band’s history.</li>
          <li>Requests to join: kept with the band’s history after they’re answered. They’re deleted with your account or the band.</li>
          <li>Band content and its change history: as long as the band keeps it.</li>
          <li>Server logs: kept only briefly by our hosting provider.</li>
        </ul>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc pl-5 space-y-1">
          <li>Sign out at any time from your account menu.</li>
          <li>Leave any band you belong to, unless you’re its Owner — an Owner can hand the band to another member first.</li>
          <li>Remove Practice Portal’s access in your Google account’s security settings.</li>
          <li>Email {mail} to get a copy of the information we hold about you, correct it, or delete your account.</li>
        </ul>
        <p>Deleting your account removes your sign-in, sessions and memberships. Songs and other content you added belong to the band, so they stay with the band unless its Owner or Managers remove them.</p>
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
