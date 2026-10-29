/**
 * The capability catalog and the role → capability bundles.
 *
 * These constants are the *seed* for the `capability`, `role`, and
 * `role_capability` tables. At runtime the tables are authoritative: Phase 6's
 * `can()` resolves membership → role → capability by query, never by importing
 * this file. That is the whole point of storing them as rows — re-cutting a
 * bundle, or splitting Editor into Editor + Producer, is an INSERT/DELETE with
 * no deploy.
 *
 * The types here exist so route declarations and tests can't typo a
 * capability string.
 */

export const CAPABILITIES = {
  'band.settings': 'Edit band name, colors, logo, links',
  'band.publish': 'Make a band publicly visible',
  'band.transfer': 'Transfer ownership to another member',
  'band.billing': 'Manage the subscription and payment method',
  'band.delete': 'Delete the band and its content',
  'song.create': 'Add a song to the band',
  'song.delete': 'Delete a song',
  'song.read': 'View and play songs',
  'song.audio.write': 'Upload and replace audio stems',
  'song.timing.write': 'Edit tapMap, tempoMap, and markers',
  'song.score.write': 'Upload and replace sheet music',
  'song.content.write': 'Edit lyrics and song metadata',
  'note.create': 'Add timestamp notes to songs, and edit or delete your own',
  'note.moderate': 'Edit or delete anyone’s notes',
  'setlist.write': 'Create, reorder, and delete setlists',
  'audio.download': 'Download original audio files',
  'member.invite': 'Invite people to the band',
  'member.role.set': 'Change roles and remove members',
} as const satisfies Record<string, string>;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

export interface RoleDefinition {
  key: string;
  label: string;
  sortOrder: number;
  /**
   * Whether the role may appear in `membership.role`. `owner` lives in
   * `band.owner_user_id` and `guest` is a grant-link actor kind, so neither
   * gets a membership row.
   */
  membershipEligible: boolean;
  capabilities: readonly Capability[];
}

const MANAGER_CAPABILITIES = [
  'band.settings',
  'song.create',
  'song.delete',
  'song.read',
  'song.audio.write',
  'song.timing.write',
  'song.score.write',
  'song.content.write',
  'setlist.write',
  'audio.download',
  'member.invite',
  'member.role.set',
  'note.create',
  'note.moderate',
] as const satisfies readonly Capability[];

/**
 * Editor deliberately lacks `song.delete` and `song.timing.write` — Phase 6's
 * exit criteria is that an Editor is provably blocked from both.
 */
const EDITOR_CAPABILITIES = [
  'song.create',
  'song.read',
  'song.audio.write',
  'song.score.write',
  'song.content.write',
  'setlist.write',
  'audio.download',
  'note.create',
] as const satisfies readonly Capability[];

export const ROLES: RoleDefinition[] = [
  {
    key: 'owner',
    label: 'Owner',
    sortOrder: 0,
    membershipEligible: false,
    // Everything, including the four the Owner alone holds: publish,
    // transfer, billing, delete.
    capabilities: CAPABILITY_KEYS,
  },
  {
    key: 'manager',
    label: 'Manager',
    sortOrder: 1,
    membershipEligible: true,
    capabilities: MANAGER_CAPABILITIES,
  },
  {
    key: 'editor',
    label: 'Editor',
    sortOrder: 2,
    membershipEligible: true,
    capabilities: EDITOR_CAPABILITIES,
  },
  {
    key: 'member',
    label: 'Member',
    sortOrder: 3,
    membershipEligible: true,
    capabilities: ['song.read', 'audio.download', 'note.create'],
  },
  {
    key: 'guest',
    label: 'Guest',
    sortOrder: 4,
    membershipEligible: false,
    // The floor for a sub's link. An individual grant_link row may narrow
    // this further via its own `capabilities` array.
    capabilities: ['song.read'],
  },
];

/** Roles assignable through an invite or the roster UI. */
export const ASSIGNABLE_ROLES = ROLES.filter((r) => r.membershipEligible);
