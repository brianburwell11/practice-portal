import { useCallback, useRef, useState } from 'react';
import type { WizardState, WizardAction, StemEntry } from '../wizardReducer';
import { detectStem, deduplicateIds, isAudioFile } from '../utils/stemDetection';
import { convertToMono, getAudioDuration } from '../utils/audioConvert';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

const groupColors = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

async function collectFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const entry = dataTransfer.items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  async function readEntry(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      if (isAudioFile(file.name)) files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      for (const child of children) {
        await readEntry(child);
      }
    }
  }

  for (const entry of entries) {
    await readEntry(entry);
  }
  return files;
}

function buildStems(files: File[]): StemEntry[] {
  const detected = files.map((file) => ({
    file,
    ...detectStem(file.name),
  }));
  const deduped = deduplicateIds(detected);
  return detected.map((stem, i) => ({
    ...stem,
    id: deduped[i].id,
  }));
}

export function StemsStep({ state, dispatch }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // Group creation state
  const [groupLabel, setGroupLabel] = useState('');
  const [groupColor, setGroupColor] = useState(groupColors[0]);
  const [selectedStemIds, setSelectedStemIds] = useState<Set<string>>(new Set());

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLoading(true);
      try {
        const monoFiles = await Promise.all(files.map(convertToMono));
        const stems = buildStems(monoFiles);
        const duration = await getAudioDuration(monoFiles[0]);
        dispatch({ type: 'SET_STEMS', stems, durationSeconds: Math.round(duration * 100) / 100 });
      } finally {
        setLoading(false);
      }
    },
    [dispatch],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = await collectFiles(e.dataTransfer);
      handleFiles(files);
    },
    [handleFiles],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList) return;
      const files = Array.from(fileList).filter((f) => isAudioFile(f.name));
      handleFiles(files);
    },
    [handleFiles],
  );

  // Drag-to-reorder handlers
  const onStemDragStart = (idx: number) => setDragIdx(idx);
  const onStemDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const onStemDragEnd = () => {
    if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
      dispatch({ type: 'MOVE_STEM', from: dragIdx, to: dropIdx });
    }
    setDragIdx(null);
    setDropIdx(null);
  };

  // Group helpers
  const assignedStemIds = new Set(state.groups.flatMap((g) => g.stemIds));
  const availableStems = state.stems.filter((s) => !assignedStemIds.has(s.id));
  const canAddGroup = groupLabel.trim() !== '' && selectedStemIds.size > 0;

  const handleAddGroup = () => {
    const id = groupLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    dispatch({
      type: 'ADD_GROUP',
      group: { id, label: groupLabel.trim(), color: groupColor, stemIds: Array.from(selectedStemIds) },
    });
    setGroupLabel('');
    setSelectedStemIds(new Set());
    setGroupColor(groupColors[(state.groups.length + 1) % groupColors.length]);
  };

  const toggleStem = (stemId: string) => {
    setSelectedStemIds((prev) => {
      const next = new Set(prev);
      if (next.has(stemId)) next.delete(stemId);
      else next.add(stemId);
      return next;
    });
  };

  const canProceed = state.stems.length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Stems & Groups</h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          // Only handle file drops, not stem reorder
          if (dragIdx !== null) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => { if (dragIdx === null) setDragging(false); }}
        onDrop={(e) => { if (dragIdx === null) onDrop(e); }}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-gray-600 hover:border-gray-500'
        }`}
      >
        {loading ? (
          <p className="text-gray-400">Converting stems to mono...</p>
        ) : (
          <>
            <p className="text-gray-300 mb-2">Drag a folder of stems here</p>
            <p className="text-gray-500 text-sm mb-3">or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Browse folder
            </button>
            <input
              ref={fileInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is not in the type definitions
              webkitdirectory=""
              multiple
              onChange={onFileInput}
              className="hidden"
            />
          </>
        )}
      </div>

      {/* Stem list */}
      {state.stems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>{state.stems.length} stems</span>
            <span>Duration: {state.durationSeconds.toFixed(1)}s</span>
          </div>

          {state.stems.map((stem, i) => (
            <div
              key={stem.id + i}
              draggable
              onDragStart={() => onStemDragStart(i)}
              onDragOver={(e) => onStemDragOver(e, i)}
              onDragEnd={onStemDragEnd}
              className={`bg-gray-800 rounded-lg p-3 space-y-2 transition-opacity ${
                dragIdx === i ? 'opacity-40' : ''
              } ${dropIdx === i && dragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
            >
              <div className="flex items-center gap-3">
                {/* Drag handle */}
                <span className="text-gray-600 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                  &#x2630;
                </span>

                {/* Color */}
                <input
                  type="color"
                  value={stem.color}
                  onChange={(e) =>
                    dispatch({ type: 'UPDATE_STEM', index: i, updates: { color: e.target.value } })
                  }
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />

                {/* Label */}
                <input
                  type="text"
                  value={stem.label}
                  onChange={(e) =>
                    dispatch({ type: 'UPDATE_STEM', index: i, updates: { label: e.target.value } })
                  }
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                />

                {/* Filename */}
                <span className="text-xs text-gray-500 truncate max-w-48">{stem.file.name}</span>

                {/* Remove */}
                <button
                  onClick={() => dispatch({ type: 'REMOVE_STEM', index: i })}
                  className="text-gray-500 hover:text-red-400 text-sm px-1"
                >
                  &times;
                </button>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-400 pl-8">
                <label className="flex items-center gap-2">
                  Vol
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={stem.defaultVolume}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_STEM',
                        index: i,
                        updates: { defaultVolume: parseFloat(e.target.value) },
                      })
                    }
                    className="w-24"
                  />
                  <span className="w-8 text-right">{Math.round(stem.defaultVolume * 100)}%</span>
                </label>

                <label className="flex items-center gap-2">
                  Pan
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={stem.defaultPan}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_STEM',
                        index: i,
                        updates: { defaultPan: parseFloat(e.target.value) },
                      })
                    }
                    className="w-24"
                  />
                  <span className="w-8 text-right">
                    {stem.defaultPan === 0
                      ? 'C'
                      : stem.defaultPan < 0
                        ? `L${Math.round(Math.abs(stem.defaultPan) * 100)}`
                        : `R${Math.round(stem.defaultPan * 100)}`}
                  </span>
                </label>

                <span className="text-gray-600 ml-auto font-mono">{stem.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Groups section */}
      {state.stems.length > 0 && (
        <div className="space-y-4 border-t border-gray-700 pt-6">
          <div>
            <h3 className="text-lg font-medium">Groups</h3>
            <p className="text-sm text-gray-400">
              Optionally group related stems (e.g., drum mics) for collective mixing control.
            </p>
          </div>

          {/* Existing groups */}
          {state.groups.map((group, i) => (
            <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: group.color }} />
              <span className="font-medium">{group.label}</span>
              <span className="text-sm text-gray-400">
                {group.stemIds.length} stems
              </span>
              <span className="text-xs text-gray-500 ml-auto">
                {group.stemIds.join(', ')}
              </span>
              <button
                onClick={() => dispatch({ type: 'REMOVE_GROUP', index: i })}
                className="text-gray-500 hover:text-red-400 text-sm px-1"
              >
                &times;
              </button>
            </div>
          ))}

          {/* Add new group */}
          {availableStems.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={groupColor}
                  onChange={(e) => setGroupColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />
                <input
                  type="text"
                  value={groupLabel}
                  onChange={(e) => setGroupLabel(e.target.value)}
                  placeholder="Group name (e.g., Drums)"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  disabled={!canAddGroup}
                  onClick={handleAddGroup}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm"
                >
                  Add
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {availableStems.map((stem) => (
                  <button
                    key={stem.id}
                    onClick={() => toggleStem(stem.id)}
                    className={`px-3 py-1 rounded text-sm border transition-colors ${
                      selectedStemIds.has(stem.id)
                        ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                        : 'border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {stem.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Back
        </button>
        <button
          disabled={!canProceed}
          onClick={() => dispatch({ type: 'NEXT_STEP' })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
        >
          Next: Timing
        </button>
      </div>
    </div>
  );
}
