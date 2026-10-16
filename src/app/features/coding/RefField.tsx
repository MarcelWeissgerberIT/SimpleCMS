/**
 * A coding text field that points at pages (the answer to Claude, the rework note, the new task's goal and criteria):
 * "@" or "one:" opens the page search — the editor's own (coding/pagePick.ts) — ↑ ↓ choose, ↵ or Tab take it, Esc
 * closes the list. The page goes in as "@Title", marked in the field; what is sent holds it as a One address
 * (refDraft.ts draftText), so its text goes to Claude Code with the task (coding/refs.ts). A pasted One address of a page
 * here goes in the same way; Backspace right after a page takes it out whole; Mod+↵ submits (`onSubmit`).
 */
import { forwardRef, Fragment, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { liveIds } from '../../editor'
import { parsePageAddress } from '../../lib/permalink'
import { useT } from '../../i18n'
import { insertPick, livePicks, pickEndingAt, retext, splice, triggerAt, type RefDraft } from './refDraft'
import { pickRows } from './pagePick'

export interface RefFieldHandle {
  focus: () => void
  /** a page into the text at the caret (the end when the field was never used); the field takes the focus */
  add: (page: { id: ID; title: string }) => void
}

export interface RefFieldProps {
  value: RefDraft
  onChange: (d: RefDraft) => void
  /** the task the field belongs to (left out of the search; "one:" starts next to it) — null: a task not made yet */
  near: ID | null
  /** may private pages be offered (coding/pagePick.ts privateAllowed) */
  allowPrivate: boolean
  rows?: number
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  autoFocus?: boolean
  /** classes for the textarea (its look: .input + the area's own) */
  className?: string
  'data-testid'?: string
  /** Mod+↵ */
  onSubmit?: () => void
}

/** Text metrics the drawn marks share with the textarea (copied from it: the area's CSS decides them). */
const SHARED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'] as const

export const RefField = forwardRef<RefFieldHandle, RefFieldProps>(function RefField(props, ref) {
  const { value, onChange, near, allowPrivate, rows = 2, placeholder, id, autoFocus, className, onSubmit } = props
  const t = useT()
  const ta = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const listId = useId()
  const [caret, setCaret] = useState(value.text.length)
  const caretRef = useRef(caret)
  caretRef.current = caret
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  /** the token whose list was closed with Esc (or a press outside) */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const trigger = useMemo(() => {
    if (!focused) return null
    const tr = triggerAt(value, caret)
    return tr && `${tr.from}:${value.text.slice(tr.from, tr.to)}` !== dismissed ? tr : null
  }, [value, caret, focused, dismissed])
  const opening = !!trigger
  // the live pages, once per opening (liveIds walks the workspace)
  const live = useMemo(() => (opening ? liveIds(useWorkspace.getState().pages) : null), [opening])
  const items = useMemo(() => (trigger && live ? pickRows(trigger, near, allowPrivate, live) : []), [trigger, live, near, allowPrivate])
  const open = !!trigger && items.length > 0
  useEffect(() => setActive(0), [trigger?.kind, trigger?.query])

  /** the caret after a change made here (React writes the value first) */
  const placeCaret = useCallback((pos: number) => {
    setCaret(pos)
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      el.setSelectionRange(pos, pos)
    })
  }, [])

  const put = useCallback(
    (from: number, to: number, page: { id: ID; title: string }) => {
      const { draft, caret: c } = insertPick(valueRef.current, from, to, { id: page.id, title: page.title.trim() || t('common.untitled') })
      onChange(draft)
      placeCaret(c)
    },
    [onChange, placeCaret, t],
  )

  useImperativeHandle(
    ref,
    () => ({
      focus: () => ta.current?.focus(),
      add: (page) => {
        const pos = Math.min(caretRef.current, valueRef.current.text.length)
        put(pos, pos, page)
      },
    }),
    [put],
  )

  const take = (i: number) => {
    const row = items[i]
    if (row && trigger) put(trigger.from, trigger.to, row.page)
  }

  // grow with the text: the drawn marks then never need to scroll along
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
    const m = mirror.current
    if (!m) return
    const cs = getComputedStyle(el)
    for (const k of SHARED) m.style[k] = cs[k]
  }, [value.text])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const noMods = !e.metaKey && !e.ctrlKey && !e.altKey
    if (open && noMods && !e.shiftKey) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = items.length
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        take(active)
        return
      }
    }
    // Esc while the list is open is the list's (Popover, capture): it closes the list only
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault()
      onSubmit()
      return
    }
    // Backspace right after a picked page: the whole reference goes
    if (e.key === 'Backspace' && noMods && !e.shiftKey) {
      const el = e.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const p = pickEndingAt(value, el.selectionStart)
      if (!p) return
      e.preventDefault()
      onChange(splice(value, p.at, p.at + p.label.length, ''))
      placeCaret(p.at)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // a One address of a page here (a permalink, `#/p/<id>`): in as "@Title" like a pick — a link to a block of it
    // (`?b=`) stays the pasted address (its page goes along all the same: coding/refs.ts reads it)
    const text = e.clipboardData.getData('text/plain').trim()
    const form = text ? parsePageAddress(text) : null
    if (form?.kind !== 'address' || form.block) return
    const { pages } = useWorkspace.getState()
    const page = pages[form.id]
    if (!page || page.id === near || isEffectivelyTrashed(pages, page.id) || inTemplate(pages, page.id) || (page.private && !allowPrivate)) return
    e.preventDefault()
    const el = e.currentTarget
    put(el.selectionStart, el.selectionEnd, page)
  }

  // the field's text with the picked pages marked (drawn over the textarea, which keeps the caret and the text)
  const marks = useMemo(() => {
    const out: ReactNode[] = []
    let at = 0
    for (const p of livePicks(value)) {
      out.push(value.text.slice(at, p.at), <mark key={`${p.id}-${p.at}`}>{p.label}</mark>)
      at = p.at + p.label.length
    }
    out.push(value.text.slice(at), '​')
    return out
  }, [value])

  return (
    <div className="cref" ref={setWrap}>
      <textarea
        ref={ta}
        id={id}
        className={`${className ?? 'input'} cref__input`}
        rows={rows}
        value={value.text}
        placeholder={placeholder}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        data-testid={props['data-testid']}
        onChange={(e) => {
          setDismissed(null)
          onChange(retext(value, e.target.value))
          setCaret(e.target.selectionStart)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop
        }}
      />
      <div ref={mirror} className="cref__marks" aria-hidden>
        {marks}
      </div>
      <Popover
        open={open}
        anchor={wrap}
        placement="bottom-start"
        offset={4}
        autoFocus={false}
        className="cref-menu"
        onClose={() => trigger && setDismissed(`${trigger.from}:${value.text.slice(trigger.from, trigger.to)}`)}
      >
        <div role="listbox" id={listId} aria-label={t('features.coding.pick.label')} onMouseDown={(e) => e.preventDefault()} data-testid="coding-pick">
          {items.map((r, i) => (
            <Fragment key={r.page.id}>
              {r.section && (i === 0 || items[i - 1]!.section !== r.section) && <div className="menu-section label">{t(`editor.ref.${r.section}`)}</div>}
              <div role="option" id={`${listId}-${i}`} aria-selected={i === active} data-active={i === active} className="menu-item" onMouseMove={() => i !== active && setActive(i)} onClick={() => take(i)}>
                <span className="menu-item__icon">
                  <PageIcon icon={r.page.icon} kind={r.page.kind} size={16} />
                </span>
                <span className="menu-item__label">{r.page.title.trim() || t('common.untitled')}</span>
                {r.hint && <span className="menu-item__hint" title={r.hint}>{r.hint}</span>}
              </div>
            </Fragment>
          ))}
          <div className="cref-menu__foot" aria-hidden>
            {t('features.coding.pick.keys')}
          </div>
        </div>
      </Popover>
    </div>
  )
})
