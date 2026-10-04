/**
 * The cell grid: sticky column letters and row numbers, virtualised rows (only the visible ones
 * plus a margin are in the DOM), a frozen first row, selection / reference / dataset overlays,
 * the fill handle with its live preview, column resizing, the in-cell editor slot; on touch the
 * selection handles, the fill tab and the "⋯" key that opens the cell menu. Pointer and keyboard
 * decisions are the parent's.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Ellipsis } from 'lucide-react'
import type { ColorName } from '../../../store/types'
import { a1, colName, formatValue, isErr, type ErrorCode, type Rect, type Workbook } from '../engine'
import { autoAlign } from '../compute'
import { colWidth, ROW_HEIGHT, type SheetData } from '../model'
import type { Pos } from '../ops'

export const HEAD_H = 26
export const RH_W = 46
const OVERSCAN = 8

export interface Overlay {
  rect: Rect
  color: ColorName | 'signal'
  /** edit: a reference of the formula being edited · faint: of the selected cell · named: a saved dataset · sel: the selection */
  kind: 'edit' | 'faint' | 'named' | 'sel' | 'active'
  tag?: string
}

export type PointerPhase = 'down' | 'move' | 'up'

export type GridTarget = { kind: 'cell'; pos: Pos } | { kind: 'row'; index: number } | { kind: 'col'; index: number } | { kind: 'corner' }

/** The fill handle at the selection's bottom-right corner and the live preview of a fill drag. */
export interface FillView {
  /** the selection the handle sits on (null: no handle) */
  handle: Rect | null
  /** the range being filled (src ∪ extension) while dragging */
  preview: Rect | null
  /** which way the preview extends (where its tooltip goes) */
  dir: 'down' | 'up' | 'right' | 'left' | null
  /** "→ 12": the value at the far end */
  tip: string | null
  label: string
  onHandleDown: (e: React.PointerEvent<HTMLElement>) => void
  /** touch: a tab just outside the selection handle's corner instead of the small square */
  touch?: boolean
}

/** Touch: round handles on the selection's top-left and bottom-right corners, the "⋯" key by the latter. */
export interface HandlesView {
  rect: Rect
  onDown: (corner: 'tl' | 'br', e: React.PointerEvent<HTMLElement>) => void
  /** the "⋯" key: opens the cell menu */
  onMenu?: () => void
  menuLabel?: string
}

/**
 * The "⋯" key sits in a corner diagonal to the selection — the neighbours least often tapped
 * (directly below / right of the selection a finger enters the next value): below-right, right of
 * the fill tab; where that is out of view, below-left; where that is too, under the selection left
 * of its bottom-right handle.
 */
const MENU_KEY_W = 32
const MENU_KEY_X = 34
const MENU_KEY_INSET = 56

const ERROR_KEYS: Record<ErrorCode, string> = {
  '#DIV/0!': 'div0',
  '#REF!': 'ref',
  '#NAME?': 'name',
  '#VALUE!': 'value',
  '#N/A': 'na',
  '#CYCLE!': 'cycle',
  '#NUM!': 'num',
  '#ERROR!': 'error',
}
export const errorKey = (code: ErrorCode) => `features.sheets.err.${ERROR_KEYS[code]}`

