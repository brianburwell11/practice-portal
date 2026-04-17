import { useMemo } from 'react';
import type { WizardState, WizardAction } from '../wizardReducer';
import { AlignmentCanvas, type AlignmentCanvasStem } from '../components/AlignmentCanvas';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

export function AlignmentStep({ state, dispatch }: Props) {
  // Map wizard stems to canvas stems, dropping any without decoded buffers.
  const canvasStems = useMemo<AlignmentCanvasStem[]>(
    () =>
      state.stems
        .filter((s) => !!s.buffer)
        .map((s) => ({
          id: s.id,
          label: s.label,
          color: s.color,
          buffer: s.buffer as AudioBuffer,
          offsetSec: s.offsetSec,
        })),
    [state.stems],
  );

  if (state.stems.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Align Stems</h2>
        <p className="text-gray-400">No stems to align. Go back and upload some first.</p>
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Back
        </button>
      </div>
    );
  }

  const handleOffsetChange = (id: string, offsetSec: number) => {
    const index = state.stems.findIndex((s) => s.id === id);
    if (index < 0) return;
    dispatch({ type: 'SET_STEM_OFFSET', index, offsetSec });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Align Stems</h2>

      <AlignmentCanvas stems={canvasStems} onOffsetChange={handleOffsetChange} />

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
    </div>
  );
}
