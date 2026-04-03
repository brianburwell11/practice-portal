import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { WizardState, WizardAction } from '../wizardReducer';
import { buildConfig } from '../utils/buildConfig';
import { songConfigSchema } from '../../config/schema';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

export function ReviewStep({ state, dispatch }: Props) {
  const [result, setResult] = useState<'success' | null>(null);
  const { bandSlug = '' } = useParams();
  const navigate = useNavigate();
  const config = buildConfig(state);
  const validation = songConfigSchema.safeParse(config);

  const handleSave = async () => {
    dispatch({ type: 'SET_SAVING', saving: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      // 1. Upload stem files
      const formData = new FormData();
      for (const stem of state.stems) {
        formData.append('stems', stem.file, stem.file.name);
      }
      const uploadRes = await fetch(`/api/song/${state.id}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Upload failed');
      }

      // 2. Write config
      const configRes = await fetch(`/api/song/${state.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!configRes.ok) {
        const err = await configRes.json();
        throw new Error(err.error || 'Config save failed');
      }

      // 3. Update manifest
      const manifestRes = await fetch('/api/manifest/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.id,
          title: state.title,
          artist: state.artist,
          path: `audio/song-${state.id}`,
        }),
      });
      if (!manifestRes.ok) {
        const err = await manifestRes.json();
        throw new Error(err.error || 'Manifest update failed');
      }

      setResult('success');
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false });
    }
  };

  if (result === 'success') {
    return (
      <div className="space-y-6 text-center py-12">
        <p className="text-2xl text-green-400">Song added!</p>
        <p className="text-gray-400">
          <span className="font-mono text-gray-300">{state.title}</span> by{' '}
          <span className="text-gray-300">{state.artist}</span> has been saved to{' '}
          <span className="font-mono text-gray-300">public/audio/song-{state.id}/</span>
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => navigate(`/${bandSlug}`)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
          >
            Open in Practice Portal
          </button>
          <button
            onClick={() => location.reload()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Add another song
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Review & Save</h2>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-400">Title:</span>{' '}
          <span className="text-gray-100">{state.title}</span>
        </div>
        <div>
          <span className="text-gray-400">Artist:</span>{' '}
          <span className="text-gray-100">{state.artist}</span>
        </div>
        <div>
          <span className="text-gray-400">Key:</span>{' '}
          <span className="text-gray-100">{state.key || '(none)'}</span>
        </div>
        <div>
          <span className="text-gray-400">ID:</span>{' '}
          <span className="font-mono text-gray-100">{state.id}</span>
        </div>
        <div>
          <span className="text-gray-400">Stems:</span>{' '}
          <span className="text-gray-100">{state.stems.length}</span>
        </div>
        <div>
          <span className="text-gray-400">Duration:</span>{' '}
          <span className="text-gray-100">{state.durationSeconds.toFixed(1)}s</span>
        </div>
        <div>
          <span className="text-gray-400">Timing:</span>{' '}
          <span className="text-gray-100">
            {state.timingMode === 'xsc'
              ? `XSC (${state.tapMap.length} entries)`
              : state.timingMode === 'manual'
                ? `${state.manualBpm} BPM, ${state.timeSignatureNumerator}/${state.timeSignatureDenominator}`
                : 'Default (120 BPM, 4/4)'}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Groups:</span>{' '}
          <span className="text-gray-100">
            {state.groups.length > 0 ? state.groups.map((g) => g.label).join(', ') : 'None'}
          </span>
        </div>
      </div>

      {/* Validation */}
      {!validation.success && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          <p className="font-medium mb-1">Validation errors:</p>
          {validation.error.issues.map((issue, i) => (
            <p key={i}>
              {issue.path.join('.')}: {issue.message}
            </p>
          ))}
        </div>
      )}

      {/* Config JSON */}
      <details className="group">
        <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
          View config.json
        </summary>
        <pre className="mt-2 bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-x-auto max-h-96">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>

      {/* Error */}
      {state.error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          disabled={state.saving}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
        >
          Back
        </button>
        <button
          disabled={!validation.success || state.saving}
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
        >
          {state.saving ? 'Saving...' : 'Save Song'}
        </button>
      </div>
    </div>
  );
}
