import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './ui/Modal';
import { isAndroid, isPhone, isStandalone, useInstallPrompt } from '../utils/homeScreen';

/**
 * Putting Practice Portal on a phone's home screen, so it opens like an app.
 * iPhone can only do it by hand (Share, then Add to Home Screen), so this
 * shows the steps. Chrome on Android hands us an install prompt we can fire
 * from a button, with the same steps as a fallback.
 */

const SHARE_ICON = (
  <svg className="inline w-[1.15em] h-[1.15em] -mt-1 mx-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
    <path d="M12 3.5v11" /><path d="M8 7.3l4-3.8 4 3.8" />
    <path d="M6.5 11H6a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-6.5A1.5 1.5 0 0 0 18 11h-.5" />
  </svg>
);
const ADD_ICON = (
  <svg className="inline w-[1.15em] h-[1.15em] -mt-1 mx-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8.5v7M8.5 12h7" />
  </svg>
);
const MORE_ICON_IOS = (
  <svg className="inline w-[1.15em] h-[1.15em] -mt-1 mx-0.5" viewBox="0 0 24 24" fill="currentColor" aria-label="More">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);
const MORE_ICON_ANDROID = (
  <svg className="inline w-[1.15em] h-[1.15em] -mt-1 mx-0.5" viewBox="0 0 24 24" fill="currentColor" aria-label="Menu">
    <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
  </svg>
);

type Platform = 'iphone' | 'android';

const STEPS = 'list-decimal pl-5 space-y-2.5 text-sm text-gray-300 marker:text-gray-500';
const PRIMARY = 'w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-accent-ink';
const SECONDARY = 'w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200';

/** The steps, for iPhone or Android, with a one-tap install where Chrome offers it. */
export function HomeScreenGuide({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>(isAndroid() ? 'android' : 'iphone');
  const prompt = useInstallPrompt();
  const host = window.location.host;

  const install = () => prompt?.();

  return (
    <Modal onClose={onClose} title="Put it on your home screen" showClose>
      {isStandalone() && <p className="text-sm text-gray-300">You’re already using the home screen app, so you’re all set.</p>}
      <div role="tablist" className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-gray-800">
        {(['iphone', 'android'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={platform === p}
            onClick={() => setPlatform(p)}
            className={`py-1.5 rounded-md text-sm ${platform === p ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {p === 'iphone' ? 'iPhone and iPad' : 'Android'}
          </button>
        ))}
      </div>
      {platform === 'iphone' ? (
        <ol className={STEPS}>
          <li>Open <b className="text-gray-100">{host}</b> in Safari.</li>
          <li>Tap the Share button {SHARE_ICON}. If you don’t see it, tap {MORE_ICON_IOS} first, then Share.</li>
          <li>Scroll down and tap {ADD_ICON} <b className="text-gray-100">Add to Home Screen</b>, then <b className="text-gray-100">Add</b>.</li>
          <li>Open Practice Portal from your home screen and sign in once more. The home screen app keeps its own sign-in.</li>
        </ol>
      ) : (
        <>
          {prompt && <button onClick={install} className={PRIMARY}>Install Practice Portal</button>}
          <ol className={STEPS}>
            <li>Open <b className="text-gray-100">{host}</b> in Chrome.</li>
            <li>Tap the menu {MORE_ICON_ANDROID} in the top right corner.</li>
            <li>Tap <b className="text-gray-100">Add to home screen</b>, then <b className="text-gray-100">Install</b>.</li>
            <li>Open Practice Portal from your home screen. You’ll still be signed in.</li>
          </ol>
        </>
      )}
      <button onClick={onClose} className={SECONDARY}>Done</button>
    </Modal>
  );
}

/**
 * "Get the app", on phones that aren't already in it: installs in one tap
 * where the browser lets us, and shows the steps everywhere else (iPhone).
 */
export function GetAppButton({ className = '' }: { className?: string }) {
  const install = useInstallPrompt();
  const [guideOpen, setGuideOpen] = useState(false);
  if (!isPhone() || isStandalone()) return null;
  return (
    <>
      <button
        onClick={() => (install ? install() : setGuideOpen(true))}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-sm font-medium text-gray-200 ${className}`}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M12 7.5v7M9 11.5l3 3 3-3" />
        </svg>
        Get the app
      </button>
      {/* On body, so it doesn't take the styles of wherever the button sits (centred text on the home page). */}
      {guideOpen && createPortal(<HomeScreenGuide onClose={() => setGuideOpen(false)} />, document.body)}
    </>
  );
}

const OFFERED_KEY = 'practice-portal.homeScreenOffered';

/**
 * Asked once per phone: keep Practice Portal on the home screen? Never in the
 * home screen app itself, and never on a computer.
 */
export function HomeScreenOffer() {
  const [step, setStep] = useState<'none' | 'offer' | 'guide'>('none');

  useEffect(() => {
    if (!isPhone() || isStandalone()) return;
    try {
      if (localStorage.getItem(OFFERED_KEY)) return;
    } catch {
      return; // no storage: we couldn't remember the answer, so don't ask at all
    }
    // A moment after the page settles, not over it while it loads.
    const t = setTimeout(() => {
      setStep('offer');
      try { localStorage.setItem(OFFERED_KEY, '1'); } catch { /* asked once this visit, then */ }
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  if (step === 'guide') return <HomeScreenGuide onClose={() => setStep('none')} />;
  if (step !== 'offer') return null;
  return (
    <Modal onClose={() => setStep('none')} title="Keep Practice Portal on your phone">
      <p className="text-sm text-gray-300">
        Put it on your home screen and it opens like an app, with one tap. It takes about 20 seconds.
      </p>
      <div className="space-y-2">
        <button onClick={() => setStep('guide')} className={PRIMARY}>Show me how</button>
        <button onClick={() => setStep('none')} className={SECONDARY}>Maybe later</button>
      </div>
    </Modal>
  );
}
