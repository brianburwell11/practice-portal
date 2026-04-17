import { useReducer } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { wizardReducer, initialState } from './wizardReducer';
import { MetadataStep } from './steps/MetadataStep';
import { StemsStep } from './steps/StemsStep';
import { AlignmentStep } from './steps/AlignmentStep';
import { ReviewStep } from './steps/ReviewStep';

const stepLabels = ['Metadata', 'Stems & Groups', 'Align', 'Review'];

export default function AddSongWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const { bandSlug = '' } = useParams();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Add Song</h1>
        <button
          onClick={() => navigate(`/${bandSlug}`)}
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
        {state.step === 4 && <ReviewStep state={state} dispatch={dispatch} />}
      </main>
    </div>
  );
}
