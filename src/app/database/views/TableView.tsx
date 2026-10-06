/**
 * Table view: sticky header (type icons, resize, drag-reorder, header menu), sticky title column,
 * keyboard cell navigation + editors for every type, row selection + bulk actions, drag rows,
 * collapsible groups, footer calculations, row virtualization.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Copy, GripVertical, PencilLine, Plus, Shapes, Trash, X } from 'lucide-react'
import type { ColorRule, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { useModel, type DbModel } from '../hooks'
import { useViewActions, useCollapsed, GroupLabel, EmptyState } from './shared'
import { Checkbox, OpenButton, RowTitle, ValueView } from '../cells/display'
import { ValueEditor, canEdit } from '../cells/ValueEditor'
import { parseNumberInput, type DoneReason } from '../cells/TextEditor'
import { PropertyMenu } from '../properties/PropertyMenu'
import { Menu, TypeIcon, typeEntries } from '../parts'
import { deleteRows, duplicateRows, insertProperty, orderBetween, writeValue } from '../model/actions'
import { valueForGroupMove, NONE_KEY, type RowGroup } from '../model/query'
import { ADD_COL, FILL_MIN, ROW_H, buildItems, colWidth, minWidth, offsetsOf, scrollParent, type Item } from './table/layout'
import { useWindow } from './virtual'
import { revealInStrip } from './overflow'
import { CalcCell } from './table/CalcCell'
import { pointAnchor } from '../../ui/Popover'
import { parseDateText } from '../model/format'
import { AutofillCellMark, AutofillTag, autofillOf, startFill } from '../autofill'
import { useRowColor, useTree } from './tree'
import { AddSubButton, TreeCount, TreeLead } from './treeParts'
import { ruleStyle } from '../model/colors'
import { usePropertyCreate } from '../create/entry'
import { TYPE_PROP_ID, foreignLabel, foreignTo, isTypeProp, setRowType } from '../model/recordTypes'
import { TypeCell, TypeColumnMenu } from '../rtype/TypeColumn'
import { typeEntries as rtypeEntries } from '../rtype/TypeTag'
import './table/table.css'

function useNarrow(): boolean {
  const q = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

interface Active {
  idx: number
  col: number
}

interface Boundary {
  y: number
  before?: Page
  after?: Page
  group: string | null
}

/** Interpret pasted text for a property (undefined = can't). */
function valueFromText(p: PropertyDef, text: string): PropertyValue | undefined {
  const s = text.trim()
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return p.type === 'title' ? s.replace(/\s*\n\s*/g, ' ') : text
    case 'number': {
      const n = parseNumberInput(s, p.numberFormat === 'percent')
      return n === null && s ? undefined : n
    }
    case 'checkbox':
      return ['true', 'yes', 'ja', '1', 'x', '✓'].includes(s.toLowerCase())
    case 'select':
    case 'status':
      return p.options?.find((o) => o.name.toLowerCase() === s.toLowerCase())?.id ?? undefined
    case 'multi_select': {
      const ids = s.split(',').map((x) => p.options?.find((o) => o.name.toLowerCase() === x.trim().toLowerCase())?.id).filter((x): x is string => !!x)
      return ids.length ? ids : undefined
    }
    case 'rating': {
      const n = parseInt(s, 10)
      return Number.isFinite(n) ? Math.max(0, Math.min(p.ratingMax ?? 5, n)) : undefined
    }
    case 'date':
      return s ? parseDateText(s, useWorkspace.getState().settings.language) ?? undefined : null
    case 'person': {
      const people = useWorkspace.getState().people
      const ids = s
        .split(/[,;\n]/)
        .map((x) => people.find((pp) => pp.name.toLowerCase() === x.trim().toLowerCase())?.id)
        .filter((x): x is string => !!x)
      return ids.length ? [...new Set(ids)] : undefined
    }
  }
  return undefined
}

const clearValueFor = (p: PropertyDef) =>
  p.type === 'multi_select' || p.type === 'person' || p.type === 'relation' || p.type === 'files' ? [] : p.type === 'checkbox' ? false : ['title', 'text', 'url', 'email', 'phone'].includes(p.type) ? '' : null

