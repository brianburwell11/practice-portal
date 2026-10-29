import { create } from 'zustand';

/**
 * App-wide feedback: short toasts, and a confirm dialog that stands in for
 * `window.confirm`. `<DialogHost />` (mounted once, in main.tsx) renders
 * whatever is queued here.
 */

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for something that can't be undone. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface DialogState {
  toasts: Toast[];
  pending: PendingConfirm | null;
  dismissToast: (id: number) => void;
  settleConfirm: (ok: boolean) => void;
}

const TOAST_MS = 5000;
let nextId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  toasts: [],
  pending: null,
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  settleConfirm: (ok) => {
    get().pending?.resolve(ok);
    set({ pending: null });
  },
}));

/** Show a short message at the bottom of the screen. */
export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++;
  useDialogStore.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
  setTimeout(() => useDialogStore.getState().dismissToast(id), TOAST_MS);
}

/** Ask before doing something. Resolves true if the user confirms. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // A second ask while one is open answers the first with "no".
  useDialogStore.getState().pending?.resolve(false);
  return new Promise((resolve) => useDialogStore.setState({ pending: { ...options, resolve } }));
}

/** The common case: unsaved edits, about to be thrown away. */
export function confirmDiscard(message = 'You have unsaved changes.'): Promise<boolean> {
  return confirmDialog({ title: 'Discard changes?', message, confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
}
