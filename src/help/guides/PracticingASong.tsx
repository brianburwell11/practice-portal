import { HelpSection } from '../HelpLayout';
import { Bullets, GuideLink, Key, Note, Steps, Ui } from '../parts';

export default function PracticingASong() {
  return (
    <>
      <p>
        Everything you need to work through a song: playing it, looping the hard part, slowing it down and jumping
        around. For turning parts up and down, see <GuideLink slug="using-the-mixer">Using the mixer</GuideLink>.
      </p>

      <HelpSection title="Picking a song">
        <p>
          Choose a song from the menu at the top of the band’s page. The menu beside it switches between{' '}
          <Ui>All Songs</Ui>, a setlist and a collection (see{' '}
          <GuideLink slug="setlists">Setlists and collections</GuideLink>). In a setlist, <Ui>Previous</Ui> and{' '}
          <Ui>Next</Ui> step through its songs in order.
        </p>
        <p>
          The address in your browser always points at what you’re playing, so you can copy it and send it to a
          bandmate. Your browser’s back and forward buttons move between songs.
        </p>
      </HelpSection>

      <HelpSection title="Playing">
        <Bullets>
          <li>
            Play and pause with the ▶ button or <Key>Space</Key>. ■ stops and goes back to the start. On a phone, there’s
            no stop button: press and hold play instead.
          </li>
          <li>Click anywhere on the waveform to jump there.</li>
          <li>
            While a song loads, a bar shows how many of its parts are ready. It plays once they’re all in.
          </li>
        </Bullets>
        <Note>
          No sound on an iPhone or iPad? Check that the silent switch is off. See the{' '}
          <GuideLink slug="faq">FAQ</GuideLink> for more.
        </Note>
      </HelpSection>

      <HelpSection title="Looping a section">
        <p>
          The quickest way: drag across the part you want on the waveform. On a phone or tablet, press and hold on the
          waveform for a moment, then drag. The ends snap to nearby sections and bar lines, and more gently to beats
          if the song’s timing is marked. To put an end between beats, zoom in, or hold <Key>Alt</Key> (<Key>Option</Key>
          on a Mac) while you drag. The loop turns on, and playback jumps to its start if it was somewhere else. <Key>Esc</Key> cancels a drag partway through.
        </p>
        <p>The loop button (↻) works in steps:</p>
        <Steps>
          <li>Click it where the loop should start.</li>
          <li>Click it again where the loop should end. The loop turns on.</li>
          <li>After that, each click turns the loop off and on again.</li>
        </Steps>
        <p>
          To clear the loop, press and hold the button, or <Key>Shift</Key>+click it. You can also drag the loop’s ends
          on the waveform to fine-tune them. The keyboard does the same: <Key>[</Key> sets the start, <Key>]</Key> the end,{' '}
          <Key>\</Key> or <Key>c</Key> turns it on and off, and <Key>Shift</Key>+<Key>\</Key> clears it.
        </p>
      </HelpSection>

      <HelpSection title="Slowing it down">
        <p>
          The <Ui>Speed</Ui> slider goes from 25% to 150% in steps of 5%. The pitch stays the same, so a slowed-down
          song is still in the right key. Double-click the slider to go back to 100%, or click the percentage to type
          one. <Ui>Vol</Ui> beside it sets the overall volume the same way.
        </p>
        <p>Speed starts at 100% each time you open a song.</p>
      </HelpSection>

      <HelpSection title="Jumping to a spot">
        <Bullets>
          <li>
            <Ui>By time:</Ui> click the time display, type the minutes and seconds as digits (130 for 1:30), and press{' '}
            <Key>Enter</Key>.
          </li>
          <li>
            <Ui>By measure:</Ui> if the song has its timing marked, the measure and beat numbers show next to the
            time. Click either one and type where to go.
          </li>
          <li>
            <Ui>By section:</Ui> choose from <Ui>Jump to Section</Ui>.
          </li>
        </Bullets>
        <p>
          On a phone, these are behind the bookmark button. Jumping by time, measure or section pauses the song, so
          press play when you’re ready.
        </p>
      </HelpSection>

      <HelpSection title="The waveform">
        <Bullets>
          <li>
            Zoom in and out with <Key>Ctrl</Key> or <Key>⌘</Key> and your scroll wheel, or pinch on a trackpad or
            phone. Phones also have zoom buttons and a strip showing the whole song.
          </li>
          <li>
            When you’re zoomed in, a strip under the waveform shows the whole song, with a box around the part in view.
            Drag the box to move along, or click the strip to jump there.
          </li>
          <li>
            <Key>Shift</Key> and scroll moves left and right. On a computer, <Key>Alt</Key>+drag (<Key>Option</Key> on a
            Mac) moves the view too, since a plain drag sets a loop. On a phone, drag with one finger.
          </li>
          <li>
            The view follows the playhead as the song plays. Moving the view yourself stops that; press{' '}
            <Key>`</Key> to turn following back on.
          </li>
          <li>Yellow dots along the bottom are notes. Click one to jump to it.</li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Sheet music">
        <p>If a song has sheet music, it scrolls along with the song on a computer. It isn’t shown on phones yet.</p>
        <Bullets>
          <li>Click a measure to jump there.</li>
          <li>
            <Ui>parts</Ui> picks which instruments to show. Tick the ones you want and click <Ui>apply</Ui>. At least
            one has to stay.
          </li>
          <li>
            The gear button sets how it scrolls, the spacing, whether the playhead shows, and the zoom (60% to 150%).
          </li>
          <li>If you scroll the music yourself, it stops following until the song catches up.</li>
        </Bullets>
        <p>Your choice of parts and these settings are remembered on this device.</p>
      </HelpSection>

      <HelpSection title="Lyrics, chords and videos">
        <Bullets>
          <li>
            Lyrics scroll in time with the song. Click a line to jump there. On a phone they start open; the lyrics
            button hides or shows them, and your phone remembers which you chose.
          </li>
          <li>
            If a song has chords, they scroll in from the right just above the lyrics, and each one takes over as it
            sounds. On a computer the current chord lines up with the current lyric. Click a chord to play from there;
            the <Ui>10s</Ui> button sets how far ahead you see. Section names run along the top of the chords, and
            clicking one plays from that section. On a phone the chords button (next to the lyrics
            button) hides or shows them.
          </li>
          <li>
            Some songs have YouTube videos. They play in a small window that stays in sync with the song, and start
            muted. Drag the window wherever you like.
          </li>
        </Bullets>
      </HelpSection>

      <HelpSection title="Making room">
        <p>
          Sheet music, the mixer, lyrics, chords, notes and videos each have a minimize button. On a computer, minimized
          panels wait in a strip at the bottom; click one to bring it back.
        </p>
      </HelpSection>
    </>
  );
}
