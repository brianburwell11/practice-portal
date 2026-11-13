import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { useSongStore } from '../../store/songStore';
import { gangVolumes, useFaderSelectionStore } from '../../store/faderSelectionStore';
import { MAX_GAIN } from './VerticalFader';

type Engine = ReturnType<typeof useAudioEngine>;

/** Volumes of the selected faders when the current move began. */
let gesture: { leader: string; base: Record<string, number> } | null = null;
let pointerDown = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// A drag ends on pointer up; a scroll or arrow-key run ends after a pause.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  window.addEventListener('pointerup', () => { pointerDown = false; gesture = null; }, true);
  window.addEventListener('pointercancel', () => { pointerDown = false; gesture = null; }, true);
}

function volumeOf(key: string): number | undefined {
  const s = useMixerStore.getState();
  const [kind, id] = splitKey(key);
  return kind === 'stem' ? s.stems[id]?.volume : s.groups[id]?.volume;
}

function setVolumeOf(key: string, v: number, engine: Engine) {
  const s = useMixerStore.getState();
  const [kind, id] = splitKey(key);
  if (kind === 'stem') {
    s.setStemVolume(id, v);
    engine.setStemVolume(id, v);
  } else {
    s.setGroupVolume(id, v);
    engine.setGroupVolume(id, v);
  }
}

function defaultOf(key: string): number {
  const song = useSongStore.getState().selectedSong;
  const [kind, id] = splitKey(key);
  if (kind === 'stem') return song?.stems.find((x) => x.id === id)?.defaultVolume ?? 1;
  return song?.groups?.find((x) => x.id === id)?.defaultVolume ?? 1;
}

function splitKey(key: string): ['stem' | 'group', string] {
  const i = key.indexOf(':');
  return [key.slice(0, i) as 'stem' | 'group', key.slice(i + 1)];
}

/**
 * Selection and ganged volume for one desktop strip. `setVolume` moves just
 * this fader, or every selected fader by the same amount when this one is
 * part of a selection (same dB change, see `gangVolumes`).
 */
export function useFaderGang(key: string, setOwnVolume: (v: number) => void) {
  const engine = useAudioEngine();
  const selected = useFaderSelectionStore((s) => s.selected.includes(key));
  const ganged = useFaderSelectionStore((s) => s.selected.length > 1 && s.selected.includes(key));

  const setVolume = (v: number) => {
    if (!ganged) {
      setOwnVolume(v);
      return;
    }
    if (!gesture || gesture.leader !== key) {
      const base: Record<string, number> = {};
      for (const k of useFaderSelectionStore.getState().selected) {
        const cur = volumeOf(k);
        if (cur !== undefined) base[k] = cur;
      }
      gesture = { leader: key, base };
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pointerDown) gesture = null; }, 400);
    for (const [k, next] of Object.entries(gangVolumes(gesture.base, key, v, MAX_GAIN))) {
      setVolumeOf(k, next, engine);
    }
  };

  /** Double-click: every selected fader goes back to its own default. */
  const reset = (ownDefault: number) => {
    if (!ganged) {
      setOwnVolume(ownDefault);
      return;
    }
    gesture = null;
    for (const k of useFaderSelectionStore.getState().selected) setVolumeOf(k, defaultOf(k), engine);
  };

  /**
   * Pointer down anywhere on the strip. Cmd/ctrl or shift + click selects
   * instead of acting; a plain grab of an unselected fader drops the selection.
   */
  const onPointerDownCapture = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    const toggle = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    if (toggle || range) {
      // Typing into a readout keeps working with modifiers held.
      if (target.closest('input')) return;
      e.preventDefault();
      e.stopPropagation();
      useFaderSelectionStore.getState().click(key, { toggle, range });
      return;
    }
    if (!selected && target.closest('[data-fader]')) {
      const store = useFaderSelectionStore.getState();
      if (store.selected.length) store.clear();
    }
  };

  /** Click after a selecting pointer down: swallowed so buttons don't fire too. */
  const onClickCapture = (e: ReactMouseEvent) => {
    if ((e.metaKey || e.ctrlKey || e.shiftKey) && !(e.target as HTMLElement).closest('input')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** Ctrl + click on a Mac opens the context menu; it selects here instead. */
  const onContextMenu = (e: ReactMouseEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };

  return { selected, setVolume, reset, events: { onPointerDownCapture, onClickCapture, onContextMenu } };
}
