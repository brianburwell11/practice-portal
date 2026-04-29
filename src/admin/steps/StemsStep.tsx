import { useCallback, useRef, useState } from 'react';
import type { WizardState, WizardAction, StemEntry } from '../wizardReducer';
import { audioExtensions, detectStem, deduplicateLabels, isAudioFile, sortStems } from '../utils/stemDetection';
import { getAudioInfo } from '../utils/audioConvert';
import { previewStem } from '../utils/stemPreview';
import { StemColorPicker } from '../StemColorPicker';
import { SheetMusicUploader } from '../SheetMusicUploader';
import { MixerOrderEditor, shouldShowMixerOrderEditor } from '../components/MixerOrderEditor';

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
    channels: 1,
    stereo: false,
    offsetSec: 0,
  }));
  return deduplicateLabels(sortStems(detected));
}

export function StemsStep({ state, dispatch }: Props) {
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [previewingIdx, setPreviewingIdx] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // Group creation state
  const [groupLabel, setGroupLabel] = useState('');
  const [groupColor, setGroupColor] = useState(groupColors[0]);
  const [selectedStemIds, setSelectedStemIds] = useState<Set<string>>(new Set());

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLoading(true);
      try {
        const infos = await Promise.all(files.map(getAudioInfo));
        const stems = buildStems(files);
        // Attach detected channel counts + decoded buffers (buildStems reorders, so match by file ref)
        const infoMap = new Map(files.map((f, i) => [f, infos[i]]));
        for (const stem of stems) {
          const info = infoMap.get(stem.file);
          stem.channels = info?.channels ?? 1;
          stem.buffer = info?.buffer;
        }
        const duration = infos[0].duration;
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

  const togglePreview = async (idx: number, file: File) => {
    if (previewingIdx === idx) {
      stopRef.current?.();
      stopRef.current = null;
      setPreviewingIdx(null);
      return;
    }
    stopRef.current?.();
    setPreviewingIdx(idx);
    const { stop } = await previewStem(file, () => {
      setPreviewingIdx((cur) => (cur === idx ? null : cur));
      stopRef.current = null;
    });
    stopRef.current = stop;
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
          <p className="text-gray-400">Processing stems...</p>
        ) : (
          <>
            <p className="text-gray-300 mb-2">Drag a folder or audio files here</p>
            <p className="text-gray-500 text-sm mb-3">or</p>
            <button
              onClick={() => filesInputRef.current?.click()}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Browse files
            </button>
            <input
              ref={filesInputRef}
              type="file"
              accept={audioExtensions.join(',')}
              multiple
              onChange={onFileInput}
              className="hidden"
            />
          </>
        )}
      </div>

      {/* Normalize toggle — applies ffmpeg loudnorm during transcode.
          Tooltip explains the trade-off so curators can opt out for
          mixes that are already balanced. */}
      <label
        className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer w-fit"
        title="Levels each stem to a consistent loudness target (-16 LUFS) before transcoding. Not recommended for tracks that are already mixed well — normalization can squash a balanced mix."
      >
        <input
          type="checkbox"
          checked={state.normalize}
          onChange={(e) => dispatch({ type: 'SET_NORMALIZE', value: e.target.checked })}
          className="accent-blue-500"
        />
        <span>Normalize stem loudness on upload</span>
      </label>

      {/* Optional sheet music */}
      <SheetMusicUploader
        pendingFile={state.sheetMusicFile}
        onSelect={(file) => dispatch({ type: 'SET_SHEET_MUSIC_FILE', file })}
        onDiscardPending={() => dispatch({ type: 'SET_SHEET_MUSIC_FILE', file: null })}
        onRemoveExisting={() => dispatch({ type: 'SET_SHEET_MUSIC_FILE', file: null })}
      />
      {state.sheetMusicFile && (
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={state.repeatAfterDcDs}
            onChange={(e) => dispatch({ type: 'SET_REPEAT_AFTER_DC_DS', value: e.target.checked })}
            className="accent-blue-500"
          />
          <span>Repeat internal sections after D.C. / D.S.</span>
        </label>
      )}

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

                {/* Color circle (click to pick color) + stereo toggle */}
                <div className="shrink-0 flex items-center">
                  <StemColorPicker
                    value={stem.color}
                    onChange={(color) =>
                      dispatch({ type: 'UPDATE_STEM', index: i, updates: { color } })
                    }
                  >
                    <div className="w-6 h-6 rounded-full border-2 border-gray-600" style={{ backgroundColor: stem.color }} />
                  </StemColorPicker>
                  {stem.channels >= 2 && (
                    <button
                      onClick={() =>
                        dispatch({ type: 'UPDATE_STEM', index: i, updates: { stereo: !stem.stereo } })
                      }
                      className="-ml-2"
                      title={stem.stereo ? 'Stereo — click for mono' : 'Mono — click for stereo'}
                    >
                      <div
                        className="w-6 h-6 rounded-full border-2 border-gray-600"
                        style={{
                          backgroundColor: stem.stereo ? stem.color : 'transparent',
                          borderColor: stem.stereo ? stem.color : undefined,
                        }}
                      />
                    </button>
                  )}
                </div>

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

                {/* Preview */}
                <button
                  onClick={() => togglePreview(i, stem.file)}
                  className="text-gray-400 hover:text-blue-400 text-sm px-1"
                  title={previewingIdx === i ? 'Stop preview' : 'Preview stem'}
                >
                  {previewingIdx === i ? '\u25A0' : '\u25B6'}
                </button>

                {/* Remove */}
                <button
                  onClick={() => dispatch({ type: 'REMOVE_STEM', index: i })}
                  className="text-gray-500 hover:text-red-400 text-sm px-1"
                >
                  &times;
                </button>
              </div>

              <div className="flex items-center text-xs text-gray-400 pl-8">
                <span className="text-gray-600 ml-auto font-mono">
                  {stem.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || stem.id}
                </span>
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
              <span className="text-xs text-gray-500 ml-auto font-mono">
                {group.stemIds
                  .map((id) => {
                    const stem = state.stems.find((s) => s.id === id);
                    if (!stem) return id;
                    return stem.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || stem.id;
                  })
                  .join(', ')}
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
                <StemColorPicker value={groupColor} onChange={setGroupColor}>
                  <div className="w-8 h-8 rounded border border-gray-600" style={{ backgroundColor: groupColor }} />
                </StemColorPicker>
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

      {/* Mixer display order — combines groups and ungrouped stems
          into a single ordered list. Only shown when there's at least
          one group AND multiple top-level items to reorder. */}
      {shouldShowMixerOrderEditor({ stems: state.stems, groups: state.groups, mixerOrder: state.mixerOrder }) && (
        <div className="space-y-3 border-t border-gray-700 pt-6">
          <div>
            <h3 className="text-lg font-medium">Mixer Order</h3>
            <p className="text-sm text-gray-400">
              Drag to reorder how groups and stems appear in the mixer.
            </p>
          </div>
          <MixerOrderEditor
            song={{ stems: state.stems, groups: state.groups, mixerOrder: state.mixerOrder }}
            onChange={(order) => dispatch({ type: 'SET_MIXER_ORDER', order })}
          />
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
          Next: Align
        </button>
      </div>
    </div>
  );
}
