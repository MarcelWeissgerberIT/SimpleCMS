/**
 * The "website" crammed into spreadsheet cells — peak 1997–2003 ugliness, crafted on purpose.
 * Everything is positioned on the cell grid (column A = 1, row 1 = 1). Two layouts:
 * 'd' (desktop, columns A–V visible) and 'm' (phone, everything stacked in A–E).
 * SVG art uses presentation attributes only (no CSS), so html2canvas captures it exactly.
 */
import type { Translate } from '@/shared/i18n'
import { svgImg } from './icons'

export type Layout = 'd' | 'm'
/** [firstCol, firstRow, lastCol, lastRow], 1-based, inclusive. */
export type Range = [number, number, number, number]

export const CELL_W = 64
export const CELL_H = 18
/** Minimum grid size; the sheet grows it to cover larger viewports. */
export const COLS = 26
export const ROWS: Record<Layout, number> = { d: 64, m: 96 }

const F_ARIAL = `Arial, 'Liberation Sans', Helvetica, sans-serif`
const F_BLACK = `'Arial Black', 'Arial Bold', Gadget, 'Liberation Sans', Arial, sans-serif`
const F_IMPACT = `Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', 'Liberation Sans Narrow', 'Liberation Sans', sans-serif`
const F_COMIC = `'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Comic Neue', cursive`
const F_TIMES = `'Times New Roman', Times, 'Liberation Serif', serif`

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 1 → A, 26 → Z, 27 → AA … */
export function colName(c: number): string {
  let s = ''
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function refOf(c: number, r: number): string {
  return `${colName(c)}${r}`
}

/** Absolute pixel box of a cell range inside the cells layer. */
export function boxOf([c1, r1, c2, r2]: Range) {
  return { left: (c1 - 1) * CELL_W, top: (r1 - 1) * CELL_H, width: (c2 - c1 + 1) * CELL_W, height: (r2 - r1 + 1) * CELL_H }
}

function place(range: Range, extra = ''): string {
  const b = boxOf(range)
  return `style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;${extra}"`
}

/** A positioned block. kind 'obj' = floating object (selected with handles), 'cell' = merged cells. */
function block(range: Range, cls: string, inner: string, attrs = ''): string {
  return `<div class="x97-blk ${cls}" ${place(range)} ${attrs}>${inner}</div>`
}

/* ------------------------------------------------------------------ TextArt banner */

const RAINBOW = ['#ff0000', '#ff7f00', '#ffee00', '#22c000', '#0090ff', '#3000ff', '#a000c0']

function rainbowDefs(id: string): string {
  const stops = RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>`
}

function archText(pathId: string, text: string, size: number, len: number, gradId: string, depth: number): string {
  let out = ''
  // Chunky 3D extrusion: stacked copies, darkest at the back.
  for (let i = depth; i >= 1; i--) {
    const shade = Math.round(40 + (depth - i) * (70 / depth))
    const col = `rgb(${shade},${shade},${shade + 30})`
    out += `<text font-family="${F_IMPACT}" font-size="${size}" font-weight="900" fill="${col}" transform="translate(${(i * 1.15).toFixed(2)} ${(i * 1.25).toFixed(2)})"><textPath href="#${pathId}" startOffset="50%" text-anchor="middle" textLength="${len}" lengthAdjust="spacingAndGlyphs">${esc(text)}</textPath></text>`
  }
  out += `<text font-family="${F_IMPACT}" font-size="${size}" font-weight="900" fill="url(#${gradId})" stroke="#000080" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round"><textPath href="#${pathId}" startOffset="50%" text-anchor="middle" textLength="${len}" lengthAdjust="spacingAndGlyphs">${esc(text)}</textPath></text>`
  return out
}

function bannerSvg(layout: Layout, t: Translate): string {
  if (layout === 'd') {
    const w = 15 * CELL_W
    const h = 6 * CELL_H
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><defs>${rainbowDefs('x97rb')}<path id="x97arch" d="M 34 96 Q ${w / 2} -6 ${w - 34} 96" fill="none"/></defs>${archText('x97arch', t('intro.banner'), 46, w - 110, 'x97rb', 9)}</svg>`
  }
  const w = 5 * CELL_W
  const h = 6 * CELL_H
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><defs>${rainbowDefs('x97rb')}<path id="x97arch1" d="M 10 52 Q ${w / 2} 4 ${w - 10} 52" fill="none"/><path id="x97arch2" d="M 30 98 Q ${w / 2} 70 ${w - 30} 98" fill="none"/></defs>${archText('x97arch1', t('intro.banner1'), 25, w - 30, 'x97rb', 6)}${archText('x97arch2', t('intro.banner2'), 30, w - 80, 'x97rb', 6)}</svg>`
}

/* ------------------------------------------------------------------ NEU! star */

export const STAR_COLORS = { a: ['#ff0000', '#ffff00'], b: ['#ffff00', '#ff0000'] } as const

function starSvg(w: number, h: number, label: string, colors: readonly [string, string]): string {
  const cx = w / 2
  const cy = h / 2
  const spikes = 16
  const ro = Math.min(w, h) / 2 - 2
  const ri = ro * 0.68
  const pts: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? ro : ri
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    pts.push(`${(cx + Math.cos(a) * r * (w / h > 1.3 ? 1.25 : 1)).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`)
  }
  const fs = Math.round(ro * 0.62)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><polygon points="${pts.join(' ')}" fill="#000000" transform="translate(3 3)" opacity="0.55"/><polygon points="${pts.join(' ')}" fill="${colors[0]}" stroke="#000000" stroke-width="1.5"/><text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-family="${F_BLACK}" font-weight="900" font-size="${fs}" fill="${colors[1]}" stroke="#000000" stroke-width="1" paint-order="stroke" transform="rotate(-14 ${cx} ${cy})">${esc(label)}</text></svg>`
}

/* ------------------------------------------------------------------ LCD visitor counter */

const SEG: Record<string, string> = {
  a: '5,2 19,2 21,4 19,6 5,6 3,4',
  b: '21,5 23,7 23,19 21,21 19,19 19,7',
  c: '21,23 23,25 23,37 21,39 19,37 19,25',
  d: '5,38 19,38 21,40 19,42 5,42 3,40',
  e: '3,23 5,25 5,37 3,39 1,37 1,25',
  f: '3,5 5,7 5,19 3,21 1,19 1,7',
  g: '5,20 19,20 21,22 19,24 5,24 3,22',
}
const DIGITS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
}

function lcdSvg(value: string, w: number, h: number): string {
  const n = value.length
  const dw = 26
  const total = n * dw + 14
  const scale = Math.min((w - 8) / total, (h - 8) / 52)
  let digits = ''
  for (let i = 0; i < n; i++) {
    const on = DIGITS[value[i]] ?? ''
    let segs = ''
    for (const s of 'abcdefg') {
      segs += `<polygon points="${SEG[s]}" fill="${on.includes(s) ? '#ff3b10' : '#3a0c04'}"/>`
    }
    digits += `<g transform="translate(${8 + i * dw} 4) skewX(-7)">${segs}</g>`
  }
  const ox = (w - total * scale) / 2
  const oy = (h - 52 * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#c0c0c0" stroke="#808080"/><rect x="3" y="3" width="${w - 6}" height="${h - 6}" fill="#000000" stroke="#ffffff" stroke-width="1"/><g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${scale.toFixed(3)})">${digits}</g></svg>`
}

/* ------------------------------------------------------------------ Under construction */

function constructionSvg(w: number, h: number, sub: string, beaconOn: boolean): string {
  const band = 14
  const stripes = (y: number) => {
    let s = `<rect x="0" y="${y}" width="${w}" height="${band}" fill="#ffd400"/>`
    for (let x = -band * 2; x < w + band; x += band * 1.6) {
      s += `<polygon points="${x},${y + band} ${x + band * 0.8},${y + band} ${x + band * 1.8},${y} ${x + band},${y}" fill="#000000"/>`
    }
    return s
  }
  const d = Math.min(h - band * 2 - 10, 92)
  const dx = 10 + d / 2
  const dy = h / 2
  const tx = 10 + d + 12
  const big = w > 340 ? 25 : 19
  // Diamond road sign with the classic "men at work" pictogram.
  const sign = `<g transform="translate(${dx} ${dy})"><polygon points="0,${-d / 2} ${d / 2},0 0,${d / 2} ${-d / 2},0" fill="#ffb000" stroke="#000000" stroke-width="3"/><g transform="scale(${(d / 92).toFixed(3)})" fill="#000000"><circle cx="-4" cy="-24" r="6"/><polygon points="-10,-15 4,-15 10,2 4,4 0,-6 -2,10 6,26 0,28 -8,12 -14,26 -20,24 -12,6 -12,-4 -20,6 -24,2"/><polygon points="8,-14 26,10 23,12 5,-12"/><polygon points="18,10 30,4 34,12 22,16"/><polygon points="12,26 34,26 28,16 20,16"/></g></g>`
  const beacon = `<g transform="translate(${w - 24} ${band + 18})"><rect x="-9" y="6" width="18" height="6" fill="#404040"/><path d="M -8 6 A 8 9 0 0 1 8 6 Z" fill="${beaconOn ? '#ffd000' : '#ff3b00'}" stroke="#000000"/><g stroke="#ff6a00" stroke-width="2" stroke-opacity="${beaconOn ? 1 : 0}"><line x1="-16" y1="-2" x2="-11" y2="1"/><line x1="16" y1="-2" x2="11" y2="1"/><line x1="0" y1="-12" x2="0" y2="-6"/></g></g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="#ffd400"/>${stripes(0)}${stripes(h - band)}<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="#000000" stroke-width="2"/>${sign}<text x="${tx}" y="${dy - 8}" font-family="${F_BLACK}" font-weight="900" font-size="${big}" fill="#000000">UNDER</text><text x="${tx}" y="${dy + big - 8}" font-family="${F_BLACK}" font-weight="900" font-size="${big * 0.86}" fill="#000000" textLength="${Math.min(w - tx - 30, big * 8.6)}" lengthAdjust="spacingAndGlyphs">CONSTRUCTION</text><text x="${tx}" y="${h - band - 7}" font-family="${F_COMIC}" font-size="${w > 340 ? 11 : 9.5}" fill="#000000" textLength="${Math.min(w - tx - 8, w > 340 ? 250 : 190)}" lengthAdjust="spacingAndGlyphs">${esc(sub)}</text>${beacon}</svg>`
}

/* ------------------------------------------------------------------ 3D column chart (default 97 palette) */

const REVENUE = [120, 340, 890, 2150, 310, 80, 45]

function chartSvg(w: number, h: number, t: Translate, lang: string): string {
  const legendW = w > 400 ? 74 : 0
  const title = t('intro.chart.title')
  const px = 58
  const py = 42
  const pw = w - px - legendW - 26
  const ph = h - py - (legendW ? 34 : 54)
  const dx = 12
  const dy = -9
  const max = 2500
  const yOf = (v: number) => py + ph - (v / max) * ph
  const fmt = (v: number) => (lang === 'de' ? v.toLocaleString('de-DE') : v.toLocaleString('en-US'))
  let s = `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#ffffff" stroke="#000000"/>`
  s += `<text x="${w / 2}" y="22" text-anchor="middle" font-family="${F_ARIAL}" font-weight="700" font-size="13" fill="#000000">${esc(title)}</text>`
  // Walls + floor
  s += `<polygon points="${px},${py} ${px + dx},${py + dy} ${px + dx},${py + ph + dy} ${px},${py + ph}" fill="#808080" stroke="#000000" stroke-width="0.7"/>`
  s += `<rect x="${px + dx}" y="${py + dy}" width="${pw}" height="${ph}" fill="#c0c0c0" stroke="#000000" stroke-width="0.7"/>`
  s += `<polygon points="${px},${py + ph} ${px + dx},${py + ph + dy} ${px + pw + dx},${py + ph + dy} ${px + pw},${py + ph}" fill="#a0a0a0" stroke="#000000" stroke-width="0.7"/>`
  for (let v = 0; v <= max; v += 500) {
    const y = yOf(v)
    s += `<polyline points="${px},${y} ${px + dx},${y + dy} ${px + pw + dx},${y + dy}" fill="none" stroke="#000000" stroke-width="0.6"/>`
    s += `<text x="${px - 6}" y="${y + 4}" text-anchor="end" font-family="${F_ARIAL}" font-size="10" fill="#000000">${fmt(v)}</text>`
  }
  s += `<text transform="translate(14 ${py + ph / 2}) rotate(-90)" text-anchor="middle" font-family="${F_ARIAL}" font-size="10" font-weight="700" fill="#000000">${esc(t('intro.chart.axis'))}</text>`
  const slot = pw / REVENUE.length
  const bw = slot * 0.56
  REVENUE.forEach((v, i) => {
    const x = px + i * slot + (slot - bw) / 2 + 2
    const y = yOf(v)
    const yb = py + ph
    s += `<polygon points="${x},${y} ${x + dx},${y + dy} ${x + bw + dx},${y + dy} ${x + bw},${y}" fill="#ccccff" stroke="#000000" stroke-width="0.6"/>`
    s += `<polygon points="${x + bw},${y} ${x + bw + dx},${y + dy} ${x + bw + dx},${yb + dy} ${x + bw},${yb}" fill="#6666cc" stroke="#000000" stroke-width="0.6"/>`
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${yb - y}" fill="#9999ff" stroke="#000000" stroke-width="0.6"/>`
    s += `<text x="${x + bw / 2}" y="${yb + 14}" text-anchor="middle" font-family="${F_ARIAL}" font-size="10" fill="#000000">${1997 + i}</text>`
  })
  const series = esc(t('intro.chart.series'))
  if (legendW) {
    const lx = w - legendW - 6
    const ly = py + ph / 2 - 12
    s += `<rect x="${lx}" y="${ly}" width="${legendW - 4}" height="24" fill="#ffffff" stroke="#000000"/><rect x="${lx + 7}" y="${ly + 8}" width="8" height="8" fill="#9999ff" stroke="#000000" stroke-width="0.6"/><text x="${lx + 20}" y="${ly + 16}" font-family="${F_ARIAL}" font-size="10" fill="#000000">${series}</text>`
  } else {
    const lx = w / 2 - 34
    const ly = h - 24
    s += `<rect x="${lx}" y="${ly}" width="68" height="18" fill="#ffffff" stroke="#000000"/><rect x="${lx + 7}" y="${ly + 5}" width="8" height="8" fill="#9999ff" stroke="#000000" stroke-width="0.6"/><text x="${lx + 20}" y="${ly + 13}" font-family="${F_ARIAL}" font-size="10" fill="#000000">${series}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>`
}

/* ------------------------------------------------------------------ small helpers */

function rainbowLine(range: Range): string {
  const b = boxOf(range)
  const stops = RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')
  return block(
    range,
    'x97-rainbow',
    svgImg(`<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="6" viewBox="0 0 ${b.width} 6"><defs><linearGradient id="x97rl${range[1]}" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs><rect x="0" y="0" width="${b.width}" height="6" fill="url(#x97rl${range[1]})"/><rect x="0" y="0" width="${b.width}" height="2" fill="#ffffff" opacity="0.45"/></svg>`),
  )
}

/** A cell (or merged cell) with text. `f` = formula-bar content when it differs from the text. */
function cell(range: Range, text: string, cls = '', f?: string): string {
  return block(range, `x97-cell ${cls}`, esc(text), `data-cell${f ? ` data-f="${esc(f)}"` : ''}`)
}

function split(s: string, sep = '|'): string[] {
  return s.split(sep)
}

/* ------------------------------------------------------------------ layout table */

interface Spots {
  a1: Range
  banner: Range
  star: Range
  rain1: Range
  marquee: Range
  counter: Range
  sign: Range
  contact: Range
  chart: Range
  feat: Range
  links: Range
  button: Range
  tip: Range
  rain2: Range
  footer: Range
  badges: Range
  todo: Range
  visits: Range
  hashes: Range
}

const SPOTS: Record<Layout, Spots> = {
  d: {
    a1: [1, 1, 1, 1],
    banner: [2, 2, 16, 7],
    star: [17, 1, 19, 6],
    rain1: [2, 8, 19, 8],
    marquee: [2, 9, 19, 9],
    counter: [2, 11, 7, 15],
    sign: [2, 17, 7, 23],
    contact: [2, 25, 7, 38],
    chart: [9, 11, 16, 26],
    feat: [9, 28, 16, 36],
    links: [18, 11, 22, 18],
    button: [18, 20, 21, 22],
    tip: [18, 24, 18, 24],
    rain2: [2, 40, 19, 40],
    footer: [2, 41, 19, 41],
    badges: [6, 43, 15, 44],
    todo: [24, 2, 26, 8],
    visits: [18, 28, 20, 34],
    hashes: [23, 13, 23, 13],
  },
  m: {
    a1: [1, 1, 1, 1],
    banner: [1, 3, 5, 8],
    star: [4, 1, 5, 3],
    rain1: [1, 9, 5, 9],
    marquee: [1, 10, 5, 10],
    counter: [1, 12, 5, 16],
    sign: [1, 18, 5, 24],
    button: [1, 26, 4, 28],
    tip: [5, 26, 5, 26],
    // rows 29–32 stay empty: the webmaster's note hangs there under "Click here!!!"
    chart: [1, 33, 5, 48],
    feat: [1, 51, 5, 59],
    contact: [1, 62, 5, 75],
    links: [1, 78, 5, 85],
    rain2: [1, 87, 5, 87],
    footer: [1, 88, 5, 89],
    badges: [1, 91, 5, 94],
    todo: [7, 2, 9, 8],
    visits: [7, 12, 8, 18],
    hashes: [6, 14, 6, 14],
  },
}

export function tipRange(layout: Layout): Range {
  return SPOTS[layout].tip
}

/** HTML for the whole cells layer in the given layout. */
export function renderCells(layout: Layout, t: Translate, lang: string): string {
  const S = SPOTS[layout]
  const out: string[] = []

  out.push(cell(S.a1, '#NAME?', 'x97-err', t('intro.a1.formula')))

  // TextArt banner (floating object)
  out.push(block(S.banner, 'x97-obj x97-banner', svgImg(bannerSvg(layout, t)), `data-obj="${esc(t('intro.obj.wordart'))}"`))

  // NEU! starburst (blinks)
  const sb = boxOf(S.star)
  out.push(
    block(
      S.star,
      'x97-obj x97-star x97-blink',
      svgImg(starSvg(sb.width, sb.height, t('intro.new'), STAR_COLORS.a), 'x97-blink-a') + svgImg(starSvg(sb.width, sb.height, t('intro.new'), STAR_COLORS.b), 'x97-blink-b', 'style="visibility:hidden"'),
      `data-obj="${esc(t('intro.obj.star'))}"`,
    ),
  )

  out.push(rainbowLine(S.rain1))

  // Marquee ticker (scrolled by JS so captures match the live state)
  const mq = esc(t('intro.marquee'))
  out.push(block(S.marquee, 'x97-marquee', `<div class="x97-marquee-track"><span>${mq}</span><span>${mq}</span></div>`, `data-cell data-f="${mq}"`))

  // Visitor counter
  const cb = boxOf(S.counter)
  out.push(
    block(
      S.counter,
      'x97-obj x97-counter',
      `<div class="x97-counter-label">${esc(t('intro.counter.label'))}</div>${svgImg(lcdSvg('0004711', Math.min(cb.width - 16, 250), 40))}<div class="x97-counter-since">${esc(t('intro.counter.since'))}</div>`,
      `data-obj="${esc(t('intro.obj.counter'))}" data-f="${esc(t('intro.counter.formula'))}"`,
    ),
  )

  // Under construction sign
  const ub = boxOf(S.sign)
  const sub = t('intro.construction.sub')
  out.push(
    block(
      S.sign,
      'x97-obj x97-sign x97-blink',
      svgImg(constructionSvg(ub.width, ub.height, sub, false), 'x97-blink-a') + svgImg(constructionSvg(ub.width, ub.height, sub, true), 'x97-blink-b', 'style="visibility:hidden"'),
      `data-obj="${esc(t('intro.obj.sign'))}"`,
    ),
  )

  // Chart
  const chb = boxOf(S.chart)
  out.push(block(S.chart, 'x97-obj x97-chart', svgImg(chartSvg(chb.width, chb.height, t, lang)), `data-obj="${esc(t('intro.obj.chart'))}"`))

  // Feature table
  const cols = split(t('intro.feat.cols'))
  const rows = split(t('intro.feat.rows')).map((r) => r.split(';'))
  const fills = ['#ffff00', '#00ff00', '#ff99cc', '#00ffff', '#ffff00', '#ff0000']
  const fw = S.feat[2] - S.feat[0] + 1
  const spans = fw >= 8 ? [3, 2, 3] : [2, 2, 1]
  let feat = `<div class="x97-ft-head" data-cell>${esc(t('intro.feat.head'))}</div>`
  cols.forEach((c, i) => (feat += `<div class="x97-ft-col" data-cell style="grid-column:span ${spans[i]}">${esc(c)}</div>`))
  rows.forEach((r, ri) => {
    r.forEach((v, ci) => {
      const ai = ri === rows.length - 1
      const f = ai && ci > 0 ? ` data-f="${esc(t('intro.feat.aiFormula'))}"` : ''
      feat += `<div class="x97-ft-c${ci === 2 ? ' x97-ft-rate' : ''}${ai ? ' x97-ft-ai' : ''}" data-cell${f} style="grid-column:span ${spans[ci]};background:${fills[ri]}">${esc(v)}</div>`
    })
  })
  out.push(block(S.feat, 'x97-feat', feat, `data-cols="${fw}"`))

  // Contact form made of cells
  const cw = S.contact[2] - S.contact[0] + 1
  const contact = `
    <div class="x97-cf-title" data-cell style="grid-column:1/-1;grid-row:1">${esc(t('intro.contact.title'))}</div>
    <div class="x97-cf-label" data-cell style="grid-column:1;grid-row:3">${esc(t('intro.contact.name'))}</div>
    <div class="x97-cf-field" data-cell data-f="Max Mustermann" style="grid-column:2/-1;grid-row:3"></div>
    <div class="x97-cf-label" data-cell style="grid-column:1;grid-row:5">${esc(t('intro.contact.mail'))}</div>
    <div class="x97-cf-field" data-cell style="grid-column:2/-1;grid-row:5"></div>
    <div class="x97-cf-label" data-cell style="grid-column:1;grid-row:7">${esc(t('intro.contact.msg'))}</div>
    <div class="x97-cf-field" data-cell style="grid-column:2/-1;grid-row:7/11"></div>
    <div class="x97-cf-check" data-cell style="grid-column:2/-1;grid-row:12"><span class="x97-cbox">${svgImg('<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 7 7" shape-rendering="crispEdges"><path d="M6 0h1v2h-1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-2h1v1h1v1h1v-1h1v-1h1z" fill="#000000"/></svg>')}</span>${esc(t('intro.contact.fax'))}</div>
    <button type="button" class="x97-btn x97-cf-send" data-dialog style="grid-column:2/4;grid-row:14">${esc(t('intro.contact.send'))}</button>`
  out.push(block(S.contact, 'x97-contact', contact, `data-cols="${cw}"`))

  // Links
  const links = split(t('intro.links'))
  let lk = `<div class="x97-lk-title" data-cell>${esc(t('intro.links.title'))}</div>`
  links.forEach((l, i) => {
    lk += `<div class="x97-lk" data-cell><span class="x97-lk-b">»</span><a href="#" class="x97-a${i === 2 ? ' x97-a-v' : ''}" data-link>${esc(l)}</a></div>`
  })
  out.push(block(S.links, 'x97-links', lk))

  // Hier klicken!!!
  out.push(
    block(
      S.button,
      'x97-obj x97-clickwrap',
      `<button type="button" class="x97-btn x97-click" data-dialog><span>${esc(t('intro.click'))}</span></button>`,
      `data-obj="${esc(t('intro.obj.button'))}"`,
    ),
  )

  // Comment cell
  out.push(cell(S.tip, t('intro.tip'), 'x97-tip', t('intro.tip')).replace('data-cell', 'data-cell data-tip'))

  // Footer
  out.push(rainbowLine(S.rain2))
  out.push(cell(S.footer, t('intro.footer'), 'x97-footer'))
  const badges = split(t('intro.badges'))
  out.push(block(S.badges, 'x97-badges', badges.map((b, i) => `<span class="x97-badge x97-badge-${i}">${esc(b)}</span>`).join('')))

  // Off-screen spreadsheet-y stuff (rewards scrolling)
  const todo = split(t('intro.todo'))
  todo.forEach((line, i) => {
    out.push(cell([S.todo[0], S.todo[1] + i, S.todo[2], S.todo[1] + i], line, i === 0 ? 'x97-b' : ''))
  })
  const v = split(t('intro.visits'))
  const vc = S.visits[0]
  const vr = S.visits[1]
  out.push(cell([vc, vr, vc, vr], v[0], 'x97-b x97-hdr'))
  out.push(cell([vc + 1, vr, vc + 1, vr], v[1], 'x97-b x97-hdr x97-r'))
  const nums = [12, 31, 7, 4711]
  for (let i = 0; i < 4; i++) {
    out.push(cell([vc, vr + 1 + i, vc, vr + 1 + i], v[2 + i]))
    out.push(cell([vc + 1, vr + 1 + i, vc + 1, vr + 1 + i], String(nums[i]), 'x97-r x97-num'))
  }
  out.push(cell([vc, vr + 5, vc, vr + 5], v[6], 'x97-b'))
  out.push(cell([vc + 1, vr + 5, vc + 1, vr + 5], t('intro.visits.error'), 'x97-r x97-err x97-sumcell', t('intro.visits.formula')))
  out.push(cell(S.hashes, '########', 'x97-r', lang === 'de' ? '=HEUTE()' : '=TODAY()'))

  return out.join('')
}