export function TableView({ onFilterProp }: { onFilterProp: (id: ID) => void }) {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const { db, view } = m
  const narrow = useNarrow()
  // view only: read, select text, open rows, copy — nothing that writes
  const ro = m.readOnly
  const [widthOverride, setWidthOverride] = useState<Record<ID, number> | null>(null)
  const cols = useMemo(() => [m.titleProp, ...m.visibleProps], [m.titleProp, m.visibleProps])
  const widths = cols.map((p) => colWidth(view, p, widthOverride ?? undefined, narrow))
  const gutter = narrow ? 34 : 64
  const template = `${gutter}px ${widths.map((w) => `${w}px`).join(' ')} ${ADD_COL}px minmax(${FILL_MIN}px, 1fr)`

  const [collapsed, toggleCollapsed] = useCollapsed(view.id)
  const tree = useTree(m)
  const colorOf = useRowColor(m)
  const hiddenKey = (view.hiddenGroups ?? []).join('|')
  const collapsedKey = [...collapsed].join('|')
  const items = useMemo(
    () => buildItems(m.rows, m.groups, new Set(view.hiddenGroups ?? []), collapsed, ROW_H, Object.values(view.calculations ?? {}).some((f) => f !== 'none'), tree.nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.rows, m.groups, hiddenKey, collapsedKey, view.calculations, tree.nodes],
  )
  const offsets = useMemo(() => offsetsOf(items), [items])
  const rowItems = useMemo(() => items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === 'row') as Array<{ it: Extract<Item, { kind: 'row' }>; i: number }>, [items])
  const virtual = !view.wrapCells && items.length > 60

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const headScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  /* ---------- virtualization ---------- */
  const [start, end] = useWindow(bodyRef, offsets, virtual, 520)

  /* ---------- selection / active / editing ---------- */
  const [sel, setSel] = useState<Set<ID>>(() => new Set())
  const lastSel = useRef<number | null>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [editing, setEditing] = useState<{ rows: Page[]; prop: PropertyDef; el: HTMLElement; text?: string; idx?: number; col?: number } | null>(null)
  const [headMenu, setHeadMenu] = useState<{ prop: PropertyDef; el: HTMLElement } | null>(null)
  const [typeMenu, setTypeMenu] = useState<{ row: Page; el: HTMLElement } | null>(null)
  const [addColAnchor, setAddColAnchor] = useState<HTMLElement | null>(null)
  const [bulkAnchor, setBulkAnchor] = useState<HTMLElement | null>(null)
  const createEntry = usePropertyCreate(db)

  useEffect(() => {
    if (!sel.size) return
    const ids = new Set(m.rows.map((r) => r.id))
    if ([...sel].some((id) => !ids.has(id))) setSel(new Set([...sel].filter((id) => ids.has(id))))
  }, [m.rows, sel])
  // the selection, for database commands started from the toolbar (an empty one when this view goes)
  const publishSel = actions.setSelection
  useEffect(() => publishSel?.([...sel]), [sel, publishSel])
  useEffect(() => () => publishSel?.([]), [publishSel])

  const cellEl = useCallback((idx: number, col: number) => rootRef.current?.querySelector<HTMLElement>(`[data-cell="${idx}:${col}"]`) ?? null, [])

  const ensureVisible = useCallback(
    (idx: number, col?: number) => {
      const ri = rowItems[idx]
      const body = bodyRef.current
      if (!ri || !body) return
      const rect = body.getBoundingClientRect()
      const top = rect.top + offsets[ri.i]
      const bottom = top + ri.it.h
      const sp = scrollParent(rootRef.current)
      const viewTop = (sp ? sp.getBoundingClientRect().top : 0) + 80
      const viewBottom = sp ? sp.getBoundingClientRect().bottom : window.innerHeight
      const delta = top < viewTop ? top - viewTop : bottom > viewBottom - 8 ? bottom - viewBottom + 48 : 0
      if (delta) {
        if (sp) sp.scrollTop += delta
        else window.scrollBy(0, delta)
      }
      if (col !== undefined)
        requestAnimationFrame(() => {
          const el = cellEl(idx, col)
          const sc = bodyScrollRef.current
          if (!el || !sc || col === 0) return
          const er = el.getBoundingClientRect()
          const sr = sc.getBoundingClientRect()
          const stickyW = gutter + widths[0]
          if (er.left < sr.left + stickyW) sc.scrollLeft -= sr.left + stickyW - er.left
          else if (er.right > sr.right) sc.scrollLeft += er.right - sr.right
        })
    },
    [rowItems, offsets, cellEl, gutter, widths],
  )

  const focusGrid = () => rootRef.current?.focus({ preventScroll: true })

  const startEdit = useCallback(
    (idx: number, col: number, text?: string) => {
      const ri = rowItems[idx]
      const prop = cols[col]
      if (!ri || !prop || !canEdit(prop) || ro) return
      // another record type's property: not part of this row (model/recordTypes)
      if (foreignTo(prop, ri.it.row)) return
      if (prop.id === TYPE_PROP_ID) {
        const el = cellEl(idx, col)
        if (el) setTypeMenu({ row: ri.it.row, el })
        return
      }
      if (prop.type === 'checkbox') {
        writeValue(db.id, prop, ri.it.row.id, !(ri.it.row.properties[prop.id] === true))
        return
      }
      const el = cellEl(idx, col)
      if (!el) return
      setEditing({ rows: [ri.it.row], prop, el, text, idx, col })
    },
    [rowItems, cols, db.id, cellEl, ro],
  )

  const move = (idx: number, col: number) => {
    const ni = Math.max(0, Math.min(rowItems.length - 1, idx))
    const nc = Math.max(0, Math.min(cols.length - 1, col))
    setActive({ idx: ni, col: nc })
    ensureVisible(ni, nc)
  }

  const onEditorClose = (reason?: DoneReason) => {
    const cur = editing
    setEditing(null)
    if (reason === 'outside') return
    requestAnimationFrame(focusGrid)
    if (cur?.idx !== undefined && cur.col !== undefined) {
      if (reason === 'tab') move(cur.col + 1 >= cols.length ? cur.idx + 1 : cur.idx, cur.col + 1 >= cols.length ? 0 : cur.col + 1)
      if (reason === 'shiftTab') move(cur.idx, cur.col - 1)
    }
  }

  /* new row → edit title */
  useEffect(() => {
    const id = actions.editTitleOf
    if (!id) return
    const idx = rowItems.findIndex((x) => x.it.row.id === id)
    if (idx < 0) {
      // exists but not on screen (collapsed / hidden group): don't pop an editor up later
      if (m.allRows.some((r) => r.id === id)) actions.clearEditTitle()
      return
    }
    actions.clearEditTitle()
    setActive({ idx, col: 0 })
    ensureVisible(idx, 0)
    let tries = 0
    const tick = () => {
      const el = cellEl(idx, 0)
      if (el) setEditing({ rows: [rowItems[idx].it.row], prop: cols[0], el, idx, col: 0 })
      else if (tries++ < 10) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [actions, rowItems, cols, cellEl, ensureVisible, m.allRows])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    if (!rootRef.current?.contains(e.target as Node)) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSel(new Set(m.rows.map((r) => r.id)))
      return
    }
    if (e.key === 'Escape') {
      if (sel.size) setSel(new Set())
      else setActive(null)
      return
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel.size && !ro) {
      e.preventDefault()
      deleteRows([...sel])
      setSel(new Set())
      return
    }
    if (!active) {
      if (e.key.startsWith('Arrow') && rowItems.length) {
        e.preventDefault()
        move(0, 0)
      } else if (e.key === 'Enter' && !rowItems.length && !ro) {
        e.preventDefault()
        actions.newRow({ editTitle: true })
      }
      return
    }
    const idx = Math.min(active.idx, rowItems.length - 1)
    const col = Math.min(active.col, cols.length - 1)
    if (idx < 0 || col < 0) return
    if (e.altKey && !mod && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      // Alt+→ / Alt+← open and close a row's sub-items
      const node = rowItems[idx]?.it.node
      e.preventDefault()
      if (node?.childCount && node.expanded !== (e.key === 'ArrowRight')) tree.toggle(node.row.id)
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (e.shiftKey) toggleSel(idx + 1, true)
        move(idx + 1, col)
        return
      case 'ArrowUp':
        e.preventDefault()
        if (e.shiftKey) toggleSel(idx - 1, true)
        move(idx - 1, col)
        return
      case 'ArrowLeft':
        e.preventDefault()
        move(idx, col - 1)
        return
      case 'ArrowRight':
        e.preventDefault()
        move(idx, col + 1)
        return
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) move(col === 0 ? idx - 1 : idx, col === 0 ? cols.length - 1 : col - 1)
        else move(col + 1 >= cols.length ? idx + 1 : idx, col + 1 >= cols.length ? 0 : col + 1)
        return
      case 'Enter':
        e.preventDefault()
        if (e.altKey && !mod) {
          // Alt+Enter: fill the active cell with AI (autofilled properties)
          const ri = rowItems[idx]
          if (ri && autofillOf(cols[col]) && !ro) void startFill(db.id, cols[col].id, 'cell', [ri.it.row.id])
          return
        }
        if (mod || ro) {
          const ri = rowItems[idx]
          if (ri) actions.open(ri.it.row)
          return
        }
        startEdit(idx, col)
        return
      case ' ': {
        e.preventDefault()
        const ri = rowItems[idx]
        if (!ri) return
        if (cols[col].type === 'checkbox' && !ro) startEdit(idx, col)
        else actions.open(ri.it.row)
        return
      }
      case 'Backspace':
      case 'Delete': {
        e.preventDefault()
        const ri = rowItems[idx]
        const p = cols[col]
        if (ri && canEdit(p) && !ro && !foreignTo(p, ri.it.row)) writeValue(db.id, p, ri.it.row.id, clearValueFor(p))
        return
      }
    }
    if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
      const ri = rowItems[idx]
      if (!ri) return
      e.preventDefault()
      const text = m.resolver.text(db, cols[col], ri.it.row)
      void navigator.clipboard?.writeText(text)
      if (e.key.toLowerCase() === 'x' && canEdit(cols[col]) && !ro && !foreignTo(cols[col], ri.it.row)) writeValue(db.id, cols[col], ri.it.row.id, clearValueFor(cols[col]))
      return
    }
    if (mod && e.key.toLowerCase() === 'v') {
      const ri = rowItems[idx]
      const p = cols[col]
      if (!ri || !canEdit(p) || ro || foreignTo(p, ri.it.row) || !navigator.clipboard?.readText) return
      e.preventDefault()
      void navigator.clipboard.readText().then((text) => {
        const v = valueFromText(p, text)
        if (v !== undefined) writeValue(db.id, p, ri.it.row.id, v)
      })
      return
    }
    if (e.key.length === 1 && !mod && !e.altKey && !ro) {
      const p = cols[col]
      if (['title', 'text', 'number', 'url', 'email', 'phone', 'select', 'multi_select', 'status', 'person', 'relation'].includes(p.type)) {
        e.preventDefault()
        startEdit(idx, col, e.key)
      }
    }
  }

  const toggleSel = (idx: number, add?: boolean, range?: boolean) => {
    const ri = rowItems[idx]
    if (!ri) return
    // read the anchor now: the updater runs later, after lastSel has moved on to idx
    const from = lastSel.current
    setSel((cur) => {
      const next = new Set(cur)
      if (range && from !== null && rowItems[from]) {
        const [a, b] = [Math.min(from, idx), Math.max(from, idx)]
        for (let i = a; i <= b; i++) next.add(rowItems[i].it.row.id)
      } else if (add) next.add(ri.it.row.id)
      else if (next.has(ri.it.row.id)) next.delete(ri.it.row.id)
      else next.add(ri.it.row.id)
      return next
    })
    lastSel.current = idx
  }

  /* ---------- column resize ---------- */
  const startResize = (e: React.PointerEvent, col: number) => {
    e.preventDefault()
    e.stopPropagation()
    const prop = cols[col]
    const startX = e.clientX
    const startW = widths[col]
    let w = startW
    const onMove = (ev: PointerEvent) => {
      w = Math.max(minWidth(prop), Math.round(startW + ev.clientX - startX))
      setWidthOverride((cur) => ({ ...(cur ?? {}), [prop.id]: w }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('db-resizing')
      if (w !== startW) useWorkspace.getState().updateView(db.id, view.id, { propertyWidths: { ...(view.propertyWidths ?? {}), [prop.id]: w } })
      setWidthOverride(null)
    }
    document.body.classList.add('db-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /* ---------- column drag ---------- */
  const [colDrag, setColDrag] = useState<{ from: number; dx: number; to: number; x: number; top: number } | null>(null)
  const onHeadPointerDown = (e: React.PointerEvent<HTMLElement>, col: number) => {
    if (e.button !== 0 || ro) return
    const el = e.currentTarget
    const startX = e.clientX
    let dragging = false
    let to = col
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      // locked: a click still opens the column menu (sort / filter), columns don't move
      if (!dragging && (Math.abs(dx) < 5 || col === 0 || m.fixed)) return
      dragging = true
      const cells = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.dbt-hcell') ?? [])
      const rootLeft = rootRef.current!.getBoundingClientRect().left
      let best = { d: Infinity, to: col, x: 0 }
      cells.forEach((c, j) => {
        if (j === 0) return
        const r = c.getBoundingClientRect()
        const d1 = Math.abs(ev.clientX - r.left)
        if (d1 < best.d) best = { d: d1, to: j, x: r.left - rootLeft }
        if (j === cells.length - 1) {
          const d2 = Math.abs(ev.clientX - r.right)
          if (d2 < best.d) best = { d: d2, to: j + 1, x: r.right - rootLeft }
        }
      })
      to = best.to
      setColDrag({ from: col, dx, to, x: best.x, top: headScrollRef.current?.offsetTop ?? 0 })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setColDrag(null)
      if (!dragging) {
        setHeadMenu({ prop: cols[col], el })
        return
      }
      if (to === col || to === col + 1) return
      const ids = m.visibleProps.map((p) => p.id)
      const moving = ids[col - 1]
      const without = ids.filter((x) => x !== moving)
      const insertAt = to - 1 > col - 1 ? to - 2 : to - 1
      without.splice(insertAt, 0, moving)
      const rest = view.visibleProperties.filter((x) => !without.includes(x))
      useWorkspace.getState().updateView(db.id, view.id, { visibleProperties: [...without, ...rest] })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /* ---------- row drag ---------- */
  const [rowDrag, setRowDrag] = useState<{ row: Page; from: string | null; b: Boundary | null } | null>(null)
  const boundaries = useMemo(() => {
    const out: Boundary[] = []
    items.forEach((it, i) => {
      if (it.kind === 'row') {
        out.push({ y: offsets[i], before: it.row, group: it.groupKey })
        if (items[i + 1]?.kind !== 'row') out.push({ y: offsets[i + 1], after: it.row, group: it.groupKey })
      } else if (it.kind === 'add' && it.group && items[i - 1]?.kind === 'group') out.push({ y: offsets[i], group: it.group.key })
    })
    return out
  }, [items, offsets])
  const sorted = view.sorts.length > 0
  const onGripDown = (e: React.PointerEvent, row: Page, from: string | null) => {
    if (e.button !== 0 || ro) return
    e.preventDefault()
    const startY = e.clientY
    let dragging = false
    let current: Boundary | null = null
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) < 4) return
      dragging = true
      const body = bodyRef.current
      if (!body) return
      const y = ev.clientY - body.getBoundingClientRect().top
      let best: Boundary | null = null
      let bd = Infinity
      for (const b of boundaries) {
        if (sorted && b.group === from) continue
        const d = Math.abs(b.y - y)
        if (d < bd) {
          bd = d
          best = b
        }
      }
      current = best
      setRowDrag({ row, from, b: best })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('db-dragging')
      setRowDrag(null)
      if (!dragging) {
        actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
        return
      }
      if (current) dropRow(row, from, current)
    }
    document.body.classList.add('db-dragging')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const dropRow = (row: Page, from: string | null, b: Boundary) => {
    const s = useWorkspace.getState()
    if (!sorted) {
      const ordered = m.allRows.filter((r) => r.id !== row.id)
      let order: number | undefined
      if (b.before && b.before.id !== row.id) {
        const i = ordered.findIndex((r) => r.id === b.before!.id)
        order = orderBetween(ordered[i - 1], b.before)
      } else if (b.after && b.after.id !== row.id) {
        const i = ordered.findIndex((r) => r.id === b.after!.id)
        order = orderBetween(b.after, ordered[i + 1])
      }
      if (order !== undefined) s.updatePage(row.id, { order })
    }
    const gp = m.groupProp
    if (gp && b.group !== null && b.group !== from) {
      const fresh = useWorkspace.getState().pages[row.id]
      const v = valueForGroupMove(gp, fresh?.properties[gp.id], from, b.group)
      if (v !== undefined) writeValue(db.id, gp, row.id, v)
    }
  }

  /* ---------- scroll sync + viewport width ---------- */
  const onBodyScroll = () => {
    const b = bodyScrollRef.current
    if (!b) return
    if (headScrollRef.current) headScrollRef.current.scrollLeft = b.scrollLeft
    const scrolled = b.scrollLeft > 0 ? 'true' : 'false'
    if (rootRef.current && rootRef.current.dataset.scrolled !== scrolled) rootRef.current.dataset.scrolled = scrolled
  }
  useEffect(() => {
    const b = bodyScrollRef.current
    const root = rootRef.current
    if (!b || !root) return
    const ro = new ResizeObserver(() => root.style.setProperty('--dbt-vw', `${b.clientWidth}px`))
    ro.observe(b)
    return () => ro.disconnect()
  }, [])

  const groupPresets = (g: RowGroup | null) => {
    if (!g || !m.groupProp) return {}
    const v = valueForGroupMove(m.groupProp, undefined, null, g.key)
    return v === undefined || g.key === NONE_KEY ? {} : { [m.groupProp.id]: v }
  }

  const selectedRows = m.rows.filter((r) => sel.has(r.id))
  const allSelected = m.rows.length > 0 && sel.size === m.rows.length
  const editableProps = db.properties.filter((p) => canEdit(p) && p.type !== 'title')

  const renderItem = (it: Item) => {
    switch (it.kind) {
      case 'empty':
        return (
          <div key={it.key} className="dbt-emptyrow" style={{ height: it.h }}>
            <EmptyState onAdd={ro ? undefined : () => actions.newRow({ editTitle: true })} />
          </div>
        )
      case 'group': {
        const g = it.group
        const isCollapsed = collapsed.has(g.key)
        return (
          <div key={it.key} className="dbt-grouprow" style={{ height: it.h }}>
            <div className="dbt-grouphead">
              <button type="button" className="icon-btn icon-btn--sm dbt-grouphead__chev" data-open={!isCollapsed} aria-expanded={!isCollapsed} aria-label={g.label} onClick={() => toggleCollapsed(g.key)}>
                <ChevronRight size={14} />
              </button>
              <GroupLabel group={g} />
              <span className="dbt-grouphead__count">{g.rows.length}</span>
              {!ro && (
                <button type="button" className="icon-btn icon-btn--sm dbt-grouphead__add" aria-label={t('database.new.inGroup')} onClick={() => actions.newRow({ editTitle: true, properties: groupPresets(g) })}>
                  <Plus size={14} />
                </button>
              )}
            </div>
          </div>
        )
      }
      case 'add':
        return (
          <div key={it.key} className="dbt-addrowwrap" style={{ height: it.h }}>
            {!ro && (
              <button type="button" className="dbt-addrow" onClick={() => actions.newRow({ editTitle: true, properties: groupPresets(it.group) })}>
                <Plus size={14} /> <span>{t('common.new')}</span>
              </button>
            )}
          </div>
        )
      case 'calc':
        return (
          <div key={it.key} className="dbt-row dbt-row--calc" style={{ height: it.h }}>
            <div className="dbt-gutter dbt-sticky0" />
            {cols.map((p, c) => (
              <div key={p.id} className={`dbt-cell dbt-cell--calc${c === 0 ? ' dbt-sticky1' : ''}`} style={c === 0 ? { left: gutter } : undefined}>
                <CalcCell prop={p} rows={it.rows} />
              </div>
            ))}
            <div className="dbt-cell dbt-cell--pad" />
            <div className="dbt-cell dbt-cell--fill" />
          </div>
        )
      case 'row': {
        const ri = it.index
        return (
          <TableRow
            key={it.key}
            m={m}
            row={it.row}
            idx={ri}
            cols={cols}
            gutter={gutter}
            height={view.wrapCells ? undefined : it.h}
            wrap={!!view.wrapCells}
            selected={sel.has(it.row.id)}
            anySelected={sel.size > 0}
            activeCol={active?.idx === ri ? active.col : -1}
            editingCol={editing?.idx === ri ? editing.col ?? -1 : -1}
            dragging={rowDrag?.row.id === it.row.id}
            openLabel={t('database.open')}
            groupKey={it.groupKey}
            handlers={rowHandlers}
            nested={!!it.node}
            depth={it.node?.depth ?? 0}
            kids={it.node?.childCount ?? 0}
            open={!!it.node?.expanded}
            dimmed={!!it.node?.dimmed}
            last={!!it.node?.last}
            rails={it.node?.rails ?? ''}
            rc={colorOf(it.row)}
          />
        )
      }
    }
  }

  // Stable row callbacks (so memoized rows skip re-rendering while scrolling).
  const handlerRef = useRef<RowHandlers | null>(null)
  handlerRef.current = {
    onCell: (ri, c, e) => {
      setActive({ idx: ri, col: c })
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleSel(ri, false, e.shiftKey)
        focusGrid()
        return
      }
      focusGrid()
      startEdit(ri, c)
    },
    onToggleSel: (ri, e) => toggleSel(ri, false, e.shiftKey),
    onGripDown: (e, row, g) => onGripDown(e, row, g),
    onContext: (e, row) => {
      e.preventDefault()
      actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
    },
    onToggle: (id) => tree.toggle(id),
    onAddSub: (parent) => {
      const pair = tree.pair
      if (!pair || ro) return
      tree.expand(parent.id)
      const id = actions.newRow({ editTitle: true })
      writeValue(db.id, pair.parent, id, [parent.id])
    },
  }
  const rowHandlers = useMemo<RowHandlers>(
    () => ({
      onCell: (...a) => handlerRef.current!.onCell(...a),
      onToggleSel: (...a) => handlerRef.current!.onToggleSel(...a),
      onGripDown: (...a) => handlerRef.current!.onGripDown(...a),
      onContext: (...a) => handlerRef.current!.onContext(...a),
      onToggle: (...a) => handlerRef.current!.onToggle(...a),
      onAddSub: (...a) => handlerRef.current!.onAddSub(...a),
    }),
    [],
  )

  const topPad = offsets[start]
  const bottomPad = offsets[items.length] - offsets[end]

  return (
    <div
      ref={rootRef}
      className="dbt"
      style={{ ['--dbt-cols' as string]: template, ['--dbt-gutter' as string]: `${gutter}px` }}
      tabIndex={0}
      role={tree.nodes ? 'treegrid' : 'grid'}
      aria-rowcount={m.rows.length}
      aria-colcount={cols.length}
      data-wrap={!!view.wrapCells}
      data-narrow={narrow}
      onKeyDown={onKeyDown}
    >
      <div className="dbt-headwrap">
        {sel.size > 0 && !ro && (
          <div className="dbt-bulk" role="toolbar" aria-label={t('database.bulk.label')}>
            <span className="dbt-bulk__count">
              <span className="dbt-bulk__num">{sel.size}</span> {t('database.bulk.selected')}
            </span>
            <button type="button" className="dbt-bulk__btn" onClick={(e) => setBulkAnchor(e.currentTarget)}>
              <PencilLine size={13} /> {t('database.bulk.set')}
            </button>
            <button
              type="button"
              className="dbt-bulk__btn"
              onClick={() => {
                duplicateRows(db.id, [...sel])
                setSel(new Set())
              }}
            >
              <Copy size={13} /> {t('common.duplicate')}
            </button>
            <button
              type="button"
              className="dbt-bulk__btn dbt-bulk__btn--danger"
              onClick={() => {
                deleteRows([...sel])
                setSel(new Set())
              }}
            >
              <Trash size={13} /> {t('common.delete')}
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="dbt-bulk__btn" aria-label={t('database.bulk.clear')} onClick={() => setSel(new Set())}>
              <X size={13} />
            </button>
          </div>
        )}
        <div
          className="dbt-headscroll"
          ref={headScrollRef}
          onWheel={(e) => bodyScrollRef.current && e.deltaX && (bodyScrollRef.current.scrollLeft += e.deltaX)}
          onScroll={() => {
            // focus / scrollIntoView can move the header on its own — keep the body in step
            const h = headScrollRef.current
            const b = bodyScrollRef.current
            if (h && b && b.scrollLeft !== h.scrollLeft) b.scrollLeft = h.scrollLeft
          }}
        >
          <div className="dbt-row dbt-row--head" role="row">
            <div className="dbt-gutter dbt-gutter--head dbt-sticky0">
              {!ro && (
                <Checkbox
                  checked={allSelected}
                  indeterminate={sel.size > 0 && !allSelected}
                  label={t('database.bulk.selectAll')}
                  onToggle={() => setSel(allSelected ? new Set() : new Set(m.rows.map((r) => r.id)))}
                />
              )}
            </div>
            {cols.map((p, c) => {
              const sort = view.sorts.find((s) => s.propertyId === p.id)
              return (
                <div
                  key={p.id}
                  role="columnheader"
                  data-hcol={p.id}
                  className={`dbt-hcell${c === 0 ? ' dbt-sticky1' : ''}`}
                  style={{ ...(c === 0 ? { left: gutter } : null), ...(colDrag?.from === c ? { transform: `translateX(${colDrag.dx}px)`, zIndex: 5 } : null) }}
                  data-dragging={colDrag?.from === c}
                  data-menu={headMenu?.prop.id === p.id}
                >
                  <button
                    type="button"
                    className="dbt-hcell__btn"
                    title={p.description || p.name}
                    onPointerDown={(e) => onHeadPointerDown(e, c)}
                    aria-disabled={ro || undefined}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !ro) {
                        e.preventDefault()
                        setHeadMenu({ prop: p, el: e.currentTarget })
                      }
                    }}
                  >
                    {isTypeProp(p) ? <Shapes size={13} strokeWidth={1.7} aria-hidden /> : <TypeIcon type={p.type} size={13} />}
                    <span className="dbt-hcell__name">{p.name}</span>
                    {autofillOf(p) && <AutofillTag dbId={db.id} prop={p} />}
                    {sort && <span className="dbt-hcell__sort">{sort.direction === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                  {!m.fixed && <span className="dbt-resize" onPointerDown={(e) => startResize(e, c)} role="separator" aria-orientation="vertical" aria-label={t('database.resize')} />}
                </div>
              )
            })}
            <div className="dbt-hcell dbt-hcell--add">
              {!m.fixed && (
                <Tooltip label={t('database.props.new')}>
                  <button type="button" className="icon-btn icon-btn--sm" onClick={(e) => setAddColAnchor(e.currentTarget)}>
                    <Plus size={14} />
                  </button>
                </Tooltip>
              )}
            </div>
            <div className="dbt-hcell dbt-hcell--fill" />
          </div>
        </div>
      </div>
      <div className="dbt-bodyscroll" ref={bodyScrollRef} onScroll={onBodyScroll}>
        <div className="dbt-body" ref={bodyRef} role="rowgroup">
          {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
          {items.slice(start, end).map((it) => renderItem(it))}
          {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
          {rowDrag?.b && <div className="dbt-dropline" style={{ top: rowDrag.b.y - 1 }} aria-hidden />}
        </div>
      </div>
      {colDrag && <div className="dbt-colline" style={{ left: colDrag.x, top: colDrag.top }} aria-hidden />}

      {editing && !ro && <ValueEditor db={db} prop={editing.prop} rows={editing.rows} anchor={editing.el} initialText={editing.text} onClose={onEditorClose} />}
      {headMenu && !ro && isTypeProp(headMenu.prop) && (
        <TypeColumnMenu
          m={m}
          anchor={headMenu.el}
          onClose={() => setHeadMenu(null)}
          onFilter={(id) => {
            setHeadMenu(null)
            onFilterProp(id)
          }}
        />
      )}
      {typeMenu && !ro && (
        <Menu
          open
          anchor={typeMenu.el}
          onClose={() => {
            setTypeMenu(null)
            requestAnimationFrame(focusGrid)
          }}
          width={240}
          entries={rtypeEntries(t, { db, kit: m.kit, current: typeMenu.row.recordType ?? null, onPick: (id) => setRowType(typeMenu.row.id, id) })}
        />
      )}
      {headMenu && !ro && !isTypeProp(headMenu.prop) && (
        <PropertyMenu
          db={db}
          view={view}
          prop={headMenu.prop}
          anchor={headMenu.el}
          resolver={m.resolver}
          tableMode
          locked={m.locked}
          onClose={() => setHeadMenu(null)}
          onFilter={(id) => {
            setHeadMenu(null)
            onFilterProp(id)
          }}
          onInserted={(id) =>
            requestAnimationFrame(() => {
              const el = rootRef.current?.querySelector<HTMLElement>(`[data-hcol="${id}"] .dbt-hcell__btn`)
              const prop = useWorkspace.getState().databases[db.id]?.properties.find((p) => p.id === id)
              if (el && prop) setHeadMenu({ prop, el })
            })
          }
        />
      )}
      <Menu
        open={!!addColAnchor}
        anchor={addColAnchor}
        onClose={() => setAddColAnchor(null)}
        searchable
        searchPlaceholder={t('database.props.typeSearch')}
        create={(q) =>
          createEntry(q, (p) =>
            // a named column: just bring it into view
            requestAnimationFrame(() => revealInStrip(headScrollRef.current, rootRef.current?.querySelector(`[data-hcol="${p.id}"]`) ?? null)),
          )
        }
        entries={typeEntries(t, (type) => {
          const last = cols[cols.length - 1]
          const id = insertProperty(db, view, { type, name: t(`database.type.${type}`) }, { anchorId: last.id, side: 'right' })
          requestAnimationFrame(() => {
            const el = rootRef.current?.querySelector<HTMLElement>(`[data-hcol="${id}"] .dbt-hcell__btn`)
            const prop = useWorkspace.getState().databases[db.id]?.properties.find((p) => p.id === id)
            if (el && prop) {
              revealInStrip(headScrollRef.current, el.closest('[data-hcol]')) // the body follows the header
              setHeadMenu({ prop, el })
            }
          })
        })}
      />
      <Menu
        open={!!bulkAnchor}
        anchor={bulkAnchor}
        onClose={() => setBulkAnchor(null)}
        searchable
        entries={editableProps.map((p) => ({
          label: p.name,
          icon: <TypeIcon type={p.type} />,
          onSelect: () => {
            const el = bulkAnchor
            if (!el) return
            if (p.type === 'checkbox') {
              const allOn = selectedRows.every((r) => r.properties[p.id] === true)
              for (const r of selectedRows) writeValue(db.id, p, r.id, !allOn)
              return
            }
            requestAnimationFrame(() => setEditing({ rows: selectedRows, prop: p, el }))
          },
        }))}
      />
    </div>
  )
}

interface RowHandlers {
  onCell: (idx: number, col: number, e: React.MouseEvent) => void
  onToggleSel: (idx: number, e: React.MouseEvent) => void
  onGripDown: (e: React.PointerEvent, row: Page, group: string | null) => void
  onContext: (e: React.MouseEvent, row: Page) => void
  onToggle: (rowId: ID) => void
  onAddSub: (parent: Page) => void
}

interface RowProps {
  m: DbModel
  row: Page
  idx: number
  cols: PropertyDef[]
  gutter: number
  height?: number
  wrap: boolean
  selected: boolean
  anySelected: boolean
  activeCol: number
  editingCol: number
  dragging: boolean
  openLabel: string
  groupKey: string | null
  handlers: RowHandlers
  /** sub-items nested display */
  nested: boolean
  depth: number
  kids: number
  open: boolean
  dimmed: boolean
  last: boolean
  rails: string
  /** colour rule the row matches */
  rc: ColorRule | null
}

/** Rows re-render when their own data changes; a new resolver only matters for cross-row values. */
function rowPropsEqual(a: RowProps, b: RowProps): boolean {
  for (const k of Object.keys(a) as Array<keyof RowProps>) if (k !== 'm' && a[k] !== b[k]) return false
  if (a.m === b.m) return true
  if (a.m.db !== b.m.db || a.m.view !== b.m.view || a.m.readOnly !== b.m.readOnly || a.m.kit !== b.m.kit) return false
  const ca = a.m.resolver.ctx
  const cb = b.m.resolver.ctx
  if (ca.people !== cb.people || ca.lang !== cb.lang || ca.databases !== cb.databases || ca.me !== cb.me) return false
  return !a.m.db.properties.some((p) => p.type === 'relation' || p.type === 'rollup' || p.type === 'formula')
}

const TableRow = memo(function TableRow({ m, row, idx, cols, gutter, height, selected, anySelected, activeCol, editingCol, dragging, openLabel, groupKey, handlers, nested, depth, kids, open, dimmed, last, rails, rc }: RowProps) {
  const t = useT()
  return (
    <div
      className={`dbt-row${rc ? ' db-rc' : ''}`}
      role="row"
      aria-rowindex={idx + 1}
      aria-selected={selected}
      aria-level={nested ? depth + 1 : undefined}
      aria-expanded={nested && kids > 0 ? open : undefined}
      data-selected={selected}
      data-dragging={dragging}
      data-dimmed={dimmed || undefined}
      data-rc={rc?.target}
      data-rc-color={rc?.color}
      title={dimmed ? t('database.sub.context') : undefined}
      style={{ ...(height ? { height } : null), ...(rc ? ruleStyle(rc.color) : null) }}
      onContextMenu={(e) => handlers.onContext(e, row)}
    >
      <div className="dbt-gutter dbt-sticky0" data-any={anySelected}>
        <span className="dbt-gutter__num">{String(idx + 1).padStart(2, '0')}</span>
        {!m.readOnly && (
        <span className="dbt-gutter__tools">
          <button
            type="button"
            className="dbt-grip"
            tabIndex={-1}
            onPointerDown={(e) => handlers.onGripDown(e, row, groupKey)}
            aria-label={t('database.row.drag')}
            title={m.view.sorts.length ? t('database.row.dragSorted') : t('database.row.drag')}
          >
            <GripVertical size={13} />
          </button>
          <Checkbox checked={selected} label={t('database.bulk.select')} onToggle={(e) => handlers.onToggleSel(idx, e)} />
        </span>
        )}
      </div>
      {cols.map((p, c) => {
        // another record type's property: a dim "—", not editable on this row
        const foreign = c > 0 && foreignTo(p, row)
        return (
        <div
          key={p.id}
          role="gridcell"
          data-cell={`${idx}:${c}`}
          data-type={p.type}
          data-active={activeCol === c}
          data-editing={editingCol === c}
          data-foreign={foreign || undefined}
          title={foreign ? foreignLabel(p, row, m.kit) : undefined}
          data-readonly={!canEdit(p) || m.readOnly || foreign}
          className={`dbt-cell${c === 0 ? ' dbt-cell--title dbt-sticky1' : ''}`}
          style={c === 0 ? { left: gutter } : undefined}
          onMouseDown={(e) => {
            // shift / ⌘-click selects rows — keep the browser from painting a text selection across cells
            if (e.shiftKey || e.metaKey || e.ctrlKey) e.preventDefault()
          }}
          onClick={(e) => handlers.onCell(idx, c, e)}
        >
          {c === 0 ? (
            <>
              {nested && <TreeLead depth={depth} kids={kids} open={open} last={last} rails={rails} title={row.title || t('common.untitled')} onToggle={() => handlers.onToggle(row.id)} />}
              <RowTitle row={row}>
                {nested && <TreeCount kids={kids} open={open} />}
                {nested && !m.readOnly && <AddSubButton onAdd={() => handlers.onAddSub(row)} />}
                <OpenButton row={row} view={m.view} label={openLabel} />
              </RowTitle>
            </>
          ) : foreign ? (
            <span className="rtype-foreign" aria-label={foreignLabel(p, row, m.kit)}>
              —
            </span>
          ) : isTypeProp(p) ? (
            <TypeCell row={row} kit={m.kit} />
          ) : (
            <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={m.resolver.value(m.db, p, row)} interactive={!m.readOnly} />
          )}
          {c > 0 && !foreign && autofillOf(p) && !m.readOnly && <AutofillCellMark dbId={m.db.id} prop={p} rowId={row.id} />}
        </div>
        )
      })}
      <div className="dbt-cell dbt-cell--pad" />
      <div className="dbt-cell dbt-cell--fill" />
    </div>
  )
}, rowPropsEqual)
