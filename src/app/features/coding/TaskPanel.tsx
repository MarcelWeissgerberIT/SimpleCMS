/**
 * The task panel on a coding task's page (between its properties and its body): the stage timeline, what
 * the task waits for (Approve · Rework with instructions · Answer · Stop · Retry · Run now · Confirm on this
 * device), and the tabs Log · Plan · Diff · Tests · Git with what this device's worker reported.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleStop, Play, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led, Kbd, MOD } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import type { ID } from '../../store/types'
import { HelpLink } from '../../help'
import { clearLog, loadTask, useTaskLocal, useTaskLog } from './local'
import { useCoding } from './state'
import { approveTask, answerTask, confirmTask, reworkTask, runTaskNow, taskContext, taskHasText } from './tasks'
import { isTrusted } from './trust'
import { stopTask } from './service'
import { LogView } from './LogView'
import { PlanView } from './PlanView'
import { DiffView } from './DiffView'
import { GitBox } from './GitBox'
import { ApprovalsPick, TaskSetup } from './TaskSetup'
import './coding.css'

type Tab = 'log' | 'plan' | 'diff' | 'tests' | 'git'

function useElapsed(since: number | null): string {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (!since) return ''
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function TaskPanel({ pageId }: { pageId: ID }) {
  const t = useT()
  const lang = useLang()
  // re-render on the row / the database changing
  const row = useWorkspace((s) => s.pages[pageId])
  const dbs = useWorkspace((s) => s.databases)
  const ctx = useMemo(() => taskContext(pageId), [pageId, row, dbs]) // eslint-disable-line react-hooks/exhaustive-deps
  const local = useTaskLocal(pageId)
  const log = useTaskLog(pageId)
  const conn = useCoding((s) => s.conn)
  const enabled = useCoding((s) => s.enabled)
  const busy = useCoding((s) => s.busy.find((b) => b.taskId === pageId) ?? null)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const viewer = useCloud((s) => s.readOnly)
  const [tab, setTab] = useState<Tab | null>(null)
  const [rework, setRework] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  /** null while checking */
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const elapsed = useElapsed(busy?.since ?? null)
  const line = useRef<HTMLOListElement>(null)
  const stageId = ctx?.stage?.id
  // phones: the timeline scrolls — keep the current stage in view (the strip only)
  useEffect(() => {
    const el = line.current
    const now = el?.querySelector<HTMLElement>('[aria-current="step"]')
    if (el && now && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, now.offsetLeft - el.clientWidth / 2 + now.offsetWidth / 2)
  }, [stageId])

  useEffect(() => {
    void loadTask(pageId)
  }, [pageId])

  // team: every task; local: a task a custom agent wrote (trust.ts)
  useEffect(() => {
    let live = true
    setTrusted(null)
    void isTrusted(pageId).then((v) => live && setTrusted(v))
    return () => {
      live = false
    }
  }, [pageId, team, row, dbs])

  if (!ctx) return null
  const { pipeline, stage, row: task, props } = ctx
  const running = !!busy
  const connected = conn === 'connected'
  const repo = props.repo ? (ctx.db.properties.find((p) => p.id === props.repo)?.options?.find((o) => o.id === task.properties[props.repo!])?.name ?? null) : null
  const branch = props.branch ? String(task.properties[props.branch] ?? '').trim() || null : null
  const cost = props.cost && typeof task.properties[props.cost] === 'number' ? (task.properties[props.cost] as number) : 0
  const files = local.git?.files ?? []
  const state: 'running' | 'question' | 'failed' | 'stopped' | 'gate' | 'done' | 'idle' = running
    ? 'running'
    : local.state === 'question'
      ? 'question'
      : local.state === 'failed'
        ? 'failed'
        : local.state === 'stopped'
          ? 'stopped'
          : stage?.kind === 'gate'
            ? 'gate'
            : stage?.kind === 'done'
              ? 'done'
              : 'idle'
  // the tab that fits the moment, until the person picks one
  const auto: Tab = state === 'running' ? 'log' : stage?.kind === 'gate' && stage.index > 0 && pipeline[stage.index - 1]?.kind === 'plan' ? 'plan' : stage?.kind === 'gate' || stage?.kind === 'git' || stage?.kind === 'done' ? (files.length ? 'diff' : 'log') : local.test && stage?.kind === 'test' ? 'tests' : 'log'
  const shown = tab ?? auto
  const money = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  const ledState = state === 'running' ? 'on' : state === 'failed' || state === 'stopped' ? 'off' : state === 'done' ? 'ok' : state === 'question' || state === 'gate' ? 'on' : 'ok'
  const canAct = !viewer
  const needsTrust = trusted === false
  const runnable = !!stage && stage.kind !== 'gate' && stage.kind !== 'done'
  // before the task runs: where it works (Repo, Branch) and where it is written (the page)
  const setup = canAct && !running && (!stage || stage.kind === 'queue' || !repo)

  const act = (fn: () => Promise<void>) => () => {
    void fn().catch((e: unknown) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' }))
  }

  const TABS: Array<[Tab, string]> = [
    ['log', t('features.coding.tab.log')],
    ['plan', t('features.coding.tab.plan')],
    ['diff', files.length ? `${t('features.coding.tab.diff')} ${files.length}` : t('features.coding.tab.diff')],
    ['tests', t('features.coding.tab.tests')],
    ['git', t('features.coding.tab.git')],
  ]

  return (
    <section className="ctk" aria-label={t('features.coding.panel.label')} data-state={state} data-trust={trusted === null ? 'checking' : trusted ? 'yes' : 'no'} data-testid="coding-panel">
      <header className="ctk-head">
        <span className="label ctk-code">
          § {t('features.coding.panel.code')} — {repo ?? t('features.coding.panel.noRepo')} · {stage?.name ?? '—'}
        </span>
        <span className="ctk-state" role="status" data-testid="coding-state">
          <Led state={ledState} />
          <span className="label">
            {t(`features.coding.state.${state}`)}
            {state === 'running' && elapsed ? ` · ${elapsed}` : ''}
          </span>
          <span className="label ctk-cost" title={t('features.coding.panel.costHint')}>
            {money(cost)}
          </span>
          <HelpLink id="coding-pipeline" />
        </span>
      </header>

      <ol ref={line} className="ctk-line" aria-label={t('features.coding.panel.timeline')}>
        {pipeline.map((s) => {
          const pos = !stage ? 'next' : s.index < stage.index ? 'done' : s.id === stage.id ? 'now' : 'next'
          return (
            <li key={s.id} className="ctk-stop" data-pos={pos} data-kind={s.kind} aria-current={pos === 'now' ? 'step' : undefined} title={s.auto ? t('features.coding.panel.auto') : undefined}>
              <span className="ctk-stop__tick" aria-hidden />
              <span className="ctk-stop__name">{s.name}</span>
            </li>
          )
        })}
      </ol>

      <div className="ctk-act">
        {!enabled || conn !== 'connected' ? (
          <p className="ctk-msg" data-testid="coding-offline">
            {t('features.coding.panel.offline')}{' '}
            <button type="button" className="ctk-link" onClick={() => navigate({ name: 'coding' })}>
              {t('features.coding.panel.openCoding')}
            </button>
          </p>
        ) : null}

        {setup && <TaskSetup taskId={pageId} repo={repo} branch={branch} described={taskHasText(task)} />}
        {canAct && stage?.kind !== 'done' && <ApprovalsPick taskId={pageId} />}

        {needsTrust && canAct && (
          <div className="ctk-box ctk-box--trust" role="alert">
            <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
            <p>{t(team ? 'features.coding.trust.body' : 'features.coding.trust.agent')}</p>
            <button type="button" className="btn btn--sm btn--primary" onClick={act(async () => {
              await confirmTask(pageId)
              setTrusted(true)
            })}>
              {t('features.coding.trust.confirm')}
            </button>
          </div>
        )}

        {state === 'running' && (
          <div className="ctk-keys">
            <button type="button" className="btn btn--sm btn--danger" onClick={act(() => stopTask(pageId))} data-testid="coding-stop">
              <CircleStop size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.stop')}
            </button>
            <span className="ctk-hint">{t('features.coding.act.running', { stage: stage?.name ?? '' })}</span>
          </div>
        )}

        {state === 'question' && canAct && (
          <form
            className="ctk-box ctk-box--ask"
            onSubmit={(e) => {
              e.preventDefault()
              const a = answer
              setAnswer('')
              act(() => answerTask(pageId, a))()
            }}
          >
            <span className="label">{t('features.coding.ask.label')}</span>
            <p className="ctk-question" data-testid="coding-question">{local.question}</p>
            <textarea
              className="input ctk-text"
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={t('features.coding.ask.placeholder')}
              aria-label={t('features.coding.ask.aria')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <div className="ctk-keys">
              <button type="submit" className="btn btn--sm btn--primary" disabled={!answer.trim()}>
                {t('features.coding.ask.send')} <Kbd>{MOD}</Kbd>
                <Kbd>↵</Kbd>
              </button>
            </div>
          </form>
        )}

        {state === 'gate' && canAct && rework === null && (
          <div className="ctk-keys">
            <button type="button" className="btn btn--sm btn--primary" onClick={act(() => approveTask(pageId))} data-testid="coding-approve">
              <Check size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.approve')}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setRework('')} data-testid="coding-rework">
              <Undo2 size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.rework')}
            </button>
            <span className="ctk-hint">{t('features.coding.act.gateHint', { stage: stage?.name ?? '' })}</span>
          </div>
        )}
        {state === 'gate' && canAct && rework !== null && (
          <form
            className="ctk-box"
            onSubmit={(e) => {
              e.preventDefault()
              const note = rework
              setRework(null)
              act(() => reworkTask(pageId, note))()
            }}
          >
            <label className="label" htmlFor={`ctk-rw-${pageId}`}>
              {t('features.coding.rework.label')}
            </label>
            <textarea id={`ctk-rw-${pageId}`} className="input ctk-text" rows={3} value={rework} onChange={(e) => setRework(e.target.value)} placeholder={t('features.coding.rework.placeholder')} autoFocus />
            <div className="ctk-keys">
              <button type="submit" className="btn btn--sm btn--primary" disabled={!rework.trim()}>
                {t('features.coding.rework.send')}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRework(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}

        {(state === 'failed' || state === 'stopped') && (
          <div className="ctk-box ctk-box--err" role="alert">
            <p>
              <strong>{t(state === 'failed' ? 'features.coding.state.failed' : 'features.coding.state.stopped')}</strong> {local.error}
            </p>
            {canAct && (
              <button type="button" className="btn btn--sm" onClick={act(() => runTaskNow(pageId))}>
                <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
                {t('features.coding.act.retry')}
              </button>
            )}
          </div>
        )}

        {state === 'idle' && runnable && canAct && (
          <div className="ctk-keys">
            <button type="button" className="btn btn--sm" onClick={act(() => runTaskNow(pageId))} data-testid="coding-run">
              <Play size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.runNow')}
            </button>
            <span className="ctk-hint">{stage?.auto ? t('features.coding.act.autoHint') : t('features.coding.act.manualHint')}</span>
          </div>
        )}
      </div>

      <div className="ctk-tabs" role="tablist" aria-label={t('features.coding.panel.tabs')}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={shown === id} className="ctk-tab" onClick={() => setTab(id)} data-testid={`coding-tab-${id}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="ctk-body" role="tabpanel">
        {shown === 'log' && <LogView lines={log} onClear={log.length ? () => void clearLog(pageId) : undefined} />}
        {shown === 'plan' && (local.plan ? <PlanView markdown={local.plan} /> : <p className="ctk-empty">{t('features.coding.plan.none')}</p>)}
        {shown === 'diff' && <DiffView files={files} />}
        {shown === 'tests' &&
          (local.test ? (
            <div className="ct" data-ok={local.test.ok}>
              <p className="ct-head">
                <Led state={local.test.ok ? 'ok' : 'off'} />
                <span className="label">
                  {local.test.skipped ? t('features.coding.tests.skipped') : local.test.ok ? t('features.coding.tests.pass', { s: Math.round(local.test.ms / 100) / 10 }) : t('features.coding.tests.fail', { code: local.test.code ?? '—' })}
                </span>
              </p>
              {local.test.output && <pre className="ct-out" data-testid="coding-test-output">{local.test.output}</pre>}
            </div>
          ) : (
            <p className="ctk-empty">{t('features.coding.tests.none')}</p>
          ))}
        {shown === 'git' && <GitBox taskId={pageId} git={local.git ?? null} branch={branch} connected={connected && canAct} running={running} title={task.title.trim() || t('common.untitled')} />}
      </div>
    </section>
  )
}
