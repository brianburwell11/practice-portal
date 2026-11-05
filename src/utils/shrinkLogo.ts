/**
 * Band logos show at most 80px tall (the request-access page; 32-40px in
 * the header), so anything much bigger is wasted download on every page
 * load. These limits keep a logo sharp on 3x phone screens.
 */
export const LOGO_MAX_HEIGHT = 240;
export const LOGO_MAX_WIDTH = 1200;

/** The size `width`×`height` scales down to so it fits within the box,
 *  keeping its shape. Never scales up. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Shrink a PNG or JPG logo in the browser before upload, so a 4000px
 * export doesn't get served to every visitor. SVGs (they scale anyway),
 * images already small enough, and anything that can't be decoded are
 * returned unchanged. PNGs stay PNG so transparency survives.
 */
export async function shrinkLogo(file: File): Promise<File> {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (!isPng && !isJpg) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const target = fitWithin(bitmap.width, bitmap.height, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);
    if (target.width === bitmap.width && target.height === bitmap.height) return file;

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    const type = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
