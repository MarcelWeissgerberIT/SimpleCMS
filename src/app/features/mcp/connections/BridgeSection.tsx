/**
 * MCP · Connections § 02 — CLAUDE DESKTOP · CODE: this tab's link to the local bridge (Claude Desktop, Claude Code and
 * other MCP clients ⇄ this tab). The same words and LED as Settings → Agents · MCP § A (stateText.ts). Its switch, mode
 * and port stay there (one writer per setting; the switch is a consent switch) — "Settings ↗" / "Set up ↗" go there.
 * "Retry now" / "Use this tab" are the existing reconnects (a WebSocket to 127.0.0.1, only on a press): one key that
 * stays while the link connects ("Connecting…", aria-disabled — it keeps the keyboard), gone once it is connected (the
 * row hands the keyboard to its Settings ↗ key, parts.tsx Row).
 */
import { RotateCcw } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import { MCP_BRIDGE_CURRENT, MCP_CODEWORD, bridgeOutdated } from '../contract'
import { shortId, workspaceInfo } from '../identity'
import { connectMcpNow } from '../service'
import { openMcpSettings } from '../McpStatus'
import { clientLabel, useMcp } from '../state'
import { bridgeLed, bridgeStateText } from '../stateText'
import { Facts, GoKey, Row, Section } from './parts'

export function BridgeSection() {
  const t = useT()
  const lang = useLang()
  const s = useMcp()
  // the workspace's name (the bridge reports it) follows a rename / a switch
  useWorkspace((x) => x.settings.workspaceName)
  useWorkspace((x) => x.epoch)
  useCloud((x) => x.workspaces)
  const ws = workspaceInfo()
  const conn = s.enabled ? s.conn : 'off'
  const connected = conn === 'connected'
  const client = clientLabel(s.client)
  const fmt = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  const peerNames = s.peers.map((p) => t('features.mcp.peer', { name: p.name, kind: t(`features.mcp.peer.${p.kind}`) })).join(', ')
  const notes: Array<{ key: string; text: string; err?: boolean }> = []
  if (conn === 'waiting') notes.push({ key: 'waiting', text: s.prompt ? t('features.mcp.msg.prompt') : t('features.mcp.msg.waiting') })
  if (conn === 'replaced') notes.push({ key: 'replaced', text: t('features.mcp.msg.replaced') })
  if (conn === 'blocked') notes.push({ key: 'blocked', text: s.blocked === 'insecure' ? t('features.mcp.msg.insecure') : t('features.mcp.msg.permission'), err: true })
  if (connected && s.legacy) notes.push({ key: 'legacy', text: t('features.mcp.msg.legacy') })
  else if (connected && bridgeOutdated(s.bridge)) notes.push({ key: 'outdated', text: t('features.mcp.msg.outdated', { v: s.bridge ?? '', need: MCP_BRIDGE_CURRENT }) })
  if (connected && s.peers.length > 0) notes.push({ key: 'peers', text: t(s.peers.length === 1 ? 'features.mcp.msg.peers.one' : 'features.mcp.msg.peers.other', { names: peerNames }) })
  if (s.enabled && s.approvals.length > 0) notes.push({ key: 'approvals', text: t(s.approvals.length === 1 ? 'features.mcp.page.bridge.approvals.one' : 'features.mcp.page.bridge.approvals.other', { count: s.approvals.length }) })

  return (
    <Section n="02" code={t('features.mcp.page.bridge.code')} scope={t('features.mcp.page.scope.tab')} title={t('features.mcp.page.bridge.title')} note={t('features.mcp.page.bridge.note')} testId="mcpc-bridge">
      <ul className="mcpc-rows">
        <Row
          kind="bridge"
          name={t('features.mcp.page.bridge.name').toUpperCase()}
          host={`127.0.0.1:${s.port}`}
          level={bridgeLed(conn)}
          word={t(`features.mcp.page.bstate.${conn}`)}
          reason={s.enabled ? bridgeStateText(t, conn, client, s.calls, s.bridge) : t('features.mcp.page.bridge.offWhy')}
          attrs={{ 'data-state': conn }}
          testId="mcpc-bridge-row"
          keys={
            <>
              {(conn === 'waiting' || conn === 'blocked' || conn === 'replaced' || conn === 'connecting') && (
                <button
                  type="button"
                  className={conn === 'replaced' ? 'btn btn--sm btn--ink' : 'btn btn--sm'}
                  aria-disabled={conn === 'connecting' ? 'true' : undefined}
                  onClick={() => {
                    if (conn !== 'connecting') connectMcpNow()
                  }}
                  data-testid={conn === 'replaced' ? 'mcpc-bridge-here' : conn === 'connecting' ? 'mcpc-bridge-connecting' : 'mcpc-bridge-retry'}
                >
                  {conn !== 'replaced' && <RotateCcw size={13} strokeWidth={1.75} aria-hidden />} {t(conn === 'replaced' ? 'features.mcp.useHere' : conn === 'connecting' ? 'features.mcp.page.bstate.connecting' : 'features.mcp.retry')}
                </button>
              )}
              {s.enabled ? (
                <GoKey label={t('features.mcp.page.settings')} aria={t('features.mcp.page.bridge.settingsAria')} onClick={openMcpSettings} testId="mcpc-bridge-settings" />
              ) : (
                <GoKey label={t('features.mcp.page.setup')} aria={t('features.mcp.page.bridge.setupAria')} onClick={openMcpSettings} testId="mcpc-bridge-setup" />
              )}
            </>
          }
          facts={
            <Facts
              items={[
                ...(s.enabled ? [{ key: 'client', label: t('features.mcp.ro.client'), value: connected ? (client ?? '—') : '—', testId: 'mcpc-bridge-client' }] : []),
                { key: 'mode', label: t('features.mcp.panel.changes'), value: t(`features.mcp.mode.${s.mode}`), testId: 'mcpc-bridge-mode' },
                {
                  key: 'workspace',
                  label: t('features.mcp.ro.workspace'),
                  value: (
                    <>
                      {ws.name}{' '}
                      <code className="mcpc-code" title={t('features.mcp.asId', { id: ws.id })}>
                        {shortId(ws.id)}
                      </code>
                    </>
                  ),
                },
                ...(s.enabled ? [{ key: 'calls', label: t('features.mcp.ro.calls'), value: fmt(connected ? s.calls : 0) }] : []),
                { key: 'codeword', label: t('features.ai.mcp.ov.codeword'), value: <code className="mcpc-code">{MCP_CODEWORD}</code> },
              ]}
            />
          }
        >
          {notes.map((n) => (
            <p key={n.key} className={n.err ? 'mcpc-note mcpc-note--err' : 'mcpc-note'} role="note" data-note={n.key}>
              {n.text}
            </p>
          ))}
        </Row>
      </ul>
    </Section>
  )
}
