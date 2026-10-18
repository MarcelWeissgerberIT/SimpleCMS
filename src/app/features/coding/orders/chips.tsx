/**
 * Work orders — chips on board cards (spec §1.1 / §1.8; database registerCardChip, installed at boot by trigger.ts):
 *  - a pipeline task that is a step of a chain on this device: "PA-12 · 2/3"; a parked one: "PA-12 · wartet auf 01"
 *    (the chain is this device's record — never the Prüfauftrag / Schritt fields, which only display);
 *  - a request on the work orders' board: in Planen its sub-state (plant ◐ · Rückfrage · Regler hält · wartet auf Worker ·
 *    abgelaufen — ↵ erneut · angefordert — a team: asked for from a device without the worker link, or on the worker
 *    device a request another device asked for, Orders B12); while its chain runs, where it waits for the person ("02 Coding · Review ●", "weiter mit
 *    02?") — computed, never a stored Status, so cards do not jump lanes at every gate.
 * Each chip reads its own stores; a card that is none of these renders nothing.
 */
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import type { Database, Page } from '../../../store/types'
import { useT } from '../../../i18n'
import { Led } from '../../../ui/controls'
import { registerCardChip } from '../../../database'
import { useCoding } from '../state'
import { workerVerdict } from '../link'
import { useCodingLocal, scope } from '../local'
import { codingProps, readPipeline, stageOfRow } from '../schema'
import { startStageOf } from '../stages'
import { orderCode, statusKeyOf } from './db'
import { useOrderRecords, orderScope } from './records'
import { usePlannerRun } from './runs'
import { useCloud } from '../../../cloud'
import { workerElsewhere } from './facts'
import { requestedElsewhere } from './team'
import { usePressNotes, wantLive } from './press'
import { useChainMoves } from './chainRun'
import { stepNo } from './words'
import type { OrderChain, OrderRecord } from './types'

const O = 'features.coding.order'
const PIPELINES = new Set(['coding', 'spec', 'qa'])

/** The chain on this device that holds a task, with the request's row (null: none). */
function chainOf(recs: Record<string, OrderRecord | null | 'unreadable'>, taskId: string): { row: string; chain: OrderChain } | null {
  const prefix = `${orderScope()}|`
  for (const [key, rec] of Object.entries(recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable' || !rec.chain) continue
    if (rec.state === 'draft' || rec.state === 'discarded') continue
    if (rec.chain.steps.some((s) => s.id === taskId)) return { row: key.slice(prefix.length), chain: rec.chain }
  }
  return null
}

function StepChip({ db, row }: { db: Database; row: Page }) {
  const t = useT()
  // shallow: the pair is new on every read, its parts are the stored ones
  const hit = useOrderRecords(useShallow((s) => chainOf(s.recs, row.id)))
  if (!hit) return null
  const steps = [...hit.chain.steps].sort((a, b) => a.n - b.n)
  const at = steps.findIndex((s) => s.id === row.id)
  const step = steps[at]!
  const id = orderCode(hit.row) ?? '—'
  const pipeline = readPipeline(db)
  const props = codingProps(db)
  const repo = props.repo ? row.properties[props.repo] : null
  const parked = hit.chain.advanced?.[step.n] === undefined && !hit.chain.skipped?.includes(step.n) && stageOfRow(pipeline, props, row)?.id === startStageOf(pipeline, !!repo, false)?.id
  const text = parked && at > 0 ? t(`${O}.chip.waitsFor`, { id, n: stepNo(steps[at - 1]!.n) }) : t(`${O}.chip.step`, { id, n: at + 1, total: steps.length })
  return (
    <div className="dbc-chip label" data-chip="chain" data-parked={parked ? '' : undefined} data-testid="order-card-chip">
      {text}
    </div>
  )
}

function RequestChip({ db, row }: { db: Database; row: Page }) {
  const t = useT()
  const status = statusKeyOf(db, row)
  const rec = useOrderRecords((s) => s.recs[`${orderScope()}|${row.id}`])
  const run = usePlannerRun(row.id)
  const note = usePressNotes((s) => s.notes[row.id] ?? null)
  const ok = useCoding((s) => workerVerdict(s) === 'ok')
  const team = useCloud((s) => s.active.kind === 'cloud')
  const away = useCoding((s) => workerElsewhere(s))
  const move = useChainMoves((s) => s.moves[row.id]?.move ?? null)
  // a running chain's step that waits for the person (a gate, a question, a failure — this device's run state)
  const local = useCodingLocal((s) => s.tasks)
  const pages = useWorkspace((s) => s.pages)
  const dbs = useWorkspace((s) => s.databases)
  const r = rec && rec !== 'unreadable' ? rec : null
  if (status === 'plan') {
    const outcome = run?.phase === 'done' ? run.outcome : undefined
    const planning = note?.why === 'planning' || (!!run && run.phase !== 'done')
    const want = r?.want
    const live = wantLive(want)
    const waiting = !!want && live && !ok
    // Orders B12 — a team: asked for on the worker device (here without the link), or asked for from another device
    const asked = team && (away || (ok && rec !== undefined && rec !== 'unreadable' && requestedElsewhere(r, row)))
    const chip = planning ? 'planning' : (outcome?.kind === 'held' || outcome?.kind === 'brake') && !waiting ? 'regler' : want && !live ? 'expired' : waiting ? 'worker' : r?.state === 'draft' && r.draft && !r.draft.plan.steps.length ? 'question' : asked ? 'asked' : null
    if (!chip) return null
    return (
      <div className="dbc-chip label" data-chip={chip} data-testid="order-card-chip">
        {chip === 'planning' && <Led state="on" />}
        {t(`${O}.chip.${chip}`)}
      </div>
    )
  }
  if (status !== 'running' || !r?.chain || r.state !== 'running') return null
  if (move?.kind === 'card')
    return (
      <div className="dbc-chip label" data-chip="next" data-testid="order-card-chip">
        <Led state="on" />
        {t(`${O}.chip.next`, { n: stepNo(move.step) })}
      </div>
    )
  const sc = scope()
  for (const st of [...r.chain.steps].sort((a, b) => a.n - b.n)) {
    const page = pages[st.id]
    const sdb = page?.databaseId ? dbs[page.databaseId] : undefined
    if (!page || !sdb) continue
    const stage = stageOfRow(readPipeline(sdb), codingProps(sdb), page)
    const state = local[`${sc}|${st.id}`]?.state
    const waits = stage?.kind === 'gate' || state === 'question' || state === 'failed'
    if (!waits || stage?.kind === 'done') continue
    return (
      <div className="dbc-chip label" data-chip="waiting" data-testid="order-card-chip">
        {t(`${O}.chip.waiting`, { n: stepNo(st.n), kind: t(`features.coding.pipe.${st.kind}`), stage: stage?.name ?? '' })}
        <Led state="on" />
      </div>
    )
  }
  return null
}

/** The card chip: a chain step on a pipeline board, a request on the work orders' board. */
export function OrderCardChip({ db, row }: { db: Database; row: Page }) {
  if (db.system === 'workorders') return <RequestChip db={db} row={row} />
  if (db.system && PIPELINES.has(db.system)) return <StepChip db={db} row={row} />
  return null
}

let installed = false
/** Register the chips (trigger.ts startOrders, at boot). */
export function installOrderChips(): void {
  if (installed) return
  installed = true
  registerCardChip(OrderCardChip)
}
