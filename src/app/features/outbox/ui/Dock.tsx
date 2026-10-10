/**
 * The Outbox dock on a database page: a 420 px column beside the page on wide screens (≥ 1200 px; per device
 * open / closed, localStorage `one.outbox.dock`), a sheet from the right below that, full screen on a phone. The
 * focused slip open; the others as strips (foreign ones folded into one "check one by one" strip); drafts running;
 * today's receipts; the key legend. Keys: J / K, H, E, R, ⌘↵, Esc (keys.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, ChevronRight, X } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { useT } from '../../../i18n'
import { isChanged, isClean, isForeign, isOpen, sentToday } from '../counts'
import { openOutbox, setDockOpen, useOutboxCounts, useSlips, useWideDock } from '../hooks'
import { onOutboxKey, focusSlipEl } from '../keys'
import { handBlock } from '../hand'
import { useOutbox } from '../store'
import type { Slip } from '../types'
import { Lid, ServerTag, ToolTarget, ForeignMark } from './parts'
import { ReceiptCard } from './ReceiptCard'
import { SlipCard, runCopy, runRedraft } from './Slip'

/** The order J / K walk and the dock lists: changed, ready, held, missing, unclear, failed — newest first in each. */
function rank(s: Slip): number {
  if (s.state === 'unclear') return 0
  if (isChanged(s)) return 1
  if (s.state === 'ready') return isForeign(s) ? 3 : 2
  if (s.state === 'missing') return 4
  if (s.state === 'held') return 5
  return 6
}

export function orderSlips(list: Slip[]): Slip[] {
  return list.filter(isOpen).sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)
}

function useStageHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setHost(document.querySelector<HTMLElement>('.app .stage')), [])
  return host
}

export default function Dock({ dbId }: { dbId: ID }) {
  const wide = useWideDock()
  const stage = useStageHost()
  const body = typeof document !== 'undefined' ? document.body : null
  const dock = <DockPanel dbId={dbId} mode={wide ? 'column' : 'sheet'} />
  const target = wide ? stage : body
  return target ? createPortal(dock, target) : null
}

function DockPanel({ dbId, mode }: { dbId: ID; mode: 'column' | 'sheet' }) {
  const t = useT()
  const title = useWorkspace((s) => s.pages[dbId]?.title.trim() || t('common.untitled'))
  const all = useSlips({ dbId })
  const counts = useOutboxCounts(dbId)
  const storage = useOutbox((s) => s.storage)
  const draftingAll = useOutbox((s) => s.drafting)
  const drafting = useMemo(() => Object.values(draftingAll).filter((d) => d.dbId === dbId), [draftingAll, dbId])
  const stored = useOutbox((s) => s.focus)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showForeign, setShowForeign] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLHeadingElement>(null)

  const open = useMemo(() => orderSlips(all), [all])
  const focus = open.find((s) => s.id === stored) ?? open[0] ?? null
  useEffect(() => setEditing(false), [focus?.id])
  const rest = open.filter((s) => s !== focus)
  const foreignFold = rest.filter((s) => s.state === 'ready' && isForeign(s) && !isChanged(s))
  const strips = showForeign ? rest : rest.filter((s) => !foreignFold.includes(s))
  const sent = all.filter((s) => sentToday(s)).sort((a, b) => (b.receipt?.at ?? 0) - (a.receipt?.at ?? 0))
  const order = open.map((s) => s.id)

  const setFocus = (id: string) => useOutbox.setState({ focus: id })
  const close = () => (mode === 'column' ? setDockOpen(false) : useOutbox.setState({ sheet: null }))
  const afterSent = () => {
    const next = open.find((s) => s.id !== focus?.id)
    if (next) {
      setFocus(next.id)
      focusSlipEl(next.id)
    } else headRef.current?.focus()
  }

  return (
    <aside
      ref={rootRef}
      className="obx-dock"
      data-mode={mode}
      aria-label={t('features.outbox.title')}
      data-testid="outbox-dock"
      onKeyDown={(e) =>
        onOutboxKey(e, {
          order,
          focus: focus?.id ?? null,
          setFocus,
          edit: () => focus && focus.state !== 'missing' && setEditing(true),
          redraft: () => focus?.draft && focus.draft.by !== 'person' && void runRedraft(focus, setBusy),
          copy: () => focus && !handBlock(focus) && void runCopy(focus),
          close,
        })
      }
    >
      <header className="obx-dock__head">
        <h2 className="display obx-dock__title" ref={headRef} tabIndex={-1}>
          {t('features.outbox.title')}
        </h2>
        <span className="obx-count" data-testid="outbox-dock-count" data-n={counts.open}>
          {t('features.outbox.open', { n: counts.open })}
        </span>
        <span className="obx-dbchip label" title={t('features.outbox.dbFilter', { db: title, n: counts.open })}>
          <span className="obx-dbchip__name">{title}</span>
          <span className="obx-dbchip__n">· {counts.open}</span>
        </span>
        <span className="obx-sp" />
        <button type="button" className="btn btn--ghost btn--sm obx-dock__all" title={t('features.outbox.allTitle')} onClick={() => openOutbox({ dbId })}>
          {t('features.outbox.all')}
          <ArrowUpRight size={13} aria-hidden />
        </button>
        <button type="button" className="icon-btn" aria-label={t('features.outbox.close')} onClick={close} data-testid="outbox-dock-close">
          <X size={16} />
        </button>
      </header>
      <div className="obx-dock__body">
        {!storage.ok && (
          <p className="obx-notice" role="alert" data-testid="outbox-storage">
            {t('features.outbox.block.storage')}
          </p>
        )}
        {drafting.map((d) => (
          <div key={d.key} className="obx-strip obx-strip--drafting" role="status">
            <span className="led led--on" aria-hidden />
            <span className="label">{d.step ? t('features.outbox.drafting.step', { n: d.step.n, of: d.step.of }) : t('features.outbox.drafting')}</span>
            <span className="obx-strip__t">
              {d.label} · #{d.rowKey}
            </span>
          </div>
        ))}
        {focus && <SlipCard key={focus.id} slip={focus} editing={editing} onEditing={setEditing} onSent={afterSent} />}
        {busy && <span className="visually-hidden" role="status">{t('features.outbox.drafting')}</span>}
        {strips.map((s) => (
          <Strip key={s.id} slip={s} onOpen={() => (setFocus(s.id), focusSlipEl(s.id))} />
        ))}
        {!showForeign && foreignFold.length > 0 && (
          <button type="button" className="obx-strip obx-strip--foreign" onClick={() => setShowForeign(true)} data-testid="outbox-foreign-fold">
            <ForeignMark />
            <span className="obx-strip__t">
              {t('features.outbox.strip.foreign')} · {foreignFold.map((s) => `#${s.target.key}`).join(' · ')}
            </span>
            <span className="obx-sp" />
            <span className="label obx-strip__go">
              {t('features.outbox.strip.check')}
              <ChevronRight size={13} aria-hidden />
            </span>
          </button>
        )}
        {!open.length && !drafting.length && <p className="obx-empty">{t('features.outbox.empty.db')}</p>}
        {sent.length > 0 && (
          <section className="obx-sent" aria-label={t('features.outbox.sent.head')}>
            <h3 className="obx-sent__head label">
              {t('features.outbox.sent.head')}
              <span className="obx-sent__rule" aria-hidden />
              <span>{String(Math.min(sent.length, 99)).padStart(2, '0')}</span>
            </h3>
            {sent.slice(0, 3).map((s) => (
              <ReceiptCard key={s.id} slip={s} />
            ))}
          </section>
        )}
      </div>
      <footer className="obx-dock__keys" aria-hidden>
        <span>
          <kbd className="kbd obx-fine">J</kbd>
          <kbd className="kbd obx-fine">K</kbd> {t('features.outbox.legend.slip')}
        </span>
        <span>
          <kbd className="kbd obx-fine">⌘↵</kbd> {t('features.outbox.legend.copy')}
        </span>
        <span>
          <kbd className="kbd obx-fine">H</kbd> {t('features.outbox.legend.hold')}
        </span>
        <span>
          <kbd className="kbd obx-fine">E</kbd> {t('features.outbox.legend.edit')}
        </span>
      </footer>
      {mode === 'sheet' && focus && <BottomBar slip={focus} />}
    </aside>
  )
}

