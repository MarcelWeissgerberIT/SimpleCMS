/**
 * Tiny hash router (GitHub Pages friendly).
 *   #/              → home (start page / last page)
 *   #/p/<id>        → page or database
 *   #/p/<id>?b=<blockId> → page, scroll to block
 *   #/graph         → graph view
 *   #/journal       → today's journal entry (created on demand)
 *   #/s/<payload>   → read-only shared page (payload = compressed page, see features/share)
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'page'; id: string; block?: string }
  | { name: 'graph' }
  | { name: 'journal' }
  | { name: 'share'; payload: string }
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
  if (parts[0] === 's' && parts[1]) return { name: 'share', payload: parts.slice(1).join('/') }
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
    case 'share':
      return `#/s/${r.payload}`
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
