/**
 * The plate on a request's page (spec §1.4–§1.9): "§ PRÜFAUFTRAG · PA-12 · PLANER", screwed, between the row's
 * properties and its body.
 *  - the Status (a word beside its LED) and, in Planen, its sub-state chip: plant ◐ (the planner's run in this tab) ·
 *    Rückfrage (the draft holds questions only) · Regler hält · wartet auf Worker · abgelaufen
 *  - four lamps, 2×2 on a narrow plate (never overflowing at 390 px): CODING · WORKER · KONTEXT (dim "ohne Server" —
 *    never red) · PLANER; ⚙ the work orders' settings beside the status
 *  - the precondition strip (§2.2 items 1–6, pre.ts): the first that fails with its fix key — or the kept press, or
 *    "Bereit zum Planen", or how the planner's last run here ended when it made no plan
 *  - while One plans: what is read, every server call, the receipt, ⌘. (Planning.tsx); a manual run at the Regler's line:
 *    the brake note in the plate; questions only: an answer field each (Questions.tsx)
 *  - ↵ Planen (a press of the allow-list, how 'plate'); viewers see no key
 *  - ChainPart.tsx: Kette bereit (ReadyPart.tsx), a creation, an interrupted one, the Laufleiste, the end
 *  - a team (Orders B12): a device without the worker link holds no plan or chain — RemotePart.tsx shows what the tasks
 *    show (display only) with its two keys (D Verwerfen in Kette bereit, H Anhalten while it runs); ↵ Planen there asks
 *    the worker device for it (the Status Planen, its card "Hier planen"); the worker device says a request from another
 *    device in the strip; a work order moved out of Private is never planned ("nur private Prüfaufträge"); a data rule's
 *    refusal of the planner is worded for a member ("Regel des Arbeitsbereichs — eine Admin kann sie ändern", no key)
 * Keys with focus in the plate: Esc only leaves (focus to the heading — it never discards), ⌘. stops a planner run, Z
 * takes back the plan D just discarded. On a phone the plate's main keys row is a bar at the bottom (above the flight
 * recorder's deck, the floating keys out of the way — `html[data-bottom-bar]`).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Settings2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID, OrderStatusKey } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { useUI } from '../../../store/ui'
import { Led, Screws } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { useCoding } from '../state'
import { serverRows } from './serverTools'
import { workerVerdict } from '../link'
import { openCodingSettings } from '../open'
import { ChangeReposButton } from '../SetupCard'
import { readOrderConfig } from './config'
import { orderCode, orderRowShared, orderStatusKey } from './db'
import { orderPreNow, pressPlan, usePressNotes, wantLive } from './press'
import { useOrderRecord } from './records'
import { usePlannerRun } from './runs'
import { outcomeText, preWhyText, problemText, untilText } from './text'
import ChainPart from './ChainPart'
import RemotePart from './RemotePart'
import { requestedElsewhere, ruleRefusal } from './team'
import { AIError } from '../../ai/core/errors'
import { FixKeys } from '../../ai/setup/AINeedsSetup'
import { aiRulesAllowed } from '../../../store/ai'
import { PlanBrake, PlanningPart } from './Planning'
import { QuestionsForm } from './Questions'
import { OrderSettingsKey } from './OrderSettings'
import { stopPlanning } from './runs'
import { takeDiscardUndo } from './trigger'
import { typing } from '../../../ui/keys'
import { HelpLink } from '../../../help'
import { ORDER_LIMITS } from './types'
import { useOrderAuto } from './auto'
import type { OrderPreWhy } from './pre'
import './orders.css'

type Chip = 'planning' | 'question' | 'regler' | 'worker' | 'expired' | 'asked' | null
type LedState = 'off' | 'on' | 'ok'

const STATUS_LED: Record<OrderStatusKey, LedState> = { draft: 'off', plan: 'on', ready: 'on', running: 'on', halted: 'off', done: 'ok' }

function Lamp({ name, led, text, dim, testId }: { name: string; led: LedState; text: string; dim?: boolean; testId: string }) {
  return (
    <div className="orp-lamp" data-dim={dim || undefined} data-testid={testId}>
      <dt className="label">{name}</dt>
      <dd>
        {dim ? <span className="orp-ring" aria-hidden /> : <Led state={led} />}
        <span className="orp-lamp__text" title={text}>
          {text}
        </span>
      </dd>
    </div>
  )
}

/** The fix key of a failed precondition (none for a viewer, the worker on another device). */
function FixKey({ why }: { why: OrderPreWhy }) {
  const t = useT()
  switch (why) {
    case 'codingOff':
    case 'offline':
    case 'outdated':
    case 'unsafe':
      return (
        <button type="button" className="btn btn--sm" onClick={() => openCodingSettings()} data-testid="order-fix">
          <Settings2 size={13} strokeWidth={1.75} aria-hidden />
          {t(why === 'outdated' || why === 'unsafe' ? 'features.coding.order.key.update' : 'features.coding.order.key.settings')}
        </button>
      )
    case 'noRepos':
      return <ChangeReposButton className="btn btn--sm" />
    case 'noProject':
      return (
        <button type="button" className="btn btn--sm" onClick={() => navigate({ name: 'coding' })} data-testid="order-fix">
          {t('features.coding.order.key.coding')}
          <ArrowRight size={13} strokeWidth={1.75} aria-hidden />
        </button>
      )
    default:
      return null
  }
}

