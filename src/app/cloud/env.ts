/**
 * Small browser helpers for the cloud area: guarded localStorage, the remembered workspace choice
 * (per browser, `?w=<id>` overrides it for one tab), the last known session (for offline boots)
 * and the user's colour.
 */
import { COLOR_NAMES, type ColorName } from '../store/types'
import type { CloudUser, CloudWorkspace, WorkspaceRef } from './state'

/** The app base ('/' on a cloud server). API paths are resolved against it. */
export const BASE = import.meta.env.BASE_URL

/** Only a build served from the site root talks to a server — the GitHub Pages build (/SimpleCMS/) never does. */
export const SERVER_CAPABLE = BASE === '/'

export const WS_ID = /^[A-Za-z0-9_-]{8,64}$/
export const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

const CHOICE_KEY = 'one.cloud.active'
const SESSION_KEY = 'one.cloud.session'

export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* blocked storage: the choice lasts for this tab only */
  }
}

const LOCAL: WorkspaceRef = { kind: 'local', id: 'local' }

function parseRef(raw: string | null): WorkspaceRef | null {
  if (!raw) return null
  if (raw === 'local') return LOCAL
  return WS_ID.test(raw) ? { kind: 'cloud', id: raw } : null
}

/** The workspace this tab should open: `?w=<id|local>` first, then the browser's remembered choice. */
export function readChoice(): WorkspaceRef {
  let override: string | null = null
  try {
    override = new URLSearchParams(window.location.search).get('w')
  } catch {
    /* no location */
  }
  return parseRef(override) ?? parseRef(lsGet(CHOICE_KEY)) ?? LOCAL
}

export function writeChoice(ref: WorkspaceRef): void {
  lsSet(CHOICE_KEY, ref.kind === 'local' ? 'local' : ref.id)
}

export interface SessionCache {
  user: CloudUser
  workspaces: CloudWorkspace[]
  at: number
}

/** The last answer of GET /api/me — lets a cloud workspace open while the server can't be reached. */
export function readSession(): SessionCache | null {
  try {
    const v = JSON.parse(lsGet(SESSION_KEY) ?? 'null') as SessionCache | null
    return v && v.user && typeof v.user.id === 'string' && Array.isArray(v.workspaces) ? v : null
  } catch {
    return null
  }
}

export function writeSession(v: SessionCache | null): void {
  lsSet(SESSION_KEY, v ? JSON.stringify(v) : null)
}

const PRESENCE_TONES: ColorName[] = COLOR_NAMES.filter((c) => c !== 'default' && c !== 'gray')

/** A stable colour per person: the ColorName (for tokens) and its CSS value. */
export function userTone(userId: string): ColorName {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return PRESENCE_TONES[Math.abs(h) % PRESENCE_TONES.length]
}

export const toneCss = (tone: ColorName) => `var(--c-${tone}-text)`

/** Display name: the account name, else the part of the address before the @. */
export function displayName(user: Pick<CloudUser, 'name' | 'email'>): string {
  return user.name.trim() || user.email.split('@')[0] || user.email
}

export const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/** Resolve after `ms` with `fallback` unless `p` settles first. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = window.setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      () => {
        window.clearTimeout(t)
        resolve(fallback)
      },
    )
  })
}
