/**
 * Capture: the Inbox page, web clips (bookmarklet + PWA share target) and quick notes.
 *
 *  - The Inbox is a root page recognised by its id prefix — survives renames and moves,
 *    no setting needed. It is created on demand.
 *  - A clip arrives as #/clip?url=…&title=…&text=…&desc=… (bookmarklet) or as
 *    /app/?title=…&text=…&url=… (manifest share_target, rewritten to #/clip at boot).
 *    It becomes a page in the Inbox, and the route is REPLACED by the new page, so a reload
 *    or "back" never clips twice.
 */
import type { JSONContent } from '@tiptap/core'
import { format } from 'date-fns'
import { de as deLocale, enUS } from 'date-fns/locale'
import { plainText, useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import { flushSave } from '../../store/persistence'
import { toast } from '../../store/ui'
import { newId } from '../../lib/ids'
import { navigate, parseHash, routeHref, type Route } from '../../lib/router'
import { t } from '../../i18n'
import type { ID, PageIcon } from '../../store/types'
import { goToPage } from '../lib/actions'

export const INBOX_ID_PREFIX = 'inbx'
/** setContent origin for pages written by capture */
export const CLIP_ORIGIN = 'clip'
const INBOX_ICON: PageIcon = { type: 'asset', value: 'import' }
/** The same clip again within this window opens the first one (double click, re-run). */
const DEDUPE_MS = 60_000

const ws = () => useWorkspace.getState()
const isDe = () => ws().settings.language === 'de'

/* ------------------------------------------------------------------ */
/* Inbox                                                               */
/* ------------------------------------------------------------------ */

/** The Inbox page id, or null if there is none (yet) or it is in the trash. */
export function findInbox(): ID | null {
  const { pages } = ws()
  const live = Object.values(pages)
    .filter((p) => p.id.startsWith(INBOX_ID_PREFIX) && p.kind === 'page' && !p.databaseId && !isEffectivelyTrashed(pages, p.id))
    .sort((a, b) => a.createdAt - b.createdAt)
  return live[0]?.id ?? null
}

/** Find or create the Inbox (at the workspace root). */
export function ensureInbox(): ID {
  const found = findInbox()
  if (found) return found
  const id = ws().createPage({ id: `${INBOX_ID_PREFIX}${newId().slice(INBOX_ID_PREFIX.length)}`, parentId: null, title: t('shell.capture.inbox'), icon: INBOX_ICON })
  ws().setContent(id, { type: 'doc', content: [para(t('shell.capture.inboxIntro'))] }, CLIP_ORIGIN)
  return id
}

/**
 * List a captured page in the Inbox: a page-link block, newest first (above the first
 * existing page link; appended when there is none yet). Everything else stays as it is.
 */
function fileInInbox(inbox: ID, id: ID): void {
  const page = ws().pages[inbox]
  if (!page) return
  const blocks = [...(page.content?.content ?? [])]
  const at = blocks.findIndex((n) => n.type === 'pageLink')
  const link: JSONContent = { type: 'pageLink', attrs: { pageId: id } }
  if (at >= 0) blocks.splice(at, 0, link)
  else blocks.push(link)
  ws().setContent(inbox, { ...(page.content ?? {}), type: 'doc', content: blocks }, CLIP_ORIGIN)
}

/* ------------------------------------------------------------------ */
/* Doc helpers                                                         */
/* ------------------------------------------------------------------ */

const text = (s: string): JSONContent => ({ type: 'text', text: s })
const para = (s: string): JSONContent => (s ? { type: 'paragraph', content: [text(s)] } : { type: 'paragraph' })

/** Today as an inline date mention (same shape the editor's "@today" inserts). */
function dateMention(d: Date): JSONContent {
  const de = isDe()
  return {
    type: 'mention',
    attrs: { id: format(d, 'yyyy-MM-dd'), label: format(d, de ? 'd. MMMM yyyy' : 'MMMM d, yyyy', { locale: de ? deLocale : enUS }), kind: 'date' },
  }
}

/** Selected text → quote paragraphs (blank lines split paragraphs, single newlines become line breaks). */
function quoteParagraphs(s: string): JSONContent[] {
  return s
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0)
    .slice(0, 60)
    .map((lines) => ({ type: 'paragraph', content: lines.flatMap((l, i) => (i ? [{ type: 'hardBreak' }, text(l)] : [text(l)])) }))
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

export interface ClipInput {
  url?: string
  title?: string
  text?: string
  desc?: string
}

interface Clip {
  url: string
  /** title as sent (may be empty) */
  rawTitle: string
  /** page title (never empty) */
  title: string
  text: string
  desc: string
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/i

/** Only real web pages — never javascript:, data: … */
function webUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''
  } catch {
    return ''
  }
}

