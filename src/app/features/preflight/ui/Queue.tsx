/**
 * The queue under the plate (§7, mock 1; loaded on first use): "01 Queue — sorted by risk", a tab per lit lamp with a
 * queue (+ All), the bar (place, gauge, done today, Undo), the current card, the other cards as compact rows (clean
 * first, VON HAND next), ANGESTAUBT at the end, the bulk sheet ⇧A shows first, the key legend and a polite live region.
 * Keys only with focus inside this section (never while typing); Esc goes back to the lamp's cap.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Hand, Undo2 } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { restoreFocus } from '../../../ui/focus'
import { ackLamps } from '../engine'
import { isLit } from '../lamps'
import { usePreflight } from '../state'
import { noteShownTab, useQueue, type QueueTab } from '../queue/state'
import { gauge, position, ROWS_MAX, staleSpan, undoTarget } from '../queue/model'
import { onQueueKey } from '../queue/keys'
import { actionsOf, bulkApply, bulkDiscardStale, cancelConfirm, closeBulk, confirmBulk, focusCard, loadAll, move, openTest, runAction, setCurrent, shownTab, syncTab, tabItems, undoLast, itemOf } from '../queue/run'
import { fmtCount } from '../lamps'
import { fmtWhen } from '../format'
import { tn } from '../sources/util'
import { rowKey, titleOf } from '../sources/proposals/common'
import { useCoarsePointer } from '../touch'
import type { QueueItem } from '../registry'
import type { DoneEntry, LampView } from '../types'
import { Card } from './Card'
import { builtInBody } from './bodies'
import { miniClass } from './Cap'

const pad = (n: number) => String(n).padStart(2, '0')

/** "#NL-201" or the title or the kind word — read live. */
export function labelOf(item: Pick<QueueItem, 'keyText' | 'title' | 'kind'> | null, t: (k: string) => string, kind = 'proposal'): string {
  if (item?.keyText) return `#${item.keyText}`
  if (item?.title) return item.title
  return t(`features.preflight.kind.${item?.kind ?? kind}`)
}

function Tabs({ tab, views }: { tab: QueueTab; views: LampView[] }) {
  const t = useT()
  const lamps = views.filter((v) => v.hasQueue && isLit(v.level))
  const total = lamps.reduce((n, v) => n + v.count, 0)
  const pick = (id: QueueTab) => useQueue.setState({ lamp: id, aside: id === 'all' ? null : id, confirm: null, input: null, bulk: null })
  return (
    <div className="pf-tabs" role="tablist" aria-label={t('features.preflight.queue.tabs')}>
      {lamps.map((v) => (
        <button key={v.id} type="button" role="tab" id={`pf-tab-${v.id}`} className="pf-tab" aria-selected={tab === v.id} aria-controls="pf-qpanel" tabIndex={tab === v.id ? 0 : -1} data-lamp={v.id} onClick={() => pick(v.id)}>
          <span className={miniClass(v.level)} aria-hidden />
          {v.short}
          <b>{fmtCount(v.count)}</b>
        </button>
      ))}
      <button type="button" role="tab" id="pf-tab-all" className="pf-tab" aria-selected={tab === 'all'} aria-controls="pf-qpanel" tabIndex={tab === 'all' ? 0 : -1} data-lamp="all" onClick={() => pick('all')}>
        {t('features.preflight.queue.all')}
        <b>{fmtCount(total)}</b>
      </button>
    </div>
  )
}

/** A done card's label now: its item while listed, else its row's key or page title, else the kind word. */
export function entryLabel(e: Pick<DoneEntry, 'id' | 'label'>, t: (k: string) => string): string {
  const it = itemOf(e.id)
  if (it && (it.keyText || it.title)) return labelOf(it, t)
  const page = e.label.refs.taskId ?? e.label.refs.pageId
  const key = rowKey(page)
  if (key) return `#${key}`
  return titleOf(page) || t(`features.preflight.kind.${e.label.kind}`)
}

function DoneList({ entries }: { entries: DoneEntry[] }) {
  const t = useT()
  const shown = entries.filter((e) => !e.undone).slice(-3)
  if (!shown.length) return null
  return (
    <span className="pf-qbar__done">
      <span className="label">{t('features.preflight.queue.done')}</span>
      {shown.map((e, i) => {
        const label = entryLabel(e, t)
        return (
          <span key={`${e.id}-${e.at}`}>
            {i > 0 ? ' · ' : ''}
            {e.outcome === 'discarded' ? <s>{label}</s> : label} {t(`features.preflight.queue.outcome.${e.outcome}`)}
          </span>
        )
      })}
    </span>
  )
}

