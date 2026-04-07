export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export function r2Url(path: string): string {
  const base = import.meta.env.VITE_R2_PUBLIC_URL;
  return `${base}/${path.replace(/^\//, '')}`;
}
