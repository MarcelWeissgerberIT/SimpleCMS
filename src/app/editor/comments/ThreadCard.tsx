/**
 * One comment thread: head (author · time · resolve · menu), quote (detached / sheet), body,
 * replies, reply composer (when focused). Data changes go through the store actions.
 */
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CornerDownLeft, MoreHorizontal, Pencil, RotateCcw, Trash2, LocateFixed } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useWorkspace } from '../../store/store'
import type { PageComment, PageCommentReply } from '../../store/types'
import { useLang, useT } from '../../i18n'

/** "2 min ago" / "vor 2 Min." — short and mechanical. */
export function relTime(ts: number, lang: string, nowLabel: string): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return nowLabel
  const rtf = new Intl.RelativeTimeFormat(lang === 'de' ? 'de' : 'en', { numeric: 'auto', style: 'short' })
  const m = Math.round(s / 60)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.round(m / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  const d = Math.round(h / 24)
  if (d < 7) return rtf.format(-d, 'day')
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(ts))
}

/* ---------------- composer ---------------- */

export interface ComposerProps {
  label: string
  placeholder: string
  submitLabel: string
  initial?: string
  autoFocus?: boolean
  /** Show Cancel (edits, the first comment of a thread). */
  onCancel?: () => void
  onSubmit: (text: string) => void
  onEmptyBlur?: () => void
}

