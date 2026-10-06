/**
 * Settings → Coding worker: the switch (per device), the link's LED and read-out (worker, repos, running,
 * today's cost, port), what a refusal means (another workspace / not bound yet) — and the setup: Node,
 * git and the Claude Code CLI, the worker file, `init --workspace <this id>`, the repos in worker.json, run.
 */
import { useId, useState, type ReactNode } from 'react'
import { Copy, Download } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { HelpLink } from '../../help'
import { navigate } from '../../lib/router'
import { workspaceInfo } from '../mcp/identity'
import { WORKER_DEFAULT_PORT } from './protocol'
import { reconnect, setCodingEnabled, setCodingPort } from './service'
import { useCoding, validPort, type CodingState } from './state'
import './coding.css'

type T = ReturnType<typeof useT>

/** Where the site serves the worker (respects the app's base). */
export function workerUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}mcp/one-worker.mjs`, window.location.origin).href
}

export function workerStateText(t: T, s: Pick<CodingState, 'enabled' | 'conn' | 'worker' | 'busy' | 'refused'>): string {
  if (!s.enabled) return t('features.coding.conn.off')
  switch (s.conn) {
    case 'connected': {
      const repos = s.worker?.repos.length ?? 0
      const base = t(repos === 1 ? 'features.coding.conn.connected.one' : 'features.coding.conn.connected.other', { name: s.worker?.name ?? '', n: repos })
      return s.busy.length ? `${base} · ${t('features.coding.conn.busy', { n: s.busy.length })}` : base
    }
    case 'connecting':
      return t('features.coding.conn.connecting')
    case 'waiting':
      return t('features.coding.conn.waiting')
    case 'replaced':
      return t('features.coding.conn.replaced')
    case 'refused':
      return s.refused === 'unbound' ? t('features.coding.conn.unbound') : t('features.coding.conn.refused')
    case 'blocked':
      return t('features.coding.conn.blocked')
    default:
      return t('features.coding.conn.off')
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      useUI.getState().toast({ message: t('features.coding.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.coding.copyFailed'), kind: 'error' })
    }
  }
  return (
    <div className="cw-code">
      <pre aria-label={label}>{code}</pre>
      <button type="button" className="icon-btn icon-btn--sm cw-code__copy" onClick={() => void copy()} aria-label={t('features.coding.copy', { what: label })} title={t('features.coding.copy', { what: label })}>
        <Copy size={13} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function Panel({ code, title, children, state }: { code: string; title: string; children: ReactNode; state?: ReactNode }) {
  const id = useId()
  return (
    <section className="cw-panel" aria-labelledby={id}>
      <header className="cw-panel__head">
        <span className="label cw-panel__code" id={id}>
          {code} — {title}
        </span>
        {state}
      </header>
      <div className="cw-panel__body">{children}</div>
    </section>
  )
}

export function WorkerTab() {
  const t = useT()
  const lang = useLang()
  const s = useCoding()
  useWorkspace((x) => x.settings.workspaceName)
  useWorkspace((x) => x.epoch)
  useCloud((x) => x.active)
  const ws = workspaceInfo()
  const [port, setPort] = useState(String(s.port))
  const portId = useId()
  const connected = s.enabled && s.conn === 'connected'
  const money = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  const commitPort = () => {
    const p = validPort(port)
    if (p) setCodingPort(p)
    else setPort(String(s.port))
  }
  const portFlag = s.port !== WORKER_DEFAULT_PORT ? `ONE_WORKER_PORT=${s.port} ` : ''
  const led = connected ? (s.busy.length ? 'on' : 'ok') : s.enabled && (s.conn === 'waiting' || s.conn === 'connecting') ? 'on' : 'off'

  return (
    <div className="cw" data-testid="coding-settings">
      <p className="cw-lead">
        {t('features.coding.settings.lead')} <HelpLink id="coding-pipeline" />
      </p>
      <Panel
        code="§ A"
        title={t('features.coding.settings.worker')}
        state={
          <span className="cw-state" role="status" data-testid="coding-conn">
            <Led state={led} />
            <span className="label">{workerStateText(t, s)}</span>
          </span>
        }
      >
        <div className="cw-switch">
          <Switch checked={s.enabled} onChange={setCodingEnabled} label={t('features.coding.settings.allow')} />
          <div>
            <div className="cw-switch__label">{t('features.coding.settings.allow')}</div>
            <div className="cw-switch__hint">{t('features.coding.settings.allowHint')}</div>
          </div>
        </div>
        <dl className="cw-ro">
          <div className="cw-ro__cell">
            <dt className="label">{t('features.coding.ro.worker')}</dt>
            <dd>{connected ? (s.worker?.name ?? '—') : '—'}</dd>
          </div>
          <div className="cw-ro__cell">
            <dt className="label">{t('features.coding.ro.repos')}</dt>
            <dd>{connected ? (s.worker?.repos.map((r) => r.name).join(', ') || '—') : '—'}</dd>
          </div>
          <div className="cw-ro__cell">
            <dt className="label">{t('features.coding.ro.today')}</dt>
            <dd>{connected ? money(s.spentToday) : '—'}</dd>
          </div>
          <div className="cw-ro__cell">
            <dt className="label">
              <label htmlFor={portId}>{t('features.coding.ro.port')}</label>
            </dt>
            <dd>
              <input id={portId} className="cw-port" inputMode="numeric" value={port} maxLength={5} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={commitPort} onKeyDown={(e) => e.key === 'Enter' && commitPort()} />
            </dd>
          </div>
        </dl>
        {connected && s.worker && !s.worker.claude.found && <div className="cw-msg cw-msg--warn">{t('features.coding.settings.noClaude')}</div>}
        {s.enabled && s.conn === 'refused' && (
          <div className="cw-msg cw-msg--warn" data-testid="coding-refused">
            <p>{s.refused === 'unbound' ? t('features.coding.settings.unbound') : t('features.coding.settings.refused')}</p>
            <CodeBlock code={`node ~/one-worker.mjs init --workspace ${ws.id}${s.refused === 'unbound' ? '' : ' --force'}`} label={t('features.coding.settings.initLabel')} />
            <button type="button" className="btn btn--sm" onClick={reconnect}>
              {t('features.coding.settings.retry')}
            </button>
          </div>
        )}
        {s.enabled && s.conn === 'replaced' && (
          <div className="cw-msg">
            <p>{t('features.coding.settings.replaced')}</p>
            <button type="button" className="btn btn--sm" onClick={reconnect}>
              {t('features.coding.settings.useTab')}
            </button>
          </div>
        )}
        {s.enabled && s.conn === 'waiting' && <div className="cw-msg">{t('features.coding.settings.waiting')}</div>}
        {connected && (
          <p className="cw-as">
            <span className="label">{t('features.coding.settings.as')}</span> {ws.name} <code>{ws.id}</code>
            <button type="button" className="ctk-link" onClick={() => (useUI.getState().closeModal(), navigate({ name: 'coding' }))}>
              {t('features.coding.settings.openCoding')}
            </button>
          </p>
        )}
      </Panel>

      <Panel code="§ B" title={t('features.coding.settings.setup')}>
        <ol className="cw-steps">
          <li>
            <p>{t('features.coding.settings.step1')}</p>
          </li>
          <li>
            <p>{t('features.coding.settings.step2')}</p>
            <div className="cw-row">
              <a className="btn btn--sm" href={`${import.meta.env.BASE_URL}mcp/one-worker.mjs`} download="one-worker.mjs">
                <Download size={13} strokeWidth={1.75} aria-hidden /> one-worker.mjs
              </a>
            </div>
            <CodeBlock code={`curl -fsSL ${workerUrl()} -o ~/one-worker.mjs`} label={t('features.coding.settings.download')} />
          </li>
          <li>
            <p>{t('features.coding.settings.step3')}</p>
            <CodeBlock code={`node ~/one-worker.mjs init --workspace ${ws.id}`} label={t('features.coding.settings.initLabel')} />
          </li>
          <li>
            <p>{t('features.coding.settings.step4')}</p>
            <CodeBlock code={`node ~/one-worker.mjs check\n${portFlag}node ~/one-worker.mjs`} label={t('features.coding.settings.runLabel')} />
          </li>
        </ol>
      </Panel>

      <Panel code="§ C" title={t('features.coding.settings.safety')}>
        <ul className="cw-safety">
          <li>{t('features.coding.settings.safe1')}</li>
          <li>{t('features.coding.settings.safe2')}</li>
          <li>{t('features.coding.settings.safe3')}</li>
          <li>{t('features.coding.settings.safe4')}</li>
          {ws.kind === 'team' && <li>{t('features.coding.settings.safeTeam')}</li>}
        </ul>
      </Panel>
    </div>
  )
}