export default function OrderPlate({ rowId }: { rowId: ID }) {
  const t = useT()
  useLang()
  const hid = useId()
  const plateRef = useRef<HTMLElement>(null)
  // a brake note answered or set aside (the next run shows its own)
  const [brakeDone, setBrakeDone] = useState(false)
  // re-render on the row, the database and the worker link
  const page = useWorkspace((s) => s.pages[rowId])
  const db = useWorkspace((s) => (s.pages[rowId]?.databaseId ? s.databases[s.pages[rowId]!.databaseId!] : undefined))
  useWorkspace((s) => s.databases)
  const coding = useCoding()
  const viewer = useCloud((s) => s.readOnly)
  const team = useCloud((s) => s.active.kind === 'cloud')
  // Orders B11: this device's "Ohne Bestätigung starten" for the request's database (the deferred line says it starts)
  const autoOn = !!useOrderAuto(db?.id).consent
  const stored = useOrderRecord(rowId)
  // a record a later build wrote: never acted on, never overwritten (records.ts) — the strip says so
  const unreadable = stored === 'unreadable'
  const rec = stored && stored !== 'unreadable' ? stored : null
  const note = usePressNotes((s) => s.notes[rowId] ?? null)
  const status = orderStatusKey(rowId)
  const code = orderCode(rowId) ?? '—'
  const read = readOrderConfig(db)
  const server = read.kind === 'ok' ? read.config.server?.name ?? null : null
  const pre = orderPreNow(rowId)
  const want = rec?.want
  const live = wantLive(want)
  // the planner's newest run in this tab: in flight from its start, its outcome once it ended
  const run = usePlannerRun(rowId)
  const outcome = run?.phase === 'done' ? run.outcome : undefined
  const planningNow = note?.why === 'planning' || (!!run && run.phase !== 'done')
  useEffect(() => setBrakeDone(false), [run?.run])
  // the plate's own keys (focus inside it): Esc only leaves — focus to the heading, nothing discarded · ⌘. stops a
  // planner run here · Z takes back the plan D just discarded (its toast's Undo)
  useEffect(() => {
    const plate = plateRef.current
    if (!plate) return
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return
      const el = e.target as HTMLElement
      if (e.key === '.' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        if (stopPlanning(rowId)) e.preventDefault()
        return
      }
      if (typing(el) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        // a popover / dialog inside handles its own Esc first
        if (el.closest('[role="dialog"]')) return
        e.preventDefault()
        document.getElementById(hid)?.focus()
        return
      }
      if (e.key.toLowerCase() === 'z' && orderStatusKey(rowId) === 'draft') {
        const undo = takeDiscardUndo(rowId)
        if (!undo) return
        e.preventDefault()
        undo()
      }
    }
    plate.addEventListener('keydown', on)
    return () => plate.removeEventListener('keydown', on)
  }, [rowId, hid])
  // a phone: the plate's main keys row is the bottom bar — the floating keys step aside while the plate is here
  useEffect(() => {
    if (viewer || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 600px)')
    const set = () => {
      if (mq.matches) document.documentElement.setAttribute('data-bottom-bar', '')
      else document.documentElement.removeAttribute('data-bottom-bar')
    }
    set()
    mq.addEventListener('change', set)
    return () => {
      mq.removeEventListener('change', set)
      document.documentElement.removeAttribute('data-bottom-bar')
    }
  }, [viewer])
  const asks = rec?.state === 'draft' && !!rec.draft && !rec.draft.plan.steps.length
  // Orders B12 — a team: a work order moved out of Private is never planned; on the worker device, a request another
  // device asked for (its card "Hier planen" in Preflight; ↵ Planen here is the same press)
  const shared = orderRowShared(rowId)
  const askedHere = team && status === 'plan' && pre.ok && !!page && stored !== undefined && !unreadable && requestedElsewhere(rec, page) && note?.why !== 'planning' && !(!!run && run.phase !== 'done')
  // a kept press waits for the worker only while no 'ok' one is online here (else it plans in 5 s, or the planner held /
  // refused it and it waits for the worker's next return — trigger.ts `parked`)
  const ok = workerVerdict(coding) === 'ok'
  const waiting = !!want && live && !ok
  const chip: Chip =
    status !== 'plan'
      ? null
      : planningNow
        ? 'planning'
        : (outcome?.kind === 'held' || outcome?.kind === 'brake') && !waiting
          ? 'regler'
          : want && !live
            ? 'expired'
            : waiting
              ? 'worker'
              : asks
                ? 'question'
                : askedHere || (team && !pre.ok && pre.why === 'elsewhere')
                  ? 'asked'
                  : null
  const ended = status === 'plan' && !planningNow && outcome ? outcomeText(outcome, code) : null
  const online = coding.enabled && coding.conn === 'connected'
  const elsewhere = !pre.ok && pre.why === 'elsewhere'

  const planner: { led: LedState; text: string } =
    chip === 'planning'
      ? { led: 'on', text: t('features.coding.order.lamp.planner.planning') }
      : chip === 'worker'
        ? { led: 'off', text: t('features.coding.order.lamp.planner.waiting') }
        : chip === 'expired'
          ? { led: 'off', text: t('features.coding.order.lamp.planner.expired') }
          : chip === 'regler' || chip === 'question'
            ? { led: 'on', text: t(`features.coding.order.chip.${chip}`) }
            : ended
              ? { led: 'off', text: t('features.coding.order.lamp.planner.blocked') }
              : pre.ok
                ? { led: 'ok', text: t('features.coding.order.lamp.planner.idle') }
                : { led: 'off', text: t('features.coding.order.lamp.planner.blocked') }

  // the strip: a viewer · a kept press · an expired one · the first failing precondition · ready
  let line: string
  let why: OrderPreWhy | 'ok' | 'later' | 'expired' | 'viewer' | 'unreadable' | 'shared'
  if (viewer) {
    why = 'viewer'
    line = t('features.coding.order.pre.viewer')
  } else if (shared) {
    why = 'shared'
    line = preWhyText('shared')
  } else if (unreadable) {
    why = 'unreadable'
    line = t('features.coding.order.why.unreadable')
  } else if (status === 'plan' && waiting) {
    why = 'later'
    // Orders B11: with this device's consent the deferred plan starts too — said so
    line = `${t(autoOn ? 'features.coding.order.why.laterAuto' : 'features.coding.order.why.later', { time: untilText(want.at + ORDER_LIMITS.wantMs) })}${pre.ok ? '' : ` · ${preWhyText(pre.why, pre.left)}`}`
  } else if (status === 'plan' && want && !live) {
    why = 'expired'
    line = t('features.coding.order.why.expired')
  } else if (!pre.ok) {
    why = pre.why
    line = preWhyText(pre.why, pre.left)
  } else {
    why = 'ok'
    line = t('features.coding.order.pre.ok', { kinds: pre.usable.map((k) => t(`features.coding.pipe.${k}`)).join(' · ') })
  }
  const left = pre.ok && pre.left.length ? t('features.coding.order.pre.left', { list: pre.left.map((k) => `${t(`features.coding.pipe.${k.kind}`)}: ${problemText(k.problem)}`).join(' · ') }) : ''
  const running = status === 'running'
  const fix = !pre.ok && why !== 'viewer' && why !== 'unreadable' && why !== 'shared' ? pre.why : null
  // the chain's part (ChainPart.tsx): the plan to confirm in Kette bereit, a creation, the Laufleiste
  const ready = status === 'ready'
  const chainState = rec?.state
  const chainShown =
    !!rec && ((chainState === 'draft' && ready && !!rec.draft?.plan.steps.length) || chainState === 'creating' || chainState === 'interrupted' || (!!rec.chain && (chainState === 'running' || chainState === 'halted' || chainState === 'done')))
  // Orders B12 — no plan or chain of the request on this device: a team device without the worker link shows what the
  // tasks show (display only); the worker device a chain started elsewhere has not reached yet says "Kette bestätigen"
  const adopt = team && online && !shared && !viewer && status === 'running' && !chainShown
  const remote = !chainShown && !shared && !!status && ((elsewhere && status !== 'draft') || adopt)
  // the strip's "ready to plan" says nothing once a plan or a chain stands here
  const strip = !(chainShown && why === 'ok' && !ended)
  // planning again is a plain key beside the plan; nothing plans over a chain being made or running — never a work order
  // moved out of Private; a device without the worker link asks for it only where a press would plan anew
  const planKey = !shared && (elsewhere ? !status || status === 'draft' || status === 'halted' || status === 'done' : !chainShown || chainState === 'draft' || chainState === 'halted' || chainState === 'done')
  // a data rule refused the planner's request (§2.2 item 7): its fix keys — a member reads who can change a workspace rule
  const refusedErr = outcome?.kind === 'blocked' && outcome.block.why === 'refused' && outcome.block.error instanceof AIError ? outcome.block.error : null
  const rule = refusedErr ? ruleRefusal(refusedErr.code, refusedErr.fix, aiRulesAllowed()) : null

  // the planner asked back (or refused): its questions are the plate's main part, their key carries ↵
  const askOnly = status === 'plan' && rec?.state === 'draft' && !!rec.draft && !rec.draft.plan.steps.length && (rec.draft.plan.questions.length > 0 || !!rec.draft.plan.refused)
  // ↵ Planen — beside the plan once one stands here ("Erneut planen", a plain key: ↵ is Kette starten then — or the
  // answers' key while the planner asks)
  const plain = chainShown || (askOnly && !!rec?.draft?.plan.questions.length)
  const planButton = (
    <button type="button" className={`btn btn--sm${plain ? '' : ' btn--primary'}`} disabled={running} title={running ? t('features.coding.order.why.running') : undefined} onClick={() => void pressPlan(rowId, 'plate').then((r) => r.kind === 'asked' && useUI.getState().toast({ message: t('features.coding.order.toast.asked', { id: code }), kind: 'info' }))} data-testid="order-plan">
      {!plain && (
        <span className="kbd" aria-hidden>
          ↵
        </span>
      )}
      {t(why === 'expired' || plain ? 'features.coding.order.key.planAgain' : 'features.coding.order.key.plan')}
    </button>
  )

  // the server's lamp: its read tools on this device (a server never tested here: none yet)
  const serverTools = server ? (serverRows().find((r) => r.name === server)?.reads.length ?? 0) : 0
  const brake = status === 'plan' && outcome?.kind === 'brake' && !brakeDone ? outcome.error : null

  return (
    <section ref={plateRef} className="screw-plate orp" aria-labelledby={hid} data-status={status ?? undefined} data-testid="order-plate">
      <Screws seed={rowId} />
      <header className="orp-head">
        <h2 id={hid} className="label orp-code" tabIndex={-1}>
          § {t('features.coding.order.plate.title')} · {code} · {t('features.coding.order.plate.planner')}
        </h2>
        <span className="orp-status" role="status" data-testid="order-status">
          <Led state={status ? STATUS_LED[status] : 'off'} />
          <span className="label">{status ? t(`features.coding.order.status.${status}`) : '—'}</span>
          {chip && (
            <span className="orp-chip label" data-chip={chip} data-testid="order-chip">
              {t(`features.coding.order.chip.${chip}`)}
            </span>
          )}
          <HelpLink id="workorders" topic={t('features.coding.order.db')} />
          {!viewer && <OrderSettingsKey rowId={rowId} />}
        </span>
      </header>
      <dl className="orp-lamps">
        <Lamp name={t('features.coding.order.lamp.coding')} led={coding.enabled ? 'ok' : 'off'} text={t(coding.enabled ? 'features.coding.order.lamp.on' : 'features.coding.order.lamp.off')} testId="order-lamp-coding" />
        <Lamp
          name={t('features.coding.order.lamp.worker')}
          led={online ? (pre.ok || (pre.why !== 'outdated' && pre.why !== 'unsafe') ? 'ok' : 'on') : 'off'}
          text={online ? `${coding.worker?.name ?? ''} · ${coding.worker?.worker ?? ''}` : t(elsewhere ? 'features.coding.order.lamp.worker.elsewhere' : 'features.coding.order.lamp.worker.none')}
          testId="order-lamp-worker"
        />
        <Lamp
          name={t('features.coding.order.lamp.context')}
          led="ok"
          dim={!server}
          text={server ? (serverTools ? t('features.coding.order.lamp.context.tools', { server, n: serverTools }) : t('features.coding.order.lamp.context.read', { server })) : t('features.coding.order.lamp.context.none')}
          testId="order-lamp-context"
        />
        <Lamp name={t('features.coding.order.lamp.planner')} led={planner.led} text={planner.text} testId="order-lamp-planner" />
      </dl>
      {strip && !planningNow && (
        <div className="orp-strip" data-why={why} data-ended={ended && !brake ? '' : undefined} data-testid="order-pre">
          <p className="orp-strip__line">
            {line}
            {left && <span className="orp-strip__left"> {left}</span>}
          </p>
          {askedHere && (
            <p className="orp-strip__line orp-strip__ended" data-testid="order-asked">
              {t('features.coding.order.asked.line')}
            </p>
          )}
          {ended && !brake && (
            <p className="orp-strip__line orp-strip__ended" data-outcome={outcome?.kind} data-testid="order-outcome">
              {ended}
            </p>
          )}
          {ended && !brake && rule === 'member' && (
            <p className="orp-strip__line orp-strip__ended" data-testid="order-rule-member">
              {t('features.coding.order.why.ruleMember')}
            </p>
          )}
          {ended && !brake && rule === 'fix' && !viewer && <FixKeys fix={refusedErr!.fix} feature="terminal" />}
          {fix && <FixKey why={fix} />}
        </div>
      )}
      {planningNow && <PlanningPart rowId={rowId} viewer={viewer} />}
      {brake && !viewer && <PlanBrake rowId={rowId} error={brake} onDone={() => setBrakeDone(true)} />}
      {askOnly && rec?.draft && !planningNow && (
        <div className="orc" data-testid="order-ask">
          <p className="label orc-title">§ {t('features.coding.order.questions.title')}</p>
          {rec.draft.plan.summary && (
            <p className="orc-understood">
              <span className="label">{t('features.coding.order.plan.understood')}</span> {rec.draft.plan.summary}
            </p>
          )}
          {viewer ? (
            <ul className="orc-open">
              {rec.draft.plan.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          ) : (
            <QuestionsForm rowId={rowId} draft={rec.draft} />
          )}
        </div>
      )}
      {chainShown && rec && <ChainPart rowId={rowId} rec={rec} ready={ready} pre={pre} headId={hid} viewer={viewer} elsewhereHere={elsewhere} />}
      {remote && status && <RemotePart rowId={rowId} status={status} adopt={adopt} viewer={viewer} headId={hid} />}
      {!viewer && planKey && !(chainShown && chainState === 'draft') && !planningNow && (
        <div className="orp-keys" data-bar="">
          {planButton}
        </div>
      )}
    </section>
  )
}
