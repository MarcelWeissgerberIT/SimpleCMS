/**
 * AI terminal — the dock at the bottom of the content area (the sidebar stays visible; a full-screen
 * sheet on phones), built like an instrument readout: an ink panel in JetBrains Mono. Prompt with
 * history, Tab completion and context chips → a log (the answer streams in, one line per tool call)
 * → the review list of staged changes (keyboard: j / k, Space, Enter, a, d, o, u) → the meter.
 * Hiding it never stops a task (only Stop, ⌘. / Ctrl+., Ctrl+C or /stop do).
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ChevronDown, CornerDownLeft, ExternalLink, KeyRound, Maximize2, Minimize2, RotateCcw, RotateCw, Settings2, Square, Undo2, X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { navigate, openPage, useRoute } from '../../../lib/router'
import { fmtUsd, displayCurrency } from '../../../lib/money'
import { useCloud } from '../../../cloud'
import { shortcutLabel } from '../../../ui/controls'
import { AI_MODELS, resolveModel } from '../client'
import { AINeedsSetup } from '../setup/AINeedsSetup'
import { openAISetup, openAISettings } from '../setup/openAISetup'
import { MarkdownLite } from '../MarkdownLite'
import { closeAgent, clampHeight, removeRef, setTermHeight, stopAgent, useAgent, HEIGHT_DEFAULT, type EchoEntry } from './state'
import { answerAsk, applyStaged, appliesAlone, changeTarget, continueTask, contextPageId, discardAllStaged, discardStaged, emptyEnter, goesToWorker, haltKey, newTask, pickContext, rerunAfterSignIn, restoreStaged, runTask, stage as stageApi, stageMedia, submitPrompt, tn, undoLastBatch } from './session'
import { loadHaltCard, ReglerRestLine } from '../../governor'
import { isMac } from '../../../ui/controls'
import { focusIsNowhere } from '../../../ui/focus'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { setContextMode, useContextMarks, type ContextMode } from '../../../editor'
import { effectiveMode } from '../reads'
import { MAX_TOOL_CALLS } from './tools'
import { currentSetup, readServers, setupKey } from '../mcp-servers/config'
import { callLabel } from '../mcp-servers/activity'
import { AGENT_REF_SHORTCUT, AGENT_SHORTCUT, AGENT_STOP_SHORTCUT } from './AgentPanel'
import { COMMANDS, completionAt, helpNames, type Completion } from './commands'
import { loadHistory } from './history'
import { PropDiff, Preview, SchemaDiff } from './ReviewParts'
import { ItemFacts } from '../../workitems/ItemFacts'
import { EditDiff } from './EditDiff'
import { ScriptDiff } from './ScriptDiff'
import { CodingDiff, FullText, RefsLine, useCodingFlags } from './CodingDiff'
import { PipelinesOut } from './PipelinesOut'
import { CostTable, fmtTokens, meterUsd } from './CostOut'
import { HelpLink } from '../../../help'
import { ConnectLine, ServersOut, SignInKey, SignInOffer, retryOf } from './ConnectOut'
import { signInFromTerminal } from './connect'
import { depsOf, makesTasks, onEjected, type AgentStep, type AgentTurn, type StagedChange } from './types'
import { ImageRefChip } from '../image/ImageRefChip'
import { FileRefChip } from '../file/FileRefChip'
import { MemoryProposals } from './MemoryProposals'
import { memoryHistory } from '../memory/log'
import { openEntry, openMemoryDb, openMemoryLog } from '../memory/open'
import { readMemories } from '../memory/read'
import { memoryDbId } from '../memory/schema'
import { memorySettings } from '../memory/settings'
import { MediaCards } from '../media/MediaCards'
import { MediaPreview } from '../media/MediaPreview'
import { pagePrivate } from '../media/blocks'
import { parsePageAddress } from '../../../lib/permalink'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import { PROVIDERS } from '@/shared/ai/providers'
import '../ai.css'
import './agent.css'

/** The terminal runs on Claude until slice 3: Anthropic bills its requests. */
const TERMINAL_COMPANY = PROVIDERS.anthropic.company

