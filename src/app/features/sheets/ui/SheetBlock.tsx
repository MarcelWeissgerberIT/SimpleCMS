/**
 * Spreadsheet block UI: toolbar, formula bar, grid, sheet tabs, status line, function browser,
 * datasets panel; on touch selection handles, long-press / header drags and an action bar.
 * Every edit is one attrs update of the node (one undo step in the editor).
 * Values come from a Workbook kept in step with the attrs (incremental recalculation).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI, toast } from '../../../store/ui'
import type { ColorName } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { Menu, type MenuEntry } from '../../../ui/Menu'
import { pointAnchor } from '../../../ui/Popover'
import { MOD, shortcutLabel } from '../../../ui/controls'
import { parseCSV } from '../../io/import/csv'
import {
  a1,
  canPoint,
  canonicalInput,
  colName,
  columnEntries,
  completeEntry,
  formatValue,
  literal,
  MAX_COLS,
  MAX_ROWS,
  paintFormula,
  parseRect,
  pickEntries,
  registryVersion,
  rectText,
  sameName,
  subscribeRegistry,
  Workbook,
  type CellFormat,
  type FillMode,
  type Rect,
  type RefTok,
} from '../engine'
import { datasetSources, sheetSources, syncCustomFunctions } from '../compute'
import { activeSheet, colWidth, datasetNameProblem, readAttrs, ROW_HEIGHT, type Align, type SheetCell, type SheetData, type SpreadsheetAttrs } from '../model'
import {
  addSheet,
  autoFill,
  cellsIn,
  clearContents,
  datasetUsers,
  deleteDataset,
  deleteSheet,
  duplicateSheet,
  fill,
  fillDirection,
  fillDownEnd,
  fillEndCell,
  fillSeriesIn,
  moveSheet,
  paste,
  renameDataset,
  renameSheet,
  setCells as setCellsPatch,
  setColWidth,
  setSheet,
  sheetNameProblem,
  structural,
  styleCells,
  upsertDataset,
  type Patch,
  type Pos,
} from '../ops'
import { sheetCsv } from '../static'
import type { SheetBlockProps } from '../index'
import { Grid, HEAD_H, offsets, RH_W, visibleBox, type FillView, type GridTarget, type HandlesView, type Overlay, type PointerPhase } from './Grid'
import { FormulaInput, groupColor } from './FormulaInput'
import { SheetTabs } from './SheetTabs'
import { Toolbar } from './Toolbar'
import { FunctionBrowser } from './FunctionBrowser'
import { DatasetsPanel } from './DatasetsPanel'
import { internalClip, lastClip, parseTsv, rememberClip, toHtmlTable, toTsv } from './clip'
import { useFillDrag } from './fill'
import { targetUnder, useTouchGestures } from './touch'
import { sheetBarKeys, TouchBar } from './TouchBar'
import { PickList } from './PickList'
import { setAutoComplete, useAutoComplete } from './prefs'
import { openFunctionBuilder } from '../functions'
import { openChartBuilder, type ChartSpec } from '../../charts'
import { Charts } from './Charts'
import { chartSpec, qualifiedRef } from '../charts'
import { readSheetData, usedSize } from '../compute'
import './sheet.css'

interface Sel {
  anchor: Pos
  focus: Pos
  /** earlier areas of a multi-area selection (⌘/Ctrl-click) */
  extra: Rect[]
}

interface Edit {
  r: number
  c: number
  sheetId: string
  text: string
  caret: number
  where: 'cell' | 'bar'
  /** started by typing (arrow keys commit) rather than F2 / double-click */
  fresh: boolean
  /** the reference inserted by pointing (clicking again replaces it, dragging stretches it) */
  point: { s: number; e: number; anchor: Pos } | null
  /** AutoComplete may propose an entry: the last change typed text at the end (Backspace / Delete / caret moves turn it off) */
  auto: boolean
}

interface Pick {
  r: number
  c: number
  sheetId: string
  anchor: Element
  entries: string[]
  initial: string
}

/** Modifiers of a pointer press on the grid (touch gestures have none). */
interface Mods {
  add: boolean
  shift: boolean
  prevent: () => void
}
const NO_MODS: Mods = { add: false, shift: false, prevent: () => undefined }

const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

/** The nearest scrolling ancestor (the page column): the touch bar stays inside it. */
function scrollParent(el: Element | null): Element | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** Tallest grid viewport (taller sheets scroll inside). */
const GRID_MAX = 600
/** touch: room past the sheet's last row / column for the handles and the fill tab */
const RUNOUT = 40
/** touch: the bar needs this much room between the column letters and the selection, else it goes above the letters */
const BAR_ROOM = 64
const ORIGIN: Sel = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, extra: [] }
const rectOf = (s: Sel): Rect => ({ top: Math.min(s.anchor.r, s.focus.r), bottom: Math.max(s.anchor.r, s.focus.r), left: Math.min(s.anchor.c, s.focus.c), right: Math.max(s.anchor.c, s.focus.c) })
const clampPos = (p: Pos, sheet: SheetData): Pos => ({ r: Math.max(0, Math.min(sheet.rows - 1, p.r)), c: Math.max(0, Math.min(sheet.cols - 1, p.c)) })
const cellsOfRect = (r: Rect) => (r.bottom - r.top + 1) * (r.right - r.left + 1)