export function Composer({ label, placeholder, submitLabel, initial = '', autoFocus, onCancel, onSubmit, onEmptyBlur }: ComposerProps) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }
  useEffect(fit, [value])
  useEffect(() => {
    if (!autoFocus) return
    const el = ref.current
    el?.focus({ preventScroll: true })
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [autoFocus])

  const submit = () => {
    const text = value.trim()
    if (!text) return
    onSubmit(text)
    setValue('')
  }
  return (
    <div className="ccomposer" ref={box}>
      <textarea
        ref={ref}
        className="ccomposer__field"
        value={value}
        rows={1}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            submit()
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        onBlur={(e) => {
          if (!onEmptyBlur || value.trim()) return
          if (box.current?.contains(e.relatedTarget as Node | null)) return
          onEmptyBlur()
        }}
      />
      {(onCancel || value.trim()) && (
        <div className="ccomposer__row">
          <span className="ccomposer__hint label" aria-hidden>
            <kbd className="kbd">↵</kbd> {t('editor.comments.send')} · <kbd className="kbd">⇧↵</kbd> {t('editor.comments.newLine')}
          </span>
          {onCancel && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
              {t('common.cancel')}
            </button>
          )}
          <button type="button" className="btn btn--primary btn--sm ccomposer__send" disabled={!value.trim()} onClick={submit}>
            {submitLabel}
            <CornerDownLeft size={12} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------- one entry (thread start or reply) ---------------- */

function Entry({ author, at, edited, body, editing, onEditDone, menu, children }: { author: string; at: number; edited: boolean; body: string; editing: boolean; onEditDone: (text: string | null) => void; menu?: ReactNode; children?: ReactNode }) {
  const t = useT()
  const lang = useLang()
  const name = author.trim() || t('editor.comments.you')
  return (
    <div className="centry">
      <div className="centry__head">
        <span className="centry__avatar" aria-hidden>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="centry__author">{name}</span>
        <span className="centry__time label" title={new Date(at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}>
          {relTime(at, lang, t('editor.comments.now'))}
          {edited ? ` · ${t('editor.comments.edited')}` : ''}
        </span>
        <span className="centry__tools">{children}{menu}</span>
      </div>
      {editing ? (
        <Composer label={t('editor.comments.editLabel')} placeholder={t('editor.comments.placeholder')} submitLabel={t('common.save')} initial={body} autoFocus onCancel={() => onEditDone(null)} onSubmit={(v) => onEditDone(v)} />
      ) : (
        <p className="centry__body">{body}</p>
      )}
    </div>
  )
}

function MoreButton({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const menu = useMenu()
  return (
    <>
      <button type="button" className="ctool" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <MoreHorizontal size={14} strokeWidth={1.75} />
      </button>
      <Menu {...menu.props} entries={entries} placement="bottom-end" width={200} />
    </>
  )
}

/* ---------------- thread card ---------------- */

export interface ThreadCardProps {
  pageId: string
  thread: PageComment
  active: boolean
  detached: boolean
  /** In a hidden tab / closed toggle: say so (the card sits at the block). */
  hidden?: boolean
  showQuote: boolean
  canEdit: boolean
  style?: React.CSSProperties
  onActivate: () => void
  onLocate?: () => void
  onDelete: () => void
}

export const ThreadCard = forwardRef<HTMLElement, ThreadCardProps>(function ThreadCard({ pageId, thread, active, detached, hidden, showQuote, canEdit, style, onActivate, onLocate, onDelete }, ref) {
  const t = useT()
  const [editing, setEditing] = useState<string | null>(null)
  const ws = useWorkspace.getState
  const replies: PageCommentReply[] = Array.isArray(thread.replies) ? thread.replies : []
  const author = thread.author.trim() || t('editor.comments.you')

  const threadMenu: MenuEntry[] = [
    ...(onLocate ? [{ label: t('editor.comments.locate'), icon: <LocateFixed size={15} />, disabled: detached, onSelect: onLocate }] : []),
    ...(canEdit
      ? [
          { label: t('editor.comments.edit'), icon: <Pencil size={15} />, onSelect: () => setEditing(thread.id) },
          { kind: 'separator' as const },
          { label: t('editor.comments.deleteThread'), icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
        ]
      : []),
  ]

  return (
    <article
      ref={ref}
      className={`ccard${active ? ' is-active' : ''}${thread.resolved ? ' is-resolved' : ''}${detached ? ' is-detached' : ''}`}
      style={style}
      data-thread-card={thread.id}
      aria-current={active || undefined}
      aria-label={t('editor.comments.threadBy', { author, quote: thread.quote.slice(0, 60) })}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!active && !(e.target as Element).closest('button, textarea, input, a')) onActivate()
      }}
      onFocus={() => !active && onActivate()}
    >
      {thread.resolved && (
        <div className="ccard__flag label">
          <span className="led led--ok" aria-hidden /> {t('editor.comments.resolvedFlag')}
        </div>
      )}
      {detached && (
        <div className="ccard__flag label">
          <span className="led" aria-hidden /> {t('editor.comments.detached')}
        </div>
      )}
      {hidden && !detached && (
        <div className="ccard__flag label">
          <span className="led" aria-hidden /> {t('editor.comments.hiddenAnchor')}
        </div>
      )}
      {(showQuote || detached) && thread.quote && <blockquote className="ccard__quote">{thread.quote}</blockquote>}
      <Entry
        author={thread.author}
        at={thread.createdAt}
        edited={thread.updatedAt - thread.createdAt > 1000}
        body={thread.body}
        editing={editing === thread.id}
        onEditDone={(v) => {
          setEditing(null)
          if (v !== null && v !== thread.body) ws().updateComment(pageId, thread.id, { body: v })
        }}
        menu={threadMenu.length > 0 && <MoreButton label={t('editor.comments.threadMenu')} entries={threadMenu} />}
      >
        {canEdit && (
          <button
            type="button"
            className="ctool"
            aria-label={t(thread.resolved ? 'editor.comments.reopen' : 'editor.comments.resolve')}
            title={t(thread.resolved ? 'editor.comments.reopen' : 'editor.comments.resolve')}
            onClick={() => ws().updateComment(pageId, thread.id, { resolved: !thread.resolved })}
          >
            {thread.resolved ? <RotateCcw size={14} strokeWidth={1.75} /> : <Check size={15} strokeWidth={1.9} />}
          </button>
        )}
      </Entry>
      {replies.length > 0 && (
        <ol className="ccard__replies" aria-label={t('editor.comments.replies', { count: replies.length })}>
          {replies.map((r) => (
            <li key={r.id}>
              <Entry
                author={r.author}
                at={r.createdAt}
                edited={r.updatedAt - r.createdAt > 1000}
                body={r.body}
                editing={editing === r.id}
                onEditDone={(v) => {
                  setEditing(null)
                  if (v !== null && v !== r.body) ws().updateCommentReply(pageId, thread.id, r.id, v)
                }}
                menu={
                  canEdit && (
                    <MoreButton
                      label={t('editor.comments.replyMenu')}
                      entries={[
                        { label: t('editor.comments.edit'), icon: <Pencil size={15} />, onSelect: () => setEditing(r.id) },
                        { label: t('editor.comments.deleteReply'), icon: <Trash2 size={15} />, danger: true, onSelect: () => ws().deleteCommentReply(pageId, thread.id, r.id) },
                      ]}
                    />
                  )
                }
              />
            </li>
          ))}
        </ol>
      )}
      {active && canEdit && !thread.resolved && (
        <Composer label={t('editor.comments.replyLabel')} placeholder={t('editor.comments.replyPlaceholder')} submitLabel={t('editor.comments.reply')} onSubmit={(v) => ws().addCommentReply(pageId, thread.id, v)} />
      )}
    </article>
  )
})
