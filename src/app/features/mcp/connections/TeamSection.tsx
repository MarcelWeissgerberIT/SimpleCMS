/**
 * MCP · Connections § 04 — TEAM SERVER (team workspaces only): the server's MCP endpoint (/mcp — the same for every
 * member; One cannot see who uses it, so its LED stays neutral) and the server agents' MCP servers as the runtime says
 * (names, hosts, "set" — never a token or its last 4). The runtime is read only when this tab already has it, or on
 * the press of "Read from the team server" — opening the page sends nothing.
 */
import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { useT } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { navigate } from '../../../lib/router'
import { loadRuntime, useServerAgents } from '../../agents/server'
import { openMcpSettings } from '../McpStatus'
import { hostOnly, teamEndpoint } from './model'
import { GoKey, Row, Section } from './parts'

/** Workspace › Automation: API tokens (the dialog / drawer closes first — there is none on this page). */
function openTokens(): void {
  const ui = useUI.getState()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  navigate({ name: 'workspace', section: 'automation' })
}

export function TeamSection() {
  const t = useT()
  const active = useCloud((s) => s.active)
  const role = useCloud((s) => s.role)
  if (active.kind !== 'cloud') return null
  const admin = role === 'owner' || role === 'admin'
  const addr = teamEndpoint(window.location.origin, import.meta.env.BASE_URL)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(addr)
      useUI.getState().toast({ message: t('features.mcp.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.mcp.copyFailed'), kind: 'error' })
    }
  }
  return (
    <Section n="04" code={t('features.mcp.page.team.code')} scope={t('features.mcp.page.scope.team')} title={t('features.mcp.page.team.title')} note={t('features.mcp.page.team.note')} testId="mcpc-team">
      <ul className="mcpc-rows">
        <Row
          kind="team"
          name={t('features.mcp.page.team.endpoint').toUpperCase()}
          level="off"
          testId="mcpc-endpoint-row"
          reason={
            <>
              <code className="mcpc-addr" data-testid="mcpc-endpoint">
                {addr}
              </code>
              <span className="mcpc-why2">{t('features.mcp.page.team.endpointWhy')}</span>
              {!admin && <span className="mcpc-why2">{t('shell.cloud.api.adminOnly')}</span>}
            </>
          }
          keys={
            <>
              <button type="button" className="btn btn--sm" onClick={() => void copy()} data-testid="mcpc-endpoint-copy">
                <Copy size={13} strokeWidth={1.75} aria-hidden /> {t('features.mcp.page.team.copy')}
              </button>
              <GoKey label={t('features.mcp.page.team.tokens')} aria={t('features.mcp.page.team.tokens')} onClick={openTokens} testId="mcpc-endpoint-tokens" />
            </>
          }
        />
        <ServerAgentsRow teamId={active.id} />
      </ul>
    </Section>
  )
}

function ServerAgentsRow({ teamId }: { teamId: string }) {
  const t = useT()
  const ws = useServerAgents((s) => s.ws)
  const state = useServerAgents((s) => s.state)
  const runtime = useServerAgents((s) => s.runtime)
  const error = useServerAgents((s) => s.error)
  const agents = useWorkspace((s) => s.agents)
  // what this tab already read for THIS workspace — nothing is asked by opening the page
  const mine = ws === teamId
  const loaded = mine && state !== 'idle'
  const rt = mine ? runtime : null
  const usedBy = (name: string) =>
    Object.values(agents ?? {})
      .filter((a) => a.runner === 'server' && a.mcpServers.includes(name))
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b))
  const on = !!rt && rt.enabled && rt.available
  const reading = mine && state === 'loading'
  let word = ''
  let reason: ReactNode
  if (!loaded) reason = t('features.mcp.page.srv.notRead')
  else if (state === 'loading' && !rt) {
    word = t('features.agents.srv.loading')
    reason = null
  } else if (state === 'unsupported') reason = t('features.agents.server.unsupported')
  else if (state === 'forbidden') reason = t('features.agents.server.forbidden')
  else if (state === 'error') reason = t('features.agents.srv.loadFailed', { msg: error ?? '' })
  if (rt) {
    word = rt.enabled ? t('features.agents.srv.on') : t('features.agents.srv.off')
    reason = (
      <>
        {!rt.available && <span className="mcpc-why2">{t('features.agents.server.off')}</span>}
        {rt.mcpServers.length ? (
          <ul className="mcpc-srv" data-testid="mcpc-srv-list">
            {rt.mcpServers.map((s) => {
              const users = usedBy(s.name)
              return (
                <li key={s.name} className="mcpc-srv__item" data-server={s.name}>
                  <span className="mcpc-srv__name">{s.name}</span>
                  <span className="mcpc-srv__host">{hostOnly(s.url)}</span>
                  <span className="mcpc-srv__tok">{s.token.set ? t('features.agents.srv.set') : t('features.agents.srv.notSet')}</span>
                  {users.length > 0 && <span className="mcpc-srv__by">{t('features.mcp.page.srv.usedBy', { list: users.join(', ') })}</span>}
                </li>
              )
            })}
          </ul>
        ) : (
          <span className="mcpc-why2">{t('features.mcp.page.srv.none')}</span>
        )}
      </>
    )
  }
  return (
    <Row
      kind="srv"
      name={t('features.mcp.page.srv.title').toUpperCase()}
      level={state === 'loading' && mine ? 'on' : on ? 'ok' : 'off'}
      word={word}
      reason={reason}
      testId="mcpc-srv-row"
      attrs={{ 'data-state': loaded ? state : 'unread' }}
      keys={
        <>
          {/* stays while it reads (aria-disabled — it keeps the keyboard); once read, the row hands it to Settings ↗ */}
          {!rt && (
            <button
              type="button"
              className="btn btn--sm"
              aria-disabled={reading ? 'true' : undefined}
              onClick={reading ? undefined : () => void loadRuntime()}
              title={t('features.mcp.page.srv.readHint')}
              data-testid="mcpc-srv-read"
            >
              {reading ? t('features.agents.srv.loading') : t('features.mcp.page.srv.read')}
            </button>
          )}
          <GoKey label={t('features.mcp.page.settings')} aria={t('features.mcp.page.srv.settingsAria')} onClick={openMcpSettings} testId="mcpc-srv-settings" />
        </>
      }
    >
      {!rt && (
        <p className="mcpc-note mcpc-note--plain" data-testid="mcpc-srv-hint">
          {t('features.mcp.page.srv.readHint')}
        </p>
      )}
    </Row>
  )
}
