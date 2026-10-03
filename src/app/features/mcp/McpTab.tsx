/**
 * Settings → Agents · MCP: the bridge panel (switch, connection LED, read-out), what agents may
 * change, the setup (download, Claude Desktop JSON, Claude Code command) and the activity log.
 */
import { useId, useState, type ReactNode } from 'react'
import { Copy, Download, RotateCcw, Undo2 } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { MCP_DEFAULT_PORT, type McpAgentMode } from './contract'
import { workspaceInfo } from './read'
import { clearMcpActivity, connectMcpNow, setMcpEnabled, setMcpMode, setMcpPort, undoMcpActivity } from './service'
import { clientLabel, useMcp, validPort, type McpActivity, type McpConn } from './state'
import './mcp.css'

type T = ReturnType<typeof useT>

/** Where the site serves the bridge (respects the app's base: getonecms.com/mcp/one-mcp.mjs). */
export function bridgeUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}mcp/one-mcp.mjs`, window.location.origin).href
}

function platform(): 'mac' | 'win' | 'linux' {
  const p = (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || ''
  return /Mac|iPhone|iPad/i.test(p) ? 'mac' : /Win/i.test(p) ? 'win' : 'linux'
}

function bridgePath(): string {
  const os = platform()
  return os === 'mac' ? '/Users/YOU/one-mcp.mjs' : os === 'win' ? 'C:\\\\Users\\\\YOU\\\\one-mcp.mjs' : '/home/YOU/one-mcp.mjs'
}

export function desktopConfig(port: number): string {
  const env = port !== MCP_DEFAULT_PORT ? `,\n      "env": { "ONE_MCP_PORT": "${port}" }` : ''
  return `{\n  "mcpServers": {\n    "one": {\n      "command": "node",\n      "args": ["${bridgePath()}"]${env}\n    }\n  }\n}`
}

export function codeCommand(port: number): string {
  return `claude mcp add one${port !== MCP_DEFAULT_PORT ? ` -e ONE_MCP_PORT=${port}` : ''} -- node ~/one-mcp.mjs`
}

export const curlCommand = () => `curl -fsSL ${bridgeUrl()} -o ~/one-mcp.mjs`

function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      useUI.getState().toast({ message: t('features.mcp.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.mcp.copyFailed'), kind: 'error' })
    }
  }
  return (
    <div className="mcp-code">
      <pre aria-label={label}>{code}</pre>
      <button type="button" className="icon-btn icon-btn--sm mcp-code__copy" onClick={() => void copy()} aria-label={t('features.mcp.copy', { what: label })} title={t('features.mcp.copy', { what: label })}>
        <Copy size={13} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function Panel({ code, title, state, stateText, children }: { code: string; title: string; state?: McpConn; stateText?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="mcp-panel" aria-labelledby={id} data-state={state}>
      <header className="mcp-panel__head">
        <span className="label mcp-panel__code" id={id}>
          {code} — {title}
        </span>
        {stateText && (
          <span className="mcp-panel__state" role="status" data-testid="mcp-state">
            <Led state={state === 'connected' ? 'ok' : state === 'connecting' || state === 'waiting' ? 'on' : 'off'} />
            <span className="label">{stateText}</span>
          </span>
        )}
      </header>
      <div className="mcp-panel__body">{children}</div>
    </section>
  )
}

function stateText(t: T, conn: McpConn, client: string | null, calls: number, bridge: string | null): string {
  switch (conn) {
    case 'off':
      return t('features.mcp.state.off')
    case 'connecting':
      return t('features.mcp.state.connecting')
    case 'waiting':
      return t('features.mcp.state.waiting')
    case 'connected':
      return t(calls === 1 ? 'features.mcp.state.connected.one' : 'features.mcp.state.connected.other', { client: client ?? t('features.mcp.bridge', { v: bridge ?? '' }).trim(), n: calls })
    case 'replaced':
      return t('features.mcp.state.replaced')
    case 'blocked':
      return t('features.mcp.state.blocked')
  }
}

function BridgePanel() {
  const t = useT()
  const lang = useLang()
  const s = useMcp()
  // re-render when the workspace name changes
  useWorkspace((x) => x.settings.workspaceName)
  const ws = workspaceInfo()
  const client = clientLabel(s.client)
  const [port, setPort] = useState(String(s.port))
  const portId = useId()
  const fmt = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  const commitPort = () => {
    const p = validPort(port)
    if (p) setMcpPort(p)
    else setPort(String(s.port))
  }
  return (
    <Panel code="§ A" title={t('features.mcp.panel.bridge')} state={s.enabled ? s.conn : 'off'} stateText={stateText(t, s.enabled ? s.conn : 'off', client, s.calls, s.bridge)}>
      <div className="mcp-switch">
        <Switch checked={s.enabled} onChange={setMcpEnabled} label={t('features.mcp.allow')} />
        <div>
          <div className="mcp-switch__label">{t('features.mcp.allow')}</div>
          <div className="mcp-switch__hint">{t('features.mcp.allowHint')}</div>
        </div>
      </div>
      <dl className="mcp-readout">
        <div className="mcp-readout__cell">
          <dt className="label">{t('features.mcp.ro.client')}</dt>
          <dd>{s.conn === 'connected' && s.enabled ? (client ?? '—') : '—'}</dd>
        </div>
        <div className="mcp-readout__cell">
          <dt className="label">{t('features.mcp.ro.workspace')}</dt>
          <dd title={ws.name}>
            {ws.name}
            {ws.kind === 'team' && <span className="mcp-readout__tag">{ws.readOnly ? t('features.mcp.ro.viewer') : t('features.mcp.ro.team')}</span>}
          </dd>
        </div>
        <div className="mcp-readout__cell">
          <dt className="label">{t('features.mcp.ro.calls')}</dt>
          <dd>{fmt(s.conn === 'connected' ? s.calls : 0)}</dd>
        </div>
        <div className="mcp-readout__cell">
          <dt className="label">
            <label htmlFor={portId}>{t('features.mcp.ro.port')}</label>
          </dt>
          <dd>
            <input
              id={portId}
              className="mcp-port"
              inputMode="numeric"
              value={port}
              maxLength={5}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              onBlur={commitPort}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitPort()
              }}
              aria-describedby={`${portId}-hint`}
            />
            <span id={`${portId}-hint`} className="visually-hidden">
              {t('features.mcp.portHint')}
            </span>
          </dd>
        </div>
      </dl>
      {s.enabled && s.conn === 'waiting' && (
        <div className="mcp-msg">
          <p>{s.prompt ? t('features.mcp.msg.prompt') : t('features.mcp.msg.waiting')}</p>
          <button type="button" className="btn btn--sm" onClick={connectMcpNow}>
            <RotateCcw size={13} strokeWidth={1.75} /> {t('features.mcp.retry')}
          </button>
        </div>
      )}
      {s.enabled && s.conn === 'replaced' && (
        <div className="mcp-msg">
          <p>{t('features.mcp.msg.replaced')}</p>
          <button type="button" className="btn btn--sm btn--ink" onClick={connectMcpNow}>
            {t('features.mcp.useHere')}
          </button>
        </div>
      )}
      {s.enabled && s.conn === 'blocked' && (
        <div className="mcp-msg mcp-msg--err" role="alert">
          <p>{s.blocked === 'insecure' ? t('features.mcp.msg.insecure') : t('features.mcp.msg.permission')}</p>
          <button type="button" className="btn btn--sm" onClick={connectMcpNow}>
            <RotateCcw size={13} strokeWidth={1.75} /> {t('features.mcp.retry')}
          </button>
        </div>
      )}
    </Panel>
  )
}

const MODES: McpAgentMode[] = ['ask', 'apply', 'read']

function ModePanel() {
  const t = useT()
  const mode = useMcp((s) => s.mode)
  const hintId = useId()
  return (
    <Panel code="§ B" title={t('features.mcp.panel.changes')}>
      <div className="seg mcp-modes" role="radiogroup" aria-label={t('features.mcp.panel.changes')} aria-describedby={hintId}>
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className="seg__btn" onClick={() => setMcpMode(m)} data-mode={m}>
            {t(`features.mcp.mode.${m}`)}
          </button>
        ))}
      </div>
      <p className="mcp-hint" id={hintId}>
        {t(`features.mcp.mode.${mode}Hint`)}
      </p>
    </Panel>
  )
}

function SetupPanel() {
  const t = useT()
  const port = useMcp((s) => s.port)
  return (
    <Panel code="§ C" title={t('features.mcp.panel.setup')}>
      <ol className="mcp-steps">
        <li>
          <span className="mcp-steps__n" aria-hidden>
            01
          </span>
          <div>
            <div className="mcp-steps__title">{t('features.mcp.setup.download')}</div>
            <div className="mcp-steps__row">
              <a className="btn btn--sm" href={bridgeUrl()} download="one-mcp.mjs">
                <Download size={13} strokeWidth={1.75} /> one-mcp.mjs
              </a>
              <span className="mcp-hint">{t('features.mcp.setup.node')}</span>
            </div>
            <CodeBlock code={curlCommand()} label={t('features.mcp.setup.terminal')} />
          </div>
        </li>
        <li>
          <span className="mcp-steps__n" aria-hidden>
            02
          </span>
          <div>
            <div className="mcp-steps__title">Claude Desktop</div>
            <p className="mcp-hint">{t('features.mcp.setup.desktop')}</p>
            <CodeBlock code={desktopConfig(port)} label="claude_desktop_config.json" />
            <div className="mcp-steps__title">Claude Code</div>
            <CodeBlock code={codeCommand(port)} label={t('features.mcp.setup.command')} />
            <p className="mcp-hint">{t('features.mcp.setup.other')}</p>
          </div>
        </li>
        <li>
          <span className="mcp-steps__n" aria-hidden>
            03
          </span>
          <div>
            <div className="mcp-steps__title">{t('features.mcp.setup.try')}</div>
            <p className="mcp-hint">{t('features.mcp.setup.tryHint')}</p>
          </div>
        </li>
      </ol>
    </Panel>
  )
}

function fmtTime(at: number, lang: string): string {
  return new Date(at).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function ActivityRow({ a }: { a: McpActivity }) {
  const t = useT()
  const lang = useLang()
  return (
    <li className="mcp-log__row" data-state={a.state} data-write={a.write || undefined}>
      <time className="mcp-log__time" dateTime={new Date(a.at).toISOString()}>
        {fmtTime(a.at, lang)}
      </time>
      <span className="mcp-log__tag">{a.write ? t('features.mcp.log.write') : t('features.mcp.log.read')}</span>
      <span className="mcp-log__tool">{a.tool}</span>
      <span className="mcp-log__target" title={a.note ?? a.target}>
        {a.target}
        {a.note && <span className="mcp-log__note"> — {a.note}</span>}
      </span>
      <span className="mcp-log__state">
        {t(`features.mcp.log.state.${a.state}`)}
        {a.ms !== undefined && a.state !== 'wait' ? ` · ${a.ms} ms` : ''}
      </span>
      {a.undo && a.state === 'ok' ? (
        <button type="button" className="icon-btn icon-btn--sm mcp-log__undo" onClick={() => undoMcpActivity(a.id)} aria-label={t('features.mcp.log.undo', { tool: a.tool })} title={t('common.undo')}>
          <Undo2 size={12} strokeWidth={1.75} />
        </button>
      ) : (
        <span />
      )}
    </li>
  )
}

function ActivityLog() {
  const t = useT()
  const activity = useMcp((s) => s.activity)
  return (
    <div className="mcp-log">
      <div className="mcp-log__head">
        <span className="label">{t('features.mcp.log.title')}</span>
        {activity.length > 0 && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={clearMcpActivity}>
            {t('features.mcp.log.clear')}
          </button>
        )}
      </div>
      {activity.length ? (
        <ol className="mcp-log__list" aria-label={t('features.mcp.log.title')}>
          {activity.map((a) => (
            <ActivityRow key={a.id} a={a} />
          ))}
        </ol>
      ) : (
        <p className="mcp-log__empty">{t('features.mcp.log.empty')}</p>
      )}
    </div>
  )
}

export function McpTab() {
  const t = useT()
  return (
    <div className="mcp-tab">
      <h3 className="st-h">{t('features.mcp.title')}</h3>
      <p className="st-p">{t('features.mcp.lead')}</p>
      <BridgePanel />
      <ModePanel />
      <SetupPanel />
      <ActivityLog />
      <div className="st-note">
        <span className="st-note__mark" aria-hidden />
        <div>
          <strong>{t('features.mcp.security.title')}</strong>
          <p>{t('features.mcp.security.body')}</p>
        </div>
      </div>
    </div>
  )
}
