import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Key, Note, Steps, Ui } from '../parts';

export default function UsingTheMixer() {
  return (
    <>
      <p>
        Every song is split into parts, called stems: drums, bass, each guitar, vocals and so on. The mixer gives each
        one its own controls, so you can hear exactly what you want to practice. On a phone, open it with the mixer
        button next to play.
      </p>

      <HelpSection title="A part’s controls">
        <Bullets>
          <li><Ui>Vol</Ui> sets how loud it is, from 0 to 150.</li>
          <li>
            <Ui>Pan</Ui> moves it left or right. Double-click to center it. Stereo parts have no pan; click the colored
            dots next to the name to switch a part between stereo and mono.
          </li>
          <li><Ui>M</Ui> and <Ui>S</Ui> mute and solo it (see below).</li>
          <li>Once you’ve changed a part, a small reset button next to its name puts it back how it was.</li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Mute and solo">
        <p>
          Mute and solo work in two steps, so you can set up a mix and switch it on and off in one press.
        </p>
        <Steps>
          <li>
            Click <Ui>M</Ui> or <Ui>S</Ui> on the parts you want. Their buttons get a red (mute) or yellow (solo)
            outline. They’re <em>chosen</em>, but nothing changes yet.
          </li>
          <li>
            Click the big <Ui>M</Ui> or <Ui>S</Ui> at the top of the mixer, or press <Key>M</Key> or <Key>S</Key>. The
            chosen parts are now muted or soloed, and their buttons fill in.
          </li>
          <li>Press it again to switch them back, without losing which parts you chose.</li>
        </Steps>
        <p>
          To start over, press and hold the big button, <Key>Shift</Key>+click it, or press <Key>Shift</Key>+
          <Key>M</Key> or <Key>Shift</Key>+<Key>S</Key>.
        </p>
        <Note>
          Try it: choose the vocals with <Ui>M</Ui>, then press <Key>M</Key> to sing along, and press it again to check
          yourself against the record.
        </Note>
      </HelpSection>

      <HelpSection title="Groups">
        <p>
          Some songs put parts together in groups, like Drums or Horns. A group has its own volume, mute and solo for
          everything in it, and the arrow beside its name opens it to show each part. If only some of a group’s parts
          are muted or soloed, its button is half filled.
        </p>
      </HelpSection>

      <HelpSection title="What’s remembered">
        <p>
          Your mix for each song is saved in this browser: every part’s volume, pan, mute, solo and stereo setting, the
          groups, and the overall volume. Open the song tomorrow and it sounds the way you left it. It doesn’t follow
          you to another device or browser, and speed always starts at 100%.
        </p>
        <p>
          To go back to the song’s starting mix, use the reset button at the top of the mixer (on a phone,{' '}
          <Ui>Reset mixer to default settings</Ui>).
        </p>
      </HelpSection>

      <HelpSection title="Changing the starting mix for everyone">
        <p>
          The save button at the top of the mixer makes your current mix the song’s starting point for the whole band.
          It waits three seconds first, so click it again to cancel. Owners, Managers and Editors have it; see{' '}
          <GuideLink slug="roles-and-permissions">Roles and permissions</GuideLink>.
        </p>
      </HelpSection>
    </>
  );
}
