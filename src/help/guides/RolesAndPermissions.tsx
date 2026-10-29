import { Link } from 'react-router-dom';
import { ROLES, type Capability } from '../../config/capabilities';
import { HelpSection } from '../HelpLayout';

/**
 * What each row of the table needs. Ticks come from the same role bundles
 * the server enforces (src/config/capabilities.ts), so the table can't
 * promise something a role can't actually do.
 */
const ROWS: { group: string; items: { label: string; capability: Capability }[] }[] = [
  {
    group: 'Practicing',
    items: [
      { label: 'Play songs, use the mixer, and follow the sheet music and lyrics', capability: 'song.read' },
      { label: 'See everyone’s notes on songs', capability: 'song.read' },
      { label: 'Add notes, and edit or delete your own', capability: 'note.create' },
      { label: 'Edit or delete anyone’s notes', capability: 'note.moderate' },
    ],
  },
  {
    group: 'Songs and setlists',
    items: [
      { label: 'Add songs', capability: 'song.create' },
      { label: 'Edit song details and lyrics', capability: 'song.content.write' },
      { label: 'Upload or replace audio, and save the mixer’s default levels', capability: 'song.audio.write' },
      { label: 'Upload or replace sheet music', capability: 'song.score.write' },
      { label: 'Edit a song’s timing (its tap map and sections)', capability: 'song.timing.write' },
      { label: 'Delete songs', capability: 'song.delete' },
      { label: 'Create, edit and delete setlists', capability: 'setlist.write' },
    ],
  },
  {
    group: 'People',
    items: [
      { label: 'Invite people, answer requests to join, and share the guest link', capability: 'member.invite' },
      { label: 'Change people’s roles and remove members', capability: 'member.role.set' },
    ],
  },
  {
    group: 'The band',
    items: [
      { label: 'Edit the band’s name, colors, logo and website', capability: 'band.settings' },
      { label: 'Make the band Public or Members only', capability: 'band.publish' },
      { label: 'Hand the band over to another member', capability: 'band.transfer' },
      { label: 'Delete the band', capability: 'band.delete' },
    ],
  },
];

const COLUMNS = ['owner', 'manager', 'editor', 'member', 'guest'] as const;
const roleOf = (key: string) => ROLES.find((r) => r.key === key)!;
const has = (role: string, capability: Capability) => roleOf(role).capabilities.includes(capability);

function Role({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-white/[0.03] p-4 space-y-1">
      <h3 className="font-semibold text-gray-100">{name}</h3>
      <div className="text-sm text-gray-400 space-y-2">{children}</div>
    </div>
  );
}

