/**
 * Links that belong to another site: Claude copies record links from an MCP server's results as
 * they come — often relative ("/r/11900"). Inside One such a link would open One's own site (a 404,
 * served as the landing page). They are resolved against the MCP server's link address instead:
 *  - the first enabled server with a `linkBase` (Settings → Claude AI → MCP servers), else
 *  - the only enabled server's own origin.
 * One's own links (#/p/…, #…) and absolute URLs (https:, mailto: …) are never touched.
 */
import { useWorkspace } from '../store/store'
import { toast } from '../store/ui'
import { t } from '../i18n'

/** A relative href that does not point into One: "/r/11900", "r/11900", "./x" — not "#…", not "//host", not "scheme:". */
export function isForeignRelative(href: string): boolean {
  const h = href.trim()
  if (!h || h.startsWith('#') || h.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false
  return true
}

/** A link address as a base ("https://kb.example.com/" — origin plus an optional path), or null. */
export function linkBaseOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`
    return `${u.origin}${path}`
  } catch {
    return null
  }
}

/** The address relative links of MCP results are resolved against (null: none known). */
export function foreignBase(): string | null {
  const list = useWorkspace.getState().settings.mcpServers
  const servers = (Array.isArray(list) ? list : []).filter((s) => s && typeof s === 'object' && s.enabled !== false && typeof s.url === 'string')
  for (const s of servers) {
    const base = linkBaseOf(s.linkBase)
    if (base) return base
  }
  if (servers.length !== 1) return null
  try {
    return `${new URL(servers[0].url).origin}/`
  } catch {
    return null
  }
}

/** The absolute URL a foreign relative href stands for (null: not foreign, or no base known). */
export function resolveForeign(href: string, base: string | null = foreignBase()): string | null {
  if (!isForeignRelative(href) || !base) return null
  const h = href.trim()
  try {
    // "/r/1" keeps the base's path in front ("https://kb.example/app/" + "r/1"), like a link from that site
    return new URL(h.replace(/^\/+/, ''), base).href
  } catch {
    return null
  }
}

/** Open a foreign relative link at its real address (or say why it can't be opened). */
export function openForeign(href: string): void {
  const url = resolveForeign(href)
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  toast({ message: t('editor.link.foreignUnknown', { href: href.trim().slice(0, 80) }), kind: 'error' })
}

let installed = false

/**
 * Clicks on links inside page content (editors, read-only copies, the link hover card): a foreign
 * relative link opens at the MCP server's address in a new tab instead of One's own site.
 */
export function installForeignLinks(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button > 1) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !a.closest('.ProseMirror, .link-hover, [data-content]')) return
      const href = a.getAttribute('href') ?? ''
      if (!isForeignRelative(href)) return
      // while editing, a plain click only places the caret (links open from the hover card or with Mod)
      if (a.closest('[contenteditable="true"]') && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      e.stopPropagation()
      openForeign(href)
    },
    true,
  )
}
