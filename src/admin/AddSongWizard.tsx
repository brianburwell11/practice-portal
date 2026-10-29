import { useEffect, useReducer, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { wizardReducer, createInitialState } from './wizardReducer';
import { MetadataStep } from './steps/MetadataStep';
import { StemsStep } from './steps/StemsStep';
import { AlignmentStep } from './steps/AlignmentStep';
import { ReviewStep } from './steps/ReviewStep';
import { confirmDiscard } from '../store/dialogStore';

const stepLabels = ['Metadata', 'Stems & Groups', 'Align', 'Review'];

export default function AddSongWizard() {
  // A new key starts a fresh wizard, for "Add another song".
  const [run, setRun] = useState(0);
  return <Wizard key={run} onAddAnother={() => setRun((r) => r + 1)} />;
}

function Wizard({ onAddAnother }: { onAddAnother: () => void }) {
  const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);
  const [saved, setSaved] = useState(false);
  const { bandSlug = '' } = useParams();
  const navigate = useNavigate();

  // Everything lives in memory until Save, so leaving loses it.
  const dirty = !saved && (state.title.trim() !== '' || state.stems.length > 0 || !!state.sheetMusicFile);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const leave = async () => {
    if (dirty) {
      const message = state.saving
        ? 'The song is still uploading. If you leave now, it won’t be saved.'
        : 'This song hasn’t been saved yet.';
      if (!(await confirmDiscard(message))) return;
    }
    navigate(`/${bandSlug}`);
  };

  return (
    <div className="min-h-screen bg-page text-gray-100">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Add Song</h1>
        <button
          onClick={leave}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Back to app
        </button>
      </header>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 py-4 px-4">
        {stepLabels.map((label, i) => {
          const stepNum = (i + 1) as 1 | 2 | 3 | 4;
          const isCurrent = state.step === stepNum;
          const isCompleted = state.step > stepNum;

          return (
            <div key={label} className="flex items-center">
              {i > 0 && (
                <div
                  className={`w-8 h-px mx-1 ${isCompleted ? 'bg-blue-500' : 'bg-gray-700'}`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                    isCurrent
                      ? 'bg-blue-600 text-white'
                      : isCompleted
                        ? 'bg-blue-500/30 text-blue-400'
                        : 'bg-gray-700 text-gray-500'
                  }`}
                >
                  {stepNum}
                </div>
                <span
                  className={`text-xs hidden sm:inline ${
                    isCurrent ? 'text-gray-200' : 'text-gray-500'
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {state.step === 1 && <MetadataStep state={state} dispatch={dispatch} />}
        {state.step === 2 && <StemsStep state={state} dispatch={dispatch} />}
        {state.step === 3 && <AlignmentStep state={state} dispatch={dispatch} />}
        {state.step === 4 && <ReviewStep state={state} dispatch={dispatch} onSaved={() => setSaved(true)} onAddAnother={onAddAnother} />}
      </main>
    </div>
  );
}
