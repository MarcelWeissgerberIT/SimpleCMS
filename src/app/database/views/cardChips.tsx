/**
 * Chips other areas put on a row's card (board / gallery): a component per area, registered once at boot
 * (`registerCardChip`, database/index.ts). Each decides for itself whether a card is its (the database's `system`, the
 * row) and renders nothing otherwise — it subscribes to its own stores, the card itself never re-renders for it. A chip
 * is a short status word (the coding chain's "PA-12 · 2/3"), never a key: the card's own click opens the row.
 */
import type { ComponentType } from 'react'
import type { Database, Page } from '../../store/types'

export type CardChip = ComponentType<{ db: Database; row: Page }>

const chips: CardChip[] = []

/** Add a chip to every card (idempotent per component). */
export function registerCardChip(chip: CardChip): void {
  if (!chips.includes(chip)) chips.push(chip)
}

/** The chips of a card (none registered: nothing rendered). */
export function CardChips({ db, row }: { db: Database; row: Page }) {
  if (!chips.length) return null
  return (
    <>
      {chips.map((Chip, i) => (
        <Chip key={i} db={db} row={row} />
      ))}
    </>
  )
}