export default function RolesAndPermissions() {
  return (
    <>
      <p>
        Everyone in a band has a role, and the role decides what they can do there. There are four roles for
        members (Owner, Manager, Editor and Member), plus Guest for people who use the band’s guest link
        without joining. Someone can have a different role in each band they’re in.
      </p>

      <HelpSection title="The roles">
        <div className="space-y-3">
          <Role name="Owner">
            <p>
              Whoever created the band, or had it handed over to them. Each band has exactly one. The Owner can do
              everything, including four things only they can do: make the band Public or Members only, hand the
              band over to another member, delete the band, and (when we add paid plans) manage billing.
            </p>
            <p>Nobody can remove the Owner or change their role. Ownership only moves when the Owner hands it over, and they stay on as a Manager.</p>
          </Role>
          <Role name="Manager">
            <p>
              The band’s admins, who run things day to day. Managers can do everything the Owner can except the
              Owner-only actions above: invite people, answer requests to join, change roles and remove members,
              edit the band’s settings, and edit or delete anyone’s notes.
            </p>
            <p>A Manager can make someone a Manager, but not an Owner.</p>
          </Role>
          <Role name="Editor">
            <p>
              The people who build the band’s library. Editors add songs, upload audio and sheet music, edit song
              details and lyrics, and manage setlists.
            </p>
            <p>Editors can’t delete songs, change a song’s timing, or invite people.</p>
          </Role>
          <Role name="Member">
            <p>
              Everyone else in the band. Members can play every song and add their own notes, which the whole band
              sees. They can edit or delete their own notes, but not anyone else’s.
            </p>
          </Role>
          <Role name="Guest">
            <p>
              Someone using the band’s guest link, like a sub filling in for a gig. Guests don’t need an account. They
              can play the band’s songs and see its notes, but they can’t add notes or change anything.
            </p>
            <p>
              The guest link works until an Owner or Manager resets it, turns it off, or the expiry date they set
              passes.
            </p>
          </Role>
        </div>
      </HelpSection>

      <HelpSection title="Who can do what">
        <p className="text-sm text-gray-500 sm:hidden">Scroll the table sideways to see every role.</p>
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">What each role can do in a band</caption>
            <thead>
              <tr className="bg-gray-900">
                <th scope="col" className="sticky left-0 bg-gray-900 text-left font-semibold text-gray-200 px-3 py-2 min-w-[9.5rem] sm:min-w-[14rem]">
                  Action
                </th>
                {COLUMNS.map((key) => (
                  <th key={key} scope="col" className="px-2 sm:px-3 py-2 font-semibold text-gray-200 text-center whitespace-nowrap">
                    {roleOf(key).label}
                  </th>
                ))}
              </tr>
            </thead>
            {ROWS.map(({ group, items }) => (
              <tbody key={group}>
                <tr>
                  <th colSpan={COLUMNS.length + 1} scope="colgroup" className="sticky left-0 bg-page text-left text-xs uppercase tracking-wide text-gray-500 px-3 pt-4 pb-1">
                    {group}
                  </th>
                </tr>
                {items.map(({ label, capability }) => (
                  <tr key={label} className="border-t border-gray-800">
                    <th scope="row" className="sticky left-0 bg-page text-left font-normal text-gray-300 px-3 py-2 text-[13px] sm:text-sm">
                      {label}
                    </th>
                    {COLUMNS.map((role) => (
                      <td key={role} className="px-2 sm:px-3 py-2 text-center">
                        {has(role, capability) ? (
                          <span className="text-green-400" aria-label="Yes">✓</span>
                        ) : (
                          <span className="text-gray-700" aria-label="No">–</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="text-sm text-gray-500">
          Only the Owner and Managers can see who’s in the band and their email addresses. Everyone who can see a
          song sees who wrote each of its notes, by name and picture.
        </p>
      </HelpSection>

      <HelpSection title="Public and Members-only bands">
        <p>
          A <span className="text-gray-100">Members only</span> band is hidden from everyone except its members and
          anyone holding its guest link. New bands start this way.
        </p>
        <p>
          A <span className="text-gray-100">Public</span> band can be played by anyone with the link, signed in or
          not, the same way a Guest plays it. Only members can add notes or change anything. The Owner chooses
          between the two in Band → Members &amp; Sharing.
        </p>
      </HelpSection>

      <HelpSection title="Giving someone access">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="text-gray-100">Invite them.</span> In Band → Members &amp; Sharing, an Owner or Manager
            picks a role and sends an invite. The link works once and expires after 7 days.
          </li>
          <li>
            <span className="text-gray-100">Answer their request.</span> Anyone signed in who finds a Members-only band
            can ask to join. The Owner gets an email, and the Owner or a Manager approves or declines it in Members &amp;
            Sharing. Approved requests join as Members.
          </li>
          <li>
            <span className="text-gray-100">Share the guest link.</span> For someone who only needs to play along for
            a while, turn on the guest link in Members &amp; Sharing and send it to them. You can set it to expire.
          </li>
          <li>
            <span className="text-gray-100">Change their role later.</span> An Owner or Manager can change anyone’s
            role except the Owner’s, or remove them, from the list of members.
          </li>
        </ul>
        <p className="text-sm text-gray-500">
          New to Practice Portal? <Link to="/" className="text-blue-400 hover:text-blue-300">Start a band</Link> and
          you’ll be its Owner.
        </p>
      </HelpSection>
    </>
  );
}