function UndoKey() {
  const t = useT()
  const done = useQueue((s) => s.done)
  const target = undoTarget(done)
  const none = !target.length
  const final = !none && !target.some((e) => e.undo)
  const why = none ? t('features.preflight.queue.nothingToUndo') : final ? t('features.preflight.queue.notUndoable', { why: t(target[0].final ?? 'features.preflight.card.final.none') }) : undefined
  return (
    <button type="button" className="pf-undo" aria-disabled={none || final || undefined} title={why} aria-keyshortcuts="Z" data-testid="pf-undo" onClick={() => void undoLast()}>
      <Undo2 size={14} aria-hidden />
      {t('features.preflight.queue.undo')}
      <span className="kbd" aria-hidden>
        Z
      </span>
    </button>
  )
}

function Row({ item, n, onPick }: { item: QueueItem; n: number; onPick: () => void }) {
  const t = useT()
  const clean = !item.hand.length
  return (
    <button type="button" className="pf-qr" data-hand={clean ? undefined : ''} data-lamp={item.lamp} data-id={item.id} data-testid="pf-row" onClick={onPick}>
      <span className="pf-qr__no">{pad(n)}</span>
      <span className="pf-tag">{item.tag}</span>
      <span className="pf-qr__t">
        {item.keyText && <span className="pf-qr__k">#{item.keyText}</span>}
        {item.detail ? <b>{item.detail}</b> : null}
        {item.detail && item.title ? ' · ' : ''}
        {item.title}
      </span>
      <span className="pf-qr__r">
        {clean ? (
          <>
            <span className="led led--ok" aria-hidden />
            <span className="label">{t('features.preflight.risk.clean')}</span>
          </>
        ) : (
          <>
            <span className="label pf-wide">{t(`features.preflight.risk.why.${item.hand[0]}`)}</span>
            <span className="pf-hand">
              <Hand size={12} aria-hidden />
              {t('features.preflight.risk.hand')}
            </span>
          </>
        )}
      </span>
    </button>
  )
}

function Stale({ items, first, tab }: { items: QueueItem[]; first: number; tab: QueueTab }) {
  const t = useT()
  const lang = useLang()
  const span = staleSpan(items, Date.now())
  if (!span) return null
  const undoable = items.filter((i) => actionsOf(i).some((a) => a.key === 'd' && a.undoable)).length
  const range = items.length > 1 ? `${pad(first)}–${pad(first + items.length - 1)}` : pad(first)
  return (
    <div className="pf-stale" data-testid="pf-stale">
      <span className="pf-qr__no">{range}</span>
      <span className="pf-tag">{t('features.preflight.stale.tag')}</span>
      <button type="button" className="pf-stale__t" onClick={() => setCurrent(tab, items[0].id)}>
        {t('features.preflight.stale.text', { n: span.n, a: span.minDays, b: span.maxDays, from: fmtWhen(span.from, Date.now(), lang), to: fmtWhen(span.to, Date.now(), lang) })}
      </button>
      {undoable > 0 ? (
        <button type="button" className="btn pf-key" aria-keyshortcuts="X" onClick={() => bulkDiscardStale(tab)}>
          <span className="kbd" aria-hidden>
            X
          </span>
          {t('features.preflight.stale.discardAll', { n: undoable })}
        </button>
      ) : (
        <span className="label">{t('features.preflight.stale.oneByOne')}</span>
      )}
    </div>
  )
}

/** ⇧A found clean cards not yet shown in full: each in full here first; ↵ on the key applies them all. */
function BulkSheet({ ids }: { ids: string[] }) {
  const t = useT()
  const key = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    key.current?.focus()
  }, [])
  const items = ids.map((id) => itemOf(id)).filter((x): x is QueueItem => !!x)
  return (
    <section className="pf-bulk" aria-label={t('features.preflight.queue.bulkTitle')} data-testid="pf-bulk">
      <p className="pf-bulk__head">
        <span className="label">{t('features.preflight.queue.bulkTitle')}</span>
        {tn('features.preflight.queue.bulkNote', items.length)}
      </p>
      <ol className="pf-bulk__list">
        {items.map((it) => {
          const Body = builtInBody(it.kind)
          return (
            <li key={it.id} className="pf-bulk__item" data-id={it.id}>
              <p className="pf-bulk__t">
                <span className="pf-tag">{it.tag}</span> {labelOf(it, t)} {it.keyText && it.title ? `· ${it.title}` : ''}
              </p>
              {Body && <Body item={it} expanded />}
            </li>
          )
        })}
      </ol>
      <div className="pf-bulk__keys">
        <button ref={key} type="button" className="btn btn--primary pf-key" data-testid="pf-bulk-apply" onClick={() => confirmBulk()}>
          {tn('features.preflight.queue.bulkApply', items.length)}
          <span className="kbd" aria-hidden>
            ↵
          </span>
        </button>
        <button type="button" className="btn pf-key" onClick={() => closeBulk()}>
          {t('common.cancel')}
          <span className="kbd" aria-hidden>
            Esc
          </span>
        </button>
      </div>
    </section>
  )
}

