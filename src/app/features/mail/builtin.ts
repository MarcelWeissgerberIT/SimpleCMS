/**
 * One's own Google OAuth client, registered once by the operator for getonecms.com: with it, "Connect Gmail"
 * is one click — no Google Cloud setup. A client ID is public (it identifies the app, it is not a secret), so
 * it ships in the bundle; One never uses a client secret.
 *
 * Google accepts the client only on the origins registered with it (BUILTIN_ORIGINS). Anywhere else — a local
 * copy, 127.0.0.1, a team server's own domain — there is no built-in client and Settings → Mail works exactly
 * as before: the person's own client ID. An own client ID always wins over the built-in one.
 *
 * Turning the feature on = setting BUILTIN_CLIENT_ID (and BUILTIN_ORIGINS, if more origins were registered).
 */
import { useSyncExternalStore } from 'react'
import { CLIENT_ID_RE } from './settings'
import type { MailSettings } from '../../store/types'

/** The operator's OAuth client ID ("123…-abc….apps.googleusercontent.com"). Empty = no built-in client. */
export const BUILTIN_CLIENT_ID: string = ''
/** The origins registered with it in Google's console ("Authorized JavaScript origins"). */
export const BUILTIN_ORIGINS: readonly string[] = ['https://getonecms.com']

export type MailClientSource = 'own' | 'builtin'

export interface MailClient {
  id: string
  source: MailClientSource
}

/* ------------------------------------------------------------------ test seam (?e2e only) */

/**
 * e2e and scripts/changelog-shots.mjs turn a built-in client on at 127.0.0.1 through the mail test hook
 * (`window.__oneMail.builtin(id)`, service.ts). Read and written only when the URL carries `?e2e` — a normal
 * visit never sees it, whatever localStorage holds.
 */
const TEST_KEY = 'one.mail.builtin-e2e'
const e2e = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')

function readTestId(): string | null {
  if (!e2e()) return null
  try {
    const v = window.localStorage.getItem(TEST_KEY)
    return v && CLIENT_ID_RE.test(v) ? v : null
  } catch {
    return null
  }
}

let testId = readTestId()
const listeners = new Set<() => void>()

/** Test hook only (?e2e): a built-in client ID for this origin, kept across reloads; null turns it off. */
export function setBuiltinForTests(id: string | null): void {
  if (!e2e()) return
  testId = id && CLIENT_ID_RE.test(id) ? id : null
  try {
    if (testId) window.localStorage.setItem(TEST_KEY, testId)
    else window.localStorage.removeItem(TEST_KEY)
  } catch {
    /* storage blocked: this page only */
  }
  listeners.forEach((l) => l())
}

/* ------------------------------------------------------------------ the client in use */

/** The built-in client ID when one is set and Google accepts it here (this origin is registered), else null. */
export function builtinClientId(): string | null {
  if (testId) return testId
  if (!CLIENT_ID_RE.test(BUILTIN_CLIENT_ID)) return null
  return typeof window !== 'undefined' && BUILTIN_ORIGINS.includes(window.location.origin) ? BUILTIN_CLIENT_ID : null
}

/** The client to sign in with: the person's own valid client ID, else the built-in one, else none. */
export function effectiveClient(cfg: Pick<MailSettings, 'clientId'>): MailClient | null {
  if (CLIENT_ID_RE.test(cfg.clientId)) return { id: cfg.clientId, source: 'own' }
  const id = builtinClientId()
  return id ? { id, source: 'builtin' } : null
}

export function effectiveClientId(cfg: Pick<MailSettings, 'clientId'>): string | null {
  return effectiveClient(cfg)?.id ?? null
}

/** React: is a built-in client available here (re-rendered when the test seam switches it)? */
export function useBuiltinClient(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => builtinClientId() !== null,
  )
}
