/**
 * Putting the workspace look on the page (DOM): the generated colour stylesheet `<style id="one-look">`, the
 * static type / corner rules of look.css keyed on `html[data-look-*]`, the browser's theme colour — plus the
 * per-device parts that never leave this browser (localStorage `one.look`):
 *  - the pre-paint cache: the last saved look per workspace (scope 'local' or the cloud workspace id) and the
 *    boot screen's paint colours (public/look-boot.js reads only those, hex only);
 *  - "Use the standard look on this device" (per workspace; never evicted).
 * Share and form links (#/s, #/f) always show One's standard look. Every look goes through sanitizeLook here
 * again (defence in depth) — a broken value is dropped with a warning, never an error.
 */
import './look.css'
import { useEffect, useSyncExternalStore } from 'react'
import type { WorkspaceLook } from '../../store/types'
import { sanitizeLook, STOCK_COLORS } from '../../store/look'
import { lookCss } from './css'
import { deriveLook, signalFamily } from './derive'

export const LOOK_CACHE_KEY = 'one.look'
const STYLE_ID = 'one-look'
const MAX_SCOPES = 20
const HEX = /^#[0-9a-f]{6}$/

/* ------------------------------------------------------------------ apply */

function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

let appliedKey: string | null = null
const appliedListeners = new Set<() => void>()

function setData(name: string, value: string | null) {
  const html = document.documentElement
  if (value === null) delete html.dataset[name]
  else html.dataset[name] = value
}

function themeColors(light: string | null, dark: string | null) {
  for (const meta of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
    const media = meta.getAttribute('media') ?? ''
    const want = media.includes('dark') ? dark : light
    if (meta.dataset.std === undefined) meta.dataset.std = meta.content
    meta.content = want ?? meta.dataset.std
  }
}

/** Show a look (null = One's standard look). Idempotent: the same look again changes nothing. */
export function applyLook(input: WorkspaceLook | null): void {
  try {
    const look = sanitizeLook(input)
    const key = look ? JSON.stringify([look.colors, look.dark ?? null, look.fonts, look.corners]) : ''
    if (key === appliedKey) return
    appliedKey = key
    const css = look ? lookCss(look) : ''
    let style = document.getElementById(STYLE_ID)
    if (css) {
      if (!style) {
        style = document.createElement('style')
        style.id = STYLE_ID
        document.head.append(style)
      }
      style.textContent = css
    } else style?.remove()
    setData('look', look ? fnv(key) : null)
    setData('lookUi', look && look.fonts.ui !== 'archivo' ? look.fonts.ui : null)
    setData('lookText', look && look.fonts.text !== 'ui' ? look.fonts.text : null)
    setData('lookHeadings', look && look.fonts.headings !== 'expanded' ? look.fonts.headings : null)
    setData('lookCorners', look && look.corners !== 'standard' ? look.corners : null)
    const d = look && css ? deriveLook(look) : null
    const family = d && d.light.emits.signal ? signalFamily(d.light.full.signal) : null
    setData('lookFamily', family)
    themeColors(d?.light.emits.paper ? d.light.full.bg : null, d?.dark.emits.paper ? d.dark.full.bg : null)
    // the boot screen's colours (public/look-boot.js) have done their job
    for (const v of ['--boot-bg', '--boot-ink', '--boot-led']) document.documentElement.style.removeProperty(v)
    for (const fn of appliedListeners) fn()
  } catch (e) {
    console.warn('[one] the workspace look could not be applied', e)
  }
}

/** The signal's content-colour family while a look with its own signal is shown (charts keep series apart). */
export function appliedFamily(): string | null {
  return typeof document === 'undefined' ? null : (document.documentElement.dataset.lookFamily ?? null)
}

function subscribeApplied(fn: () => void): () => void {
  appliedListeners.add(fn)
  return () => appliedListeners.delete(fn)
}

/** appliedFamily(), live. */
export function useLookFamily(): string | null {
  return useSyncExternalStore(subscribeApplied, appliedFamily, () => null)
}

