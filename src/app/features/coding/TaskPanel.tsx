/**
 * The task panel on a coding task's page (between its properties and its body): the stage timeline, what
 * the task waits for (Approve · Rework with instructions · Answer · Stop · Retry · Run now · Confirm on this
 * device), and the tabs Log · Plan · Diff · Tests · Git with what this device's worker reported. Business analysis /
 * QA tasks (document stages): Log · Document, a repo is optional, and "Then" hands them on to another pipeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleStop, Play, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { Led, Kbd, MOD } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { navigate } from '../../lib/router'
import type { ID } from '../../store/types'
import { HelpLink } from '../../help'
import { clearLog, loadTask, useCodingLocal, useTaskLocal, useTaskLog } from './local'
import { useCoding } from './state'
import { approveTask, answerTask, confirmTask, reworkTask, runTaskNow, stageSteps, taskContext, taskHasText } from './tasks'
import { confirmWhy, isTrusted } from './trust'
import { stopTask } from './service'
import { usePermissionFocus } from './PermissionCard'
import { LogView } from './LogView'
import { PlanView } from './PlanView'
import { DiffView } from './DiffView'
import { GitBox } from './GitBox'
import { ApprovalsPick, ModelPick, TaskSetup } from './TaskSetup'
import { TaskMcp } from './TaskMcp'
import { NowLine, RunCounters } from './NowLine'
import { FollowUps } from './FollowUps'
import { ImportBox } from './ImportBox'
import { RefsLine } from './RefsLine'
import { refIdsOf } from './refs'
import { RefField, type RefFieldHandle } from './RefField'
import { GivePages } from './GivePages'
import { EMPTY_DRAFT, draftText, type RefDraft } from './refDraft'
import { privateAllowed } from './pagePick'
import { PermissionCard, PermissionSummary, StepLimitBox } from './PermissionCard'
import { planTaskAction, taskPhase } from './terminal'
import { ChainLine, NextStepFold, type ChainNext } from './orders/ChainLine'
import { HandKey } from './orders/HandKey'
import './coding.css'

type Tab = 'log' | 'plan' | 'diff' | 'tests' | 'git'

/**
 * Unsent answers and rework notes, per task, stage and field — this tab, in memory: a page opened from the panel, the
 * browser's Back, another task and back again keep what was being written (and the pages picked into it).
 */
const drafts = new Map<string, RefDraft | null>()