const clean = (s: string | undefined, max: number) => (s ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max)

export function normalizeClip(input: ClipInput): Clip {
  let url = webUrl(input.url ?? '')
  let body = clean(input.text, 12_000)
  // Android apps often share the link inside "text"
  if (!url) {
    const m = body.match(URL_IN_TEXT)
    if (m) {
      url = webUrl(m[0])
      if (url) body = body.replace(m[0], '').trim()
    }
  }
  const rawTitle = clean(input.title, 200).replace(/\s+/g, ' ')
  const domain = url ? new URL(url).hostname.replace(/^www\./, '') : ''
  const firstLine = body.split('\n')[0]?.slice(0, 80).trim() ?? ''
  const title = rawTitle || domain || firstLine || t('shell.capture.untitledClip')
  // a page title repeated as the "text" (some share sheets do that) is no quote
  if (body && body.replace(/\s+/g, ' ') === rawTitle) body = ''
  return { url, rawTitle, title, text: body, desc: clean(input.desc, 300).replace(/\s+/g, ' ') }
}

/**
 * "Clipped <date>" dateline, bookmark card, the selection as a quote, an empty line for notes.
 * (The dateline leads: a page opening on an atom block would show that block as selected.)
 */
export function clipDoc(c: Clip, now = new Date()): JSONContent {
  const content: JSONContent[] = [{ type: 'paragraph', content: [text(`${t('shell.capture.clipped')} `), dateMention(now)] }]
  if (c.url) content.push({ type: 'bookmark', attrs: { url: c.url, title: c.rawTitle || null, description: c.desc || null, image: null } })
  const quote = c.text ? quoteParagraphs(c.text) : []
  if (quote.length) content.push({ type: 'blockquote', content: quote })
  content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

/** A page in the Inbox created moments ago from the very same clip. */
function recentDuplicate(inbox: ID, c: Clip): ID | null {
  const since = Date.now() - DEDUPE_MS
  // plain text + bookmark url: block ids the editor adds later do not make it a different clip
  const plain = plainText(clipDoc(c))
  const bookmarkUrl = (d: JSONContent | null) => String(d?.content?.find((n) => n.type === 'bookmark')?.attrs?.url ?? '')
  const dup = Object.values(ws().pages).find(
    (p) => p.parentId === inbox && !p.trashed && p.createdAt >= since && p.title === c.title && (p.plain ?? '') === plain && bookmarkUrl(p.content) === c.url,
  )
  return dup?.id ?? null
}

/** Save a clip as a new page in the Inbox (or reuse an identical one from the last minute). Returns its id. */
export function clipToInbox(input: ClipInput): ID {
  const c = normalizeClip(input)
  const inbox = ensureInbox()
  const dup = recentDuplicate(inbox, c)
  if (dup) return dup
  const id = ws().createPage({ parentId: inbox, title: c.title })
  ws().setContent(id, clipDoc(c), CLIP_ORIGIN)
  fileInInbox(inbox, id)
  return id
}

/**
 * Handle the #/clip route: create the page, REPLACE the route with it, confirm with a toast.
 * Runs at most once per visit of the route (React StrictMode re-runs effects).
 */
export function runClipRoute(route: Extract<Route, { name: 'clip' }>): void {
  // the route was already handled (and replaced) — a re-run must not clip again
  if (parseHash(window.location.hash).name !== 'clip') return
  const c = normalizeClip(route)
  if (!c.url && !c.rawTitle && !c.text) {
    navigate({ name: 'home' }, { replace: true })
    toast({ message: t('shell.capture.nothing'), kind: 'error' })
    return
  }
  try {
    const id = clipToInbox(route)
    navigate({ name: 'page', id }, { replace: true })
    const inbox = findInbox()
    toast({
      message: t('shell.capture.clippedToast'),
      kind: 'success',
      action: inbox ? { label: t('shell.capture.openInbox'), run: () => goToPage(inbox) } : undefined,
    })
    // a clip tab is often closed right away: persist now, not on the next debounce
    void flushSave().catch(() => {})
  } catch (e) {
    console.error('[one] clip failed', e)
    navigate({ name: 'home' }, { replace: true })
    toast({ message: t('shell.capture.clipFailed'), kind: 'error' })
  }
}

/**
 * PWA share target (manifest share_target, method GET): the OS opens /app/?title=…&text=…&url=…
 * Rewrite that into the #/clip route before the app renders — one clip flow for both entries.
 */
export function consumeShareTarget(): boolean {
  const params = new URLSearchParams(window.location.search)
  const keys = ['url', 'title', 'text'] as const
  if (!keys.some((k) => params.has(k))) return false
  const route: Route = { name: 'clip', url: params.get('url') ?? '', title: params.get('title') ?? '', text: params.get('text') ?? '', desc: '' }
  // keep every other parameter exactly as it was (URLSearchParams would turn "?flag" into "?flag=")
  const rest = window.location.search
    .slice(1)
    .split('&')
    .filter((part) => part && !(keys as readonly string[]).includes(new URLSearchParams(part).keys().next().value ?? ''))
  history.replaceState(null, '', `${window.location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${routeHref(route)}`)
  return true
}

/* ------------------------------------------------------------------ */
/* Bookmarklet                                                         */
/* ------------------------------------------------------------------ */

/** This app's own URL (origin + path, no query/hash) — works under /SimpleCMS/ and on localhost. */
export function appUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}

