import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixerTemplate } from '../../audio/types';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useBandStore } from '../../store/bandStore';
import { confirmDialog, toast } from '../../store/dialogStore';
import { useMixerStore } from '../../store/mixerStore';
import { useMixerTemplateStore } from '../../store/mixerTemplateStore';
import { useSongStore } from '../../store/songStore';
import { captureTemplate, matchTemplate, normalizeName } from '../../utils/mixerTemplates';
import { Modal } from '../ui/Modal';

/**
 * Mixer templates, next to the Save button: save the current mix under a
 * name, or apply a saved one to this song's mixer by matching track and stack
 * names. Applying only moves the faders; Save keeps them.
 */
export function MixerTemplateMenu() {
  const engine = useAudioEngine();
  const bandId = useBandStore((s) => s.currentBand?.id);
  const selectedSong = useSongStore((s) => s.selectedSong);
  const { templates, loading, error, load, save, remove, setDefault } = useMixerTemplateStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  const flash = useCallback((message: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(message);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
    setName('');
    if (bandId) load(bandId).catch(() => {});
  }, [bandId, load]);

  const replacing = useMemo(() => {
    const key = normalizeName(name);
    return key ? templates.find((t) => normalizeName(t.name) === key) : undefined;
  }, [name, templates]);

  const handleSave = useCallback(async () => {
    if (!bandId || !selectedSong || !name.trim()) return;
    if (replacing && !(await confirmDialog({
      title: `Replace “${replacing.name}”?`,
      message: 'It will hold the current mix instead.',
      confirmLabel: 'Replace',
    }))) return;
    const { stems, groups } = useMixerStore.getState();
    setSaving(true);
    try {
      const saved = await save(bandId, name, captureTemplate(selectedSong, stems, groups));
      setName('');
      toast(`Saved template “${saved.name}”`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }, [bandId, selectedSong, name, replacing, save]);

  const handleApply = useCallback((template: MixerTemplate) => {
    if (!selectedSong) return;
    const match = matchTemplate(template, selectedSong);
    const store = useMixerStore.getState();
    for (const [id, { volume, pan }] of match.stems) {
      store.setStemVolume(id, volume);
      engine.setStemVolume(id, volume);
      store.setStemPan(id, pan);
      engine.setStemPan(id, pan);
    }
    for (const [id, volume] of match.groups) {
      store.setGroupVolume(id, volume);
      engine.setGroupVolume(id, volume);
    }
    setOpen(false);
    flash(match.matched === 0
      ? `No channels matched “${template.name}”`
      : `Applied “${template.name}”: ${match.matched} of ${match.total} matched`);
  }, [selectedSong, engine, flash]);

  const handleDelete = useCallback(async (template: MixerTemplate) => {
    if (!bandId) return;
    if (!(await confirmDialog({ title: `Delete “${template.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await remove(bandId, template.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [bandId, remove]);

  const handleStar = useCallback(async (template: MixerTemplate) => {
    if (!bandId) return;
    try {
      await setDefault(bandId, template.id, !template.isDefault);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [bandId, setDefault]);

  if (!bandId || !selectedSong) return null;

  return (
    <>
      <button
        onClick={openMenu}
        className="flex items-center gap-1.5 text-xs px-2 py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors text-gray-500 hover:text-gray-300"
        title="Mixer templates"
        aria-label="Mixer templates"
        data-help="Load from mixer template"
        data-help-at="right"
      >
        {/* Sliders */}
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        {status && <span role="status" className="text-gray-300">{status}</span>}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} title="Mixer templates" showClose dismissible={!saving}>
          <form
            className="space-y-1.5"
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          >
            <label htmlFor="mixer-template-name" className="block text-xs font-medium text-gray-400">
              Save the current mix as a template
            </label>
            <div className="flex gap-2">
              <input
                id="mixer-template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Template name"
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-500"
              />
              <button
                type="submit"
                disabled={!name.trim() || saving}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-accent-ink"
              >
                {saving ? 'Saving...' : replacing ? 'Replace' : 'Save'}
              </button>
            </div>
            {replacing && <p className="text-xs text-gray-500">Replaces “{replacing.name}”.</p>}
          </form>

          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-400">Apply a template</p>
            {loading && templates.length === 0 && <p className="text-sm text-gray-500">Loading...</p>}
            {error && templates.length === 0 && <p className="text-sm text-red-400">{error}</p>}
            {!loading && !error && templates.length === 0 && (
              <p className="text-sm text-gray-500">No templates yet. Save the current mix to make one.</p>
            )}
            <ul className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
              {templates.map((t) => {
                const m = matchTemplate(t, selectedSong);
                return (
                  <li key={t.id} className="flex items-center gap-1 py-1">
                    <button
                      onClick={() => handleApply(t)}
                      className="flex-1 min-w-0 flex items-baseline gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800"
                      title={`Apply “${t.name}” to this mixer`}
                    >
                      <span className="truncate text-sm text-gray-100">{t.name}</span>
                      <span className="shrink-0 text-xs text-gray-500">{m.matched} of {m.total} match</span>
                    </button>
                    <button
                      onClick={() => handleStar(t)}
                      aria-pressed={t.isDefault}
                      title={t.isDefault ? 'Default for new tracks. Click to unset' : 'Make this the default for new tracks'}
                      aria-label={t.isDefault ? `Unset “${t.name}” as the default` : `Make “${t.name}” the default`}
                      className={`p-1.5 rounded hover:bg-gray-800 ${t.isDefault ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-300'}`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill={t.isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      title="Delete template"
                      aria-label={`Delete “${t.name}”`}
                      className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-xs text-gray-500">
            Templates match tracks and stacks by name, ignoring case. Applying moves the faders only. Press Save to keep the mix for this song. The starred template sets the starting mix for new tracks.
          </p>
        </Modal>
      )}
    </>
  );
}