function stripKind(s: Slip): 'changed' | 'held' | 'missing' | 'unclear' | 'clean' | 'foreign' | 'ready' {
  if (s.state === 'unclear') return 'unclear'
  if (isChanged(s)) return 'changed'
  if (s.state === 'held') return 'held'
  if (s.state === 'missing') return 'missing'
  if (isForeign(s)) return 'foreign'
  return isClean(s) ? 'clean' : 'ready'
}

function Strip({ slip, onOpen }: { slip: Slip; onOpen: () => void }) {
  const t = useT()
  const kind = stripKind(slip)
  return (
    <button type="button" className="obx-strip" data-kind={kind} onClick={onOpen} data-testid="outbox-strip" aria-label={`${t('features.outbox.act.focus')}: ${slip.title} · #${slip.target.key}`}>
      {kind === 'foreign' && <ForeignMark />}
      <ServerTag name={slip.target.serverName} />
      <ToolTarget slip={slip} />
      <span className="obx-strip__t" title={slip.title}>
        {slip.title}
      </span>
      <span className="obx-sp" />
      <span className="label obx-strip__state">
        <span className={kind === 'changed' || kind === 'held' ? 'led led--on' : kind === 'clean' ? 'led led--ok' : 'led'} aria-hidden />
        {t(`features.outbox.strip.${kind}`)}
      </span>
      <Lid />
    </button>
  )
}

/** Phone: Hold and Copy & open as words at the bottom of the sheet (or why not yet). */
function BottomBar({ slip }: { slip: Slip }) {
  const t = useT()
  const block = handBlock(slip)
  if (slip.state !== 'ready' && slip.state !== 'held') return null
  return (
    <div className="obx-bottombar">
      <button type="button" className="btn" onClick={() => void import('../actions').then((m) => m.toggleHold(slip.id))}>
        {slip.state === 'held' ? t('features.outbox.act.release') : t('features.outbox.act.hold')}
      </button>
      <button type="button" className="btn btn--primary" aria-disabled={!!block || undefined} onClick={() => !block && void runCopy(slip)}>
        {block === 'unseen' ? t('features.outbox.block.unseen') : t('features.outbox.hand.copy')}
      </button>
    </div>
  )
}
