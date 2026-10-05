/**
 * The context picker on a page: every top-level block gets a box in the left gutter, marked blocks a
 * signal rule, unmarked ones are dimmed (decorations, plugin.ts). The whole block is the hit target —
 * a click (or tap) toggles, Shift-click marks a range. Keyboard: ↑ ↓ / j k move the focus ring,
 * Space toggles, a = all, n = none, Enter = Done, Esc = cancel (the marks from before come back).
 * A slim fixed bar at the bottom of the page area reads out what Claude will read.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Check } from 'lucide-react'
import { Kbd } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import type { ID } from '../../store/types'
import { blockKey, countWords } from './read'
import { contextStore, endPicker, setPickerIds, type PickPurpose } from './store'
import './context.css'

interface Row {
  key: string
  top: number
  height: number
  label: string
  words: number
}

const subscribe = (fn: () => void) => contextStore.subscribe(fn)
const NO_IDS: string[] = []

/** Mounted with every page editor; shows only while the picker is open on this editor. */
export function ContextPicker({ editor, pageId }: { editor: Editor; pageId: ID }) {
  const active = useSyncExternalStore(subscribe, () => contextStore.getState().picker?.editor === editor)
  return active ? <PickerLayer editor={editor} pageId={pageId} /> : null
}

/** The nearest scrolling ancestor (the page area the bar sits at the bottom of). */
function scrollHost(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

function PickerLayer({ editor, pageId }: { editor: Editor; pageId: ID }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const layerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [focus, setFocus] = useState(0)
  const [kbd, setKbd] = useState(false)
  const anchor = useRef<number | null>(null)
  const ids = useSyncExternalStore(subscribe, () => contextStore.getState().picker?.ids ?? NO_IDS)
  const purpose: PickPurpose = useSyncExternalStore(subscribe, () => contextStore.getState().picker?.purpose ?? 'read')
  const on = new Set(ids)

  /* ---------- measuring: one row per top-level block, relative to .one-editor ---------- */
  const measure = useCallback(() => {
    const layer = layerRef.current
    const host = layer?.parentElement
    if (!layer || !host || editor.isDestroyed) return
    const base = host.getBoundingClientRect()
    const out: Row[] = []
    editor.state.doc.forEach((node, pos, i) => {
      const dom = editor.view.nodeDOM(pos)
      const r = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
      if (!r) return
      const text = node.textContent.replace(/\s+/g, ' ').trim()
      out.push({
        key: blockKey(node, i),
        top: r.top - base.top,
        height: Math.max(r.height, 8),
        label: text ? t('editor.ctx.blockOf', { n: i + 1, text: text.length > 80 ? `${text.slice(0, 79)}…` : text }) : t('editor.ctx.block', { n: i + 1 }),
        words: countWords(node.textBetween(0, node.content.size, '\n', ' ')),
      })
    })
    setRows(out)
  }, [editor, t])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(editor.view.dom)
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && requestAnimationFrame(measure)
    editor.on('transaction', onTx)
    window.addEventListener('resize', measure)
    // late layout (fonts, images, node views mounting): once more after a frame
    const raf = requestAnimationFrame(measure)
    return () => {
      ro.disconnect()
      editor.off('transaction', onTx)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(raf)
    }
  }, [editor, measure])

  // the keyboard comes here (typing in the page is paused)
  useEffect(() => {
    layerRef.current?.focus({ preventScroll: true })
  }, [])

  /* ---------- marking ---------- */
  const setIds = useCallback((next: Set<string>) => setPickerIds([...next]), [])

  const toggle = useCallback(
    (i: number, range = false) => {
      const row = rows[i]
      if (!row) return
      const next = new Set(contextStore.getState().picker?.ids ?? [])
      if (range && anchor.current !== null && rows[anchor.current]) {
        const value = next.has(rows[anchor.current].key)
        const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current]
        for (let k = a; k <= b; k++) {
          if (value) next.add(rows[k].key)
          else next.delete(rows[k].key)
        }
      } else {
        if (next.has(row.key)) next.delete(row.key)
        else next.add(row.key)
        anchor.current = i
      }
      setIds(next)
      setFocus(i)
    },
    [rows, setIds],
  )

  const all = useCallback(() => setIds(new Set(rows.map((r) => r.key))), [rows, setIds])
  const none = useCallback(() => setIds(new Set()), [setIds])
  const done = useCallback(() => {
    // only blocks that still exist count
    const live = new Set(rows.map((r) => r.key))
    endPicker(true, (contextStore.getState().picker?.ids ?? []).filter((id) => live.has(id)))
  }, [rows])
  const cancel = useCallback(() => endPicker(false), [])

  // the focus ring follows into view
  useEffect(() => {
    if (!kbd) return
    document.getElementById(`${uid}-${focus}`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, kbd, uid])

  /* ---------- keyboard (capture: before the page's and the shell's own keys) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const inLayer = !!target && !!layerRef.current?.contains(target)
      const inBar = !!target && !!barRef.current?.contains(target)
      // typing somewhere else (the AI terminal's prompt …) is left alone — Esc still cancels from the bar
      if (!inLayer && !inBar && target !== document.body) return
      const onButton = inBar && target?.tagName === 'BUTTON'
      const key = e.key
      let handled = true
      if (key === 'Escape') cancel()
      else if (onButton && (key === 'Enter' || key === ' ')) handled = false
      else if (key === 'ArrowDown' || key === 'j') {
        setKbd(true)
        setFocus((f) => Math.min(rows.length - 1, f + 1))
      } else if (key === 'ArrowUp' || key === 'k') {
        setKbd(true)
        setFocus((f) => Math.max(0, f - 1))
      } else if (key === 'Home') setFocus(0)
      else if (key === 'End') setFocus(Math.max(0, rows.length - 1))
      else if (key === ' ' || key === 'x') {
        setKbd(true)
        toggle(focus, e.shiftKey)
      } else if (key === 'a' || key === 'A') all()
      else if (key === 'n' || key === 'N') none()
      else if (key === 'Enter') done()
      else handled = false
      if (!handled) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rows.length, focus, toggle, all, none, done, cancel])

  /* ---------- readout ---------- */
  const marked = rows.filter((r) => on.has(r.key))
  const words = marked.reduce((n, r) => n + r.words, 0)
  const num = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  const head = t(purpose === 'redo' ? 'editor.ctx.redo' : 'editor.ctx.label')
  const unit = purpose === 'redo' ? 'editor.ctx.passages' : 'editor.ctx.blocks'
  const readout = marked.length
    ? `${head} · ${t(`${unit}.${marked.length === 1 ? 'one' : 'other'}`, { count: num(marked.length) })} · ${t(`editor.ctx.words.${words === 1 ? 'one' : 'other'}`, { count: num(words) })}`
    : `${head} · ${t(purpose === 'redo' ? 'editor.ctx.nothingRedo' : 'editor.ctx.nothing')}`
  // redo: the passages are numbered in document order (the review says "PASSAGE 2/5")
  const order = new Map(marked.map((r, i) => [r.key, i + 1]))

  return (
    <>
      <div
        ref={layerRef}
        className="ctx-layer"
        role="listbox"
        aria-multiselectable="true"
        aria-label={t(purpose === 'redo' ? 'editor.ctx.layerRedo' : 'editor.ctx.layer')}
        data-purpose={purpose}
        aria-activedescendant={rows[focus] ? `${uid}-${focus}` : undefined}
        tabIndex={0}
        data-kbd={kbd || undefined}
        data-testid="ctx-layer"
      >
        {rows.map((r, i) => (
          <div
            key={r.key}
            id={`${uid}-${i}`}
            role="option"
            aria-selected={on.has(r.key)}
            aria-label={r.label}
            className="ctx-row"
            data-on={on.has(r.key) || undefined}
            data-focus={i === focus || undefined}
            style={{ top: r.top, height: r.height } as CSSProperties}
            onMouseDown={(e) => {
              e.preventDefault()
              layerRef.current?.focus({ preventScroll: true })
            }}
            onClick={(e) => {
              setKbd(false)
              toggle(i, e.shiftKey)
            }}
          >
            <span className="ctx-row__box" aria-hidden>
              {on.has(r.key) && (purpose === 'redo' ? <span className="ctx-row__n">{order.get(r.key)}</span> : <Check size={12} strokeWidth={2.6} />)}
            </span>
            <span className="ctx-row__rule" aria-hidden />
          </div>
        ))}
      </div>
      <PickerBar barRef={barRef} editor={editor} purpose={purpose} readout={readout} count={marked.length} onAll={all} onNone={none} onDone={done} onCancel={cancel} />
    </>
  )
}

