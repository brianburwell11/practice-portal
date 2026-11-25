/*
 * SPDX-License-Identifier: GPL-3.0-only
 * The editor's home screen here (in place of the vendor's home/ScoresPage.tsx, see score-editor/vite.config.ts): no
 * list of the scores opened in this browser. Each song's score opens from the song, and the list showed every band's
 * scores to whoever used the browser next. It's what shows before a song's score has opened, or after it's closed.
 */
export function ScoresPage(): React.JSX.Element {
    return (
        <div className="pp-no-score" role="status">
            No score is open. Close the editor and open the Sheet Music Editor from a song.
        </div>
    )
}
