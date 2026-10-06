/**
 * When this device last downloaded a full backup of a workspace (the export dialog's JSON backup of the
 * whole workspace). Per device + workspace in localStorage `one.backup.last` ({ "<kind>:<id>": { at, size } }),
 * never synced, never part of a backup. The workspace page (shell/workspace) shows it.
 */
import { useSyncExternalStore } from 'react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { activeWorkspace } from '../../cloud'

export const LAST_BACKUP_KEY = 'one.backup.last'

export interface LastBackup {
  at: number
  /** bytes of the downloaded file */
  size: number
}

type Store = Record<string, LastBackup>

const scope = () => {
  const ref = activeWorkspace()
  return `${ref.kind}:${ref.id}`
}

function read(): Store {
  try {
    const raw = JSON.parse(safeLocalGet(LAST_BACKUP_KEY) ?? 'null') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Store = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as Partial<LastBackup> | null
      if (e && typeof e.at === 'number' && Number.isFinite(e.at) && typeof e.size === 'number' && Number.isFinite(e.size)) out[k] = { at: e.at, size: e.size }
    }
    return out
  } catch {
    return {}
  }
}

const listeners = new Set<() => void>()

/** A full backup of the open workspace was downloaded just now. */
export function noteBackup(size: number): void {
  const all = read()
  all[scope()] = { at: Date.now(), size: Math.max(0, Math.round(size)) }
  safeLocalSet(LAST_BACKUP_KEY, JSON.stringify(all))
  listeners.forEach((l) => l())
}

/** The open workspace's last full backup from this device (null: none known). */
export function lastBackup(): LastBackup | null {
  return read()[scope()] ?? null
}

let cache: { key: string; raw: string | null; value: LastBackup | null } | null = null
function snapshot(): LastBackup | null {
  const key = scope()
  const raw = safeLocalGet(LAST_BACKUP_KEY)
  if (cache && cache.key === key && cache.raw === raw) return cache.value
  cache = { key, raw, value: read()[key] ?? null }
  return cache.value
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

export function useLastBackup(): LastBackup | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
