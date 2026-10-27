export function r2Url(path: string): string {
  const base = import.meta.env.VITE_R2_PUBLIC_URL;
  return `${base}/${path.replace(/^\//, '')}`;
}

/**
 * URL of a JSON document in the R2 layout (`registry.json`,
 * `<band>/songs/<song>/config.json`, ...). Built with
 * `VITE_DATA_SOURCE=api` it's the same document served from Postgres by
 * `/api/data`; otherwise R2 directly. Media stays on `r2Url`.
 */
export function dataUrl(path: string): string {
  const key = path.replace(/^\//, '');
  return import.meta.env.VITE_DATA_SOURCE === 'api' ? `/api/data/${key}` : r2Url(key);
}
