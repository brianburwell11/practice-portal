import { usePanelMinimizeStore, type PanelId } from '../store/panelMinimizeStore';
import { useSongStore } from '../store/songStore';

const TOOLBAR_HEIGHT = 40;

const PANEL_LABELS: Record<PanelId, string> = {
  sheet: 'Sheet music',
  mixer: 'Mixer',
  lyrics: 'Lyrics',
};

function PanelIcon({ id }: { id: PanelId }) {
  if (id === 'mixer') {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="2" y1="14" x2="6" y2="14" />
        <line x1="12" y1="21" x2="12" y2="8" /><line x1="12" y1="4" x2="12" y2="3" /><line x1="10" y1="8" x2="14" y2="8" />
        <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="18" y1="16" x2="22" y2="16" />
      </svg>
    );
  }
  if (id === 'lyrics') {
    return (
      <svg className="w-4 h-4" viewBox="0 0 512 512" fill="currentColor">
        <rect x="19.564" y="447.635" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 -285.559 842.3594)" width="24.231" height="65.371" />
        <polygon points="0.17,494.699 46.394,448.809 63.188,465.945 17.133,511.66" />
        <path d="M43.642,412.297l220.223-264.551l100.371,100.738L99.549,468.203L43.642,412.297z" />
        <path d="M391.48,238.551l-118.1-118.199c-0.279-30.238,11.02-59.379,31.887-81.891l168.268,168.614c-22.131,20.18-50.791,31.484-80.695,31.484L391.48,238.551z" />
        <path d="M330.783,17.23c18.611-10.984,40.072-16.992,62.018-16.992c31.787,0,61.664,12.371,84.127,34.832c38.895,38.898,46.123,98.863,17.625,145.93L330.783,17.23z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="14" x2="21" y2="14" />
      <line x1="3" y1="18" x2="21" y2="18" />
      <circle cx="9" cy="14" r="2" fill="currentColor" />
      <line x1="11" y1="14" x2="11" y2="6" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
      <line x1="2" y1="8" x2="22" y2="8" />
      <line x1="7" y1="2" x2="4" y2="8" />
      <line x1="12" y1="2" x2="9" y2="8" />
      <line x1="17" y1="2" x2="14" y2="8" />
      <polygon points="10 12 16 15 10 18 10 12" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MinimizedRibbon() {
  const items = usePanelMinimizeStore((s) => s.items);
  const restorePanel = usePanelMinimizeStore((s) => s.restorePanel);
  const restoreVideo = usePanelMinimizeStore((s) => s.restoreVideo);
  const songVideos = useSongStore((s) => s.selectedSong?.videos);

  if (items.length === 0) return null;

  return (
    <div
      className="hidden md:flex"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: TOOLBAR_HEIGHT,
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        overflowX: 'auto',
        zIndex: 200,
      }}
    >
      <span style={{ fontSize: 11, color: '#64748b', letterSpacing: 0.5, flexShrink: 0 }}>
        Minimized
      </span>
      {items.map((item) => {
        if (item.kind === 'panel') {
          const label = PANEL_LABELS[item.id];
          return (
            <button
              key={`panel:${item.id}`}
              type="button"
              onClick={() => restorePanel(item.id)}
              title={`Restore ${label}`}
              style={chipStyle}
            >
              <PanelIcon id={item.id} />
              <span style={chipLabelStyle}>{label}</span>
            </button>
          );
        }
        const video = songVideos?.find((v) => v.id === item.id);
        const label = video?.title || 'Video';
        return (
          <button
            key={`video:${item.id}`}
            type="button"
            onClick={() => restoreVideo(item.id)}
            title={`Restore ${label}`}
            style={chipStyle}
          >
            <VideoIcon />
            <span style={chipLabelStyle}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const chipStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 4,
  padding: '2px 10px',
  cursor: 'pointer',
  color: '#e2e8f0',
  fontSize: 12,
  flexShrink: 0,
  maxWidth: 220,
  height: 28,
} as const;

const chipLabelStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export { TOOLBAR_HEIGHT as MINIMIZED_RIBBON_HEIGHT };
