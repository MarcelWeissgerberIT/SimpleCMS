/**
 * Per-field trust — the run review's keys (the agent page), the same map as Preflight's queue: A / ↵ apply, D / Del /
 * ⌫ discard without a reason, 1 (or F in German, W in English) wrong, 2 not now, 3 duplicate, 4 handled already, Z the
 * row's Undo, J / N / ↓ next row, K / ↑ previous. Never with Alt / Ctrl / ⌘ or Shift, never on a repeat; ↵ only on the
 * row itself (Enter on a button is that button's own click). Any other letter (E, H …) does nothing. Pure.
 */
import type { Lang } from '@/shared/i18n'
import type { DiscardReason } from '../../ai/agent/types'
import { reasonKeys, reasonOfKey, wrongLetter } from './reasons'

export type RunKey = { kind: 'next' } | { kind: 'prev' } | { kind: 'apply' } | { kind: 'discard'; reason: DiscardReason | null } | { kind: 'undo' }

export interface KeyLike {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
}

/** What a key does in the run review (null: not one of its keys). `onRow`: the target is the row itself. */
export function runKeyOf(e: KeyLike, lang: Lang, onRow: boolean): RunKey | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return null
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (k === 'j' || k === 'n' || k === 'ArrowDown') return { kind: 'next' }
  if (k === 'k' || k === 'ArrowUp') return { kind: 'prev' }
  if (k === 'a' || (k === 'Enter' && onRow)) return { kind: 'apply' }
  if (k === 'd' || k === 'Delete' || k === 'Backspace') return { kind: 'discard', reason: null }
  if (k === 'z') return { kind: 'undo' }
  const reason = reasonOfKey(k, lang)
  return reason ? { kind: 'discard', reason } : null
}

/** aria-keyshortcuts of an open proposal's row / of a decided row with an Undo. */
export function rowShortcuts(lang: Lang, open: boolean): string {
  if (!open) return 'Z J K'
  const r = reasonKeys(lang)
  return ['Enter', 'A', 'Delete', 'D', ...r.wrong.map((x) => x.toUpperCase()), ...r.notNow, ...r.duplicate, ...r.done, 'J', 'K'].join(' ')
}

export { wrongLetter }