/** A draft kept in `drafts` under `key` (a key changing reads the one kept there); `fallback` while none is kept. */
function useKeptDraft<T extends RefDraft | null>(key: string, fallback: T): [T, (next: T) => void] {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: (drafts.has(key) ? drafts.get(key) : fallback) as T }))
  const value = state.key === key ? state.value : ((drafts.has(key) ? drafts.get(key) : fallback) as T)
  const set = useCallback(
    (next: T) => {
      // nothing to keep: a closed rework form, an empty answer
      if (next === null || (fallback !== null && !next.text && !next.picks.length)) drafts.delete(key)
      else drafts.set(key, next)
      setState({ key, value: next })
    },
    [key, fallback],
  )
  return [value, set]
}

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
  // worker 1.11.0: the permission request the running stage waits for (only on the worker's own tab); a card answered
  // hands the focus on (the state line, then the next request's first key)
  const ask = useCoding((s) => s.asks[pageId] ?? null)
  const permFocus = usePermissionFocus(ask?.id ?? null)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const viewer = useCloud((s) => s.readOnly)
  const [tab, setTab] = useState<Tab | null>(null)
  const draftAt = `${pageId}|${ctx?.stage?.id ?? ''}`
  /** the rework note being written (null: closed) — kept per task and stage while the panel is away */
  const [rework, setRework] = useKeptDraft<RefDraft | null>(`${draftAt}|rework`, null)
  /** the answer being written: its text and the pages picked into it (coding/RefField.tsx) — kept the same way */
  const [answer, setAnswer] = useKeptDraft<RefDraft>(`${draftAt}|answer`, EMPTY_DRAFT)
  const answerField = useRef<RefFieldHandle>(null)
  const askForm = useRef<HTMLFormElement>(null)
  const reworkForm = useRef<HTMLFormElement>(null)
  /** null while checking */
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const elapsed = useElapsed(busy?.since ?? null)
  // a gate whose approval ends a work order's chain step: the step it starts, and whether its fold was seen whole
  const [chainNext, setChainNext] = useState<ChainNext | null>(null)
  const [nextSeen, setNextSeen] = useState(false)
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

  // team: every task; local: a task a custom agent wrote, or one an MCP write moved (trust.ts) — trustRev: this device
  // trusted a version or marked a task (local.ts), also from another tab
  const trustRev = useCodingLocal((s) => s.trustRev)
  // the pages the task takes along are part of its version (trust.ts versionOf): a change there — by anyone, over MCP
  // too — re-checks as well
  const refsAt = useWorkspace((s) => {
    const p = s.pages[pageId]
    return p?.databaseId ? refIdsOf(p).map((id) => `${id}:${s.pages[id]?.updatedAt ?? 0}:${s.pages[id]?.contentRev ?? 0}`).join(' ') : ''
  })
  useEffect(() => {
    let live = true
    setTrusted(null)
    void isTrusted(pageId).then((v) => live && setTrusted(v))
    return () => {
      live = false
    }
  }, [pageId, team, row, dbs, trustRev, refsAt])

  // the chain's next step an approval here starts (terminal.ts planTaskAction: TaskActionPlan.chain)
  // at the gate on this device: the stage moves first, then this device's state follows — asked once both say so
  const atGate = !!ctx?.stage && taskPhase(ctx.stage, local, !!busy) === 'gate'
  useEffect(() => {
    let live = true
    setNextSeen(false)
    if (!atGate) return setChainNext(null)
    void planTaskAction(pageId, 'approve')
      .then((plan) => live && setChainNext(plan.chain ?? null))
      .catch(() => live && setChainNext(null))
    return () => {
      live = false
    }
  }, [pageId, atGate, row, stageId])

  if (!ctx) return null
  const { pipeline, stage, row: task, props, kind } = ctx
  const coding = kind === 'coding'
  const running = !!busy
  const connected = conn === 'connected'
  const repo = props.repo ? (ctx.db.properties.find((p) => p.id === props.repo)?.options?.find((o) => o.id === task.properties[props.repo!])?.name ?? null) : null
  const branch = props.branch ? String(task.properties[props.branch] ?? '').trim() || null : null
  const cost = props.cost && typeof task.properties[props.cost] === 'number' ? (task.properties[props.cost] as number) : 0
  const files = local.git?.files ?? []
  const state = taskPhase(stage, local, running)
  // the tab that fits the moment, until the person picks one
  const before = stage && stage.index > 0 ? pipeline[stage.index - 1]?.kind : undefined
  const auto: Tab = state === 'running' ? 'log' : !coding && local.plan && stage?.kind !== 'queue' ? 'plan' : stage?.kind === 'gate' && (before === 'plan' || before === 'doc' || before === 'analyze') ? 'plan' : stage?.kind === 'gate' || stage?.kind === 'git' || stage?.kind === 'done' ? (files.length ? 'diff' : 'log') : local.test && stage?.kind === 'test' ? 'tests' : 'log'
  const shown = tab ?? auto
  const money = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  const ledState = state === 'running' ? 'on' : state === 'failed' || state === 'stopped' ? 'off' : state === 'done' ? 'ok' : state === 'question' || state === 'gate' || state === 'intake' ? 'on' : 'ok'
  const canAct = !viewer
  const waitsForYou = state === 'running' && !!ask
  const limit = state === 'failed' && local.stepLimit && local.stepLimit.stageId === stage?.id ? local.stepLimit : null
  const perms = !running && local.permissions && (local.permissions.asked > 0 || local.permissions.refused > 0) ? local.permissions : null
  const needsTrust = trusted === false
  const runnable = !!stage && stage.kind !== 'gate' && stage.kind !== 'done' && stage.kind !== 'import'
  // before the task runs: where it works (Repo, Branch) and where it is written (the page)
  const intake = stage?.kind === 'import'
  const setup = canAct && !running && !intake && (!stage || stage.kind === 'queue' || (!repo && coding))

  // private pages (team) only where their title may travel: a private task
  const allowPrivate = privateAllowed(pageId)
  // what is being written right now goes along too: the "Goes along" row shows it before it is sent
  const draft = state === 'question' && canAct ? draftText(answer) : state === 'gate' && canAct && rework ? draftText(rework) : ''

  const act = (fn: () => Promise<void>) => () => {
    void fn().catch((e: unknown) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' }))
  }

  const TABS: Array<[Tab, string]> = coding
    ? [
        ['log', t('features.coding.tab.log')],
        ['plan', t('features.coding.tab.plan')],
        ['diff', files.length ? `${t('features.coding.tab.diff')} ${files.length}` : t('features.coding.tab.diff')],
        ['tests', t('features.coding.tab.tests')],
        ['git', t('features.coding.tab.git')],
      ]
    : [
        ['log', t('features.coding.tab.log')],
        ['plan', t('features.coding.tab.doc')],
      ]

  return (
    <section className="ctk" aria-label={t('features.coding.panel.label')} data-state={state} data-ask={waitsForYou ? '' : undefined} data-trust={trusted === null ? 'checking' : trusted ? 'yes' : 'no'} data-testid="coding-panel">
      <header className="ctk-head">
        <span className="label ctk-code">
          § {coding ? t('features.coding.panel.code') : t(`features.coding.pipe.${kind}.short`)} — {repo ?? t(coding ? 'features.coding.panel.noRepo' : 'features.coding.panel.docsOnly')} · {stage?.name ?? '—'}
        </span>
        <span ref={permFocus.stateLine} className="ctk-state" role="status" tabIndex={-1} data-testid="coding-state">
          <Led state={ledState} />
          <span className="label">
            {t(waitsForYou ? 'features.coding.state.permission' : `features.coding.state.${state}`)}
            {state === 'running' && elapsed ? ` · ${elapsed}` : ''}
          </span>
          <span className="label ctk-cost" title={t('features.coding.panel.costHint')}>
            {money(cost)}
          </span>
          <HelpLink id="coding-pipeline" />
        </span>
      </header>

      {/* a step of a work order's chain on this device: "Teil von Prüfauftrag PA-12 · Schritt 2 von 3 …" */}
      <ChainLine taskId={pageId} />
      <ol ref={line} className="ctk-line" aria-label={t('features.coding.panel.timeline')}>
        {pipeline.map((s) => {
          const pos = !stage ? 'next' : s.index < stage.index ? 'done' : s.id === stage.id ? 'now' : 'next'
          return (
            <li key={s.id} className="ctk-stop" data-pos={pos} data-kind={s.kind} data-hold={s.hold ? '' : undefined} aria-current={pos === 'now' ? 'step' : undefined} title={s.hold ? t('features.coding.pipeline.holdChip') : s.auto ? t('features.coding.panel.auto') : undefined}>
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
            <button type="button" className="ctk-link" onClick={() => navigate(coding ? { name: 'coding' } : { name: 'coding', kind })}>
              {t('features.coding.panel.openCoding')}
            </button>
          </p>
        ) : null}

        {intake && trusted !== false && <ImportBox taskId={pageId} canAct={canAct} />}
        {setup && <TaskSetup taskId={pageId} repo={repo} branch={branch} described={taskHasText(task)} kind={kind} />}
        {canAct && stage?.kind !== 'done' && (
          <div className="ctk-picks">
            <ApprovalsPick taskId={pageId} kind={kind} pipeline={pipeline} />
            <ModelPick taskId={pageId} pipeline={pipeline} />
          </div>
        )}
        {stage?.kind !== 'done' && <TaskMcp taskId={pageId} repo={repo} />}

        {needsTrust && canAct && (
          <div className="ctk-box ctk-box--trust" role="alert">
            <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
            <p>{t(team ? 'features.coding.trust.body' : `features.coding.trust.${confirmWhy(task) ?? 'agent'}`)}</p>
            <button type="button" className="btn btn--sm btn--primary" onClick={act(async () => {
              await confirmTask(pageId)
              setTrusted(true)
            })}>
              {t('features.coding.trust.confirm')}
            </button>
          </div>
        )}

        {waitsForYou && ask && <PermissionCard key={ask.id} taskId={pageId} ask={ask} canAct={canAct && connected} onAnswered={permFocus.onAnswered} />}
        {state === 'running' && (
          <div className="ctk-keys">
            <button type="button" className="btn btn--sm btn--danger" onClick={act(() => stopTask(pageId))} data-testid="coding-stop">
              <CircleStop size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.stop')}
            </button>
            <span className="ctk-hint">{t('features.coding.act.running', { stage: stage?.name ?? '' })}</span>
          </div>
        )}
        {state === 'running' && (
          <div className="ctk-live">
            <NowLine taskId={pageId} />
            <RunCounters taskId={pageId} files={files} onFiles={() => setTab('diff')} />
          </div>
        )}

        {state === 'question' && canAct && (
          <form
            ref={askForm}
            className="ctk-box ctk-box--ask"
            onSubmit={(e) => {
              e.preventDefault()
              const a = draftText(answer)
              if (!a.trim()) return
              setAnswer(EMPTY_DRAFT)
              act(() => answerTask(pageId, a))()
            }}
          >
            <span className="label">{t('features.coding.ask.label')}</span>
            <p className="ctk-question" data-testid="coding-question">{local.question}</p>
            {/* pages the question names in quotes: one key puts the page into the answer */}
            {local.question && <GivePages question={local.question} taskId={pageId} draft={answer} allowPrivate={allowPrivate} field={answerField} />}
            <RefField
              ref={answerField}
              className="input ctk-text"
              rows={2}
              value={answer}
              onChange={setAnswer}
              near={pageId}
              allowPrivate={allowPrivate}
              placeholder={t('features.coding.ask.placeholder')}
              aria-label={t('features.coding.ask.aria')}
              data-testid="coding-answer"
              onSubmit={() => askForm.current?.requestSubmit()}
            />
            <div className="ctk-keys">
              <button type="submit" className="btn btn--sm btn--primary" disabled={!answer.text.trim()}>
                {t('features.coding.ask.send')} <Kbd>{MOD}</Kbd>
                <Kbd>↵</Kbd>
              </button>
            </div>
          </form>
        )}

        {state === 'gate' && chainNext && <NextStepFold next={chainNext} from={pageId} onSeen={setNextSeen} />}
        {state === 'gate' && canAct && rework === null && (
          <div className="ctk-keys">
            {chainNext ? (
              // the approval starts the chain's next step: VON HAND (a fresh press ≥ 300 ms after it showed)
              <HandKey ready onPress={act(() => approveTask(pageId, { sawNext: nextSeen }))} primary testId="coding-approve">
                <Check size={14} strokeWidth={1.75} aria-hidden />
                {t('features.coding.act.approve')}
              </HandKey>
            ) : (
              <button type="button" className="btn btn--sm btn--primary" onClick={act(() => approveTask(pageId))} data-testid="coding-approve">
                <Check size={14} strokeWidth={1.75} aria-hidden />
                {t('features.coding.act.approve')}
              </button>
            )}
            <button type="button" className="btn btn--sm" onClick={() => setRework(EMPTY_DRAFT)} data-testid="coding-rework">
              <Undo2 size={14} strokeWidth={1.75} aria-hidden />
              {t('features.coding.act.rework')}
            </button>
            <span className="ctk-hint">{t('features.coding.act.gateHint', { stage: stage?.name ?? '' })}</span>
          </div>
        )}
        {state === 'gate' && canAct && rework !== null && (
          <form
            ref={reworkForm}
            className="ctk-box ctk-box--rework"
            onSubmit={(e) => {
              e.preventDefault()
              const note = draftText(rework)
              if (!note.trim()) return
              setRework(null)
              act(() => reworkTask(pageId, note))()
            }}
          >
            <label className="label" htmlFor={`ctk-rw-${pageId}`}>
              {t('features.coding.rework.label')}
            </label>
            <RefField
              id={`ctk-rw-${pageId}`}
              className="input ctk-text"
              rows={3}
              value={rework}
              onChange={setRework}
              near={pageId}
              allowPrivate={allowPrivate}
              placeholder={t('features.coding.rework.placeholder')}
              autoFocus
              data-testid="coding-rework-note"
              onSubmit={() => reworkForm.current?.requestSubmit()}
            />
            <div className="ctk-keys">
              <button type="submit" className="btn btn--sm btn--primary" disabled={!rework.text.trim()}>
                {t('features.coding.rework.send')}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRework(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}

        {limit && stage && <StepLimitBox taskId={pageId} limit={limit} steps={stageSteps(stage)} canAct={canAct} onError={(e) => useUI.getState().toast({ message: e instanceof Error ? e.message : String(e), kind: 'error' })} />}
        {(state === 'failed' || state === 'stopped') && !limit && (
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

        {perms && <PermissionSummary counts={perms} />}

        {/* context: where the task hands on to, the pages that go along */}
        {!coding && <FollowUps taskId={pageId} kind={kind} done={stage?.kind === 'done'} canAct={canAct} />}
        {stage?.kind !== 'done' && <RefsLine taskId={pageId} draft={draft} ask={state === 'question' && canAct ? 'answer' : state === 'gate' && canAct && rework ? 'note' : null} />}
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
        {shown === 'plan' && (local.plan ? <PlanView markdown={local.plan} /> : <p className="ctk-empty">{t(coding ? 'features.coding.plan.none' : 'features.coding.doc.none')}</p>)}
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
        {shown === 'git' && (
          <GitBox
            taskId={pageId}
            git={local.git ?? null}
            branch={branch}
            connected={connected && canAct}
            running={running}
            title={task.title.trim() || t('common.untitled')}
            review={local.review?.text ?? null}
            url={(props.pr && typeof task.properties[props.pr] === 'string' ? (task.properties[props.pr] as string) : null) || local.url || null}
          />
        )}
      </div>
    </section>
  )
}
