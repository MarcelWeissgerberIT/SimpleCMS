/**
 * The plate on a request's page (spec §1.4 — B4 SKELETON; B8 builds the plan's stations, the Laufleiste, the keys):
 * "§ PRÜFAUFTRAG · PA-12 · PLANER", screwed, between the row's properties and its body.
 *
 *  - the Status (a word beside its LED) and, in Planen, its sub-state chip: plant ◐ (the planner's run in this tab,
 *    runs.ts — from the press until it ends) · Rückfrage (the draft holds questions only) · Regler hält (the last run
 *    stopped at the Regler's line) · wartet auf Worker · abgelaufen (only while this tab still holds a press that aged
 *    past 24 h — a fresh read drops it, records.ts)
 *  - four lamps, 2×2 at phone width: CODING · WORKER · KONTEXT (dim "ohne Server" without one — never red) · PLANER
 *  - the precondition strip (§2.2 items 1–6, pre.ts): the first that fails, with its fix key — or the kept press
 *    ("Plant, sobald der Worker zurück ist (bis …)"), or "Bereit zum Planen" with the kinds not offered named; while
 *    the request stands in Planen, how the planner's last run here ended when it made no plan (its own words —
 *    text.ts outcomeText: AI not set up, an empty request, the gate's refusal, the Regler …)
 *  - ↵ Planen (a press of the allow-list, how 'plate'); viewers see no key
 */
import { useId } from 'react'
import { ArrowRight, Settings2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID, OrderStatusKey } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { Led, Screws } from '../../../ui/controls'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { useCoding } from '../state'
import { workerVerdict } from '../link'
import { openCodingSettings } from '../open'
import { ChangeReposButton } from '../SetupCard'
import { readOrderConfig } from './config'
import { orderCode, orderStatusKey } from './db'
import { orderPreNow, pressPlan, usePressNotes, wantLive } from './press'
import { useOrderRecord } from './records'
import { usePlannerRun } from './runs'
import { outcomeText, preWhyText, problemText, untilText } from './text'
import { ORDER_LIMITS } from './types'
import type { OrderPreWhy } from './pre'
import './orders.css'

type Chip = 'planning' | 'question' | 'regler' | 'worker' | 'expired' | null
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
  // re-render on the row, the database and the worker link
  useWorkspace((s) => s.pages[rowId])
  const db = useWorkspace((s) => (s.pages[rowId]?.databaseId ? s.databases[s.pages[rowId]!.databaseId!] : undefined))
  useWorkspace((s) => s.databases)
  const coding = useCoding()
  const viewer = useCloud((s) => s.readOnly)
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
  const asks = rec?.state === 'draft' && !!rec.draft && !rec.draft.plan.steps.length
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
  let why: OrderPreWhy | 'ok' | 'later' | 'expired' | 'viewer' | 'unreadable'
  if (viewer) {
    why = 'viewer'
    line = t('features.coding.order.pre.viewer')
  } else if (unreadable) {
    why = 'unreadable'
    line = t('features.coding.order.why.unreadable')
  } else if (status === 'plan' && waiting) {
    why = 'later'
    line = `${t('features.coding.order.why.later', { time: untilText(want.at + ORDER_LIMITS.wantMs) })}${pre.ok ? '' : ` · ${preWhyText(pre.why, pre.left)}`}`
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
  const fix = !pre.ok && why !== 'viewer' && why !== 'unreadable' ? pre.why : null

  return (
    <section className="screw-plate orp" aria-labelledby={hid} data-status={status ?? undefined} data-testid="order-plate">
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
        <Lamp name={t('features.coding.order.lamp.context')} led="ok" dim={!server} text={server ? t('features.coding.order.lamp.context.read', { server }) : t('features.coding.order.lamp.context.none')} testId="order-lamp-context" />
        <Lamp name={t('features.coding.order.lamp.planner')} led={planner.led} text={planner.text} testId="order-lamp-planner" />
      </dl>
      <div className="orp-strip" data-why={why} data-ended={ended ? '' : undefined} data-testid="order-pre">
        <p className="orp-strip__line">
          {line}
          {left && <span className="orp-strip__left"> {left}</span>}
        </p>
        {ended && (
          <p className="orp-strip__line orp-strip__ended" data-outcome={outcome?.kind} data-testid="order-outcome">
            {ended}
          </p>
        )}
        {fix && <FixKey why={fix} />}
      </div>
      {!viewer && (
        <div className="orp-keys">
          <button type="button" className="btn btn--primary btn--sm" disabled={running} title={running ? t('features.coding.order.why.running') : undefined} onClick={() => void pressPlan(rowId, 'plate')} data-testid="order-plan">
            <span className="kbd" aria-hidden>
              ↵
            </span>
            {t(why === 'expired' ? 'features.coding.order.key.planAgain' : 'features.coding.order.key.plan')}
          </button>
        </div>
      )}
    </section>
  )
}
