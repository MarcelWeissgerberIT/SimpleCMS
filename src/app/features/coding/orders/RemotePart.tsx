/**
 * The plate's chain part where this device holds no chain of the request (Orders B12, spec §3.10) — a team device
 * without the worker link, or the worker device a chain started elsewhere has not reached yet. It only DISPLAYS: what
 * the request's tasks themselves show (their Prüfauftrag relation, Schritt order, Stage — lamp.ts chainCarriers; display
 * fields, never what the engine follows), each step with a word beside its LED. Nothing here starts anything:
 *  - Planen: "Angefordert — das Gerät mit dem Worker zeigt „Hier planen“"
 *  - Kette bereit: the plan lives on the worker device ("dort prüfen und starten"); D Verwerfen (the Status → Entwurf,
 *    the person's write — the worker device drops its plan, Z in the toast brings both back)
 *  - Läuft: H Nach diesem Schritt anhalten (a Status write — works from every device; the worker device's chain halts)
 *  - Angehalten: ↵ Fortsetzen only on the device with the worker
 *  - the worker device without this chain (it was started elsewhere): "Kette bestätigen" in Preflight first
 * Keys with focus in the plate: H / D (never while typing, on a repeat or with a modifier).
 */
import { useEffect, useMemo, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID, OrderStatusKey } from '../../../store/types'
import { Led } from '../../../ui/controls'
import { typing } from '../../../ui/keys'
import { useT } from '../../../i18n'
import { codingProps, readPipeline, stageOfRow } from '../schema'
import { startStageOf } from '../stages'
import { chainCarriers, type ChainCarrier } from './lamp'
import { writeOrderStatus } from './db'
import { stepNo } from './words'

const O = 'features.coding.order'

type Lane = 'parked' | 'remote' | 'waiting' | 'done' | 'trashed'
const LANE_LED: Record<Lane, 'off' | 'on' | 'ok'> = { parked: 'off', remote: 'on', waiting: 'on', done: 'ok', trashed: 'off' }

/** A step as its task shows it here: the word beside the LED and the stage. */
function laneOf(id: ID): { lane: Lane; stage: string; title: string } {
  const s = useWorkspace.getState()
  const page = s.pages[id]
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page || page.trashed || !db) return { lane: 'trashed', stage: '', title: page?.title ?? '' }
  const pipeline = readPipeline(db)
  const props = codingProps(db)
  const stage = stageOfRow(pipeline, props, page)
  const repo = props.repo ? page.properties[props.repo] : null
  const lane: Lane = stage?.kind === 'done' ? 'done' : stage?.kind === 'gate' ? 'waiting' : stage?.id === startStageOf(pipeline, !!repo, false)?.id ? 'parked' : 'remote'
  return { lane, stage: stage?.name ?? '', title: page.title }
}

function Row({ c }: { c: ChainCarrier }) {
  const t = useT()
  const { lane, stage, title } = laneOf(c.id)
  return (
    <li className="orc-row" data-lane={lane} data-step={c.id} data-testid="order-remote-row">
      <span className="orc-row__state">
        {lane === 'parked' || lane === 'trashed' ? <span className="orp-ring" aria-hidden /> : <Led state={LANE_LED[lane]} />}
        <span className="label">{t(`${O}.lane.${lane}`)}</span>
      </span>
      <span className="orc-row__n label">{c.n !== null ? stepNo(c.n) : '—'}</span>
      <a className="orc-row__title" href={`#/p/${c.id}`} title={title}>
        {title || '—'}
      </a>
      <span className="orc-row__stage label">{stage}</span>
    </li>
  )
}

export default function RemotePart({ rowId, status, adopt, viewer, headId }: { rowId: ID; status: OrderStatusKey; adopt: boolean; viewer: boolean; headId: string }) {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  // the tasks carrying the request — read again when the workspace's pages change (the plate is on one page)
  const pages = useWorkspace((s) => s.pages)
  const carriers = useMemo(() => (status === 'running' || status === 'halted' || status === 'done' ? chainCarriers(rowId) : []), [pages, rowId, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const focusHead = () => window.setTimeout(() => document.getElementById(headId)?.focus(), 0)
  const halt = () => {
    if (viewer) return
    void import('./chainKeys').then((m) => m.haltChain(rowId)).then(() => focusHead())
  }
  const discard = () => {
    if (viewer) return
    // the person's own Status write (the trigger's lane rule: D — its toast carries Z)
    writeOrderStatus(rowId, 'draft', { kind: 'you', via: 'ui' })
    focusHead()
  }
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || viewer) return
    if (typing(e.target as HTMLElement)) return
    const k = e.key.toLowerCase()
    if (k === 'h' && status === 'running' && !adopt) {
      e.preventDefault()
      halt()
    } else if (k === 'd' && status === 'ready') {
      e.preventDefault()
      discard()
    }
  }
  useEffect(() => {
    const plate = root.current?.closest('section')
    if (!plate) return
    const on = (e: Event) => keys.current(e as KeyboardEvent)
    plate.addEventListener('keydown', on)
    return () => plate.removeEventListener('keydown', on)
  }, [])

  const line = adopt ? t(`${O}.remote.adopt`) : t(`${O}.remote.${status === 'plan' ? 'asked' : status === 'ready' ? 'ready' : status === 'running' ? 'running' : status === 'halted' ? 'halted' : 'done'}`)
  return (
    <div className="orc" ref={root} data-testid="order-remote" data-status={status}>
      <p className="label orc-title">
        § {t(`${O}.remote.title`)}
        {carriers.length > 0 && ` · ${t(`${O}.plan.steps.${carriers.length === 1 ? 'one' : 'other'}`, { n: carriers.length })}`}
      </p>
      {carriers.length > 0 && (
        <ol className="orc-lane" data-testid="order-remote-chain">
          {carriers.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </ol>
      )}
      <p className={`orc-line${status === 'halted' || adopt ? ' orc-line--warn' : ''}`} data-testid="order-remote-line">
        {line}
      </p>
      {!viewer && !adopt && (status === 'running' || status === 'ready') && (
        <div className="orp-keys" data-bar="">
          {status === 'running' ? (
            <button type="button" className="btn btn--sm" onClick={halt} data-testid="order-halt">
              <span className="kbd" aria-hidden>
                H
              </span>
              {t(`${O}.key.haltAfter`)}
            </button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={discard} data-testid="order-discard">
              <span className="kbd" aria-hidden>
                D
              </span>
              <Trash2 size={13} strokeWidth={1.75} aria-hidden />
              {t(`${O}.key.discard`)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
