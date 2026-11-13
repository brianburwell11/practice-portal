import { create } from 'zustand';
import type { MixerTemplate } from '../audio/types';
import type { MixerTemplateMix } from '../utils/mixerTemplates';

/**
 * The current band's mixer templates. Loaded on first use and tagged with the
 * band they belong to, so switching bands reloads instead of showing the
 * last band's list.
 */
interface MixerTemplateState {
  bandId: string | null;
  templates: MixerTemplate[];
  loading: boolean;
  error: string | null;
  /** Fetch the band's templates unless they're already loaded. `force` refetches. */
  load: (bandId: string, force?: boolean) => Promise<MixerTemplate[]>;
  /** Save under `name`, replacing a template that already has it (ignoring case). */
  save: (bandId: string, name: string, mix: MixerTemplateMix) => Promise<MixerTemplate>;
  remove: (bandId: string, id: string) => Promise<void>;
  setDefault: (bandId: string, id: string, isDefault: boolean) => Promise<void>;
}

const base = (bandId: string) => `/api/bands/${encodeURIComponent(bandId)}/mixer-templates`;

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

const byName = (a: MixerTemplate, b: MixerTemplate) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

let inflight: { bandId: string; promise: Promise<MixerTemplate[]> } | null = null;

export const useMixerTemplateStore = create<MixerTemplateState>((set, get) => ({
  bandId: null,
  templates: [],
  loading: false,
  error: null,

  load: async (bandId, force = false) => {
    if (!force && get().bandId === bandId && !get().error) return get().templates;
    if (inflight?.bandId === bandId) return inflight.promise;
    if (get().bandId !== bandId) set({ bandId, templates: [] });
    set({ loading: true, error: null });
    const promise = (async () => {
      try {
        const res = await fetch(base(bandId));
        if (!res.ok) throw await failure(res, 'Couldn’t load templates');
        const { templates } = await res.json() as { templates: MixerTemplate[] };
        if (get().bandId === bandId) set({ templates, loading: false });
        return templates;
      } catch (err) {
        if (get().bandId === bandId) set({ loading: false, error: (err as Error).message });
        throw err;
      } finally {
        if (inflight?.bandId === bandId) inflight = null;
      }
    })();
    inflight = { bandId, promise };
    return promise;
  },

  save: async (bandId, name, mix) => {
    const key = name.trim().toLowerCase();
    const existing = get().bandId === bandId
      ? get().templates.find((t) => t.name.trim().toLowerCase() === key)
      : undefined;
    const id = existing?.id ?? crypto.randomUUID();
    const res = await fetch(`${base(bandId)}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), ...mix }),
    });
    if (!res.ok) throw await failure(res, 'Save template failed');
    const { template } = await res.json() as { template: MixerTemplate };
    if (get().bandId === bandId) {
      set({ templates: [...get().templates.filter((t) => t.id !== id), template].sort(byName) });
    }
    return template;
  },

  remove: async (bandId, id) => {
    const res = await fetch(`${base(bandId)}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await failure(res, 'Delete template failed');
    if (get().bandId === bandId) set({ templates: get().templates.filter((t) => t.id !== id) });
  },

  setDefault: async (bandId, id, isDefault) => {
    const res = await fetch(`${base(bandId)}/${id}/default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault }),
    });
    if (!res.ok) throw await failure(res, 'Couldn’t change the default template');
    if (get().bandId === bandId) {
      set({
        templates: get().templates.map((t) => (
          t.id === id ? { ...t, isDefault } : isDefault ? { ...t, isDefault: false } : t
        )),
      });
    }
  },
}));

/** The band's default template, or null if none is starred (or loading fails). */
export async function loadDefaultMixerTemplate(bandId: string): Promise<MixerTemplate | null> {
  try {
    const templates = await useMixerTemplateStore.getState().load(bandId);
    return templates.find((t) => t.isDefault) ?? null;
  } catch {
    return null;
  }
}