export { PropDiff, Preview } from './ReviewParts'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The Regler's halt card (its own lazy chunk — the dial and the plate's styles come with it). */
const HaltCard = lazy(loadHaltCard)



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
  // proposals that start the coding worker or whose text goes to Claude Code: "Apply all" leaves them for their own ↵;
  // sends are never applied here at all (the Outbox sends them)
  const sends = changes.filter((c) => c.status === 'pending' && c.kind === 'send').length
  const held = changes.filter((c) => c.status === 'pending' && c.kind !== 'send' && appliesAlone(c)).length
  const applying = useAgent((s) => s.applying)
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
    // open memory proposals first ("REMEMBER? · 2"), then the review list
    const mem = rootRef.current?.querySelector<HTMLElement>('.term-mem .term-change[data-status="pending"]')
    const el = mem ?? listRef.current?.querySelector<HTMLElement>('[data-cursor]') ?? listRef.current?.querySelector<HTMLElement>('li')
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !running && !applying && pending && !readOnly) {
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
          {turns.length === 0 && echo.length === 0 && <Standby disabled={!hasKey} />}
          {/* below the intro: the scroll keeps to the bottom, so the card is what shows */}
          {!hasKey && <NoKey />}
          <Timeline />
          {changes.length > 0 && <Review listRef={listRef} readOnly={readOnly} />}
        </div>
        {pending > 0 && (
          <div className="term-bar" role="region" aria-label={tn('features.agent.review.title', pending)}>
            <span className="led led--on" aria-hidden />
            <span className="term-bar__count">{tn('features.agent.review.title', pending)}</span>
            {held > 0 ? (
              <span className="term-bar__hint term-bar__hint--held" id="term-held" data-testid="term-held">
                {tn('features.agent.review.held', held)}
              </span>
            ) : (
              <span className="term-bar__hint">{t('features.agent.review.tabHint')}</span>
            )}
            <span className="term-spacer" />
            <button type="button" className="btn btn--ghost btn--sm" onClick={focusReview}>
              {t('features.agent.review.jump')}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={running || readOnly || applying || held + sends === pending}
              onClick={() => void applyStaged()}
              title={shortcutLabel('Mod+Enter')}
              aria-describedby={held > 0 ? 'term-held' : undefined}
            >
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
  const lang = useLang()
  const status = useAgent((s) => s.status)
  const turns = useAgent((s) => s.turns.length)
  const changes = useAgent((s) => s.changes.length)
  const usage = useAgent((s) => s.usage)
  const max = useAgent((s) => s.max)
  const pinned = useAgent((s) => s.mcp?.names.length ?? null)
  const halted = useAgent((s) => !!s.halt)
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
      <MemoryChip />
      {usage.requests > 0 && (
        <span className="term-head__read">
          <span aria-hidden>· </span>
          {meterUsd(usage.usd, usage.byModel, lang)}
        </span>
      )}
      {halted ? (
        <span className="term-head__regler" data-testid="term-regler">
          <span className="led term-head__regler-led" aria-hidden />
          {t('features.governor.status.cell')}
        </span>
      ) : null}
      <span className="term-head__status" aria-live="polite">
        {halted ? t('features.governor.term.paused') : t(`features.agent.status.${status}`)}
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

/**
 * "MEMORY · 3": what the last task took along from the One memory — each entry (→ open it, its
 * history in the memory log), the memory itself and its log.
 */
function MemoryChip() {
  const t = useT()
  const lang = useLang()
  const use = useAgent((s) => s.turns[s.turns.length - 1]?.memory)
  const menu = useMenu()
  if (!use) return null
  const fmt = (ms: number) => new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const entries: MenuEntry[] = menu.open
    ? [
        { kind: 'section', label: use.off ? t('features.memory.list.off') : t('features.memory.list.usedBy') },
        ...(!use.off && !use.items.length ? [{ label: t('features.memory.list.none'), disabled: true }] : []),
        ...use.items.map((it): MenuEntry => {
          const uses = memoryHistory(it.id, 8)
          return {
            label: `${it.label} · ${it.text}`,
            hint: it.forced ? `#${it.forced}` : t(`features.memory.type.${it.type}`),
            submenu: [
              { label: t('features.memory.list.openEntry'), onSelect: () => openEntry(it.id) },
              { kind: 'section', label: t('features.memory.list.history') },
              ...(uses.length
                ? uses.map((u): MenuEntry => ({ label: `${fmt(u.at)} · ${u.task || u.where}`, hint: u.cited ? t('features.memory.list.cited') : u.where, onSelect: () => openEntry(u.id) }))
                : [{ label: t('features.memory.history.none'), disabled: true }]),
            ],
          }
        }),
        { kind: 'separator' },
        { label: t('features.memory.list.open'), onSelect: openMemoryDb },
        { label: t('features.memory.list.log'), onSelect: openMemoryLog },
      ]
    : []
  return (
    <>
      <button
        type="button"
        className="term-head__mem"
        data-off={use.off || undefined}
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={t('features.memory.chipTitle')}
        data-testid="term-memory-chip"
      >
        {use.off ? t('features.memory.chipOff') : t('features.memory.chip', { count: use.items.length })}
      </button>
      <Menu {...menu.props} entries={entries} width={340} placement="bottom-start" />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states                                                        */
/* ------------------------------------------------------------------ */

function NoKey() {
  // the terminal runs on Claude in this version: on a device with only another provider the card says so
  return (
    <div className="term-nokey-card">
      <AINeedsSetup purpose="terminal.task" testId="term-needs" />
    </div>
  )
}

function Standby({ disabled }: { disabled: boolean }) {
  const t = useT()
  // external MCP servers the next conversation will use (Settings → AI)
  const mcp = useWorkspace((s) =>
    readServers(s.settings)
      .filter((x) => x.enabled)
      .map((x) => x.name.toUpperCase())
      .join(' · '),
  )
  const examples = [t('features.agent.ex.1'), t('features.agent.ex.2'), t('features.agent.ex.3')]
  // the One memory: how many memories go along ("12 memories · /remember")
  const memOn = useWorkspace((s) => memorySettings(s.settings).enabled)
  const memCount = useWorkspace(() => (memoryDbId() ? readMemories().filter((m) => m.active).length : null))
  const memory = !memOn ? t('features.memory.standby.off') : memCount === null ? t('features.memory.standby.none') : tn('features.memory.standby.count', memCount)
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
        <div>
          <dt>{t('features.memory.standby.k')}</dt>
          <dd data-testid="term-memory-standby">{memory}</dd>
        </div>
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
  const cards = useAgent((s) => s.memCards)
  const out: ReactNode[] = []
  const echoAfter = (n: number) => {
    echo.filter((e) => e.after === n).forEach((e) => out.push(<Echo key={e.id} entry={e} />))
    // One memory: proposals after the task / from /remember
    cards.filter((c) => c.after === n).forEach((c) => out.push(<MemoryProposals key={c.id} card={c} />))
  }
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
          {turn.continues ? '↻' : '›'}
        </span>
        <p className="term-turn__task">
          {turn.continues ? <span className="term-turn__cont">{t('features.agent.continue.turn', { n: pad(turn.continues) })} · </span> : null}
          {turn.task}
        </p>
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
      <TurnMedia n={turn.n} />
      <TurnHalt n={turn.n} />
      {turn.status === 'stopped' && <p className="term-note">■ {t('features.agent.stoppedNote')}</p>}
      {turn.status === 'limit' && <LimitNote last={last} />}
      {turn.status === 'error' && turn.error && <TurnError error={turn.error} n={turn.n} last={last} />}
      {turn.status === 'done' && last && turn.signIn?.length ? <SignInOffer turn={turn} /> : null}
    </section>
  )
}

/** A key on the halt card: its answer — the card goes, and the keyboard it held goes back to the prompt (never the body). */
function haltAnswerKey(c: Parameters<typeof haltKey>[0]) {
  const held = !!document.activeElement?.closest('.term-halt')
  haltKey(c)
  // a card shown again meanwhile (H refused at the gate) keeps the keyboard it took
  if (held) requestAnimationFrame(() => focusIsNowhere() && focusPrompt())
}

/**
 * The Regler's halt card under the task that waits between two steps (features/governor HaltCard, lazy — a plain line
 * while it loads): E +1 $ for this task · H a cheaper model of the same provider · the stop key — each gives the keyboard
 * back to the prompt as the card goes. Esc gives it back too (still paused).
 */
function TurnHalt({ n }: { n: number }) {
  const t = useT()
  const halt = useAgent((s) => (s.halt?.n === n ? s.halt : null))
  if (!halt) return null
  const fallback = <p className="term-note term-note--regler">■ {t(isMac ? 'features.governor.halt.prompt.mac' : 'features.governor.halt.prompt.pc')}</p>
  return (
    <div className="term-halt">
      <Suspense fallback={fallback}>
        <EndInView>
          <HaltCard {...halt.view} onAllow={() => haltAnswerKey('allow')} onCheaper={() => haltAnswerKey('cheaper')} onStop={() => haltAnswerKey('stop')} onEscape={focusPrompt} />
        </EndInView>
      </Suspense>
    </div>
  )
}

/** Scrolls the log so the halt card's keys are in view once it is there (the dock may be shorter than the card). */
function EndInView({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.scrollIntoView({ block: 'end', inline: 'nearest' })
  }, [])
  return <div ref={ref}>{children}</div>
}

/** Media an MCP result of this task returned: cards — "Save to One" stages "insert media" for review. */
function TurnMedia({ n }: { n: number }) {
  const t = useT()
  const entry = useAgent((s) => s.media.find((m) => m.turn === n) ?? null)
  const title = useWorkspace((s) => (entry?.pageId ? s.pages[entry.pageId]?.title.trim() || t('common.untitled') : ''))
  const readOnly = useCloud((s) => s.readOnly)
  if (!entry?.items.length) return null
  return (
    <div className="term-media">
      <MediaCards
        items={entry.items}
        onSaved={(saved) => stageMedia(saved, entry.pageId)}
        privateTarget={pagePrivate(entry.pageId)}
        disabled={readOnly}
        where={title ? t('features.ai.media.whereTerm', { title }) : t('features.ai.media.whereTermNew')}
      />
    </div>
  )
}

/** A task that stopped at the tool-call limit: what happened, and (the last task) Continue with a fresh budget. */
function LimitNote({ last }: { last: boolean }) {
  const t = useT()
  const running = useAgent((s) => s.status === 'running')
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const staged = useAgent((s) => s.changes.filter((c) => c.status === 'pending' || c.status === 'failed').length)
  return (
    <div className="term-limit" role="status">
      <p className="term-note">■ {t('features.agent.limitEnd', { max: MAX_TOOL_CALLS })}</p>
      {last && !running && (
        <div className="term-limit__keys">
          <button type="button" className="btn btn--sm term-limit__go" onClick={() => void continueTask()} disabled={!hasKey} data-testid="term-continue">
            <RotateCw size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.continue.key')}
          </button>
          <span className="term-limit__hint">
            {tn('features.agent.continue.hint', staged)} <span className="kbd">/continue</span>
          </span>
        </div>
      )}
    </div>
  )
}

function TurnError({ error, n, last }: { error: NonNullable<AgentTurn['error']>; n: number; last: boolean }) {
  const t = useT()
  // a key typed into the task belongs in Settings too
  const keyIssue = error.code === 'invalid_key' || error.code === 'no_key' || error.code === 'permission' || error.code === 'key_in_text'
  const signIn = error.code === 'mcp_auth' && !!error.server && last
  return (
    <div className="term-error" role="alert">
      <span className="term-error__code">✗ ERR · {error.code.toUpperCase()}</span>
      <p>{error.message}</p>
      {signIn && <SignInKey server={error.server!} retry={retryOf(n)} />}
      {keyIssue && (
        <button type="button" className="btn btn--sm" onClick={() => openAISetup({ reason: error.code === 'no_key' ? 'nokey' : error.code === 'key_in_text' ? 'add' : 'refused', step: error.code === 'no_key' ? undefined : 'key', provider: 'anthropic', feature: 'terminal' })}>
          <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.agent.nokey.open')}
        </button>
      )}
      {(error.code === 'mcp' || error.code === 'mcp_auth') && (
        <button type="button" className="btn btn--sm" onClick={() => openAISettings({ section: 'mcp' })}>
          <Settings2 size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.openSettings')}
        </button>
      )}
      {(error.code === 'outdated' || error.code === 'reload') && (
        <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
          <RotateCw size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.reload')}
        </button>
      )}
    </div>
  )
}

const GLYPH: Record<AgentStep['state'], string> = { run: '→', ok: '→', staged: '✓', err: '✗' }

function StepRow({ step }: { step: AgentStep }) {
  const t = useT()
  const tool = step.tool!
  const arg = step.arg || (tool === 'list_databases' || tool === 'get_current_page' || tool === 'list_pipelines' ? t(`features.agent.verb.${tool}.arg`) : '')
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

/** A tool call of an external MCP server ("KB · search_records"), run by Anthropic. */
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

function Echo({ entry }: { entry: EchoEntry }) {
  const t = useT()
  const lang = useLang()
  let out: ReactNode = null
  switch (entry.kind) {
    case 'help':
      out = (
        <>
          <dl className="term-table">
            {COMMANDS.map((c) => (
              <div key={c.id}>
                <dt>{helpNames(c, lang).map((n) => `/${n}`).join('  ')}</dt>
                <dd>{t(`features.agent.cmd.${c.id}`)}</dd>
              </div>
            ))}
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
      // a row per model that answered (its ledger entries), then the total; before any request the plain sums
      out = u.byModel?.length ? (
        <>
          <CostTable lines={u.byModel} />
          <ReglerRestLine />
          <p className="term-echo__note">
            {t('features.agent.meter.billed', { company: TERMINAL_COMPANY })} <HelpLink id="ai-costs" topic={t('features.ai.receipt.help')} />
          </p>
        </>
      ) : (
        <>
          <dl className="term-table term-table--cost">
            {(
              [
                ['features.agent.meter.requests', String(u.requests)],
                ['features.agent.meter.in', fmtTokens(u.input, lang)],
                ['features.agent.meter.cacheWrite', fmtTokens(u.cacheWrite, lang)],
                ['features.agent.meter.cache', fmtTokens(u.cacheRead, lang)],
                ['features.agent.meter.out', fmtTokens(u.output, lang)],
                ['features.agent.meter.usd', meterUsd(u.usd, u.byModel, lang)],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="term-echo__note">{t('features.agent.meter.billed', { company: TERMINAL_COMPANY })}</p>
        </>
      )
      break
    }
    case 'ask':
      out = <AskOut entry={entry} />
      break
    case 'connect':
      out = <ConnectLine entry={entry} />
      break
    case 'servers':
      out = <ServersOut />
      break
    case 'pipelines':
      out = <PipelinesOut entry={entry} />
      break
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

/** A y / n question (/clear-history): y or n in the prompt answers it, so do its two keys; then what it did. */
function AskOut({ entry }: { entry: EchoEntry }) {
  const t = useT()
  const ask = entry.data?.ask
  if (!ask) return null
  const answer = (yes: boolean) => {
    answerAsk(entry.id, yes)
    focusPrompt()
  }
  return (
    <>
      <p className="term-ask">
        <span>{t(entry.data?.key ?? '', entry.data?.vars)}</span>{' '}
        {ask.state === 'open' ? (
          <span className="term-ask__keys" role="group" aria-label={t('features.agent.ask.label')}>
            <button type="button" className="term-ask__key" data-answer="yes" onClick={() => answer(true)}>
              <span className="kbd">y</span> {t(`features.agent.ask.${ask.what}.yes`)}
            </button>
            <button type="button" className="term-ask__key" data-answer="no" onClick={() => answer(false)}>
              <span className="kbd">n</span> {t(`features.agent.ask.${ask.what}.no`)}
            </button>
          </span>
        ) : (
          <span className="term-ask__answer" data-answer={ask.state}>
            {ask.state === 'yes' ? 'y' : 'n'}
          </span>
        )}
      </p>
      {ask.result && <p className="term-ask__result">{t(ask.result.key, ask.result.vars)}</p>}
    </>
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
  const applying = useAgent((s) => s.applying)
  const open = changes.filter(isOpen).length
  const [cursor, setCursor] = useState(0)
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set())
  const disabled = running || readOnly || applying
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

/** A staged script that is saved now (its workbench opens). */
const savedScript = (c: StagedChange) => (c.kind === 'script' && c.script && useWorkspace.getState().scripts?.[c.script.id] ? c.script.id : null)

/** Open what a change points at: rows in the side peek, pages in the main column, a script in its workbench. */
function openChange(c: StagedChange) {
  const script = savedScript(c)
  if (script) {
    navigate(`#/scripts/${script}`)
    if (isPhone()) closeAgent()
    return
  }
  const target = changeTarget(c)
  if (!target) return
  if (c.kind === 'create_row' || c.kind === 'update_row' || c.kind === 'memory') useUI.getState().openPeek(target)
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

/** The pages a proposal sends along to the coding worker: a task's, a note's / an answer's, text written into a task's page. */
const refsOf = (x: StagedChange) => (x.kind === 'coding' ? [...(x.coding?.task?.refs ?? []), ...(x.coding?.action?.refs ?? [])] : x.kind === 'append' || x.kind === 'edit' ? (x.refs ?? []) : [])

/**
 * Does a proposal's text go to Claude Code? 'task': an append to a pipeline task's page (read at its next stage) ·
 * 'ref': a page proposed here that a proposed task, a note / answer of a task action, or text added to a task's page
 * links — it goes along to the worker once both are applied. Such text is shown in full, never as the shortened preview.
 */
function useToWorker(c: StagedChange, all: StagedChange[]): 'task' | 'ref' | null {
  // re-read when the target page changes (it may become, or stop being, a pipeline task)
  useWorkspace((s) => (c.kind === 'append' ? s.pages[stageApi.resolve(c.pageId)]?.databaseId : null))
  if (c.kind === 'append' && goesToWorker(c)) return 'task'
  if (c.kind !== 'create_page') return null
  const linked = all.some((x) => x.status !== 'discarded' && refsOf(x).some((r) => r.id === c.pageId))
  return linked ? 'ref' : null
}

/**
 * What a staged change's head says: its title (a rename: the old title struck), where it goes, its kind, the live tags
 * (STARTS WORKER · CONFIRM FIRST · GOES TO CLAUDE CODE) and the change it still needs. One hook for the review list's
 * head and for TerminalChangeBody's own head (Preflight's card) — the same words in both places.
 */
/** The first change `c` builds on that is not applied yet ("needs #n"), if any. */
const missingOf = (c: StagedChange, all: StagedChange[]) =>
  depsOf(c)
    .map((id) => all.find((x) => x.id === id))
    .find((x) => x && x.status !== 'applied')

function useChangeHead(c: StagedChange, all: StagedChange[]) {
  const t = useT()
  const titleOf = useTitleOf()
  const missing = missingOf(c, all)
  let where = ''
  if (c.kind === 'create_page' || c.kind === 'create_database') where = c.parentId ? t('features.agent.review.under', { title: titleOf(c.parentId, all) }) : t('features.agent.review.topLevel')
  else if (c.kind === 'create_row' || c.kind === 'update_row' || c.kind === 'add_property') where = t('features.agent.review.in', { title: titleOf(c.databaseId, all) })
  else if (c.kind === 'memory' && c.memory) where = t(c.memory.updates ? 'features.memory.review.update' : 'features.memory.review.where', { type: t(`features.memory.type.${c.memory.type}`) })
  else if (c.kind === 'script' && c.script) where = t(c.script.before ? 'features.script.int.review.change' : 'features.script.int.review.new')
  else if (c.kind === 'media') where = t(`features.ai.media.review.where.${(c.media?.length ?? 0) === 1 ? 'one' : 'other'}`, { count: c.media?.length ?? 0 })
  else if (c.kind === 'coding' && c.coding) where = t('features.agent.review.in', { title: c.coding.project })
  else if (c.kind === 'workItem') where = t('features.agent.review.in', { title: titleOf(c.pageId, all) })
  // a pipeline task: "STARTS WORKER" / "CONFIRM FIRST" (both live) — in the head, and in the name a screen reader reads
  const flags = useCodingFlags(c)
  // text that goes to Claude Code: shown in full, tagged (an append to a task is applied on its own)
  const toWorker = useToWorker(c, all)
  const kindLabel = c.kind === 'coding' && c.coding ? t(`features.agent.kind.coding.${c.coding.op === 'run' && c.coding.action?.retry ? 'retry' : c.coding.op}`) : t(`features.agent.kind.${c.kind}`)
  // Then starts nothing now: its task starts when this one is done
  const startsTag = t(c.kind === 'coding' && c.coding?.op === 'then' ? 'features.agent.coding.startsLater' : 'features.agent.coding.starts')
  const tags = {
    starts: flags.starts && isOpen(c) ? startsTag : '',
    confirm: flags.confirm ? t('features.agent.coding.confirm') : '',
    toworker: toWorker && isOpen(c) ? t('features.agent.coding.toWorker') : '',
  }
  let title: ReactNode = c.title
  if (c.kind === 'rename')
    title = (
      <>
        <s className="agent-diff__before">{c.beforeTitle}</s> <span className="agent-diff__arrow">→</span> {c.title}
      </>
    )
  else if (c.kind === 'append' || c.kind === 'update_row' || c.kind === 'edit' || c.kind === 'media') title = titleOf(c.pageId, all) || c.title
  else if (c.kind === 'add_property') title = c.prop?.name
  else if (c.kind === 'memory') title = c.memory?.text ?? c.title
  else if (c.kind === 'script') title = c.script?.name ?? c.title
  return { title, where, kindLabel, tags, toWorker, missing }
}

/** The live tags of a change (data-part "tags"): STARTS WORKER · CONFIRM FIRST · GOES TO CLAUDE CODE. */
function ChangeTags({ tags }: { tags: ReturnType<typeof useChangeHead>['tags'] }) {
  if (!tags.starts && !tags.confirm && !tags.toworker) return null
  return (
    <span className="term-change__tags" data-part="tags">
      {tags.starts && (
        <span className="term-tag" data-tag="starts" data-testid="term-tag-starts">
          {tags.starts}
        </span>
      )}
      {tags.confirm && (
        <span className="term-tag" data-tag="confirm" data-testid="term-tag-confirm">
          {tags.confirm}
        </span>
      )}
      {tags.toworker && (
        <span className="term-tag" data-tag="toworker" data-testid="term-tag-toworker">
          {tags.toworker}
        </span>
      )}
    </span>
  )
}

/** TerminalChangeBody's own head (Preflight's card): the title, where it goes, the live tags — the review list's words. */
function BodyHead({ change, all }: { change: StagedChange; all: StagedChange[] }) {
  const h = useChangeHead(change, all)
  return (
    <>
      {h.title && (
        <p className="term-change__line term-change__title" data-part="title">
          {h.title}
        </p>
      )}
      {h.where && (
        <p className="term-change__line term-change__where" data-part="where">
          {h.where}
        </p>
      )}
      <ChangeTags tags={h.tags} />
    </>
  )
}

/** One part of a change's body, marked for the parity check (laid out as its children: `.chg-part` is display: contents). */
const Part = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="chg-part" data-part={name}>
    {children}
  </div>
)

/**
 * A staged change's review body — exactly what the review list shows of it: the schema of a new database, property
 * diffs, the word diff of an edit, a script's diff, media, a pipeline task (with the text that goes to Claude Code in
 * full), the content preview, the pages that go along, the error and "needs #n". Every part carries `data-part`.
 * `head`: also its title, where it goes and its live tags (Preflight's card, which has no review-list head);
 * `compact`: the error and "needs #n" only (the list while a task runs). The review list's ChangeItem renders it, so
 * both places show the same parts. `card`: Preflight's card — the hints name its keys (A, then Confirm), not the list's.
 */
export function TerminalChangeBody({ change: c, all, head = false, compact = false, card = false }: { change: StagedChange; all: StagedChange[]; head?: boolean; compact?: boolean; card?: boolean }) {
  const t = useT()
  const toWorker = useToWorker(c, all)
  const missing = missingOf(c, all)
  return (
    <>
      {head && <BodyHead change={c} all={all} />}
      {!compact && (c.kind === 'create_database' || c.kind === 'add_property') && (
        <Part name="schema">
          <SchemaDiff change={c} />
        </Part>
      )}
      {!compact && c.props && c.props.length > 0 && (
        <Part name="props">
          <PropDiff props={c.props} />
        </Part>
      )}
      {!compact && c.kind === 'edit' && (
        <Part name="edit">
          <EditDiff change={c} />
        </Part>
      )}
      {!compact && c.kind === 'script' && (
        <Part name="script">
          <ScriptDiff change={c} />
        </Part>
      )}
      {!compact && c.kind === 'media' && c.media && (
        <Part name="media">
          <MediaPreview media={c.media} />
        </Part>
      )}
      {!compact && c.kind === 'coding' && (
        <Part name="coding">
          <CodingDiff change={c} card={card} />
        </Part>
      )}
      {!compact && c.markdown?.trim() && toWorker && (
        <Part name="full">
          <FullText label={t(toWorker === 'task' ? 'features.agent.coding.appendFull' : 'features.agent.coding.pageFull')} hint={toWorker === 'task' ? t(card ? 'features.agent.coding.appendHintCard' : 'features.agent.coding.appendHint') : undefined} text={c.markdown.trim()} testId="term-full-text" />
        </Part>
      )}
      {!compact && (c.items || c.workItem || !!c.notes?.length) && (
        <Part name="items">
          <ItemFacts facts={c.workItem ? [c.workItem.facts] : (c.items?.facts ?? [])} warnings={c.items?.warnings} holds={c.workItem?.holds ?? c.items?.holds} notes={c.notes} />
        </Part>
      )}
      {!compact && c.markdown?.trim() && !toWorker && c.kind !== 'rename' && c.kind !== 'edit' && c.kind !== 'coding' && (
        <Part name="preview">
          <Preview markdown={c.markdown} append={c.kind === 'append'} tasks={makesTasks(c)} />
        </Part>
      )}
      {/* text written into a pipeline task's page: the pages it links go to Claude Code with the task */}
      {!compact && (c.kind === 'append' || c.kind === 'edit') && !!c.refs?.length && (
        <Part name="refs">
          <RefsLine refs={c.refs} />
        </Part>
      )}
      {c.status === 'failed' && c.error && (
        <p className="term-change__error" data-part="error">
          {t(c.kind === 'edit' ? 'features.agent.review.skipped' : 'features.agent.review.failed', { error: c.error })}
        </p>
      )}
      {missing && c.status === 'pending' && (
        <p className="term-change__hint" data-part="needs">
          {t('features.agent.review.needs', { n: missing.n })}
        </p>
      )}
    </>
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
  const { title, where, kindLabel, tags, missing } = useChangeHead(c, all)
  const blocked = !!missing
  const label = `#${c.n}`
  const target = c.status === 'applied' ? (c.kind === 'script' ? savedScript(c) : changeTarget(c)) : null
  const tagList = [tags.starts, tags.confirm, tags.toworker].filter(Boolean)
  const name = `${label} ${kindLabel}${tagList.length ? `, ${tagList.join(', ')}` : ''}${marked ? `, ${t('features.agent.review.marked')}` : ''}`
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
        <span className="term-change__kind">{kindLabel}</span>
        {title && (
          <span className="term-change__title" data-part="title">
            {title}
          </span>
        )}
        {where && (
          <span className="term-change__where" data-part="where">
            {where}
          </span>
        )}
        <ChangeTags tags={tags} />
        <span className="term-spacer" />
        {c.status === 'applying' ? (
          <span className="term-change__actions">
            <span className="term-change__state" role="status">
              <span className="led led--on ai-led--live" aria-hidden /> {t('features.agent.review.applying')}
            </span>
          </span>
        ) : isOpen(c) ? (
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
            {/* an ejected change, or one that builds on it, never comes back here (the eject's own Undo gives it back) */}
            {!onEjected(all).has(c.id) && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => restoreStaged(c.id)} disabled={disabled} aria-label={`${t('features.agent.review.restore')} ${label}`}>
                <Undo2 size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.review.restore')}
              </button>
            )}
          </span>
        )}
      </div>
      <TerminalChangeBody change={c} all={all} compact={compact} />
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
        // an image block (Claude for images): "▣ Protokoll P1 · image 1.2 MB"
        if (r.image) return <ImageRefChip key={r.id} r={r} onRemove={() => removeRef(r.id)} />
        // a file block (Claude for files): "▤ Acme mail · PDF 1.2 MB"
        if (r.file) return <FileRefChip key={r.id} r={r} onRemove={() => removeRef(r.id)} />
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
  /** a question in the log waits for y / n (it goes even without a key or while a task runs) */
  const asking = useAgent((s) => s.echo.some((e) => e.data?.ask?.state === 'open'))
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
    const c = completionAt(draft, caret, lang, contextPageId())
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
    // an OUT tool is shown, never taken (only the Outbox sends with it)
    if (!item || item.tool?.out) return
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
    // ↵ on an empty prompt: Continue (stopped at the limit) · sign in to a server that rejected its token (the window
    // opens from this key press) · run the task again once signed in. A y / n question goes first.
    if (!text && !running && !asking) {
      const a = emptyEnter()
      if (a?.kind === 'continue' && !disabled) return void continueTask()
      if (a?.kind === 'signin') return signInFromTerminal(a.server, a.retry ? { retry: a.retry } : {})
      if (a?.kind === 'rerun' && !disabled) return rerunAfterSignIn(a.entry)
    }
    // without a key (or while a task runs) only /commands and answers go
    if (!text || ((disabled || running) && !text.startsWith('/') && !asking)) return
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
      // Enter takes the highlighted entry, unless the command (or /connect's server) is typed out already
      if (e.key === 'Enter' && !e.shiftKey) {
        const typed = draft.slice(comp.from, comp.to)
        const exact = comp.items.some((x) => x.insert.trim() === typed.trim() || (!!x.server && (x.server.name === comp.query || x.server.codeword === comp.query)))
        if (!((comp.kind === 'command' || comp.kind === 'server') && exact)) {
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
      // fresh at the start of a walk (/clear-history may have emptied it meanwhile)
      if (up && h.at === null) h.list = loadHistory()
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

  const limited = useAgent((s) => s.turns[s.turns.length - 1]?.status === 'limit')
  /** the Regler paused the running task: the prompt is read-only and names the keys */
  const halted = useAgent((s) => !!s.halt)
  // what ↵ on the empty prompt would do (re-read with the log)
  useAgent((s) => s.echo)
  useAgent((s) => s.turns)
  const enter = running || asking ? null : emptyEnter()
  const placeholder = halted
    ? t(isMac ? 'features.governor.halt.prompt.mac' : 'features.governor.halt.prompt.pc')
    : asking
    ? t('features.agent.placeholderAsk')
    : enter?.kind === 'signin'
      ? t('features.agent.placeholderSignIn', { server: enter.server })
      : disabled
        ? t('features.agent.placeholderNoKey')
        : enter?.kind === 'rerun'
          ? t('features.agent.placeholderRerun')
          : limited
            ? t('features.agent.placeholderContinue')
            : hasTurns
              ? t('features.agent.placeholderNext')
              : t('features.agent.placeholder')
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
        <ul className="term-complete" id={listId} role="listbox" aria-label={t(comp.kind === 'command' ? 'features.agent.complete.commands' : comp.kind === 'tag' ? 'features.memory.example.complete' : comp.kind === 'tool' ? 'features.agent.complete.tools' : comp.kind === 'server' ? 'features.agent.complete.servers' : 'features.agent.complete.pages')}>
          {comp.items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={item.tool?.out || undefined}
              className="term-complete__item"
              data-out={item.tool?.out || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(comp, i)}
            >
              <span className="term-complete__label">{item.mention ? `${item.mention.kind === 'database' ? '▦' : '▣'} ${item.label}` : item.label}</span>
              <span className="term-complete__hint">{item.command ? t(`features.agent.cmd.${item.command}`) : item.example ? item.example.text : item.tool?.out ? t('features.agent.complete.toolOut') : item.tool ? t('features.agent.complete.toolOf', { server: item.tool.server }) : item.server ? `${item.server.codeword ? `${item.server.codeword}: · ` : ''}${item.server.host}` : item.mention?.where || t(`features.agent.kindOf.${item.mention?.kind ?? 'page'}`)}</span>
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
          readOnly={halted}
          data-halted={halted || undefined}
          spellCheck={false}
          autoComplete="off"
          onPaste={(e) => {
            // a page's permalink (or `#/p/<id>`) of a page here: "@Title" pointing at it, like an @ completion — a link
            // to a block of it (`?b=`) stays the pasted address
            const form = parsePageAddress(e.clipboardData.getData('text/plain'))
            if (form?.kind !== 'address' || form.block || halted) return
            const { pages } = useWorkspace.getState()
            const p = pages[form.id]
            if (!p || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) return
            e.preventDefault()
            const el = e.currentTarget
            const title = p.title.trim() || t('common.untitled')
            const insert = `@${title} `
            useAgent.setState((s) => ({ mentions: [...s.mentions.filter((x) => x.id !== p.id), { id: p.id, title, kind: p.kind === 'database' ? 'database' : 'page' }] }))
            setDraft(draft.slice(0, el.selectionStart) + insert + draft.slice(el.selectionEnd), el.selectionStart + insert.length)
          }}
        />
        {running ? (
          <button type="button" className="term-run term-run--stop" onClick={() => stopAgent()} title={`${t('features.agent.stop')} (${shortcutLabel(AGENT_STOP_SHORTCUT)})`}>
            <Square size={8} fill="currentColor" strokeWidth={0} aria-hidden /> {t('features.agent.stop')}
          </button>
        ) : (
          <button type="submit" className="term-run" disabled={!draft.trim() || (disabled && !draft.trim().startsWith('/') && !asking)}>
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
  const lang = useLang()
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
      <div className="term-meter" title={t('features.agent.meter.billed', { company: TERMINAL_COMPANY })}>
        <dl className="term-meter__vals">
          {/* IN as in /cost: the input outside the cache; cache writes and reads beside it */}
          <div>
            <dt>{t('features.agent.meter.in')}</dt>
            <dd>{fmtTokens(usage.input, lang)}</dd>
          </div>
          <div>
            <dt>{t('features.agent.cost.cacheWR')}</dt>
            <dd>
              {fmtTokens(usage.cacheWrite, lang)} / {fmtTokens(usage.cacheRead, lang)}
            </dd>
          </div>
          <div>
            <dt>{t('features.agent.meter.out')}</dt>
            <dd>{fmtTokens(usage.output, lang)}</dd>
          </div>
          <div>
            <dt>{t('features.agent.meter.calls')}</dt>
            <dd data-hot={running && calls >= MAX_TOOL_CALLS - 3 ? '' : undefined}>
              {calls}/{MAX_TOOL_CALLS}
            </dd>
          </div>
          <div className="term-meter__usd">
            <dt className="visually-hidden">{displayCurrency()}</dt>
            <dd data-testid="agent-cost">{meterUsd(usage.usd, usage.byModel, lang)}</dd>
          </div>
        </dl>
        <span className="term-meter__note">{t('features.agent.meter.billed', { company: TERMINAL_COMPANY })}</span>
      </div>
    </footer>
  )
}
