/**
 * AI terminal — the dock at the bottom of the content area (the sidebar stays visible; a full-screen
 * sheet on phones), built like an instrument readout: an ink panel in JetBrains Mono. Prompt with
 * history, Tab completion and context chips → a log (the answer streams in, one line per tool call)
 * → the review list of staged changes (keyboard: j / k, Space, Enter, a, d, o, u) → the meter.
 * Hiding it never stops a task (only Stop, ⌘. / Ctrl+., Ctrl+C or /stop do).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ChevronDown, CornerDownLeft, ExternalLink, KeyRound, Maximize2, Minimize2, RotateCcw, Settings2, Square, Undo2, X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { openPage, useRoute } from '../../../lib/router'
import { useCloud } from '../../../cloud'
import { shortcutLabel } from '../../../ui/controls'
import { AI_MODELS, resolveModel } from '../client'
import { MarkdownLite } from '../MarkdownLite'
import { closeAgent, clampHeight, removeRef, setTermHeight, stopAgent, useAgent, HEIGHT_DEFAULT, type EchoEntry } from './state'
import { applyStaged, changeTarget, contextPageId, discardAllStaged, discardStaged, newTask, pickContext, restoreStaged, runTask, submitPrompt, tn, undoLastBatch } from './session'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { setContextMode, useContextMarks, type ContextMode } from '../../../editor'
import { effectiveMode } from '../reads'
import { MAX_TOOL_CALLS } from './tools'
import { currentSetup, readServers, setupKey } from '../mcp-servers/config'
import { callLabel } from '../mcp-servers/activity'
import { AGENT_REF_SHORTCUT, AGENT_SHORTCUT, AGENT_STOP_SHORTCUT } from './AgentPanel'
import { COMMANDS, completionAt, type Completion } from './commands'
import { loadHistory } from './history'
import { PropDiff, Preview, SchemaDiff } from './ReviewParts'
import { depsOf, type AgentStep, type AgentTurn, type StagedChange } from './types'
import '../ai.css'
import './agent.css'

export { PropDiff, Preview } from './ReviewParts'

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

const isPhone = () => window.matchMedia?.('(max-width: 640px)').matches ?? false
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** The prompt's field (focus target of the review list's Esc, the chips, ⌘⇧J). */
const focusPrompt = () => document.querySelector<HTMLTextAreaElement>('.term-prompt__input')?.focus({ preventScroll: true })

export default function AgentSheet() {
  const t = useT()
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const status = useAgent((s) => s.status)
  const turns = useAgent((s) => s.turns)
  const echo = useAgent((s) => s.echo)
  const changes = useAgent((s) => s.changes)
  const autorun = useAgent((s) => s.autorun)
  const height = useAgent((s) => s.height)
  const max = useAgent((s) => s.max)
  const focusTick = useAgent((s) => s.focusTick)
  const running = status === 'running'
  const pending = changes.filter((c) => c.status === 'pending').length
  const readOnly = useCloud((s) => s.readOnly)
  // the dock lives in the content column (below the page); without it (signed out …) it floats
  const [host] = useState<HTMLElement | null>(() => document.querySelector<HTMLElement>('.app-main'))

  const rootRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const stickRef = useRef(true)

  // focus the prompt on open (and when asked again: ⌘⇧J); give focus back on hide
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => {
      if (prev?.isConnected && !rootRef.current?.contains(prev)) prev.focus?.({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const id = requestAnimationFrame(focusPrompt)
    return () => cancelAnimationFrame(id)
  }, [focusTick])

  // opened from the AI menu with a task: run it
  useEffect(() => {
    if (autorun && hasKey && !running) void runTask()
  }, [autorun, hasKey, running])

  // phones: the sheet covers the page, so going somewhere else hides it (the task goes on)
  useEffect(() => {
    const onHash = () => isPhone() && closeAgent()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // toasts sit above the dock (stage.css centres them at the bottom of the working area)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--term-dock', `${isPhone() ? (el.querySelector('.term-prompt')?.getBoundingClientRect().height ?? 0) + 30 : el.getBoundingClientRect().height}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--term-dock')
    }
  }, [])

  // keep the log scrolled to the newest line while the reader is at the bottom
  const steps = useAgent((s) => s.steps.length)
  const live = useAgent((s) => s.live.length)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [steps, live, turns.length, status, changes.length, echo.length])

  const focusReview = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-cursor]') ?? listRef.current?.querySelector<HTMLElement>('li')
    if (!el) return false
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
    return true
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[data-popover]')) {
      e.preventDefault()
      e.stopPropagation()
      closeAgent()
      return
    }
    // ⌥↑ / ⌥↓: taller / lower
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      setTermHeight((max ? 1 : height) + (e.key === 'ArrowUp' ? 0.08 : -0.08))
      return
    }
    // Ctrl+C with nothing selected: stop, like a terminal
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && running && !hasSelection(e.target)) {
      e.preventDefault()
      stopAgent()
      return
    }
    // ⌘↵ / Ctrl+↵: apply all
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !running && pending && !readOnly) {
      e.preventDefault()
      void applyStaged()
    }
  }

  const style = { '--term-h': max ? 1 : height } as React.CSSProperties
  const body = (
    <section
      ref={rootRef}
      className={`term${host ? '' : ' term--float'}`}
      role="region"
      aria-labelledby="term-title"
      data-status={status}
      data-max={max || undefined}
      style={style}
      onKeyDown={onKeyDown}
    >
      <div className="term__panel">
        <Grip />
        <Head />
        <div
          className="term-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
          }}
        >
          {!hasKey && <NoKey />}
          {turns.length === 0 && echo.length === 0 && <Standby disabled={!hasKey} />}
          <Timeline />
          {changes.length > 0 && <Review listRef={listRef} readOnly={readOnly} />}
        </div>
        {pending > 0 && (
          <div className="term-bar" role="region" aria-label={tn('features.agent.review.title', pending)}>
            <span className="led led--on" aria-hidden />
            <span className="term-bar__count">{tn('features.agent.review.title', pending)}</span>
            <span className="term-bar__hint">{t('features.agent.review.tabHint')}</span>
            <span className="term-spacer" />
            <button type="button" className="btn btn--ghost btn--sm" onClick={focusReview}>
              {t('features.agent.review.jump')}
            </button>
            <button type="button" className="btn btn--primary btn--sm" disabled={running || readOnly} onClick={() => void applyStaged()} title={shortcutLabel('Mod+Enter')}>
              {t('features.agent.review.applyAll')}
            </button>
          </div>
        )}
        <McpChanged />
        <Prompt disabled={!hasKey} onReview={focusReview} />
        <Foot />
      </div>
    </section>
  )
  return createPortal(body, host ?? document.body)
}

