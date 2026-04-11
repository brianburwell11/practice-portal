interface Props {
  onClose: () => void;
}

const shortcuts = [
  { key: 'Space', action: 'Play / Pause' },
  { key: '[', action: 'Set loop in point' },
  { key: ']', action: 'Set loop out point' },
  { key: '\\ or C', action: 'Toggle loop on/off' },
  { key: 'Shift + \\', action: 'Clear loop' },
  { key: '`', action: 'Toggle follow playhead' },
  { key: 'S', action: 'Toggle global solo' },
  { key: 'Shift + S', action: 'Clear solo group' },
  { key: 'M', action: 'Toggle global mute' },
  { key: 'Shift + M', action: 'Clear mute group' },
  { key: 'Cmd/Ctrl + Scroll', action: 'Zoom waveform in/out' },
  { key: 'Shift + Scroll', action: 'Scroll waveform left/right' },
  { key: 'Pinch', action: 'Zoom waveform (touch)' },
  { key: 'Long-press', action: 'Clear loop / mute group / solo group (mobile)' },
];

export function HelpModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">Help</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        {/* Keyboard shortcuts */}
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Keyboard Shortcuts</h3>
          <div className="space-y-1">
            {shortcuts.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{s.action}</span>
                <kbd className="px-1.5 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 font-mono">{s.key}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Mute switch notice */}
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/25 rounded-lg text-sm text-yellow-200">
          <span className="inline-flex items-center gap-0.5 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
              <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
              <path d="M18 8a6 6 0 0 0-9.33-5" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            <span className="text-xs mx-0.5">&rarr;</span>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </span>
          <span>If you can't hear audio, check that your phone isn't on silent.</span>
        </div>

        {/* Feedback */}
        <div className="pt-2 border-t border-gray-700 flex justify-center">
          <a
            href="mailto:brianburwell11@gmail.com?subject=Practice%20Portal%20Feedback"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            Submit Feedback
          </a>
        </div>
      </div>
    </div>
  );
}
