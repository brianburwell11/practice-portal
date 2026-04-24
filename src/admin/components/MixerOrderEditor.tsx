import { useState } from 'react';
import { resolveMixerOrder } from '../../audio/mixerOrder';

interface OrderableStem {
  id: string;
  label: string;
  color: string;
}
interface OrderableGroup {
  id: string;
  label: string;
  color: string;
  stemIds: string[];
}

interface OrderableSong {
  stems: OrderableStem[];
  groups?: OrderableGroup[];
  mixerOrder?: string[];
}

interface MixerOrderEditorProps {
  /**
   * Slice of a song-shaped object. Both the wizard's StemEntry/state
   * and a saved SongConfig satisfy this — only `id`, `label`, `color`
   * (and `stemIds` for groups) are read.
   */
  song: OrderableSong;
  onChange: (newOrder: string[]) => void;
}

/**
 * The reorder UI is only meaningful when there's at least one group
 * AND multiple top-level items to sort. Without groups, the stems
 * list itself is the order. Parents use this to decide whether to
 * render the whole section (heading included).
 */
export function shouldShowMixerOrderEditor(song: OrderableSong): boolean {
  if ((song.groups?.length ?? 0) === 0) return false;
  return resolveMixerOrder(song).length >= 2;
}

/**
 * Drag-to-reorder list of top-level mixer items (groups + ungrouped
 * stems). The resolved order is recomputed on every render via
 * `resolveMixerOrder`, so adding/removing stems or groups elsewhere
 * keeps this widget consistent without any extra plumbing.
 *
 * Hidden when there are fewer than 2 top-level items — nothing to
 * reorder.
 */
export function MixerOrderEditor({ song, onChange }: MixerOrderEditorProps) {
  const items = resolveMixerOrder(song);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  if (!shouldShowMixerOrderEditor(song)) return null;

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDropIdx(idx);
  };
  const onDragEnd = () => {
    if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
      const next = items.map((it) => it.id);
      const [moved] = next.splice(dragIdx, 1);
      next.splice(dropIdx, 0, moved);
      onChange(next);
    }
    setDragIdx(null);
    setDropIdx(null);
  };

  return (
    <div className="space-y-1">
        {items.map((item, i) => {
          const isGroup = item.kind === 'group';
          const label = isGroup ? item.group.label : item.stem.label;
          const color = isGroup ? item.group.color : item.stem.color;
          const memberCount = isGroup ? item.group.stemIds.length : 0;
          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 px-2 py-1.5 bg-gray-800 rounded text-sm transition-opacity ${
                dragIdx === i ? 'opacity-40' : ''
              } ${dropIdx === i && dragIdx !== null ? 'ring-1 ring-blue-500' : ''}`}
            >
              <span className="text-gray-600 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                &#x2630;
              </span>
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="flex-1 truncate text-gray-200">{label}</span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                {isGroup ? `Group · ${memberCount}` : 'Stem'}
              </span>
            </div>
          );
        })}
    </div>
  );
}
