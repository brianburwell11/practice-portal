import { Link } from 'react-router-dom';
import { TERMS_EFFECTIVE } from '../../config/legal';
import { LegalPage, Mail, Section } from './LegalPage';

const CONTACT = 'legal@practiceportal.app';

/**
 * /legal/terms. Like the privacy policy, written against what the app does —
 * bands, roles, uploads — and updated when that changes.
 */
export function TermsOfService() {
  const mail = <Mail to={CONTACT} />;
  const privacy = <Link to="/legal/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link>;

  return (
    <LegalPage title="Terms of Service" effective={TERMS_EFFECTIVE}>
      <p>
        These terms cover your use of Practice Portal (<span className="text-gray-100">practiceportal.app</span>), a
        rehearsal tool for bands. By using the site you agree to them. If you don’t agree, please don’t use it.
        Questions go to {mail}.
      </p>

      <Section title="The service">
        <p>Practice Portal lets bands keep stems, sheet music, lyrics, notes and setlists in one place and practice along with them. It’s free to use today. We may add, change or remove features, and we may introduce paid plans — if we do, we’ll say so clearly before anything costs you money.</p>
      </Section>

      <Section title="Who can use it">
        <p>You must be at least 13 to use Practice Portal. If you’re using it on behalf of a band, school or other group, you’re confirming you’re allowed to accept these terms for them.</p>
      </Section>

      <Section title="Your account">
        <p>You sign in with your Google account. Keep it secure — anything done while signed in as you is your responsibility. If you think someone else has used your account, tell us at {mail}.</p>
      </Section>

      <Section title="Bands and roles">
        <p>Each band has an Owner, and may have Managers, Editors and Members. What you can do in a band depends on your role. The Owner and Managers decide who belongs to the band, what role they have, and whether the band is Public or Members only, and they can change or remove the band’s content. The Owner can hand ownership to another member.</p>
        <p>Invite links let anyone who has one join the band with the role it grants, unless it’s locked to one email address. Share them with care.</p>
        <p>A band’s guest link lets anyone who has it play the band’s songs and setlists, read-only and without an account, until the band resets or turns it off. Anyone you give it to can pass it on, so reset it if it reaches people it shouldn’t.</p>
      </Section>

      <Section title="Your content">
        <p>You keep ownership of everything you upload or write — audio, sheet music, lyrics, notes, setlists, images and the rest.</p>
        <p>So that we can run the site, you give us permission to store, copy, convert and display your content, and to make it available to the people your band shares it with. Converting includes things like transcoding audio and turning MuseScore files into MusicXML. This permission is worldwide and free of charge, and lasts only as long as we need it to provide the service — it ends when the content is deleted, apart from copies that briefly remain in backups and logs.</p>
        <p>Content added to a band is the band’s to manage: if you leave a band, what you added stays with it unless its Owner or Managers remove it.</p>
      </Section>

      <Section title="Only upload what you have the rights to">
        <p>Bands often practice songs written and recorded by other people. Before you upload a recording, stems or sheet music, make sure you have the right to — your own work, something you have permission to use, or material whose license allows it. You’re responsible for what you upload.</p>
        <p>Public bands can be seen by anyone with the link, and today uploaded files can be opened by anyone who has their exact web address, even in Members-only bands — see the {privacy}. Don’t upload anything you couldn’t accept becoming public.</p>
      </Section>

      <Section title="Things you must not do">
        <ul className="list-disc pl-5 space-y-1">
          <li>Upload anything illegal, or that infringes someone else’s copyright, trademark, privacy or other rights.</li>
          <li>Harass, threaten or impersonate anyone.</li>
          <li>Upload malware, or anything meant to harm the site or the people using it.</li>
          <li>Try to get into bands, accounts or data you haven’t been given access to, or get around the site’s permissions.</li>
          <li>Overload the site, or scrape it with automated tools.</li>
          <li>Resell the service, or use it to host files for purposes that have nothing to do with practicing music.</li>
        </ul>
      </Section>

      <Section title="Copyright complaints">
        <p>If you believe something on Practice Portal infringes your copyright, email {mail} with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>the work you believe is infringed;</li>
          <li>where it appears on Practice Portal — the band and song, or a link;</li>
          <li>your name and how to contact you;</li>
          <li>a statement that you believe in good faith the use isn’t authorized by you, your agent or the law;</li>
          <li>a statement that your notice is accurate and that, under penalty of perjury, you own the copyright or are authorized to act for the owner; and</li>
          <li>your physical or electronic signature.</li>
        </ul>
        <p>We’ll remove material when we receive a valid notice and let the person who uploaded it know. We’ll end the access of people who repeatedly infringe.</p>
      </Section>

      <Section title="Other services">
        <p>Songs can include YouTube videos, which play under YouTube’s own terms. Bands can link to other websites; we’re not responsible for what’s on them.</p>
      </Section>

      <Section title="Keep your own copies">
        <p>We work to keep the site running and your content safe, but we can’t promise it’ll always be available or that nothing will ever be lost. Practice Portal isn’t a backup — keep the original files of anything that matters to you.</p>
      </Section>

      <Section title="Ending your use">
        <p>You can stop using Practice Portal at any time, leave any band (unless you’re its Owner — hand ownership on first), or ask us to delete your account at {mail}.</p>
        <p>We may suspend or end your access, or remove content, if you break these terms, if we’re required to by law, or to protect the site or the people using it. Where it’s reasonable, we’ll tell you first and give you a chance to put things right.</p>
      </Section>

      <Section title="No warranty">
        <p>Practice Portal is provided “as is” and “as available”. To the fullest extent the law allows, we make no promises about it — including that it will be uninterrupted, error-free or fit for any particular purpose.</p>
      </Section>

      <Section title="Limits on liability">
        <p>To the fullest extent the law allows, Practice Portal won’t be liable for indirect, incidental, special, consequential or punitive damages, or for lost data, profits or revenue, arising from your use of the site. Our total liability for any claim relating to the site is limited to the greater of US$50 or the amount you paid us in the 12 months before the claim. Some places don’t allow these limits, so they may not all apply to you.</p>
      </Section>

      <Section title="If someone makes a claim about your content">
        <p>If someone brings a claim against Practice Portal because of content you uploaded or because you broke these terms, you agree to cover the reasonable costs of dealing with it, to the extent the law allows.</p>
      </Section>

      <Section title="Governing law">
        <p>These terms are governed by the laws of the State of Florida, United States, without regard to its conflict-of-law rules. Any dispute will be handled in the state or federal courts located in Florida, unless the law where you live gives you the right to bring it elsewhere.</p>
      </Section>

      <Section title="Changes to these terms">
        <p>We may update these terms. When we do, we’ll change the date at the top, and for significant changes we’ll also say so on the site. If you keep using Practice Portal after a change takes effect, you’re agreeing to the updated terms.</p>
      </Section>

      <Section title="Privacy">
        <p>How we handle your information is covered by the {privacy}.</p>
      </Section>

      <Section title="Contact">
        <p>Questions, requests and copyright notices: {mail}.</p>
      </Section>
    </LegalPage>
  );
}
