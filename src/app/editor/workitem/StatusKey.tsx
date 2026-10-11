/**
 * Task block — the status key and its pickers.
 *
 *  - StatusKeys: the keycap holding the LED (a lock in a hatched key while the task waits for an open blocker) + the
 *    ⌄ caret key joined to it. Click: open / in progress → done, done → open; Alt-click: in progress ⇄ open (done →
 *    in progress). A blocked task asks once (the confirm). Read-only renders: the same keycap as an image, no ⌄.
 *  - StatusPicker: the ⌄ popover — a radiogroup (Open · In progress · Done; arrows move, Enter / a click picks; Esc
 *    leaves it as it was; a press outside takes a moved choice).
 *  - ConfirmPopover: "Still waiting for ‹Draft copy› — mark done anyway?" (Mark done focused: Enter confirms, Esc
 *    cancels).
 * Every write: `commitItem` (one transaction, one undo step, delta only); focus goes back to the task's title.
 */
import { useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { ChevronDown, Lock } from 'lucide-react'
import { Led } from '../../ui/controls'
import { Popover } from '../../ui/Popover'
import { onRovingKey } from '../../ui/roving'
import { focusIsNowhere } from '../../ui/focus'
import { useT } from '../../i18n'
import { useItemView } from '../../features/workitems'
import { WORK_ITEM_STATUSES, type WorkItemAttrs, type WorkItemStatus } from './attrs'
import { itemLookup } from './lookup'
import { focusTitleEnd, itemTargetAt, nextStatus, openItemPickerAt, setItemStatus } from './keys'
import type { PickerCtx } from './ItemPickers'

const LED: Record<WorkItemStatus, 'off' | 'on' | 'ok'> = { todo: 'off', in_progress: 'on', done: 'ok' }

export interface StatusKeysProps {
  editor: Editor
  getPos: () => number | undefined
  attrs: WorkItemAttrs
  /** open blockers (0: not blocked) */
  openBlockers: number
  interactive: boolean
  /** the status in words ("Open") */
  statusText: string
  /** read-only: why ("This page is locked") */
  readonlyWhy?: string | null
}

/** The status key (+ ⌄): a grid cell of the placard's head. */
export function StatusKeys({ editor, getPos, attrs, openBlockers, interactive, statusText, readonlyWhy }: StatusKeysProps) {
  const t = useT()
  const blocked = attrs.status !== 'done' && openBlockers > 0
  const glyph = blocked ? <Lock size={12} strokeWidth={2} aria-hidden /> : <Led state={LED[attrs.status]} />
  if (!interactive) {
    const label = t('editor.workItem.statusKey', { status: statusText })
    const title = readonlyWhy ? `${statusText} — ${readonlyWhy}` : statusText
    return (
      <span className="workitem__keys" contentEditable={false}>
        <span className="workitem__key" role="img" aria-label={readonlyWhy ? `${label} — ${readonlyWhy}` : label} title={title} data-wi-anchor="key">
          {glyph}
        </span>
      </span>
    )
  }
  const label = blocked
    ? openBlockers === 1
      ? t('editor.workItem.key.blocked.one')
      : t('editor.workItem.key.blocked', { n: openBlockers })
    : attrs.status === 'done'
      ? t('editor.workItem.key.toOpen')
      : t('editor.workItem.key.toDone', { status: statusText })
  const press = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const pos = getPos()
    if (typeof pos !== 'number' || editor.isDestroyed) return
    const target = itemTargetAt(editor, pos)
    setItemStatus(editor, pos, nextStatus(attrs.status, e.altKey), 'key')
    // nothing had the keyboard (a click while reading): writing goes on in this task — never pulls a phone's keyboard up
    const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
    if (target && !touch)
      requestAnimationFrame(() => {
        if (!editor.isDestroyed && focusIsNowhere()) focusTitleEnd(editor, target)
      })
  }
  return (
    <span className="workitem__keys" contentEditable={false}>
      <button
        type="button"
        className="workitem__key"
        aria-label={label}
        title={label}
        data-wi-anchor="key"
        // the editor keeps the keyboard and its caret (a click never moves either)
        onMouseDown={(e) => e.preventDefault()}
        onClick={press}
      >
        {glyph}
      </button>
      <button
        type="button"
        className="workitem__caret"
        aria-label={t('editor.workItem.caret')}
        title={t('editor.workItem.caret')}
        aria-haspopup="dialog"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const pos = getPos()
          if (typeof pos === 'number') openItemPickerAt(editor, pos, 'status', 'key')
        }}
      >
        <ChevronDown size={10} strokeWidth={2} aria-hidden />
      </button>
    </span>
  )
}

