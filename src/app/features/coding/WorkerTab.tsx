/**
 * Settings → Coding worker: the 3-step card (SetupCard: download the worker ready-paired, start it, tick the
 * repos in its page), this device's link (switch — a download switches it on —, LED, read-out, port, what a
 * refusal means), the manual setup for a worker.json of one's own (download, `init --workspace <this id>`,
 * check, run) and the safety notes.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronRight, Download } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led, Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { HelpLink } from '../../help'
import { navigate } from '../../lib/router'
import { workspaceInfo } from '../mcp/identity'
import { WORKER_DEFAULT_PORT } from './protocol'
import { reconnect, setCodingEnabled, setCodingPort, setCodingVia, viaFor } from './service'
import { cloudContextOk, relayAvailable } from './cloudWorkers'
import { useCoding, validPort, type CodingState } from './state'
import { CodeBlock } from './CodeBlock'
import { SetupCard } from './SetupCard'
import { workerStateText } from './stateText'
import { notifyEnabled, notifyPermission, setNotify } from './notify'
import './coding.css'

/** Browser notifications when a task needs the person or is done while One is in the background (this device). */
function NotifySwitch() {
  const t = useT()
  const [on, setOn] = useState(notifyEnabled)
  const [denied, setDenied] = useState(() => notifyPermission() === 'denied')
  if (notifyPermission() === 'unsupported') return null
  const change = (v: boolean) =>
    void setNotify(v).then((ok) => {
      setOn(v && ok)
      setDenied(v && !ok)
    })
  return (
    <div className="cw-switch" data-testid="coding-notify">
      <Switch checked={on} onChange={change} label={t('features.coding.notify.switch')} />
      <div>
        <div className="cw-switch__label">{t('features.coding.notify.switch')}</div>
        <div className="cw-switch__hint">{t(denied ? 'features.coding.notify.denied' : 'features.coding.notify.hint')}</div>
      </div>
    </div>
  )
}

