import { useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { Modal } from '../ui/Modal';

const EXPECTED = 'delete my account';

/** Type the phrase, then delete: the same pattern as deleting a band. */
export function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const deleteAccount = useSessionStore((s) => s.deleteAccount);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmation === EXPECTED && !deleting;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      // Goes home on success.
      await deleteAccount();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Delete Account" titleClassName="text-lg font-semibold text-red-400" dismissible={!deleting}>
      <div className="text-sm text-gray-300 space-y-2">
        <p>
          This deletes your account and signs you out everywhere. You’ll leave every band you’re in, and your name,
          email and picture are removed.
        </p>
        <p>Songs and notes you added stay with their bands. Your notes will show as written by a band member.</p>
        <p className="text-red-400 font-medium">This action is irreversible.</p>
      </div>

      <div>
        <label htmlFor="delete-account-confirm" className="block text-sm text-gray-400 mb-1">
          Type <span className="font-mono text-gray-300">{EXPECTED}</span> to confirm:
        </label>
        <input
          id="delete-account-confirm"
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500"
          placeholder={EXPECTED}
          autoComplete="off"
          disabled={deleting}
        />
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          disabled={deleting}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={!canDelete}
          className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
        >
          {deleting ? 'Deleting...' : 'Delete Account'}
        </button>
      </div>
    </Modal>
  );
}
