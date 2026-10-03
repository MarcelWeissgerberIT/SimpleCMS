import { createContext, useContext, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { AtSign, CornerDownRight } from 'lucide-react'
import type { Lang, Translate } from '@/shared/i18n'
import { PageIcon } from '../../ui/PageIcon'
import { canMove, type AgendaItem, type AgendaSource } from './model'
import { moveItem, openItem } from './actions'
import { fmtShortDay, fmtTime } from './format'

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface AgendaCtx {
  t: Translate
  lang: Lang
  today: number
  sources: Map<string, AgendaSource>
  /** day → pages created/edited, or null while the Activity source is hidden */
  activity: Map<number, number> | null
  openAdd: (day: number, anchor: Element, hour?: number) => void
  openMore: (day: number, anchor: Element) => void
}

const Ctx = createContext<AgendaCtx | null>(null)
export const AgendaProvider = Ctx.Provider
export function useAgenda(): AgendaCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAgenda outside <Agenda>')
  return c
}

export function sourceLabel(src: AgendaSource | undefined, t: Translate): string {
  if (!src) return ''
  if (src.kind === 'journal') return t('shell.agenda.source.journal')
  if (src.kind === 'mentions') return t('shell.agenda.source.mentions')
  if (src.kind === 'activity') return t('shell.agenda.source.activity')
  return src.label || t('common.untitled')
}

/** Accent of an item: its status/select colour, else its source's LED colour. */
export function accentOf(it: AgendaItem, src: AgendaSource | undefined): string {
  return it.color ? `var(--c-${it.color}-text)` : `var(--c-${src?.color ?? 'gray'}-text)`
}

export function itemLabel(it: AgendaItem, ctx: AgendaCtx): string {
  const src = ctx.sources.get(it.source)
  const parts = [it.title.trim() || ctx.t('common.untitled'), [sourceLabel(src, ctx.t), it.propName].filter(Boolean).join(' · ')]
  if (it.time) parts.push(fmtTime(it.time, ctx.lang))
  if (it.statusName) parts.push(it.statusName)
  else if (it.done) parts.push(ctx.t('shell.agenda.done'))
  return parts.filter(Boolean).join(', ')
}

/** Focus an item again after it moved (it re-renders under a new parent). */
function refocus(key: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(key)}"]`)?.focus())
}

/** Enter/Space open, Alt+←/→ move a day, Alt+↑/↓ move a week (database rows). */
export function itemKeyDown(it: AgendaItem) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openItem(it)
      return
    }
    if (!e.altKey || e.metaKey || e.ctrlKey || !canMove(it)) return
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    if (moveItem(it, d)) refocus(it.key)
  }
}

/* ------------------------------------------------------------------ */
/* Chip (month cells, week bars, popovers)                             */
/* ------------------------------------------------------------------ */

export function ItemChip({ it, overlay }: { it: AgendaItem; overlay?: boolean }) {
  const ctx = useAgenda()
  const src = ctx.sources.get(it.source)
  return (
    <span className="ag-chip" data-overlay={overlay || undefined} data-done={it.done || undefined} data-kind={it.kind} style={{ '--ag-accent': accentOf(it, src) } as CSSProperties}>
      {it.kind === 'mention' ? <AtSign size={11} strokeWidth={2} className="ag-chip__at" /> : it.icon ? <PageIcon icon={it.icon} kind={it.pageKind} size={12} /> : null}
      {it.time && <span className="ag-chip__time">{fmtTime(it.time, ctx.lang)}</span>}
      <span className="ag-chip__title" data-untitled={!it.title.trim() || undefined}>
        {it.title.trim() || ctx.t('common.untitled')}
      </span>
      <span className="led ag-chip__led" style={{ background: `var(--c-${src?.color ?? 'gray'}-text)` }} aria-hidden />
    </span>
  )
}

/** Clickable, focusable, draggable (rows) chip. `onGrab` reports the day under the pointer. */
export function DraggableItem({
  id,
  it,
  className,
  style,
  onGrab,
  children,
  data,
}: {
  id: string
  it: AgendaItem
  className: string
  style?: CSSProperties
  onGrab?: (e: React.PointerEvent<HTMLDivElement>) => void
  children: ReactNode
  data?: Record<string, string | boolean | undefined>
}) {
  const ctx = useAgenda()
  const movable = canMove(it)
  const { listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !movable })
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      data-dragging={isDragging || undefined}
      data-movable={movable || undefined}
      data-item-key={it.key}
      {...data}
      {...(movable ? listeners : {})}
      onPointerDownCapture={onGrab}
      role="button"
      tabIndex={0}
      aria-label={itemLabel(it, ctx)}
      onClick={() => openItem(it)}
      onKeyDown={itemKeyDown(it)}
    >
      {children}
    </div>
  )
}

