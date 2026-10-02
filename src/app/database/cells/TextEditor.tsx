/**
 * Overlay text editor that covers a cell (title, text, number, url, email, phone).
 * Enter commits (Shift+Enter = newline for text), Esc/outside click commit, Tab commits + moves.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popover } from '../../ui/Popover'
import type { PropertyDef } from '../../store/types'
import { useLang, useT } from '../../i18n'
import { parseNumberText } from '../model/format'
import { useWorkspace } from '../../store/store'

const currentLang = () => useWorkspace.getState().settings.language

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

/** Parse a typed / pasted number in the UI language (see parseNumberText). */
export function parseNumberInput(s: string, percent = false, lang: string = currentLang()): number | null {
  return parseNumberText(s, percent, lang)
}

/** Is this text something parseNumberInput can't read (and not just empty)? */
export function isBadNumber(s: string, lang?: string): boolean {
  return s.trim() !== '' && parseNumberInput(s, false, lang) === null
}

/** The editable text of a stored number: locale decimal mark, percent fields as "60%". */
function numberDraft(v: number, percent: boolean, lang: string): string {
  const shown = percent ? Number((v * 100).toPrecision(12)) : v
  const txt = String(shown)
  return (lang === 'de' ? txt.replace('.', ',') : txt) + (percent ? '%' : '')
}

export function TextEditor({ anchor, prop, value, initialText, onCommit, minWidth = 240 }: TextEditorProps) {
  const lang = useLang()
  const t = useT()
  const isNumber = prop.type === 'number'
  const multiline = prop.type === 'text' || prop.type === 'title'
  const percent = isNumber && prop.numberFormat === 'percent'
  const start = initialText ?? (value === null || value === undefined ? '' : isNumber && typeof value === 'number' ? numberDraft(value, percent, lang) : String(value))
  const [text, setText] = useState(start)
  const [invalid, setInvalid] = useState(false)
  const textRef = useRef(text)
  textRef.current = text
  const done = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const rect = anchor.getBoundingClientRect()

  const commit = (reason: DoneReason) => {
    if (done.current) return
    const raw = textRef.current
    if (isNumber && isBadNumber(raw, lang)) {
      // Enter / Tab on garbage: stay open and say so; leaving (Esc / click away) keeps the old value
      if (reason === 'enter' || reason === 'tab' || reason === 'shiftTab') {
        setInvalid(true)
        areaRef.current?.select()
        return
      }
      done.current = true
      onCommit(value, reason)
      return
    }
    done.current = true
    onCommit(isNumber ? parseNumberInput(raw, percent, lang) : prop.type === 'title' ? raw.replace(/\n/g, ' ') : raw, reason)
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
      className={`db-textedit${invalid ? ' is-invalid' : ''}`}
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
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value)
          if (invalid) setInvalid(false)
        }}
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
      {invalid && (
        <div className="db-textedit__err label" role="alert">
          {t('database.number.invalid')}
        </div>
      )}
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