/** Pick a status in a picker: blocked + start / done → the confirm; the same status → nothing. */
function pickStatus(ctx: PickerCtx, status: WorkItemStatus) {
  const a = ctx.attrs
  if (status === a.status) return ctx.close()
  if (status !== 'todo' && a.status !== 'done' && itemLookup().openBlockers(a, ctx.pageId) > 0) return ctx.swap({ kind: 'confirm', status })
  ctx.commit({ status })
}

/** The ⌄ popover: a radiogroup of the three statuses. */
export function StatusPicker({ ctx }: { ctx: PickerCtx }) {
  const t = useT()
  const [draft, setDraft] = useState<WorkItemStatus>(ctx.attrs.status)
  const touched = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const label = t('editor.workItem.caret')
  const onClose = () => {
    if (ctx.escaped() || !touched.current) return ctx.close()
    pickStatus(ctx, draftRef.current)
  }
  return (
    <Popover open anchor={ctx.anchor} onClose={onClose} placement="bottom-start" offset={6} className="wi-pop wi-status" role="dialog" aria-label={label}>
      <div
        role="radiogroup"
        aria-label={label}
        className="wi-status__list"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pickStatus(ctx, draftRef.current)
            return
          }
          onRovingKey(e)
        }}
      >
        {WORK_ITEM_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={draft === s}
            tabIndex={draft === s ? 0 : -1}
            data-autofocus={draft === s ? '' : undefined}
            className="wi-status__opt"
            onClick={(e) => {
              touched.current = true
              setDraft(s)
              draftRef.current = s
              // a real press picks at once; the arrow keys only move the choice (Enter picks it)
              if (e.detail > 0) pickStatus(ctx, s)
            }}
          >
            <Led state={LED[s]} />
            <span>{t(`editor.workItem.status.${s}`)}</span>
          </button>
        ))}
      </div>
    </Popover>
  )
}

/** "Still waiting for … — mark done anyway?" at the key. */
export function ConfirmPopover({ ctx }: { ctx: PickerCtx }) {
  const t = useT()
  const id = useId()
  const view = useItemView(ctx.attrs, ctx.pageId)
  const open = view.blockers.filter((b) => b.state === 'open' || b.state === 'in_progress')
  const status = ctx.picker.status ?? 'done'
  const title = open[0]?.title || t('features.workItems.untitled')
  const start = status === 'in_progress'
  const text =
    open.length > 1 ? t(start ? 'editor.workItem.confirm.startMany' : 'editor.workItem.confirm.doneMany', { n: open.length }) : t(start ? 'editor.workItem.confirm.start' : 'editor.workItem.confirm.done', { title })
  return (
    <Popover open anchor={ctx.anchor} onClose={ctx.close} placement="bottom-start" offset={6} className="wi-pop wi-confirm" role="dialog" aria-labelledby={id}>
      <p id={id} className="wi-confirm__text">
        {text}
      </p>
      <div className="wi-confirm__keys">
        <button type="button" className="btn btn--ink btn--sm" data-autofocus onClick={() => ctx.commit({ status })}>
          {t(start ? 'editor.workItem.confirm.yesStart' : 'editor.workItem.confirm.yesDone')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={ctx.close}>
          {t('common.cancel')}
        </button>
      </div>
    </Popover>
  )
}