/** Where the site serves the worker (respects the app's base). */
export function workerUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}mcp/one-worker.mjs`, window.location.origin).href
}

export { workerStateText }

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

/** The team server's refusals of a cloud link (and "another device has the key") — nothing to run on this computer. */
const CLOUD_REFUSALS: Partial<Record<NonNullable<CodingState['refused']>, string>> = {
  viewer: 'features.coding.settings.viewer',
  forbidden: 'features.coding.settings.forbidden',
  removed: 'features.coding.settings.removed',
  'relay-off': 'features.coding.settings.relayOff',
  'other-device': 'features.coding.settings.otherDevice',
  'worker-unknown': 'features.coding.settings.workerUnknown',
}

/** What a refusal means and what to do — by why the worker (or, in cloud mode, the team server) said no. */
function Refused({ s, wsId, cloud }: { s: CodingState; wsId: string; cloud: boolean }) {
  const t = useT()
  const relayKey = s.refused ? CLOUD_REFUSALS[s.refused] : undefined
  const legacy = !cloud && !relayKey && s.refused !== 'pair' && !s.refusedPaired
  const text = relayKey
    ? t(relayKey)
    : s.refused === 'pair'
      ? t(cloud ? 'features.coding.settings.pairCloud' : 'features.coding.settings.pair')
      : s.refusedPaired
        ? t('features.coding.settings.refusedPaired')
        : s.refused === 'unbound'
          ? t('features.coding.settings.unbound')
          : t('features.coding.settings.refused')
  return (
    <div className="cw-msg cw-msg--warn" data-testid="coding-refused" data-reason={s.refused ?? undefined}>
      <p>{text}</p>
      {legacy && <CodeBlock code={`node ~/one-worker.mjs init --workspace ${wsId}${s.refused === 'unbound' ? '' : ' --force'}`} label={t('features.coding.settings.initLabel')} />}
      <button type="button" className="btn btn--sm" onClick={reconnect}>
        {t('features.coding.settings.retry')}
      </button>
    </div>
  )
}

/**
 * § A — Where the worker runs: Local (127.0.0.1) | Cloud (through this team server). A radiogroup with roving focus
 * (arrow keys, Home, End); Cloud is off — with its reason as visible text — in a local workspace, on a page that is
 * not https (the end-to-end box needs WebCrypto, the worker dials https only), for viewers and on a server without
 * the relay.
 */
function ViaSwitch({ code }: { code: string }) {
  const t = useT()
  useCoding((s) => s.via)
  const role = useCloud((x) => x.role)
  useCloud((x) => x.active)
  const ws = workspaceInfo()
  const team = ws.kind === 'team'
  const [relay, setRelay] = useState<boolean | null>(null)
  useEffect(() => {
    if (!team) return
    let live = true
    void relayAvailable().then((on) => live && setRelay(on))
    return () => {
      live = false
    }
  }, [team, ws.id])
  const via = viaFor(ws)
  const why = !team
    ? 'features.coding.via.cloudOff'
    : !cloudContextOk()
      ? 'features.coding.via.needsHttps'
      : role === 'viewer'
        ? 'features.coding.via.viewer'
        : relay === false
          ? 'features.coding.via.unavailable'
          : null
  const labelId = useId()
  const hintId = useId()
  const whyId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const options = ['local', 'cloud'] as const
  const allowed = (o: (typeof options)[number]) => o === 'local' || !why
  const choose = (o: (typeof options)[number]) => {
    if (!allowed(o) || o === via) return
    setCodingVia(ws.id, o)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.indexOf(via)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % options.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + options.length - 1) % options.length : e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const o = options[next]!
    if (!allowed(o)) {
      refs.current[next]?.focus()
      return
    }
    choose(o)
    refs.current[next]?.focus()
  }
  return (
    <section className="cw-panel" aria-labelledby={labelId}>
      <header className="cw-panel__head">
        <span className="label cw-panel__code" id={labelId}>
          {code} — {t('features.coding.via.label')}
        </span>
      </header>
      <div className="cw-panel__body cw-via">
        <div className="cn-seg cw-via__seg" role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} onKeyDown={onKey} data-testid="coding-via">
          {options.map((o, i) => (
            <button
              key={o}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={via === o}
              aria-disabled={!allowed(o) || undefined}
              aria-describedby={!allowed(o) ? whyId : undefined}
              tabIndex={via === o ? 0 : -1}
              className="cn-seg__opt cw-via__opt"
              onClick={() => choose(o)}
              data-testid={`coding-via-${o}`}
            >
              {t(`features.coding.via.${o}`)}
            </button>
          ))}
        </div>
        <p className="cw-switch__hint" id={hintId} data-testid="coding-via-hint">
          {t(via === 'cloud' ? 'features.coding.via.cloudHint' : 'features.coding.via.localHint', { host: window.location.host })}
        </p>
        {why && (
          <p className="cw-switch__hint cw-via__why" id={whyId} data-testid="coding-via-why">
            {t(why)}
          </p>
        )}
      </div>
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
  const cloud = viaFor(ws) === 'cloud'
  const waitingText = cloud
    ? s.pendingHere
      ? 'features.coding.settings.pendingHere'
      : s.relay?.registered === false
        ? 'features.coding.settings.noCloudWorker'
        : 'features.coding.settings.waitingCloud'
    : 'features.coding.settings.waiting'

  return (
    <div className="cw" data-testid="coding-settings" data-via={cloud ? 'cloud' : 'local'}>
      <p className="cw-lead">
        {t('features.coding.settings.lead')} <HelpLink id="coding-pipeline" />
      </p>

      <ViaSwitch code="§ A" />

      <SetupCard code="§ B" />

      <Panel
        code="§ C"
        title={t('features.coding.settings.worker')}
        state={
          <span className="cw-state" role="status" data-testid="coding-conn">
            <Led state={led} />
            <span className="label">{workerStateText(t, { ...s, cloud })}</span>
          </span>
        }
      >
        <div className="cw-switch">
          <Switch checked={s.enabled} onChange={setCodingEnabled} label={t(cloud ? 'features.coding.settings.allowCloud' : 'features.coding.settings.allow')} />
          <div>
            <div className="cw-switch__label">{t(cloud ? 'features.coding.settings.allowCloud' : 'features.coding.settings.allow')}</div>
            <div className="cw-switch__hint">{t(cloud ? 'features.coding.settings.allowCloudHint' : 'features.coding.settings.allowHint')}</div>
          </div>
        </div>
        <NotifySwitch />
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
          {cloud ? (
            <div className="cw-ro__cell">
              <dt className="label">{t('features.coding.ro.via')}</dt>
              <dd title={window.location.host}>{window.location.host}</dd>
            </div>
          ) : (
            <div className="cw-ro__cell">
              <dt className="label">
                <label htmlFor={portId}>{t('features.coding.ro.port')}</label>
              </dt>
              <dd>
                <input id={portId} className="cw-port" inputMode="numeric" value={port} maxLength={5} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={commitPort} onKeyDown={(e) => e.key === 'Enter' && commitPort()} />
              </dd>
            </div>
          )}
        </dl>
        {connected && s.worker && !s.worker.claude.found && <div className="cw-msg cw-msg--warn">{t('features.coding.settings.noClaude')}</div>}
        {s.enabled && s.conn === 'refused' && <Refused s={s} wsId={ws.id} cloud={cloud} />}
        {s.enabled && s.conn === 'replaced' && (
          <div className="cw-msg">
            <p>{t(cloud ? 'features.coding.settings.replacedCloud' : 'features.coding.settings.replaced')}</p>
            <button type="button" className="btn btn--sm" onClick={reconnect}>
              {t('features.coding.settings.useTab')}
            </button>
          </div>
        )}
        {s.enabled && s.conn === 'waiting' && (
          <div className="cw-msg" data-testid="coding-waiting">
            {t(waitingText)}
          </div>
        )}
        {connected && (
          <p className="cw-as">
            <span className="label">{t('features.coding.settings.as')}</span> {ws.name} <code>{ws.id}</code>
            <button type="button" className="ctk-link" onClick={() => (useUI.getState().closeModal(), navigate({ name: 'coding' }))}>
              {t('features.coding.settings.openCoding')}
            </button>
          </p>
        )}
      </Panel>

      {!cloud && <ManualSetup code="§ D" wsId={ws.id} portFlag={portFlag} />}

      <Panel code={cloud ? '§ D' : '§ E'} title={t('features.coding.settings.safety')}>
        <ul className="cw-safety">
          {cloud ? (
            <>
              <li>{t('features.coding.settings.safeCloud1')}</li>
              <li>{t('features.coding.settings.safeCloud2')}</li>
              <li>{t('features.coding.settings.safeCloud3')}</li>
              <li>{t('features.coding.settings.safe2')}</li>
              <li>{t('features.coding.settings.safe3')}</li>
              <li>{t('features.coding.settings.safeTeam')}</li>
            </>
          ) : (
            <>
              <li>{t('features.coding.settings.safe1')}</li>
              <li>{t('features.coding.settings.safe2')}</li>
              <li>{t('features.coding.settings.safe3')}</li>
              <li>{t('features.coding.settings.safe4')}</li>
              <li>{t('features.coding.settings.safePair')}</li>
              {ws.kind === 'team' && <li>{t('features.coding.settings.safeTeam')}</li>}
            </>
          )}
        </ul>
      </Panel>
    </div>
  )
}

/** For a worker.json of one's own (Local only): download, init with this workspace's id, check, run. */
function ManualSetup({ code, wsId, portFlag }: { code: string; wsId: string; portFlag: string }) {
  const t = useT()
  const ws = { id: wsId }
  return (
    <details className="cw-panel cw-manual">
      <summary className="cw-panel__head">
        <span className="label cw-panel__code">
          {code} — {t('features.coding.settings.setup')}
        </span>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="cw-manual__chev" />
      </summary>
      <div className="cw-panel__body">
        <p className="cw-switch__hint cw-manual__lead">{t('features.coding.settings.manualHint')}</p>
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
      </div>
    </details>
  )
}
