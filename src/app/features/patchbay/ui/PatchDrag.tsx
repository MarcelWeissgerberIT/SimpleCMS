/**
 * Patching by pointer (plan §1.13, §6 U16; P4, B16) — only while the Patching switch is on:
 *  - a mouse / pen press on a jack that moves (> 5 px) starts a drag: the pointer is captured, a live catenary runs from
 *    the jack to the pointer (DragCable — the cable layer's own geometry, render.ts cablePath), the jacks the matrix lets
 *    it plug into light in ink (`data-pdrag="accept"`, never orange — a module whose jack is not drawn yet takes the drop,
 *    `data-paccept`), the rest dim; over a jack it may plug into, the preview says "+F2" when the drop would open a fuse
 *    (the plan run on the patched input). The drop plans the patch (patchRun.ts startPatch: refused → why, at the jack;
 *    asks → the popover at the jack; else written). Esc or a press of another button cancels;
 *  - a press that does not move — a click — and a tap (touch: coarse, never a drag) open "Connect to …" on the jack.
 * The jacks' hit areas are ≥ 24 × 24 px × the text size while patching (patchbay.css). A drag never starts on a ghost.
 */
import { useEffect, useRef, type RefObject } from 'react'
import type { Translate } from '@/shared/i18n'
import { cablePath, labelPoint, type Pt } from '../render'
import { acceptOf, dropPatch, jackOf } from '../patchPick'
import { planOn, planRefused } from '../patching'
import type { Model, ModelInput, Patch } from '../types'
import { patchDrag, setDrag, usePatchUI } from './patchUI'
import { announce } from './store'

const P = 'features.patchbay'
/** How far a press moves before it is a drag (px). */
const SLOP = 5

export interface PatchPointer {
  model: Model
  input: ModelInput
  /** a drop: the patch, the element it was dropped on, the source jack's key */
  drop: (patch: Patch, anchor: Element, source: string) => void
  /** a click / tap on a jack: "Connect to …" */
  pick: (jack: HTMLElement) => void
  /** what the live region says when a drag starts / is cancelled */
  say: { start: (jack: string) => string; cancelled: string }
}

/** Under a point: the jack (a jack's socket or label), else the module. */
function hitAt(x: number, y: number, bench: HTMLElement): { jack: HTMLElement | null; module: HTMLElement | null } {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!bench.contains(el)) continue
    if (el.closest('.pb-dragw')) continue
    const jk = el.closest<HTMLElement>('.pb-jk')
    if (jk) return { jack: jk, module: jk.closest<HTMLElement>('.pb-mod') }
    const mod = el.closest<HTMLElement>('.pb-mod')
    if (mod) return { jack: null, module: mod }
  }
  return { jack: null, module: null }
}

