/**
 * Task block — a picker's draft (blocked by / related / blocks / people): the person's OWN ticks, id → linked or not,
 * applied to the value as it is NOW. A value that arrives while the picker is open (a member's edit, a second write)
 * shows ticked and is never removed by a Done the person did not mean for it. Pure.
 */

/**
 * The links a picker shows: the links now, with the person's own ticks applied (`toggles`: id → linked or not). A
 * link that arrived while the picker was open stays (the person never unticked it).
 */
export function shownLinks(now: readonly string[], toggles: ReadonlyMap<string, boolean>): string[] {
  const out = now.filter((x) => toggles.get(x) !== false)
  for (const [id, on] of toggles) if (on && !out.includes(id)) out.push(id)
  return out
}

/** What a picker writes: the person's own ticks that differ from the links now (never a link they did not touch). */
export function toggleDelta(now: readonly string[], toggles: ReadonlyMap<string, boolean>): { add: string[]; remove: string[] } {
  const add: string[] = []
  const remove: string[] = []
  for (const [id, on] of toggles) {
    if (on && !now.includes(id)) add.push(id)
    else if (!on && now.includes(id)) remove.push(id)
  }
  return { add, remove }
}
