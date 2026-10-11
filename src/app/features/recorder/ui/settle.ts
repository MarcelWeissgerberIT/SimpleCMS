/**
 * The label pass on the DOM: measure, let model/labels.ts decide, apply (one read pass, one write pass).
 * Labels carry their geometry as data: data-anchor (px), data-shift (px, or "lead" = −24 − width), data-gap,
 * data-start (a range's start px), data-flips ("1").
 */
import { hiddenRulerLabels, settleHead, settleLabels, type View } from '../model/labels'

/** Event and held labels of one lane (they flip, hide, never overlap on the lane). */
export function settleLaneLabels(lane: HTMLElement, view: View, nowX: number | null): void {
  const els = [...lane.querySelectorAll<HTMLElement>('[data-anchor]')]
  if (!els.length) return
  const ins = els.map((el) => {
    const w = el.offsetWidth
    const s = el.dataset.shift
    return {
      anchor: Number(el.dataset.anchor),
      w,
      shift: s === 'lead' ? -24 - w : Number(s ?? 14),
      flipGap: Number(el.dataset.gap ?? 6),
      ...(el.dataset.start ? { start: Number(el.dataset.start) } : {}),
      flips: el.dataset.flips === '1',
      lane: 'lane',
      ...(el.dataset.alt ? { alt: Number(el.dataset.alt) } : {}),
    }
  })
  const out = settleLabels(ins, view, nowX)
  out.forEach((o, i) => {
    const el = els[i]
    el.style.left = `${o.left}px`
    if (o.hidden) el.dataset.hidden = ''
    else delete el.dataset.hidden
    if (o.flip) el.dataset.flipped = ''
    else delete el.dataset.flipped
    if (ins[i].alt !== undefined && o.left === ins[i].alt) el.dataset.atAlt = ''
    else delete el.dataset.atAlt
  })
}

/**
 * The playhead's head and the now label: inward at the edges, pinned (with " →") when the line is off to the right;
 * then every ruler label under either, or cut at a visible edge, is hidden.
 */
export function settleHeads(inner: HTMLElement, view: View): void {
  const heads: Array<{ left: number; right: number }> = []
  for (const el of inner.querySelectorAll<HTMLElement>('.playhead__h, .now__l')) {
    const line = Number(el.dataset.line)
    if (!Number.isFinite(line)) continue
    el.style.removeProperty('left')
    el.style.removeProperty('right')
    el.style.removeProperty('transform')
    delete el.dataset.place
    const w = el.offsetWidth
    const kind = el.classList.contains('now__l') ? 'now' : 'head'
    // pinned: the arrow makes it wider
    const h = settleHead(line, w, view, kind)
    if (h.place === 'pinned') {
      el.dataset.place = 'pinned'
      const wp = el.offsetWidth
      const left = view.right - 2 - wp
      el.style.left = `${left - line}px`
      el.style.right = 'auto'
      el.style.transform = 'none'
      heads.push({ left, right: left + wp })
      continue
    }
    if (h.place !== 'center') el.dataset.place = h.place
    heads.push({ left: h.left, right: h.right })
  }
  const labels = [...inner.querySelectorAll<HTMLElement>('.ruler__l')]
  const boxes = labels.map((el) => {
    el.style.removeProperty('visibility')
    const x = el.offsetLeft
    const w = el.offsetWidth
    const centred = el.dataset.kind === 'zone' || el.dataset.kind === 'minor'
    const left = centred ? x - w / 2 : x + 4
    return { left, right: left + w }
  })
  hiddenRulerLabels(boxes, heads, view).forEach((hide, i) => {
    if (hide) labels[i].style.visibility = 'hidden'
  })
}
