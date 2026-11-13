import { useEffect, useMemo, useRef, useState } from 'react'
import { useCloud, loadWorkspacePresence, type WorkspacePresenceSnapshot, type Peer } from '../../cloud'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { Avatar } from './Avatar'
import { Users, X } from 'lucide-react'
import { Popover } from '../../ui/Popover'


// Presence itself (which page this tab shows) is published by the cloud core, which follows the route.

/** One entry per person (the same person may have several tabs open). */
function uniquePeople(peers: Peer[]): Peer[] {
  const seen = new Set<string>()
  return peers.filter((p) => (seen.has(p.userId) ? false : (seen.add(p.userId), true)))
}

/** Topbar: who else is on this page — overlapping initials, at most four (two on phones), then "+N". */
export function PresenceStack({ pageId, max = 4 }: { pageId: string | null; max?: number }) {
  const t = useT()
  const peers = useCloud((s) => s.peers)
  const userId = useCloud(s => s.user?.id)
  const here = useMemo(() => (pageId ? uniquePeople(peers.filter(p => p.userId !== userId && p.pageId === pageId)) : []), [peers, pageId, userId])
  if (!here.length) return null
  const shown = here.slice(0, max)
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
    for (const p of s.peers) if (p.userId !== s.user?.id && p.pageId === pageId) return p.color || 'var(--led-on)'
    return null
  })
}

/** Names of the others on a page (sidebar LED tooltip). */
export function peerNamesOn(pageId: string): string {
  return uniquePeople(useCloud.getState().peers.filter(p => p.userId !== useCloud.getState().user?.id && p.pageId === pageId))
    .map((p) => p.name)
    .join(', ')
}

/** Connection presence is intentionally not an activity tracker. No private page details are requested. */
export function WorkspacePresence({ pageId }: { pageId: string | null }) {
  const t = useT()
  const userId = useCloud(s => s.user?.id)
  const workspaceId = useCloud(s => s.active.kind === 'cloud' ? s.active.id : null)
  const supported = useCloud(s => s.supports?.includes('presence:1') ?? false)
  const online = useCloud(s => s.status === 'online')
  const peers = useCloud(s => s.peers)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<(WorkspacePresenceSnapshot & { context: string }) | null>(null)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    setSnapshot(null)
    setFailed(false)
    if (!supported || !online || !userId || !workspaceId) return
    let disposed = false
    let active: AbortController | null = null
    const poll = async () => {
      if (document.visibilityState === 'hidden') {
        active?.abort()
        setSnapshot(null)
        return
      }
      if (active) return
      const controller = new AbortController()
      active = controller
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        const result = await loadWorkspacePresence(controller.signal)
        if (!disposed) { setSnapshot({ ...result, context: `${userId}:${workspaceId}` }); setFailed(false) }
      } catch {
        if (!disposed) { setSnapshot(null); setFailed(true) }
      } finally {
        window.clearTimeout(timeout)
        active = null
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 15000)
    const visible = () => void poll()
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      active?.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [userId, workspaceId, supported, online, refresh])
  if (!workspaceId || !userId) return null
  // Never show a previous session's snapshot during a reconnect or unsupported-server fallback.
  const current = online && supported && snapshot?.context === `${userId}:${workspaceId}` ? snapshot : null
  const count = current ? new Set(current.workspaces.flatMap(w => w.people.map(p => p.id))).size : undefined
  const label = t('shell.cloud.presence.title')
  const close = () => {
    setOpen(false)
    if (document.activeElement?.closest('.cl-presence-panel')) anchor.current?.focus({ preventScroll: true })
  }
  return <>
    <Tooltip label={label}>
      <button ref={anchor} type="button" className="cl-presence-button" aria-label={label}
        aria-expanded={open} aria-haspopup="dialog" data-testid="workspace-presence"
        onClick={() => { setOpen(!open); if (!open) setRefresh(n => n + 1) }}>
        <Users size={16} aria-hidden /><span className="cl-presence-label" aria-hidden>{label}</span><span aria-hidden>{count ?? '–'}</span>
      </button>
    </Tooltip>
    <Popover open={open} onClose={close} anchor={anchor.current} placement="bottom-end"
      role="dialog" aria-label={label} className="cl-presence-panel">
      <div className="cl-presence-heading"><strong>{label}</strong>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}><X size={16} /></button>
      </div>
      <p>{t('shell.cloud.presence.explanation')}</p>
      {!current ? <p role="status">{t(!supported ? 'shell.cloud.presence.unsupported' : !online || failed ? 'shell.cloud.presence.unavailable' : 'shell.cloud.presence.loading')}</p> : <>
        {!current.workspaces.length && <p>{t('shell.cloud.presence.noShared')}</p>}
        {[...current.workspaces].sort((a, b) => Number(b.id === workspaceId) - Number(a.id === workspaceId)).map(w => <section key={w.id}>
          <h3>{w.name}{w.id === workspaceId && <small> · {t('shell.cloud.presence.current')}</small>}</h3>
          {w.people.length ? <ul>{w.people.map(person => <li key={person.id}>
            <Avatar name={person.name} id={person.id} />
            <span><strong>{person.name}</strong><small>{t(w.id === workspaceId && pageId && peers.some(p => p.userId === person.id && p.pageId === pageId)
              ? 'shell.cloud.presence.samePage' : 'shell.cloud.presence.connected')}</small></span>
          </li>)}</ul> : <p>{t('shell.cloud.presence.empty')}</p>}
        </section>)}
        <p className="cl-presence-note">{t('shell.cloud.presence.updated', { time: new Date(current.at).toLocaleTimeString() })}</p>
      </>}
    </Popover>
  </>
}
