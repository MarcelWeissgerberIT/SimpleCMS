/**
 * The coding worker in three steps — Settings → Coding worker and #/coding while no worker is connected (or it
 * has no repos yet):
 *   01 Download the worker for this workspace (download.ts: ready-paired with this browser)
 *   02 Start it (node ~/Downloads/one-worker.mjs; needs Node.js 20+ and Claude Code, signed in)
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
import { downloadWorker, startCommand } from './download'
import { openWorkerSetup, viaFor } from './service'
import { CloudSetupCard } from './CloudSetupCard'
import { useCoding } from './state'
import { CodeBlock } from './CodeBlock'
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

/** "Needs Node.js 20+ and Claude Code, signed in" with the two links (the local and the cloud card). */
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
    try {
      await downloadWorker()
      useUI.getState().toast({ message: t('features.coding.card.downloaded'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.coding.card.downloadFailed'), kind: 'error' })
    } finally {
      setBusy(false)
    }
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
          <CodeBlock code={startCommand()} label={t('features.coding.card.startLabel')} testId="coding-start-command" />
          <NeedsLine />
        </Step>
        <Step n={3} state={state(2)} title={t('features.coding.card.step3')} action={<ChangeReposButton />}>
          <p className="cs-hint">{t('features.coding.card.step3Hint')}</p>
        </Step>
      </ol>
      <footer className="cs-live" role="status" data-testid="coding-card-live">
        <span className="label cs-live__k">{t('features.coding.card.live')}</span>
        <Led state={led} />
        <span className="cs-live__v">{s.enabled ? workerStateText(t, s) : t('features.coding.card.idle')}</span>
      </footer>
    </section>
  )
}
