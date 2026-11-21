import { toast } from '../store/dialogStore';

/**
 * Copy the band's guest link, opening on `setlistSlug`. The link is the band's
 * one "anyone with the link" link, so this only works once it's turned on.
 */
export async function copyGuestLink(bandId: string, setlistSlug: string): Promise<void> {
  try {
    const res = await fetch(`/api/bands/${encodeURIComponent(bandId)}/guest-link`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    if (!data.link) {
      toast('The guest link is off. Turn it on in Band → Members & Sharing first.');
      return;
    }
    // The link already carries `?guest=`.
    await navigator.clipboard.writeText(`${data.link.url}&setlist=${encodeURIComponent(setlistSlug)}`);
    toast(data.link.expired
      ? 'Copied, but the guest link has expired. Change its expiry in Members & Sharing.'
      : 'Guest link to this setlist copied. Anyone with it can play the band’s songs.');
  } catch (err) {
    toast(`Couldn’t copy the guest link: ${(err as Error).message}`, 'error');
  }
}
