/**
 * The coding worker in three steps — Settings → Coding worker and #/coding while no worker is connected (or it
 * has no repos yet):
 *   01 Download the worker for this workspace (download.ts: ready-paired with this browser)
 *   02 Start it (startLines.ts: Windows | macOS · Linux — a PowerShell and a cmd line, or the sh line; needs
 *      Node.js 22+ and Claude Code, signed in)
 *   03 Tick your repositories in the page that opens (the worker's local setup page)
 * and the live state underneath: waiting → connected · laptop · 2 repos. Once connected, "Change repositories"
 * asks the worker to open its page again (`open-setup` — One never sees the page).
 */
import { useId, useState, type ReactNode } from 'react'
import { Check, Download, FolderGit2 } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { workspaceInfo } from '../mcp/identity'
import { WORKER_FILE, downloadWorker, startLines } from './download'
import { workerLacksOnlyExtras, workerOutdated, workerUnsafe } from './protocol'
import { openWorkerSetup, viaFor, workerOldHere } from './service'
import { openCodingSettings } from './open'
import { CloudSetupCard } from './CloudSetupCard'
import { useCoding } from './state'
import { OsSwitch, StartBlock, useStartOs } from './StartBlock'
import { workerStateText } from './stateText'
import './coding.css'

type T = ReturnType<typeof useT>

const NODE_URL = 'https://nodejs.org/en/download'
const CLAUDE_CODE_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup'

/** "Needs {node} and {claude}" → text with the two links in place. */
function withLinks(text: string, links: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{[a-z]+\})/).map((part, i) => {
    const key = /^\{([a-z]+)\}$/.exec(part)?.[1]
    return key && links[key] ? <span key={i}>{links[key]}</span> : part
  })
}

/** "Change repositories": the worker opens its setup page; a toast says what happened. */
export async function changeRepositories(t: T): Promise<void> {
  try {
    const r = await openWorkerSetup()
    const message = r.opened ? t('features.coding.card.opened') : r.reason === 'off' ? t('features.coding.card.noSetup') : t('features.coding.card.noBrowser')
    useUI.getState().toast({ message, kind: r.opened ? 'success' : 'info' })
  } catch (e) {
    useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' })
  }
}

/** Opens the worker's setup page (tick repos, clone, import a ZIP) — only while a worker with that page is connected. */
export function ChangeReposButton({ className = 'btn btn--sm', label, testId = 'coding-change-repos' }: { className?: string; label?: string; testId?: string }) {
  const t = useT()
  const setup = useCoding((s) => s.conn === 'connected' && s.worker?.setup === true)
  if (!setup) return null
  return (
    <button type="button" className={className} onClick={() => void changeRepositories(t)} data-testid={testId}>
      <FolderGit2 size={14} strokeWidth={1.75} aria-hidden /> {label ?? t('features.coding.card.change')}
    </button>
  )
}

export type StepState = 'done' | 'current' | 'todo'

/** "Needs Node.js 22+ and Claude Code, signed in" with the two links (the local and the cloud card). */
export function NeedsLine() {
  const t = useT()
  return (
    <p className="cs-hint cs-needs">
      {withLinks(t('features.coding.card.needs'), {
        node: (
          <a href={NODE_URL} target="_blank" rel="noreferrer noopener">
            {t('features.coding.card.node')}
          </a>
        ),
        claude: (
          <a href={CLAUDE_CODE_URL} target="_blank" rel="noreferrer noopener">
            {t('features.coding.card.claude')}
          </a>
        ),
      })}
    </p>
  )
}

