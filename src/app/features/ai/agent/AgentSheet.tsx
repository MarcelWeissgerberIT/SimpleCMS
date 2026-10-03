/**
 * Workspace agent — the panel: a right-hand sheet (full screen on phones) built like an
 * instrument readout. Task field → numbered step log with LEDs → review list of staged
 * changes (nothing is written before "Apply") → usage meter.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, CornerDownLeft, ExternalLink, KeyRound, RotateCcw, Square, Undo2, X } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { openPage } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { Kbd, shortcutLabel } from '../../../ui/controls'
import { AI_MODELS, resolveModel } from '../client'
import { MarkdownLite } from '../MarkdownLite'
import { closeAgent, useAgent } from './state'
import { applyStaged, changeTarget, discardAllStaged, discardStaged, newTask, restoreStaged, runTask, stopTask, tn } from './session'
import { MAX_TOOL_CALLS } from './tools'
import { AGENT_SHORTCUT } from './AgentPanel'
import type { AgentStep, AgentTurn, PropChange, StagedChange } from './types'
import '../ai.css'
import './agent.css'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function fmtUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '< $0.01'
  return `$${usd.toFixed(2)}`
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${Math.floor((ms % 1000) / 100)}`
}

export default function AgentSheet() {
  const t = useT()
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const status = useAgent((s) => s.status)
  const turns = useAgent((s) => s.turns)
  const changes = useAgent((s) => s.changes)
  const autorun = useAgent((s) => s.autorun)
  const running = status === 'running'
  const pending = changes.filter((c) => c.status === 'pending').length
  const readOnly = useCloud((s) => s.readOnly)

  const sheetRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)

  // focus the task field on open; give focus back on close
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(id)
      if (prev?.isConnected && !sheetRef.current?.contains(prev)) prev.focus?.({ preventScroll: true })
    }
  }, [])

  // opened from the AI menu with a task: run it
  useEffect(() => {
    if (autorun && hasKey && !running) void runTask()
  }, [autorun, hasKey, running])

  // keep the log scrolled to the newest line while the reader is at the bottom
  const steps = useAgent((s) => s.steps.length)
  const live = useAgent((s) => s.live.length)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [steps, live, turns.length, status, changes.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[data-popover]')) {
      e.preventDefault()
      e.stopPropagation()
      closeAgent()
      return
    }
    // ⌘↵ / Ctrl+↵: apply all
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !running && pending && !readOnly) {
      e.preventDefault()
      void applyStaged()
    }
  }

  const jumpToReview = () => reviewRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })

  return (
    <aside ref={sheetRef} className="agent" role="dialog" aria-modal="false" aria-labelledby="agent-title" data-status={status} onKeyDown={onKeyDown}>
      <Head />
      <div
        className="agent-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
        }}
      >
        {!hasKey && <NoKey />}
        {turns.length === 0 ? <Standby disabled={!hasKey} onPick={(task) => useAgent.setState({ draft: task })} /> : turns.map((turn) => <TurnView key={turn.n} turn={turn} last={turn.n === turns.length} />)}
        {changes.length > 0 && <Review ref={reviewRef} readOnly={readOnly} />}
      </div>
      {pending > 0 && (
        <div className="agent-bar" role="region" aria-label={tn('features.agent.review.title', pending)}>
          <span className="led led--on" aria-hidden />
          <span className="agent-bar__count label">{tn('features.agent.review.title', pending)}</span>
          <span className="agent-spacer" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={jumpToReview}>
            <ArrowDown size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.jump')}
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={running || readOnly} onClick={() => void applyStaged()} title={`${shortcutLabel('Mod+Enter')}`}>
            {t('features.agent.review.applyAll')}
          </button>
        </div>
      )}
      <Composer inputRef={inputRef} disabled={!hasKey} />
      <Meter />
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* Head                                                                */
/* ------------------------------------------------------------------ */

