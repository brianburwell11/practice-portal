import type { WizardState, WizardAction } from '../wizardReducer';
import { useBandStore } from '../../store/bandStore';
import { TagInput } from '../TagInput';
import { SongKeyInput } from '../SongKeyInput';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

export function MetadataStep({ state, dispatch }: Props) {
  const bandName = useBandStore((s) => s.currentBand?.name ?? '');
  const canProceed = state.title.trim() !== '';

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Song Metadata</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title</label>
          <input
            type="text"
            value={state.title}
            onChange={(e) => dispatch({ type: 'SET_TITLE', title: e.target.value, fallbackArtist: bandName })}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="Song Title"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Artist</label>
          <input
            type="text"
            value={state.artist}
            onChange={(e) => dispatch({ type: 'SET_ARTIST', artist: e.target.value, fallbackArtist: bandName })}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder={bandName || 'Artist'}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Key</label>
          <SongKeyInput
            value={state.key}
            onChange={(key) => dispatch({ type: 'SET_KEY', key })}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Tags</label>
          <TagInput
            tags={state.tags}
            onChange={(tags) => dispatch({ type: 'SET_TAGS', tags })}
          />
        </div>

        {state.id && (
          <div className="text-sm text-gray-500">
            Song ID: <span className="text-gray-300 font-mono">{state.id}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          disabled={!canProceed}
          onClick={() => {
            if (!state.artist.trim() && bandName) {
              dispatch({ type: 'SET_ARTIST', artist: bandName, fallbackArtist: bandName });
            }
            dispatch({ type: 'NEXT_STEP' });
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
        >
          Next: Stems & Groups
        </button>
      </div>
    </div>
  );
}