/**
 * javascript: bookmarklet that opens <app>#/clip with the current page's URL, title,
 * selected text and meta description in a new tab.
 */
export function bookmarkletHref(app = appUrl()): string {
  const code =
    "(function(){var e=encodeURIComponent,d=document,s=String(window.getSelection?getSelection():'').trim().slice(0,4000)," +
    "m=d.querySelector('meta[property=\"og:description\"],meta[name=\"description\"]'),c=m&&m.content?m.content.slice(0,300):''," +
    `u=${JSON.stringify(app)}+'#/clip?url='+e(location.href)+'&title='+e(d.title)+(s?'&text='+e(s):'')+(c?'&desc='+e(c):'');` +
    "window.open(u,'_blank','noopener')})()"
  return `javascript:${encodeURI(code)}`
}

/* ------------------------------------------------------------------ */
/* Quick note                                                          */
/* ------------------------------------------------------------------ */

/** A timestamped page in the Inbox, opened with the caret in its body. */
export function quickNoteToInbox(): ID {
  const inbox = ensureInbox()
  const de = isDe()
  const stamp = format(new Date(), de ? 'd. MMM yyyy, HH:mm' : 'MMM d, yyyy, HH:mm', { locale: de ? deLocale : enUS })
  const id = ws().createPage({ parentId: inbox, title: t('shell.capture.noteTitle', { time: stamp }) })
  ws().setContent(id, { type: 'doc', content: [{ type: 'paragraph' }] }, CLIP_ORIGIN)
  fileInInbox(inbox, id)
  goToPage(id)
  focusBodyOf(id)
  return id
}

/** Put the caret into a page's editor once it is mounted (gives up after ~1.5 s). */
function focusBodyOf(id: ID, tries = 90): void {
  const el = document.querySelector<HTMLElement & { editor?: { isDestroyed: boolean; isEditable: boolean; commands: { focus: (p: 'end') => void } } }>(
    `#main .pv-content .ProseMirror[data-page-id="${id}"]`,
  )
  const ed = el?.editor
  if (ed && !ed.isDestroyed && ed.isEditable) {
    ed.commands.focus('end')
    return
  }
  if (tries > 0) requestAnimationFrame(() => focusBodyOf(id, tries - 1))
}
