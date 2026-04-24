/** Permissive live-input sanitizer for slug/hash fields. Lowercases,
 *  converts any run of non-alphanumeric chars to a single hyphen, but
 *  leaves leading/trailing hyphens intact so the user can type "my-"
 *  on the way to "my-song". Call `slugify()` at persistence time to
 *  strip the edge hyphens for the final form. */
export function cleanSlugInput(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function slugify(input: string): string {
  return cleanSlugInput(input).replace(/^-|-$/g, '');
}

export function deriveId(title: string, artist: string): string {
  return slugify(`${title}-${artist}`);
}
