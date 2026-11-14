/**
 * A stem's URL, as the player fetches it. `?v=` is the file's content
 * version (`mediaVersions`): the offline cache keeps a stem under it, and a
 * replaced stem gets a new one. The offline downloader (`src/offline/pin.ts`)
 * must ask for exactly this URL, or the player won't find what it kept.
 */
export function stemUrl(basePath: string, file: string, mediaVersions?: Record<string, string>): string {
  const version = mediaVersions?.[file];
  return `${basePath}/${encodeURIComponent(file)}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}
