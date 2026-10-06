/**
 * Tiny hash router (GitHub Pages friendly).
 *   #/              → home (start page / last page)
 *   #/p/<id>        → page or database
 *   #/p/<id>?b=<blockId> → page, scroll to block
 *   #/graph         → graph view
 *   #/journal       → today's journal entry (created on demand)
 *   #/agenda        → workspace agenda (every dated row, journal entry and date mention)
 *   #/inbox         → inbox: reminders, mentions, assignments, comment replies (see shell/inbox)
 *   #/agents        → custom agents (features/agents) · #/agents/<id> → one agent: its runs and review
 *   #/scripts       → One Script (features/script) · #/scripts/<id> → one script's workbench
 *   #/discover      → "What can One do?" — the feature cards (shell/discover)
 *   #/s/<payload>   → read-only shared page (payload = compressed page, see features/share)
 *   #/clip?url=…&title=…&text=… → clip a web page into the Inbox, then replaced by #/p/<new page>
 *   #/clip?share=<id> → files shared into the installed app (the service worker kept them, see public/sw.js)
 *   #/invite/<token> → join a team workspace (preview, sign in if needed, accept; see shell/cloud)
 *   #/signup/<token> → create an account with a registration link (team cloud; see shell/cloud)
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'page'; id: string; block?: string }
  | { name: 'graph' }
  | { name: 'journal' }
  /** #/agenda → one calendar for everything dated in the workspace (see shell/agenda) */
  | { name: 'agenda' }
  /** #/inbox → this device's inbox (see features/inbox, shell/inbox) */
  | { name: 'inbox' }
  /** #/agents → custom agents · #/agents/<id> → one agent (see features/agents) */
  | { name: 'agents'; id?: string }
  /** #/scripts → scripts and queries · #/scripts/<id> → one script (see features/script) */
  | { name: 'scripts'; id?: string }
  /** #/discover → "What can One do?" (see shell/discover) */
  | { name: 'discover' }
  | { name: 'share'; payload: string }
  /** #/f/<payload> → public form (payload = compressed form schema, see database/form/codec) */
  | { name: 'form'; payload: string }
  /**
   * #/clip?url=…&title=…&text=…&desc=… → save a web page to the Inbox (bookmarklet, share target; see shell/capture)
   * · share = the id of what the share target's service worker stored (files + texts, IndexedDB `one-share`)
   */
  | { name: 'clip'; url: string; title: string; text: string; desc: string; share?: string }
  /** #/invite/<token> → team-cloud invitation (link from POST /api/workspaces/:id/invites) */
  | { name: 'invite'; token: string }
  /** #/signup/<token> → team-cloud registration link (from POST /api/server/signup-links) */
  | { name: 'signup'; token: string }
  | { name: 'notfound'; path: string }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'home' }
  if (parts[0] === 'p' && parts[1]) return { name: 'page', id: parts[1], block: params.get('b') ?? undefined }
  if (parts[0] === 'graph') return { name: 'graph' }
  if (parts[0] === 'journal') return { name: 'journal' }
  if (parts[0] === 'agenda') return { name: 'agenda' }
  if (parts[0] === 'inbox') return { name: 'inbox' }
  if (parts[0] === 'agents') return parts[1] ? { name: 'agents', id: parts[1] } : { name: 'agents' }
  if (parts[0] === 'scripts') return parts[1] ? { name: 'scripts', id: parts[1] } : { name: 'scripts' }
  if (parts[0] === 'discover') return { name: 'discover' }
  if (parts[0] === 's' && parts[1]) return { name: 'share', payload: parts.slice(1).join('/') }
  if (parts[0] === 'f' && parts[1]) return { name: 'form', payload: parts.slice(1).join('/') }
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', token: parts[1] }
  if (parts[0] === 'signup' && parts[1]) return { name: 'signup', token: parts[1] }
  if (parts[0] === 'clip') {
    // the whole query (a stray unencoded "?" in a shared URL must not cut it short)
    const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '')
    const share = q.get('share')
    return { name: 'clip', url: q.get('url') ?? '', title: q.get('title') ?? '', text: q.get('text') ?? '', desc: q.get('desc') ?? '', ...(share ? { share } : {}) }
  }
  return { name: 'notfound', path }
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/'
    case 'page':
      return `#/p/${r.id}${r.block ? `?b=${r.block}` : ''}`
    case 'graph':
      return '#/graph'
    case 'journal':
      return '#/journal'
    case 'agenda':
      return '#/agenda'
    case 'inbox':
      return '#/inbox'
    case 'agents':
      return r.id ? `#/agents/${r.id}` : '#/agents'
    case 'scripts':
      return r.id ? `#/scripts/${r.id}` : '#/scripts'
    case 'discover':
      return '#/discover'
    case 'share':
      return `#/s/${r.payload}`
    case 'form':
      return `#/f/${r.payload}`
    case 'invite':
      return `#/invite/${r.token}`
    case 'signup':
      return `#/signup/${r.token}`
    case 'clip': {
      const q = new URLSearchParams()
      for (const k of ['url', 'title', 'text', 'desc', 'share'] as const) if (r[k]) q.set(k, r[k]!)
      const qs = q.toString()
      return `#/clip${qs ? `?${qs}` : ''}`
    }
    default:
      return '#/'
  }
}

export function pageHref(id: string, block?: string): string {
  return routeHref({ name: 'page', id, block })
}

export function navigate(r: Route | string, opts: { replace?: boolean } = {}): void {
  const href = typeof r === 'string' ? r : routeHref(r)
  if (opts.replace) {
    history.replaceState(null, '', href)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else if (window.location.hash !== href) {
    window.location.hash = href
  }
}

export function openPage(id: string, block?: string): void {
  navigate({ name: 'page', id, block })
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

let lastHash = ''
let lastRoute: Route = { name: 'home' }
function getSnapshot(): Route {
  const h = window.location.hash
  if (h !== lastHash) {
    lastHash = h
    lastRoute = parseHash(h)
  }
  return lastRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
