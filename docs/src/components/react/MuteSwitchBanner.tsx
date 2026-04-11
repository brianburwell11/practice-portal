const bellStyle = {
  display: 'inline-block',
  width: '1.1em',
  height: '1.1em',
  verticalAlign: '-0.15em',
  flexShrink: 0,
};

function BellOff() {
  return (
    <svg style={bellStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function BellOn() {
  return (
    <svg style={bellStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function MuteSwitchBanner() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.6rem',
      padding: '0.6rem 0.85rem',
      background: 'rgba(212, 168, 67, 0.12)',
      border: '1px solid rgba(212, 168, 67, 0.3)',
      borderRadius: '8px',
      fontSize: '0.85rem',
      color: '#D4A843',
      lineHeight: 1.4,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        flexShrink: 0,
      }}>
        <BellOff />
        <span style={{ fontSize: '0.75em', margin: '0 0.15rem' }}>&rarr;</span>
        <BellOn />
      </span>
      <span>If you can't hear audio, check that your phone isn't on silent.</span>
    </div>
  );
}
