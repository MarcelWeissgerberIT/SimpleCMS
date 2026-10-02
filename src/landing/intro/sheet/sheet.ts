/**
 * The 1997 spreadsheet application window: chrome (title bar, menus, toolbars, formula bar,
 * headers, sheet tabs, status bar), the cell grid with the parody homepage, spreadsheet-like
 * selection, a fake error dialog, a cell comment, custom 98-style scrollbars and the
 * idle teasers (Not Responding wash, rumble + dust).
 *
 * Every animated thing is driven by JS through inline styles/attributes (never CSS
 * animations), so an html2canvas capture equals what is on screen.
 */
import type { Translate } from '@/shared/i18n'
import { icon, STANDARD_TOOLBAR, svgImg } from './icons'
import { CELL_H, CELL_W, COLS, ROWS, colName, esc, refOf, renderCells, tipRange, type Layout, type Range } from './content'
import './sheet.css'

export interface SheetOptions {
  t: Translate
  lang: string
  reducedMotion: boolean
  /** "Get new version…" in the error dialog, or the window's close button → the smash. */
  onUpgrade: () => void
  /** Keyboard "Skip intro" link → straight to the new site. */
  onSkip: () => void
}

/** Opacity of the white "Not Responding" wash (mirrored by the smash shader). */
export const WASH_ALPHA = 0.36

export interface SheetHandle {
  el: HTMLElement
  setHung(on: boolean): void
  isHung(): boolean
  setRumble(on: boolean): void
  /** Status-bar hint for visitors who never stop moving ("do nothing for 15 s"). */
  setHint(on: boolean): void
  /** Stop/resume JS animations (marquee, blink) — e.g. right before a capture. */
  freeze(on: boolean): void
  closeDialog(): void
  destroy(): void
}

const ROW_HEAD_W = 34
const COL_HEAD_H = 18

function accessKey(label: string): string {
  return esc(label).replace(/&amp;(.)/, '<u>$1</u>')
}

