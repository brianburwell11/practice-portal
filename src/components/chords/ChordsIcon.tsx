/** A guitar chord box: nut on top, strings down, frets across, finger dots. */
export function ChordsIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="3" x2="19" y2="3" strokeWidth="2.5" />
      <line x1="5" y1="3" x2="5" y2="21" />
      <line x1="9.67" y1="3" x2="9.67" y2="21" />
      <line x1="14.33" y1="3" x2="14.33" y2="21" />
      <line x1="19" y1="3" x2="19" y2="21" />
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="5" y1="15" x2="19" y2="15" />
      <circle cx="9.67" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="14.33" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
