/// <reference types="youtube" />

declare global {
  interface Window {
    YT?: typeof globalThis.YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YouTubeApi = NonNullable<Window['YT']>;

let loadPromise: Promise<YouTubeApi> | null = null;

const SCRIPT_SRC = 'https://www.youtube.com/iframe_api';
const LOAD_TIMEOUT_MS = 10000;

/** Idempotent loader for the YouTube IFrame Player API. The script is
 *  injected on first call; later calls await the same promise. The
 *  promise rejects on script load failure (network / blocked) or if
 *  the API doesn't initialize within LOAD_TIMEOUT_MS. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<YouTubeApi>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('YouTube API can only load in a browser'));
      return;
    }

    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      reject(new Error('YouTube API load timed out'));
    }, LOAD_TIMEOUT_MS);

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeoutId);
      if (typeof prevReady === 'function') prevReady();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube API loaded but YT global is missing'));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = SCRIPT_SRC;
      tag.async = true;
      tag.onerror = () => {
        window.clearTimeout(timeoutId);
        // Reset so a future call (e.g., after the network recovers) can retry.
        loadPromise = null;
        reject(new Error('Failed to load YouTube IFrame API'));
      };
      document.head.appendChild(tag);
    }
  });

  return loadPromise;
}
