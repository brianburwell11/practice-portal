import { useState } from 'react';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { getSections } from '../../audio/tapMapUtils';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function SectionList() {
  const engine = useAudioEngine();
  const { tapMap, selectedIndex, deleteEntry, updateSectionLabel, setSelectedIndex } =
    useMarkerEditorStore();

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const sections = getSections(tapMap);

  // Map each section back to its index in the full tapMap
  const sectionIndices: number[] = [];
  for (let i = 0; i < tapMap.length; i++) {
    if (tapMap[i].type === 'section') {
      sectionIndices.push(i);
    }
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
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="py-1 px-3 text-left">Time</th>
              <th className="py-1 px-3 text-left">Label</th>
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
                  <td className="py-1.5 px-3 text-right">
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
