import { useEffect, useState } from 'react';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { getSections, getSectionRange } from '../../audio/tapMapUtils';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function SectionList() {
  const engine = useAudioEngine();
  const {
    tapMap,
    selectedIndex,
    deleteEntry,
    updateSectionLabel,
    setSelectedIndex,
    deleteEntriesWhere,
  } = useMarkerEditorStore();

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menuOpenIdx, setMenuOpenIdx] = useState<number | null>(null);

  const sections = getSections(tapMap);

  // Map each section back to its index in the full tapMap
  const sectionIndices: number[] = [];
  for (let i = 0; i < tapMap.length; i++) {
    if (tapMap[i].type === 'section') {
      sectionIndices.push(i);
    }
  }

  // Count measures per section: entries of type 'section' or 'measure' from
  // this section (inclusive) up to the next section (exclusive). The section
  // marker itself counts as a measure, so the minimum is 1.
  const measureCountByIndex = new Map<number, number>();
  for (let s = 0; s < sectionIndices.length; s++) {
    const start = sectionIndices[s];
    const end = s + 1 < sectionIndices.length ? sectionIndices[s + 1] : tapMap.length;
    let count = 0;
    for (let i = start; i < end; i++) {
      if (tapMap[i].type === 'section' || tapMap[i].type === 'measure') count++;
    }
    measureCountByIndex.set(start, count);
  }

  const handleClickRow = (tapMapIndex: number) => {
    setSelectedIndex(tapMapIndex);
    engine.seek(tapMap[tapMapIndex].time);
  };

  const startEditing = (tapMapIndex: number, currentLabel: string) => {
    setEditingIdx(tapMapIndex);
    setEditValue(currentLabel);
  };

  const confirmEdit = () => {
    if (editingIdx !== null) {
      updateSectionLabel(editingIdx, editValue);
      setEditingIdx(null);
    }
  };

  const cancelEdit = () => {
    setEditingIdx(null);
  };

  useEffect(() => {
    if (menuOpenIdx === null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-section-row-menu]')) return;
      setMenuOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenIdx(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpenIdx]);

  const countInSection = (sectionIdx: number, kinds: ('beat' | 'measure')[]) => {
    const { start, end } = getSectionRange(tapMap, sectionIdx);
    let n = 0;
    for (const e of tapMap) {
      if (e.time < start || e.time >= end) continue;
      if (e.type === 'section') continue;
      if (kinds.includes(e.type as 'beat' | 'measure')) n++;
    }
    return n;
  };

  const bulkDelete = (sectionIdx: number, kinds: ('beat' | 'measure')[]) => {
    const { start, end } = getSectionRange(tapMap, sectionIdx);
    deleteEntriesWhere((e) => {
      if (e.time < start || e.time >= end) return false;
      if (e.type === 'section') return false;
      return kinds.includes(e.type as 'beat' | 'measure');
    });
    setMenuOpenIdx(null);
  };

  if (sections.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic px-3 py-4">
        No sections yet. Add section entries to the tap map.
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide px-3 py-1">
        Sections ({sections.length})
      </div>
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="py-1 px-3 text-left">Time</th>
              <th className="py-1 px-3 text-left">Label</th>
              <th className="py-1 px-3 text-right">Measures</th>
              <th className="py-1 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sectionIndices.map((tapMapIdx) => {
              const entry = tapMap[tapMapIdx];
              const isSelected = selectedIndex === tapMapIdx;
              const isEditing = editingIdx === tapMapIdx;

              return (
                <tr
                  key={`${tapMapIdx}-${entry.time}`}
                  className={`border-b border-gray-700/50 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-900/30'
                      : 'hover:bg-gray-700/50'
                  }`}
                  onClick={() => handleClickRow(tapMapIdx)}
                >
                  <td className="py-1.5 px-3 font-mono text-gray-300">
                    {formatTime(entry.time)}
                  </td>
                  <td className="py-1.5 px-3 text-gray-200">
                    {isEditing ? (
                      <input
                        type="text"
                        className="bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500 w-32"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        onBlur={confirmEdit}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-text hover:text-blue-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(tapMapIdx, entry.label || '');
                        }}
                      >
                        {entry.label || '(unnamed)'}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-gray-400 tabular-nums">
                    {measureCountByIndex.get(tapMapIdx) ?? 1}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    <div className="relative inline-flex items-center gap-1 justify-end">
                      <button
                        className="px-2 py-0.5 text-xs rounded bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteEntry(tapMapIdx);
                        }}
                        title="Delete section"
                      >
                        Del
                      </button>
                      <button
                        data-section-row-menu
                        className="px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenIdx(
                            menuOpenIdx === tapMapIdx ? null : tapMapIdx,
                          );
                        }}
                        title="More actions"
                      >
                        ⋯
                      </button>
                      {menuOpenIdx === tapMapIdx && (() => {
                        const beatCount = countInSection(tapMapIdx, ['beat']);
                        const measureCount = countInSection(tapMapIdx, ['measure']);
                        const subCount = beatCount + measureCount;
                        const rows: Array<{
                          label: string;
                          count: number;
                          kinds: ('beat' | 'measure')[];
                        }> = [
                          { label: 'Delete all beats', count: beatCount, kinds: ['beat'] },
                          { label: 'Delete all measures', count: measureCount, kinds: ['measure'] },
                          { label: 'Delete all sub-markers', count: subCount, kinds: ['beat', 'measure'] },
                        ];
                        return (
                          <div
                            data-section-row-menu
                            className="absolute right-0 top-full mt-1 z-30 rounded border border-gray-600 bg-gray-800 shadow-lg text-xs text-gray-100 overflow-hidden"
                            style={{ minWidth: 200 }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-700">
                              In section {entry.label || '(unnamed)'}
                            </div>
                            {rows.map((r) => {
                              const disabled = r.count === 0;
                              return (
                                <button
                                  key={r.label}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => bulkDelete(tapMapIdx, r.kinds)}
                                  className={`w-full text-left px-2 py-1.5 flex items-center justify-between transition-colors ${
                                    disabled
                                      ? 'text-gray-500 cursor-default'
                                      : 'hover:bg-red-900/40 text-gray-100'
                                  }`}
                                >
                                  <span>{r.label}</span>
                                  <span className="text-[10px] text-gray-400 tabular-nums">
                                    {r.count}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