/* ------------------------------------------------------------------ per-device cache */

interface Paint {
  bg: string
  ink3: string
  signal: string
}
interface CacheEntry {
  look?: WorkspaceLook
  standard?: true
  paint?: { light: Paint; dark: Paint }
  at: number
}
interface Cache {
  v: 1
  ws: Record<string, CacheEntry>
}

const SCOPE = /^[A-Za-z0-9_-]{1,64}$/
const cacheListeners = new Set<() => void>()

function readCache(): Cache {
  const out: Cache = { v: 1, ws: {} }
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOOK_CACHE_KEY) ?? 'null') as unknown
    const ws = raw && typeof raw === 'object' && (raw as { ws?: unknown }).ws
    if (!ws || typeof ws !== 'object') return out
    for (const [scope, e] of Object.entries(ws as Record<string, unknown>)) {
      if (!SCOPE.test(scope) || !e || typeof e !== 'object') continue
      const v = e as Record<string, unknown>
      const entry: CacheEntry = { at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0 }
      const look = sanitizeLook(v.look)
      if (look) entry.look = look
      if (v.standard === true) entry.standard = true
      if (look) entry.paint = paintOf(look)
      if (entry.look || entry.standard) out.ws[scope] = entry
    }
  } catch {
    /* blocked or broken storage: no cache */
  }
  return out
}

function writeCache(c: Cache) {
  const scopes = Object.entries(c.ws)
  // keep the most recent scopes; a "standard look here" choice is never dropped
  if (scopes.length > MAX_SCOPES) {
    const drop = scopes
      .filter(([, e]) => !e.standard)
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, scopes.length - MAX_SCOPES)
    for (const [scope] of drop) delete c.ws[scope]
  }
  try {
    if (Object.keys(c.ws).length) window.localStorage.setItem(LOOK_CACHE_KEY, JSON.stringify(c))
    else window.localStorage.removeItem(LOOK_CACHE_KEY)
  } catch {
    /* blocked storage: applied after load instead of before the first paint */
  }
  for (const fn of cacheListeners) fn()
}

/** The boot screen's colours (bg, quiet text, LED) per theme — hex only. */
function paintOf(look: WorkspaceLook): { light: Paint; dark: Paint } | undefined {
  const d = deriveLook(look)
  const p = (m: 'light' | 'dark'): Paint => ({ bg: d[m].full.bg, ink3: d[m].full['ink-3'], signal: d[m].full.signal })
  const out = { light: p('light'), dark: p('dark') }
  return [out.light, out.dark].every((x) => HEX.test(x.bg) && HEX.test(x.ink3) && HEX.test(x.signal)) ? out : undefined
}

/** Remember the SAVED look of a workspace for the next start (never a draft). */
export function rememberLook(scope: string, look: WorkspaceLook | null): void {
  if (!SCOPE.test(scope)) return
  const c = readCache()
  const cur = c.ws[scope]
  const clean = sanitizeLook(look)
  if (!clean && !cur?.standard) {
    if (!cur) return
    delete c.ws[scope]
  } else {
    const next: CacheEntry = { at: Date.now() }
    if (clean) {
      next.look = clean
      next.paint = paintOf(clean)
    }
    if (cur?.standard) next.standard = true
    if (cur && JSON.stringify(cur.look ?? null) === JSON.stringify(next.look ?? null)) return
    c.ws[scope] = next
  }
  writeCache(c)
}

export function isStandardHere(scope: string): boolean {
  return !!readCache().ws[scope]?.standard
}

/** "Use the standard look on this device" for one workspace. */
export function setStandardHere(scope: string, on: boolean): void {
  if (!SCOPE.test(scope)) return
  const c = readCache()
  const cur = c.ws[scope] ?? { at: Date.now() }
  if (on) cur.standard = true
  else delete cur.standard
  cur.at = Date.now()
  if (cur.look || cur.standard) c.ws[scope] = cur
  else delete c.ws[scope]
  writeCache(c)
}