export interface GridProps {
  sheet: SheetData
  wb: Workbook
  /** bumps when values changed */
  version: number
  lang: 'en' | 'de'
  t: (key: string, vars?: Record<string, string | number>) => string
  overlays: Overlay[]
  /** selected rows / columns (header highlight) */
  selRows: [number, number]
  selCols: [number, number]
  editCell: Pos | null
  editorNode: ReactNode
  viewportRef: RefObject<HTMLDivElement | null>
  /** false on 'down': not a press of its own (a touch's leftover mouse events) — no drag follows */
  onPointer: (target: GridTarget, phase: PointerPhase, e: MouseEvent | React.MouseEvent) => boolean | void
  onDouble: (pos: Pos) => void
  onContext: (target: GridTarget, e: React.MouseEvent) => void
  onResize: (col: number, width: number) => void
  onAutofit: (col: number) => void
  editable: boolean
  /** viewport height (the same for every sheet of the block: the tabs below never jump) */
  height: number
  /** fill handle + preview (editable blocks only) */
  fill?: FillView | null
  /** selection handles (touch) */
  handles?: HandlesView | null
  /** room (px) below the last row and right of the last column for the handles and the fill tab (touch) */
  runout?: number
  /** touch: the cell of a long press that fired (the finger still down) */
  armed?: Pos | null
  gridProps: React.HTMLAttributes<HTMLDivElement>
}

/**
 * The cell under a viewport point — computed from the layout, so it also works for rows that are
 * not rendered (virtualised) and for points beyond the edges (clamped to the sheet).
 */
export function cellFromPoint(vp: HTMLElement, sheet: SheetData, x: number, y: number, xs: number[] = offsets(sheet)): Pos {
  const box = vp.getBoundingClientRect()
  const frozen = Math.min(sheet.frozenRows ?? 0, sheet.rows)
  const vy = y - box.top - vp.clientTop
  const vx = x - box.left - vp.clientLeft
  let r: number
  if (frozen && vy >= HEAD_H && vy < HEAD_H + frozen * ROW_HEIGHT) r = Math.floor((vy - HEAD_H) / ROW_HEIGHT)
  else if (frozen && vy < HEAD_H) r = 0
  else r = frozen + Math.floor((vy + vp.scrollTop - HEAD_H - frozen * ROW_HEIGHT) / ROW_HEIGHT)
  const cx = vx + vp.scrollLeft - RH_W
  let c = 0
  while (c < sheet.cols - 1 && xs[c + 1] <= cx) c++
  return { r: Math.max(0, Math.min(sheet.rows - 1, r)), c }
}

/** Column x offsets (after the row-number column). */
export function offsets(sheet: SheetData, override?: { col: number; w: number } | null): number[] {
  const out = [0]
  for (let c = 0; c < sheet.cols; c++) out.push(out[c] + (override && override.col === c ? override.w : colWidth(sheet, c)))
  return out
}

/**
 * The visible part of a rectangle of cells in client coordinates (not under the headers or the
 * frozen rows, inside the grid's viewport), or null when none of it is in view.
 */
export function visibleBox(vp: HTMLElement, sheet: SheetData, rect: Rect, xs: number[] = offsets(sheet)): DOMRect | null {
  const box = vp.getBoundingClientRect()
  const frozen = Math.min(sheet.frozenRows ?? 0, sheet.rows)
  const bottom = Math.min(rect.bottom, sheet.rows - 1)
  const right = Math.min(rect.right, sheet.cols - 1)
  if (bottom < rect.top || right < rect.left) return null
  const x0 = box.left + vp.clientLeft
  const y0 = box.top + vp.clientTop
  const rowY = (r: number) => y0 + HEAD_H + r * ROW_HEIGHT - (r < frozen ? 0 : vp.scrollTop)
  const minY = y0 + HEAD_H + (rect.top >= frozen ? frozen * ROW_HEIGHT : 0)
  const top = Math.max(rowY(rect.top), minY)
  // a range from the frozen rows into the body: at least its frozen part stays in view
  let bot = rowY(bottom) + ROW_HEIGHT
  if (rect.top < frozen) bot = Math.max(bot, rowY(Math.min(bottom, frozen - 1)) + ROW_HEIGHT)
  bot = Math.min(bot, y0 + vp.clientHeight)
  const left = Math.max(x0 + RH_W + xs[rect.left] - vp.scrollLeft, x0 + RH_W)
  const right2 = Math.min(x0 + RH_W + xs[right + 1] - vp.scrollLeft, x0 + vp.clientWidth)
  if (bot <= top || right2 <= left) return null
  return new DOMRect(left, top, right2 - left, bot - top)
}