function Legend() {
  const t = useT()
  const k = (x: string) => (
    <span className="kbd" aria-hidden>
      {x}
    </span>
  )
  return (
    <div className="pf-legend" aria-hidden>
      <span>
        {k('A')}
        {t('features.preflight.legend.apply')}
      </span>
      <span>
        {k('D')}
        {t('features.preflight.legend.discard')}
      </span>
      <span>
        {k('E')}
        {t('features.preflight.legend.diff')}
      </span>
      <span>
        {k('⇧')}
        {k('A')}
        {t('features.preflight.legend.allClean')}
      </span>
      <span>
        {k('Z')}
        {t('features.preflight.legend.undo')}
      </span>
      <span>
        {k('Esc')}
        {t('features.preflight.legend.back')}
      </span>
      <span className="label">{t('features.preflight.legend.focusOnly')}</span>
    </div>
  )
}

export default function Queue() {
  const t = useT()
  const coarse = useCoarsePointer()
  const views = usePreflight((s) => s.views)
  const picked = useQueue((s) => s.lamp)
  const items = useQueue((s) => s.items)
  const order = useQueue((s) => s.order)
  const card = useQueue((s) => s.card)
  const done = useQueue((s) => s.done)
  const tombstones = useQueue((s) => s.tombstones)
  const leaving = useQueue((s) => s.leaving)
  const bulk = useQueue((s) => s.bulk)
  const busy = useQueue((s) => s.busy)
  const live = useQueue((s) => s.live)
  const pendingFocus = useQueue((s) => s.pendingFocus)
  const section = useRef<HTMLElement>(null)
  const tab = shownTab(picked)

  // the cards of every lit lamp, read again whenever a reading changes
  const key = views
    .filter((v) => v.hasQueue && isLit(v.level))
    .map((v) => `${v.id}:${v.idsHash}`)
    .join(',')
  useEffect(() => {
    loadAll()
  }, [key])

  // the tab's order (arrivals at their risk place) and its current card
  useEffect(() => {
    if (tab) syncTab(tab)
  }, [tab, items])

  // the agents area holds its "has N proposals" toast back while the proposals are on screen
  useEffect(() => {
    noteShownTab(tab)
    return () => noteShownTab(null)
  }, [tab])

  // ↵ on a lamp: the card takes the keyboard once it is there
  useEffect(() => {
    if (pendingFocus !== 'card' || !tab) return
    if (!card[tab] && (items[tab === 'all' ? '' : tab] === undefined)) return
    useQueue.setState({ pendingFocus: null })
    focusCard()
  }, [pendingFocus, tab, card, items])

  // arrivals while the lamp's queue holds focus (and the tab is visible) are acknowledged (L12)
  useEffect(() => {
    if (!tab || tab === 'all') return
    const v = views.find((x) => x.id === tab)
    if (!v?.isNew || document.visibilityState !== 'visible') return
    if (!section.current?.contains(document.activeElement)) return
    ackLamps([tab], 'open')
  }, [views, tab])

  const list = useMemo(() => (tab ? tabItems(tab, items) : []), [tab, items])
  if (!tab) return null
  const s = useQueue.getState()
  const isOpen = openTest(s)
  const ord = order[tab] ?? list.map((i) => i.id)
  const current = card[tab] ?? null
  // a card stays drawn while it leaves, while a key runs on it and as a tombstone
  const cur = current ? (list.find((i) => i.id === current) ?? (tombstones[current] || leaving[current] || busy === current ? itemOf(current) : null)) : null
  const pos = position(ord, current)
  const staleIds = new Set(list.filter((i) => i.stale).map((i) => i.id))
  const cells = gauge(ord, current, isOpen, (id) => staleIds.has(id))
  const rest = list.filter((i) => i.id !== current && isOpen(i.id))
  const rows = rest.filter((i) => !i.stale)
  const stale = rest.filter((i) => i.stale)
  const levelOf = (lamp: string) => views.find((v) => v.id === lamp)?.level ?? 'amber'
  const tabDone = done.filter((e) => tab === 'all' || e.lamp === tab)
  const numberOf = (id: string) => ord.indexOf(id) + 1

  return (
    <section
      ref={section}
      className="pf-q"
      aria-label={t('features.preflight.queue.title')}
      data-testid="pf-queue"
      onKeyDown={(e) =>
        onQueueKey(e, {
          move,
          key: (k) => {
            const it = cur && !tombstones[cur.id] ? cur : null
            if (it) runAction(it, k)
          },
          toggleDiff: () => {
            if (!current) return
            useQueue.setState((q) => {
              const expanded = { ...q.expanded }
              if (expanded[current]) delete expanded[current]
              else expanded[current] = true
              return { expanded }
            })
          },
          bulkApply: () => bulkApply(tab),
          discardStale: () => bulkDiscardStale(tab),
          undo: () => void undoLast(),
          escape: (target) => {
            const q = useQueue.getState()
            if (target.closest('.pf-input') || q.input) {
              useQueue.setState({ input: null })
              return focusCard()
            }
            if (q.confirm) return cancelConfirm()
            if (q.bulk) return closeBulk()
            // back to the plate: the lamp's cap (or the plate's first lit cap on "All")
            const cap = document.querySelector<HTMLElement>(tab === 'all' ? '.pf-cap[data-lit]' : `.pf-cap[data-lamp="${CSS.escape(tab)}"]`)
            if (cap) restoreFocus(cap)
          },
        })
      }
    >
      <div className="pf-sec label">
        <span className="pf-sec__n">01</span>
        <span>{t('features.preflight.queue.title')}</span>
        <span className="pf-sec__rule" aria-hidden />
        <span className="pf-hide-s">{t('features.preflight.queue.sorted')}</span>
      </div>
      <Tabs tab={tab} views={views} />
      <div className="pf-qbar">
        <span className="label pf-qbar__pos">
          {pos.i} / {pos.n}
        </span>
        <span className="pf-gauge" aria-hidden>
          {cells.map((c, i) => (
            <i key={i} className={c || undefined} />
          ))}
        </span>
        <DoneList entries={tabDone} />
        <span className="pf-sp" />
        <UndoKey />
        <span className="visually-hidden" role="status" aria-live="polite" data-testid="pf-live">
          {live}
        </span>
      </div>
      <div id="pf-qpanel" role="tabpanel" aria-labelledby={`pf-tab-${tab}`} className="pf-qpanel">
        {bulk && bulk.tab === tab ? (
          <BulkSheet ids={bulk.ids} />
        ) : cur ? (
          <Card key={cur.id} item={cur} index={numberOf(cur.id) || pos.i} total={ord.length} level={levelOf(cur.lamp)} />
        ) : (
          <p className="pf-q__empty">{t('features.preflight.queue.empty')}</p>
        )}
        {rows.length > 0 && (
          <div className="pf-qrows">
            {rows.slice(0, ROWS_MAX).map((it) => (
              <Row key={it.id} item={it} n={numberOf(it.id)} onPick={() => (setCurrent(tab, it.id), focusCard())} />
            ))}
            {rows.length > ROWS_MAX && <p className="pf-q__more label">{t('features.preflight.queue.more', { n: rows.length - ROWS_MAX })}</p>}
          </div>
        )}
        {stale.length > 0 && <Stale items={stale} first={numberOf(stale[0].id)} tab={tab} />}
      </div>
      {!coarse && <Legend />}
    </section>
  )
}
