/**
 * Per-device spreadsheet preferences (localStorage, never synced, never in the node attrs):
 *  - `one.sheets.autocomplete` — "AutoComplete cell values" ('0' = off; on by default)
 * Every open block follows a change at once, other tabs on the `storage` event.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'one.sheets.autocomplete'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let autoComplete: boolean | null = null

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    autoComplete = read()
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

const snapshot = () => (autoComplete ??= read())

/** AutoComplete of cell values from the same column while typing (default on). */
export const useAutoComplete = (): boolean => useSyncExternalStore(subscribe, snapshot, () => true)

export function setAutoComplete(on: boolean): void {
  autoComplete = on
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // private mode: this session only
  }
  listeners.forEach((fn) => fn())
}
