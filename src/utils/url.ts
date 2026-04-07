export function r2Url(path: string): string {
  const base = import.meta.env.VITE_R2_PUBLIC_URL;
  return `${base}/${path.replace(/^\//, '')}`;
}
