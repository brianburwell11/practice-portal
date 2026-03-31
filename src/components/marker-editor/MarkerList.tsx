import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useSongStore } from '../../store/songStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { beatToSeconds } from '../../audio/tempoUtils';

export function MarkerList() {
  const engine = useAudioEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const { markers, editingMarkerIndex, beatOffset, setEditingMarker, deleteMarker } =
    useMarkerEditorStore();

  const handleClickRow = (index: number) => {
    if (!selectedSong) return;
    const seconds = beatToSeconds(
      markers[index].beat,
      selectedSong.tempoMap,
      beatOffset,
    );
    engine.seek(seconds);
  };

  if (markers.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic px-3 py-4">
        No markers yet. Click on the canvas to add one.
      </div>
    );
  }

  return (
    <div className="max-h-48 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
            <th className="py-1 px-3 text-left">Beat</th>
            <th className="py-1 px-3 text-left">Name</th>
            <th className="py-1 px-3 text-left">Color</th>
            <th className="py-1 px-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {markers.map((marker, index) => {
            const isEditing = editingMarkerIndex === index;
            return (
              <tr
                key={`${marker.beat}-${marker.name}`}
                className={`border-b border-gray-700/50 cursor-pointer transition-colors ${
                  isEditing
                    ? 'bg-blue-900/30'
                    : 'hover:bg-gray-700/50'
                }`}
                onClick={() => handleClickRow(index)}
              >
                <td className="py-1.5 px-3 font-mono text-gray-300">
                  {marker.beat}
                </td>
                <td className="py-1.5 px-3 text-gray-200">{marker.name}</td>
                <td className="py-1.5 px-3">
                  <span
                    className="inline-block w-4 h-4 rounded"
                    style={{ backgroundColor: marker.color }}
                  />
                </td>
                <td className="py-1.5 px-3 text-right">
                  <button
                    className="px-2 py-0.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors mr-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingMarker(index);
                    }}
                    title="Edit marker"
                  >
                    Edit
                  </button>
                  <button
                    className="px-2 py-0.5 text-xs rounded bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMarker(index);
                    }}
                    title="Delete marker"
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
  );
}
