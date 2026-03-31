import { useRef, useState, useCallback, useEffect } from 'react';
import type { WizardState, WizardAction } from '../wizardReducer';
import type { TapMapEntry } from '../../audio/types';
import { parseXscFile } from '../../audio/xscParser';
import { AudioEngine } from '../../audio/AudioEngine';
import { AudioEngineContext } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { MarkerEditorModal } from '../../components/marker-editor/MarkerEditorModal';
import { buildConfig } from '../utils/buildConfig';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

function TapMapEditorWrapper({
  state,
  onComplete,
  onClose,
}: {
  state: WizardState;
  onComplete: (tapMap: TapMapEntry[]) => void;
  onClose: () => void;
}) {
  const [engine] = useState(() => new AudioEngine());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openEditor = useMarkerEditorStore((s) => s.open);
  const isEditorOpen = useMarkerEditorStore((s) => s.isOpen);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const config = buildConfig(state);
        const stemFiles = new Map(state.stems.map((s) => [s.id, s.file]));

        const { setPlaying, setPosition, setDuration } = useTransportStore.getState();
        engine.setOnStateChange(() => {
          setPlaying(engine.clock.playing);
          setPosition(engine.clock.currentTime);
          setDuration(engine.clock.duration);
        });

        await engine.loadSong(config, '', undefined, stemFiles);

        if (!cancelled) {
          setLoading(false);
          openEditor(state.tapMap, onComplete);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the editor closes (user clicked Close or Save), tear down
  useEffect(() => {
    if (!loading && !isEditorOpen) {
      engine.stop();
      onClose();
    }
  }, [isEditorOpen, loading, engine, onClose]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400">Failed to load stems: {error}</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400">Loading stems for TapMap Editor...</p>
      </div>
    );
  }

  return (
    <AudioEngineContext.Provider value={engine}>
      <MarkerEditorModal />
    </AudioEngineContext.Provider>
  );
}

export function TimingStep({ state, dispatch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const handleXscImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const tapMap = parseXscFile(content);
      dispatch({ type: 'SET_TIMING_XSC', tapMap });
    };
    reader.readAsText(file);
  };

  const handleEditorComplete = useCallback(
    (tapMap: TapMapEntry[]) => {
      dispatch({ type: 'SET_TIMING_XSC', tapMap });
    },
    [dispatch],
  );

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const hasTapMap = state.timingMode === 'xsc' && state.tapMap.length > 0;

  const tapMapSummary = hasTapMap && (
    <div className="bg-gray-800 rounded p-3 text-sm space-y-1">
      <p className="text-green-400">{state.tapMap.length} tap map entries</p>
      <p className="text-gray-400">
        {state.tapMap.filter((e) => e.type === 'section').length} sections,{' '}
        {state.tapMap.filter((e) => e.type === 'measure').length} measures,{' '}
        {state.tapMap.filter((e) => e.type === 'beat').length} beats
      </p>
      {state.tapMap
        .filter((e) => e.type === 'section' && e.label)
        .map((e, i) => (
          <span key={i} className="inline-block bg-gray-700 rounded px-2 py-0.5 text-xs mr-1 mb-1">
            {e.label}
          </span>
        ))}
    </div>
  );

  const canOpenEditor = state.stems.length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Timing & Markers</h2>

      <div className="space-y-4">
        {/* TapMap Editor option */}
        <div
          className={`border rounded-lg p-4 transition-colors ${
            canOpenEditor ? 'cursor-pointer hover:border-gray-500' : 'opacity-50'
          } ${
            hasTapMap
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600'
          }`}
          onClick={() => canOpenEditor && setEditorOpen(true)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">TapMap Editor</p>
              <p className="text-sm text-gray-400">
                Tap along to the audio to mark beats, measures, and sections
              </p>
            </div>
            {hasTapMap && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'CLEAR_TIMING' });
                }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            )}
          </div>
          {tapMapSummary}
        </div>

        {/* XSC import option */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-colors ${
            state.timingMode === 'xsc' && !hasTapMap
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600 hover:border-gray-500'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Import from Transcribe! (.xsc)</p>
              <p className="text-sm text-gray-400">
                Imports tap map with sections, measures, and beats
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsc"
            onChange={handleXscImport}
            className="hidden"
          />
        </div>

        {/* Manual BPM option */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-colors ${
            state.timingMode === 'manual'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600 hover:border-gray-500'
          }`}
          onClick={() => {
            if (state.timingMode !== 'manual') {
              dispatch({
                type: 'SET_TIMING_MANUAL',
                bpm: state.manualBpm,
                numerator: state.timeSignatureNumerator,
                denominator: state.timeSignatureDenominator,
              });
            }
          }}
        >
          <p className="font-medium">Set BPM manually</p>
          <p className="text-sm text-gray-400 mb-3">Enter a constant tempo</p>

          {state.timingMode === 'manual' && (
            <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
              <label className="flex items-center gap-2 text-sm">
                BPM
                <input
                  type="number"
                  min={1}
                  max={400}
                  value={state.manualBpm}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_TIMING_MANUAL',
                      bpm: parseInt(e.target.value) || 120,
                      numerator: state.timeSignatureNumerator,
                      denominator: state.timeSignatureDenominator,
                    })
                  }
                  className="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                />
              </label>

              <label className="flex items-center gap-2 text-sm">
                Time Sig
                <select
                  value={state.timeSignatureNumerator}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_TIMING_MANUAL',
                      bpm: state.manualBpm,
                      numerator: parseInt(e.target.value),
                      denominator: state.timeSignatureDenominator,
                    })
                  }
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9, 12].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                /
                <select
                  value={state.timeSignatureDenominator}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_TIMING_MANUAL',
                      bpm: state.manualBpm,
                      numerator: state.timeSignatureNumerator,
                      denominator: parseInt(e.target.value),
                    })
                  }
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  {[2, 4, 8, 16].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Skip option */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-colors ${
            state.timingMode === null
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-600 hover:border-gray-500'
          }`}
          onClick={() => dispatch({ type: 'CLEAR_TIMING' })}
        >
          <p className="font-medium">Skip for now</p>
          <p className="text-sm text-gray-400">
            Continue without timing or markers
          </p>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Back
        </button>
        <button
          onClick={() => dispatch({ type: 'NEXT_STEP' })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
        >
          Next: Review
        </button>
      </div>

      {/* TapMap Editor overlay */}
      {editorOpen && (
        <TapMapEditorWrapper
          state={state}
          onComplete={handleEditorComplete}
          onClose={handleEditorClose}
        />
      )}
    </div>
  );
}
