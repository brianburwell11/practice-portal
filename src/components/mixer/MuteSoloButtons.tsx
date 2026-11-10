/**
 * M and S buttons for a stem or a group. The colors and states are shared by
 * the mobile cards and the desktop strips; callers size them with
 * `buttonClassName`.
 */

interface StemProps {
  label: string;
  muted: boolean;
  soloed: boolean;
  globalMuteActive: boolean;
  globalSoloActive: boolean;
  onMute: () => void;
  onSolo: () => void;
  buttonClassName: string;
}

export function StemMuteSolo({
  label, muted, soloed, globalMuteActive, globalSoloActive, onMute, onSolo, buttonClassName,
}: StemProps) {
  return (
    <>
      <button
        onClick={onMute}
        aria-label={`Mute ${label}`}
        aria-pressed={muted}
        className={`${buttonClassName} rounded font-medium transition-colors border-2 ${
          muted && globalMuteActive
            ? 'bg-red-600 text-white border-red-600'
            : muted && !globalMuteActive
              ? 'bg-gray-700 text-gray-400 border-red-600'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border-transparent'
        }`}
      >
        M
      </button>
      <button
        onClick={onSolo}
        aria-label={`Solo ${label}`}
        aria-pressed={soloed}
        className={`${buttonClassName} rounded font-medium transition-colors border-2 ${
          soloed && globalSoloActive
            ? 'bg-yellow-500 text-black border-yellow-500'
            : soloed && !globalSoloActive
              ? 'bg-gray-700 text-gray-400 border-yellow-500'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border-transparent'
        }`}
      >
        S
      </button>
    </>
  );
}

interface GroupProps {
  label: string;
  mutedCount: number;
  soloedCount: number;
  allMuted: boolean;
  allSoloed: boolean;
  globalMuteActive: boolean;
  globalSoloActive: boolean;
  onMute: () => void;
  onSolo: () => void;
  buttonClassName: string;
}

/**
 * Neutral body with a colored outline when members are in the mute/solo set,
 * plus a diagonal half-fill (top half colored) when the set is actively
 * suppressing audio but not every member is in it.
 */
export function GroupMuteSolo({
  label, mutedCount, soloedCount, allMuted, allSoloed, globalMuteActive, globalSoloActive, onMute, onSolo,
  buttonClassName,
}: GroupProps) {
  return (
    <>
      <button
        onClick={onMute}
        aria-label={`Mute ${label}`}
        aria-pressed={allMuted ? true : mutedCount > 0 ? 'mixed' : false}
        className={`${buttonClassName} rounded font-medium transition-colors border-2 ${
          mutedCount > 0 ? 'border-red-600' : 'border-transparent'
        } ${
          globalMuteActive && allMuted
            ? 'bg-red-600 text-white'
            : 'bg-gray-700 hover:bg-gray-600 ' + (mutedCount > 0 && globalMuteActive ? 'text-gray-50' : 'text-gray-300')
        }`}
        style={
          mutedCount > 0 && globalMuteActive && !allMuted
            ? { backgroundImage: 'linear-gradient(to bottom right, #dc2626 50%, transparent 50%)' }
            : undefined
        }
      >
        M
      </button>
      <button
        onClick={onSolo}
        aria-label={`Solo ${label}`}
        aria-pressed={allSoloed ? true : soloedCount > 0 ? 'mixed' : false}
        className={`${buttonClassName} rounded font-medium transition-colors border-2 ${
          soloedCount > 0 ? 'border-yellow-500' : 'border-transparent'
        } ${
          globalSoloActive && allSoloed
            ? 'bg-yellow-500 text-black'
            : 'bg-gray-700 hover:bg-gray-600 ' + (soloedCount > 0 && globalSoloActive ? 'text-gray-50' : 'text-gray-300')
        }`}
        style={
          soloedCount > 0 && globalSoloActive && !allSoloed
            ? { backgroundImage: 'linear-gradient(to bottom right, #eab308 50%, transparent 50%)' }
            : undefined
        }
      >
        S
      </button>
    </>
  );
}