/** The pointer handling on the bench (listeners on the bench and, during a drag, the window). */
export function usePatchPointer(bench: RefObject<HTMLElement | null>, ctx: PatchPointer | null): void {
  const live = useRef(ctx)
  live.current = ctx
  const on = !!ctx
  useEffect(() => {
    const el = bench.current
    if (!el || !on || !live.current) return
    const cur = () => live.current!
    let pending: { id: number; x: number; y: number; jack: HTMLElement } | null = null
    let dragging = false
    let swallowClick = false
    // the "+F2" of each target, planned once per drag
    let previews = new Map<string, string>()

    const local = (x: number, y: number): Pt => {
      const r = el.getBoundingClientRect()
      return { x: x - r.left, y: y - r.top }
    }
    const end = () => {
      pending = null
      dragging = false
      previews = new Map()
      setDrag(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      document.documentElement.removeAttribute('data-pb-dragging')
    }
    const cancel = () => {
      const was = dragging
      end()
      if (was) announce(cur().say.cancelled)
    }
    const begin = (p: NonNullable<typeof pending>, e: PointerEvent) => {
      const { model, input } = cur()
      const key = p.jack.dataset.jack!
      const j = jackOf(model, key)
      if (!j) return cancel()
      const sock = p.jack.querySelector('.pb-jack') ?? p.jack
      const r = sock.getBoundingClientRect()
      dragging = true
      try {
        p.jack.setPointerCapture(e.pointerId)
      } catch {
        /* the window still hears the moves */
      }
      document.documentElement.setAttribute('data-pb-dragging', '')
      setDrag({ source: key, side: j.side, a: local(r.left + r.width / 2, r.top + r.height / 2), at: local(e.clientX, e.clientY), accept: acceptOf(j, model, input), over: null, opens: null })
      announce(cur().say.start(p.jack.getAttribute('aria-label') ?? key))
    }
    const track = (e: PointerEvent) => {
      const d = usePatchUI.getState().drag
      if (!d) return
      const hit = hitAt(e.clientX, e.clientY, el)
      const jack = hit.jack?.dataset.jack ?? null
      const module = hit.module?.dataset.key ?? null
      const over = jack || module ? { jack, module } : null
      const same = (d.over?.jack ?? null) === jack && (d.over?.module ?? null) === module
      if (same) return patchDrag({ at: local(e.clientX, e.clientY) })
      // the preview: what a drop here would open ("+F2") — planned once per target (accepted targets only)
      let opens: string | null = ''
      const target = jack ?? (module ? `mod:${module}` : null)
      const accepted = (jack && d.accept.jacks.has(jack)) || (!jack && module && d.accept.modules.has(module))
      if (target && accepted) {
        const had = previews.get(target)
        if (had !== undefined) opens = had
        else {
          const { model, input } = cur()
          const src = jackOf(model, d.source)
          const patch = src ? dropPatch(src, { jack: jack ? jackOf(model, jack) : null, module }, model, input) : null
          const plan = patch ? planOn(patch) : null
          opens = plan && !planRefused(plan) ? (plan.opens ?? []).map((o) => `+${o.label}`).join(' ') : ''
          previews.set(target, opens)
        }
      }
      patchDrag({ at: local(e.clientX, e.clientY), over, opens })
    }
    const onMove = (e: PointerEvent) => {
      if (!pending || e.pointerId !== pending.id) return
      if (!dragging) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) <= SLOP) return
        begin(pending, e)
        if (!dragging) return
      }
      track(e)
    }
    const onUp = (e: PointerEvent) => {
      if (!pending || e.pointerId !== pending.id) return
      const p = pending
      if (!dragging) {
        // a click: the window hears no more; the click event opens the picker
        end()
        return
      }
      swallowClick = true
      const { model, input, drop } = cur()
      const hit = hitAt(e.clientX, e.clientY, el)
      const src = jackOf(model, p.jack.dataset.jack!)
      const jack = hit.jack?.dataset.jack ? jackOf(model, hit.jack.dataset.jack) : null
      const module = hit.module?.dataset.key ?? null
      end()
      const patch = src ? dropPatch(src, { jack, module }, model, input) : null
      if (!patch) return announce(cur().say.cancelled)
      drop(patch, hit.jack ?? hit.module ?? p.jack, src!.key)
    }
    const onCancel = (e: PointerEvent) => {
      if (pending && e.pointerId === pending.id) cancel()
    }
    // Esc cancels a drag (the first rung of the page's Esc ladder: nothing else hears it)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragging) return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    const onDown = (e: PointerEvent) => {
      // a drag that ended without its click: nothing to swallow any more
      swallowClick = false
      if (pending) return cancel()
      const jk = (e.target as Element).closest<HTMLElement>('.pb-jk')
      if (!jk || !el.contains(jk) || jk.closest('.pb-mod[data-ghost]')) return
      // touch is coarse: never a drag — its tap opens the picker (the click below); a mouse's other buttons are not ours
      if (e.pointerType === 'touch' || e.button !== 0) return
      // no text selection, no focus jump while a cable is pulled (a click still opens the picker)
      e.preventDefault()
      pending = { id: e.pointerId, x: e.clientX, y: e.clientY, jack: jk }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    }
    // a click / tap on a jack: "Connect to …" (never the module's selection); the click a drag ends with: nothing
    const onClick = (e: MouseEvent) => {
      const jk = (e.target as Element).closest<HTMLElement>('.pb-jk')
      if (swallowClick) {
        swallowClick = false
        if (jk) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (!jk || !el.contains(jk) || jk.closest('.pb-mod[data-ghost]')) return
      e.preventDefault()
      e.stopPropagation()
      cur().pick(jk)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick, true)
      end()
    }
  }, [bench, on])
}

/** The cable being pulled: from the source jack to the pointer, a plug at its end, "+F2" on it when the drop opens a fuse. */
export function DragCable({ t }: { t: Translate }) {
  const d = usePatchUI((s) => s.drag)
  if (!d) return null
  const c = d.side === 'out' ? cablePath(d.a, d.at) : cablePath(d.at, d.a)
  const over = !!d.over && ((d.over.jack && d.accept.jacks.has(d.over.jack)) || (!d.over.jack && !!d.over.module && d.accept.modules.has(d.over.module)))
  const lp = d.opens ? labelPoint(c, 0.5, -14) : null
  return (
    <svg className="pb-dragw" aria-hidden="true" data-testid="pb-drag" data-over={over || undefined} data-opens={d.opens || undefined}>
      <path className="pb-dragw__halo" d={c.d} />
      <path className="pb-dragw__c" d={c.d} />
      <circle className="pb-dragw__plug" cx={d.at.x} cy={d.at.y} r={5.6} />
      {lp && (
        <g className="pb-dragw__f" transform={`translate(${lp.x.toFixed(1)},${lp.y.toFixed(1)})`}>
          <title>{t(`${P}.patch.row.opens`, { f: d.opens!.replace(/\+/g, '') })}</title>
          <rect x={-18} y={-9} width={36} height={18} rx={2} />
          <text textAnchor="middle" dominantBaseline="central">
            {d.opens}
          </text>
        </g>
      )}
    </svg>
  )
}
