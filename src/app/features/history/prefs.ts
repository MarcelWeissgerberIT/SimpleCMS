/**
 * Version history — this device's view choices (localStorage, never synced):
 *   one.history.compare  'prev' | 'now'  what Changes compares a version with (default 'prev')
 *   one.history.markNew  '1' | '0'       Version marks what is new since the previous version (default on)
 * Storage can be missing or throw (private windows, blocked site data): the defaults apply then.
 */
export type CompareBase = 'prev' | 'now'

const COMPARE = 'one.history.compare'
const MARK_NEW = 'one.history.markNew'

export function readCompare(): CompareBase {
  try {
    return localStorage.getItem(COMPARE) === 'now' ? 'now' : 'prev'
  } catch {
    return 'prev'
  }
}

export function writeCompare(v: CompareBase): void {
  try {
    localStorage.setItem(COMPARE, v)
  } catch {
    /* kept for this dialog only */
  }
}

export function readMarkNew(): boolean {
  try {
    return localStorage.getItem(MARK_NEW) !== '0'
  } catch {
    return true
  }
}

export function writeMarkNew(v: boolean): void {
  try {
    localStorage.setItem(MARK_NEW, v ? '1' : '0')
  } catch {
    /* kept for this dialog only */
  }
}