/** The slim fixed bar at the bottom of the page area. */
function PickerBar({
  barRef,
  editor,
  purpose,
  readout,
  count,
  onAll,
  onNone,
  onDone,
  onCancel,
}: {
  barRef: React.RefObject<HTMLDivElement | null>
  editor: Editor
  purpose: PickPurpose
  readout: string
  count: number
  onAll: () => void
  onNone: () => void
  onDone: () => void
  onCancel: () => void
}) {
  const t = useT()
  const [box, setBox] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    const host = scrollHost(editor.view.dom)
    const place = () => {
      const r = host?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
      const width = Math.min(r.width - 16, 720)
      setBox({ left: r.left + (r.width - width) / 2, width, bottom: Math.max(0, window.innerHeight - r.bottom) + 10 })
    }
    place()
    const ro = host ? new ResizeObserver(place) : null
    if (host) ro?.observe(host)
    window.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [editor])

  // a button press keeps the keyboard in the picker
  const press = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    fn()
  }

  if (!box) return null
  return createPortal(
    <div ref={barRef} className="ctx-bar" role="toolbar" aria-label={t(purpose === 'redo' ? 'editor.ctx.barRedo' : 'editor.ctx.bar')} style={box} data-purpose={purpose} data-testid="ctx-bar">
      <p className="ctx-bar__read label" aria-live="polite" title={t('editor.ctx.hint')}>
        <span className={`led${count ? ' led--on' : ''}`} aria-hidden />
        <span className="ctx-bar__count">{readout}</span>
      </p>
      <div className="ctx-bar__keys">
        <button type="button" className="btn btn--sm ctx-bar__key" onMouseDown={(e) => e.preventDefault()} onClick={press(onAll)}>
          {t('editor.ctx.all')} <Kbd>A</Kbd>
        </button>
        <button type="button" className="btn btn--sm ctx-bar__key" onMouseDown={(e) => e.preventDefault()} onClick={press(onNone)}>
          {t('editor.ctx.none')} <Kbd>N</Kbd>
        </button>
        <button type="button" className="btn btn--sm btn--ghost ctx-bar__key" onMouseDown={(e) => e.preventDefault()} onClick={press(onCancel)}>
          {t('editor.ctx.cancel')} <Kbd>esc</Kbd>
        </button>
        <button type="button" className="btn btn--sm btn--primary ctx-bar__key" onMouseDown={(e) => e.preventDefault()} onClick={press(onDone)}>
          {t('editor.ctx.done')} <Kbd>↵</Kbd>
        </button>
      </div>
    </div>,
    document.body,
  )
}
