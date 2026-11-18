import { contrastHex } from '../../utils/bandTheme';

/**
 * Text for a fill of `hex` (a stem's or the band's color, which can be
 * anything): near-black or white, whichever reads better, and pure black
 * when neither reaches AA but black would do better than both.
 */
export function textOn(hex: string): string {
  const dark = contrastHex('#111827', hex);
  const white = contrastHex('#ffffff', hex);
  if (dark >= white) return '#111827';
  if (white >= 4.5) return '#fff';
  return contrastHex('#000000', hex) > white ? '#000' : '#fff';
}