/** Text selected in the field (or anywhere): then Ctrl+C copies instead of stopping. */
function hasSelection(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return target.selectionStart !== target.selectionEnd
  return !!window.getSelection()?.toString()
}

/* ------------------------------------------------------------------ */
/* Frame: grip, head                                                   */
/* ------------------------------------------------------------------ */

/** The top rule: drag it (or ↑ / ↓ on it) to change the height. */
function Grip() {
  const t = useT()
  const height = useAgent((s) => s.height)
  const max = useAgent((s) => s.max)
  const [drag, setDrag] = useState(false)
  const now = max ? 1 : height

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const box = e.currentTarget.closest('.term')?.parentElement?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true)
    let last = now
    const move = (ev: PointerEvent) => {
      last = clampHeight((box.bottom - ev.clientY) / box.height)
      useAgent.setState({ height: last, max: false })
    }
    const up = () => {
      setDrag(false)
      setTermHeight(last)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      className="term-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('features.agent.resize')}
      aria-valuemin={20}
      aria-valuemax={100}
      aria-valuenow={Math.round(now * 100)}
      tabIndex={0}
      data-drag={drag || undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setTermHeight(HEIGHT_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        e.stopPropagation()
        setTermHeight(now + (e.key === 'ArrowUp' ? 0.05 : -0.05))
      }}
    >
      <span className="term-grip__mark" aria-hidden />
    </div>
  )
}

function Elapsed({ start, end }: { start: number; end?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (end) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [end])
  return <>{fmtMs(Math.max(0, (end ?? now) - start))}</>
}