/** A reference token as a rectangle (whole columns: to the sheet's end). */
function tokRect(tok: RefTok): Rect {
  const b = tok.b ?? tok.a
  return tok.cols
    ? { top: 0, bottom: MAX_ROWS - 1, left: Math.min(tok.a.col, b.col), right: Math.max(tok.a.col, b.col) }
    : { top: Math.min(tok.a.row, b.row), bottom: Math.max(tok.a.row, b.row), left: Math.min(tok.a.col, b.col), right: Math.max(tok.a.col, b.col) }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }))
  const el = document.createElement('a')
  el.href = url
  el.download = name
  document.body.appendChild(el)
  el.click()
  el.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function SheetBlock({ attrs: raw, update, editable, editor, pageId, insertAfter }: SheetBlockProps) {
  const t = useT()
  const lang = useLang()
  const a = readAttrs(raw)
  const sheet = activeSheet(a)
  const aRef = useRef(a)
  aRef.current = a

  /* ---------------- values ---------------- */

  const reg = useSyncExternalStore(subscribeRegistry, registryVersion)
  const functions = useWorkspace((s) => s.functions)
  useEffect(() => syncCustomFunctions(), [functions])
  const wb = useMemo(() => new Workbook({ lang }), [lang])
  const version = useMemo(() => {
    wb.sync(sheetSources(a), datasetSources(a))
    return wb.version
  }, [wb, a, reg]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- state ---------------- */

  const [selState, setSelState] = useState<{ sheetId: string; sel: Sel }>({ sheetId: sheet.id, sel: ORIGIN })
  const sel: Sel = selState.sheetId === sheet.id ? { ...selState.sel, anchor: clampPos(selState.sel.anchor, sheet), focus: clampPos(selState.sel.focus, sheet) } : ORIGIN
  const setSel = useCallback((next: Sel | ((s: Sel) => Sel)) => setSelState((cur) => ({ sheetId: sheet.id, sel: typeof next === 'function' ? next(cur.sheetId === sheet.id ? cur.sel : ORIGIN) : next })), [sheet.id])
  const [edit, setEdit] = useState<Edit | null>(null)
  const editRef = useRef(edit)
  editRef.current = edit
  const [showDS, setShowDS] = useState(true)
  const [panel, setPanel] = useState<{ kind: 'fx' | 'ds' | 'chart'; anchor: Element } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; target: GridTarget } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const cellInput = useRef<HTMLInputElement>(null)
  const barInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragMode = useRef<'select' | 'point' | 'rows' | 'cols' | null>(null)
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const autoOn = useAutoComplete()
  const [pick, setPick] = useState<Pick | null>(null)
  /** the last press on the block was a finger (or the device is touch-first and nothing was pressed yet) */
  const [touchUI, setTouchUI] = useState(coarse)
  /** the keyboard focus is inside the block */
  const [focused, setFocused] = useState(false)
  /** "+ Area" is latched: the next press starts another area (⌘/Ctrl-click by touch) */
  const [addArea, setAddAreaState] = useState(false)
  const addAreaRef = useRef(false)
  const setAddArea = (on: boolean) => {
    addAreaRef.current = on
    setAddAreaState(on)
  }
  const takeAddArea = () => {
    if (!addAreaRef.current) return false
    setAddArea(false)
    return true
  }

  const rect = rectOf(sel)
  const areas = [...sel.extra, rect]
  const active = sel.anchor
  const activeAddr = a1(active.r, active.c)
  const activeCell = sheet.cells[activeAddr]

  const write = useCallback(
    (patch: Patch | null | undefined) => {
      if (!editable || !patch || !Object.keys(patch).length) return
      update(patch)
    },
    [editable, update],
  )

  /* ---------------- focus ---------------- */

  const focusGrid = () => viewportRef.current?.focus({ preventScroll: true })

  // put the caret where the edit state says (typing keeps them equal; pointing moves it)
  useLayoutEffect(() => {
    if (!edit) return
    const el = edit.where === 'cell' ? cellInput.current : barInput.current
    if (!el) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (el.selectionStart !== edit.caret || el.selectionEnd !== edit.caret) el.setSelectionRange(edit.caret, edit.caret)
  }, [edit?.where, edit?.caret, edit?.text, edit?.r, edit?.c]) // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = (p: Pos) => {
    const vp = viewportRef.current
    if (!vp) return
    const xs = offsets(sheet)
    const frozenH = (sheet.frozenRows ?? 0) * ROW_HEIGHT
    const top = HEAD_H + p.r * ROW_HEIGHT
    if (p.r >= (sheet.frozenRows ?? 0)) {
      if (top < vp.scrollTop + HEAD_H + frozenH) vp.scrollTop = top - HEAD_H - frozenH
      else if (top + ROW_HEIGHT > vp.scrollTop + vp.clientHeight) vp.scrollTop = top + ROW_HEIGHT - vp.clientHeight
    }
    const left = RH_W + xs[p.c]
    const right = RH_W + xs[p.c + 1]
    if (left < vp.scrollLeft + RH_W) vp.scrollLeft = left - RH_W
    else if (right > vp.scrollLeft + vp.clientWidth) vp.scrollLeft = right - vp.clientWidth
  }

  /* ---------------- editing ---------------- */

  const startEdit = (p: Pos, text?: string, where: 'cell' | 'bar' = 'cell') => {
    if (!editable) return
    const raw = text ?? sheet.cells[a1(p.r, p.c)]?.v ?? ''
    setEdit({ r: p.r, c: p.c, sheetId: sheet.id, text: raw, caret: raw.length, where, fresh: text !== undefined, point: null, auto: text !== undefined })
  }

  const commit = (move: [number, number] | null = null, cur = editRef.current) => {
    if (!cur) return
    const s = aRef.current.sheets.find((x) => x.id === cur.sheetId)
    if (s) {
      const addr = a1(cur.r, cur.c)
      const prev = s.cells[addr]
      const { v, fmt } = canonicalInput(cur.text, lang)
      if ((prev?.v ?? '') !== v || (fmt && !prev?.fmt)) write(setCellsPatch(aRef.current, cur.sheetId, { [addr]: { ...prev, v: v || undefined, fmt: prev?.fmt ?? fmt } }))
    }
    setEdit(null)
    editRef.current = null
    if (move && s) {
      const next = clampPos({ r: cur.r + move[0], c: cur.c + move[1] }, s)
      setSel({ anchor: next, focus: next, extra: [] })
      requestAnimationFrame(() => reveal(next))
    }
    focusGrid()
  }

  const cancel = () => {
    setEdit(null)
    focusGrid()
  }

  // typing at the end may complete; deleting (or editing in the middle) never does
  const setText = (text: string, caret: number) => setEdit((e) => (e ? { ...e, text, caret, point: null, auto: caret === text.length && text.length > e.text.length } : e))
  const setCaret = (caret: number) => setEdit((e) => (e ? { ...e, caret, point: e.point && caret === e.point.e ? e.point : null, auto: e.auto && caret === e.text.length } : e))

  /* ---------------- AutoComplete (entries of the same column) ---------------- */

  const editSheet = edit ? (a.sheets.find((x) => x.id === edit.sheetId) ?? null) : null
  const entries = useMemo(
    () => (edit && autoOn && editSheet ? columnEntries(editSheet, edit.r, edit.c) : null),
    [autoOn, editSheet?.cells, edit?.sheetId, edit?.r, edit?.c], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const completion = edit && edit.auto && entries && edit.caret === edit.text.length ? completeEntry(entries, edit.text, lang) : null

  /** Insert text at the caret of the open edit (function browser, datasets panel). */
  const insertAtCaret = (snippet: string) => {
    const e = editRef.current
    if (e) {
      const text = e.text.slice(0, e.caret) + snippet + e.text.slice(e.caret)
      setEdit({ ...e, text, caret: e.caret + snippet.length, point: null })
      return
    }
    if (!editable) return
    const text = `=${snippet}`
    setEdit({ r: active.r, c: active.c, sheetId: sheet.id, text, caret: text.length, where: 'bar', fresh: false, point: null, auto: false })
  }

  const editKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const cur = editRef.current
    if (!cur) return
    // IME composition owns the keys until it ends
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      if (cur.text[0] !== '=') openPick({ r: cur.r, c: cur.c }, cur.text)
      return
    }
    const mod = e.ctrlKey || e.metaKey
    if (completion && !mod && !e.altKey) {
      // Backspace / Delete drop the proposal (the typed text stays); → takes it and keeps editing
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        setEdit({ ...cur, auto: false })
        return
      }
      if (e.key === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault()
        setEdit({ ...cur, text: completion, caret: completion.length, auto: false, point: null })
        return
      }
    }
    // Enter / Tab (and the arrows of a fresh entry) commit the proposal with the entry's casing
    const done = completion ? { ...cur, text: completion } : cur
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault()
      commit([e.shiftKey ? -1 : 1, 0], done)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit([0, e.shiftKey ? -1 : 1], done)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (cur.fresh && cur.where === 'cell' && cur.text[0] !== '=' && e.key.startsWith('Arrow') && !mod && !e.altKey) {
      e.preventDefault()
      const d: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      commit(d[e.key], done)
    }
  }

  /* ---------------- pick from list (Alt+↓) ---------------- */

  const openPick = (p: Pos, typed = '') => {
    if (!editable) return
    const s = sheetRef.current
    const editor = editRef.current?.where === 'cell' ? rootRef.current?.querySelector('.sg-editor') : null
    const anchor = editor ?? rootRef.current?.querySelector(`[data-cell="${p.r}:${p.c}"]`) ?? viewportRef.current
    if (!anchor) return
    setPick({ r: p.r, c: p.c, sheetId: s.id, anchor, entries: pickEntries(s, p.r, p.c, lang), initial: typed })
  }

  const closePick = () => {
    setPick(null)
    const e = editRef.current
    requestAnimationFrame(() => (e ? (e.where === 'cell' ? cellInput : barInput).current?.focus({ preventScroll: true }) : focusGrid()))
  }

  const pickValue = (value: string) => {
    const p = pick
    setPick(null)
    if (!p) return
    const s = aRef.current.sheets.find((x) => x.id === p.sheetId)
    if (!s) return
    const addr = a1(p.r, p.c)
    const prev = s.cells[addr]
    // the entries are texts: keep them text even where they would read as a number or a date
    const v = value[0] !== '=' && value[0] !== "'" && typeof literal(value, prev?.fmt?.type).value === 'string' ? value : `'${value}`
    if (editRef.current) {
      setEdit(null)
      editRef.current = null
    }
    if (prev?.v !== v) write(setCellsPatch(aRef.current, p.sheetId, { [addr]: { ...prev, v } }))
    focusGrid()
  }

  /* ---------------- fill handle ---------------- */

  const applyFill = (src: Rect, dest: Rect, mode: FillMode) => {
    write(autoFill(aRef.current, sheetRef.current.id, src, dest, mode, lang))
    setSel({ anchor: { r: dest.top, c: dest.left }, focus: { r: dest.bottom, c: dest.right }, extra: [] })
    focusGrid()
  }
  const { drag: fillDrag, start: startFill } = useFillDrag({
    viewportRef,
    sheetRef,
    onApply: applyFill,
    onDouble: (src) => {
      const end = fillDownEnd(sheetRef.current, src)
      if (end !== null) applyFill(src, { ...src, bottom: end }, 'auto')
    },
    onTouchTap: (x, y) => tapAt(x, y),
  })

  // leaving the block (focus elsewhere on the page) commits; popovers of the block don't count
  const editBlur = () => {
    window.setTimeout(() => {
      const el = document.activeElement
      if (!editRef.current || (el && (rootRef.current?.contains(el) || el.closest?.('[data-popover]')))) return
      commit(null)
    }, 0)
  }

  /* ---------------- pointing (Excel point mode) ---------------- */

  const pointable = (e: Edit | null) => !!e && e.text[0] === '=' && e.sheetId === sheet.id && (!!e.point || canPoint(e.text.slice(1), e.caret - 1))

  const point = (pos: Pos, phase: PointerPhase, add: boolean) => {
    const e = editRef.current
    if (!e) return
    if (phase === 'down') {
      const ref = a1(pos.r, pos.c)
      let text: string
      let s: number
      if (e.point && add) {
        s = e.point.e + 2
        text = `${e.text.slice(0, e.point.e)}; ${ref}${e.text.slice(e.point.e)}`
      } else if (e.point && e.caret === e.point.e) {
        s = e.point.s
        text = e.text.slice(0, e.point.s) + ref + e.text.slice(e.point.e)
      } else {
        s = e.caret
        text = e.text.slice(0, e.caret) + ref + e.text.slice(e.caret)
      }
      const next = { ...e, text, caret: s + ref.length, point: { s, e: s + ref.length, anchor: pos } }
      editRef.current = next
      setEdit(next)
      return
    }
    if (!e.point) return
    const p = e.point
    const ref = rectText({ top: Math.min(p.anchor.r, pos.r), bottom: Math.max(p.anchor.r, pos.r), left: Math.min(p.anchor.c, pos.c), right: Math.max(p.anchor.c, pos.c) })
    const text = e.text.slice(0, p.s) + ref + e.text.slice(p.e)
    const next = { ...e, text, caret: p.s + ref.length, point: { ...p, e: p.s + ref.length } }
    editRef.current = next
    setEdit(next)
  }

  /* ---------------- pointer on the grid ---------------- */

  const pointer = (target: GridTarget, phase: PointerPhase, m: Mods) => {
    if (phase === 'down') {
      setCtx(null)
      const add = target.kind !== 'corner' && (m.add || takeAddArea())
      const cur = editRef.current
      if (target.kind === 'cell' && pointable(cur)) {
        m.prevent()
        dragMode.current = 'point'
        point(target.pos, 'down', add)
        return
      }
      if (cur) commit(null)
      if (target.kind === 'cell') {
        dragMode.current = 'select'
        const pos = target.pos
        setSel((s) => (m.shift ? { ...s, focus: pos } : add ? { anchor: pos, focus: pos, extra: [...s.extra, rectOf(s)].slice(-31) } : { anchor: pos, focus: pos, extra: [] }))
      } else if (target.kind === 'col') {
        dragMode.current = 'cols'
        setSel((s) => ({ anchor: { r: 0, c: m.shift ? s.anchor.c : target.index }, focus: { r: sheet.rows - 1, c: target.index }, extra: add ? [...s.extra, rectOf(s)] : [] }))
      } else if (target.kind === 'row') {
        dragMode.current = 'rows'
        setSel((s) => ({ anchor: { r: m.shift ? s.anchor.r : target.index, c: 0 }, focus: { r: target.index, c: sheet.cols - 1 }, extra: add ? [...s.extra, rectOf(s)] : [] }))
      } else {
        dragMode.current = null
        setSel({ anchor: { r: 0, c: 0 }, focus: { r: sheet.rows - 1, c: sheet.cols - 1 }, extra: [] })
      }
      focusGrid()
      return
    }
    const mode = dragMode.current
    if (phase === 'up') dragMode.current = null
    if (!mode) return
    if (mode === 'point' && target.kind === 'cell') point(target.pos, 'move', false)
    else if (mode === 'select' && target.kind === 'cell') setSel((s) => ({ ...s, focus: target.pos }))
    else if (mode === 'cols' && (target.kind === 'col' || target.kind === 'cell')) {
      const c = target.kind === 'col' ? target.index : target.pos.c
      setSel((s) => ({ ...s, focus: { r: sheet.rows - 1, c } }))
    } else if (mode === 'rows' && (target.kind === 'row' || target.kind === 'cell')) {
      const r = target.kind === 'row' ? target.index : target.pos.r
      setSel((s) => ({ ...s, focus: { r, c: sheet.cols - 1 } }))
    }
  }

  /* ---------------- touch: long press, header drags, selection handles ---------------- */

  const touch = useTouchGestures({
    viewportRef,
    sheetRef,
    onTarget: (target, phase) => pointer(target, phase, NO_MODS),
    onHandle: (corner, pos, phase) => {
      if (phase === 'down') {
        setCtx(null)
        // the opposite corner stays where it is
        setSel((s) => {
          const r = rectOf(s)
          return { ...s, anchor: corner === 'br' ? { r: r.top, c: r.left } : { r: r.bottom, c: r.right }, focus: pos }
        })
        focusGrid()
      } else if (phase === 'move') setSel((s) => ({ ...s, focus: pos }))
    },
    onTap: (x, y) => tapAt(x, y),
  })

  /** A tap that landed on a handle or the fill tab: it was meant for the cell (or header) underneath. */
  const tapAt = (x: number, y: number) => {
    const target = targetUnder(x, y)
    if (!target) return
    pointer(target, 'down', NO_MODS)
    pointer(target, 'up', NO_MODS)
  }

  /** Pointer events from the grid (mouse, and the browser's compatibility mouse events of a tap). */
  const onPointer = (target: GridTarget, phase: PointerPhase, e: MouseEvent | React.MouseEvent) => {
    // what Chrome may still send after a long press or a drag is no tap
    if (phase === 'down' && touch.aftermath()) return
    pointer(target, phase, { add: e.ctrlKey || e.metaKey, shift: e.shiftKey, prevent: () => e.preventDefault() })
  }

  /* ---------------- operations ---------------- */

  const op = (patch: Patch | null | undefined) => write(patch)

  const insertRows = (below: boolean) => op(structural(a, { kind: 'insert', axis: 'row', sheetId: sheet.id, at: below ? rect.bottom + 1 : rect.top, count: rect.bottom - rect.top + 1 }))
  const insertCols = (right: boolean) => op(structural(a, { kind: 'insert', axis: 'col', sheetId: sheet.id, at: right ? rect.right + 1 : rect.left, count: rect.right - rect.left + 1 }))
  const deleteRows = () => op(structural(a, { kind: 'delete', axis: 'row', sheetId: sheet.id, at: rect.top, count: rect.bottom - rect.top + 1 }))
  const deleteCols = () => op(structural(a, { kind: 'delete', axis: 'col', sheetId: sheet.id, at: rect.left, count: rect.right - rect.left + 1 }))

  const style = (fn: (c: SheetCell) => SheetCell) => {
    op(styleCells(a, sheet.id, areas, fn))
    // toolbar / menu actions hand the keyboard back to the grid
    if (!editRef.current) requestAnimationFrame(focusGrid)
  }
  const toggle = (key: 'b' | 'i') => {
    const on = !activeCell?.[key]
    style((c) => ({ ...c, [key]: on || undefined }))
  }
  const setAlign = (align: Align) => {
    const same = activeCell?.align === align
    style((c) => ({ ...c, align: same ? undefined : align }))
  }
  const setFormat = (fmt: CellFormat) => style((c) => ({ ...c, fmt: fmt.type === 'auto' ? undefined : fmt }))
  const setDecimals = (delta: 1 | -1) => {
    const cur = activeCell?.fmt
    const base = cur?.decimals ?? (cur?.type === 'percent' ? 0 : cur?.type === 'number' || cur?.type === 'currency' ? 2 : decimalsShown())
    const decimals = Math.max(0, Math.min(10, base + delta))
    style((c) => ({ ...c, fmt: { ...(c.fmt ?? { type: 'auto' }), decimals } }))
  }
  const decimalsShown = () => {
    const v = wb.get(sheet.id, active.r, active.c).value
    if (typeof v !== 'number') return 0
    const s = String(Number(v.toPrecision(12)))
    return s.includes('.') ? s.split('.')[1].length : 0
  }

  const autofit = (cols: number[]) => {
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('2d')
    if (!g) return
    const font = viewportRef.current ? getComputedStyle(viewportRef.current).fontFamily : 'sans-serif'
    let patch: Patch = {}
    let base: SpreadsheetAttrs = a
    for (const c of cols) {
      let w = 0
      for (let r = 0; r < sheet.rows; r++) {
        const cell = sheet.cells[a1(r, c)]
        if (!cell?.v) continue
        const info = wb.get(sheet.id, r, c)
        g.font = `${cell.b ? 700 : 400} 13px ${font}`
        w = Math.max(w, g.measureText(formatValue(info.value, cell.fmt, info.hint, lang)).width)
      }
      patch = setColWidth(base, sheet.id, c, Math.max(48, Math.min(480, Math.ceil(w) + 22)))
      base = { ...base, ...patch } as SpreadsheetAttrs
    }
    op(patch)
  }

  const clear = () => op(clearContents(a, sheet.id, areas))

  /* ---------------- clipboard ---------------- */

  const copy = (e: React.ClipboardEvent | null, cut: boolean) => {
    const rows: string[][] = []
    for (let r = rect.top; r <= rect.bottom; r++) {
      const row: string[] = []
      for (let c = rect.left; c <= rect.right; c++) {
        const cell = sheet.cells[a1(r, c)]
        const info = wb.get(sheet.id, r, c)
        row.push(cell?.v ? formatValue(info.value, cell.fmt, info.hint, lang) : '')
      }
      rows.push(row)
    }
    const text = toTsv(rows)
    const clip = cellsIn(sheet, rect)
    if (cut) clip.cut = { sheetId: sheet.id, rect }
    rememberClip({ text, clip, sheetId: sheet.id, rect })
    if (e) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
      e.clipboardData.setData('text/html', toHtmlTable(rows))
    } else void navigator.clipboard?.writeText(text).catch(() => undefined)
  }

  const pasteText = (text: string) => {
    if (!editable) return
    const internal = internalClip(text)
    if (internal) {
      op(paste(aRef.current, sheet.id, active, internal.clip))
      if (internal.clip.cut) rememberClip(null)
    } else {
      const rows = parseTsv(text)
      if (!rows.length) return
      const cells = rows.map((r) => r.map((v) => (v ? ({ v: canonicalInput(v, lang).v } as SheetCell) : null)))
      op(paste(aRef.current, sheet.id, active, { cells }))
    }
    const h = Math.max(1, internal ? internal.clip.cells.length : parseTsv(text).length)
    const w = Math.max(1, internal ? internal.clip.cells[0]?.length ?? 1 : Math.max(...parseTsv(text).map((r) => r.length)))
    setSel({ anchor: active, focus: { r: active.r + h - 1, c: active.c + w - 1 }, extra: [] })
  }

  /** Paste from the system clipboard (menu, touch bar); where it can't be read, the last copy made here. */
  const pasteFromClipboard = () => {
    const fallback = () => {
      const own = lastClip()
      if (own) pasteText(own.text)
      else toast(t('features.sheets.pasteHint', { key: MOD }))
    }
    const read = navigator.clipboard?.readText?.()
    if (!read) return fallback()
    read.then((text) => (text ? pasteText(text) : fallback())).catch(fallback)
  }

  /** Fill down / right (⌘D / ⌘R): a single row / column takes the one above / to the left. */
  const fillDown = () => op(fill(a, sheet.id, rect.top === rect.bottom && rect.top > 0 ? { ...rect, top: rect.top - 1 } : rect, 'down'))
  const fillRight = () => op(fill(a, sheet.id, rect.left === rect.right && rect.left > 0 ? { ...rect, left: rect.left - 1 } : rect, 'right'))

  /* ---------------- keyboard on the grid ---------------- */

  const move = (dr: number, dc: number, extend: boolean, jump = false) => {
    let target = extend ? sel.focus : sel.anchor
    if (jump) {
      // Ctrl+arrow: to the edge of the data
      const filled = (p: Pos) => !!sheet.cells[a1(p.r, p.c)]?.v
      let p = { ...target }
      const step = () => ({ r: p.r + dr, c: p.c + dc })
      const inside = (q: Pos) => q.r >= 0 && q.c >= 0 && q.r < sheet.rows && q.c < sheet.cols
      if (filled(p) && inside(step()) && filled(step())) while (inside(step()) && filled(step())) p = step()
      else {
        while (inside(step()) && !filled(step())) p = step()
        if (inside(step())) p = step()
      }
      target = p
    } else target = { r: target.r + dr, c: target.c + dc }
    const next = clampPos(target, sheet)
    setSel((s) => (extend ? { ...s, focus: next } : { anchor: next, focus: next, extra: [] }))
    reveal(next)
  }

  const gridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== viewportRef.current) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const page = Math.max(1, Math.floor((viewportRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 2)
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (e.altKey && k === 'ArrowDown') {
      e.preventDefault()
      openPick(active)
    } else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
      // the cell menu from the keyboard, under the active cell
      e.preventDefault()
      const box = rootRef.current?.querySelector(`[data-cell="${active.r}:${active.c}"]`)?.getBoundingClientRect()
      if (box) setCtx({ x: box.left + 8, y: box.bottom, target: { kind: 'cell', pos: active } })
    } else if (arrows[k]) {
      e.preventDefault()
      move(arrows[k][0], arrows[k][1], e.shiftKey, mod)
    } else if (k === 'Tab') {
      e.preventDefault()
      move(0, e.shiftKey ? -1 : 1, false)
    } else if (k === 'PageDown' || k === 'PageUp') {
      e.preventDefault()
      move(k === 'PageDown' ? page : -page, 0, e.shiftKey)
    } else if (k === 'Home') {
      e.preventDefault()
      const next = mod ? { r: 0, c: 0 } : { r: sel.anchor.r, c: 0 }
      setSel({ anchor: next, focus: next, extra: [] })
      reveal(next)
    } else if (k === 'End') {
      e.preventDefault()
      const next = mod ? { r: sheet.rows - 1, c: sheet.cols - 1 } : { r: sel.anchor.r, c: sheet.cols - 1 }
      setSel({ anchor: next, focus: next, extra: [] })
      reveal(next)
    } else if (mod && k.toLowerCase() === 'a') {
      e.preventDefault()
      setSel({ anchor: { r: 0, c: 0 }, focus: { r: sheet.rows - 1, c: sheet.cols - 1 }, extra: [] })
    } else if (mod && k.toLowerCase() === 'z') {
      e.preventDefault()
      const cmds = editor.commands as unknown as Record<string, (() => boolean) | undefined>
      if (e.shiftKey) cmds.redo?.()
      else cmds.undo?.()
    } else if (mod && k.toLowerCase() === 'y') {
      e.preventDefault()
      ;(editor.commands as unknown as Record<string, (() => boolean) | undefined>).redo?.()
    } else if (!editable) {
      return
    } else if (mod && k.toLowerCase() === 'd') {
      e.preventDefault()
      fillDown()
    } else if (mod && k.toLowerCase() === 'r') {
      e.preventDefault()
      fillRight()
    } else if (mod && k.toLowerCase() === 'b') {
      e.preventDefault()
      toggle('b')
    } else if (mod && k.toLowerCase() === 'i') {
      e.preventDefault()
      toggle('i')
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      clear()
    } else if (k === 'F2' || k === 'Enter') {
      e.preventDefault()
      startEdit(active)
    } else if (k === 'Escape') {
      setSel((s) => ({ ...s, extra: [] }))
      setAddArea(false)
    } else if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault()
      startEdit(active, k)
    }
  }

  /* ---------------- sheets ---------------- */

  const selectSheet = (id: string) => {
    if (editRef.current) commit(null)
    if (id !== a.active) write({ active: id })
  }

  const confirm = (title: string, body: string, onConfirm: () => void) =>
    useUI.getState().openModal({ type: 'confirm', title, body, danger: true, confirmLabel: t('features.sheets.ds.delete'), onConfirm })

  /* ---------------- datasets ---------------- */

  const selectionRanges = areas.map((r) => ({ sheet: sheet.id, ref: rectText(r) }))

  const dsError = (name: string, selfId?: string) => {
    const p = datasetNameProblem(name, a.datasets, selfId)
    return p ? `features.sheets.ds.err.${p}` : null
  }

  /* ---------------- overlays ---------------- */

  const overlays = useMemo<Overlay[]>(() => {
    const out: Overlay[] = []
    const onSheet = (name: string | null) => (name === null ? sheet.id : (a.sheets.find((s) => sameName(s.name, name))?.id ?? null)) === sheet.id
    if (showDS)
      for (const d of a.datasets)
        for (const r of d.ranges) {
          if (r.sheet !== sheet.id) continue
          const rr = parseRef(r.ref, sheet)
          if (rr) out.push({ rect: rr, color: d.color, kind: 'named', tag: t('features.sheets.ds.tag', { name: d.name.toUpperCase() }) })
        }
    const text = edit && edit.sheetId === sheet.id ? edit.text : (activeCell?.v ?? '')
    if (text[0] === '=') {
      const paint = paintFormula(text.slice(1))
      for (const g of paint.groups) {
        if (!edit && g.kind !== 'ds') continue
        const color = groupColor(g.id)
        const kind = edit ? 'edit' : 'faint'
        for (const ref of g.refs) if (onSheet(ref.sheet)) out.push({ rect: tokRect(ref), color, kind })
        for (const name of g.names) {
          const d = a.datasets.find((x) => sameName(x.name, name))
          for (const r of d?.ranges ?? []) {
            const rr = r.sheet === sheet.id ? parseRef(r.ref, sheet) : null
            if (rr) out.push({ rect: rr, color, kind })
          }
        }
      }
    }
    const multi = areas.length > 1 || cellsOfRect(rect) > 1
    if (multi) for (const r of areas) out.push({ rect: r, color: 'signal', kind: 'sel' })
    out.push({ rect: { top: active.r, bottom: active.r, left: active.c, right: active.c }, color: 'signal', kind: 'active' })
    return out
  }, [a, sheet, showDS, edit, activeCell, areas.length, rect.top, rect.bottom, rect.left, rect.right, active.r, active.c, t]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- status ---------------- */

  const status = useMemo(() => {
    if (areas.length === 1 && cellsOfRect(rect) < 2) return null
    let sum = 0
    let count = 0
    let seen = 0
    const done = new Set<string>()
    for (const r of areas)
      for (let y = r.top; y <= Math.min(r.bottom, sheet.rows - 1); y++)
        for (let x = r.left; x <= Math.min(r.right, sheet.cols - 1); x++) {
          if (++seen > 200_000) break
          const k = `${y}:${x}`
          if (done.has(k)) continue
          done.add(k)
          const v = wb.get(sheet.id, y, x).value
          if (typeof v === 'number') {
            sum += v
            count++
          }
        }
    return { sum, count, avg: count ? sum / count : null }
  }, [version, sheet, areas.length, rect.top, rect.bottom, rect.left, rect.right]) // eslint-disable-line react-hooks/exhaustive-deps
  const statusNum = (n: number) => formatValue(Math.abs(n) >= 1 ? Number(n.toFixed(2)) : Number(n.toPrecision(4)), undefined, null, lang)

  /* ---------------- menus ---------------- */

  const rowsSel = rect.bottom - rect.top + 1
  const colsSel = rect.right - rect.left + 1
  /** keyboard hints in the menus, not on touch (the bar's ⋯ opens the cell menu there) */
  const kbd = (keys: string) => (touchUI ? undefined : keys === 'Del' ? keys : shortcutLabel(keys))
  const cellEntries: MenuEntry[] = [
    { label: t('features.sheets.cut'), hint: kbd('Mod+X'), disabled: !editable, onSelect: () => copy(null, true) },
    { label: t('features.sheets.copy'), hint: kbd('Mod+C'), onSelect: () => copy(null, false) },
    {
      label: t('features.sheets.paste'),
      hint: kbd('Mod+V'),
      disabled: !editable,
      onSelect: pasteFromClipboard,
    },
    { kind: 'separator' },
    { label: t('features.sheets.insertRowAbove'), disabled: !editable, onSelect: () => insertRows(false) },
    { label: t('features.sheets.insertRowBelow'), disabled: !editable, onSelect: () => insertRows(true) },
    { label: t('features.sheets.insertColLeft'), disabled: !editable, onSelect: () => insertCols(false) },
    { label: t('features.sheets.insertColRight'), disabled: !editable, onSelect: () => insertCols(true) },
    { kind: 'separator' },
    { label: rowsSel > 1 ? t('features.sheets.deleteRowsN', { n: rowsSel }) : t('features.sheets.deleteRows'), danger: true, disabled: !editable || rowsSel >= sheet.rows, onSelect: deleteRows },
    { label: colsSel > 1 ? t('features.sheets.deleteColsN', { n: colsSel }) : t('features.sheets.deleteCols'), danger: true, disabled: !editable || colsSel >= sheet.cols, onSelect: deleteCols },
    { label: t('features.sheets.clear'), hint: kbd('Del'), disabled: !editable, onSelect: clear },
    { kind: 'separator' },
    { label: t('features.sheets.fillDown'), hint: kbd('Mod+D'), disabled: !editable || rowsSel < 2, onSelect: () => op(fill(a, sheet.id, rect, 'down')) },
    { label: t('features.sheets.fillRight'), hint: kbd('Mod+R'), disabled: !editable || colsSel < 2, onSelect: () => op(fill(a, sheet.id, rect, 'right')) },
    { label: t('features.sheets.fillSeries'), disabled: !editable || cellsOfRect(rect) < 2, onSelect: () => op(fillSeriesIn(a, sheet.id, rect, lang)) },
    { kind: 'separator' },
    { label: t('features.sheets.pick.menu'), hint: kbd('Alt+↓'), disabled: !editable, onSelect: () => openPick(active) },
  ]

  const moreEntries: MenuEntry[] = [
    { label: t('features.sheets.insertRowBelow'), disabled: !editable, onSelect: () => insertRows(true) },
    { label: t('features.sheets.insertColRight'), disabled: !editable, onSelect: () => insertCols(true) },
    { label: t('features.sheets.autofit'), disabled: !editable, onSelect: () => autofit(Array.from({ length: sheet.cols }, (_, i) => i)) },
    { kind: 'separator' },
    {
      label: t('features.sheets.csvDownload'),
      onSelect: () => download(`${(a.title || t('features.sheets.label')).replace(/[\\/:*?"<>|]+/g, '-')} - ${sheet.name.replace(/[\\/:*?"<>|]+/g, '-')}.csv`, sheetCsv(a, sheet.id, lang)),
    },
    { label: t('features.sheets.csvImport'), disabled: !editable, onSelect: () => fileInput.current?.click() },
    { kind: 'separator' },
    { label: t('features.sheets.autocomplete'), hint: t(autoOn ? 'features.sheets.on' : 'features.sheets.off'), checked: autoOn, onSelect: () => setAutoComplete(!autoOn) },
  ]

  const importCsv = async (file: File) => {
    try {
      const rows = parseCSV(await file.text()).filter((r, i, all) => i < all.length - 1 || r.some((c) => c !== ''))
      if (!rows.length) throw new Error('empty')
      const width = Math.max(...rows.map((r) => r.length))
      const nr = Math.min(MAX_ROWS, Math.max(sheet.rows, rows.length))
      const nc = Math.min(MAX_COLS, Math.max(sheet.cols, width))
      const cells: Record<string, SheetCell> = {}
      rows.slice(0, nr).forEach((r, y) =>
        r.slice(0, nc).forEach((v, x) => {
          if (v) cells[a1(y, x)] = { v: canonicalInput(v, lang).v }
        }),
      )
      const s = aRef.current
      write({ sheets: s.sheets.map((x) => (x.id === sheet.id ? { ...x, rows: nr, cols: nc, cells } : x)) })
      if (rows.length > MAX_ROWS || width > MAX_COLS) toast({ message: t('features.sheets.csvTooBig', { rows: MAX_ROWS, cols: MAX_COLS }), kind: 'info' })
      else toast({ message: t('features.sheets.csvImported', { rows: Math.min(rows.length, nr) }), kind: 'success' })
    } catch {
      toast({ message: t('features.sheets.csvFailed'), kind: 'error' })
    }
  }

  /* ---------------- charts ---------------- */

  const chartInline = (sheetId: string) => (ref: string) => readSheetData(aRef.current, ref, { lang, sheetId })

  /** A new chart from the selection (several areas: a DS), or the sheet's used range for a single cell. */
  const newChart = () => {
    if (editRef.current) commit(null)
    const used = usedSize(sheet)
    const ref =
      areas.length > 1
        ? `DS(${areas.map((r) => rectText(r)).join('; ')})`
        : cellsOfRect(rect) > 1 || !used.rows
          ? rectText(rect)
          : rectText({ top: 0, left: 0, bottom: used.rows - 1, right: Math.max(0, used.cols - 1) })
    const sheetId = sheet.id
    openChartBuilder({
      source: { kind: 'inline', ref },
      allowedSources: ['inline'],
      pageId,
      inline: chartInline(sheetId),
      onSave: (spec: ChartSpec) => write({ charts: [...aRef.current.charts, { id: newId(), sheet: sheetId, spec: spec as unknown as Record<string, unknown> }] }),
    })
  }

  const editChart = (id: string) => {
    const chart = a.charts.find((c) => c.id === id)
    const spec = chart && chartSpec(chart)
    if (!chart || !spec) return
    openChartBuilder({
      initial: spec,
      source: spec.source,
      allowedSources: ['inline'],
      pageId,
      step: 'type',
      inline: chartInline(chart.sheet),
      onSave: (next: ChartSpec) => write({ charts: aRef.current.charts.map((c) => (c.id === id ? { ...c, spec: next as unknown as Record<string, unknown> } : c)) }),
    })
  }

  /* ---------------- render ---------------- */

  const datasetNames = a.datasets.map((d) => d.name)
  const barValue = edit ? edit.text : (activeCell?.v ?? '')
  const nameBox = areas.length > 1 ? `${rectText(rect)} +${areas.length - 1}` : cellsOfRect(rect) > 1 ? rectText(rect) : activeAddr
  const formulas = wb.formulaCount(sheet.id)
  const sheetIndex = a.sheets.indexOf(sheet)

  const fillTip = useMemo(() => {
    if (!fillDrag?.dest) return null
    const end = fillEndCell(a, sheet.id, fillDrag.src, fillDrag.dest, fillDrag.mode, lang)
    const raw = end?.cell?.v
    if (!end || !raw) return '—'
    if (raw[0] === '=') return raw
    const lit = literal(raw, end.cell?.fmt?.type)
    return formatValue(lit.value, end.cell?.fmt, lit.hint, lang)
  }, [fillDrag, a, sheet.id, lang])

  const fillView: FillView | null = editable
    ? {
        handle: !edit && !pick && areas.length === 1 && (!touchUI || focused) ? rect : null,
        preview: fillDrag?.dest ?? null,
        dir: fillDrag?.dest ? fillDirection(fillDrag.src, fillDrag.dest) : null,
        tip: fillTip,
        label: t('features.sheets.fill.handle'),
        onHandleDown: (e) => startFill(e, rect),
        touch: touchUI,
      }
    : null

  /* ---------------- touch: handles + action bar ---------------- */

  const handles: HandlesView | null = touchUI && (focused || touch.busy) && !edit && !pick ? { rect, onDown: touch.startHandle } : null
  const pointing = touchUI && !!edit && edit.sheetId === sheet.id && pointable(edit)
  const barMode = !touchUI || !focused || touch.busy || fillDrag || pick || ctx || panel ? null : edit ? (pointing ? 'point' : null) : 'select'
  const boundary = useRef<{ el: Element | null } | null>(null)
  // the page column the block lives in (looked up again when the block moved, e.g. into a peek)
  if (barMode && !(boundary.current && (boundary.current.el?.contains(rootRef.current) ?? true))) boundary.current = { el: scrollParent(rootRef.current) }

  /** What the bar floats over: the selection — while pointing, the grid (it sits in its bottom-right corner, off the formula). */
  const barBox = () => {
    const vp = viewportRef.current
    if (!vp) return null
    const v = vp.getBoundingClientRect()
    let box = barMode === 'point' ? new DOMRect(v.left + vp.clientLeft + RH_W, v.top + vp.clientTop + HEAD_H, vp.clientWidth - RH_W, vp.clientHeight - HEAD_H) : visibleBox(vp, sheetRef.current, rect)
    if (!box) return null
    // never over the column letters (they are touch targets too): above them when the selection starts right below
    const head = v.top + vp.clientTop
    if (barMode === 'select' && box.top - head - HEAD_H < BAR_ROOM) box = new DOMRect(box.left, head, box.width, box.bottom - head)
    // and inside the page column
    const col = boundary.current?.el?.getBoundingClientRect()
    if (!col) return box
    const top = Math.max(box.top, col.top)
    const bottom = Math.min(box.bottom, col.bottom)
    return bottom > top ? new DOMRect(box.left, top, box.width, bottom - top) : null
  }

  const bar = barMode
    ? sheetBarKeys({
        t,
        mode: barMode,
        editable,
        addArea,
        fillDown: !(rect.top === rect.bottom && rect.top === 0),
        fillRight: !(rect.left === rect.right && rect.left === 0),
        on: {
          copy: () => {
            copy(null, false)
            toast({ message: t('features.sheets.touch.copied', { ref: rectText(rect) }), kind: 'success' })
          },
          cut: () => {
            copy(null, true)
            toast({ message: t('features.sheets.touch.cutDone', { ref: rectText(rect) }), kind: 'success' })
          },
          paste: pasteFromClipboard,
          fillDown,
          fillRight,
          clear,
          chart: newChart,
          area: () => setAddArea(!addAreaRef.current),
          more: (el) => {
            const box = el.getBoundingClientRect()
            setCtx({ x: box.left, y: box.bottom, target: { kind: 'cell', pos: active } })
          },
        },
      })
    : null

  const cellEditor =
    edit && edit.where === 'cell' && edit.sheetId === sheet.id ? (
      <FormulaInput
        value={edit.text}
        caret={edit.caret}
        inputRef={cellInput}
        active
        datasets={datasetNames}
        lang={lang}
        ariaLabel={t('features.sheets.cellEditor', { addr: a1(edit.r, edit.c) })}
        className="fx-input--cell"
        style={{ width: Math.min(560, Math.max(colWidth(sheet, edit.c), (completion ?? edit.text).length * 7.6 + 24)) }}
        ghost={completion}
        onChange={setText}
        onCaret={setCaret}
        onKeyDown={editKey}
        onBlur={editBlur}
      />
    ) : null

  return (
    <div
      ref={rootRef}
      className={`sheet${editable ? '' : ' is-readonly'}${touchUI ? ' is-touch' : ''}${touch.busy ? ' is-gesture' : ''}`}
      data-sheet-block=""
      onPointerDownCapture={(e) => {
        if (!(e.target as Element).closest('[data-sel-handle]')) setTouchUI(e.pointerType === 'touch')
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <Toolbar
        title={a.title}
        cell={activeCell}
        frozen={!!sheet.frozenRows}
        editable={editable}
        showDS={showDS}
        hasCharts
        t={t}
        onTitle={(title) => write({ title })}
        onToggle={toggle}
        onAlign={setAlign}
        onFormat={setFormat}
        onDecimals={setDecimals}
        onFreeze={() => op(setSheet(a, sheet.id, { frozenRows: sheet.frozenRows ? 0 : 1 }))}
        onToggleDS={() => setShowDS((v) => !v)}
        onOpen={(kind, anchor) => (kind === 'chart' ? newChart() : setPanel((p) => (p?.kind === kind ? null : { kind, anchor })))}
        more={moreEntries}
      />
      <div className="sh-bar">
        <span className="sh-bar__ref" aria-label={t('features.sheets.cellRef')} title={t('features.sheets.cellRef')}>
          {nameBox}
        </span>
        <span className="sh-bar__fx" aria-hidden>
          fx
        </span>
        <FormulaInput
          value={barValue}
          caret={edit?.where === 'bar' ? edit.caret : barValue.length}
          inputRef={barInput}
          active={edit?.where === 'bar'}
          datasets={datasetNames}
          lang={lang}
          readOnly={!editable}
          ariaLabel={t('features.sheets.formula')}
          className="fx-input--bar"
          onFocus={() => {
            if (!editable) return
            const cur = editRef.current
            if (cur) setEdit({ ...cur, where: 'bar' })
            else setEdit({ r: active.r, c: active.c, sheetId: sheet.id, text: activeCell?.v ?? '', caret: (activeCell?.v ?? '').length, where: 'bar', fresh: false, point: null, auto: false })
          }}
          ghost={completion}
          onChange={setText}
          onCaret={setCaret}
          onKeyDown={editKey}
          onBlur={editBlur}
        />
      </div>
      <Grid
        sheet={sheet}
        wb={wb}
        version={version}
        lang={lang}
        t={t}
        overlays={overlays}
        selRows={[rect.top, rect.bottom]}
        selCols={[rect.left, rect.right]}
        editCell={edit && edit.where === 'cell' && edit.sheetId === sheet.id ? { r: edit.r, c: edit.c } : null}
        editorNode={cellEditor}
        viewportRef={viewportRef}
        editable={editable}
        fill={fillView}
        handles={handles}
        runout={touchUI ? RUNOUT : 0}
        height={Math.min(GRID_MAX, HEAD_H + Math.max(...a.sheets.map((x) => x.rows)) * ROW_HEIGHT + 2 + (touchUI ? RUNOUT : 0))}
        onPointer={onPointer}
        onDouble={(pos) => {
          if (editRef.current || touch.aftermath()) return
          setSel({ anchor: pos, focus: pos, extra: [] })
          startEdit(pos)
        }}
        onContext={(target, e) => {
          e.preventDefault()
          // a finger held on the grid is a long press (range selection): the cell menu is ⋯ on the touch bar
          if (touch.quietContext() || (e.nativeEvent as PointerEvent).pointerType === 'touch') return
          if (target.kind === 'cell') {
            const inside = areas.some((r) => target.pos.r >= r.top && target.pos.r <= r.bottom && target.pos.c >= r.left && target.pos.c <= r.right)
            if (!inside) setSel({ anchor: target.pos, focus: target.pos, extra: [] })
          }
          setCtx({ x: e.clientX, y: e.clientY, target })
        }}
        onResize={(col, w) => op(setColWidth(a, sheet.id, col, w))}
        onAutofit={(col) => autofit(rect.left <= col && col <= rect.right && cellsOfRect(rect) > 1 ? Array.from({ length: colsSel }, (_, i) => rect.left + i) : [col])}
        gridProps={{
          tabIndex: 0,
          role: 'grid',
          'aria-label': a.title || t('features.sheets.grid'),
          'aria-rowcount': sheet.rows + 1,
          'aria-colcount': sheet.cols + 1,
          'aria-multiselectable': true,
          onKeyDown: gridKey,
          onPointerDown: touch.onPointerDown,
          onCopy: (e) => {
            if (e.target === viewportRef.current) copy(e, false)
          },
          onCut: (e) => {
            if (e.target !== viewportRef.current || !editable) return
            copy(e, true)
          },
          onPaste: (e) => {
            if (e.target !== viewportRef.current) return
            e.preventDefault()
            pasteText(e.clipboardData.getData('text/plain'))
          },
        }}
      />
      <Charts
        attrs={a}
        sheetId={sheet.id}
        version={version}
        editable={editable}
        lang={lang}
        t={t}
        onEdit={(c) => editChart(c.id)}
        onDuplicate={(c) => {
          const i = a.charts.indexOf(c)
          write({ charts: [...a.charts.slice(0, i + 1), { ...c, id: newId() }, ...a.charts.slice(i + 1)] })
        }}
        onDelete={(c) => write({ charts: a.charts.filter((x) => x.id !== c.id) })}
        onPlace={(c) => {
          const spec = chartSpec(c)
          if (!spec || spec.source.kind !== 'inline' || !pageId || !a.id) return
          insertAfter({ type: 'chart', attrs: { spec: { ...spec, source: { kind: 'sheet', pageId, sheetBlockId: a.id, ref: qualifiedRef(a, c, spec.source.ref) } } } })
        }}
      />
      <div className="sh-foot">
        <SheetTabs
          sheets={a.sheets}
          active={sheet.id}
          editable={editable}
          t={t}
          onSelect={selectSheet}
          onAdd={() => {
            if (editRef.current) commit(null)
            op(addSheet(a, t('features.sheets.newSheet', { n: a.sheets.length + 1 })))
          }}
          onRename={(id, name) => {
            const p = sheetNameProblem(a, name, id)
            if (p === 'empty') return null
            if (p) return `features.sheets.sheetName.${p}`
            op(renameSheet(a, id, name))
            return null
          }}
          onDuplicate={(id) => op(duplicateSheet(a, id, t('features.sheets.copySuffix')))}
          onDelete={(id) => {
            const s = a.sheets.find((x) => x.id === id)
            if (!s) return
            confirm(t('features.sheets.deleteSheet.title', { name: s.name }), t('features.sheets.deleteSheet.body'), () => write(deleteSheet(aRef.current, id)))
          }}
          onMove={(id, to) => op(moveSheet(a, id, to))}
        />
        <div className="sh-status" aria-live="polite">
          {status ? (
            <span className="sh-status__calc">
              {status.count > 0 && (
                <>
                  <span>
                    {t('features.sheets.status.sum')} <b>{statusNum(status.sum)}</b>
                  </span>
                  <span>
                    {t('features.sheets.status.avg')} <b>{status.avg === null ? '—' : statusNum(status.avg)}</b>
                  </span>
                </>
              )}
              <span>
                {t('features.sheets.status.count')} <b>{status.count}</b>
              </span>
            </span>
          ) : (
            <span className="sh-status__spec">
              {t(formulas === 1 ? 'features.sheets.status.spec1' : 'features.sheets.status.spec', { n: String(sheetIndex + 1).padStart(2, '0'), rows: sheet.rows, cols: sheet.cols, formulas })}
            </span>
          )}
          {editable && (
            <span className="sh-status__add">
              <button type="button" className="sh-status__btn" title={t('features.sheets.addRows.title')} onClick={() => op(setSheet(a, sheet.id, { rows: Math.min(MAX_ROWS, sheet.rows + 10) }))}>
                + {t('features.sheets.addRows')}
              </button>
              <button type="button" className="sh-status__btn" title={t('features.sheets.addCol.title')} onClick={() => op(setSheet(a, sheet.id, { cols: Math.min(MAX_COLS, sheet.cols + 1) }))}>
                + {t('features.sheets.addCol')}
              </button>
            </span>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importCsv(f)
        }}
      />
      {barMode && bar && (
        <TouchBar
          getBox={barBox}
          boxKey={`${barMode}:${sheet.id}:${rectText(rect)}:${areas.length}`}
          contextElement={viewportRef.current}
          boundary={boundary.current?.el ?? null}
          groups={bar.groups}
          more={bar.more}
          label={t('features.sheets.touch.bar')}
          placement={barMode === 'point' ? 'inside' : 'over'}
        />
      )}
      {ctx && (
        <Menu
          open
          anchor={pointAnchor(ctx.x, ctx.y)}
          onClose={() => {
            setCtx(null)
            // the keyboard goes back to the grid — unless something else took it (a click elsewhere, a pick list)
            requestAnimationFrame(() => {
              const el = document.activeElement
              if (!el || el === document.body) focusGrid()
            })
          }}
          entries={cellEntries}
        />
      )}
      {pick && <PickList anchor={pick.anchor} entries={pick.entries} column={colName(pick.c)} initial={pick.initial} t={t} onPick={pickValue} onClose={closePick} />}
      {panel?.kind === 'fx' && (
        <FunctionBrowser
          anchor={panel.anchor}
          lang={lang}
          t={t}
          onClose={() => setPanel(null)}
          onInsert={(name) => insertAtCaret(`${name}(`)}
          onEditFunctions={editable ? () => openFunctionBuilder() : undefined}
        />
      )}
      {panel?.kind === 'ds' && (
        <DatasetsPanel
          anchor={panel.anchor}
          onClose={() => setPanel(null)}
          datasets={a.datasets}
          sheets={a.sheets}
          activeSheet={sheet.id}
          selection={selectionRanges}
          editable={editable}
          t={t}
          onCreate={(name) => {
            const err = dsError(name)
            if (err) return err
            const used = new Set(a.datasets.map((d) => d.color))
            const color: ColorName = (['blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray'] as ColorName[]).find((c) => !used.has(c)) ?? 'blue'
            op(upsertDataset(a, { id: newId(), name, color, ranges: selectionRanges }))
            return null
          }}
          onRename={(id, name) => {
            const err = dsError(name, id)
            if (err) return err
            op(renameDataset(a, id, name))
            return null
          }}
          onRecolor={(id, color) => {
            const d = a.datasets.find((x) => x.id === id)
            if (d) op(upsertDataset(a, { ...d, color }))
          }}
          onUseSelection={(id) => {
            const d = a.datasets.find((x) => x.id === id)
            if (d) op(upsertDataset(a, { ...d, ranges: selectionRanges }))
          }}
          onDelete={(id) => {
            const d = a.datasets.find((x) => x.id === id)
            if (!d) return
            const n = datasetUsers(a, d.name).length
            const body = n === 0 ? t('features.sheets.ds.deleteBodyNone') : n === 1 ? t('features.sheets.ds.deleteBody1') : t('features.sheets.ds.deleteBody', { n })
            setPanel(null)
            confirm(t('features.sheets.ds.deleteTitle', { name: d.name }), body, () => write(deleteDataset(aRef.current, id)))
          }}
          onInsert={(name) => {
            setPanel(null)
            insertAtCaret(`DS(${name})`)
          }}
        />
      )}
    </div>
  )
}

/** A stored range on a sheet as a rectangle (whole columns: to the sheet's end). */
function parseRef(ref: string, sheet: SheetData): Rect | null {
  const r = parseRect(ref)
  return r ? { ...r, bottom: Math.min(r.bottom, sheet.rows - 1) } : null
}
