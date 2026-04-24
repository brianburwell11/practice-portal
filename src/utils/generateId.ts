const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random base62 id. Default 7 chars gives 62^7 \u2248 3.5T combinations \u2014
 *  plenty for opaque song / setlist ids. */
export function generateId(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateUniqueId(existingIds: Set<string>, length = 7): string {
  for (let i = 0; i < 16; i++) {
    const candidate = generateId(length);
    if (!existingIds.has(candidate)) return candidate;
  }
  return generateId(length);
}

/** Regex for the new opaque-id format. Used to distinguish legacy
 *  slug-shaped ids from new random ones during rename handling. */
export const OPAQUE_ID_RE = /^[A-Za-z0-9]{6,8}$/;
