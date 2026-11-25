/**
 * The sheet music editor's copies of the scores opened in this browser: its
 * IndexedDB database (MuseEncore's `musescoreweb-scores`, see
 * vendor/muse-encore/editor/db.ts), with each score's file and autosave.
 * The editor no longer lists them, but they hold every band's scores opened
 * here, so they go on sign-out like the offline songs.
 */
const DB_NAME = 'musescoreweb-scores';

/** Deletes the editor's stored scores. Never throws; resolves once done (or blocked by an open editor). */
export function clearScoreEditorScores(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // An editor still open holds the database: it's deleted as soon as that closes (the page reloads next).
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
