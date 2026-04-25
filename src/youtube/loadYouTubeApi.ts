/// <reference types="youtube" />

declare global {
  interface Window {
    YT?: typeof globalThis.YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YouTubeApi = NonNullable<Window['YT']>;

let loadPromise: Promise<YouTubeApi> | null = null;

/** Idempotent loader for the YouTube IFrame Player API. The script is
 *  injected on first call; later calls await the same promise. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<YouTubeApi>((resolve) => {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === 'function') prevReady();
      if (window.YT) resolve(window.YT);
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return loadPromise;
}
