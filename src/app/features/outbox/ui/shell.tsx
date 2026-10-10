/**
 * The Outbox in the shell — every number from outboxCounts, so they agree: the sidebar's badge, a database's tree
 * chip, the database page's readout, the status bar's cell; and the row page's strip (RowSlips). Light on purpose
 * (the dock and #/outbox load lazily).
 */
import { ArrowUpRight, Send } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { navigate } from '../../../lib/router'
import { useT } from '../../../i18n'
import { isChanged } from '../counts'
import { setDockOpen, showDock, openSlip, useDockOpen, useOutboxCounts, useSlips, useWideDock } from '../hooks'
import { useListRoutes, useRoutesFor } from '../routes'
import { useOutbox } from '../store'
import { openDraft } from './draftState'
import { OPEN_STATES, type Slip } from '../types'

const pad = (n: number) => (n > 99 ? '99+' : String(n).padStart(2, '0'))

/** Show the Outbox in the sidebar: a route is active here, or a slip exists. */
export function useOutboxVisible(): boolean {
  const routes = useListRoutes()
  const any = useOutbox((s) => Object.keys(s.slips).length > 0)
  return any || routes.length > 0
}

/** The sidebar's "5 OPEN" (red "UNCLEAR 1" when any). */
export function OutboxNavBadge() {
  const t = useT()
  const c = useOutboxCounts()
  if (c.unclear)
    return (
      <span className="sb-navrow__badge obx-badge obx-badge--red" data-testid="outbox-nav-badge">
        <span className="obx-led obx-led--red" aria-hidden />
        {t('features.outbox.unclear', { n: c.unclear })}
      </span>
    )
  if (!c.open) return null
  return (
    <span className="sb-navrow__badge obx-badge" data-testid="outbox-nav-badge" data-n={c.open}>
      {t('features.outbox.nav.badge', { n: c.open })}
    </span>
  )
}

/** A database's tree row: "✈ 5" while slips of it are open. */
export function OutboxTreeCount({ dbId }: { dbId: ID }) {
  const t = useT()
  const c = useOutboxCounts(dbId)
  if (!c.open) return null
  return (
    <span className="obx-treecount" data-testid="outbox-tree-count" data-n={c.open} title={c.open === 1 ? t('features.outbox.tree.one') : t('features.outbox.tree', { n: c.open })}>
      <Send size={11} strokeWidth={1.75} aria-hidden />
      {c.open}
      <span className="visually-hidden">{c.open === 1 ? t('features.outbox.tree.one') : t('features.outbox.tree', { n: c.open })}</span>
    </span>
  )
}

/** The status bar: "OUTBOX 5 · 1 CHANGED" (red with UNCLEAR). Nothing while nothing is open. */
export function OutboxStatusCell() {
  const t = useT()
  const c = useOutboxCounts()
  if (!c.open) return null
  return (
    <button type="button" className="status__cell status__btn obx-status" data-red={c.unclear > 0 || undefined} data-testid="outbox-status" data-n={c.open} title={t('features.outbox.status.title')} onClick={() => navigate({ name: 'outbox' })}>
      <span className={c.unclear ? 'obx-led obx-led--red' : c.changed ? 'led led--on' : 'led'} aria-hidden />
      {t('features.outbox.status', { n: c.open })}
      {c.unclear > 0 && <> · {t('features.outbox.status.unclear', { n: c.unclear })}</>}
      {!c.unclear && c.changed > 0 && <> · {t('features.outbox.status.changed', { n: c.changed })}</>}
    </button>
  )
}

/** Does a database page show the Outbox (routes on it, or slips of it)? */
export function useDbOutbox(dbId: ID): { routes: number; slips: number } {
  const routes = useRoutesFor(dbId)
  const slips = useOutbox((s) => Object.values(s.slips).filter((x) => x.target.dbId === dbId && x.state !== 'withdrawn').length)
  return { routes: routes.length, slips }
}

/** The database page's readout cells next to its title: IN OUTBOX 5 · SENT TODAY 3 (the first one opens the dock). */
export function OutboxReadout({ dbId }: { dbId: ID }) {
  const t = useT()
  const has = useDbOutbox(dbId)
  const c = useOutboxCounts(dbId)
  const wide = useWideDock()
  const open = useDockOpen()
  const sheet = useOutbox((s) => s.sheet === dbId)
  if (!has.routes && !has.slips) return null
  const shown = wide ? open : sheet
  return (
    <div className="obx-readout" data-testid="outbox-readout">
      <button
        type="button"
        className="obx-readout__cell obx-readout__btn"
        aria-pressed={shown}
        aria-label={`${t('features.outbox.readout.in')} ${c.open} — ${shown ? t('features.outbox.close') : t('features.outbox.openDock')}`}
        onClick={() => (wide ? setDockOpen(!open) : shown ? useOutbox.setState({ sheet: null }) : showDock(dbId))}
      >
        <Send size={12} strokeWidth={1.75} aria-hidden />
        <span className="label">{t('features.outbox.readout.in')}</span>
        <b data-testid="outbox-readout-open">{c.open}</b>
      </button>
      <span className="obx-readout__cell">
        <span className="label">{t('features.outbox.readout.sentToday')}</span>
        <b data-testid="outbox-readout-sent">{c.sentToday}</b>
      </span>
    </div>
  )
}

function stateWord(s: Slip): string {
  if (isChanged(s)) return 'changed'
  if (s.state === 'held') return 'held'
  if (s.state === 'missing') return 'missing'
  if (s.state === 'unclear') return 'unclear'
  return 'ready'
}

/** A row page: its open slips (compact) and a key per route. */
export function RowSlips({ pageId }: { pageId: ID }) {
  const t = useT()
  const dbId = useWorkspace((s) => s.pages[pageId]?.databaseId ?? null)
  const routes = useRoutesFor(dbId)
  const slips = useSlips({ rowId: pageId }).filter((s) => OPEN_STATES.includes(s.state))
  if (!dbId || (!routes.length && !slips.length)) return null
  return (
    <section className="obx-rowslips" aria-label={t('features.outbox.title')} data-testid="outbox-row">
      {slips.map((s) => {
        const w = stateWord(s)
        return (
          <button key={s.id} type="button" className="obx-rowslip" data-state={w} onClick={() => openSlip(s.id)}>
            <span className={w === 'changed' ? 'led led--on' : w === 'unclear' ? 'obx-led obx-led--red' : 'led'} aria-hidden />
            <span className="label">{t(`features.outbox.strip.${w}`)}</span>
            <span className="obx-rowslip__title">{s.title}</span>
            <span className="obx-rowslip__open">
              {t('features.outbox.row.open')}
              <ArrowUpRight size={12} aria-hidden />
            </span>
          </button>
        )
      })}
      {routes.length > 0 && (
        <div className="obx-rowslips__keys">
          <span className="label">{t('features.outbox.row.routes')}</span>
          {routes.map((r) => (
            <button key={`${r.ref.profileId}/${r.ref.routeId}`} type="button" className="btn btn--sm obx-routekey" onClick={(e) => openDraft({ dbId, route: r.ref, rowIds: [pageId], anchor: e.currentTarget })}>
              {r.label}
              <span className="obx-out">{t('features.outbox.routes.out')}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