export function targetOf(el: Element | null): GridTarget | null {
  const hit = el?.closest?.('[data-cell],[data-rowhead],[data-colhead],[data-corner]') as HTMLElement | null
  if (!hit) return null
  if (hit.dataset.cell) {
    const [r, c] = hit.dataset.cell.split(':').map(Number)
    return { kind: 'cell', pos: { r, c } }
  }
  if (hit.dataset.rowhead) return { kind: 'row', index: Number(hit.dataset.rowhead) }
  if (hit.dataset.colhead) return { kind: 'col', index: Number(hit.dataset.colhead) }
  return { kind: 'corner' }
}

interface RowProps {
  sheet: SheetData
  wb: Workbook
  version: number
  lang: 'en' | 'de'
  r: number
  tpl: string
  top: number | null
  rowSel: boolean
  t: GridProps['t']
}

const Row = memo(function Row({ sheet, wb, lang, r, tpl, top, rowSel, t }: RowProps) {
  const cells: ReactNode[] = []
  for (let c = 0; c < sheet.cols; c++) {
    const addr = a1(r, c)
    const cell = sheet.cells[addr]
    const info = wb.get(sheet.id, r, c)
    const text = formatValue(info.value, cell?.fmt, info.hint, lang)
    const align = cell?.align ?? autoAlign(info.value)
    const err = isErr(info.value) ? info.value : null
    const style: CSSProperties | undefined = cell?.b || cell?.i ? { fontWeight: cell.b ? 700 : undefined, fontStyle: cell.i ? 'italic' : undefined } : undefined
    cells.push(
      <div
        key={c}
        className={`sg-cell is-${align}${err ? ' is-error' : ''}${info.formula ? ' is-formula' : ''}`}
        data-cell={`${r}:${c}`}
        role="gridcell"
        aria-colindex={c + 2}
        title={err ? t(errorKey(err.code)) : undefined}
        style={style}
      >
        {text}
      </div>,
    )
  }
  return (
    <div className="sg-row" role="row" aria-rowindex={r + 2} style={{ gridTemplateColumns: tpl, ...(top === null ? {} : { position: 'absolute', top }) }}>
      <div className={`sg-rowhead${rowSel ? ' is-sel' : ''}`} data-rowhead={r} role="rowheader">
        {r + 1}
      </div>
      {cells}
    </div>
  )
})