export function useDroppableDay(id: string) {
  return useDroppable({ id })
}

/* ------------------------------------------------------------------ */
/* Drag & drop: move a row to another day                              */
/* ------------------------------------------------------------------ */

export function useAgendaDnd(items: AgendaItem[]) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [dragging, setDragging] = useState<AgendaItem | null>(null)
  const grab = useRef<{ key: string; day: number } | null>(null)
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])
  const keyOf = (id: unknown) => String(id).split('|')[0]
  return {
    dragging,
    setGrab: (key: string, day: number) => {
      grab.current = { key, day }
    },
    dndProps: {
      sensors,
      collisionDetection: pointerWithin,
      onDragStart: (e: DragStartEvent) => setDragging(byKey.get(keyOf(e.active.id)) ?? null),
      onDragCancel: () => setDragging(null),
      onDragEnd: (e: DragEndEvent) => {
        setDragging(null)
        const g = grab.current
        grab.current = null
        const it = byKey.get(keyOf(e.active.id))
        if (!e.over || !it) return
        const target = Number(String(e.over.id).split(':').pop())
        const from = g && g.key === it.key ? g.day : it.start
        if (Number.isFinite(target) && target !== from) moveItem(it, target - from)
      },
    },
  }
}

/* ------------------------------------------------------------------ */
/* List row (list view, narrow week, selected day)                     */
/* ------------------------------------------------------------------ */

export function ListRow({ it, day, overdue }: { it: AgendaItem; day: number; overdue?: boolean }) {
  const ctx = useAgenda()
  const { t, lang } = ctx
  const src = ctx.sources.get(it.source)
  const continued = it.start < day
  const time = overdue ? t('shell.agenda.due', { date: fmtShortDay(it.end, lang) }) : continued ? null : it.time ? fmtTime(it.time, lang) : t('shell.agenda.allDay')
  const endTime = !overdue && !continued && it.time && it.endTime && it.end === it.start ? fmtTime(it.endTime, lang) : null
  return (
    <DraggableItem
      id={`${it.key}|l${day}`}
      it={it}
      className="ag-row"
      style={{ '--ag-accent': accentOf(it, src) } as CSSProperties}
      data={{ 'data-done': it.done || undefined, 'data-overdue': overdue || undefined }}
    >
      <span className="ag-row__time">
        {continued ? (
          <span className="ag-row__cont">
            <CornerDownRight size={12} />
            {t('shell.agenda.since', { date: fmtShortDay(it.start, lang) })}
          </span>
        ) : (
          <>
            {time}
            {endTime && <span className="ag-row__endtime">–{endTime}</span>}
          </>
        )}
      </span>
      <span className="ag-row__body">
        <span className="ag-row__line">
          {it.kind === 'mention' ? <AtSign size={14} strokeWidth={1.8} className="ag-row__at" /> : <PageIcon icon={it.icon} kind={it.pageKind} size={16} />}
          <span className="ag-row__title" data-untitled={!it.title.trim() || undefined}>
            {it.title.trim() || t('common.untitled')}
          </span>
        </span>
        {it.excerpt && <span className="ag-row__excerpt">{it.excerpt}</span>}
      </span>
      <span className="ag-row__meta">
        {it.end > it.start && !overdue && <span className="ag-row__range">→ {fmtShortDay(it.end, lang)}</span>}
        {it.statusName && (
          <span className="tag ag-row__status" style={{ background: `var(--c-${it.color ?? 'gray'}-bg)`, color: `var(--c-${it.color ?? 'gray'}-text)` }}>
            {it.statusName}
          </span>
        )}
        <SourceTag src={src} propName={it.propName} />
      </span>
    </DraggableItem>
  )
}

export function SourceTag({ src, propName }: { src: AgendaSource | undefined; propName?: string | null }) {
  const { t } = useAgenda()
  if (!src) return null
  return (
    <span className="ag-srctag">
      <span className="led" style={{ background: `var(--c-${src.color}-text)` }} aria-hidden />
      <span className="ag-srctag__name">{sourceLabel(src, t)}</span>
      {propName && <span className="ag-srctag__prop">· {propName}</span>}
    </span>
  )
}
