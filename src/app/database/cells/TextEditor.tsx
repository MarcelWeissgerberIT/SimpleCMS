/**
 * Overlay text editor that covers a cell (title, text, number, url, email, phone).
 * Enter commits (Shift+Enter = newline for text), Esc/outside click commit, Tab commits + moves.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popover } from '../../ui/Popover'
import type { PropertyDef } from '../../store/types'
import { useLang } from '../../i18n'

export type DoneReason = 'enter' | 'tab' | 'shiftTab' | 'escape' | 'outside'

export interface TextEditorProps {
  anchor: HTMLElement
  prop: PropertyDef
  value: string | number | null
  /** Initial text replacing the value (typing into a selected cell). */
  initialText?: string
  onCommit: (value: string | number | null, reason: DoneReason) => void
  minWidth?: number
}

export function parseNumberInput(s: string, percent = false): number | null {
  const pct = percent && /%\s*$/.test(s.trim())
  const clean = s.trim().replace(/\s/g, '').replace(/[€$£%]/g, '')
  if (!clean) return null
  // accept "1.234,5" (de) and "1,234.5" (en)
  let norm = clean
  if (/,\d{1,}$/.test(clean) && clean.includes('.')) norm = clean.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) norm = clean.replace(/,/g, '')
  else norm = clean.replace(',', '.')
  const n = Number(norm)
  if (!Number.isFinite(n)) return null
  // "50%" in a percent field means 0.5 (stored as a fraction, like Notion)
  return pct ? n / 100 : n
}

export function TextEditor({ anchor, prop, value, initialText, onCommit, minWidth = 240 }: TextEditorProps) {
  const lang = useLang()
  const isNumber = prop.type === 'number'
  const multiline = prop.type === 'text' || prop.type === 'title'
  const start = initialText ?? (value === null || value === undefined ? '' : isNumber && typeof value === 'number' ? (lang === 'de' ? String(value).replace('.', ',') : String(value)) : String(value))
  const [text, setText] = useState(start)
  const textRef = useRef(text)
  textRef.current = text
  const done = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const rect = anchor.getBoundingClientRect()

  const commit = (reason: DoneReason) => {
    if (done.current) return
    done.current = true
    const raw = textRef.current
    onCommit(isNumber ? parseNumberInput(raw, prop.numberFormat === 'percent') : prop.type === 'title' ? raw.replace(/\n/g, ' ') : raw, reason)
  }

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(320, Math.max(rect.height - 2, el.scrollHeight))}px`
  }, [text, rect.height])

  const escRef = useEscapeFlag()

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])

  return (
    <Popover
      open
      anchor={anchor}
      onClose={() => commit(escRef.current ? 'escape' : 'outside')}
      placement="bottom-start"
      offset={-rect.height}
      bare
      className="db-textedit"
      style={{ width: Math.max(minWidth, rect.width) }}
      autoFocus={false}
    >
      <textarea
        ref={areaRef}
        className={`db-textedit__area${isNumber ? ' is-number' : ''}${prop.type === 'title' ? ' is-title' : ''}`}
        value={text}
        rows={1}
        spellCheck={multiline}
        inputMode={isNumber ? 'decimal' : prop.type === 'email' ? 'email' : prop.type === 'phone' ? 'tel' : prop.type === 'url' ? 'url' : 'text'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !(e.shiftKey && prop.type === 'text')) {
            e.preventDefault()
            commit('enter')
          } else if (e.key === 'Tab') {
            e.preventDefault()
            commit(e.shiftKey ? 'shiftTab' : 'tab')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            commit('escape')
          }
        }}
      />
    </Popover>
  )
}

/** Put the caret after any pre-filled text (type-to-edit). */
export function caretToEnd(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const l = e.target.value.length
  e.target.setSelectionRange(l, l)
}

/** Popovers close on Escape before their content sees the key — remember that it was Escape. */
export function useEscapeFlag() {
  const escRef = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escRef.current = true
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return escRef
}