function Head() {
  const t = useT()
  const status = useAgent((s) => s.status)
  const turns = useAgent((s) => s.turns.length)
  const changes = useAgent((s) => s.changes.length)
  const model = resolveModel(useWorkspace((s) => s.settings.aiModel))
  const updateSettings = useWorkspace((s) => s.updateSettings)
  const running = status === 'running'
  const cycleModel = () => {
    const i = AI_MODELS.findIndex((m) => m.id === model.id)
    updateSettings({ aiModel: AI_MODELS[(i + 1) % AI_MODELS.length].id })
  }
  const led = running ? 'led led--on ai-led--live' : status === 'error' ? 'led ai-led--err' : status === 'idle' ? 'led' : status === 'done' ? 'led led--ok' : 'led led--on'
  return (
    <header className="agent-head">
      <div className="agent-head__plate">
        <div className="agent-head__line">
          <span className="agent-head__code label">§ AI-02</span>
          <span className="agent-head__status label" aria-live="polite">
            <span className={led} aria-hidden /> {t(`features.agent.status.${status}`)}
          </span>
        </div>
        <h2 id="agent-title" className="agent-head__title">
          {t('features.agent.title')}
        </h2>
      </div>
      <div className="agent-head__tools">
        <button type="button" className="ai-model" onClick={cycleModel} disabled={running} title={t('features.ai.switchModel')}>
          <span className="ai-model__brand">CLAUDE · </span>
          {model.short}
        </button>
        <button type="button" className="icon-btn" onClick={newTask} disabled={!turns && !changes} aria-label={t('features.agent.newTask')} title={t('features.agent.newTask')}>
          <RotateCcw size={15} strokeWidth={1.7} />
        </button>
        <button type="button" className="icon-btn" onClick={closeAgent} aria-label={t('features.agent.close')} title={`${t('features.agent.close')} (Esc)`}>
          <X size={16} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states                                                        */
/* ------------------------------------------------------------------ */

function NoKey() {
  const t = useT()
  return (
    <div className="agent-nokey" role="note">
      <span className="led" aria-hidden />
      <div className="agent-nokey__text">
        <strong>{t('features.agent.nokey.title')}</strong>
        <span>{t('features.agent.nokey.body')}</span>
      </div>
      <button type="button" className="btn btn--sm btn--ink" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
        <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.nokey.open')}
      </button>
    </div>
  )
}

function Standby({ onPick, disabled }: { onPick: (task: string) => void; disabled: boolean }) {
  const t = useT()
  const examples = [t('features.agent.ex.1'), t('features.agent.ex.2'), t('features.agent.ex.3')]
  return (
    <div className="agent-standby">
      <p className="agent-standby__lead">{t('features.agent.lead')}</p>
      <dl className="agent-spec">
        <div>
          <dt className="label">{t('features.agent.caps.read')}</dt>
          <dd>{t('features.agent.caps.readList')}</dd>
        </div>
        <div>
          <dt className="label">{t('features.agent.caps.write')}</dt>
          <dd>{t('features.agent.caps.writeList')}</dd>
        </div>
        <div>
          <dt className="label">{t('features.agent.caps.limit')}</dt>
          <dd>{t('features.agent.caps.limitList', { max: MAX_TOOL_CALLS })}</dd>
        </div>
      </dl>
      <div className="agent-examples">
        <span className="label">{t('features.agent.examples')}</span>
        {examples.map((ex, i) => (
          <button key={i} type="button" className="agent-example" disabled={disabled} onClick={() => onPick(ex)}>
            <span className="agent-example__n mono">{pad(i + 1)}</span>
            <span>{ex}</span>
            <ArrowRight size={13} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
      </div>
      <div className="agent-standby__keys label">
        <Kbd>{shortcutLabel(AGENT_SHORTCUT)}</Kbd> {t('features.agent.kbd.toggle')}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Turns & steps                                                       */
/* ------------------------------------------------------------------ */

function Elapsed({ start, end }: { start: number; end?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (end) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [end])
  return <span className="agent-turn__time mono">{fmtMs(Math.max(0, (end ?? now) - start))}</span>
}

function TurnView({ turn, last }: { turn: AgentTurn; last: boolean }) {
  const t = useT()
  const allSteps = useAgent((s) => s.steps)
  const steps = useMemo(() => allSteps.filter((x) => x.turn === turn.n), [allSteps, turn.n])
  const live = useAgent((s) => (last ? s.live : ''))
  const running = turn.status === 'running'
  let n = 0
  return (
    <section className="agent-turn" data-status={turn.status} aria-label={`${t('features.agent.task')} ${pad(turn.n)}`}>
      <div className="agent-turn__head">
        <span className="label">
          {t('features.agent.task')} {pad(turn.n)}
        </span>
        <span className="agent-turn__rule" aria-hidden />
        <Elapsed start={turn.startedAt} end={turn.endedAt} />
      </div>
      <p className="agent-turn__task">{turn.task}</p>
      <ol className="agent-steps" role="log" aria-label={t('features.agent.log')} aria-live="polite">
        {steps.map((s) => (s.kind === 'note' ? <NoteRow key={s.id} step={s} /> : <StepRow key={s.id} step={s} n={++n} />))}
        {running && !live && (
          <li className="agent-step agent-step--wait" aria-hidden>
            <span className="led led--on ai-led--live" />
            <span className="agent-step__n mono">{pad(n + 1)}</span>
            <span className="agent-step__verb mono">{t('features.agent.working')}</span>
            <span className="agent-wait" />
          </li>
        )}
      </ol>
      {live && (
        <div className="agent-live">
          <MarkdownLite source={live} />
        </div>
      )}
      {turn.answer && (
        <div className="agent-answer">
          <span className="label">{t('features.agent.answer')}</span>
          <MarkdownLite source={turn.answer} />
        </div>
      )}
      {turn.status === 'stopped' && <p className="agent-turn__note label">{t('features.agent.stoppedNote')}</p>}
      {turn.status === 'limit' && <p className="agent-turn__note label">{t('features.agent.limitEnd')}</p>}
      {turn.status === 'error' && turn.error && <TurnError error={turn.error} />}
    </section>
  )
}

function TurnError({ error }: { error: NonNullable<AgentTurn['error']> }) {
  const t = useT()
  const keyIssue = error.code === 'invalid_key' || error.code === 'no_key' || error.code === 'permission'
  return (
    <div className="agent-error" role="alert">
      <span className="agent-error__code label">ERR · {error.code.toUpperCase()}</span>
      <p>{error.message}</p>
      {keyIssue && (
        <button type="button" className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
          <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.nokey.open')}
        </button>
      )}
    </div>
  )
}

function StepRow({ step, n }: { step: AgentStep; n: number }) {
  const t = useT()
  const tool = step.tool!
  const led = step.state === 'run' ? 'led led--on ai-led--live' : step.state === 'err' ? 'led ai-led--err' : step.state === 'staged' ? 'led led--on' : 'led led--ok'
  const arg = step.arg || (tool === 'list_databases' || tool === 'get_current_page' ? t(`features.agent.verb.${tool}.arg`) : '')
  const result = step.state === 'err' ? t('features.agent.res.rejected') : (step.result ?? '')
  return (
    <li className="agent-step" data-state={step.state} data-tool={tool}>
      <span className={led} aria-hidden />
      <span className="agent-step__n mono">{pad(n)}</span>
      <span className="agent-step__verb mono">{t(`features.agent.verb.${tool}`)}</span>
      <span className="agent-step__arg" title={arg}>
        {arg}
      </span>
      <span className="agent-step__res mono">{result}</span>
    </li>
  )
}

function NoteRow({ step }: { step: AgentStep }) {
  const t = useT()
  return (
    <li className="agent-step agent-step--note">
      <span className="agent-step__tick" aria-hidden />
      <span className="visually-hidden">{t('features.agent.note')}: </span>
      <span className="agent-step__text">{step.text}</span>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

function Review({ ref, readOnly }: { ref: React.Ref<HTMLElement>; readOnly: boolean }) {
  const t = useT()
  const changes = useAgent((s) => s.changes)
  const running = useAgent((s) => s.status === 'running')
  const pending = changes.filter((c) => c.status === 'pending' || c.status === 'failed').length
  return (
    <section className="agent-review" ref={ref} aria-labelledby="agent-review-title">
      <div className="agent-review__head">
        <h3 id="agent-review-title" className="agent-review__title label">
          {tn('features.agent.review.title', changes.length)}
        </h3>
        <span className="agent-spacer" />
        {pending > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={running} onClick={discardAllStaged}>
            {t('features.agent.review.discardAll')}
          </button>
        )}
      </div>
      <p className="agent-review__note">{readOnly ? t('features.agent.review.readOnly') : t('features.agent.review.note')}</p>
      <ol className="agent-changes">
        {changes.map((c) => (
          <ChangeItem key={c.id} change={c} all={changes} disabled={running || readOnly} />
        ))}
      </ol>
    </section>
  )
}

function useTitleOf() {
  const pages = useWorkspace((s) => s.pages)
  const t = useT()
  return useCallback((id: string | null | undefined, all: StagedChange[]) => {
    if (!id) return ''
    const staged = all.find((c) => (c.kind === 'create_page' || c.kind === 'create_row') && c.pageId === id)
    if (staged && !pages[id]) return staged.title ?? ''
    return pages[id]?.title.trim() || t('common.untitled')
  }, [pages, t])
}

function ChangeItem({ change: c, all, disabled }: { change: StagedChange; all: StagedChange[]; disabled: boolean }) {
  const t = useT()
  const titleOf = useTitleOf()
  const parent = c.dependsOn ? all.find((x) => x.id === c.dependsOn) : undefined
  const blocked = !!parent && parent.status !== 'applied'
  let where = ''
  if (c.kind === 'create_page') where = c.parentId ? t('features.agent.review.under', { title: titleOf(c.parentId, all) }) : t('features.agent.review.topLevel')
  else if (c.kind === 'create_row' || c.kind === 'update_row') where = t('features.agent.review.in', { title: titleOf(c.databaseId, all) })
  const label = `#${c.n}`
  const target = c.status === 'applied' ? changeTarget(c) : null
  const open = () => {
    if (!target) return
    if (c.kind === 'create_row' || c.kind === 'update_row') useUI.getState().openPeek(target)
    else openPage(target)
  }

  let title: ReactNode = c.title
  if (c.kind === 'rename')
    title = (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    )
  else if (c.kind === 'append' || c.kind === 'update_row') title = titleOf(c.pageId, all) || c.title

  return (
    <li className="agent-change" data-status={c.status} data-kind={c.kind} aria-label={`${label} ${t(`features.agent.kind.${c.kind}`)}`}>
      <div className="agent-change__head">
        <span className="agent-change__n mono">{label}</span>
        <span className="agent-change__kind label">{t(`features.agent.kind.${c.kind}`)}</span>
        {where && <span className="agent-change__where">{where}</span>}
        <span className="agent-spacer" />
        {c.status === 'pending' || c.status === 'failed' ? (
          <span className="agent-change__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => discardStaged(c.id)} disabled={disabled} aria-label={`${t('features.agent.review.discard')} ${label}`}>
              {t('features.agent.review.discard')}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ink"
              onClick={() => void applyStaged([c.id])}
              disabled={disabled || blocked}
              aria-label={`${t('features.agent.review.apply')} ${label}`}
              title={blocked && parent ? t('features.agent.review.needs', { n: parent.n }) : undefined}
            >
              {t('features.agent.review.apply')}
            </button>
          </span>
        ) : c.status === 'applied' ? (
          <span className="agent-change__actions">
            <span className="agent-change__state label">
              <span className="led led--ok" aria-hidden /> {t('features.agent.review.applied')}
            </span>
            {target && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={open} aria-label={`${t('features.agent.review.open')} ${label}`}>
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.open')}
              </button>
            )}
          </span>
        ) : (
          <span className="agent-change__actions">
            <span className="agent-change__state label">{t('features.agent.review.discarded')}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => restoreStaged(c.id)} disabled={disabled} aria-label={`${t('features.agent.review.restore')} ${label}`}>
              <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.restore')}
            </button>
          </span>
        )}
      </div>
      {title && <div className="agent-change__title">{title}</div>}
      {c.props && c.props.length > 0 && <PropDiff props={c.props} />}
      {c.markdown?.trim() && c.kind !== 'rename' && <Preview markdown={c.markdown} append={c.kind === 'append'} />}
      {c.status === 'failed' && c.error && <p className="agent-change__error">{t('features.agent.review.failed', { error: c.error })}</p>}
      {blocked && parent && c.status === 'pending' && <p className="agent-change__hint label">{t('features.agent.review.needs', { n: parent.n })}</p>}
    </li>
  )
}

function PropDiff({ props }: { props: PropChange[] }) {
  const t = useT()
  return (
    <dl className="agent-diff">
      {props.map((p) => (
        <div key={p.propId} className="agent-diff__row">
          <dt className="agent-diff__name">{p.name}</dt>
          <dd className="agent-diff__vals">
            <span className="agent-diff__before" data-empty={!p.before || undefined}>
              {p.before || '—'}
            </span>
            <span className="agent-diff__arrow" aria-hidden>
              →
            </span>
            <span className="agent-diff__after" data-empty={!p.after || undefined}>
              {p.after || '—'}
            </span>
            {p.newOptions?.length ? <span className="agent-diff__new label">+ {t('features.agent.review.newOption')}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const PREVIEW_LINES = 10

function Preview({ markdown, append }: { markdown: string; append: boolean }) {
  const t = useT()
  const lines = markdown.trim().split('\n')
  // never cut inside a code fence or a table: show whole blocks up to the limit
  let end = Math.min(lines.length, PREVIEW_LINES)
  const fences = lines.slice(0, end).filter((l) => /^\s*```/.test(l)).length
  if (fences % 2) {
    const close = lines.findIndex((l, i) => i >= end && /^\s*```/.test(l))
    end = close >= 0 ? close + 1 : lines.length
  }
  const rest = lines.length - end
  return (
    <div className="agent-preview" data-append={append || undefined}>
      {append && <span className="agent-preview__plus mono" aria-hidden>+</span>}
      <MarkdownLite source={lines.slice(0, end).join('\n')} />
      {rest > 0 && <span className="agent-preview__more label">{t('features.agent.review.more', { count: rest })}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Composer & meter                                                    */
/* ------------------------------------------------------------------ */

function Composer({ inputRef, disabled }: { inputRef: React.RefObject<HTMLTextAreaElement | null>; disabled: boolean }) {
  const t = useT()
  const draft = useAgent((s) => s.draft)
  const running = useAgent((s) => s.status === 'running')
  const hasTurns = useAgent((s) => s.turns.length > 0)

  // grow with the text (up to the CSS max-height)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, inputRef])

  const submit = () => {
    if (running || disabled || !draft.trim()) return
    void runTask()
  }

  return (
    <form
      className="agent-compose"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={inputRef}
        className="agent-compose__input"
        rows={1}
        value={draft}
        placeholder={hasTurns ? t('features.agent.placeholderNext') : t('features.agent.placeholder')}
        aria-label={t('features.agent.taskLabel')}
        onChange={(e) => useAgent.setState({ draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault()
            submit()
          }
        }}
        spellCheck={false}
      />
      {running ? (
        <button type="button" className="btn btn--sm agent-compose__btn agent-compose__stop" onClick={stopTask}>
          <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden /> {t('features.agent.stop')}
        </button>
      ) : (
        <button type="submit" className="btn btn--primary btn--sm agent-compose__btn" disabled={disabled || !draft.trim()}>
          {t('features.agent.run')} <CornerDownLeft size={12} strokeWidth={1.9} aria-hidden />
        </button>
      )}
      <div className="agent-compose__keys label" aria-hidden>
        <span>
          <Kbd>↵</Kbd> {t('features.agent.kbd.run')}
        </span>
        <span>
          <Kbd>{shortcutLabel('Shift')}</Kbd>
          <Kbd>↵</Kbd> {t('features.agent.kbd.newline')}
        </span>
        <span>
          <Kbd>{shortcutLabel('Mod')}</Kbd>
          <Kbd>↵</Kbd> {t('features.agent.kbd.apply')}
        </span>
      </div>
    </form>
  )
}

function Meter() {
  const t = useT()
  const usage = useAgent((s) => s.usage)
  const calls = useAgent((s) => s.calls)
  const running = useAgent((s) => s.status === 'running')
  return (
    <footer className="agent-meter" aria-label={t('features.agent.meter.billed')}>
      <dl className="agent-meter__vals">
        <div>
          <dt>{t('features.agent.meter.in')}</dt>
          <dd>{fmtTokens(usage.input + usage.cacheWrite)}</dd>
        </div>
        <div>
          <dt>{t('features.agent.meter.cache')}</dt>
          <dd>{fmtTokens(usage.cacheRead)}</dd>
        </div>
        <div>
          <dt>{t('features.agent.meter.out')}</dt>
          <dd>{fmtTokens(usage.output)}</dd>
        </div>
        <div>
          <dt>{t('features.agent.meter.calls')}</dt>
          <dd data-hot={running && calls >= MAX_TOOL_CALLS - 3 ? '' : undefined}>
            {calls}/{MAX_TOOL_CALLS}
          </dd>
        </div>
        <div className="agent-meter__usd">
          <dt className="visually-hidden">USD</dt>
          <dd data-testid="agent-cost">≈ {fmtUsd(usage.usd)}</dd>
        </div>
      </dl>
      <p className="agent-meter__note">{t('features.agent.meter.billed')}</p>
    </footer>
  )
}
