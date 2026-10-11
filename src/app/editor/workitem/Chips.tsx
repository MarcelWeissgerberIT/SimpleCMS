/**
 * Task block — the chip strip of the editor's placard (the static strip of exports / share links is PlacardChips):
 *   due · people · progress (2/4) · BLOCKS n / FREED n · n RELATED · ⧗ WAITING FOR [a chip per blocker] · ghost keys
 *   (+ DATE · + PERSON · + DEPENDS ON · + NOTE) — and the lock line while the task waits ("WAITING FOR 2 OF 3").
 *
 *  - Interactive (an editable page): every chip is a key (`tabIndex -1`: the keyboard path is Alt+Enter and the
 *    shortcuts — the editor keeps Tab). A chip opens its picker / list; a blocker chip opens the linked task's card
 *    (click, Enter — or the pointer resting on it for 350 ms); × on a blocker that is gone / in the trash / a loop
 *    removes the link. Read-only: the same chips as text (titles and states still from the index), no ghosts, no ×.
 *  - Blocker chips: an LED per blocker (open / in progress: lit; done: ok, the title struck), the title cut at 28
 *    characters (the full one in `title`), LOOP for an edge inside a loop; one that does not resolve says NOT
 *    AVAILABLE / IN TRASH / LOADING, never a title. The state is always in words for a screen reader.
 *  - Compact (a task in a list item): avatars only, "⧗ n" instead of the blocker chips, no ghosts, no lock line.
 * Before the index has the task (just made) the links show as counts ("Depends on 2").
 */
import { useRef, type ReactNode } from 'react'
import { ArrowRightFromLine, BellRing, CalendarDays, Hourglass, Link2, ListChecks, Lock, Plus, X } from 'lucide-react'
import { useT } from '../../i18n'
import type { ItemRef, ItemView } from '../../features/workitems'
import type { ItemPickerKind } from '../lib/bridge'
import type { WorkItemAttrs } from './attrs'
import { lateText, type PlacardModel } from './format'
import { oneLine } from './text'

const ICON = { size: 12, strokeWidth: 1.8, 'aria-hidden': true } as const
/** A blocker chip's title is cut here (the full title in its tooltip). */
const CHIP_TITLE = 28
/** The pointer rests this long on a blocker chip before its card opens. */
export const HOVER_MS = 350

export interface ChipsProps {
  model: PlacardModel
  attrs: WorkItemAttrs
  view: ItemView
  progress: { done: number; total: number } | null
  hasNotes: boolean
  interactive: boolean
  compact: boolean
  /** open a picker / list / card of this task */
  open?: (kind: ItemPickerKind, el: HTMLElement | null, extra?: { ref?: string; hover?: boolean }) => void
  /** the pointer left a blocker chip (a card it opened by resting may close) */
  leave?: () => void
  /** "+ NOTE": the first note line */
  onNote?: () => void
  /** × on a blocker chip */
  onUnlink?: (itemId: string) => void
}

const LED: Record<string, string> = { open: 'led led--on', in_progress: 'led led--on', done: 'led led--ok' }

/** A chip: a key while editing, else text. */
function Chip({ interactive, className, anchor, onClick, label, title, haspopup = true, children, extra }: { interactive: boolean; className: string; anchor?: string; onClick?: (el: HTMLElement) => void; label?: string; title?: string; haspopup?: boolean; children: ReactNode; extra?: Record<string, string | undefined> }) {
  if (!interactive || !onClick)
    return (
      <span className={className} data-wi-anchor={anchor} aria-label={label} title={title} role={label ? 'img' : undefined} {...extra}>
        {children}
      </span>
    )
  return (
    <button
      type="button"
      className={className}
      data-wi-anchor={anchor}
      aria-label={label}
      title={title}
      aria-haspopup={haspopup ? 'dialog' : undefined}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onClick(e.currentTarget)}
      {...extra}
    >
      {children}
    </button>
  )
}

function refWord(r: ItemRef, t: ReturnType<typeof useT>): string | null {
  if (r.state === 'gone') return t('editor.workItem.ref.gone')
  if (r.state === 'trash') return t('editor.workItem.ref.trash')
  if (r.state === 'loading') return t('editor.workItem.ref.loading')
  return null
}

/** The words a screen reader hears for a blocker chip. */
function refLabel(r: ItemRef, t: ReturnType<typeof useT>): string {
  const word = refWord(r, t)
  if (word) return t('editor.workItem.chip.waitingGone', { state: word })
  const state = r.state === 'loop' ? t('editor.workItem.ref.loop') : t(`editor.workItem.refState.${r.state}`)
  return t('editor.workItem.chip.waitingFor', { title: r.title || t('features.workItems.untitled'), state })
}

