import { useEffect, useMemo } from 'react'
import { setPresencePage, useCloud, type Peer } from '../../cloud'
import type { Route } from '../../lib/router'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { Avatar } from './Avatar'

const MAX = 4

/** Tell the others which page the main column shows (null off pages and on leaving). */
export function usePresenceSync(route: Route): void {
  const pageId = route.name === 'page' ? route.id : null
  useEffect(() => {
    setPresencePage(pageId)
  }, [pageId])
  useEffect(() => () => setPresencePage(null), [])
}

/** One entry per person (the same person may have several tabs open). */
function uniquePeople(peers: Peer[]): Peer[] {
  const seen = new Set<string>()
  return peers.filter((p) => (seen.has(p.userId) ? false : (seen.add(p.userId), true)))
}

/** Topbar: who else is on this page — overlapping initials, at most four, then "+N". */
export function PresenceStack({ pageId }: { pageId: string | null }) {
  const t = useT()
  const peers = useCloud((s) => s.peers)
  const here = useMemo(() => (pageId ? uniquePeople(peers.filter((p) => p.pageId === pageId)) : []), [peers, pageId])
  if (!here.length) return null
  const shown = here.slice(0, MAX)
  const rest = here.length - shown.length
  const names = here.map((p) => p.name).join(', ')
  return (
    <span className="cl-peers" role="group" tabIndex={0} aria-label={`${t('shell.cloud.presence.label')}: ${names}`} data-testid="presence">
      {shown.map((p) => (
        <Tooltip key={p.userId} label={p.name}>
          <span className="cl-peers__item">
            <Avatar name={p.name} id={p.userId} color={p.color} />
          </span>
        </Tooltip>
      ))}
      {rest > 0 && (
        <Tooltip label={t('shell.cloud.presence.more', { n: rest })}>
          <span className="cl-peers__more">+{rest}</span>
        </Tooltip>
      )}
    </span>
  )
}

/** Sidebar tree: the presence colour of someone else viewing this page, or null. */
export function usePeerOnPage(pageId: string): string | null {
  return useCloud((s) => {
    for (const p of s.peers) if (p.pageId === pageId) return p.color || 'var(--led-on)'
    return null
  })
}

/** Names of the others on a page (sidebar LED tooltip). */
export function peerNamesOn(pageId: string): string {
  return uniquePeople(useCloud.getState().peers.filter((p) => p.pageId === pageId))
    .map((p) => p.name)
    .join(', ')
}
