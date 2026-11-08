import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { useT } from '../../../i18n'
import { shortcutLabel } from '../../../ui/controls'
import { lineColAt, lineStarts, type CodeAreaHandle } from '../../../ui/code'

import { scriptMatches } from './search'

/** Local to this editor: browser search elsewhere, no script execution from the find fields. */
export function EditorTools({ value, area, readOnly, prepare, children }: {
  value: string
  area: RefObject<CodeAreaHandle | null>
  readOnly: boolean
  prepare: () => void
  children: ReactNode
}) {
  const t = useT()
  const [mode, setMode] = useState<'find' | 'replace' | 'line' | null>(null)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [line, setLine] = useState('1')
  const input = useRef<HTMLInputElement | null>(null)
  const hits = useMemo(() => scriptMatches(value, query, matchCase), [value, query, matchCase])
  const starts = useMemo(() => lineStarts(value), [value])
  const lineNumber = Number(line)
  const validLine = /^\d+$/.test(line) && lineNumber >= 1 && lineNumber <= starts.length
  const label = (key: string) => t(`features.script.ed.${key}`)

  const open = (next: 'find' | 'replace' | 'line') => {
    prepare()
    const el = area.current?.textarea
    if (el) {
      const selected = el.value.slice(el.selectionStart, el.selectionEnd)
      if (next !== 'line' && selected && !selected.includes('\n')) setQuery(selected)
      if (next === 'line') setLine(String(lineColAt(starts, el.selectionStart).line))
    }
    setMode(next)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
  }
  const close = () => { setMode(null); area.current?.textarea?.focus() }
  const nextHit = (back = false) => {
    const el = area.current?.textarea
    if (!el || !hits.length) return null
    return back ? hits.findLast((h) => h.start < el.selectionStart) ?? hits[hits.length - 1] : hits.find((h) => h.start >= el.selectionEnd) ?? hits[0]
  }
  const show = (hit: { start: number; end: number }) => {
    prepare()
    const at = lineColAt(starts, hit.start)
    area.current?.reveal(at.line, at.col, hit.end - hit.start)
  }
  const navigate = (back = false) => { const hit = nextHit(back); if (hit) show(hit) }
  const replace = (all: boolean) => {
    const el = area.current?.textarea
    if (readOnly || !el || el.value !== value || !hits.length) return
    prepare()
    if (all) {
      // One native insertion = one undo step; replacement text is literal, including "$&".
      let end = 0
      let result = ''
      for (const hit of hits) { result += value.slice(end, hit.start) + replacement; end = hit.end }
      area.current?.insert(0, value.length, result + value.slice(end))
    } else {
      const hit = hits.find((h) => h.start === el.selectionStart && h.end === el.selectionEnd) ?? nextHit()
      if (hit) area.current?.insert(hit.start, hit.end, replacement)
    }
  }
  const go = () => { if (validLine) { area.current?.reveal(lineNumber, 1); setMode(null) } }

  return <div className="sc-editor" onKeyDownCapture={(e) => {
    if (e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey && ((!e.shiftKey && (k === 'f' || k === 'g')) || (e.shiftKey && k === 'h' && !readOnly))) {
      e.preventDefault(); e.stopPropagation(); open(k === 'g' ? 'line' : k === 'h' ? 'replace' : 'find')
    } else if (e.key === 'F3' && query) {
      e.preventDefault(); e.stopPropagation(); navigate(e.shiftKey)
    } else if (e.key === 'Escape' && mode) {
      e.preventDefault(); e.stopPropagation(); close()
    }
  }}>
    <div className="sc-editor__tools" role="group" aria-label={label('tools')}>
      <button type="button" className="btn btn--sm" onClick={() => open('find')} title={shortcutLabel('Mod+F')}><Search size={14} aria-hidden />{label('find')}</button>
      {!readOnly && <button type="button" className="btn btn--sm" onClick={() => open('replace')} title={shortcutLabel('Mod+Shift+H')}>{label('replace')}</button>}
      <button type="button" className="btn btn--sm" onClick={() => open('line')} title={shortcutLabel('Mod+G')}>{label('goLine')}</button>
    </div>
    {mode && <div className="sc-editor__search" role="search" aria-label={label(mode === 'line' ? 'goLine' : 'find')} onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (mode === 'line') go(); else navigate(e.shiftKey) }
    }}>
      <label className="sc-editor__field">{label(mode === 'line' ? 'line' : 'findText')}
        <input ref={input} className="input" value={mode === 'line' ? line : query} inputMode={mode === 'line' ? 'numeric' : 'text'} aria-invalid={mode === 'line' && !validLine || undefined} onChange={(e) => mode === 'line' ? setLine(e.target.value) : setQuery(e.target.value)} />
      </label>
      {mode === 'line' ? <>
        <span className="sc-note">{t('features.script.ed.lineRange', { n: starts.length })}</span>
        <button type="button" className="btn btn--sm" disabled={!validLine} onClick={go}>{label('go')}</button>
      </> : <>
        <button type="button" className="btn btn--sm" aria-pressed={matchCase} onClick={() => setMatchCase(!matchCase)}>{label('matchCase')}</button>
        <span className="sc-editor__count mono" role="status">{t('features.script.ed.matches', { n: hits.length })}</span>
        <button type="button" className="icon-btn" aria-label={label('previous')} disabled={!hits.length} onClick={() => navigate(true)}><ArrowUp size={16} /></button>
        <button type="button" className="icon-btn" aria-label={label('next')} disabled={!hits.length} onClick={() => navigate()}><ArrowDown size={16} /></button>
        {mode === 'replace' && !readOnly && <div className="sc-editor__replace">
          <label className="sc-editor__field">{label('replaceText')}<input className="input" value={replacement} onChange={(e) => setReplacement(e.target.value)} /></label>
          <button type="button" className="btn btn--sm" disabled={!hits.length} onClick={() => replace(false)}>{label('replaceOne')}</button>
          <button type="button" className="btn btn--sm" disabled={!hits.length} onClick={() => replace(true)}>{t('features.script.ed.replaceAll', { n: hits.length })}</button>
        </div>}
      </>}
      <button type="button" className="icon-btn sc-editor__close" aria-label={label('closeTools')} onClick={close}><X size={16} /></button>
    </div>}
    {children}
  </div>
}
