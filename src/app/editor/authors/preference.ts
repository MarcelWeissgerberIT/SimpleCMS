import { create } from 'zustand'
const KEY = 'one:block-authors:view:v1'
function initial(): boolean {
  try { return localStorage.getItem(KEY) === 'on' } catch { return false }
}
/** This browser's view preference; never part of a shared page or an exported workspace. */
export const useBlockAuthors = create<{ enabled: boolean; set: (enabled: boolean) => void }>(set => ({
  enabled: initial(),
  set: enabled => {
    set({ enabled })
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off') } catch { /* usable without storage */ }
  },
}))
