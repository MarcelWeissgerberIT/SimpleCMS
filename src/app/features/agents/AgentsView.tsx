import { openAgentRun } from './dialogs'
/**
 * #/agents — custom agents as instrument cards (LED status, trigger, next run, last run, cost of the
 * last runs, what waits for review), "New agent" from a starter recipe — or from a recipe an active integration
 * profile brings (named by the profile; a mirror sets up its database first, MirrorSetup.tsx); #/agents/<id> — one agent:
 * its spec plate, run now, edit, and its run history with the review of staged changes. A team browser
 * agent changed by another member waits for its creator, who confirms it on its page (confirm.ts). Pages the agent
 * works with that are in the trash or gone are named on its page, each trashed one with Restore (gone.ts — a browser
 * run does not start while nothing in its scope or its report page is usable).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { CustomAgent, ID, Person } from '../../store/types'
import { navigate } from '../../lib/router'
import { useCloud } from '../../cloud'
import { Modal } from '../../ui/Modal'
import { restoreFocus } from '../../ui/focus'
import { Menu, useMenu } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { Switch } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { AgentModelHint } from './ModelDefault'
import { AINeedsSetup, useAIStatus } from '../ai/setup/AINeedsSetup'
import { AgentEditor } from './AgentEditor'
import { RunHistory } from './RunHistory'
import { TrustPlate } from './trust/ui/TrustPlate'
import { blankAgent, recipeDraft } from './recipes'
import { AgentCatalog, AgentFilters, categoryCounts, matchesAgentText, type CategoryFilter, type RecipePick } from './AgentCatalog'
import { MirrorSetup, type RecipeSource } from './MirrorSetup'
import { madeKind, undoMirror, type MirrorMade } from './mirror'
import { introText, leftBehind, mirrorUndoTitle, trashWithUndo } from './mirrorFlow'
import { MirrorDiscard, MirrorUndoAsk } from './MirrorDiscard'
import { useDismissMirrorToasts } from './mirrorToasts'
import { deleteAgent, runNow, setEnabled } from './actions'
import { awaitsReview, getAgentState, loadRuns, onRunsChanged, putAgentState, useAgentRuns, type AgentState } from './runs'
import { loadRuntime, loadServerRuns, teamId, useServerAgents } from './server'
import { fmtUsd, fmtWhen, nextRunText, recentCost, statusKey, statusLed, triggerText } from './format'
import { newestReal } from './held'
import { runsHere } from './runner'
import { confirmAgent, useConfirmState, type ConfirmState } from './confirm'
import { takeSectionRequest } from './try'
import type { AgentRun } from './types'
import { lostPages, lostText, restoreTarget, runBlock, seesAllPagesOf } from './gone'
import './agents.css'

const pad = (n: number) => String(n).padStart(2, '0')
const EMPTY: AgentRun[] = []

/**
 * The agent's own state on this device (agent_state_set, runs.ts): its size and when a run saved it, and "Clear"
 * (asks first) — the next run then starts as if it were the first. Nothing while no state is saved.
 */
function SavedState({ agent, runs }: { agent: CustomAgent; runs: AgentRun[] }) {
  const t = useT()
  const lang = useLang()
  const [st, setSt] = useState<AgentState | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => onRunsChanged((id) => id === agent.id && setTick((n) => n + 1)), [agent.id])
  useEffect(() => {
    let live = true
    void getAgentState(agent.id).then((v) => live && setSt(v))
    return () => {
      live = false
    }
  }, [agent.id, runs, tick])
  if (!st) return null
  const bytes = new TextEncoder().encode(st.json).length
  const clear = () =>
    useUI.getState().openModal({
      type: 'confirm',
      title: t('features.agents.state.clearTitle', { name: agent.name }),
      body: t('features.agents.state.clearBody'),
      confirmLabel: t('features.agents.state.clear'),
      onConfirm: () => {
        void putAgentState(agent.id, null).then(() => setSt(null))
      },
    })
  return (
    <p className="agx-state" data-testid="agx-saved-state">
      <span className="led led--ok" aria-hidden />
      <span className="label">{t('features.agents.spec.state')}</span>
      <span className="mono agx-state__val" title={st.json}>
        {t('features.agents.state.res.bytes', { n: bytes })} · {fmtWhen(t, st.at, lang, Date.now())}
      </span>
      <button type="button" className="agx-link" onClick={clear}>
        {t('features.agents.state.clear')}
      </button>
    </p>
  )
}

