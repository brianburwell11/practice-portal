/**
 * Collections are a band's song tags, offered in the player's dropdown and
 * opened with `?tag=`. Shared by the player and the server's link previews.
 */

/** Tags are stored lowercase: "horn features" shows as "Horn features". */
export function collectionLabel(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}