export function ItemChips({ model, attrs, view, progress, hasNotes, interactive, compact, open, leave, onNote, onUnlink }: ChipsProps) {
  const t = useT()
  const hoverTimer = useRef<number | undefined>(undefined)
  const done = model.status === 'done'
  const reminder = model.due?.reminder
  const blockers = view.blockers
  const dependents = view.dependents.length
  const related = view.related.length
  const go = (kind: ItemPickerKind, extra?: { ref?: string; hover?: boolean }) => (el: HTMLElement) => open?.(kind, el, extra)

  const chips: ReactNode[] = []
  if (model.due) {
    chips.push(
      <Chip key="due" interactive={interactive} className="workitem__chip workitem__chip--due" anchor="due" onClick={go('due')} title={t('editor.workItem.due', { date: model.due.text })} extra={{ 'data-late': model.due.late ? '' : undefined }}>
        <CalendarDays {...ICON} />
        <span className="visually-hidden">{t('editor.workItem.sr.due')} </span>
        {model.due.late && !compact && (
          <>
            <span>{lateText(model, t)}</span>
            <span className="workitem__dot" aria-hidden>
              ·
            </span>
          </>
        )}
        <span>{model.due.text}</span>
        {reminder !== null && reminder !== undefined && !compact && (
          <>
            <span className="workitem__dot" aria-hidden>
              ·
            </span>
            <span className="workitem__rem" title={reminder ? t('editor.workItem.reminder', { code: reminder }) : t('editor.workItem.reminderAt')}>
              <BellRing {...ICON} />
              {reminder ? (
                <>
                  <span className="visually-hidden">, {t('editor.workItem.sr.reminder')} </span>
                  {reminder}
                </>
              ) : (
                <span className="visually-hidden">, {t('editor.workItem.reminderAt')}</span>
              )}
            </span>
          </>
        )}
      </Chip>,
    )
  }
  if (model.people.length) chips.push(<span key="sr-people" className="visually-hidden">{t('editor.workItem.sr.people')}</span>)
  for (const p of model.people)
    chips.push(
      <Chip key={`p-${p.key}`} interactive={interactive} className="workitem__chip workitem__chip--person" anchor="people" onClick={go('people')} title={compact ? p.name : undefined}>
        <span className="workitem__avatar" style={{ background: `var(--c-${p.color}-bg)`, color: `var(--c-${p.color}-text)` }} aria-hidden>
          {p.initials}
        </span>
        {compact ? <span className="visually-hidden">{p.name}</span> : p.name}
      </Chip>,
    )
  if (progress && !compact) {
    const segs = Math.min(progress.total, 8)
    const lit = Math.round((progress.done / progress.total) * segs)
    chips.push(
      <span key="steps" className="workitem__chip workitem__chip--steps" role="img" aria-label={t('editor.workItem.chip.progress', { done: progress.done, total: progress.total })}>
        <ListChecks {...ICON} />
        <span aria-hidden>
          {progress.done}/{progress.total}
        </span>
        <span className="workitem__gauge" aria-hidden>
          {Array.from({ length: segs }, (_, i) => (
            <i key={i} data-on={i < lit ? '' : undefined} />
          ))}
        </span>
      </span>,
    )
  }
  if (dependents && view.indexed && !compact)
    chips.push(
      <Chip key="blocks" interactive={interactive} className="workitem__chip workitem__chip--blocks" anchor="dependents" onClick={go('dependents')}>
        <ArrowRightFromLine {...ICON} />
        {t(done ? 'editor.workItem.chip.freed' : 'editor.workItem.chip.blocks', { n: dependents })}
      </Chip>,
    )
  if (related && !compact)
    chips.push(
      <Chip key="related" interactive={interactive} className="workitem__chip workitem__chip--related" anchor="relatedList" onClick={view.indexed ? go('relatedList') : undefined}>
        <Link2 {...ICON} />
        {t('editor.workItem.related', { n: related })}
      </Chip>,
    )
  if (blockers.length) {
    if (!view.indexed) {
      // just made: the index has no titles for its links yet
      chips.push(
        <Chip key="blocked" interactive={false} className="workitem__chip workitem__chip--blocked">
          <Hourglass {...ICON} />
          {t('editor.workItem.blockedBy', { n: blockers.length })}
        </Chip>,
      )
    } else if (compact) {
      chips.push(
        <Chip key="wait" interactive={interactive} className="workitem__chip workitem__chip--wait" anchor="blockedBy" onClick={go('blockedBy')} label={t('editor.workItem.chip.waitingCount', { n: blockers.length })}>
          <Hourglass {...ICON} />
          <span aria-hidden>
            {t('editor.workItem.chip.waiting')} {blockers.length}
          </span>
        </Chip>,
      )
    } else {
      chips.push(<span key="sep" className="workitem__sep" aria-hidden />)
      chips.push(
        <Chip key="wait" interactive={interactive} className="workitem__lbl" anchor="blockedBy" onClick={go('blockedBy')} label={t('editor.workItem.chip.waitingEdit')}>
          <Hourglass {...ICON} />
          <span aria-hidden>{t('editor.workItem.chip.waiting')}</span>
        </Chip>,
      )
      for (const r of blockers) {
        const word = refWord(r, t)
        const title = r.title || t('features.workItems.untitled')
        const removable = interactive && !!onUnlink && (!!word || r.state === 'loop')
        chips.push(
          <span key={`b-${r.itemId}`} className="workitem__dep" data-state={r.state} data-done={r.state === 'done' ? '' : undefined}>
            <Chip
              interactive={interactive}
              className="workitem__chip workitem__chip--dep"
              anchor={`ref:${r.itemId}`}
              onClick={word ? undefined : go('ref', { ref: r.itemId })}
              label={refLabel(r, t)}
              title={word ? undefined : title}
              extra={{ 'data-state': r.state }}
            >
              {word ? (
                <span className="workitem__depword">{word}</span>
              ) : (
                <>
                  <span className={r.state === 'loop' ? 'led' : (LED[r.state] ?? 'led')} aria-hidden />
                  <span className="workitem__deptitle" aria-hidden>
                    {oneLine(title, CHIP_TITLE)}
                  </span>
                  {r.state === 'loop' && (
                    <span className="workitem__tag" aria-hidden>
                      {t('editor.workItem.ref.loop')}
                    </span>
                  )}
                </>
              )}
            </Chip>
            {removable && (
              <button type="button" className="workitem__unlink" aria-label={t('editor.workItem.ref.remove')} title={t('editor.workItem.ref.remove')} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => onUnlink!(r.itemId)}>
                <X size={11} strokeWidth={2} aria-hidden />
              </button>
            )}
          </span>,
        )
      }
    }
  }

  const ghosts: ReactNode[] = []
  if (interactive && !compact && !done) {
    if (!attrs.due) ghosts.push(<Ghost key="g-due" anchor="due" label={t('editor.workItem.ghost.due')} onClick={go('due')} />)
    // (ids that resolve to nobody are hidden: the ghost still offers to assign someone)
    if (!model.people.length) ghosts.push(<Ghost key="g-person" anchor="people" label={t('editor.workItem.ghost.person')} onClick={go('people')} />)
    if (!attrs.blockedBy.length) ghosts.push(<Ghost key="g-dep" anchor="blockedBy" label={t('editor.workItem.ghost.blockedBy')} onClick={go('blockedBy')} />)
    if (!hasNotes && onNote) ghosts.push(<Ghost key="g-note" label={t('editor.workItem.ghost.note')} onClick={() => onNote()} />)
  }
  if (!chips.length && !ghosts.length) return null
  // the pointer resting on a blocker chip opens its card (mouse only: touch taps it)
  const onOver = (e: React.PointerEvent) => {
    if (!interactive || e.pointerType !== 'mouse') return
    const el = (e.target as Element).closest<HTMLElement>('.workitem__chip--dep[data-wi-anchor]')
    const id = el?.getAttribute('data-wi-anchor')?.slice(4)
    window.clearTimeout(hoverTimer.current)
    if (!el || !id || el.getAttribute('data-state') === 'gone' || el.getAttribute('data-state') === 'trash' || el.getAttribute('data-state') === 'loading') return
    hoverTimer.current = window.setTimeout(() => open?.('ref', el, { ref: id, hover: true }), HOVER_MS)
  }
  const onOut = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const to = e.relatedTarget as Element | null
    if (to && (e.currentTarget as Element).contains(to) && to.closest('.workitem__chip--dep')) return
    window.clearTimeout(hoverTimer.current)
    leave?.()
  }
  return (
    <div
      className="workitem__chips"
      contentEditable={false}
      role="group"
      aria-label={t('editor.workItem.fields')}
      data-ghosts-only={chips.length ? undefined : ''}
      onPointerOver={blockers.length ? onOver : undefined}
      onPointerOut={blockers.length ? onOut : undefined}
    >
      {chips}
      {ghosts.length > 0 && <span className="workitem__ghosts">{ghosts}</span>}
    </div>
  )
}

function Ghost({ label, anchor, onClick }: { label: string; anchor?: string; onClick: (el: HTMLElement) => void }) {
  return (
    <button type="button" className="workitem__chip workitem__chip--ghost" data-wi-anchor={anchor} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={(e) => onClick(e.currentTarget)}>
      <Plus {...ICON} />
      {label}
    </button>
  )
}

/** "🔒 WAITING FOR 2 OF 3" — under the chips while the task waits (never on a compact task). */
export function LockLine({ open, total }: { open: number; total: number }) {
  const t = useT()
  return (
    <div className="workitem__lock" contentEditable={false}>
      <Lock size={12} strokeWidth={1.9} aria-hidden />
      <span>{t('editor.workItem.lock', { open, total })}</span>
    </div>
  )
}
