/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Opens and closes the "Adjust audio settings" popup (AudioLevelsPopup.tsx), in a React root of its own: the
 * editor's toolbar is the vendor's code, so the popup isn't part of its tree.
 */
import { createRoot, type Root } from 'react-dom/client'
import { AudioLevelsPopup } from './AudioLevelsPopup'

let s_root: Root | null = null
let s_container: HTMLElement | null = null

/** Opens the popup (or closes it, when it's open). */
export function toggleAudioLevels(): void {
    if (s_root) {
        closeAudioLevels()
        return
    }
    s_container = document.createElement('div')
    document.body.append(s_container)
    s_root = createRoot(s_container)
    s_root.render(<AudioLevelsPopup onClose={closeAudioLevels} />)
}

function closeAudioLevels(): void {
    const root = s_root
    const container = s_container
    if (!root) {
        return
    }
    s_root = null
    s_container = null
    // After the event that closed it: a root isn't unmounted while it renders.
    queueMicrotask(() => {
        root.unmount()
        container?.remove()
    })
}
