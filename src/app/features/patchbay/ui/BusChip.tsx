/**
 * A bus chip (plan §1.19): "+n" where more than six cables leave one jack for one column — the cables end here, the
 * targets folded into it are named in its title (they still count in CABLES and in the column head). B7 adds its popover
 * (↵ / click lists the targets, each a link to its module).
 */
import type { BusSlot } from '../layout'
import { useRack } from './RackContext'

const P = 'features.patchbay'

export function BusChip({ slot }: { slot: BusSlot }) {
  const { model, words: w, lit } = useRack()
  const names = slot.modules.map((k) => {
    const m = model.modules.find((x) => x.key === k)
    return m ? w.name(m) : k
  })
  const isLit = !!lit && slot.edges.some((e) => lit.edges.has(e))
  return (
    <span
      className="pb-bus"
      data-lit={isLit || undefined}
      data-testid="pb-bus"
      title={w.t(`${P}.busTitle`, { names: names.join(', ') })}
      style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
    >
      <span className="pb-bus__end" data-j={slot.id} aria-hidden="true" />
      {w.t(`${P}.bus`, { n: slot.edges.length })}
    </span>
  )
}
