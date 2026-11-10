import { useEffect } from 'react';
import { usePanelMinimizeStore, type PanelId } from '../store/panelMinimizeStore';

/**
 * A single-letter shortcut that shows or hides a panel (minimizes it to the
 * ribbon, or brings it back). Not while typing, not with Cmd/Ctrl/Alt (so
 * Cmd+X stays cut), and only while `enabled`.
 */
export function usePanelShortcut(key: string, panel: PanelId, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const lower = key.toLowerCase();
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== lower) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      e.preventDefault();
      const store = usePanelMinimizeStore.getState();
      if (store.isPanelMinimized(panel)) store.restorePanel(panel);
      else store.minimizePanel(panel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, panel, enabled]);
}
