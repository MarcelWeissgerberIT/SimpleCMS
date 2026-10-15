/**
 * A net flag (plan §2.4, §3.3, §3.4): "Mails · „Weiterleiten“" — the same name at both ends is the same connection. The
 * § 03 flag ends the writers' cables (at the writer's row, its tail on the left), the § 01 flag starts the listeners'
 * cables (at the listener's row, its tip on the right). A pentagon body pointing along the signal, drawn in SVG to the
 * flag's own measure (dashed signal edge on an open fuse's path — the "F1" tag beside the name).
 *
 * A click or ↵ lights both twins and their cables and jumps to the twin: the keyboard moves there (scrolled into view
 * when needed) and the twin marks itself for a moment (`data-arrived`, ink — never orange), the jump is announced. A
 * twin that is folded away only lights. A stop of the rack's arrow keys (roving tab index, Rack.tsx).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flagId, type FlagSlot } from '../layout'
import type { NetLabel } from '../types'
import { useRack } from './RackContext'
import { announce, lightNet, setCursor, usePbUI } from './store'

const P = 'features.patchbay'
/** How long the twin a jump landed on stays marked (ms). */
const ARRIVED_MS = 900

export function NetFlag({ slot, net }: { slot: FlagSlot; net: NetLabel }) {
  const { words: w, marks, lit, entry } = useRack()
  const ref = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [arrived, setArrived] = useState(false)
  const active = usePbUI((s) => s.net === net.key)
  const fuses = marks.nets.get(net.key) ?? []
  const text = w.flag(net)
  const isLit = !!lit && lit.nets.has(net.key)
  const dim = !!lit && lit.mode !== 'hover' && !isLit

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const next = { w: el.offsetWidth, h: el.offsetHeight }
      setBox((cur) => (cur && cur.w === next.w && cur.h === next.h ? cur : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // a jump landed here: marked for a moment
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer = 0
    const on = () => {
      setArrived(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setArrived(false), ARRIVED_MS)
    }
    el.addEventListener('pb-arrive', on)
    return () => {
      el.removeEventListener('pb-arrive', on)
      window.clearTimeout(timer)
    }
  }, [])

  const jump = () => {
    lightNet(net.key)
    const twinId = flagId(net.key, slot.side === 'out' ? 'in' : 'out')
    const bench = ref.current?.closest('.pb-bench')
    const twin = bench?.querySelector<HTMLElement>(`[data-stop="${CSS.escape(twinId)}"]`)
    if (!twin) {
      announce(w.t(`${P}.flag.noTwin`, { name: text }))
      return
    }
    twin.focus({ preventScroll: true })
    twin.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    twin.dispatchEvent(new CustomEvent('pb-arrive'))
    announce(w.t(`${P}.flag.jumped`, { name: text }))
  }

  const k = 14
  const m = 0.75
  const d = box ? `M${m},${m} H${box.w - k} L${box.w - m},${box.h / 2} L${box.w - k},${box.h - m} H${m} Z` : ''
  const tags = fuses.map((f) => (
    <span key={f} className="pb-tag pb-tag--f">
      {f}
    </span>
  ))

  return (
    <button
      ref={ref}
      type="button"
      className="pb-flag"
      data-side={slot.side}
      data-path={fuses.length ? '' : undefined}
      data-lit={isLit || active || undefined}
      data-dim={dim || undefined}
      data-arrived={arrived || undefined}
      data-net={net.key}
      data-stop={slot.id}
      data-testid="pb-flag"
      title={w.t(`${P}.flag.title`)}
      aria-pressed={active}
      tabIndex={entry === slot.id ? 0 : -1}
      style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
      onFocus={(e) => e.target === e.currentTarget && setCursor(slot.id)}
      onClick={(e) => {
        e.stopPropagation()
        jump()
      }}
    >
      {box && (
        <svg className="pb-flag__body" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
          <path d={d} />
        </svg>
      )}
      {slot.side === 'out' && <span className="pb-flag__end pb-flag__end--tail" data-j={slot.id} aria-hidden="true" />}
      {slot.side === 'in' && tags}
      <span className="pb-flag__t">{text}</span>
      {slot.side === 'out' && tags}
      {slot.side === 'in' && <span className="pb-flag__end pb-flag__end--tip" data-j={slot.id} aria-hidden="true" />}
    </button>
  )
}
