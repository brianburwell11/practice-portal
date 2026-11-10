import { contrastHex } from '../../utils/bandTheme';

/** Black or white text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  return contrastHex('#111827', hex) >= contrastHex('#ffffff', hex) ? '#111827' : '#fff';
}