function Head() {
  const t = useT()
  const status = useAgent((s) => s.status)
  const turns = useAgent((s) => s.turns.length)
  const changes = useAgent((s) => s.changes.length)
  const usage = useAgent((s) => s.usage)
  const max = useAgent((s) => s.max)
  const pinned = useAgent((s) => s.mcp?.names.length ?? null)
  const nextMcp = useWorkspace((s) => readServers(s.settings).filter((x) => x.enabled).length)
  const model = resolveModel(useWorkspace((s) => s.settings.aiModel))
  const updateSettings = useWorkspace((s) => s.updateSettings)
  const running = status === 'running'
  const mcp = pinned ?? nextMcp
  const cycleModel = () => {
    const i = AI_MODELS.findIndex((m) => m.id === model.id)
    updateSettings({ aiModel: AI_MODELS[(i + 1) % AI_MODELS.length].id })
  }
  const led = running ? 'led led--on ai-led--live' : status === 'error' ? 'led ai-led--err' : status === 'idle' ? 'led' : status === 'done' ? 'led led--ok' : 'led led--on'
  return (
    <header className="term-head">
      <span className={led} aria-hidden />
      <h2 id="term-title" className="term-head__title">
        {t('features.agent.title')}
      </h2>
      <span className="term-head__sep" aria-hidden>
        ·
      </span>
      <button type="button" className="term-head__model" onClick={cycleModel} disabled={running} title={t('features.ai.switchModel')}>
        {model.short.split(' ')[0]}
      </button>
      {mcp > 0 && (
        <span className="term-head__read">
          <span aria-hidden>· </span>
          {t('features.agent.head.mcp', { count: mcp })}
        </span>
      )}
      {usage.requests > 0 && (
        <span className="term-head__read">
          <span aria-hidden>· </span>≈ {fmtUsd(usage.usd)}
        </span>
      )}
      <span className="term-head__status" aria-live="polite">
        {t(`features.agent.status.${status}`)}
      </span>
      <span className="term-spacer" />
      <button type="button" className="term-key" onClick={newTask} disabled={!turns && !changes} aria-label={t('features.agent.newTask')} title={`${t('features.agent.newTask')} (/new)`}>
        <RotateCcw size={13} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="term-key term-key--max"
        onClick={() => useAgent.setState({ max: !max })}
        aria-pressed={max}
        aria-label={t('features.agent.maximise')}
        title={t('features.agent.maximise')}
      >
        {max ? <Minimize2 size={13} strokeWidth={1.75} aria-hidden /> : <Maximize2 size={13} strokeWidth={1.75} aria-hidden />}
      </button>
      <button type="button" className="term-key" onClick={closeAgent} aria-label={t('features.agent.close')} title={`${t('features.agent.close')} (Esc · ${shortcutLabel(AGENT_SHORTCUT)})`}>
        <ChevronDown size={15} strokeWidth={1.75} className="term-key__hide" aria-hidden />
        <X size={15} strokeWidth={1.75} className="term-key__x" aria-hidden />
      </button>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states                                                        */
/* ------------------------------------------------------------------ */

function NoKey() {
  const t = useT()
  return (
    <div className="term-nokey" role="note">
      <span className="led" aria-hidden />
      <div className="term-nokey__text">
        <strong>{t('features.agent.nokey.title')}</strong>
        <span>{t('features.agent.nokey.body')}</span>
      </div>
      <button type="button" className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
        <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.nokey.open')}
      </button>
    </div>
  )
}

function Standby({ disabled }: { disabled: boolean }) {
  const t = useT()
  // external MCP servers the next conversation will use (Settings → Claude AI)
  const mcp = useWorkspace((s) =>
    readServers(s.settings)
      .filter((x) => x.enabled)
      .map((x) => x.name.toUpperCase())
      .join(' · '),
  )
  const examples = [t('features.agent.ex.1'), t('features.agent.ex.2'), t('features.agent.ex.3')]
  return (
    <div className="term-standby">
      <p className="term-standby__lead">{t('features.agent.lead')}</p>
      <dl className="term-spec">
        <div>
          <dt>{t('features.agent.caps.read')}</dt>
          <dd>{t('features.agent.caps.readList')}</dd>
        </div>
        <div>
          <dt>{t('features.agent.caps.write')}</dt>
          <dd>{t('features.agent.caps.writeList')}</dd>
        </div>
        <div>
          <dt>{t('features.agent.caps.limit')}</dt>
          <dd>{t('features.agent.caps.limitList', { max: MAX_TOOL_CALLS })}</dd>
        </div>
        {mcp && (
          <div>
            <dt>{t('features.ai.mcp.agentCaps')}</dt>
            <dd>{mcp}</dd>
          </div>
        )}
      </dl>
      <div className="term-examples" role="group" aria-label={t('features.agent.examples')}>
        {examples.map((ex, i) => (
          <button
            key={i}
            type="button"
            className="term-example"
            disabled={disabled}
            onClick={() => {
              useAgent.setState({ draft: ex })
              focusPrompt()
            }}
          >
            <span className="term-example__n">{pad(i + 1)}</span>
            <span className="term-example__text">{ex}</span>
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
      </div>
      <p className="term-standby__keys">{t('features.agent.standbyKeys', { ref: shortcutLabel(AGENT_REF_SHORTCUT) })}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Log: tasks and command output in order                              */
/* ------------------------------------------------------------------ */

function Timeline() {
  const turns = useAgent((s) => s.turns)
  const echo = useAgent((s) => s.echo)
  const out: ReactNode[] = []
  const echoAfter = (n: number) => echo.filter((e) => e.after === n).forEach((e) => out.push(<Echo key={e.id} entry={e} />))
  echoAfter(0)
  turns.forEach((turn) => {
    out.push(<TurnView key={turn.n} turn={turn} last={turn.n === turns.length} />)
    echoAfter(turn.n)
  })
  return <>{out}</>
}

function TurnView({ turn, last }: { turn: AgentTurn; last: boolean }) {
  const t = useT()
  const allSteps = useAgent((s) => s.steps)
  const steps = useMemo(() => allSteps.filter((x) => x.turn === turn.n), [allSteps, turn.n])
  const live = useAgent((s) => (last ? s.live : ''))
  const running = turn.status === 'running'
  const ctx = turn.context
  const ctxParts = ctx ? [ctx.page ? `▣ ${ctx.page}` : '', ctx.refs ? tn('features.agent.ctx.refs', ctx.refs) : '', ...ctx.mentions.map((m) => `@${m}`)].filter(Boolean) : []
  return (
    <section className="term-turn" data-status={turn.status} aria-label={`${t('features.agent.task')} ${pad(turn.n)}`}>
      <div className="term-turn__head">
        <span className="term-mark" aria-hidden>
          ›
        </span>
        <p className="term-turn__task">{turn.task}</p>
        <span className="term-turn__meta">
          {pad(turn.n)} · <Elapsed start={turn.startedAt} end={turn.endedAt} />
        </span>
      </div>
      {ctxParts.length > 0 && (
        <p className="term-turn__ctx">
          <span className="term-turn__ctxlabel">{t('features.agent.ctx.label')}</span> {ctxParts.join(' · ')}
        </p>
      )}
      <ol className="term-steps" role="log" aria-label={t('features.agent.log')} aria-live="polite">
        {steps.map((s) => (s.kind === 'note' ? <NoteRow key={s.id} step={s} /> : s.kind === 'mcp' ? <McpRow key={s.id} step={s} /> : <StepRow key={s.id} step={s} />))}
        {running && !live && (
          <li className="term-step term-step--wait" aria-hidden>
            <span className="term-step__glyph">◌</span>
            <span className="term-step__tool">{t('features.agent.working')}</span>
            <span className="term-wait" />
          </li>
        )}
      </ol>
      {live && (
        <div className="term-live">
          <MarkdownLite source={live} />
          <span className="term-cursor" aria-hidden />
        </div>
      )}
      {turn.answer && (
        <div className="term-answer">
          <MarkdownLite source={turn.answer} />
        </div>
      )}
      {turn.status === 'stopped' && <p className="term-note">■ {t('features.agent.stoppedNote')}</p>}
      {turn.status === 'limit' && <p className="term-note">■ {t('features.agent.limitEnd')}</p>}
      {turn.status === 'error' && turn.error && <TurnError error={turn.error} />}
    </section>
  )
}

function TurnError({ error }: { error: NonNullable<AgentTurn['error']> }) {
  const t = useT()
  const keyIssue = error.code === 'invalid_key' || error.code === 'no_key' || error.code === 'permission'
  return (
    <div className="term-error" role="alert">
      <span className="term-error__code">✗ ERR · {error.code.toUpperCase()}</span>
      <p>{error.message}</p>
      {keyIssue && (
        <button type="button" className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
          <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.nokey.open')}
        </button>
      )}
      {(error.code === 'mcp' || error.code === 'mcp_auth') && (
        <button type="button" className="btn btn--sm" onClick={() => useUI.getState().openModal({ type: 'settings', tab: 'ai' })}>
          <Settings2 size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.openSettings')}
        </button>
      )}
    </div>
  )
}

const GLYPH: Record<AgentStep['state'], string> = { run: '→', ok: '→', staged: '✓', err: '✗' }

function StepRow({ step }: { step: AgentStep }) {
  const t = useT()
  const tool = step.tool!
  const arg = step.arg || (tool === 'list_databases' || tool === 'get_current_page' ? t(`features.agent.verb.${tool}.arg`) : '')
  const result = step.state === 'err' ? t('features.agent.res.rejected') : (step.result ?? '')
  return (
    <li className="term-step" data-state={step.state} data-tool={tool}>
      <span className="term-step__glyph" aria-hidden>
        {GLYPH[step.state]}
      </span>
      <span className="term-step__tool">{tool}</span>
      <span className="term-step__arg" title={arg}>
        {arg}
      </span>
      <span className="term-step__res">{result}</span>
    </li>
  )
}

/** A tool call of an external MCP server ("ATLAS · search_records"), run by Anthropic. */
function McpRow({ step }: { step: AgentStep }) {
  const t = useT()
  const call = step.mcp!
  const result = step.state === 'run' ? t('features.ai.mcp.res.run') : step.state === 'err' ? t('features.ai.mcp.res.err') : t('features.ai.mcp.res.ok')
  const server = call.server.toUpperCase()
  return (
    <li className="term-step term-step--mcp" data-state={step.state} data-mcp={call.server}>
      <span className="term-step__glyph" aria-hidden>
        {step.state === 'err' ? '✗' : '⇄'}
      </span>
      <span className="term-step__chip" title={callLabel(call)}>
        {callLabel(call)}
      </span>
      <span className="term-step__arg" title={step.arg}>
        {step.arg}
      </span>
      <span className="term-step__res">{result}</span>
      {step.state === 'err' && (
        <p className="term-step__err">
          {call.error ? t('features.ai.mcp.callErr', { server, tool: call.tool, error: call.error }) : t('features.ai.mcp.callErrBare', { server, tool: call.tool })} {t('features.ai.mcp.callErrNote')}
        </p>
      )}
    </li>
  )
}

function NoteRow({ step }: { step: AgentStep }) {
  const t = useT()
  return (
    <li className="term-step term-step--note">
      <span className="term-step__glyph" aria-hidden>
        ·
      </span>
      <span className="visually-hidden">{t('features.agent.note')}: </span>
      <span className="term-step__text">{step.text}</span>
    </li>
  )
}

/** The MCP setup in Settings differs from the one this conversation was started with. */
function McpChanged() {
  const t = useT()
  const pinned = useAgent((s) => s.mcp?.key ?? null)
  const hasTurns = useAgent((s) => s.turns.length > 0)
  const running = useAgent((s) => s.status === 'running')
  // the settings object changes on every setting: compare the setup's signature, not the object
  const now = useWorkspace((s) => (pinned === null ? null : setupKey(currentSetup(s.settings))))
  if (!hasTurns || running || now === null || now === pinned) return null
  return (
    <div className="term-mcpnote" role="status">
      <span className="led led--on" aria-hidden />
      <span className="term-mcpnote__text">{t('features.ai.mcp.agentChanged')}</span>
      <button type="button" className="btn btn--sm" onClick={newTask}>
        <RotateCcw size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.newTask')}
      </button>
    </div>
  )
}

/* ---------- command output ---------- */

const COMMAND_IDS = COMMANDS.map((c) => c.id)

function Echo({ entry }: { entry: EchoEntry }) {
  const t = useT()
  const lang = useLang()
  let out: ReactNode = null
  switch (entry.kind) {
    case 'help':
      out = (
        <>
          <dl className="term-table">
            {COMMAND_IDS.map((id) => {
              const c = COMMANDS.find((x) => x.id === id)!
              const names = lang === 'de' ? [...c.de.slice(0, 1), c.en] : [c.en, ...c.de.slice(0, 1)]
              return (
                <div key={id}>
                  <dt>{[...new Set(names)].map((n) => `/${n}`).join('  ')}</dt>
                  <dd>{t(`features.agent.cmd.${id}`)}</dd>
                </div>
              )
            })}
          </dl>
          <dl className="term-table term-table--keys">
            {KEYS.map(([keys, label]) => (
              <div key={label}>
                <dt>{keys()}</dt>
                <dd>{t(label)}</dd>
              </div>
            ))}
          </dl>
        </>
      )
      break
    case 'history': {
      const list = entry.data?.list ?? []
      out = list.length ? (
        <ol className="term-hist">
          {list.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                className="term-hist__item"
                onClick={() => {
                  useAgent.setState({ draft: p })
                  focusPrompt()
                }}
              >
                <span className="term-hist__n">{pad(list.length - i)}</span>
                <span className="term-hist__text">{p}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>{t('features.agent.echo.noHistory')}</p>
      )
      break
    }
    case 'mcp': {
      const list = entry.data?.list ?? []
      out = list.length ? (
        <p>
          {t(entry.data?.key === 'pinned' ? 'features.agent.echo.mcpPinned' : 'features.agent.echo.mcpNext')} <strong>{list.map((n) => n.toUpperCase()).join(' · ')}</strong>
        </p>
      ) : (
        <p>{t('features.agent.echo.mcpNone')}</p>
      )
      break
    }
    case 'cost': {
      const u = entry.data?.usage
      if (!u) break
      out = (
        <>
          <dl className="term-table term-table--cost">
            {(
              [
                ['features.agent.meter.requests', String(u.requests)],
                ['features.agent.meter.in', fmtTokens(u.input)],
                ['features.agent.meter.cacheWrite', fmtTokens(u.cacheWrite)],
                ['features.agent.meter.cache', fmtTokens(u.cacheRead)],
                ['features.agent.meter.out', fmtTokens(u.output)],
                ['features.agent.meter.usd', `≈ ${fmtUsd(u.usd)}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="term-echo__note">{t('features.agent.meter.billed')}</p>
        </>
      )
      break
    }
    case 'unknown':
    case 'info':
      out = <p>{t(entry.data?.key ?? 'features.agent.echo.unknown', entry.data?.vars)}</p>
      break
  }
  return (
    <section className="term-echo" data-kind={entry.kind}>
      <div className="term-echo__in">
        <span className="term-mark" aria-hidden>
          ›
        </span>{' '}
        {entry.input}
      </div>
      <div className="term-echo__out">{out}</div>
    </section>
  )
}

/** Keys listed by /help (the label keys are under features.agent.keys.*). */
const KEYS: Array<[() => string, string]> = [
  [() => '↵', 'features.agent.keys.run'],
  [() => `${shortcutLabel('Shift')} ↵`, 'features.agent.keys.newline'],
  [() => '↑ ↓', 'features.agent.keys.history'],
  [() => 'Tab', 'features.agent.keys.complete'],
  [() => `${shortcutLabel(AGENT_STOP_SHORTCUT)} · Ctrl+C`, 'features.agent.keys.stop'],
  [() => shortcutLabel(AGENT_REF_SHORTCUT), 'features.agent.keys.ref'],
  [() => `${shortcutLabel('Alt')} ↑ ↓`, 'features.agent.keys.resize'],
  [() => `Esc · ${shortcutLabel(AGENT_SHORTCUT)}`, 'features.agent.keys.hide'],
  [() => 'j k · Space · ↵ · a · d · o · u', 'features.agent.keys.review'],
]

/* ------------------------------------------------------------------ */
/* Review (keyboard: j / k ↑ ↓ move, Space marks, ↵ applies, a d r o u) */
/* ------------------------------------------------------------------ */

const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed'

function Review({ listRef, readOnly }: { listRef: React.RefObject<HTMLOListElement | null>; readOnly: boolean }) {
  const t = useT()
  const changes = useAgent((s) => s.changes)
  const running = useAgent((s) => s.status === 'running')
  const open = changes.filter(isOpen).length
  const [cursor, setCursor] = useState(0)
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set())
  const disabled = running || readOnly
  const at = Math.min(cursor, changes.length - 1)

  // marks belong to proposals that are still open
  useEffect(() => {
    setMarked((m) => {
      const keep = [...m].filter((id) => changes.some((c) => c.id === id && isOpen(c)))
      return keep.length === m.size ? m : new Set(keep)
    })
  }, [changes])

  const focusAt = (i: number) => {
    setCursor(i)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`li[data-i="${i}"]`)?.focus())
  }
  const toggle = (id: string) =>
    setMarked((m) => {
      const next = new Set(m)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onKeyDown = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const li = e.target as HTMLElement
    // keys only on an entry itself (its buttons keep Space / Enter)
    if (!li.dataset?.i || e.metaKey || e.ctrlKey || e.altKey) return
    const c = changes[at]
    const key = e.key
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const moves: Record<string, number> = { j: at + 1, ArrowDown: at + 1, k: at - 1, ArrowUp: at - 1, Home: 0, End: changes.length - 1 }
    if (key in moves) {
      handled()
      focusAt(Math.max(0, Math.min(changes.length - 1, moves[key])))
      return
    }
    if (key === 'Escape') {
      handled()
      focusPrompt()
      return
    }
    if (key === ' ') {
      handled()
      if (c && isOpen(c)) toggle(c.id)
      return
    }
    if (key === 'o') {
      handled()
      if (c) openChange(c)
      return
    }
    if (key === 'u') {
      handled()
      if (!disabled) undoLastBatch()
      return
    }
    if (disabled) return
    if (key === 'Enter') {
      handled()
      const ids = marked.size ? [...marked] : c && isOpen(c) ? [c.id] : []
      if (ids.length) void applyStaged(withDeps(ids, changes))
      return
    }
    if (key === 'a') {
      handled()
      void applyStaged()
      return
    }
    if (key === 'd') {
      handled()
      const ids = marked.size ? [...marked] : c && isOpen(c) ? [c.id] : []
      if (ids.length) discardStaged(ids)
      return
    }
    if (key === 'r') {
      handled()
      if (c?.status === 'discarded') restoreStaged(c.id)
    }
  }

  return (
    <section className="term-review" aria-labelledby="term-review-title">
      <div className="term-review__head">
        <h3 id="term-review-title" className="term-review__title">
          {tn('features.agent.review.title', changes.length)}
        </h3>
        <span className="term-review__rule" aria-hidden />
        {open > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={running} onClick={discardAllStaged}>
            {t('features.agent.review.discardAll')}
          </button>
        )}
      </div>
      <p className="term-review__note">
        {readOnly ? t('features.agent.review.readOnly') : t('features.agent.review.note')} <span className="term-review__keys">{t('features.agent.review.keys')}</span>
      </p>
      <ol className="term-changes" ref={listRef} onKeyDown={onKeyDown}>
        {changes.map((c, i) => (
          <ChangeItem
            key={c.id}
            change={c}
            all={changes}
            index={i}
            cursor={i === at}
            marked={marked.has(c.id)}
            disabled={disabled}
            compact={running}
            onMark={() => toggle(c.id)}
            onFocus={() => setCursor(i)}
          />
        ))}
      </ol>
    </section>
  )
}

/** The changes plus the open ones they build on (a row in a new database brings the database along). */
function withDeps(ids: string[], all: StagedChange[]): string[] {
  const out = new Set<string>()
  const todo = [...ids]
  while (todo.length) {
    const id = todo.pop()
    const c = all.find((x) => x.id === id)
    if (!c || out.has(c.id) || !isOpen(c)) continue
    out.add(c.id)
    todo.push(...depsOf(c))
  }
  return [...out]
}

/** Open what a change points at: rows in the side peek, pages in the main column. */
function openChange(c: StagedChange) {
  const target = changeTarget(c)
  if (!target) return
  if (c.kind === 'create_row' || c.kind === 'update_row') useUI.getState().openPeek(target)
  else openPage(target)
  if (isPhone()) closeAgent()
}

function useTitleOf() {
  const pages = useWorkspace((s) => s.pages)
  const t = useT()
  return useCallback(
    (id: string | null | undefined, all: StagedChange[]) => {
      if (!id) return ''
      const staged = all.find((c) => (c.kind === 'create_page' || c.kind === 'create_row' || c.kind === 'create_database') && c.pageId === id)
      if (staged && !pages[id]) return staged.title ?? ''
      return pages[id]?.title.trim() || t('common.untitled')
    },
    [pages, t],
  )
}

function ChangeItem({
  change: c,
  all,
  index,
  cursor,
  marked,
  disabled,
  compact,
  onMark,
  onFocus,
}: {
  change: StagedChange
  all: StagedChange[]
  index: number
  cursor: boolean
  marked: boolean
  disabled: boolean
  /** while a task runs: the head line only, so the log stays in view */
  compact: boolean
  onMark: () => void
  onFocus: () => void
}) {
  const t = useT()
  const titleOf = useTitleOf()
  const missing = depsOf(c)
    .map((id) => all.find((x) => x.id === id))
    .find((x) => x && x.status !== 'applied')
  const blocked = !!missing
  let where = ''
  if (c.kind === 'create_page' || c.kind === 'create_database') where = c.parentId ? t('features.agent.review.under', { title: titleOf(c.parentId, all) }) : t('features.agent.review.topLevel')
  else if (c.kind === 'create_row' || c.kind === 'update_row' || c.kind === 'add_property') where = t('features.agent.review.in', { title: titleOf(c.databaseId, all) })
  const label = `#${c.n}`
  const target = c.status === 'applied' ? changeTarget(c) : null

  let title: ReactNode = c.title
  if (c.kind === 'rename')
    title = (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    )
  else if (c.kind === 'append' || c.kind === 'update_row') title = titleOf(c.pageId, all) || c.title
  else if (c.kind === 'add_property') title = c.prop?.name

  const name = `${label} ${t(`features.agent.kind.${c.kind}`)}${marked ? `, ${t('features.agent.review.marked')}` : ''}`
  return (
    <li
      className="term-change"
      data-i={index}
      data-status={c.status}
      data-kind={c.kind}
      data-cursor={cursor || undefined}
      data-marked={marked || undefined}
      tabIndex={cursor ? 0 : -1}
      aria-label={name}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
    >
      <div className="term-change__head">
        <button type="button" className="term-change__mark" tabIndex={-1} onClick={onMark} disabled={!isOpen(c)} aria-label={t('features.agent.review.mark', { n: label })} aria-pressed={marked}>
          {marked ? '■' : '□'}
        </button>
        <span className="term-change__n">{label}</span>
        <span className="term-change__kind">{t(`features.agent.kind.${c.kind}`)}</span>
        {title && <span className="term-change__title">{title}</span>}
        {where && <span className="term-change__where">{where}</span>}
        <span className="term-spacer" />
        {isOpen(c) ? (
          <span className="term-change__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => discardStaged(c.id)} disabled={disabled} aria-label={`${t('features.agent.review.discard')} ${label}`}>
              {t('features.agent.review.discard')}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ink"
              onClick={() => void applyStaged([c.id])}
              disabled={disabled || blocked}
              aria-label={`${t('features.agent.review.apply')} ${label}`}
              title={blocked && missing ? t('features.agent.review.needs', { n: missing.n }) : undefined}
            >
              {t('features.agent.review.apply')}
            </button>
          </span>
        ) : c.status === 'applied' ? (
          <span className="term-change__actions">
            <span className="term-change__state">
              <span className="led led--ok" aria-hidden /> {t('features.agent.review.applied')}
            </span>
            {target && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => openChange(c)} aria-label={`${t('features.agent.review.open')} ${label}`}>
                <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.open')}
              </button>
            )}
          </span>
        ) : (
          <span className="term-change__actions">
            <span className="term-change__state">{t('features.agent.review.discarded')}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => restoreStaged(c.id)} disabled={disabled} aria-label={`${t('features.agent.review.restore')} ${label}`}>
              <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.restore')}
            </button>
          </span>
        )}
      </div>
      {!compact && (c.kind === 'create_database' || c.kind === 'add_property') && <SchemaDiff change={c} />}
      {!compact && c.props && c.props.length > 0 && <PropDiff props={c.props} />}
      {!compact && c.markdown?.trim() && c.kind !== 'rename' && <Preview markdown={c.markdown} append={c.kind === 'append'} />}
      {c.status === 'failed' && c.error && <p className="term-change__error">{t('features.agent.review.failed', { error: c.error })}</p>}
      {blocked && missing && c.status === 'pending' && <p className="term-change__hint">{t('features.agent.review.needs', { n: missing.n })}</p>}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Prompt: chips, completion, history                                  */
/* ------------------------------------------------------------------ */

function Chips() {
  const t = useT()
  const refs = useAgent((s) => s.refs)
  const mentions = useAgent((s) => s.mentions)
  const draft = useAgent((s) => s.draft)
  const pageOff = useAgent((s) => s.pageOff)
  // the open page is the default context (contextPageId() reads the same at run time)
  const route = useRoute()
  const openId = route.name === 'page' ? route.id : null
  const page = useWorkspace((s) => (openId ? s.pages[openId] : undefined))
  const pageId = page && !page.trashed && pageOff !== page.id ? page.id : null
  const pageTitle = page?.title.trim() || t('common.untitled')
  const shown = mentions.filter((m) => draft.includes(`@${m.title}`))
  if (!pageId && !refs.length && !shown.length) return null
  return (
    <ul className="term-chips" aria-label={t('features.agent.ctx.label')}>
      {pageId && <PageChip pageId={pageId} title={pageTitle} />}
      {refs.map((r) => {
        // "Delta report · Project Delta: open… · 18 lines": links and Markdown marks out of the gist
        const gist = r.markdown
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[#>*_`[\]|]+|^\s*[-+]\s|\s-\s/gm, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        const text = `${r.title} · ${gist.length > 26 ? `${gist.slice(0, 25).trimEnd()}…` : gist}`
        const lines = tn('features.agent.ref.lines', r.lines)
        return (
          <li key={r.id} className="term-chip" data-kind="ref" title={r.markdown.slice(0, 400)}>
            <span className="term-chip__glyph" aria-hidden>
              ¶
            </span>
            <span className="term-chip__text">{text}</span>
            <span className="term-chip__meta">· {lines}</span>
            <button type="button" className="term-chip__x" onClick={() => removeRef(r.id)} aria-label={t('features.agent.ctx.remove', { title: `${text} · ${lines}` })}>
              <X size={11} strokeWidth={2} aria-hidden />
            </button>
          </li>
        )
      })}
      {shown.map((m) => (
        <li key={m.id} className="term-chip" data-kind="mention">
          <span className="term-chip__glyph" aria-hidden>
            @
          </span>
          <span className="term-chip__text">{m.title}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The open page as context: its title, what Claude may read of it ("· 3 blocks" / "· nothing") and a
 * menu to change that — whole page / only marked blocks / mark blocks… / nothing from this page.
 */
function PageChip({ pageId, title }: { pageId: string; title: string }) {
  const t = useT()
  const marks = useContextMarks(pageId)
  const isDb = useWorkspace((s) => s.pages[pageId]?.kind === 'database')
  const menu = useMenu()
  const m = marks ? effectiveMode(marks) : 'page'
  const suffix = m === 'marked' ? tn('features.agent.ctx.mode.marked', marks?.blocks ?? 0) : m === 'none' ? t('features.agent.ctx.mode.none') : ''
  const choose = (mode: ContextMode) => {
    if (mode === 'marked' && !marks?.marked) return pickContext(null)
    setContextMode(pageId, mode)
    focusPrompt()
  }
  const entries: MenuEntry[] = [
    { kind: 'section', label: t('features.agent.ctx.menu', { title }) },
    { label: t('features.ai.reads.opt.page'), checked: m === 'page', onSelect: () => choose('page') },
    { label: marks?.marked ? t('features.ai.reads.opt.marked') : t('features.ai.reads.opt.markedFirst'), checked: m === 'marked', hint: marks?.marked ? tn('features.ai.reads.blocks', marks.marked) : undefined, onSelect: () => choose('marked') },
    { label: t('features.ai.reads.opt.mark'), hint: '/context', onSelect: () => pickContext(null) },
    { label: t('features.ai.reads.opt.none'), checked: m === 'none', onSelect: () => choose('none') },
  ]
  return (
    <li className="term-chip" data-kind="page" data-mode={m}>
      <button
        type="button"
        className="term-chip__btn"
        onClick={isDb ? undefined : menu.toggle}
        disabled={isDb}
        aria-haspopup={isDb ? undefined : 'menu'}
        aria-expanded={isDb ? undefined : menu.open}
        title={isDb ? undefined : t('features.ai.reads.change')}
        data-testid="term-page-chip"
      >
        <span className="term-chip__glyph" aria-hidden>
          ▣
        </span>
        <span className="term-chip__text">{title}</span>
        {suffix && <span className="term-chip__meta term-chip__mode">· {suffix}</span>}
      </button>
      <button type="button" className="term-chip__x" onClick={() => useAgent.setState({ pageOff: pageId })} aria-label={t('features.agent.ctx.remove', { title })}>
        <X size={11} strokeWidth={2} aria-hidden />
      </button>
      {!isDb && <Menu {...menu.props} entries={entries} width={280} placement="top-start" />}
    </li>
  )
}

function Prompt({ disabled, onReview }: { disabled: boolean; onReview: () => boolean }) {
  const t = useT()
  const lang = useLang()
  const draft = useAgent((s) => s.draft)
  const running = useAgent((s) => s.status === 'running')
  const hasTurns = useAgent((s) => s.turns.length > 0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  /** the token whose completion list was closed with Esc */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const hist = useRef<{ list: string[]; at: number | null; saved: string }>({ list: [], at: null, saved: '' })

  useEffect(() => {
    hist.current.list = loadHistory()
  }, [])

  // grow with the text (up to the CSS max-height)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  /** walking the history (↑ / ↓): no completion list over a recalled prompt */
  const [browsing, setBrowsing] = useState(false)
  const comp: Completion | null = useMemo(() => {
    if (browsing) return null
    const c = completionAt(draft, caret, lang)
    return c && `${c.from}:${draft.slice(c.from, c.to)}` !== dismissed ? c : null
  }, [draft, caret, lang, dismissed, browsing])
  useEffect(() => setActive(0), [comp?.kind, comp?.query])
  const listId = 'term-complete'

  const setDraft = (value: string, at?: number) => {
    useAgent.setState({ draft: value })
    const pos = at ?? value.length
    setCaret(pos)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) el.setSelectionRange(pos, pos)
    })
  }

  const accept = (c: Completion, i: number) => {
    const item = c.items[i]
    if (!item) return
    const next = draft.slice(0, c.from) + item.insert + draft.slice(c.to)
    if (item.mention) {
      const { where: _where, ...m } = item.mention
      void _where
      useAgent.setState((s) => ({ mentions: [...s.mentions.filter((x) => x.id !== m.id), m] }))
    }
    setDraft(next, c.from + item.insert.length)
  }

  const submit = () => {
    const text = draft.trim()
    // without a key (or while a task runs) only /commands go
    if (!text || ((disabled || running) && !text.startsWith('/'))) return
    hist.current.at = null
    setBrowsing(false)
    // the prompt goes into the history synchronously (before the task's first request)
    void submitPrompt()
    hist.current.list = loadHistory()
    setCaret(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const noMods = !e.metaKey && !e.ctrlKey && !e.altKey
    if (comp && noMods) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = comp.items.length
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        accept(comp, active)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissed(`${comp.from}:${draft.slice(comp.from, comp.to)}`)
        return
      }
      // Enter takes the highlighted entry, unless the command is typed out already
      if (e.key === 'Enter' && !e.shiftKey) {
        const typed = draft.slice(comp.from, comp.to)
        if (!(comp.kind === 'command' && comp.items.some((x) => x.insert === typed))) {
          e.preventDefault()
          accept(comp, active)
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && noMods) {
      e.preventDefault()
      submit()
      return
    }
    // Tab on an empty prompt: into the review list
    if (e.key === 'Tab' && !e.shiftKey && noMods && !draft && onReview()) {
      e.preventDefault()
      return
    }
    // Backspace at the start: the last chip goes
    if (e.key === 'Backspace' && noMods && el.selectionStart === 0 && el.selectionEnd === 0) {
      const { refs } = useAgent.getState()
      const pageId = contextPageId()
      if (refs.length) {
        e.preventDefault()
        removeRef(refs[refs.length - 1].id)
      } else if (pageId) {
        e.preventDefault()
        useAgent.setState({ pageOff: pageId })
      }
      return
    }
    // ↑ / ↓: prompt history while the caret is on the first / last line
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && noMods && !e.shiftKey) {
      const h = hist.current
      const up = e.key === 'ArrowUp'
      const firstLine = !draft.slice(0, el.selectionStart).includes('\n')
      const lastLine = !draft.slice(el.selectionEnd).includes('\n')
      if (up && firstLine && h.list.length && h.at !== 0) {
        e.preventDefault()
        setBrowsing(true)
        if (h.at === null) {
          h.saved = draft
          h.at = h.list.length - 1
        } else h.at -= 1
        setDraft(h.list[h.at])
      } else if (!up && lastLine && h.at !== null) {
        e.preventDefault()
        if (h.at < h.list.length - 1) {
          h.at += 1
          setDraft(h.list[h.at])
        } else {
          h.at = null
          setBrowsing(false)
          setDraft(h.saved)
        }
      }
    }
  }

  const placeholder = disabled ? t('features.agent.placeholderNoKey') : hasTurns ? t('features.agent.placeholderNext') : t('features.agent.placeholder')
  return (
    <form
      className="term-prompt"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Chips />
      {comp && (
        <ul className="term-complete" id={listId} role="listbox" aria-label={t(comp.kind === 'command' ? 'features.agent.complete.commands' : 'features.agent.complete.pages')}>
          {comp.items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="term-complete__item"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(comp, i)}
            >
              <span className="term-complete__label">{item.mention ? `${item.mention.kind === 'database' ? '▦' : '▣'} ${item.label}` : item.label}</span>
              <span className="term-complete__hint">{item.command ? t(`features.agent.cmd.${item.command}`) : item.mention?.where || t(`features.agent.kindOf.${item.mention?.kind ?? 'page'}`)}</span>
            </li>
          ))}
          <li className="term-complete__foot" aria-hidden>
            {t('features.agent.complete.keys')}
          </li>
        </ul>
      )}
      <div className="term-prompt__line">
        <span className="term-prompt__mark" aria-hidden>
          ›
        </span>
        <textarea
          ref={inputRef}
          className="term-prompt__input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label={t('features.agent.taskLabel')}
          aria-autocomplete="list"
          aria-controls={comp ? listId : undefined}
          aria-activedescendant={comp ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            hist.current.at = null
            setBrowsing(false)
            setDismissed(null)
            useAgent.setState({ draft: e.target.value })
            setCaret(e.target.selectionStart)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {running ? (
          <button type="button" className="term-run term-run--stop" onClick={() => stopAgent()} title={`${t('features.agent.stop')} (${shortcutLabel(AGENT_STOP_SHORTCUT)})`}>
            <Square size={8} fill="currentColor" strokeWidth={0} aria-hidden /> {t('features.agent.stop')}
          </button>
        ) : (
          <button type="submit" className="term-run" disabled={!draft.trim() || (disabled && !draft.trim().startsWith('/'))}>
            {t('features.agent.run')} <CornerDownLeft size={11} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Foot: keys + meter                                                  */
/* ------------------------------------------------------------------ */

function Foot() {
  const t = useT()
  const usage = useAgent((s) => s.usage)
  const calls = useAgent((s) => s.calls)
  const running = useAgent((s) => s.status === 'running')
  return (
    <footer className="term-foot">
      <p className="term-keys" aria-hidden>
        <span>↵ {t('features.agent.kbd.run')}</span>
        <span>
          {shortcutLabel('Shift')}↵ {t('features.agent.kbd.newline')}
        </span>
        <span>↑↓ {t('features.agent.kbd.history')}</span>
        <span>Tab {t('features.agent.kbd.complete')}</span>
        <span>
          {shortcutLabel(AGENT_STOP_SHORTCUT)} {t('features.agent.kbd.stop')}
        </span>
        <span>{t('features.agent.kbd.help')}</span>
      </p>
      <div className="term-meter" title={t('features.agent.meter.billed')}>
        <dl className="term-meter__vals">
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
          <div className="term-meter__usd">
            <dt className="visually-hidden">USD</dt>
            <dd data-testid="agent-cost">≈ {fmtUsd(usage.usd)}</dd>
          </div>
        </dl>
        <span className="term-meter__note">{t('features.agent.meter.billed')}</span>
      </div>
    </footer>
  )
}
