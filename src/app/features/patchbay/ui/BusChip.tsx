/**
 * A bus chip (plan §1.19): "+n" where more than six cables leave one jack for one column — the cables end here, the
 * targets folded into it are named in its title (they still count in CABLES and in the column head). A key: ↵ / click
 * opens its menu (the bundled cables, one entry per target): a target drawn elsewhere on the rack gets the selection and
 * the keyboard there, a target folded into the chip opens its editor (the module's own ↵). Esc gives the keyboard back
 * to the chip. A stop of the rack's arrow keys (roving tab index, Rack.tsx).
 */
import type { BusSlot } from '../layout'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import { moduleOfJack } from './lit'
import { canOpen, openModule } from './open'
import { useRack } from './RackContext'
import { selectModule, setCursor } from './store'

const P = 'features.patchbay'

export function BusChip({ slot }: { slot: BusSlot }) {
  const { model, words: w, lit, entry } = useRack()
  const menu = useMenu()
  const byKey = new Map(model.modules.map((m) => [m.key, m]))
  const folded = new Set(slot.modules)
  // one entry per target (in the order the cables were bundled)
  const targets: string[] = []
  for (const id of slot.edges) {
    const e = model.edges.find((x) => x.id === id)
    const k = e ? moduleOfJack(model, e.to) : null
    if (k && !targets.includes(k)) targets.push(k)
  }
  const names = slot.modules.map((k) => (byKey.get(k) ? w.name(byKey.get(k)!) : k))
  const isLit = !!lit && slot.edges.some((e) => lit.edges.has(e))
  const go = (k: string, from: HTMLElement | null) => {
    const m = byKey.get(k)
    if (!m) return
    const el = from?.closest('.pb-bench')?.querySelector<HTMLElement>(`[data-stop="${CSS.escape(k)}"]`)
    if (el) {
      selectModule(k)
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
      return
    }
    if (canOpen(m)) openModule(m, from)
  }
  const entries: MenuEntry[] = [
    { kind: 'section', label: w.t(`${P}.bus.head`, { n: slot.edges.length }) },
    ...targets.map((k) => {
      const m = byKey.get(k)
      return {
        label: m ? w.name(m) : k,
        hint: folded.has(k) ? w.t(`${P}.bus.folded`) : undefined,
        disabled: !m || (folded.has(k) && !canOpen(m)),
        onSelect: () => go(k, menu.anchor as HTMLElement | null),
      }
    }),
  ]
  return (
    <>
      <button
        type="button"
        className="pb-bus"
        data-lit={isLit || undefined}
        data-stop={slot.id}
        data-testid="pb-bus"
        title={w.t(`${P}.busTitle`, { names: names.join(', ') })}
        aria-label={w.t(`${P}.bus.aria`, { n: slot.edges.length, names: names.join(', ') })}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        tabIndex={entry === slot.id ? 0 : -1}
        style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
        onFocus={(e) => e.target === e.currentTarget && setCursor(slot.id)}
        onClick={(e) => {
          e.stopPropagation()
          menu.toggle(e)
        }}
      >
        <span className="pb-bus__end" data-j={slot.id} aria-hidden="true" />
        {w.t(`${P}.bus`, { n: slot.edges.length })}
      </button>
      <Menu {...menu.props} entries={entries} placement="right-start" width={260} />
    </>
  )
}