export function Grid(props: GridProps) {
  const { sheet, wb, version, lang, t, overlays, selRows, selCols, editCell, editorNode, viewportRef, onPointer, onDouble, onContext, onResize, onAutofit, editable, height, gridProps, fill, handles, runout = 0, armed } = props
  const [view, setView] = useState({ top: 0, h: 560, left: 0, w: 800 })
  const [resize, setResize] = useState<{ col: number; w: number } | null>(null)
  const raf = useRef(0)

  const xs = useMemo(() => offsets(sheet, resize), [sheet, resize])
  const totalW = xs[xs.length - 1]
  const tpl = useMemo(() => `${RH_W}px ${xs.slice(1).map((x, i) => `${x - xs[i]}px`).join(' ')}`, [xs])
  const frozen = Math.min(sheet.frozenRows ?? 0, sheet.rows)
  const bodyRows = sheet.rows - frozen

  const onScroll = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = viewportRef.current
      if (el) setView({ top: el.scrollTop, h: el.clientHeight, left: el.scrollLeft, w: el.clientWidth })
    })
  }
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setView({ top: el.scrollTop, h: el.clientHeight, left: el.scrollLeft, w: el.clientWidth })
    measure()
    // the visible width decides which side of the selection the touch "⋯" key goes
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewportRef, sheet.id])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const bodyTop = Math.max(0, view.top - HEAD_H - frozen * ROW_HEIGHT)
  const first = Math.max(0, Math.floor(bodyTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(bodyRows - 1, Math.ceil((bodyTop + view.h) / ROW_HEIGHT) + OVERSCAN)

  /* ---------------- pointer tracking (drag selection / pointing) ---------------- */

  const dragging = useRef(false)
  const down = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = targetOf(e.target as Element)
      if (!target) return
      if (onPointer(target, 'down', e) === false) return
      dragging.current = true
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return
        const tg = targetOf(document.elementFromPoint(ev.clientX, ev.clientY))
        if (tg) onPointer(tg, 'move', ev)
        // keep scrolling while dragging past an edge
        const vp = viewportRef.current
        if (vp) {
          const r = vp.getBoundingClientRect()
          if (ev.clientY > r.bottom - 8) vp.scrollTop += 16
          else if (ev.clientY < r.top + HEAD_H) vp.scrollTop -= 16
          if (ev.clientX > r.right - 8) vp.scrollLeft += 16
          else if (ev.clientX < r.left + RH_W) vp.scrollLeft -= 16
        }
      }
      const up = (ev: MouseEvent) => {
        dragging.current = false
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        const tg = targetOf(document.elementFromPoint(ev.clientX, ev.clientY)) ?? target
        onPointer(tg, 'up', ev)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [onPointer, viewportRef],
  )

  const startResize = (col: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = colWidth(sheet, col)
    let w = w0
    const move = (ev: MouseEvent) => {
      w = Math.max(36, Math.min(800, w0 + ev.clientX - x0))
      setResize({ col, w })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setResize(null)
      if (w !== w0) onResize(col, w)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /* ---------------- overlays ---------------- */

  /** A rectangle as boxes in the frozen block and / or the body. */
  const boxes = (rect: Rect): Array<{ where: 'frozen' | 'body'; style: CSSProperties }> => {
    const out: Array<{ where: 'frozen' | 'body'; style: CSSProperties }> = []
    const left = RH_W + xs[Math.min(rect.left, sheet.cols)]
    const right = RH_W + xs[Math.min(rect.right + 1, sheet.cols)]
    const bottom = Math.min(rect.bottom, sheet.rows - 1)
    if (right <= left || bottom < rect.top) return out
    const width = right - left
    if (rect.top < frozen) out.push({ where: 'frozen', style: { left, width, top: rect.top * ROW_HEIGHT, height: (Math.min(bottom, frozen - 1) - rect.top + 1) * ROW_HEIGHT } })
    if (bottom >= frozen) {
      const top = Math.max(rect.top, frozen) - frozen
      out.push({ where: 'body', style: { left, width, top: top * ROW_HEIGHT, height: (bottom - frozen - top + 1) * ROW_HEIGHT } })
    }
    return out
  }

  /** A corner at x is not scrolled under the row numbers (handles there would sit on top of them). */
  const inView = (x: number) => x >= view.left + RH_W - 2

  /** Dataset tags hang above the area; on the first row of their block below it, inside when there is no room. */
  const tagPlace = (rect: Rect, where: 'frozen' | 'body') => {
    const first = where === 'body' ? frozen : 0
    const last = where === 'body' ? sheet.rows - 1 : frozen - 1
    if (rect.top > first) return ''
    return Math.min(rect.bottom, sheet.rows - 1) < last ? ' is-below' : ' is-inside'
  }

  const layer = (where: 'frozen' | 'body') => {
    const items: ReactNode[] = []
    overlays.forEach((o, i) => {
      for (const b of boxes(o.rect)) {
        if (b.where !== where) continue
        const color = o.color === 'signal' ? undefined : o.color
        const style: CSSProperties = { ...b.style, ...(color ? ({ '--ov-text': `var(--c-${color}-text)`, '--ov-bg': `var(--c-${color}-bg)` } as CSSProperties) : {}) }
        items.push(
          <div key={`${i}-${where}`} className={`sg-ov sg-ov--${o.kind}${color ? '' : ' is-signal'}`} style={style} aria-hidden>
            {o.kind === 'edit' && (
              <>
                <i className="sg-ov__h is-tl" />
                <i className="sg-ov__h is-br" />
              </>
            )}
            {o.tag && (where === 'frozen' || o.rect.top >= frozen) && <span className={`sg-ov__tag${tagPlace(o.rect, where)}`}>{o.tag}</span>}
          </div>,
        )
      }
    })
    if (fill?.preview) {
      const all = boxes(fill.preview)
      all.forEach((b, i) => {
        if (b.where !== where) return
        // the tooltip at the far end: the last box going down / right, the first going up / left
        const tipHere = fill.tip && (fill.dir === 'up' || fill.dir === 'left' ? i === 0 : i === all.length - 1)
        items.push(
          <div key={`fill-${where}`} className={`sg-fillprev is-${fill.dir ?? 'down'}`} style={b.style} aria-hidden>
            {tipHere && <span className="sg-fillprev__tip">→ {fill.tip}</span>}
          </div>,
        )
      })
    }
    if (fill?.handle && (where === 'frozen') === Math.min(fill.handle.bottom, sheet.rows - 1) < frozen) {
      const h = fill.handle
      const bottom = Math.min(h.bottom, sheet.rows - 1)
      const left = RH_W + xs[Math.min(h.right + 1, sheet.cols)]
      const top = (where === 'frozen' ? bottom + 1 : bottom - frozen + 1) * ROW_HEIGHT
      if (!fill.touch) items.push(<span key="fill-handle" className="sg-fill" data-fill-handle="" style={{ left, top }} title={fill.label} aria-hidden onPointerDown={fill.onHandleDown} />)
      else if (inView(left))
        items.push(
          <span key="fill-handle" className="sg-fill is-tab" data-fill-handle="" style={{ left, top }} aria-hidden onPointerDown={fill.onHandleDown}>
            <i />
          </span>,
        )
    }
    if (handles) {
      const h = handles.rect
      const bottom = Math.min(h.bottom, sheet.rows - 1)
      if (handles.onMenu && (where === 'frozen') === bottom < frozen) {
        const right = RH_W + xs[Math.min(h.right + 1, sheet.cols)]
        const start = RH_W + xs[Math.min(h.left, sheet.cols)]
        const visible = (x: number) => x >= view.left + RH_W && x + MENU_KEY_W <= Math.min(view.left + view.w, RH_W + totalW + runout)
        const left = [right + MENU_KEY_X, start - 8 - MENU_KEY_W].find(visible) ?? Math.max(start, right - MENU_KEY_INSET)
        const top = (bottom + 1 - (where === 'body' ? frozen : 0)) * ROW_HEIGHT
        if (inView(left))
          items.push(
            // a plain span opened by its (compatibility) mousedown: no button, tabindex or click handler — Chrome
            // snaps nearby touches onto those, and the cells around it must stay theirs. The keyboard has the
            // menu key / Shift+F10.
            <span
              key="menu-key"
              className="sg-menukey"
              data-sel-menu=""
              role="button"
              style={{ left, top }}
              aria-label={handles.menuLabel}
              aria-haspopup="menu"
              onMouseDown={(e) => {
                e.preventDefault()
                if (e.button === 0) handles.onMenu?.()
              }}
            >
              <Ellipsis size={16} strokeWidth={2} aria-hidden />
            </span>,
          )
      }
      for (const corner of ['tl', 'br'] as const) {
        const r = corner === 'tl' ? h.top : Math.min(h.bottom, sheet.rows - 1)
        if ((where === 'frozen') !== r < frozen) continue
        const left = RH_W + xs[corner === 'tl' ? Math.min(h.left, sheet.cols) : Math.min(h.right + 1, sheet.cols)]
        const top = ((corner === 'tl' ? r : r + 1) - (where === 'body' ? frozen : 0)) * ROW_HEIGHT
        if (!inView(left)) continue
        items.push(<span key={`handle-${corner}`} className={`sg-handle is-${corner}`} data-sel-handle={corner} style={{ left, top }} aria-hidden onPointerDown={(e) => handles.onDown(corner, e)} />)
      }
    }
    if (armed && (where === 'frozen') === armed.r < frozen) {
      const b = boxes({ top: armed.r, bottom: armed.r, left: armed.c, right: armed.c })[0]
      if (b) items.push(<div key={`armed-${armed.r}:${armed.c}`} className="sg-armed" data-armed="" style={b.style} aria-hidden />)
    }
    if (editCell && editorNode && (where === 'frozen') === editCell.r < frozen) {
      const b = boxes({ top: editCell.r, bottom: editCell.r, left: editCell.c, right: editCell.c })[0]
      if (b) items.push(
        <div key="editor" className="sg-editor" style={{ left: b.style.left, top: b.style.top, minWidth: b.style.width, height: b.style.height }}>
          {editorNode}
        </div>,
      )
    }
    return items
  }

  const rows: ReactNode[] = []
  for (let r = frozen + first; r <= frozen + last; r++)
    rows.push(<Row key={r} sheet={sheet} wb={wb} version={version} lang={lang} r={r} tpl={tpl} top={(r - frozen) * ROW_HEIGHT} rowSel={r >= selRows[0] && r <= selRows[1]} t={t} />)
  const frozenRows: ReactNode[] = []
  for (let r = 0; r < frozen; r++) frozenRows.push(<Row key={r} sheet={sheet} wb={wb} version={version} lang={lang} r={r} tpl={tpl} top={null} rowSel={r >= selRows[0] && r <= selRows[1]} t={t} />)

  const heads: ReactNode[] = []
  for (let c = 0; c < sheet.cols; c++)
    heads.push(
      <div key={c} className={`sg-colhead${c >= selCols[0] && c <= selCols[1] ? ' is-sel' : ''}`} data-colhead={c} role="columnheader" aria-colindex={c + 2}>
        {colName(c)}
        {editable && (
          <span
            className="sg-resize"
            data-resize=""
            onMouseDown={(e) => startResize(c, e)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onAutofit(c)
            }}
            aria-hidden
          />
        )}
      </div>,
    )

  return (
    <div
      ref={viewportRef}
      className="sg"
      onScroll={onScroll}
      onMouseDown={(e) => {
        if ((e.target as Element).closest('[data-resize], .sg-editor, [data-fill-handle], [data-sel-handle], [data-sel-menu]')) return
        down(e)
      }}
      onDoubleClick={(e) => {
        const tg = targetOf(e.target as Element)
        if (tg?.kind === 'cell') onDouble(tg.pos)
      }}
      onContextMenu={(e) => {
        const tg = targetOf(e.target as Element)
        if (tg) onContext(tg, e)
        // the menu key on the focused grid: the block opens its own cell menu
        else if (e.target === e.currentTarget) e.preventDefault()
      }}
      style={{ height }}
      {...gridProps}
    >
      <div
        className={`sg__inner${runout ? ' has-runout' : ''}`}
        style={runout ? ({ width: RH_W + totalW + runout, paddingBottom: runout, '--runout': `${runout}px` } as CSSProperties) : { width: RH_W + totalW }}
        role="presentation"
      >
        <div className="sg-head" style={{ gridTemplateColumns: tpl }} role="row" aria-rowindex={1}>
          <div className="sg-corner" data-corner="" role="columnheader" aria-hidden />
          {heads}
        </div>
        {frozen > 0 && (
          <div className="sg-frozen" style={{ height: frozen * ROW_HEIGHT, top: HEAD_H }}>
            {frozenRows}
            {layer('frozen')}
          </div>
        )}
        <div className="sg-body" style={{ height: bodyRows * ROW_HEIGHT }}>
          {rows}
          {layer('body')}
        </div>
      </div>
    </div>
  )
}