/** Drop the cache of one workspace (removing its copy from this browser) or everything ('all'). */
export function forgetLookCache(scope: string | 'all'): void {
  if (scope === 'all') {
    try {
      window.localStorage.removeItem(LOOK_CACHE_KEY)
    } catch {
      /* nothing stored */
    }
    for (const fn of cacheListeners) fn()
    return
  }
  const c = readCache()
  if (!c.ws[scope]) return
  delete c.ws[scope]
  writeCache(c)
}

function subscribeCache(fn: () => void): () => void {
  cacheListeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOOK_CACHE_KEY || e.key === null) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    cacheListeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** isStandardHere(scope), live (both settings places and other tabs stay in step). */
export function useStandardHere(scope: string): boolean {
  return useSyncExternalStore(
    subscribeCache,
    () => isStandardHere(scope),
    () => false,
  )
}

/** Before the first paint (main.tsx): the cached look of the workspace this tab is about to open. */
export function applyCachedLook(scope: string): void {
  try {
    const hash = window.location.hash
    if (hash.startsWith('#/s/') || hash.startsWith('#/f/')) return
    const e = readCache().ws[scope]
    if (!e || e.standard || !e.look) return
    applyLook(e.look)
  } catch {
    /* no cache: applied once the workspace is loaded */
  }
}

/* ------------------------------------------------------------------ preview (an unsaved draft, this tab only) */

/** undefined = no preview · null = previewing the standard look · a look = previewing it */
let preview: WorkspaceLook | null | undefined = undefined
let previewTimer: number | undefined
let pending: WorkspaceLook | null | undefined = undefined
const previewListeners = new Set<() => void>()

/**
 * Preview a draft app-wide (or stop: undefined). Drafts from a colour picker arrive many times a second:
 * the app follows ~8 times a second at most (the preview plates in the Look section follow every value).
 */
export function setLookPreview(next: WorkspaceLook | null | undefined): void {
  pending = next
  if (next === undefined) {
    window.clearTimeout(previewTimer)
    previewTimer = undefined
    commitPreview()
    return
  }
  if (previewTimer !== undefined) return
  previewTimer = window.setTimeout(() => {
    previewTimer = undefined
    commitPreview()
  }, 120)
}

function commitPreview() {
  if (pending === preview) return
  preview = pending
  for (const fn of previewListeners) fn()
}

export function useLookPreview(): WorkspaceLook | null | undefined {
  return useSyncExternalStore(
    (fn) => {
      previewListeners.add(fn)
      return () => previewListeners.delete(fn)
    },
    () => preview,
    () => undefined,
  )
}

/* ------------------------------------------------------------------ the app's hook */

/**
 * Mount once (App.tsx): shows the saved look of the open workspace — or the preview of an unsaved draft, or
 * the standard look on share / form routes and where "standard look on this device" is on — and keeps the
 * per-device cache in step with the SAVED look.
 */
export function useWorkspaceLook(opts: { route: string; scope: string; look: WorkspaceLook | null; ready: boolean; persist: boolean }): void {
  const draft = useLookPreview()
  const standard = useStandardHere(opts.scope)
  const off = opts.route === 'share' || opts.route === 'form'
  const shown = off ? null : draft !== undefined ? draft : standard ? null : opts.look
  // until the workspace is loaded the pre-paint look (main.tsx) stays
  const waiting = !opts.ready && !off && draft === undefined && !standard
  useEffect(() => {
    if (!waiting) applyLook(shown)
  }, [shown, waiting])
  useEffect(() => {
    if (opts.ready && opts.persist && !off) rememberLook(opts.scope, opts.look)
  }, [opts.ready, opts.persist, opts.scope, opts.look, off])
}

/** Stock signal of a theme (the standard look's preview). */
export const stockSignal = (mode: 'light' | 'dark') => STOCK_COLORS[mode].signal