/**
 * The pages a saved agent works with that are in the trash or gone (gone.ts): each named with what it is for, a trashed
 * one (or the page in the trash above it) with Restore. Says when its browser runs do not start because of them. A
 * Restore key goes with its page: focus moves to the next Restore key still there, else to the notice's heading, else
 * (the notice gone) to the page's heading — never the page body.
 */
function LostNotice({ agent }: { agent: CustomAgent }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const pages = useWorkspace((s) => s.pages)
  const readOnly = useCloud((s) => s.readOnly)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const me = useCloud((s) => s.user?.id ?? null)
  // a teammate's agent may name their private pages, which this device never sees: those are not "gone"
  const sees = seesAllPagesOf(agent, team, me)
  const lost = useMemo(() => lostPages(agent, pages, t('common.untitled'), sees), [agent, pages, t, sees])
  if (!lost.length) return null
  const blocked = agent.runner === 'browser' && !!runBlock(agent, pages)
  const role = { scope: t('features.agents.ed.scope'), trigger: t('features.agents.ed.trigger'), report: t('features.agents.ed.reportPage') }
  const keyOf = (l: (typeof lost)[number]) => `${l.role}:${l.id}`
  const restore = (back: ID, key: string) => {
    // the items after this one: a page above several brings them all back, so the next key still there takes focus
    const after = lost.slice(lost.findIndex((l) => keyOf(l) === key) + 1).map(keyOf)
    useWorkspace.getState().restorePage(back)
    requestAnimationFrame(() => {
      const keys = [...(box.current?.querySelectorAll<HTMLButtonElement>('button[data-lost]') ?? [])]
      const next = after.map((k) => keys.find((b) => b.dataset.lost === k)).find(Boolean) ?? keys[0]
      ;(next ?? box.current?.querySelector<HTMLElement>('.agx-lost__title') ?? document.querySelector<HTMLElement>('.agx-dhead .agx-title'))?.focus()
    })
  }
  return (
    <div className="agx-notice agx-lost" role="status" data-testid="agx-lost" ref={box}>
      <span className="led agx-led--err" aria-hidden />
      <div className="agx-lost__body">
        <p className="agx-lost__title" tabIndex={-1}>
          {t('features.agents.lost.title')}
          {blocked ? ` ${t('features.agents.lost.blocked')}` : ''}
        </p>
        <ul className="agx-lost__list">
          {lost.map((l) => {
            const back = restoreTarget(l)
            const backTitle = l.state === 'below' ? (l.root?.title ?? '') : l.title
            return (
              <li key={`${l.role}:${l.id}`} className="agx-lost__item" data-state={l.state}>
                <span className="label agx-lost__role">{role[l.role]}</span>
                <span className="agx-lost__text">{lostText(t, l)}</span>
                {back && !readOnly && (
                  <button type="button" className="btn btn--sm btn--ink" data-lost={keyOf(l)} onClick={() => restore(back, keyOf(l))} aria-label={t('features.agents.lost.restoreNamed', { title: backTitle })}>
                    {t('features.agents.lost.restore')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** Ticks once a minute (next-run read-outs). */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function useAgents(): CustomAgent[] {
  const agents = useWorkspace((s) => s.agents)
  return useMemo(() => Object.values(agents ?? {}).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)), [agents])
}

/** The runs of an agent: this device's (browser) or the server's (polled while shown). */
export function useRunsOf(agent: CustomAgent | undefined): { runs: AgentRun[]; state: string } {
  const local = useAgentRuns((s) => (agent ? s.byAgent[agent.id] : undefined))
  const server = useServerAgents((s) => (agent ? s.runs[agent.id] : undefined))
  const serverState = useServerAgents((s) => (agent ? (s.runsState[agent.id] ?? 'idle') : 'idle'))
  const id = agent?.id
  const runner = agent?.runner
  useEffect(() => {
    if (!id) return
    if (runner === 'server') {
      void loadServerRuns(id)
      const timer = window.setInterval(() => void loadServerRuns(id), 15_000)
      return () => window.clearInterval(timer)
    }
    if (!useAgentRuns.getState().byAgent[id]) void loadRuns(id)
  }, [id, runner])
  if (!agent) return { runs: EMPTY, state: 'idle' }
  return runner === 'server' ? { runs: server ?? EMPTY, state: serverState } : { runs: local ?? EMPTY, state: 'ready' }
}

/** Load the server runtime once in a team workspace (runner choice, MCP names). */
function useRuntime() {
  const inCloud = useCloud((s) => s.active.kind === 'cloud')
  useEffect(() => {
    if (inCloud && useServerAgents.getState().state === 'idle') void loadRuntime()
  }, [inCloud])
}

export default function AgentsView({ agentId }: { agentId?: string }) {
  useRuntime()
  if (agentId) return <AgentDetail id={agentId} />
  return <AgentList />
}

/* ------------------------------------------------------------------ */
/* New agent                                                           */
/* ------------------------------------------------------------------ */

/** A recipe picked in the gallery: a built-in one, or one an active integration profile brings. */
type Draft = { agent: CustomAgent; mirror?: MirrorMade }

function useNewAgent() {
  const t = useT()
  const [picking, setPicking] = useState(false)
  const [mirror, setMirror] = useState<RecipeSource | null>(null)
  const [draft, setDraftState] = useState<Draft | null>(null)
  // closing a mirror draft unsaved asks first when its setup created something; focus goes back where it was
  const [discarding, setDiscarding] = useState(false)
  // the note's Undo on a draft that was changed asks first too (the changes would be lost)
  const [undoing, setUndoing] = useState(false)
  const back = useRef<HTMLElement | null>(null)
  // the open, unsaved mirror draft — kept outside the render: when the list unmounts with it, leftBehind() says so
  const pending = useRef<MirrorMade | null>(null)
  const setDraft = (d: Draft | null) => {
    pending.current = d?.mirror ?? null
    setDraftState(d)
  }
  useEffect(
    () => () => {
      const m = pending.current
      pending.current = null
      if (m) leftBehind(m)
    },
    [],
  )
  const made = draft?.mirror
  const madeHere = made ? madeKind(made) : 'none'
  // closing the tab with it open: the browser asks
  useEffect(() => {
    if (madeHere === 'none') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [madeHere])
  const pick = (id: RecipePick) => {
    setPicking(false)
    // a profile's mirror asks for its source, name and place first and creates its database (MirrorSetup)
    if (typeof id !== 'string') return setMirror(id)
    setDraft({ agent: id === 'blank' ? blankAgent() : recipeDraft(id) })
  }
  // the element in the editor focus goes back to when a prompt over it is answered with "Keep editing"
  const holdFocus = () => {
    const active = document.activeElement
    back.current = active instanceof HTMLElement && active.closest('.agx-editor') ? active : document.querySelector<HTMLElement>('.agx-editor')
  }
  const close = () => {
    // nothing this setup made (a database and report page that were there): nothing to ask about
    if (madeHere === 'none') return setDraft(null)
    holdFocus()
    setDiscarding(true)
  }
  const keep = () => {
    setDiscarding(false)
    setUndoing(false)
    requestAnimationFrame(() => restoreFocus(back.current))
  }
  const discard = (trash: boolean) => {
    setDiscarding(false)
    setDraft(null)
    if (made && trash) trashWithUndo(made)
  }
  // the note's Undo: what the setup made goes to the trash (Undo in the toast), and the draft that points at it — a
  // draft that was changed asks first (its changes would be lost)
  const undoNow = () => {
    setUndoing(false)
    if (!made) return
    setDraft(null)
    trashWithUndo(made, undoMirror(made))
  }
  const undo = (dirty: boolean) => {
    if (!dirty) return undoNow()
    holdFocus()
    setUndoing(true)
  }
  const ui = (
    <>
      {picking && <RecipeModal onPick={pick} onClose={() => setPicking(false)} />}
      {mirror && (
        <MirrorSetup
          source={mirror}
          onClose={() => setMirror(null)}
          onCreated={(m) => {
            setMirror(null)
            setDraft({ agent: m.draft, mirror: m })
          }}
        />
      )}
      {draft && (
        <AgentEditor
          initial={draft.agent}
          isNew
          intro={made ? introText(t, made) : undefined}
          introUndo={made && madeHere !== 'none' ? { title: mirrorUndoTitle(t, made), run: undo } : undefined}
          writeHint={made ? t('features.agents.mirror.writeHint') : undefined}
          onClose={close}
          onSaved={(id) => {
            setDraft(null)
            navigate(`#/agents/${id}`)
          }}
        />
      )}
      {/* closing both at once, focus goes back to the editor's opener whichever dialog closes first (ui/Modal.tsx) */}
      {discarding && made && <MirrorDiscard made={made} onKeep={keep} onDiscard={discard} />}
      {undoing && made && <MirrorUndoAsk made={made} onKeep={keep} onUndo={undoNow} />}
    </>
  )
  return { open: () => setPicking(true), pick, ui }
}


function RecipeModal({ onPick, onClose }: { onPick: (id: RecipePick) => void; onClose: () => void }) {
  const t = useT()
  useDismissMirrorToasts()
  return (
    <Modal open onClose={onClose} label="§ AG" title={t('features.agents.newTitle')} width={620} className="agx-recipe-modal">
      <p className="agx-lead agx-lead--modal">{t('features.agents.newLead')}</p>
      <AgentCatalog onPick={onPick} />
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

function AgentList() {
  const t = useT()
  const agents = useAgents()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const shown = agents.filter((a) => (category === 'all' || (a.category ?? 'custom') === category) && matchesAgentText(`${a.name} ${a.instructions} ${t(`features.agents.category.${a.category ?? 'custom'}`)}`, query))
  const readOnly = useCloud((s) => s.readOnly)
  const created = useNewAgent()
  const now = useMinute()
  const on = agents.filter((a) => a.enabled).length
  return (
    <div className="agx">
      <header className="agx-head">
        <div className="agx-head__meta label">
          <span className="agx-head__sec">§ AG</span>
          <span>{t('features.agents.kicker')}</span>
          <span className="agx-head__rule" aria-hidden />
          <span className="mono" data-testid="agx-count">
            {pad(agents.length)} · {t('features.agents.onCount', { n: pad(on) })}
          </span>
        </div>
        <div className="agx-head__row">
          <h1 className="agx-title">{t('features.agents.title')}</h1>
          {!readOnly && (
            <button type="button" className="btn btn--primary" onClick={created.open}>
              <Plus size={14} strokeWidth={1.9} aria-hidden /> {t('features.agents.new')}
            </button>
          )}
        </div>
        <p className="agx-lead">{t('features.agents.lead')}</p>
      </header>
      {agents.length > 0 && (
        <section className="agx-saved" aria-labelledby="agx-saved-title">
          <h2 id="agx-saved-title" className="agx-start__title label">{t('features.agents.catalog.saved')}</h2>
          <AgentFilters saved query={query} category={category} counts={categoryCounts(agents.map((a) => a.category ?? 'custom'))} onQuery={setQuery} onCategory={setCategory} />
          {shown.length ? (
            <ul className="agx-cards">
              {shown.map((a) => <AgentCard key={a.id} agent={a} n={agents.indexOf(a) + 1} now={now} />)}
            </ul>
          ) : <p className="agx-note" role="status">{t('features.agents.catalog.noneSaved')}</p>}
        </section>
      )}
      <section className="agx-start" aria-labelledby="agx-start-title">
        <h2 id="agx-start-title" className="agx-start__title label">{t('features.agents.catalog.title')}</h2>
        {readOnly ? <p className="agx-note">{t('features.agents.readOnly')}</p> : <AgentCatalog onPick={created.pick} />}
      </section>
      {created.ui}
    </div>
  )
}

/**
 * LED + word for an agent: running, waiting for its creator, waiting for review, off, failed, held by the Regler, ok. A
 * failure is read like the health lamp reads it (held.ts newestReal: a held or skipped start never hides an earlier
 * failure); the newest start held by the governor reads "Held" (amber), never "Ready".
 */
function agentState(agent: CustomAgent, runs: readonly AgentRun[], review: boolean, waiting: boolean): { led: string; key: string } {
  const last = runs[0]
  if (last?.status === 'running') return { led: statusLed('running'), key: 'running' }
  if (waiting) return { led: 'led led--on', key: 'waiting' }
  if (review) return { led: statusLed('staged'), key: 'review' }
  if (!agent.enabled) return { led: 'led', key: 'off' }
  const real = newestReal(runs)
  if (real && (real.status === 'error' || real.status === 'budget')) return { led: statusLed('error'), key: 'error' }
  if (last?.status === 'held') return { led: statusLed('held'), key: 'held' }
  return { led: last ? 'led led--ok' : 'led', key: last ? 'ready' : 'idle' }
}

/** "Changed by Bob — waiting for Ada to confirm." (the creator reads "… for you to confirm.") */
function waitText(t: ReturnType<typeof useT>, wait: ConfirmState, people: Person[]): string {
  const name = (id: string | null) => (id ? people.find((p) => p.id === id)?.name.trim() : '') || ''
  const editor = name(wait.editor) || t('features.agents.wait.someone')
  return wait.mine ? t('features.agents.wait.you', { editor }) : t('features.agents.wait.text', { editor, creator: name(wait.creator) || t('features.agents.wait.creator') })
}

/** The next run, or "After confirmation" while it waits for its creator. */
function nextText(t: ReturnType<typeof useT>, agent: CustomAgent, wait: ConfirmState, lang: string, now: number): string {
  return wait.waiting && agent.enabled ? t('features.agents.next.waiting') : nextRunText(t, agent, lang, now)
}

function AgentCard({ agent, n, now }: { agent: CustomAgent; n: number; now: number }) {
  const t = useT()
  const lang = useLang()
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const readOnly = useCloud((s) => s.readOnly)
  const people = useWorkspace((s) => s.people)
  const wait = useConfirmState(agent)
  const { runs } = useRunsOf(agent)
  const last = runs[0]
  const reviews = runs.filter(awaitsReview)
  const st = agentState(agent, runs, reviews.length > 0, wait.waiting)
  // proposals waiting for the person: held back by a Vorprüfer too (ChangeStatus 'held' — a run the Regler held counts by its changes)
  const pending = reviews.reduce((sum, r) => sum + (r.staged ?? []).filter((c) => c.status === 'pending' || c.status === 'failed' || c.status === 'held').length, 0)
  const cost = recentCost(runs)
  const href = `#/agents/${agent.id}`
  return (
    <li className="agx-card" data-state={st.key}>
      <div className="agx-card__top">
        <span className="agx-card__code label">AG-{pad(n)}</span>
        <span className="agx-card__state label" data-testid="agx-state">
          <span className={st.led} aria-hidden /> {t(`features.agents.state.${st.key}`)}
        </span>
        <span className="agx-spacer" />
        <Switch seed={agent.id} checked={agent.enabled} onChange={(v) => setEnabled(agent, v)} label={t('features.agents.enableNamed', { name: agent.name })} disabled={readOnly || wait.waiting} />
      </div>
      <a className="agx-card__name" href={href}>
        <PageIcon icon={agent.icon} size={20} />
        <span>{agent.name}</span>
      </a>
      <dl className="agx-spec">
        <div>
          <dt>{t('features.agents.spec.trigger')}</dt>
          <dd>{triggerText(t, agent.trigger, { pages, databases, lang })}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.next')}</dt>
          <dd className={agent.trigger.type === 'schedule' && agent.enabled && !wait.waiting ? 'mono' : undefined}>{nextText(t, agent, wait, lang, now)}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.last')}</dt>
          <dd>
            {last ? (
              <>
                <span className={statusLed(last.status)} aria-hidden /> {t(statusKey(last.status))} <span className="agx-spec__aside mono faint">{fmtWhen(t, last.startedAt, lang, now)}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.cost')}</dt>
          <dd className="mono">
            {fmtUsd(cost, lang)} <span className="agx-spec__aside faint">{t('features.agents.spec.lastN', { n: Math.min(runs.length, 10) })}</span>
          </dd>
        </div>
      </dl>
      {wait.waiting && (
        <p className="agx-wait" data-testid="agx-wait">
          <span className="led led--on" aria-hidden /> <span>{waitText(t, wait, people)}</span>
        </p>
      )}
      <div className="agx-card__foot">
        <span className="agx-chip label">{t(`features.agents.category.${agent.category ?? 'custom'}`)}</span>
        <span className="agx-chip label">{t(`features.agents.runner.${agent.runner}`)}</span>
        <span className="agx-chip label">{t(`features.agents.write.${agent.write}Short`)}</span>
        {pending > 0 && (
          <a className="agx-card__review label" href={href}>
            <span className="led led--on" aria-hidden /> {t(pending === 1 ? 'features.agents.review.badge.one' : 'features.agents.review.badge.other', { count: pending })}
          </a>
        )}
        <span className="agx-spacer" />
        {wait.waiting && wait.mine ? (
          <a className="btn btn--sm btn--ink" href={href}>
            <Check size={12} strokeWidth={1.9} aria-hidden /> {t('features.agents.wait.review')}
          </a>
        ) : (
          !readOnly && (
            <button type="button" className="btn btn--sm" onClick={() => void runNow(agent)} disabled={last?.status === 'running' || wait.waiting} aria-label={t('features.agents.runNamed', { name: agent.name })}>
              <Play size={12} strokeWidth={1.9} aria-hidden /> {t('features.agents.run')}
            </button>
          )
        )}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function AgentDetail({ id }: { id: ID }) {
  const t = useT()
  const lang = useLang()
  const agent = useWorkspace((s) => s.agents?.[id])
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const hasKey = useAIStatus('agents.run').ready
  const readOnly = useCloud((s) => s.readOnly)
  const people = useWorkspace((s) => s.people)
  const wait = useConfirmState(agent)
  const index = useAgents().findIndex((a) => a.id === id)
  const { runs, state } = useRunsOf(agent)
  const [editing, setEditing] = useState(false)
  // the changelog's "Try it": the editor at section 06
  const [section, setSection] = useState<'06' | undefined>()
  useEffect(() => {
    if (!agent || readOnly || !takeSectionRequest(id)) return
    setSection('06')
    setEditing(true)
  }, [id, agent, readOnly])
  const menu = useMenu()
  const now = useMinute()
  const serverState = useServerAgents((s) => s.state)
  const runtime = useServerAgents((s) => s.runtime)

  if (!agent)
    return (
      <div className="agx">
        <a className="agx-back label" href="#/agents">
          <ArrowLeft size={13} strokeWidth={1.8} aria-hidden /> {t('features.agents.title')}
        </a>
        <p className="agx-empty">{t('features.agents.missing')}</p>
      </div>
    )

  const last = runs[0]
  const reviews = runs.filter(awaitsReview)
  const st = agentState(agent, runs, reviews.length > 0, wait.waiting)
  // runs in another member's browser (while it waits for its creator: unless that is the viewer)
  const elsewhere = agent.runner === 'browser' && agent.enabled && !!teamId() && (wait.waiting ? !wait.mine : !runsHere(agent))
  const creator = agent.createdBy ? people.find((p) => p.id === agent.createdBy)?.name : null
  const scope = agent.scope.everything
    ? t('features.agents.scope.all')
    : [...agent.scope.pages, ...agent.scope.databases]
        .map((x) => (pages[x] ? pages[x].title.trim() || t('common.untitled') : t(agent.scope.databases.includes(x) ? 'features.agents.ed.goneDb' : 'features.agents.ed.gone')))
        .join(', ') || '—'

  return (
    <div className="agx agx--detail">
      <a className="agx-back label" href="#/agents">
        <ArrowLeft size={13} strokeWidth={1.8} aria-hidden /> {t('features.agents.title')}
      </a>
      <header className="agx-dhead">
        <div className="agx-head__meta label">
          <span className="agx-head__sec">§ AG-{pad(index + 1)}</span>
          <span>
            {t(`features.agents.runner.${agent.runner}`)} · {t(`features.agents.write.${agent.write}Short`)}
          </span>
          <span className="agx-head__rule" aria-hidden />
          <span className="agx-card__state" data-testid="agx-state">
            <span className={st.led} aria-hidden /> {t(`features.agents.state.${st.key}`)}
          </span>
        </div>
        <div className="agx-head__row">
          <h1 className="agx-title agx-title--agent" tabIndex={-1}>
            <PageIcon icon={agent.icon} size={30} />
            <span>{agent.name}</span>
          </h1>
          <div className="agx-dhead__tools">
            <Switch seed={agent.id} checked={agent.enabled} onChange={(v) => setEnabled(agent, v)} label={t('features.agents.enableNamed', { name: agent.name })} disabled={readOnly} />
            {!readOnly && (
              <>
                <button type="button" className="btn btn--primary" onClick={() => void runNow(agent)} disabled={last?.status === 'running' || wait.waiting}>
                  <Play size={13} strokeWidth={1.9} aria-hidden /> {t('features.agents.runNow')}
                </button>
                <button type="button" className="btn" onClick={() => openAgentRun({ agentId: agent.id })} disabled={last?.status === 'running' || wait.waiting}>
                  {t('features.agents.invoke.open')}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  <Pencil size={13} strokeWidth={1.8} aria-hidden /> {t('features.agents.edit')}
                </button>
                <button type="button" className="icon-btn" onClick={menu.toggle} aria-label={t('features.agents.more')} aria-haspopup="menu" aria-expanded={menu.open}>
                  <MoreHorizontal size={16} strokeWidth={1.7} />
                </button>
                <Menu {...menu.props} entries={[{ label: t('features.agents.del.menu'), icon: <Trash2 size={14} />, danger: true, onSelect: () => deleteAgent(agent.id) }]} placement="bottom-end" />
              </>
            )}
          </div>
        </div>
      </header>

      <dl className="agx-spec agx-spec--plate">
        <div>
          <dt>{t('features.agents.spec.trigger')}</dt>
          <dd>{triggerText(t, agent.trigger, { pages, databases, lang })}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.next')}</dt>
          <dd className={agent.trigger.type === 'schedule' && agent.enabled && !wait.waiting ? 'mono' : undefined}>{nextText(t, agent, wait, lang, now)}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.scope')}</dt>
          <dd>{scope}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.write')}</dt>
          <dd>{t(`features.agents.write.${agent.write}`)}</dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.report')}</dt>
          <dd>{agent.output?.pageId && pages[agent.output.pageId] ? pages[agent.output.pageId].title.trim() || t('common.untitled') : '—'}</dd>
        </div>
        <div>
          <dt>MCP</dt>
          <dd className="mono">
            {agent.mcpServers.length
              ? agent.mcpServers
                  .map((x) => {
                    const only = agent.mcpTools && Object.prototype.hasOwnProperty.call(agent.mcpTools, x) ? agent.mcpTools[x] : null
                    return only ? `${x.toUpperCase()} (${t('features.agents.spec.toolsN', { n: only.length })})` : x.toUpperCase()
                  })
                  .join(' · ')
              : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.engine')}</dt>
          <dd className="mono">
            <AgentModelHint agent={agent} />
            {agent.effort ? ` · ${t(`features.agents.effort.${agent.effort}`)}` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('features.agents.spec.budget')}</dt>
          <dd className="mono">
            {fmtUsd(agent.maxRunUsd, lang)} {t('features.agents.spec.perRun')}
          </dd>
        </div>
      </dl>

      {wait.waiting && (
        <div className="agx-notice agx-notice--wait" role="status" data-testid="agx-wait">
          <span className="led led--on" aria-hidden />
          <span>
            {waitText(t, wait, people)}
            {wait.mine && <span className="agx-notice__sub">{t('features.agents.wait.hint')}</span>}
          </span>
          {wait.mine && (
            <button
              type="button"
              className="btn btn--sm btn--ink"
              onClick={() => {
                if (confirmAgent(agent)) useUI.getState().toast({ message: t('features.agents.wait.confirmed', { name: agent.name }), kind: 'success' })
              }}
            >
              <Check size={13} strokeWidth={1.9} aria-hidden /> {t('features.agents.wait.confirm')}
            </button>
          )}
        </div>
      )}
      <LostNotice agent={agent} />
      {!hasKey && agent.runner === 'browser' && !elsewhere && <AINeedsSetup purpose="agents.run" testId="agx-needs" />}
      {elsewhere && (
        <div className="agx-notice" role="note">
          <span className="led" aria-hidden />
          <span>{creator ? t('features.agents.elsewhere', { name: creator }) : t('features.agents.elsewhereAnon')}</span>
        </div>
      )}
      {agent.runner === 'server' && (serverState === 'unsupported' || state === 'unsupported') && (
        <div className="agx-notice" role="note">
          <span className="led agx-led--err" aria-hidden />
          <span>{t('features.agents.server.unsupported')}</span>
        </div>
      )}
      {agent.runner === 'server' && runtime && (!runtime.available || !runtime.enabled) && (
        <div className="agx-notice" role="note">
          <span className="led agx-led--err" aria-hidden />
          <span>{!runtime.available ? t('features.agents.server.off') : t('features.agents.runner.serverOff')}</span>
        </div>
      )}

      <details className="agx-instr" open={wait.waiting || undefined}>
        <summary className="label">{t('features.agents.ed.instructions')}</summary>
        <p>{agent.instructions}</p>
      </details>

      {/* runs left, this device's trust per field right (wide); on a phone the plate comes after the runs */}
      <div className="agx-detail__cols">
        <section className="agx-runsec" aria-labelledby="agx-runs-title">
          <h2 id="agx-runs-title" className="agx-runsec__title label">
            {t('features.agents.runs.title')} <span className="mono faint">· {pad(runs.length)}</span>
            {agent.runner === 'browser' && <span className="agx-runsec__where faint">{t('features.agents.runs.device')}</span>}
          </h2>
          {agent.runner === 'browser' && <SavedState agent={agent} runs={runs} />}
          <RunHistory runs={runs} empty={state === 'loading' ? t('features.agents.runs.loading') : t('features.agents.runs.none')} />
        </section>
        <TrustPlate agent={agent} runs={runs} />
      </div>

      {editing && (
        <AgentEditor
          initial={agent}
          isNew={false}
          section={section}
          onClose={() => {
            setEditing(false)
            setSection(undefined)
          }}
          onSaved={() => {
            setEditing(false)
            setSection(undefined)
          }}
        />
      )}
    </div>
  )
}