export function mountSheet(root: HTMLElement, opts: SheetOptions): SheetHandle {
  const { t, lang } = opts
  const tips = t('intro.tips').split('|')
  const fmtTips = t('intro.fmtTips').split('|')
  const baseTitle = `${t('intro.file')} - ${t('intro.app')}`

  // ------------------------------------------------------------------ chrome markup
  let tipIdx = 0
  const std = STANDARD_TOOLBAR.map((name) => {
    if (name === '|') return '<span class="x97-sep"></span>'
    if (name === 'zoom') return `<span class="x97-combo x97-zoom" title="Zoom"><span class="x97-combo-v">${esc(t('intro.zoom'))}</span><span class="x97-combo-b">${icon('arrowDown')}</span></span>`
    const title = tips[tipIdx++] ?? ''
    return `<span class="x97-tb" title="${esc(title)}">${icon(name)}</span>`
  }).join('')

  const fmt = [
    `<span class="x97-combo x97-font" title="${esc(fmtTips[0])}"><span class="x97-combo-v">${esc(t('intro.font'))}</span><span class="x97-combo-b">${icon('arrowDown')}</span></span>`,
    `<span class="x97-combo x97-size" title="${esc(fmtTips[1])}"><span class="x97-combo-v">10</span><span class="x97-combo-b">${icon('arrowDown')}</span></span>`,
    '<span class="x97-sep"></span>',
    `<span class="x97-tb" title="${esc(fmtTips[2])}">${icon('bold')}</span>`,
    `<span class="x97-tb" title="${esc(fmtTips[3])}">${icon('italic')}</span>`,
    `<span class="x97-tb" title="${esc(fmtTips[4])}">${icon('underline')}</span>`,
    '<span class="x97-sep"></span>',
    `<span class="x97-tb" title="${esc(fmtTips[5])}">${icon('alignLeft')}</span>`,
    `<span class="x97-tb" title="${esc(fmtTips[6])}">${icon('alignCenter')}</span>`,
    `<span class="x97-tb" title="${esc(fmtTips[7])}">${icon('alignRight')}</span>`,
    `<span class="x97-tb" title="${esc(fmtTips[8])}">${icon('merge')}</span>`,
    '<span class="x97-sep"></span>',
    `<span class="x97-tb x97-tbt" title="${esc(fmtTips[9])}">${lang === 'de' ? '€' : '$'}</span>`,
    `<span class="x97-tb x97-tbt" title="${esc(fmtTips[10])}">%</span>`,
    `<span class="x97-tb x97-tbt x97-tbt-s" title="${esc(fmtTips[11])}">000</span>`,
    `<span class="x97-tb x97-tbt x97-tbt-s">,0<sub>→</sub></span>`,
    `<span class="x97-tb x97-tbt x97-tbt-s">,00<sub>←</sub></span>`,
    '<span class="x97-sep"></span>',
    `<span class="x97-tb x97-tbdd" title="${esc(fmtTips[12])}">${icon('borders')}<i>${icon('arrowDown')}</i></span>`,
    `<span class="x97-tb x97-tbdd" title="${esc(fmtTips[13])}">${icon('fill')}<i>${icon('arrowDown')}</i></span>`,
    `<span class="x97-tb x97-tbdd" title="${esc(fmtTips[14])}">${icon('fontColor')}<i>${icon('arrowDown')}</i></span>`,
  ].join('')

  const menus = t('intro.menus')
    .split('|')
    .map((m) => `<span class="x97-menu">${accessKey(m)}</span>`)
    .join('')

  // Tab trapezoids are drawn at the tab's exact pixel size (see sizeTabs): a stretched SVG
  // (preserveAspectRatio="none") is not reproduced by html2canvas and would vanish at the swap.
  const tabSvg = (fill: string, w: number, h: number) => {
    const k = Math.round(w * 0.08)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="0,0.5 ${w},0.5 ${w - k},${h - 0.5} ${k},${h - 0.5}" fill="${fill}" stroke="#000000" stroke-width="1"/></svg>`
  }
  const tabFill = (on: boolean) => (on ? '#ffffff' : '#c0c0c0')
  const tabs = t('intro.tabs')
    .split('|')
    .map(
      (name, i) =>
        `<button type="button" class="x97-tab${i === 0 ? ' on' : ''}" data-tab="${i}">${svgImg(tabSvg(tabFill(i === 0), 80, 18), 'x97-tab-shape')}<span>${esc(name)}</span></button>`,
    )
    .join('')

  root.innerHTML = `
<div class="x97" data-layout="d" role="region" aria-label="${esc(t('intro.aria'))}">
  <button type="button" class="x97-skip">${esc(t('intro.skip'))}</button>
  <div class="x97-win">
    <div class="x97-title">
      <span class="x97-title-ico">${icon('sheet')}</span>
      <span class="x97-title-text"><span class="x97-tt-main">${esc(baseTitle)}</span><span class="x97-tt-sfx"></span></span>
      <span class="x97-title-btns">
        <span class="x97-cap" aria-hidden="true">${icon('min')}</span><span class="x97-cap" aria-hidden="true">${icon('restore')}</span><button type="button" class="x97-cap x97-cap-x" aria-label="${esc(t('intro.close'))}" title="${esc(t('intro.close'))}">${icon('close')}</button>
      </span>
    </div>
    <div class="x97-menubar"><span class="x97-mdi-ico">${icon('sheet')}</span>${menus}<span class="x97-mdi-btns"><span class="x97-cap x97-cap-s">${icon('min')}</span><span class="x97-cap x97-cap-s">${icon('restore')}</span><span class="x97-cap x97-cap-s">${icon('close')}</span></span></div>
    <div class="x97-bar"><span class="x97-grip"></span>${std}</div>
    <div class="x97-bar"><span class="x97-grip"></span>${fmt}</div>
    <div class="x97-fbar">
      <span class="x97-combo x97-namebox"><span class="x97-combo-v x97-name">A1</span><span class="x97-combo-b">${icon('arrowDown')}</span></span>
      <span class="x97-fx-btn">=</span>
      <span class="x97-formula"></span>
    </div>
    <div class="x97-body">
      <div class="x97-scroll" tabindex="0">
        <div class="x97-sheet">
          <div class="x97-colhead"></div>
          <div class="x97-main">
            <div class="x97-rowhead"></div>
            <div class="x97-cells">
              <div class="x97-layer"></div>
              <div class="x97-sel"><i class="x97-fill"></i><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div>
              <div class="x97-note" hidden><i class="x97-note-line"></i><div class="x97-note-box"><b>${esc(t('intro.comment.author'))}</b><br>${esc(t('intro.comment.text'))}</div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="x97-vs">
        <span class="x97-sb-btn" data-sb="up">${icon('arrowUp')}</span>
        <span class="x97-sb-track" data-sb="vtrack"><span class="x97-sb-thumb" data-sb="vthumb"></span></span>
        <span class="x97-sb-btn" data-sb="down">${icon('arrowDown')}</span>
      </div>
    </div>
    <div class="x97-tabbar">
      <span class="x97-tabnav"><span class="x97-tn">${icon('first')}</span><span class="x97-tn">${icon('arrowLeft')}</span><span class="x97-tn">${icon('arrowRight')}</span><span class="x97-tn">${icon('last')}</span></span>
      <span class="x97-tabs">${tabs}</span>
      <span class="x97-hs">
        <span class="x97-sb-btn" data-sb="left">${icon('arrowLeft')}</span>
        <span class="x97-sb-track" data-sb="htrack"><span class="x97-sb-thumb" data-sb="hthumb"></span></span>
        <span class="x97-sb-btn" data-sb="right">${icon('arrowRight')}</span>
      </span>
    </div>
    <div class="x97-status"><span class="x97-st x97-st-main">${esc(t('intro.ready'))}</span><span class="x97-st x97-st-sum"></span><span class="x97-st x97-st-num">${esc(t('intro.num'))}</span></div>
    <div class="x97-wash" style="background:rgba(255,255,255,${WASH_ALPHA})"></div>
    <div class="x97-dialog" role="alertdialog" aria-modal="true" aria-labelledby="x97-dlg-msg" hidden>
      <div class="x97-dlg-title"><span>${esc(t('intro.app'))}</span><button type="button" class="x97-cap" data-dlg="close" aria-label="${esc(t('intro.dialog.ok'))}">${icon('close')}</button></div>
      <div class="x97-dlg-body">
        ${svgImg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="17" cy="17" r="14" fill="#808080"/><circle cx="15" cy="15" r="14" fill="#ff0000" stroke="#800000" stroke-width="1"/><path d="M9 9 L21 21 M21 9 L9 21" stroke="#ffffff" stroke-width="3.2" stroke-linecap="square"/></svg>', 'x97-dlg-ico')}
        <p id="x97-dlg-msg">${esc(t('intro.dialog.msg'))}</p>
      </div>
      <div class="x97-dlg-btns"><button type="button" class="x97-btn x97-dlg-ok" data-dlg="ok">${esc(t('intro.dialog.ok'))}</button><button type="button" class="x97-btn" data-dlg="upgrade">${esc(t('intro.dialog.upgrade'))}</button></div>
    </div>
  </div>
  <div class="x97-dust" data-html2canvas-ignore aria-hidden="true"></div>
</div>`

  const el = root.querySelector<HTMLElement>('.x97')!
  const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel)!
  const win = q('.x97-win')
  const titleSuffix = q('.x97-tt-sfx')
  const scroll = q('.x97-scroll')
  const sheet = q('.x97-sheet')
  const rowhead = q('.x97-rowhead')
  const cells = q('.x97-cells')
  const layer = q('.x97-layer')
  const sel = q('.x97-sel')
  const nameBox = q('.x97-name')
  const formula = q('.x97-formula')
  const note = q('.x97-note')
  const noteLine = q('.x97-note-line')
  const dialog = q('.x97-dialog')
  const dust = q('.x97-dust')
  const statusSum = q('.x97-st-sum')
  const statusMain = q('.x97-st-main')
  const colhead = q('.x97-colhead')
  const tabEls = Array.from(el.querySelectorAll<HTMLElement>('.x97-tab'))
  let colHeadEls: HTMLElement[] = []

  // ------------------------------------------------------------------ layout
  const mq = window.matchMedia('(max-width: 720px)')
  let layout: Layout = mq.matches ? 'm' : 'd'
  let rowHeadEls: HTMLElement[] = []
  let marqueeTrack: HTMLElement | null = null
  let marqueeW = 0
  let blinkers: [HTMLElement, HTMLElement][] = []

  // A real spreadsheet never ends: the grid always covers the viewport (at least A–Z × 64/96).
  let cols = 0
  let rows = 0
  function gridSize(): [number, number] {
    const c = Math.max(COLS, Math.ceil((window.innerWidth - ROW_HEAD_W) / CELL_W) + 1)
    const r = Math.max(ROWS[layout], Math.ceil(window.innerHeight / CELL_H) + 2)
    return [c, r]
  }
  function renderGrid() {
    ;[cols, rows] = gridSize()
    sheet.style.width = `${ROW_HEAD_W + cols * CELL_W}px`
    cells.style.width = `${cols * CELL_W}px`
    cells.style.height = `${rows * CELL_H}px`
    colhead.innerHTML = `<span class="x97-corner"></span>${Array.from({ length: cols }, (_, i) => `<span class="x97-ch" data-c="${i + 1}">${colName(i + 1)}</span>`).join('')}`
    colHeadEls = Array.from(colhead.querySelectorAll<HTMLElement>('.x97-ch'))
    rowhead.innerHTML = Array.from({ length: rows }, (_, i) => `<span class="x97-rh" data-r="${i + 1}">${i + 1}</span>`).join('')
    rowHeadEls = Array.from(rowhead.children) as HTMLElement[]
  }

  function sizeTabs() {
    for (const tab of tabEls) {
      const img = tab.querySelector<HTMLImageElement>('.x97-tab-shape')
      const w = tab.offsetWidth
      const h = tab.offsetHeight
      if (!img || !w || !h || (img.width === w && img.height === h)) continue
      img.width = w
      img.height = h
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tabSvg(tabFill(tab.classList.contains('on')), w, h))}`
    }
  }

  function render() {
    el.dataset.layout = layout
    renderGrid()
    layer.innerHTML = renderCells(layout, t, lang)
    marqueeTrack = layer.querySelector<HTMLElement>('.x97-marquee-track')
    marqueeW = (marqueeTrack?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
    blinkers = Array.from(layer.querySelectorAll<HTMLElement>('.x97-blink')).map((b) => [
      b.querySelector<HTMLElement>('.x97-blink-a')!,
      b.querySelector<HTMLElement>('.x97-blink-b')!,
    ])
    select({ kind: 'cell', range: [1, 1, 1, 1], name: 'A1', f: t('intro.a1.formula') })
    hideNote()
    updateScrollbars()
  }

  // ------------------------------------------------------------------ selection
  interface Selection {
    kind: 'cell' | 'obj'
    range: Range
    name: string
    f: string
    box?: { left: number; top: number; width: number; height: number }
  }
  let current: Selection | null = null

  function select(s: Selection) {
    current = s
    const [c1, r1, c2, r2] = s.range
    const box = s.box ?? { left: (c1 - 1) * CELL_W, top: (r1 - 1) * CELL_H, width: (c2 - c1 + 1) * CELL_W, height: (r2 - r1 + 1) * CELL_H }
    sel.className = `x97-sel x97-sel-${s.kind}`
    sel.style.left = `${box.left}px`
    sel.style.top = `${box.top}px`
    sel.style.width = `${box.width}px`
    sel.style.height = `${box.height}px`
    nameBox.textContent = s.name
    formula.textContent = s.f
    colHeadEls.forEach((h, i) => h.classList.toggle('on', s.kind === 'cell' && i + 1 >= c1 && i + 1 <= c2))
    rowHeadEls.forEach((h, i) => h.classList.toggle('on', s.kind === 'cell' && i + 1 >= r1 && i + 1 <= r2))
    const n = Number(s.f.replace(/\./g, ''))
    statusSum.textContent = s.kind === 'cell' && s.f !== '' && Number.isFinite(n) ? t('intro.sum', { v: s.f }) : ''
    const tr = tipRange(layout)
    if (s.kind === 'cell' && c1 === tr[0] && r1 === tr[1]) showNote()
    else if (!noteHover) hideNote()
  }

  function cellAt(x: number, y: number): [number, number] {
    const c = Math.min(cols, Math.max(1, Math.floor(x / CELL_W) + 1))
    const r = Math.min(rows, Math.max(1, Math.floor(y / CELL_H) + 1))
    return [c, r]
  }

  function rangeOfEl(target: HTMLElement): Range {
    const cr = cells.getBoundingClientRect()
    const b = target.getBoundingClientRect()
    const [c1, r1] = cellAt(b.left - cr.left + 2, b.top - cr.top + 2)
    const [c2, r2] = cellAt(b.right - cr.left - 2, b.bottom - cr.top - 2)
    return [c1, r1, Math.max(c1, c2), Math.max(r1, r2)]
  }

  function onCellsDown(e: PointerEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button, a')) return
    const obj = target.closest<HTMLElement>('[data-obj]')
    if (obj) {
      select({
        kind: 'obj',
        range: rangeOfEl(obj),
        name: obj.dataset.obj ?? '',
        f: obj.dataset.f ?? '',
        box: { left: obj.offsetLeft, top: obj.offsetTop, width: obj.offsetWidth, height: obj.offsetHeight },
      })
      return
    }
    const cellEl = target.closest<HTMLElement>('[data-cell]')
    if (cellEl) {
      const range = rangeOfEl(cellEl)
      select({ kind: 'cell', range, name: refOf(range[0], range[1]), f: cellEl.dataset.f ?? cellEl.textContent?.trim() ?? '' })
      return
    }
    const cr = cells.getBoundingClientRect()
    const [c, r] = cellAt(e.clientX - cr.left, e.clientY - cr.top)
    select({ kind: 'cell', range: [c, r, c, r], name: refOf(c, r), f: '' })
  }

  function onHeadDown(e: PointerEvent) {
    const target = e.target as HTMLElement
    const ch = target.closest<HTMLElement>('.x97-ch')
    const rh = target.closest<HTMLElement>('.x97-rh')
    if (ch) {
      const c = Number(ch.dataset.c)
      select({ kind: 'cell', range: [c, 1, c, rows], name: refOf(c, 1), f: '' })
    } else if (rh) {
      const r = Number(rh.dataset.r)
      select({ kind: 'cell', range: [1, r, cols, r], name: refOf(1, r), f: '' })
    } else if (target.closest('.x97-corner')) {
      select({ kind: 'cell', range: [1, 1, cols, rows], name: 'A1', f: t('intro.a1.formula') })
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!dialog.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog()
      } else if (e.key === 'Tab') {
        // modal: keep focus inside the dialog
        const f = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
        const i = f.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus()
      }
      return
    }
    if (document.activeElement !== scroll || !current) return
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Enter: [0, 1] }
    const mv = moves[e.key]
    if (!mv) return
    e.preventDefault()
    const c = Math.min(cols, Math.max(1, current.range[0] + mv[0]))
    const r = Math.min(rows, Math.max(1, current.range[1] + mv[1]))
    select({ kind: 'cell', range: [c, r, c, r], name: refOf(c, r), f: '' })
    const x = (c - 1) * CELL_W
    const y = (r - 1) * CELL_H
    const vw = scroll.clientWidth - ROW_HEAD_W
    const vh = scroll.clientHeight - COL_HEAD_H
    if (x < scroll.scrollLeft) scroll.scrollLeft = x
    else if (x + CELL_W > scroll.scrollLeft + vw) scroll.scrollLeft = x + CELL_W - vw
    if (y < scroll.scrollTop) scroll.scrollTop = y
    else if (y + CELL_H > scroll.scrollTop + vh) scroll.scrollTop = y + CELL_H - vh
  }

  // ------------------------------------------------------------------ comment note
  let noteHover = false
  function showNote() {
    const tr = tipRange(layout)
    const cellLeft = (tr[0] - 1) * CELL_W
    const cellTop = (tr[1] - 1) * CELL_H
    const cellRight = cellLeft + CELL_W
    const boxW = 168
    const toLeft = cellRight + boxW + 24 > cols * CELL_W || (layout === 'm' && tr[0] >= 4)
    const bx = toLeft ? cellLeft - boxW - 18 : cellRight + 18
    const by = Math.max(4, cellTop - 30)
    note.hidden = false
    note.style.left = `${bx}px`
    note.style.top = `${by}px`
    const box = note.querySelector<HTMLElement>('.x97-note-box')!
    box.style.width = `${boxW}px`
    // connector line from the red triangle to the note (a rotated 1px bar)
    const ax = toLeft ? cellLeft + CELL_W - 2 : cellRight - 2
    const ay = cellTop + 2
    const nx = toLeft ? bx + boxW : bx
    const ny = by + 14
    const len = Math.hypot(nx - ax, ny - ay)
    noteLine.style.left = `${ax - bx}px`
    noteLine.style.top = `${ay - by}px`
    noteLine.style.width = `${len}px`
    noteLine.style.transform = `rotate(${Math.atan2(ny - ay, nx - ax)}rad)`
  }
  function hideNote() {
    note.hidden = true
  }
  function onOver(e: PointerEvent) {
    const tip = (e.target as HTMLElement).closest?.('[data-tip]')
    if (tip && !noteHover) {
      noteHover = true
      showNote()
    }
  }
  function onOut(e: PointerEvent) {
    const tip = (e.target as HTMLElement).closest?.('[data-tip]')
    if (tip && !(e.relatedTarget as HTMLElement | null)?.closest?.('[data-tip]')) {
      noteHover = false
      const tr = tipRange(layout)
      if (!(current && current.kind === 'cell' && current.range[0] === tr[0] && current.range[1] === tr[1])) hideNote()
    }
  }

  // ------------------------------------------------------------------ dialog
  let lastFocus: HTMLElement | null = null
  function openDialog() {
    lastFocus = document.activeElement as HTMLElement | null
    dialog.hidden = false
    dialog.querySelector<HTMLElement>('.x97-dlg-ok')?.focus()
  }
  function closeDialog() {
    if (dialog.hidden) return
    dialog.hidden = true
    lastFocus?.focus?.()
  }

  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    const link = target.closest<HTMLAnchorElement>('[data-link]')
    if (link) {
      e.preventDefault()
      link.classList.add('x97-a-v')
      const cellEl = link.closest<HTMLElement>('[data-cell]')
      if (cellEl) {
        const range = rangeOfEl(cellEl)
        select({ kind: 'cell', range, name: refOf(range[0], range[1]), f: link.textContent ?? '' })
      }
      return
    }
    if (target.closest('[data-dialog]')) {
      openDialog()
      return
    }
    const dlg = target.closest<HTMLElement>('[data-dlg]')
    if (dlg) {
      closeDialog()
      if (dlg.dataset.dlg === 'upgrade') opts.onUpgrade()
      return
    }
    const tab = target.closest<HTMLElement>('.x97-tab')
    if (tab && tab.dataset.tab !== '0') {
      openDialog()
      return
    }
    if (target.closest('.x97-skip')) opts.onSkip()
    else if (target.closest('.x97-cap-x')) opts.onUpgrade()
  }

  // ------------------------------------------------------------------ scrollbars (98 style, functional)
  const vTrack = q('[data-sb="vtrack"]')
  const vThumb = q('[data-sb="vthumb"]')
  const hTrack = q('[data-sb="htrack"]')
  const hThumb = q('[data-sb="hthumb"]')

  function updateScrollbars() {
    const vMax = scroll.scrollHeight - scroll.clientHeight
    const hMax = scroll.scrollWidth - scroll.clientWidth
    const vt = vTrack.clientHeight
    const ht = hTrack.clientWidth
    const vSize = Math.max(16, vt * (scroll.clientHeight / Math.max(1, scroll.scrollHeight)))
    const hSize = Math.max(16, ht * (scroll.clientWidth / Math.max(1, scroll.scrollWidth)))
    vThumb.style.height = `${Math.min(vt, vSize)}px`
    hThumb.style.width = `${Math.min(ht, hSize)}px`
    vThumb.style.transform = `translateY(${vMax > 0 ? ((vt - vSize) * scroll.scrollTop) / vMax : 0}px)`
    hThumb.style.transform = `translateX(${hMax > 0 ? ((ht - hSize) * scroll.scrollLeft) / hMax : 0}px)`
  }

  let drag: { axis: 'v' | 'h'; start: number; scroll0: number } | null = null
  function onSbDown(e: PointerEvent) {
    const sb = (e.target as HTMLElement).closest<HTMLElement>('[data-sb]')
    if (!sb) return
    e.preventDefault()
    const k = sb.dataset.sb
    if (k === 'up') scroll.scrollTop -= CELL_H * 3
    else if (k === 'down') scroll.scrollTop += CELL_H * 3
    else if (k === 'left') scroll.scrollLeft -= CELL_W
    else if (k === 'right') scroll.scrollLeft += CELL_W
    else if (k === 'vthumb' || k === 'hthumb') {
      const axis = k === 'vthumb' ? 'v' : 'h'
      drag = { axis, start: axis === 'v' ? e.clientY : e.clientX, scroll0: axis === 'v' ? scroll.scrollTop : scroll.scrollLeft }
      sb.setPointerCapture?.(e.pointerId)
    } else if (k === 'vtrack') {
      const r = vThumb.getBoundingClientRect()
      scroll.scrollTop += (e.clientY < r.top ? -1 : 1) * scroll.clientHeight * 0.9
    } else if (k === 'htrack') {
      const r = hThumb.getBoundingClientRect()
      scroll.scrollLeft += (e.clientX < r.left ? -1 : 1) * scroll.clientWidth * 0.9
    }
  }
  function onSbMove(e: PointerEvent) {
    if (!drag) return
    if (drag.axis === 'v') {
      const ratio = (scroll.scrollHeight - scroll.clientHeight) / Math.max(1, vTrack.clientHeight - vThumb.offsetHeight)
      scroll.scrollTop = drag.scroll0 + (e.clientY - drag.start) * ratio
    } else {
      const ratio = (scroll.scrollWidth - scroll.clientWidth) / Math.max(1, hTrack.clientWidth - hThumb.offsetWidth)
      scroll.scrollLeft = drag.scroll0 + (e.clientX - drag.start) * ratio
    }
  }
  function onSbUp() {
    drag = null
  }

  // ------------------------------------------------------------------ animation loop (marquee, blink, beacon)
  let frozen = false
  let raf = 0
  let marqueeX = 0
  let last = performance.now()
  let blinkT = 0
  let blinkOn = false
  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (frozen || opts.reducedMotion) return
    if (marqueeTrack && marqueeW > 0) {
      marqueeX -= dt * 70
      if (marqueeX <= -marqueeW) marqueeX += marqueeW
      marqueeTrack.style.transform = `translateX(${Math.round(marqueeX)}px)`
    }
    blinkT += dt
    if (blinkT >= 0.5) {
      blinkT = 0
      blinkOn = !blinkOn
      for (const [a, b] of blinkers) {
        a.style.visibility = blinkOn ? 'hidden' : ''
        b.style.visibility = blinkOn ? '' : 'hidden'
      }
    }
  }
  raf = requestAnimationFrame(frame)

  // ------------------------------------------------------------------ teasers
  let hung = false
  function setHung(on: boolean) {
    if (hung === on) return
    hung = on
    el.classList.toggle('x97--hung', on)
    titleSuffix.textContent = on ? t('intro.notResponding') : ''
    frozen = on || frozenExternally
  }
  let frozenExternally = false
  function freeze(on: boolean) {
    frozenExternally = on
    frozen = on || hung
  }

  let rumbleTimer = 0
  let dustTimer = 0
  function setRumble(on: boolean) {
    window.clearInterval(rumbleTimer)
    window.clearInterval(dustTimer)
    rumbleTimer = 0
    dustTimer = 0
    if (!on || opts.reducedMotion) {
      win.style.transform = ''
      dust.replaceChildren()
      return
    }
    let k = 0
    rumbleTimer = window.setInterval(() => {
      k++
      const amp = Math.min(2, 0.8 + k * 0.03)
      const x = Math.round((Math.random() * 2 - 1) * amp)
      const y = Math.round((Math.random() * 2 - 1) * amp)
      win.style.transform = `translate(${x}px, ${y}px)`
    }, 45)
    dustTimer = window.setInterval(spawnDust, 55)
  }

  function spawnDust() {
    const n = 2 + Math.floor(Math.random() * 3)
    const vw = window.innerWidth
    const vh = window.innerHeight
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i')
      const chunk = Math.random() < 0.12
      const size = chunk ? 5 + Math.random() * 4 : 1.5 + Math.random() * 3.5
      const x = vw * (0.08 + Math.random() * 0.84)
      const col = Math.random() < 0.55 ? '#9b9284' : Math.random() < 0.5 ? '#5f584e' : '#d8cfbd'
      s.style.cssText = `left:${x}px;width:${size}px;height:${size * (0.6 + Math.random() * 0.5)}px;background:${col};opacity:${0.7 + Math.random() * 0.3}`
      dust.appendChild(s)
      const fall = vh * (0.35 + Math.random() * 0.6)
      const drift = (Math.random() * 2 - 1) * 40
      const anim = s.animate(
        [
          { transform: 'translate(0, -10px) rotate(0deg)', opacity: 1 },
          { transform: `translate(${drift}px, ${fall}px) rotate(${Math.random() * 540}deg)`, opacity: 0 },
        ],
        { duration: 650 + Math.random() * 900, easing: 'cubic-bezier(.5,0,1,1)' },
      )
      anim.onfinish = () => s.remove()
    }
  }

  // ------------------------------------------------------------------ wiring
  const onScroll = () => updateScrollbars()
  const onResize = () => {
    const next: Layout = mq.matches ? 'm' : 'd'
    if (next !== layout) {
      layout = next
      render()
    } else {
      const [c, r] = gridSize()
      if (c !== cols || r !== rows) {
        renderGrid()
        if (current) select(current)
      }
      updateScrollbars()
    }
  }
  cells.addEventListener('pointerdown', onCellsDown)
  sheet.addEventListener('pointerdown', onHeadDown)
  cells.addEventListener('pointerover', onOver)
  cells.addEventListener('pointerout', onOut)
  el.addEventListener('click', onClick)
  el.addEventListener('pointerdown', onSbDown)
  window.addEventListener('pointermove', onSbMove)
  window.addEventListener('pointerup', onSbUp)
  window.addEventListener('keydown', onKey)
  scroll.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)

  render()
  sizeTabs()
  // Fonts may change the marquee + tab widths once loaded.
  document.fonts?.ready.then(() => {
    marqueeW = (marqueeTrack?.firstElementChild as HTMLElement | null)?.offsetWidth ?? marqueeW
    sizeTabs()
  })

  let hint = false
  function setHint(on: boolean) {
    if (hint === on) return
    hint = on
    statusMain.textContent = on ? t('intro.hint') : t('intro.ready')
    statusMain.classList.toggle('x97-st-hint', on)
  }

  return {
    el,
    setHung,
    isHung: () => hung,
    setRumble,
    setHint,
    freeze,
    closeDialog,
    destroy() {
      cancelAnimationFrame(raf)
      setRumble(false)
      cells.removeEventListener('pointerdown', onCellsDown)
      sheet.removeEventListener('pointerdown', onHeadDown)
      cells.removeEventListener('pointerover', onOver)
      cells.removeEventListener('pointerout', onOut)
      el.removeEventListener('click', onClick)
      el.removeEventListener('pointerdown', onSbDown)
      window.removeEventListener('pointermove', onSbMove)
      window.removeEventListener('pointerup', onSbUp)
      window.removeEventListener('keydown', onKey)
      scroll.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    },
  }
}
