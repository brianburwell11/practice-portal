import { useDialogStore } from '../../store/dialogStore';
import { Modal } from './Modal';

/** Renders `confirmDialog()` and `toast()`. Mounted once, in main.tsx. */
export function DialogHost() {
  const { toasts, pending, dismissToast, settleConfirm } = useDialogStore();

  return (
    <>
      {pending && (
        <Modal onClose={() => settleConfirm(false)} title={pending.title} zClassName="z-[70]">
          {pending.message && <p className="text-sm text-gray-300">{pending.message}</p>}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => settleConfirm(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-100"
            >
              {pending.cancelLabel ?? 'Cancel'}
            </button>
            <button
              autoFocus
              onClick={() => settleConfirm(true)}
              className={`px-4 py-2 rounded text-sm font-medium text-white ${
                pending.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {pending.confirmLabel ?? 'OK'}
            </button>
          </div>
        </Modal>
      )}

      <div
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto w-full flex items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-xl border ${
              t.tone === 'error' ? 'bg-red-900/95 border-red-700 text-red-100' : 'bg-gray-800 border-gray-600 text-gray-100'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-gray-400 hover:text-white">
              &times;
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
