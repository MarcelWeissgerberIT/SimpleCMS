/**
 * AI terminal — prompt history (↑ / ↓, /history): the last 50 prompts per device and workspace in
 * localStorage. Never synced or exported; without storage it lives for this tab only.
 */
import { activeWorkspace } from '../../../cloud'

export const HISTORY_MAX = 50

const memory = new Map<string, string[]>()

function key(): string {
  const ws = activeWorkspace()
  return `one.term.history:${ws.kind}:${ws.id}`
}

export function loadHistory(): string[] {
  const k = key()
  try {
    const raw = window.localStorage.getItem(k)
    const list: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(list)) return list.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX)
  } catch {
    /* no storage */
  }
  return memory.get(k) ?? []
}

/** Remember a prompt (a repeat of the last one is not stored twice). Returns the new list. */
export function pushHistory(entry: string): string[] {
  const text = entry.trim()
  const list = loadHistory()
  if (!text || list[list.length - 1] === text) return list
  const next = [...list, text].slice(-HISTORY_MAX)
  const k = key()
  memory.set(k, next)
  try {
    window.localStorage.setItem(k, JSON.stringify(next))
  } catch {
    /* this tab only */
  }
  return next
}