export function Step({ n, state, title, children, action }: { n: number; state: StepState; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = useT()
  return (
    <li className="cs-step" data-state={state} data-testid={`coding-step-${n}`}>
      <span className="cs-n" aria-hidden>
        {state === 'done' ? <Check size={13} strokeWidth={2.4} /> : String(n).padStart(2, '0')}
      </span>
      <div className="cs-body">
        <h3 className="cs-title">
          {title}
          {state === 'done' && <span className="visually-hidden"> — {t('features.coding.card.done')}</span>}
        </h3>
        {children}
      </div>
      {action && <div className="cs-act">{action}</div>}
    </li>
  )
}

/** The ready-paired download with its toast (step 1, and "Download again" for an outdated worker). */
async function downloadWithToast(t: ReturnType<typeof useT>): Promise<void> {
  try {
    await downloadWorker()
    useUI.getState().toast({ message: t('features.coding.card.downloaded'), kind: 'success' })
  } catch {
    useUI.getState().toast({ message: t('features.coding.card.downloadFailed'), kind: 'error' })
  }
}

/**
 * A worker older than the download on the site (it does not name everything One hands out): say so, offer the file —
 * "skips stages it does not know" only when it lacks a capability a stage needs; one that lacks only WORKER_EXTRAS
 * (1.9.0: no ship record) runs every stage, and the text says what the newer one adds.
 * A worker with the ZIP-import gap (`workerUnsafe` — the version its welcome names) gets the security notice instead:
 * it wins over the capability text, since 1.8.0 names every capability. Next a worker older than 1.9.0 on this
 * Windows computer (`workerOldHere`: a Local link from a browser on Windows — it can start a program a repository
 * brought along): a security notice of its own, never on macOS / Linux or through Cloud. `only="security"`: the setup cards (Settings →
 * Coding worker, #/coding before a repo is ticked) show that one alone. `download`: the card's own download (the
 * cloud card asks before it replaces a worker); without one the local file — through the relay the key opens
 * Settings → Coding worker instead, where the cloud card's download is (never the local file for a cloud worker).
 */
export function OutdatedWorker({ only, download, busy: cardBusy }: { only?: 'security'; download?: () => void | Promise<void>; busy?: boolean }) {
  const t = useT()
  const can = useCoding((s) => s.can)
  const version = useCoding((s) => (s.conn === 'connected' ? (s.worker?.worker ?? null) : null))
  useCoding((s) => s.via)
  useCloud((x) => x.active)
  const [busy, setBusy] = useState(false)
  const unsafe = workerUnsafe(version)
  const windows = !unsafe && workerOldHere(version)
  if (!unsafe && !windows && (only === 'security' || !workerOutdated(can))) return null
  const viaCloud = !download && viaFor(workspaceInfo()) === 'cloud'
  const pending = cardBusy ?? busy
  const press = async () => {
    if (download) return void download()
    if (viaCloud) return openCodingSettings()
    setBusy(true)
    await downloadWithToast(t)
    setBusy(false)
  }
  return (
    <p className="cv-plate__old" data-kind={unsafe || windows ? 'security' : 'outdated'} role="status" data-testid={unsafe ? 'coding-worker-unsafe' : windows ? 'coding-worker-windows' : 'coding-worker-outdated'}>
      <Led state="on" />
      {unsafe || windows ? (
        <span>
          <span className="label cv-plate__sec">{t('features.coding.worker.unsafeLabel')}</span> {t(unsafe ? 'features.coding.worker.unsafe' : 'features.coding.worker.windows', { version: String(version).trim() })}
        </span>
      ) : (
        <span>{t(workerLacksOnlyExtras(can) ? 'features.coding.worker.outdatedExtras' : 'features.coding.worker.outdated')}</span>
      )}
      <button type="button" className="btn btn--sm" onClick={() => void press()} disabled={pending} data-testid="coding-download-again">
        <Download size={13} strokeWidth={1.75} aria-hidden /> {viaCloud ? t('features.coding.worker.toDownload') : pending ? t('features.coding.card.downloading') : t('features.coding.card.downloadAgain')}
      </button>
    </p>
  )
}

export function SetupCard({ code = '§ A' }: { code?: string }) {
  useCoding((s) => s.via)
  useCloud((x) => x.active)
  // this team workspace reaches its worker through the team server on this device: the cloud steps
  if (viaFor(workspaceInfo()) === 'cloud') return <CloudSetupCard code={code} />
  return <LocalSetupCard code={code} />
}

function LocalSetupCard({ code }: { code: string }) {
  const t = useT()
  const lang = useLang()
  const s = useCoding()
  const os = useStartOs()
  useWorkspace((x) => x.settings.workspaceName)
  useWorkspace((x) => x.epoch)
  useCloud((x) => x.active)
  const ws = workspaceInfo()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const pair = s.pairs[ws.id] ?? null
  const connected = s.enabled && s.conn === 'connected'
  const repos = connected ? (s.worker?.repos.length ?? 0) : 0
  const done = [!!pair || connected, connected, connected && repos > 0]
  const current = done.indexOf(false)
  const state = (i: number): StepState => (done[i] ? 'done' : i === current ? 'current' : 'todo')
  const led = connected ? (repos ? 'ok' : 'on') : s.enabled && (s.conn === 'waiting' || s.conn === 'connecting') ? 'on' : 'off'
  const when = pair ? new Date(pair.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''

  const download = async () => {
    setBusy(true)
    await downloadWithToast(t)
    setBusy(false)
  }

  return (
    <section className="cs" aria-labelledby={id} data-testid="coding-setup-card">
      <header className="cw-panel__head">
        <span className="label cw-panel__code" id={id}>
          {code} — {t('features.coding.card.kicker')}
        </span>
        <span className="label cs-ws" title={ws.id}>
          {ws.name}
        </span>
      </header>
      <ol className="cs-steps">
        <Step
          n={1}
          state={state(0)}
          title={t('features.coding.card.step1')}
          action={
            <button type="button" className={pair ? 'btn btn--sm' : 'btn btn--primary'} onClick={() => void download()} disabled={busy} data-testid="coding-download">
              <Download size={14} strokeWidth={1.8} aria-hidden /> {busy ? t('features.coding.card.downloading') : pair ? t('features.coding.card.downloadAgain') : t('features.coding.card.download')}
            </button>
          }
        >
          <p className="cs-hint">{pair ? t('features.coding.card.step1Done', { when }) : t('features.coding.card.step1Hint', { name: ws.name })}</p>
        </Step>
        <Step n={2} state={state(1)} title={t('features.coding.card.step2')}>
          <p className="cs-hint">{t('features.coding.card.step2Hint')}</p>
          <OsSwitch />
          <StartBlock make={(os) => [startLines(WORKER_FILE, { os })]} label={t('features.coding.card.startLabel')} testId="coding-start-command" />
          {os === 'windows' && (
            <>
              <p className="cs-hint">{t('features.coding.card.windows')}</p>
              <p className="cs-hint" data-testid="coding-start-folder">
                {t('features.coding.card.windowsFolder')}
              </p>
            </>
          )}
          <NeedsLine />
        </Step>
        <Step n={3} state={state(2)} title={t('features.coding.card.step3')} action={<ChangeReposButton />}>
          <p className="cs-hint">{t('features.coding.card.step3Hint')}</p>
        </Step>
      </ol>
      <OutdatedWorker only="security" download={download} busy={busy} />
      <footer className="cs-live" role="status" data-testid="coding-card-live">
        <span className="label cs-live__k">{t('features.coding.card.live')}</span>
        <Led state={led} />
        {/* the whole text, wrapped: a refusal or the browser's block says what to do */}
        <span className="cs-live__v cs-live__v--wrap">{s.enabled ? workerStateText(t, s) : t('features.coding.card.idle')}</span>
      </footer>
    </section>
  )
}
