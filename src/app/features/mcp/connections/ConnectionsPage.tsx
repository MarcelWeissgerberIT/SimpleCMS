/**
 * #/mcp — MCP · Connections: every MCP connection One knows of, on one page, as this tab knows it.
 *  § 01 One's Claude — the MCP servers One's own Claude uses (this device, Settings › AI)
 *  § 02 Claude Desktop · Code — this tab's link to the local bridge (this tab; switch / mode / port: this browser)
 *  § 03 Coding worker — this browser's link to the worker and Claude Code's own server names
 *  § 04 Team server — the workspace's /mcp endpoint and the server agents' servers (team workspaces only)
 * A lazy chunk. Opening it sends nothing and opens no secret: states are what One last saw (the last connection test,
 * refusals noted in this tab, sign-in expiry, the links already open). Keys that reach the network exist elsewhere and
 * run only on a press: Test, Sign in, Retry now / Use this tab, Read from the team server. Switches stay in Settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plug } from 'lucide-react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { HelpLink } from '../../../help'
import { focusIsNowhere } from '../../../ui/focus'
import { useCoding } from '../../coding'
import { refusedHere } from '../../ai/mcp-servers/config'
import { tokenTrouble } from '../../ai/mcp-servers/health'
import { clientLabel, useMcp } from '../state'
import { bridgeLed } from '../stateText'
import { needsYou, serverState } from './model'
import { useNow, useRefusedRev, useServers, useWorkerLevel } from './hooks'
import { AnnounceContext, Lamp } from './parts'
import { OneSection } from './OneSection'
import { BridgeSection } from './BridgeSection'
import { WorkerSection } from './WorkerSection'
import { TeamSection } from './TeamSection'
import './connections.css'

export default function ConnectionsPage() {
  const t = useT()
  const title = t('features.mcp.page.title')
  const h1 = useRef<HTMLHeadingElement>(null)
  const [live, setLive] = useState('')
  // the same text twice in a row is still read out: clear first, then set a frame later
  const announce = useCallback((text: string) => {
    setLive('')
    requestAnimationFrame(() => setLive(text))
  }, [])

  // the keyboard lands on the title — only when nobody has it (a Settings link, ⌘K, a lamp left it nowhere)
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (focusIsNowhere()) h1.current?.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const team = useCloud((s) => s.active.kind === 'cloud')
  return (
    <AnnounceContext.Provider value={announce}>
      <div className="mcpc" data-testid="mcp-connections">
        <header className="mcpc__head">
          <span className="mcpc__icon" aria-hidden>
            <Plug size={18} strokeWidth={1.7} />
          </span>
          <h1 className="display mcpc__title" ref={h1} tabIndex={-1}>
            {title}
          </h1>
          <span className="label mcpc__sub">{t('features.mcp.page.sub')}</span>
          <HelpLink id="mcp-servers" topic={title} />
        </header>
        <Readout team={team} />
        <OneSection />
        <BridgeSection />
        <WorkerSection />
        {team && <TeamSection />}
        <p className="label mcpc__foot">{t('features.mcp.page.foot')}</p>
        <div className="visually-hidden" role="status" aria-live="polite" data-testid="mcpc-live">
          {live}
        </div>
      </div>
    </AnnounceContext.Provider>
  )
}

/** ONE'S CLAUDE n of n OK · n off │ NEEDS YOU n │ BRIDGE state · client │ WORKER state · n repos │ (team) TEAM SERVER /mcp */
function Readout({ team }: { team: boolean }) {
  const t = useT()
  const servers = useServers()
  useRefusedRev()
  const now = useNow()
  const on = servers.filter((s) => s.enabled).length
  // working ones first: switched on, tested and nothing wrong (the rows' own state) — "on" alone says nothing about that
  const ok = servers.filter((s) => serverState(s, now, refusedHere(s)) === 'ok').length
  const needs = needsYou(servers, now, refusedHere)
  // the strip's LED: red when any row is red (the lamp's level), amber when only amber ones wait
  const red = servers.some((s) => s.enabled && tokenTrouble(s, now, refusedHere(s))?.level === 'red')
  const bridgeOn = useMcp((s) => s.enabled)
  const bridgeConn = useMcp((s) => (s.enabled ? s.conn : 'off'))
  const bridgeClient = useMcp((s) => clientLabel(s.client))
  const coding = {
    enabled: useCoding((s) => s.enabled),
    conn: useCoding((s) => s.conn),
    worker: useCoding((s) => s.worker),
  }
  const { level: wLevel } = useWorkerLevel()
  const wConn = coding.enabled ? coding.conn : 'off'
  const repos = coding.enabled && coding.conn === 'connected' ? (coding.worker?.repos.length ?? 0) : null
  return (
    <div className="mcpc-ro" role="group" aria-label={t('features.mcp.page.ro.aria')} data-testid="mcpc-readout">
      <span className="mcpc-ro__cell" data-cell="one">
        <span className="label">{t('features.mcp.page.ro.one')}</span>
        <span className="mcpc-ro__val" data-testid="mcpc-ro-one">
          {!servers.length ? '—' : on ? t('features.mcp.page.ro.oneVal', { ok, on, off: servers.length - on }) : t('features.mcp.page.ro.allOff', { off: servers.length })}
        </span>
      </span>
      <span className="mcpc-ro__cell" data-cell="needs">
        <Lamp level={needs ? (red ? 'red' : 'amber') : 'off'} />
        <span className="label">{t('features.mcp.page.ro.needs')}</span>
        <span className="mcpc-ro__val" data-testid="mcpc-needs-count">
          {needs}
        </span>
      </span>
      <span className="mcpc-ro__cell" data-cell="bridge">
        <span className="label">{t('features.mcp.page.ro.bridge')}</span>
        <Lamp level={bridgeLed(bridgeConn)} />
        <span className="mcpc-ro__val">
          {t(`features.mcp.page.bstate.${bridgeOn ? bridgeConn : 'off'}`)}
          {bridgeOn && bridgeConn === 'connected' && bridgeClient && ` · ${bridgeClient}`}
        </span>
      </span>
      <span className="mcpc-ro__cell" data-cell="worker">
        <span className="label">{t('features.mcp.page.ro.worker')}</span>
        <Lamp level={wLevel} />
        <span className="mcpc-ro__val">
          {t(`features.mcp.page.wstate.${wConn}`)}
          {repos !== null && ` · ${t(repos === 1 ? 'features.mcp.page.ro.repos.one' : 'features.mcp.page.ro.repos.other', { n: repos })}`}
        </span>
      </span>
      {team && (
        <span className="mcpc-ro__cell" data-cell="team">
          <span className="label">{t('features.mcp.page.ro.team')}</span>
          <span className="mcpc-ro__val mcpc-ro__val--path">/mcp</span>
        </span>
      )}
    </div>
  )
}
