/**
 * The decision models this tab knows (slice SJ), synchronously — the registry and the gate read them (D-S2-32: the gate
 * never waits for a catalogue). core/catalog.ts loadDecisionCatalog() fills it from the device's copy or a public GET; a
 * Claude-only person never loads one, so nothing here costs anything at boot.
 */
import type { DecisionRow } from '@/shared/ai/catalog'

let rows: DecisionRow[] = []
/** when the rows were read (ms; 0 = none) */
let readAt = 0

/** The rows a catalogue read gave (replaces what was known). */
export function noteDecisionRows(list: readonly DecisionRow[], at: number): void {
  rows = [...list]
  readAt = at
}

/** One decision model's row (null: not known in this tab). */
export const decisionRow = (id: string): DecisionRow | null => rows.find((r) => r.id === id) ?? null

/** Every decision row this tab knows, and when it was read. */
export const decisionRows = (): { rows: readonly DecisionRow[]; at: number } => ({ rows, at: readAt })
